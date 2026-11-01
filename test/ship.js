// Release checks for the seven ISIONXXX apps. See README.md.
//   node ship.js [APP...]   APP: ISIONXXX JOURNAL MEDITATE TRAINING nutrition data-analytics rewire (default: all)
// Serves SITE (default ../../site, one folder per app laid out like GitHub Pages; site.sh makes it) on a free local
// port, drives Chromium through each app, writes out/<APP>.json and exits 1 if anything high-severity turns up.
// high = a crash, a missing file, a broken offline start or a layout break; medium and low are reported, not failed.
'use strict';
const {chromium}=require('playwright');const fs=require('fs'),path=require('path'),http=require('http');
const AXE=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const SITE=path.resolve(process.env.SITE||path.join(__dirname,'../../site')),OUT=path.join(__dirname,'out');
const GH=!!process.env.GITHUB_ACTIONS;
// sample: how each app loads its sample data (the shell has none of its own: it reads the others')
const APPS={ISIONXXX:{},JOURNAL:{sample:"document.querySelector('[data-a=sample]').click()"},MEDITATE:{sample:"document.querySelector('[data-a=sample]').click()"},
  TRAINING:{sample:"document.querySelector('[data-a=sample]').click()"},nutrition:{sample:"doAct('demo')"},'data-analytics':{sample:'sample()'},rewire:{sample:"document.querySelector('[data-a=sample]').click()"}};
const SHARED=['ui.js','ui.css','sync.js'];
// deliberate product choices, not bugs: zoom is turned off at the owner's request
const ACCEPTED=[/meta-viewport/];
// the CDN, fonts and video hosts are blocked so every run sees the same thing (the apps must start without them)
const EXT=/cdnjs|jsdelivr|fonts\.g|youtube|ytimg|googleapis|gstatic/;
const only=process.argv.slice(2),bad=only.filter(a=>!APPS[a]);
if(bad.length){console.error(`unknown app: ${bad.join(', ')} (one of ${Object.keys(APPS).join(' ')})`);process.exit(2)}

// a static server like GitHub Pages: a folder answers with its index.html, and without a trailing slash redirects
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json',
  '.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};
function serve(root){return new Promise(res=>{const s=http.createServer((q,r)=>{let u;try{u=decodeURIComponent(new URL(q.url,'http://x').pathname)}catch{r.writeHead(400);return r.end()}
  let f=path.join(root,u);if(f!==root&&!f.startsWith(root+path.sep)){r.writeHead(403);return r.end()}
  fs.stat(f,(e,st)=>{if(!e&&st.isDirectory()){if(!u.endsWith('/')){r.writeHead(301,{Location:u+'/'});return r.end()}f=path.join(f,'index.html')}
    fs.readFile(f,(e2,b)=>{if(e2){r.writeHead(404,{'content-type':'text/plain'});return r.end('not found')}
      r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream','cache-control':'no-cache'});r.end(b)})})});
  s.listen(0,'127.0.0.1',()=>res(s))})}
// load, then the network goes quiet (blocked hosts fail at once), then ms more for the app's own timers
const settle=async(p,ms)=>{await p.waitForLoadState('load').catch(()=>{});await p.waitForLoadState('networkidle',{timeout:5000}).catch(()=>{});await p.waitForTimeout(ms)};

(async()=>{
  if(!fs.existsSync(SITE)){console.error(`no site at ${SITE}: run site.sh first, or set SITE`);process.exit(2)}
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve(SITE),BASE=`http://127.0.0.1:${srv.address().port}/`;
  const b=await chromium.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
  const all=[];
  // the shared files must be byte-identical in every app (ARCHITECTURE.md: a copy that drifts is a bug)
  {const R={app:'shared files',issues:[],notes:[]};all.push(R);const have=Object.keys(APPS).filter(a=>fs.existsSync(path.join(SITE,a)));
    if(have.length<Object.keys(APPS).length)R.notes.push('not in the site: '+Object.keys(APPS).filter(a=>!have.includes(a)).join(', '));
    for(const f of SHARED){const by={};for(const a of have){const p=path.join(SITE,a,f);const k=fs.existsSync(p)?require('crypto').createHash('md5').update(fs.readFileSync(p)).digest('hex').slice(0,8):'missing';(by[k]=by[k]||[]).push(a)}
      const v=Object.entries(by).sort((x,y)=>y[1].length-x[1].length);
      if(v.length>1)R.issues.push({sev:'high',area:'drift',msg:`${f} differs: ${v.map(([k,a])=>`${a.join(', ')} (${k})`).join(' vs ')}`})}}
  for(const [app,cfg] of Object.entries(APPS)){if(only.length&&!only.includes(app))continue;
    const R={app,issues:[],notes:[]};all.push(R);const I=(sev,area,msg)=>{if(!ACCEPTED.some(x=>x.test(msg))&&!R.issues.some(i=>i.area===area&&i.msg===msg))R.issues.push({sev,area,msg})};
    const DIR=path.join(SITE,app);if(!fs.existsSync(DIR)){I('high','site',`${DIR} is missing`);continue}
    const mk=async(w,sw)=>{const c=await b.newContext({viewport:{width:w,height:900},serviceWorkers:sw?'allow':'block'});await c.route(EXT,r=>r.abort());const p=await c.newPage();
      p._errs=[];p._bad=[];p.on('pageerror',e=>p._errs.push(e.message.slice(0,200)));
      p.on('console',m=>{if(m.type()==='error'&&!/net::ERR_FAILED|Failed to load resource/.test(m.text()))p._errs.push('console: '+m.text().slice(0,200))});
      p.on('response',r=>{if(r.status()>=400&&!EXT.test(r.url()))p._bad.push(r.status()+' '+r.url().replace(BASE,''))});p.on('dialog',d=>d.accept());return {c,p}};
    const loadSamples=async p=>{for(const [a,c2] of Object.entries(APPS)){if(!c2.sample)continue;await p.goto(BASE+a+'/');await settle(p,600);
      try{await p.evaluate(c2.sample)}catch(e){I('high','sample',`could not load ${a}'s sample: ${e.message.slice(0,100)}`)}await p.waitForTimeout(1200)}};
    const URL=BASE+app+'/';
    // 0. the shell carries ui.js's unit tests
    if(app==='ISIONXXX'&&fs.existsSync(path.join(DIR,'test/ui.test.html'))){const {c,p}=await mk(1440);await p.goto(URL+'test/ui.test.html');await settle(p,300);
      const u=await p.evaluate(()=>({r:window.UI_TEST,no:[...document.querySelectorAll('#out li.no')].map(li=>li.textContent.slice(0,160))}));
      if(!u.r)I('high','unit','ui.test.html did not finish');else{u.no.forEach(t=>I('high','unit',t));R.notes.push(`ui.js unit tests: ${u.r.pass} passed, ${u.r.fail} failed`)}
      p._errs.forEach(e=>I('high','unit',e));await c.close()}
    // 1. empty device, then sample data, at 390 and 1440 px: errors, failed requests, overflow, accessibility
    for(const w of [390,1440]){const {c,p}=await mk(w);
      await p.goto(URL);await p.evaluate(()=>localStorage.clear());await p.reload();await settle(p,1200);
      const st=async label=>{const o=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth,txt:document.body.innerText.length}));
        if(o.sw>o.iw+1)I('high','layout',`${label} @${w}: horizontal overflow ${o.sw}px > ${o.iw}px`);if(o.txt<40)I('high','render',`${label} @${w}: page nearly empty (${o.txt} chars)`);
        await p.addScriptTag({content:AXE}).catch(()=>{});
        const ax=await p.evaluate(async()=>{try{return (await axe.run(document,{resultTypes:['violations']})).violations.map(v=>({id:v.id,impact:v.impact,n:v.nodes.length,t:v.nodes[0].target.join(' ').slice(0,80)}))}catch(e){return [{id:'axe-failed',impact:'?',n:0,t:e.message}]}});
        ax.forEach(v=>I(v.impact==='critical'||v.impact==='serious'?'medium':'low','a11y',`${label} @${w}: ${v.id} ×${v.n} (${v.impact}) e.g. ${v.t}`))};
      await st('empty');
      if(app==='ISIONXXX'){await loadSamples(p);await p.goto(URL+'#today');await settle(p,2000)}
      else if(cfg.sample){try{await p.evaluate(cfg.sample)}catch(e){I('high','sample',`sample loader failed: ${e.message.slice(0,120)}`)}await settle(p,1200)}
      await st('sample');
      p._errs.forEach(e=>I('high','js',`@${w}: ${e}`));[...new Set(p._bad)].forEach(u=>I('high','network',`@${w}: ${u}`));
      await c.close()}
    // 2. manifest, icons and the service worker's precache list point at files that exist
    const file=f=>path.join(DIR,f.replace(/^\.\//,'').split('?')[0]),html=fs.readFileSync(path.join(DIR,'index.html'),'utf8');
    const man=(html.match(/<link[^>]+rel=["']manifest["'][^>]*href=["']([^"']+)/)||html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']manifest/)||[])[1];
    if(!man)I('high','pwa','no <link rel="manifest">');else if(!fs.existsSync(file(man)))I('high','pwa',`manifest ${man} missing`);else{let M;try{M=JSON.parse(fs.readFileSync(file(man),'utf8'))}catch(e){I('high','pwa','manifest is not valid JSON')}
      if(M){['name','short_name','start_url','display','icons'].forEach(k=>{if(!M[k])I('medium','pwa',`manifest has no ${k}`)});
        const sizes=(M.icons||[]).map(i=>i.sizes);if(!sizes.some(s=>/192/.test(s))||!sizes.some(s=>/512/.test(s)))I('medium','pwa',`manifest icons lack 192/512 (${sizes})`);
        for(const ic of M.icons||[]){const f=file(ic.src);if(!fs.existsSync(f)){I('high','pwa',`icon ${ic.src} missing`);continue}
          if(/png$/.test(f)){const buf=fs.readFileSync(f),wd=buf.readUInt32BE(16),ht=buf.readUInt32BE(20);if(ic.sizes&&ic.sizes!=='any'&&ic.sizes!==`${wd}x${ht}`)I('medium','pwa',`icon ${ic.src} is ${wd}x${ht}, manifest says ${ic.sizes}`)}}
        if(!(M.icons||[]).some(i=>/maskable/.test(i.purpose||'')))R.notes.push('no maskable icon')}}
    const ati=(html.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)/)||[])[1];if(!ati)I('low','pwa','no apple-touch-icon link');else if(!fs.existsSync(file(ati)))I('high','pwa',`apple-touch-icon ${ati} missing`);
    const swsrc=fs.readFileSync(path.join(DIR,'sw.js'),'utf8'),list=(swsrc.match(/const (?:SHELL|ASSETS) *= *\[([^\]]*)\]/)||[])[1];
    if(!list)I('medium','pwa','could not find the precache list in sw.js');else for(const a of list.match(/'[^']+'/g).map(s=>s.slice(1,-1))){if(a!=='./'&&!fs.existsSync(file(a)))I('high','pwa',`sw.js precaches ${a}, which doesn't exist`)}
    if(man&&list&&!list.includes(man.replace(/^\.\//,'')))I('low','pwa',`manifest ${man} not in the precache list`);
    // 3. offline: the service worker installs, then the app starts with the network off
    {const {c,p}=await mk(390,true);await p.goto(URL);await settle(p,500);
      const ok=await p.evaluate(async()=>{if(!navigator.serviceWorker)return 'no sw api';try{await Promise.race([navigator.serviceWorker.ready,new Promise((_,j)=>setTimeout(()=>j('timeout'),10000))]);return 'ready'}catch(e){return 'not ready: '+e}});
      if(ok!=='ready')I('high','offline',`service worker ${ok}`);else{await p.reload();await settle(p,1000);await c.setOffline(true);p._errs.length=0;
        try{await p.reload({timeout:15000});await p.waitForTimeout(1500);const t=await p.evaluate(()=>document.body.innerText.length);if(t<40)I('high','offline','offline reload shows a nearly empty page');p._errs.forEach(e=>I('high','offline',`offline: ${e}`))}catch(e){I('high','offline','offline reload failed: '+e.message.slice(0,120))}}
      await c.close()}
    // 4. corrupted saved data: each key as broken JSON and as a wrong-typed value; the app must still start
    {const {c,p}=await mk(1440);await p.goto(URL);await p.evaluate(()=>localStorage.clear());
      if(app==='ISIONXXX')await loadSamples(p);else{await p.reload();await settle(p,600);if(cfg.sample){try{await p.evaluate(cfg.sample)}catch(e){}await settle(p,1000)}}
      await p.goto(URL);await settle(p,600);
      const snap=await p.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])));
      for(const k of Object.keys(snap)){if(/sync\.cfg|^isx\.plan\./.test(k))continue;
        for(const v of ['{"broken','42']){await p.evaluate(([k,v,s])=>{for(const x in s)localStorage.setItem(x,s[x]);localStorage.setItem(k,v)},[k,v,snap]);p._errs.length=0;
          await p.reload();await settle(p,app==='ISIONXXX'?1500:700);const t=await p.evaluate(()=>document.body.innerText.length);
          if(p._errs.length||t<40)I('high','robust',`${k} = ${v}: ${p._errs.length?p._errs[0]:'page nearly empty'}`)}}
      await c.close()}
    fs.writeFileSync(path.join(OUT,app+'.json'),JSON.stringify(R,null,1));
  }
  await b.close();srv.close();
  // report: a line per app, every issue under it; on GitHub, annotations and a job summary too
  const n=(R,s)=>R.issues.filter(i=>i.sev===s).length,line=R=>`${R.app}: ${n(R,'high')} high, ${n(R,'medium')} medium, ${n(R,'low')} low${R.notes.length?' · '+R.notes.join('; '):''}`;
  const esc=s=>s.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
  for(const R of all){console.log(line(R));for(const i of R.issues){console.log(`  ${i.sev.padEnd(6)} ${i.area.padEnd(8)} ${i.msg}`);
    if(GH&&i.sev!=='low')console.log(`::${i.sev==='high'?'error':'warning'} title=${esc(R.app+' · '+i.area)}::${esc(i.msg)}`)}}
  if(process.env.GITHUB_STEP_SUMMARY){const md=['## Release check','','| App | High | Medium | Low | Notes |','|---|---|---|---|---|',...all.map(R=>`| ${R.app} | ${n(R,'high')||'0 ✓'} | ${n(R,'medium')} | ${n(R,'low')} | ${R.notes.join('; ')} |`),'',
      ...all.filter(R=>R.issues.length).flatMap(R=>[`### ${R.app}`,'',...R.issues.map(i=>`- **${i.sev}** · ${i.area} · ${i.msg.replace(/[|<>]/g,c=>({'|':'\\|','<':'&lt;','>':'&gt;'})[c])}`),''])].join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md+'\n')}
  const high=all.reduce((s,R)=>s+n(R,'high'),0);
  console.log(high?`\nFAIL: ${high} high-severity issue${high>1?'s':''}`:'\nPASS: no high-severity issues');process.exitCode=high?1:0;
})().catch(e=>{console.error(e);process.exit(2)});
