/* AFTER SIGNAL — recruit screen (대원 모집) and pull presentation V1 (2026-09-26).
   Mountable overlay for the shelter lobby (or any page under RUN/pages): banner, 1회/10회 buttons (banner ticket or
   다이아, rendered generically), first free 10-pull, SSR 확정 countdown (half pity), mileage + SSR exchange, 확률 공개,
   모집 기록, 별의 가루 교환. Pull presentation: relay-signal drop pod (colour = best rarity: R cyan, SR violet, SSR gold
   with flare/shake/rays), card-by-card reveal, SSR full-screen splash, results grid, SKIP at any time.
   Every pull is resolved, paid and saved by AfterSignalGacha (one write) BEFORE the animation starts; a reload during the
   animation shows the saved results on the next open (profile.gacha.lastTxn.ack=false).
   Existing art only (shelter roster standing/portrait); effects are CSS/SVG/canvas. Optional sound through opts.sfx(cue)
   with existing cue names only. Honors prefers-reduced-motion.
   API: AfterSignalGachaUI.mount(host,{store,roster,economy,bannerId,backdrop,sfx,onClose,onCommitted,onShop,reducedMotion})
        -> {open(), close(), destroy(), refresh(), el} */
(function(root){
  "use strict";
  const VERSION="1.0.0";
  // horizontal face position in each standing image (fraction of width); same table as the shelter home + somi
  const FACE_X=Object.freeze({mira:.5,haneul:.538,sera:.567,astra:.4,tessa:.462,naru:.488,karin:.418,serin:.497,luna:.422,arin:.45,jaein:.466,roa:.45,noella:.535,ria:.403,bomin:.452,orin:.507,yunseo:.508,yura:.52,yeonhwa:.49,narae:.471,moa:.471,yumi:.516,sion:.469,haejin:.442,eve:.537,sea:.491,seorin:.502,lumi:.382,iona:.586,somi:.457,mei:.483,yuria:.505,soha:.451,liora:.43,bella:.466,dana:.577,chaerin:.474,yujin:.442,harin:.5,dabin:.407});
  // standing art too small for a full-screen splash (under 1000 px high): use the face portrait instead. preload() adds any such standing at run time;
  // the static list is empty since Haneul-7's standing was redrawn at 1024x1536 (2026-09-30), the splash now shows her full standing like the others
  const LOWRES=new Set();
  const RANK=Object.freeze({R:1,SR:2,SSR:3});
  const DEFAULT_BACKDROP="../assets/785ccbf5dcde7e49c335.webp";
  const T=Object.freeze({violet:800,gold:1350,land:1750,endR:2350,endSSR:2900});
  const REASON_TEXT={DIAMONDS:"다이아가 부족합니다.",FREE_UNAVAILABLE:"첫 모집은 이미 사용했습니다.",BANNER_DISABLED:"지금은 열려 있지 않은 모집입니다.",CONFLICT:"저장이 겹쳤습니다. 다시 시도해 주세요.",STORAGE:"저장에 실패했습니다. 저장 공간을 확인해 주세요.",NO_PROFILE:"프로필을 찾을 수 없습니다.",MILEAGE:"마일리지가 부족합니다.",NOT_SSR:"SSR 대원만 교환할 수 있습니다.",DUST:"별의 가루가 부족합니다."};
  const SOURCE_TEXT={FREE_FIRST:"첫 모집",DIAMOND:"다이아",TICKET:"모집권",MIXED:"모집권+다이아",MILEAGE:"마일리지"};
  const imgCache=new Map();
  let mountCount=0;

  const fmt=n=>Math.max(0,Math.floor(Number(n)||0)).toLocaleString("ko-KR");
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const pct=v=>`${Number((+v).toFixed(4))}%`;
  const fx=id=>FACE_X[id]??.5;
  const ICON={gem:'<i class="gc-gem" aria-hidden="true"></i>',dust:'<i class="gc-dust" aria-hidden="true"></i>',ticket:'<i class="gc-ticket" aria-hidden="true"></i>'};
  function rid(){const a=new Uint32Array(2);root.crypto.getRandomValues(a);return `rq-${Date.now().toString(36)}-${a[0].toString(36)}${a[1].toString(36)}`}
  function costHtml(cost){
    if(!cost)return "";
    if(cost.free)return '<b class="gc-free-t">무료</b>';
    const parts=[];
    if(cost.tickets)parts.push(`${ICON.ticket}<b>×${fmt(cost.tickets)}</b>`);
    if(cost.diamonds||!cost.tickets)parts.push(`${ICON.gem}<b>${fmt(cost.diamonds)}</b>`);
    return parts.join('<span class="gc-plus">+</span>');
  }
  const pips=n=>`<span class="gc-pips" aria-label="돌파 ${n|0}단계">${[1,2,3,4,5].map(i=>`<i${i<=n?' class="gc-on"':""}></i>`).join("")}</span>`;
  const outcomeText=r=>r.outcome==="NEW"?"신규 합류":r.outcome==="STAR"?`돌파 ★${r.stars}`:`별의 가루 +${fmt(r.dust)}`;
  function badgeHtml(r){
    if(r.outcome==="NEW")return '<span class="gc-badge gc-badge-new">NEW</span>';
    if(r.outcome==="STAR")return '<span class="gc-badge gc-badge-star">★+1</span>';
    return `<span class="gc-badge gc-badge-dust">${ICON.dust}+${fmt(r.dust)}</span>`;
  }
  const POD_SVG=uid=>`<svg class="gc-pod" viewBox="0 0 120 230" aria-hidden="true"><defs>
    <linearGradient id="${uid}-hull" x1="0" x2="1"><stop offset="0" stop-color="#15222a"/><stop offset=".38" stop-color="#7f98a4"/><stop offset=".56" stop-color="#e9f5f9"/><stop offset=".72" stop-color="#8aa3ae"/><stop offset="1" stop-color="#1a2a33"/></linearGradient>
    <linearGradient id="${uid}-flame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
    <path class="gc-pod-flame" d="M36 190 Q60 262 84 190 Z" fill="url(#${uid}-flame)"/>
    <path d="M20 146 L3 204 L24 192 Z M100 146 L117 204 L96 192 Z" fill="#1c2c35" stroke="currentColor" stroke-width="1.6"/>
    <path d="M60 5 C88 21 101 60 101 110 L101 170 Q101 192 80 196 L40 196 Q19 192 19 170 L19 110 C19 60 32 21 60 5 Z" fill="url(#${uid}-hull)" stroke="#071015" stroke-width="3"/>
    <path d="M22 120 H98 M22 152 H98 M60 8 V44" stroke="currentColor" stroke-width="2.4" opacity=".95"/>
    <rect x="45" y="54" width="30" height="46" rx="13" fill="#061016" stroke="currentColor" stroke-width="2.4"/>
    <rect class="gc-pod-core" x="51" y="61" width="18" height="32" rx="8" fill="currentColor"/>
    <circle cx="36" cy="136" r="3.4" fill="currentColor"/><circle cx="84" cy="136" r="3.4" fill="currentColor"/>
    <path d="M34 196 H86 L80 206 H40 Z" fill="#0c171d" stroke="currentColor" stroke-width="1.6"/></svg>`;

  function template(uid,backdrop){
    return `
<div class="gc-screen gc-home">
  <div class="gc-bg" style="--gc-backdrop:url('${esc(backdrop)}')"></div>
  <div class="gc-art" aria-hidden="true"></div>
  <div class="gc-home-shade" aria-hidden="true"></div>
  <header class="gc-top">
    <button type="button" class="gc-back" data-act="close" aria-label="모집 닫기"><span aria-hidden="true"></span></button>
    <div class="gc-title"><b>대원 모집</b><small>RECRUIT</small></div>
    <nav class="gc-tabs" role="tablist" aria-label="모집 종류"></nav>
    <div class="gc-wallet">
      <span class="gc-pill" data-wallet="dust" title="별의 가루">${ICON.dust}<b>0</b></span>
      <span class="gc-pill" data-wallet="diamonds" title="다이아">${ICON.gem}<b>0</b></span>
    </div>
  </header>
  <section class="gc-copy">
    <p class="gc-eyebrow"><span data-banner-kind>STANDARD</span>기간 제한 없음</p>
    <h2 class="gc-headline"><span data-banner-title>상시 모집</span><small data-banner-sub>RELAY RECRUIT</small></h2>
    <p class="gc-desc">끊긴 중계 신호를 따라 흩어진 대원을 불러옵니다.</p>
    <div class="gc-rates"><span data-r="SSR">SSR <b>2%</b></span><span data-r="SR">SR <b>48%</b></span><span data-r="R">R <b>50%</b></span></div>
    <p class="gc-note">10회 모집 시 SR 이상 1명 확정 · <span data-pool-text></span></p>
    <p class="gc-first-note">${ICON.gem}<span>첫 모집 보상 — 무료 10회 모집이 준비되었습니다</span></p>
  </section>
  <aside class="gc-side">
    <div class="gc-panel gc-pity">
      <p class="gc-k">SSR 확정까지</p>
      <p class="gc-v"><b data-pity>100</b><span>회</span></p>
      <div class="gc-bar"><i data-pity-bar></i></div>
      <p class="gc-sub">100번째 모집 SSR 확정 · SSR 획득 시 초기화</p>
    </div>
    <div class="gc-panel gc-mile">
      <div><p class="gc-k">모집 마일리지</p>
      <p class="gc-v"><b data-mile>0</b><span>/ <em data-mile-cost>200</em></span></p></div>
      <button type="button" class="gc-btn-s gc-btn-gold" data-act="mileage">SSR 교환</button>
      <div class="gc-bar gc-bar-gold"><i data-mile-bar></i></div>
      <p class="gc-sub">모집 1회당 1 · 200으로 원하는 SSR 1명</p>
    </div>
    <div class="gc-tools">
      <button type="button" class="gc-tool" data-act="rates">확률 공개</button>
      <button type="button" class="gc-tool" data-act="history">모집 기록</button>
      <button type="button" class="gc-tool" data-act="dust">별의 가루 교환</button>
    </div>
  </aside>
  <footer class="gc-actions">
    <button type="button" class="gc-pull gc-pull-1" data-act="pull1"><span class="gc-pull-l">1회 모집</span><span class="gc-pull-c" data-cost="one"></span></button>
    <button type="button" class="gc-pull gc-pull-10" data-act="pull10"><span class="gc-pull-l">10회 모집</span><span class="gc-pull-c" data-cost="ten"></span></button>
  </footer>
</div>
<div class="gc-screen gc-intro">
  <canvas class="gc-fx" aria-hidden="true"></canvas>
  <div class="gc-rays" aria-hidden="true"></div>
  <div class="gc-beam" aria-hidden="true"><i class="gc-beam-c"></i><i class="gc-beam-v"></i><i class="gc-beam-g"></i></div>
  <div class="gc-ground" aria-hidden="true"></div>
  <div class="gc-pod-wrap" aria-hidden="true">${POD_SVG(uid)}</div>
  <div class="gc-ring" aria-hidden="true"></div><div class="gc-ring gc-ring2" aria-hidden="true"></div>
  <div class="gc-intro-hud"><p class="gc-sig"><i></i><i></i><i></i><i></i><b>RELAY SIGNAL</b></p><p class="gc-sig-t" data-sig-text>신호 추적 중</p></div>
  <div class="gc-flash" aria-hidden="true"></div><div class="gc-flash gc-flash-land" aria-hidden="true"></div>
</div>
<div class="gc-screen gc-reveal" data-rarity="R">
  <div class="gc-reveal-bg" aria-hidden="true"></div>
  <div class="gc-burst-fx" aria-hidden="true"></div>
  <p class="gc-count"><b data-count>1</b><span>/</span><em data-total>10</em></p>
  <div class="gc-stage-card" data-card-slot></div>
  <ol class="gc-dots" data-dots aria-hidden="true"></ol>
  <p class="gc-hint">화면을 눌러 계속</p>
</div>
<div class="gc-screen gc-splash" data-rarity="SSR">
  <div class="gc-splash-bg" aria-hidden="true"></div><div class="gc-splash-rays" aria-hidden="true"></div>
  <div class="gc-splash-art" data-splash-art aria-hidden="true"></div>
  <div class="gc-splash-shade" aria-hidden="true"></div>
  <div class="gc-splash-copy">
    <p class="gc-splash-r">SSR</p>
    <p class="gc-splash-call" data-splash-call></p>
    <h2 class="gc-splash-name" data-splash-name></h2>
    <p class="gc-splash-meta" data-splash-meta></p>
    <p class="gc-splash-out" data-splash-out></p>
  </div>
  <p class="gc-hint">화면을 눌러 계속</p>
  <div class="gc-flash gc-flash-splash" aria-hidden="true"></div>
</div>
<div class="gc-screen gc-results">
  <div class="gc-results-bg" aria-hidden="true"></div>
  <header class="gc-results-head"><h2>모집 결과<small>RECRUIT RESULT</small></h2><p class="gc-results-sum" data-sum></p></header>
  <div class="gc-grid" data-grid></div>
  <footer class="gc-results-foot"><p class="gc-results-info" data-info></p><div class="gc-results-btns">
    <button type="button" class="gc-btn gc-btn-ghost" data-act="done">확인</button>
    <button type="button" class="gc-btn gc-btn-main" data-act="again"></button></div></footer>
</div>
<button type="button" class="gc-skip" data-act="skip">SKIP<span aria-hidden="true">››</span></button>
<div class="gc-modal-layer" hidden></div>
<div class="gc-toast" role="status" aria-live="polite"></div>
<p class="gc-sr" aria-live="assertive"></p>`;
  }

  function mount(host,options={}){
    const GA=root.AfterSignalGacha;
    if(!GA)throw new Error("AfterSignalGacha is not loaded");
    const uid=`gc${++mountCount}`;
    const store=options.store||GA.createStore({roster:options.roster,economy:options.economy});
    const rosterOf=()=>options.roster||root.AfterSignalShelter?.characters||{};
    const spec=id=>rosterOf()[id]||{id,name:id,characterId:"",title:"",rarity:"R",standing:"",portrait:""};
    const reduceMq=root.matchMedia?root.matchMedia("(prefers-reduced-motion: reduce)"):null;
    const reduced=()=>options.reducedMotion===true||(options.reducedMotion!==false&&Boolean(reduceMq?.matches));
    const sfx=cue=>{try{options.sfx?.(cue)}catch{}};
    const notify=detail=>{try{options.onCommitted?.(detail)}catch(error){console.warn("[gacha] onCommitted",error)}};
    const isLow=id=>LOWRES.has(id);

    const el=document.createElement("div");
    el.className="gc-root";el.hidden=true;el.dataset.state="home";
    el.setAttribute("role","dialog");el.setAttribute("aria-modal","true");el.setAttribute("aria-label","대원 모집");
    // resolve against the page: a url() inside a custom property would resolve against this stylesheet instead
    let backdrop=options.backdrop||DEFAULT_BACKDROP;try{backdrop=new URL(backdrop,document.baseURI).href}catch{}
    el.innerHTML=template(uid,backdrop);
    (host||document.body).appendChild(el);
    const q=s=>el.querySelector(s);
    const S={bannerId:options.bannerId||"standard",busy:false,seq:null,timers:new Set(),raf:0,fxSize:null,modal:null,pick:null,lastFocus:null,advanceAt:0,artFor:null};
    const later=(fn,ms)=>{const t=setTimeout(()=>{S.timers.delete(t);fn()},ms);S.timers.add(t);return t};
    const clearTimers=()=>{for(const t of S.timers)clearTimeout(t);S.timers.clear()};
    const setState=name=>{el.dataset.state=name};
    const announce=text=>{const n=q(".gc-sr");n.textContent="";n.textContent=text};
    let toastTimer=0;
    function toast(text){const n=q(".gc-toast");n.textContent=text;n.classList.add("gc-show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>n.classList.remove("gc-show"),2200)}

    /* ---------- art ---------- */
    function preload(ids){
      for(const id of ids){
        const s=spec(id);
        for(const src of [isLow(id)?s.portrait:s.standing,s.portrait]){
          if(!src||imgCache.has(src))continue;
          if(imgCache.size>80)imgCache.delete(imgCache.keys().next().value);
          const im=new Image();im.decoding="async";im.src=src;imgCache.set(src,im);
          im.decode?.().then(()=>{if(src===s.standing&&im.naturalHeight&&im.naturalHeight<1000)LOWRES.add(id)}).catch(()=>{});
        }
      }
    }
    function cardHtml(r,mode){
      const s=spec(r.id),grid=mode==="grid",lazy=grid?' loading="lazy"':"";
      const art=isLow(r.id)
        ?`<img class="gc-img gc-img-p" src="${esc(s.portrait)}" alt=""${lazy} draggable="false">`
        :`<img class="gc-img gc-img-s" style="--fx:${fx(r.id)}" src="${esc(s.standing)}" alt=""${lazy} draggable="false">`;
      const thumb=grid?`<img class="gc-img gc-img-t" src="${esc(s.portrait)}" alt="" loading="lazy" draggable="false">`:"";
      return `<div class="gc-card${grid?" gc-flipped gc-static":""}" data-rarity="${r.rarity}" data-outcome="${r.outcome}">
        <div class="gc-card-in">
          <div class="gc-card-face gc-card-back"><i class="gc-glyph"></i><b>AFTER SIGNAL</b><small>RELAY RECRUIT</small></div>
          <div class="gc-card-face gc-card-front">
            <div class="gc-card-art">${art}${thumb}</div>
            <i class="gc-card-frame"></i>
            <span class="gc-card-rar">${r.rarity}</span>${badgeHtml(r)}
            <div class="gc-card-name"><b>${esc(s.name)}</b><small>${esc(s.characterId)}${s.title?` · ${esc(s.title)}`:""}</small>${pips(r.stars)}</div>
          </div></div></div>`;
    }
    function renderTabs(){
      const tabs=Object.values(GA.BANNER_DEFS).filter(b=>b.enabled!==false);
      q(".gc-tabs").innerHTML=tabs.map(b=>`<button type="button" class="gc-tab" role="tab" data-act="tab" data-banner="${esc(b.id)}" aria-selected="${b.id===S.bannerId}">${esc(b.title)}</button>`).join("");
      const b=store.banner(S.bannerId)||GA.BANNER_DEFS.standard;
      q("[data-banner-kind]").textContent=String(b.type||"standard").toUpperCase();
      q("[data-banner-title]").textContent=b.title;q("[data-banner-sub]").textContent=b.subtitle||"";
    }
    function renderArt(){
      if(S.artFor===S.bannerId)return;
      const banner=store.banner(S.bannerId),pool=store.pool(),roster=rosterOf();
      const ids=(banner?.featured||[]).filter(id=>roster[id]&&!isLow(id));
      for(const id of pool.SSR)if(ids.length<3&&!ids.includes(id)&&!isLow(id))ids.push(id);
      const [main,left,right]=ids;
      const fig=(id,cls)=>id?`<img class="gc-fig ${cls}" style="--fx:${fx(id)}" src="${esc(spec(id).standing)}" alt="" draggable="false">`:"";
      q(".gc-art").innerHTML=`<i class="gc-halo"></i>${fig(left,"gc-fig-side gc-fig-l")}${fig(right,"gc-fig-side gc-fig-r")}${fig(main,"gc-fig-main")}`;
      S.artFor=S.bannerId;
    }

    /* ---------- home ---------- */
    function refresh(){
      const st=store.status(S.bannerId);
      el.classList.toggle("gc-noprofile",!st);
      const b1=q(".gc-pull-1"),b10=q(".gc-pull-10");
      b1.disabled=b10.disabled=!st;
      if(!st)return null;
      q('[data-wallet="diamonds"] b').textContent=fmt(st.diamonds);
      q('[data-wallet="dust"] b').textContent=fmt(st.starDust);
      q("[data-pity]").textContent=st.pityIn;
      q("[data-pity-bar]").style.width=`${st.sinceSsr/st.halfPity*100}%`;
      q("[data-mile]").textContent=fmt(st.mileage);
      q("[data-mile-cost]").textContent=fmt(st.mileageCost);
      q("[data-mile-bar]").style.width=`${Math.min(100,st.mileage/st.mileageCost*100)}%`;
      q('[data-act="mileage"]').disabled=!st.canExchange;
      el.classList.toggle("gc-mile-ready",st.canExchange);
      const pool=store.pool();
      q("[data-pool-text]").textContent=`SSR ${pool.SSR.length} · SR ${pool.SR.length} · R ${pool.R.length}명 등장`;
      q('[data-cost="one"]').innerHTML=costHtml(st.cost.one);b1.classList.toggle("gc-short",!st.cost.one.ok);
      const free=st.first.available;
      b10.dataset.act=free?"free":"pull10";b10.classList.toggle("gc-pull-free",free);
      b10.querySelector(".gc-pull-l").textContent=free?"첫 모집 · 10회":"10회 모집";
      q('[data-cost="ten"]').innerHTML=free?costHtml({free:true}):costHtml(st.cost.ten);
      b10.classList.toggle("gc-short",!free&&!st.cost.ten.ok);
      el.classList.toggle("gc-has-first",free);
      return st;
    }

    /* ---------- pull flow ---------- */
    function requestPull(count,free){
      if(S.busy||S.seq)return;
      const st=refresh();if(!st)return toast(REASON_TEXT.NO_PROFILE);
      if(free){if(!st.first.available)return toast(REASON_TEXT.FREE_UNAVAILABLE);return commitPull(10,true)}
      const cost=count===10?st.cost.ten:st.cost.one;
      if(!cost.ok)return openInsufficient(count,cost);
      openConfirm(count,cost,st);
    }
    function commitPull(count,free){
      if(S.busy)return;S.busy=true;
      const res=store.pull({bannerId:S.bannerId,count,free,requestId:rid()});
      if(!res?.ok){S.busy=false;closeModal();refresh();return toast(REASON_TEXT[res?.reason]||`모집 실패 (${res?.reason||"?"})`)}
      notify({kind:"PULL",txn:res.txn,profile:res.profile});
      closeModal();play(res.txn);
    }
    function play(txn){
      clearTimers();
      const results=txn.results||[];
      const best=results.reduce((b,r)=>RANK[r.rarity]>RANK[b]?r.rarity:b,"R");
      S.seq={txn,results,best,index:-1,flipped:false,splashed:new Set(),phase:"intro",acked:false,onSplashDone:null};
      preload(results.map(r=>r.id));
      if(txn.kind==="MILEAGE"){S.seq.index=0;S.seq.flipped=true;return showSplash(results[0],()=>showResults())}
      startIntro(best);
    }
    function sigText(text){q("[data-sig-text]").textContent=text}
    function startIntro(best){
      const s=S.seq;s.phase="intro";setState("intro");
      const box=q(".gc-intro");box.className="gc-screen gc-intro";void box.offsetWidth;
      sigText("신호 추적 중");
      if(reduced()){
        box.classList.add("gc-static",best==="SSR"?"gc-p-gold":best==="SR"?"gc-p-violet":"gc-p-cyan","gc-p-land");
        sigText(best==="SSR"?"고순도 공명 신호":best==="SR"?"강한 신호 감지":"신호 수신");
        return later(toReveal,700);
      }
      box.classList.add("gc-go");startFx(box);
      if(best!=="R")later(()=>{box.classList.add("gc-p-violet");sigText("강한 신호 감지")},T.violet);
      if(best==="SSR")later(()=>{box.classList.add("gc-p-gold","gc-shake");sigText("고순도 공명 신호");sfx("hit_critical")},T.gold);
      later(()=>{box.classList.add("gc-p-land");sfx("hit_core");if(best==="R")sigText("신호 수신")},T.land);
      later(toReveal,best==="SSR"?T.endSSR:T.endR);
    }
    function toReveal(){
      stopFx();clearTimers();
      const s=S.seq;if(!s)return;
      s.phase="reveal";setState("reveal");
      q("[data-dots]").innerHTML=s.results.length>1?s.results.map((r,i)=>`<li data-i="${i}"></li>`).join(""):"";
      el.classList.toggle("gc-single",s.results.length===1);
      showCard(0);
    }
    function markDot(i,value){const li=q(`[data-dots] li[data-i="${i}"]`);if(li)li.dataset.state=value}
    function showCard(i){
      const s=S.seq;s.index=i;s.flipped=false;
      const r=s.results[i],box=q(".gc-reveal");
      box.dataset.rarity=r.rarity;box.classList.remove("gc-burst");
      q("[data-count]").textContent=i+1;q("[data-total]").textContent=s.results.length;
      q("[data-card-slot]").innerHTML=cardHtml(r,"reveal");
      markDot(i,"current");
      if(reduced())return flip();
      later(flip,r.rarity==="SSR"?860:r.rarity==="SR"?560:380);
    }
    function flip(){
      const s=S.seq;if(!s||s.phase!=="reveal"||s.flipped)return;
      s.flipped=true;clearTimers();
      const r=s.results[s.index],box=q(".gc-reveal");
      q("[data-card-slot] .gc-card")?.classList.add("gc-flipped");
      void box.offsetWidth;box.classList.add("gc-burst");
      markDot(s.index,r.rarity);
      announce(`${r.rarity} ${spec(r.id).name}, ${outcomeText(r)}`);
      if(r.rarity==="SSR"&&!s.splashed.has(s.index))later(()=>{if(S.seq===s&&s.phase==="reveal")showSplash(r,afterSplash)},reduced()?350:1000);
    }
    function advance(){
      const now=performance.now();if(now-S.advanceAt<150)return;S.advanceAt=now;
      const s=S.seq;if(!s)return;
      if(s.phase==="intro")return toReveal();
      if(s.phase==="reveal"){
        if(!s.flipped)return flip();
        const r=s.results[s.index];
        if(r.rarity==="SSR"&&!s.splashed.has(s.index))return showSplash(r,afterSplash);
        return nextCard();
      }
      if(s.phase==="splash")return s.onSplashDone?.();
    }
    function nextCard(){const s=S.seq;if(s.index+1<s.results.length)showCard(s.index+1);else showResults()}
    function afterSplash(){const s=S.seq;if(!s)return;s.phase="reveal";setState("reveal");nextCard()}
    function showSplash(r,done){
      clearTimers();
      const s=S.seq;s.phase="splash";s.splashed.add(s.index);s.onSplashDone=done;
      const sp=spec(r.id),low=isLow(r.id),box=q(".gc-splash");
      box.dataset.id=r.id;box.dataset.rarity=r.rarity;
      q("[data-splash-art]").innerHTML=`<img class="gc-splash-img${low?" gc-low":""}" src="${esc(low?sp.portrait:sp.standing)}" alt="" draggable="false">`;
      q(".gc-splash-r").textContent=r.rarity;
      q("[data-splash-call]").textContent=sp.title||"";
      q("[data-splash-name]").textContent=sp.name||r.id;
      q("[data-splash-meta]").textContent=[sp.characterId,sp.factionKo,sp.typeKo].filter(Boolean).join(" · ");
      q("[data-splash-out]").innerHTML=`${badgeHtml(r)}<span>${esc(outcomeText(r))}</span>${pips(r.stars)}`;
      setState("splash");
      box.classList.remove("gc-in");void box.offsetWidth;box.classList.add("gc-in");
      const img=box.querySelector(".gc-splash-img");
      layoutSplash();if(img&&!img.complete)img.addEventListener("load",layoutSplash,{once:true});
      announce(`${r.rarity} ${sp.name} 합류. ${outcomeText(r)}`);
      sfx("ultimate");
    }
    function layoutSplash(){
      const box=q(".gc-splash"),img=box.querySelector(".gc-splash-img");if(!img)return;
      const W=box.clientWidth,H=box.clientHeight;if(!W||!H)return;
      const portrait=W/H<.8,f=fx(box.dataset.id),aspect=img.naturalWidth&&img.naturalHeight?img.naturalWidth/img.naturalHeight:(img.classList.contains("gc-low")?1:2/3);
      let h,left,top;
      if(img.classList.contains("gc-low")){h=portrait?Math.min(W*1.08,H*.64):H*.98;left=portrait?(W-h*aspect)/2:W*.67-h*aspect/2;top=portrait?H*.06:H*.04}
      else if(portrait){h=H*1.02;left=W*.5-f*h*aspect;top=-H*.01}
      else{h=H*1.26;left=W*.66-f*h*aspect;top=-H*.05}
      Object.assign(img.style,{height:`${h}px`,width:`${h*aspect}px`,left:`${left}px`,top:`${top}px`});
    }
    function showResults(){
      clearTimers();stopFx();
      const s=S.seq;if(!s)return goHome();
      s.phase="results";setState("results");
      const {txn,results}=s;
      const grid=q("[data-grid]");grid.dataset.n=results.length;
      grid.innerHTML=results.map((r,i)=>`<div class="gc-res" style="--i:${i}">${cardHtml(r,"grid")}</div>`).join("");
      const count=k=>results.filter(r=>r.rarity===k).length,news=results.filter(r=>r.outcome==="NEW").length,stars=results.filter(r=>r.outcome==="STAR").length;
      const chips=[["SSR",count("SSR")],["SR",count("SR")],["R",count("R")]].map(([k,n])=>`<span data-r="${k}">${k} <b>${n}</b></span>`);
      if(news)chips.push(`<span class="gc-sum-new">NEW <b>${news}</b></span>`);
      if(stars)chips.push(`<span class="gc-sum-star">돌파 <b>${stars}</b></span>`);
      if(txn.dust)chips.push(`<span class="gc-sum-dust">${ICON.dust} 별의 가루 <b>+${fmt(txn.dust)}</b></span>`);
      q("[data-sum]").innerHTML=chips.join("");
      const st=store.status(S.bannerId);
      const paid=txn.source==="FREE_FIRST"?"첫 모집 무료":txn.kind==="MILEAGE"?`마일리지 ${fmt(txn.cost?.mileage)} 사용`:[txn.cost?.tickets?`모집권 ${fmt(txn.cost.tickets)}장`:"",txn.cost?.diamonds?`${ICON.gem}${fmt(txn.cost.diamonds)}`:""].filter(Boolean).join(" + ")+" 사용";
      q("[data-info]").innerHTML=st?`<span>SSR 확정까지 <b>${st.pityIn}</b>회</span><span>마일리지 <b>${fmt(st.mileage)}</b> / ${fmt(st.mileageCost)}</span><span class="gc-paid">${paid}</span>`:"";
      const again=q('[data-act="again"]');
      if(txn.kind==="PULL"&&st){
        const n=txn.count===10?10:1,cost=n===10?st.cost.ten:st.cost.one;
        again.hidden=false;again.dataset.count=n;again.classList.toggle("gc-short",!cost.ok);
        again.innerHTML=`<span>다시 ${n}회 모집</span><span class="gc-pull-c">${costHtml(cost)}</span>`;
      }else again.hidden=true;
      acknowledge();
      q('[data-act="done"]').focus({preventScroll:true});
    }
    function acknowledge(){
      const s=S.seq;if(!s||s.acked)return;s.acked=true;
      const r=store.acknowledge(s.txn.id);
      if(r?.ok&&r.changed!==false)notify({kind:"ACK",txn:s.txn,profile:r.profile});
    }
    function goHome(){
      clearTimers();stopFx();acknowledge();
      S.seq=null;S.busy=false;setState("home");el.classList.remove("gc-single");refresh();
    }
    function again(btn){
      const n=Number(btn?.dataset.count)===10?10:1;
      acknowledge();S.seq=null;S.busy=false;
      requestPull(n,false);
    }

    /* ---------- intro canvas ---------- */
    function startFx(box){
      stopFx();
      const cv=box.querySelector(".gc-fx"),ctx=cv.getContext?.("2d");if(!ctx)return;
      const dpr=Math.min(2,root.devicePixelRatio||1);let W=0,H=0;
      const size=()=>{W=cv.clientWidth;H=cv.clientHeight;cv.width=Math.max(1,Math.round(W*dpr));cv.height=Math.max(1,Math.round(H*dpr));ctx.setTransform(dpr,0,0,dpr,0,0)};
      size();S.fxSize=size;
      let seed=0x9e3779b9;const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
      const N=Math.round(Math.min(150,Math.max(60,W*H/8000)));
      const parts=Array.from({length:N},()=>({x:rnd(),y:rnd(),z:.3+rnd()*.7,l:.03+rnd()*.12}));
      const t0=performance.now();let last=t0;
      const loop=now=>{
        const dt=Math.min(50,now-last)/1000,t=(now-t0)/1000;last=now;
        const speed=t<T.land/1000?2.6-.9*(t/(T.land/1000)):Math.max(.06,1.7*Math.exp(-(t-T.land/1000)*4));
        const col=box.classList.contains("gc-p-gold")?"255,206,120":box.classList.contains("gc-p-violet")?"199,155,255":"106,241,244";
        ctx.clearRect(0,0,W,H);ctx.lineCap="round";
        for(const p of parts){
          p.y-=speed*p.z*dt;if(p.y<-p.l){p.y=1+rnd()*.25;p.x=rnd()}
          const near=1-Math.min(1,Math.abs(p.x-.5)*2.2),len=p.l*H*(speed/2.6+.12);
          ctx.strokeStyle=`rgba(${col},${((.14+.6*near)*p.z).toFixed(3)})`;ctx.lineWidth=(.6+1.7*p.z)*(.6+near*.7);
          ctx.beginPath();ctx.moveTo(p.x*W,p.y*H);ctx.lineTo(p.x*W,p.y*H+len);ctx.stroke();
        }
        S.raf=requestAnimationFrame(loop);
      };
      S.raf=requestAnimationFrame(loop);
    }
    function stopFx(){if(S.raf)cancelAnimationFrame(S.raf);S.raf=0;S.fxSize=null}

    /* ---------- modals ---------- */
    function openModal({title,eyebrow="",body,foot="",cls=""}){
      const layer=q(".gc-modal-layer");
      layer.innerHTML=`<div class="gc-modal ${cls}" role="dialog" aria-modal="true" aria-labelledby="${uid}-mt">
        <header class="gc-modal-h"><div><small>${esc(eyebrow)}</small><h3 id="${uid}-mt">${esc(title)}</h3></div><button type="button" class="gc-x" data-act="modal-close" aria-label="닫기"></button></header>
        <div class="gc-modal-b">${body}</div>${foot?`<footer class="gc-modal-f">${foot}</footer>`:""}</div>`;
      layer.hidden=false;S.modal=cls||title;
      layer.querySelector(".gc-modal-f .gc-btn-main, .gc-modal-f .gc-btn-gold, .gc-x")?.focus({preventScroll:true});
    }
    function closeModal(){const layer=q(".gc-modal-layer");layer.hidden=true;layer.innerHTML="";S.modal=null;S.pick=null}
    function openConfirm(count,cost,st){
      const parts=[];
      if(cost.tickets)parts.push(`<span>${ICON.ticket}모집권 <b>${fmt(cost.tickets)}</b>장</span>`);
      if(cost.diamonds)parts.push(`<span>${ICON.gem}다이아 <b>${fmt(cost.diamonds)}</b></span>`);
      openModal({title:`${count}회 모집`,eyebrow:"RECRUIT CONFIRM",cls:"gc-sm gc-m-confirm",
        body:`<p class="gc-confirm-t">아래 재화를 사용해 <b>${count}회</b> 모집합니다.</p>
          <div class="gc-confirm-cost">${parts.join('<span class="gc-plus">+</span>')}</div>
          <p class="gc-confirm-bal">보유 다이아 ${ICON.gem}<b>${fmt(st.diamonds)}</b><span>→</span>${ICON.gem}<b>${fmt(st.diamonds-cost.diamonds)}</b></p>`,
        foot:`<button type="button" class="gc-btn gc-btn-ghost" data-act="modal-close">취소</button><button type="button" class="gc-btn gc-btn-main" data-act="confirm-pull" data-count="${count}">모집 시작</button>`});
    }
    function openInsufficient(count,cost){
      openModal({title:"다이아 부족",eyebrow:"NOT ENOUGH",cls:"gc-sm gc-m-short",
        body:`<p class="gc-confirm-t">${count}회 모집에 필요한 다이아가 부족합니다.</p>
          <div class="gc-short-grid"><span>필요</span><b>${ICON.gem}${fmt(cost.diamonds)}</b><span>보유</span><b>${ICON.gem}${fmt(cost.balance)}</b><span>부족</span><b class="gc-neg">${ICON.gem}${fmt(cost.shortBy)}</b></div>`,
        foot:`${options.onShop?'<button type="button" class="gc-btn gc-btn-ghost" data-act="shop">상점으로</button>':""}<button type="button" class="gc-btn gc-btn-main" data-act="modal-close">확인</button>`});
    }
    function openRates(){
      const t=GA.rateTable(store.pool());
      const table=rarity=>{
        const rows=t.rows.filter(r=>r.rarity===rarity);
        return `<section class="gc-rate-sec" data-r="${rarity}"><h4><b>${rarity}</b><span>${rows.length}명 · 등급 확률 ${pct(t.rarity[rarity])}</span></h4>
          <table class="gc-table"><thead><tr><th>대원</th><th class="gc-num">일반 모집</th><th class="gc-num">10번째 확정</th>${rarity==="SSR"?'<th class="gc-num">반천장</th>':""}</tr></thead><tbody>
          ${rows.map(r=>{const s=spec(r.id);return `<tr><td><b>${esc(s.name)}</b><small>${esc(s.characterId)}</small></td><td class="gc-num">${pct(r.basePercent)}</td><td class="gc-num">${r.guaranteePercent?pct(r.guaranteePercent):"—"}</td>${rarity==="SSR"?`<td class="gc-num">${pct(r.pityPercent)}</td>`:""}</tr>`}).join("")}
          </tbody></table></section>`;
      };
      openModal({title:"확률 공개",eyebrow:"RATES · 상시 모집",cls:"gc-m-rates",
        body:`<div class="gc-rate-sum">${GA.RARITIES.map(k=>`<div data-r="${k}"><b>${k}</b><span>${pct(t.rarity[k])}</span></div>`).join("")}</div>
          <ul class="gc-rules">
            <li>같은 등급 안의 대원은 모두 같은 확률로 등장합니다. 현재 픽업(확률 상승) 대원은 없습니다.</li>
            <li>10회 모집에서 1~9번째가 모두 R 등급이면 10번째는 SR 이상 확정입니다 (SR ${pct(t.guarantee.SR)} · SSR ${pct(t.guarantee.SSR)}).</li>
            <li>SSR 없이 99회 모집하면 100번째 모집은 SSR 확정입니다 (반천장). SSR을 얻으면 횟수가 초기화됩니다.</li>
            <li>모집 1회마다 마일리지 1을 얻습니다. 마일리지 ${t.mileageCost}으로 원하는 SSR 대원 1명을 교환할 수 있습니다 (천장). 마일리지는 SSR 획득으로 초기화되지 않습니다.</li>
            <li>이미 보유한 대원을 다시 얻으면 돌파 ★+1 (최대 5★, ★당 기본 공격·체력·방어 +5%). 5★ 이후에는 별의 가루를 드립니다 (SSR ${GA.STAR_DUST.SSR} · SR ${GA.STAR_DUST.SR} · R ${GA.STAR_DUST.R}).</li>
          </ul>${GA.RARITIES.map(table).join("")}`});
    }
    function openHistory(){
      const rows=store.history();
      const when=iso=>{const d=new Date(iso);if(Number.isNaN(+d))return "";const p=n=>String(n).padStart(2,"0");return `${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`};
      const body=rows.length?`<table class="gc-table gc-hist"><thead><tr><th>일시</th><th>등급</th><th>대원</th><th>결과</th><th>구분</th></tr></thead><tbody>
        ${rows.map(r=>`<tr data-r="${esc(r.rarity)}"><td class="gc-dim">${when(r.at)}</td><td><span class="gc-rchip" data-r="${esc(r.rarity)}">${esc(r.rarity)}</span></td><td><b>${esc(spec(r.id).name)}</b></td><td>${esc(outcomeText(r))}</td><td class="gc-dim">${esc(SOURCE_TEXT[r.source]||r.source||"")}</td></tr>`).join("")}
        </tbody></table>`:'<p class="gc-empty">아직 모집 기록이 없습니다.</p>';
      openModal({title:"모집 기록",eyebrow:`최근 ${GA.HISTORY_MAX}회`,cls:"gc-m-history",body});
    }
    function openDust(){
      const st=store.status(S.bannerId);if(!st)return toast(REASON_TEXT.NO_PROFILE);
      const have=st.starDust;
      openModal({title:"별의 가루 교환",eyebrow:"STAR DUST",cls:"gc-m-dust",
        body:`<div class="gc-dx-head"><span>${ICON.dust}보유 별의 가루 <b>${fmt(have)}</b></span><small>5★ 대원을 다시 얻으면 지급 · SSR ${GA.STAR_DUST.SSR} · SR ${GA.STAR_DUST.SR} · R ${GA.STAR_DUST.R}</small></div>
          <div class="gc-dx-list">${GA.DUST_EXCHANGE.map(item=>`<div class="gc-dx-row"><div class="gc-dx-i"><b>${esc(item.name)} ×${fmt(item.unit)}</b><small>${ICON.dust}${fmt(item.cost)}</small></div>
            <div class="gc-dx-b"><button type="button" class="gc-btn-s" data-act="dust-x" data-item="${esc(item.id)}" data-qty="1"${have<item.cost?" disabled":""}>교환</button><button type="button" class="gc-btn-s" data-act="dust-x" data-item="${esc(item.id)}" data-qty="10"${have<item.cost*10?" disabled":""}>×10</button></div></div>`).join("")}</div>`});
    }
    function doDust(itemId,qty){
      const r=store.exchangeDust({itemId,qty});
      if(!r?.ok)return toast(REASON_TEXT[r?.reason]||"교환 실패");
      notify({kind:"DUST",result:r,profile:r.profile});
      const item=GA.DUST_EXCHANGE.find(x=>x.id===itemId);
      toast(`${item?.name||itemId} ×${fmt((item?.unit||1)*qty)} 획득`);
      refresh();openDust();
    }
    function openMileage(){
      const st=store.status(S.bannerId);if(!st)return toast(REASON_TEXT.NO_PROFILE);
      const profile=store.view(),pool=store.pool();
      const tiles=pool.SSR.map(id=>{
        const s=spec(id),stars=GA.starsOf(profile,id);
        const status=stars===null?'<em class="gc-st-new">미보유</em>':stars>=GA.STAR_MAX?`MAX · ${ICON.dust}+${GA.STAR_DUST.SSR}`:`★${stars} → ★${stars+1}`;
        return `<button type="button" class="gc-pick-t" data-act="pick" data-id="${esc(id)}" aria-pressed="false"><span class="gc-pick-img"><img src="${esc(s.portrait)}" alt="" loading="lazy" draggable="false"></span><b>${esc(s.name)}</b><small>${status}</small></button>`;
      }).join("");
      openModal({title:"마일리지 SSR 교환",eyebrow:`MILEAGE ${st.mileageCost}`,cls:"gc-m-mileage",
        body:`<p class="gc-m-lead">마일리지 ${fmt(st.mileageCost)}으로 원하는 SSR 대원 1명을 합류시킵니다. 보유 중이면 돌파 ★+1이 적용됩니다.</p><div class="gc-pick">${tiles}</div>`,
        foot:`<span class="gc-mile-have">마일리지 <b>${fmt(st.mileage)}</b> / ${fmt(st.mileageCost)}</span><button type="button" class="gc-btn gc-btn-gold" data-act="confirm-mileage" disabled>교환</button>`});
      S.pick=null;
    }
    function pick(id){
      S.pick=id;
      for(const b of el.querySelectorAll(".gc-pick-t"))b.setAttribute("aria-pressed",String(b.dataset.id===id));
      const st=store.status(S.bannerId),btn=q('[data-act="confirm-mileage"]');
      if(btn){btn.disabled=!(st?.canExchange);btn.textContent=st?.canExchange?`${spec(id).name} 교환`:"마일리지 부족"}
    }
    function doMileage(){
      if(!S.pick||S.busy)return;S.busy=true;
      const r=store.exchangeMileage({bannerId:S.bannerId,characterId:S.pick,requestId:rid()});
      if(!r?.ok){S.busy=false;return toast(REASON_TEXT[r?.reason]||"교환 실패")}
      notify({kind:"MILEAGE",txn:r.txn,profile:r.profile});
      closeModal();play(r.txn);
    }

    /* ---------- events ---------- */
    function act(name,btn){
      switch(name){
        case "close":return close();
        case "tab":S.bannerId=btn.dataset.banner;S.artFor=null;renderTabs();renderArt();return refresh();
        case "pull1":return requestPull(1,false);
        case "pull10":return requestPull(10,false);
        case "free":return requestPull(10,true);
        case "confirm-pull":return commitPull(Number(btn.dataset.count)===10?10:1,false);
        case "modal-close":return closeModal();
        case "rates":return openRates();
        case "history":return openHistory();
        case "dust":return openDust();
        case "mileage":return openMileage();
        case "dust-x":return doDust(btn.dataset.item,Number(btn.dataset.qty)||1);
        case "pick":return pick(btn.dataset.id);
        case "confirm-mileage":return doMileage();
        case "skip":return showResults();
        case "done":return goHome();
        case "again":return again(btn);
        case "shop":closeModal();return options.onShop?.();
      }
    }
    const onClick=e=>{
      const b=e.target.closest?.("[data-act]");
      if(b&&el.contains(b)){if(b.disabled)return;e.stopPropagation();return act(b.dataset.act,b)}
      if(e.target===q(".gc-modal-layer"))return closeModal();
      if(!S.modal&&["intro","reveal","splash"].includes(el.dataset.state))advance();
    };
    // capture phase on the window: while open, the overlay owns the keyboard, so host-page shortcuts (lobby tab keys 1-5,
    // arrows, Esc handlers) never act behind it; buttons still get their default Enter/Space/Tab behaviour
    const onKey=e=>{
      if(el.hidden)return;
      e.stopPropagation();
      const st=el.dataset.state;
      if(e.key==="Escape"){e.preventDefault();if(S.modal)return closeModal();if(["intro","reveal","splash"].includes(st))return showResults();if(st==="results")return goHome();return close()}
      if((e.key==="Enter"||e.key===" ")&&!S.modal&&["intro","reveal","splash"].includes(st)&&!e.target.closest?.("button")){e.preventDefault();advance()}
    };
    const onResize=()=>{if(el.hidden)return;if(el.dataset.state==="splash")layoutSplash();S.fxSize?.()};
    const onProfile=()=>{if(!el.hidden&&el.dataset.state==="home"&&!S.busy)refresh()};
    const onStorage=e=>{if(e.key===store.key)onProfile()};
    el.addEventListener("click",onClick);
    root.addEventListener("keydown",onKey,true);
    root.addEventListener("resize",onResize);
    root.addEventListener("aftersignal:profile",onProfile);
    root.addEventListener("storage",onStorage);

    function open(){
      S.lastFocus=document.activeElement;
      el.hidden=false;setState("home");
      const ensured=store.ensure({shelterOpen:options.shelterOpen!==false});
      if(ensured?.ok&&ensured.changed!==false)notify({kind:"ENSURE",granted:Boolean(ensured.granted),profile:ensured.profile});
      renderTabs();renderArt();refresh();
      const pending=store.pendingReveal();
      if(pending){
        S.seq={txn:pending,results:pending.results||[],best:"R",index:0,flipped:true,splashed:new Set(),phase:"results",acked:false};
        preload(S.seq.results.map(r=>r.id));showResults();toast("이전 모집 결과를 불러왔습니다");
      }else q(".gc-back").focus({preventScroll:true});
      return api;
    }
    function close(){
      closeModal();acknowledge();clearTimers();stopFx();
      S.seq=null;S.busy=false;el.hidden=true;setState("home");
      try{S.lastFocus?.focus?.({preventScroll:true})}catch{}
      try{options.onClose?.()}catch{}
      return api;
    }
    function destroy(){
      clearTimers();stopFx();clearTimeout(toastTimer);
      el.removeEventListener("click",onClick);
      root.removeEventListener("keydown",onKey,true);root.removeEventListener("resize",onResize);
      root.removeEventListener("aftersignal:profile",onProfile);root.removeEventListener("storage",onStorage);
      el.remove();
    }
    const api=Object.freeze({el,open,close,destroy,refresh,store,
      // QA / harness hooks (no side effects beyond what the buttons do)
      _qa:Object.freeze({state:()=>({state:el.dataset.state,phase:S.seq?.phase||null,index:S.seq?.index??null,modal:S.modal}),advance,skip:()=>showResults(),play,openRates,openHistory,openDust,openMileage,pick})});
    return api;
  }

  root.AfterSignalGachaUI=Object.freeze({version:VERSION,mount,FACE_X});
})(typeof window!=="undefined"?window:globalThis);
