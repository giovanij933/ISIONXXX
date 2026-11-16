// The iPhone lane: each app and TODAY in WebKit, Safari's engine, on an iPhone 15's screen with a year of sample data,
// light and dark. See README.md.
//   node webkit.test.js [APP...]   (default: all seven; an app's own run passes that app and ISIONXXX)
// It looks for what has broken on iPhones and not in Chromium:
//   - a script error;
//   - a page wider than the screen;
//   - a card that's laid out but never drawn. Each card is shot as it is and again hidden: if the two pictures are the
//     same, the card wasn't on screen (TODAY once lost every card under its backdrop this way, on iPhone only);
//   - a card covered by something else at its middle.
// Reduce Motion is on, so nothing on the page moves and two shots of the same thing are the same picture.
// WebKit on Linux is not iOS Safari: a pass makes an iPhone-only bug less likely, not impossible.
// BROWSER=chromium (with CHROME=<path>) runs the same checks in Chromium, to work on this file without WebKit.
'use strict';
const pw=require('playwright');const fs=require('fs'),path=require('path'),http=require('http');
const SITE=path.resolve(process.env.SITE||path.join(__dirname,'../../site')),OUT=path.join(__dirname,'out'),GH=!!process.env.GITHUB_ACTIONS;
const ENGINE=process.env.BROWSER||'webkit';
const S="document.querySelector('[data-a=sample]').click()";
const APPS={ISIONXXX:{url:'ISIONXXX/#today'},JOURNAL:{sample:S},MEDITATE:{sample:S},TRAINING:{sample:S},nutrition:{sample:"doAct('demo')"},'data-analytics':{sample:'sample()'},rewire:{sample:S}};
const EXT=/cdnjs|jsdelivr|fonts\.g|youtube|ytimg|googleapis|gstatic/;
const only=process.argv.slice(2),bad=only.filter(a=>!APPS[a]);
if(bad.length){console.error(`unknown app: ${bad.join(', ')}`);process.exit(2)}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json',
  '.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const serve=root=>new Promise(res=>{const s=http.createServer((q,r)=>{let u;try{u=decodeURIComponent(new URL(q.url,'http://x').pathname)}catch{r.writeHead(400);return r.end()}
  let f=path.join(root,u);if(f!==root&&!f.startsWith(root+path.sep)){r.writeHead(403);return r.end()}
  fs.stat(f,(e,st)=>{if(!e&&st.isDirectory()){if(!u.endsWith('/')){r.writeHead(301,{Location:u+'/'});return r.end()}f=path.join(f,'index.html')}
    fs.readFile(f,(e2,b)=>{if(e2){r.writeHead(404);return r.end()}r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream','cache-control':'no-cache'});r.end(b)})})});
  s.listen(0,'127.0.0.1',()=>res(s))});
const settle=async(p,ms)=>{await p.waitForLoadState('load').catch(()=>{});await p.waitForLoadState('networkidle',{timeout:5000}).catch(()=>{});await p.waitForTimeout(ms)};
// the cards on the page: each app's cards and hero, TODAY's sections; the outermost only, at most 40
const MARK=()=>{const sel='.card,.ui-hero,#today>section,#today>div>section';
  const ok=e=>{const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return r.width>40&&r.height>30&&cs.visibility!=='hidden'&&cs.display!=='none'&&!e.closest('dialog,[hidden],.hidden,[aria-hidden=true]')};
  const all=[...document.querySelectorAll(sel)].filter(ok),top=all.filter(e=>!all.some(o=>o!==e&&o.contains(e))).slice(0,40);
  top.forEach((e,i)=>e.dataset.wk=i);return top.map(e=>(e.querySelector('h1,h2,h3,.h')?.textContent||e.className).trim().replace(/\s+/g,' ').slice(0,40))};

(async()=>{
  if(!fs.existsSync(SITE)){console.error(`no site at ${SITE}: run site.sh first, or set SITE`);process.exit(2)}
  fs.mkdirSync(OUT,{recursive:true});
  const srv=await serve(SITE),BASE=`http://127.0.0.1:${srv.address().port}/`;
  const b=await pw[ENGINE].launch(ENGINE==='chromium'&&process.env.CHROME?{executablePath:process.env.CHROME}:{});
  const all=[];
  for(const scheme of ['light','dark']){
    const c=await b.newContext({...pw.devices['iPhone 15'],colorScheme:scheme,reducedMotion:'reduce',serviceWorkers:'block'});await c.route(EXT,r=>r.abort());
    const p=await c.newPage();let errs=[];p.on('pageerror',e=>errs.push(e.message.slice(0,200)));p.on('dialog',d=>d.accept());
    // a year of every app's sample data first, so TODAY has something to draw
    for(const [a,cfg] of Object.entries(APPS)){if(!cfg.sample)continue;await p.goto(BASE+a+'/');await settle(p,500);try{await p.evaluate(cfg.sample)}catch(e){}await p.waitForTimeout(1200)}
    for(const [app,cfg] of Object.entries(APPS)){if(only.length&&!only.includes(app))continue;
      let R=all.find(x=>x.app===app);if(!R){R={app,issues:[],notes:[]};all.push(R)}
      const I=(sev,area,msg)=>{if(!R.issues.some(i=>i.msg===msg))R.issues.push({sev,area,msg})};
      errs=[];await p.goto(BASE+(cfg.url||app+'/'));await settle(p,app==='ISIONXXX'?2500:1500);
      errs.forEach(e=>I('high','error',`${scheme}: ${e}`));
      const o=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth,txt:document.body.innerText.length}));
      if(o.sw>o.iw+1)I('high','layout',`${scheme}: page is ${o.sw}px wide on a ${o.iw}px screen`);
      if(o.txt<40){I('high','render',`${scheme}: page nearly empty`);continue}
      const names=await p.evaluate(MARK);let drawn=0;
      for(let i=0;i<names.length;i++){const el=p.locator(`[data-wk="${i}"]`);
        try{await el.evaluate(e=>e.scrollIntoView({block:'center'}));await p.waitForTimeout(150);
          const vp=p.viewportSize(),bx=await el.boundingBox();if(!bx)continue;
          // the part of the card on screen (a tall card is cut to the screen)
          const x=Math.max(0,bx.x),y=Math.max(0,bx.y),clip={x,y,width:Math.min(vp.width,bx.x+bx.width)-x,height:Math.min(vp.height,bx.y+bx.height)-y};
          if(clip.width<20||clip.height<20)continue;
          const hit=await p.evaluate(([i,cx,cy])=>{const e=document.querySelector(`[data-wk="${i}"]`),h=document.elementFromPoint(cx,cy);return !h||e.contains(h)||h.contains(e)?'':(h.id?'#'+h.id:h.tagName.toLowerCase()+(h.className&&typeof h.className==='string'?'.'+h.className.trim().split(/\s+/).join('.'):''))},[i,clip.x+clip.width/2,clip.y+clip.height/2]);
          if(hit)I('high','covered',`${scheme}: "${names[i]}" is covered by ${hit.slice(0,60)}`);
          const shown=await p.screenshot({clip,animations:'disabled'});
          await el.evaluate(e=>{e.dataset.wkv=e.style.visibility;e.style.visibility='hidden'});await p.waitForTimeout(80);
          const gone=await p.screenshot({clip,animations:'disabled'});
          await el.evaluate(e=>{e.style.visibility=e.dataset.wkv||''});
          if(shown.equals(gone))I('high','undrawn',`${scheme}: "${names[i]}" is laid out but not drawn`);else drawn++;
        }catch(e){I('medium','check',`${scheme}: could not check "${names[i]}": ${e.message.split('\n')[0].slice(0,100)}`)}}
      R.notes.push(`${scheme}: ${drawn} of ${names.length} cards drawn`);
      if(scheme==='light')await p.evaluate(()=>{(document.querySelector('#today')||document.scrollingElement).scrollTo(0,0)}).then(()=>p.waitForTimeout(200)).then(()=>p.screenshot({path:path.join(OUT,`webkit-${app}.png`)})).catch(()=>{});
    }
    await c.close();
  }
  await b.close();srv.close();
  const n=(R,s)=>R.issues.filter(i=>i.sev===s).length,esc=s=>s.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
  console.log(`\niPhone lane (${ENGINE})`);
  for(const R of all){console.log(`${R.app}: ${n(R,'high')} high, ${n(R,'medium')} medium · ${R.notes.join('; ')}`);for(const i of R.issues){console.log(`  ${i.sev.padEnd(6)} ${i.area.padEnd(8)} ${i.msg}`);
    if(GH)console.log(`::${i.sev==='high'?'error':'warning'} title=${esc('iPhone lane · '+R.app+' · '+i.area)}::${esc(i.msg)}`)}}
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,['','## iPhone lane ('+ENGINE+')','','| App | High | Medium | Notes |','|---|---|---|---|',
    ...all.map(R=>`| ${R.app} | ${n(R,'high')||'0 ✓'} | ${n(R,'medium')} | ${R.notes.join('; ')} |`),'',...all.filter(R=>R.issues.length).flatMap(R=>[`### ${R.app}`,'',...R.issues.map(i=>`- **${i.sev}** · ${i.area} · ${i.msg.replace(/[|<>]/g,c=>({'|':'\\|','<':'&lt;','>':'&gt;'})[c])}`),''])].join('\n')+'\n');
  const high=all.reduce((s,R)=>s+n(R,'high'),0);
  console.log(high?`\nFAIL: ${high} high-severity issue${high>1?'s':''}`:'\nPASS: no high-severity issues');process.exitCode=high?1:0;
})().catch(e=>{console.error(e);process.exit(2)});
