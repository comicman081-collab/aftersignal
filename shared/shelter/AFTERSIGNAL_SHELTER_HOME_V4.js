/* AFTER SIGNAL — Shelter HOME V4 (2026-09-26): featured crew hero for the shelter home ("대기실").
   - Shows the chosen featured crew member's standing art with a nameplate; ‹ › (or ← →) cycles through unlocked crew,
     "대원 정보" opens that member's existing crew-detail view through the roster card.
   - Stores only the featured id (localStorage aftersignal:lobby-featured:v1); the save profile is not touched.
   - Measures the real top bar / bottom nav heights (ResizeObserver, no timers) so the home grid never hides under them.
   - 4.1.0: the idle relay supply is a compact chip that opens a modal <dialog> holding the runtime-filled claim block.
   - 4.2.0: 빠른 보급 (quick supply: 2 h of relay supply, 8 per day, free then 50..350 다이아) section in that popup.
   - 4.3.0: GACHA_RECRUIT_V1 — featured crew = owned (recruited) characters; no crew -> 첫 모집 nameplate.
   Loaded after AFTERSIGNAL_SHELTER_RUNTIME_V2.js and AFTERSIGNAL_LIVE_SERVICE_UI_V1.js. */
(()=>{
  "use strict";
  const home=document.getElementById("home");
  if(!home||!home.classList.contains("home-v4"))return;
  const SHELTER=window.AfterSignalShelter;
  const KEY="aftersignal:lobby-featured:v1";
  // horizontal centre of the face in each standing image (fraction of the image width), measured from the art's alpha
  // (head band 3-9 % of the figure height, 2026-09-26). Unknown characters fall back to the image centre.
  const FACE_X={mira:.5,haneul:.538,sera:.567,astra:.4,tessa:.462,naru:.488,karin:.418,serin:.497,luna:.422,arin:.45,jaein:.466,roa:.45,noella:.535,ria:.403,bomin:.452,orin:.507,yunseo:.508,yura:.52,yeonhwa:.49,narae:.471,moa:.471,yumi:.516,sion:.469,haejin:.442,eve:.537,sea:.491,seorin:.502,lumi:.382,iona:.586,somi:.457,mei:.483,yuria:.505,soha:.451,liora:.43,bella:.466,dana:.577,chaerin:.474,yujin:.442,harin:.5,dabin:.407};
  const $=id=>document.getElementById(id);
  const profile=()=>window.__AFTERSIGNAL_SHELTER_QA__?.profile;
  const read=()=>{try{return localStorage.getItem(KEY)}catch{return null}};
  const write=id=>{try{localStorage.setItem(KEY,id)}catch{}};
  let token=0;

  // GACHA_RECRUIT_V1 (4.3.0): once the save has a recruit block the crew is the runtime's OWNED list; it can be empty,
  // and then the nameplate becomes the 첫 모집 call to action (the hero keeps the shelter's standing art as backdrop)
  function recruitCrew(){const rt=window.AfterSignalShelterRuntime;try{return rt?.recruitMode?.()?rt.crewIds():null}catch{return null}}
  const noCrew=()=>{const owned=recruitCrew();return Boolean(owned&&!owned.length)};
  const openRecruit=()=>window.__AFTERSIGNAL_GACHA_LOBBY__?.open?.();
  function crew(){
    const owned=recruitCrew();if(owned)return owned.length?owned:["mira"];
    const p=profile(),chars=SHELTER?.characters||{};
    const list=(p?.unlockedCharacterIds||["mira"]).filter(id=>chars[id]&&p?.characters?.[id]?.unlocked!==false);
    return list.length?list:["mira"];
  }
  function current(){const list=crew(),id=read();return list.includes(id)?id:list[0]}
  function paint(id,animate){
    const spec=SHELTER?.characters?.[id]||SHELTER?.characters?.mira;if(!spec)return;
    const list=crew(),img=$("homeHero"),plate=$("homeFeatured");
    if(plate&&noCrew()){
      plate.dataset.rarity="";plate.dataset.single="true";plate.dataset.empty="true";
      $("homeFeaturedRarity").textContent="";$("homeFeaturedCode").textContent="RELAY RECRUIT · 대원 모집";
      $("homeFeaturedName").textContent="보유 대원 없음";$("homeFeaturedRole").textContent="대원 모집에서 첫 대원을 영입하세요";
      $("homeFeaturedCount").textContent="0 / 0";if($("homeFeaturedInfo"))$("homeFeaturedInfo").textContent="첫 모집 ›";
    }else if(plate){
      delete plate.dataset.empty;if($("homeFeaturedInfo")&&$("homeFeaturedInfo").textContent!=="대원 정보 ›")$("homeFeaturedInfo").textContent="대원 정보 ›";
      plate.dataset.rarity=spec.rarity||"";plate.dataset.single=String(list.length<2);
      $("homeFeaturedRarity").textContent=spec.rarity||"";
      $("homeFeaturedCode").textContent=`${spec.characterId} · ${spec.factionKo||spec.faction||""}`;
      $("homeFeaturedName").textContent=spec.name;
      $("homeFeaturedRole").textContent=[spec.typeKo,spec.formation,spec.title].filter(Boolean).join(" · ");
      $("homeFeaturedCount").textContent=`${Math.max(1,list.indexOf(id)+1)} / ${list.length}`;
    }
    if(!img)return;
    const apply=()=>{
      home.style.setProperty("--head-x",String(FACE_X[id]??.5));
      if(img.getAttribute("src")!==spec.standing)img.src=spec.standing;
      img.alt=`대표 대원 ${spec.name} 스탠딩 일러스트`;
      if(animate){img.classList.remove("hv-swap");void img.offsetWidth;img.classList.add("hv-swap")}
    };
    if(!animate||img.getAttribute("src")===spec.standing)return apply();
    const mine=++token,next=new Image();next.src=spec.standing;
    (next.decode?next.decode():Promise.resolve()).catch(()=>{}).then(()=>{if(mine===token)apply()});
  }
  function step(delta){
    const list=crew();if(list.length<2)return;
    const next=list[(list.indexOf(current())+delta+list.length)%list.length];
    write(next);paint(next,true);
  }
  function openDetail(){
    if(noCrew())return openRecruit();
    const card=document.querySelector(`#rosterGrid [data-character="${current()}"]`);
    if(card)card.click();else document.querySelector('.bottom-nav [data-nav="roster"]')?.click();
  }

  const topbar=document.querySelector(".topbar"),nav=document.querySelector(".bottom-nav");
  function measure(){
    if(topbar)home.style.setProperty("--hv-top",Math.round(topbar.getBoundingClientRect().height)+"px");
    if(nav)home.style.setProperty("--hv-bot",Math.round(nav.getBoundingClientRect().height)+"px");
  }
  if(window.ResizeObserver){const observer=new ResizeObserver(measure);if(topbar)observer.observe(topbar);if(nav)observer.observe(nav)}
  else addEventListener("resize",measure);
  measure();

  home.querySelectorAll("[data-hf-step]").forEach(button=>button.addEventListener("click",()=>step(Number(button.dataset.hfStep))));
  $("homeFeaturedInfo")?.addEventListener("click",openDetail);
  document.addEventListener("keydown",event=>{
    if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;
    if(!home.classList.contains("active")||event.ctrlKey||event.metaKey||event.altKey||event.target?.closest?.("input,textarea,select"))return;
    if($("lockLayer")?.classList.contains("show")||$("weaponModal")?.classList.contains("open"))return;
    event.preventDefault();step(event.key==="ArrowLeft"?-1:1);
  });
  paint(current(),false);

  /* Idle relay supply (2026-09-26 follow-up): home shows one compact chip (#homeIdleOpen); the runtime-filled
     #homeIdle block (pending, info, progress, claim) lives in the #homeIdleDialog popup. The chip mirrors the runtime's
     values through MutationObservers, so it follows the runtime's own renders (15 s refresh, claim) with no new timer. */
  const chip=$("homeIdleOpen"),dialog=$("homeIdleDialog"),idle=$("homeIdle");
  let openIdle=()=>{},closeIdle=()=>{};
  if(chip&&dialog&&idle){
    const pending=$("homeIdlePending"),info=$("homeIdleInfo"),bar=$("homeIdleProgress"),claim=$("homeIdleClaim");
    const chipAmount=$("homeIdleChipAmount"),chipState=$("homeIdleChipState"),chipBar=$("homeIdleChipProgress");
    const hours=$("homeIdleHours"),stats=$("homeIdleStats"),result=$("homeIdleResult"),closeButton=dialog.querySelector(".hid-close");
    const LABEL={"시간당":"시간당 생산","보유":"보유 보급","효율":"생산 효율"};
    const setText=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value};
    const setAttr=(node,name,value)=>{if(node&&node.getAttribute(name)!==value)node.setAttribute(name,value)};

    /* 빠른 보급 (quick supply, 2026-09-26): the rules, the day state and the claim live in the runtime
       (window.AfterSignalShelterRuntime -> AFTERSIGNAL_SHELTER_QUICK_SUPPLY_V1.js); this block only draws them.
       A paid use needs a second press within 4 s ("다이아 N 사용 · 확인"); the free first use of the day does not.
       It redraws from mirror() (every runtime renderIdle, incl. its existing 15 s refresh) and after each press. */
    const quick=$("homeQuick"),quickClaim=$("homeQuickClaim"),quickLabel=$("homeQuickLabel"),quickCost=$("homeQuickCost");
    const quickGrant=$("homeQuickGrant"),quickLeft=$("homeQuickLeft"),quickNote=$("homeQuickNote");
    const runtime=()=>window.AfterSignalShelterRuntime;
    const fmt=value=>Number(value||0).toLocaleString("ko-KR");
    const resetText=ms=>{const m=Math.max(1,Math.ceil((Number(ms)||0)/60000)),h=Math.floor(m/60);return h?`${h}시간 ${m%60}분`:`${m}분`};
    const QUICK_FAIL={LIMIT:"오늘 빠른 보급을 모두 사용했습니다",DIAMONDS:"다이아가 부족합니다",COST_CHANGED:"비용이 바뀌었습니다. 다시 확인해 주세요",NO_RATE:"지금은 받을 보급이 없습니다"};
    let confirmCost=null,confirmTimer=0,busyTimer=0;
    function clearConfirm(){confirmCost=null;clearTimeout(confirmTimer);confirmTimer=0}
    function renderQuick(){
      let s=null;try{s=runtime()?.quickSupplyStatus?.()||null}catch{s=null}
      if(!quick||!quickClaim)return s;
      if(!s){quick.hidden=true;return null}
      if(quick.hidden)quick.hidden=false;
      if(confirmCost!==null&&(confirmCost!==s.cost||!s.available))clearConfirm();
      const state=s.left<=0?"limit":!s.available?"short":confirmCost!==null?"confirm":s.free?"free":"paid";
      if(quick.dataset.state!==state)quick.dataset.state=state;
      setText(quickGrant,`+${fmt(s.grant)} P`);
      setText(quickLeft,`남은 횟수 ${s.left}/${s.max}`);
      setText(quickLabel,state==="confirm"?`다이아 ${fmt(s.cost)} 사용 · 확인`:state==="limit"?"오늘 모두 사용":"빠른 보급");
      const costKey=s.cost===null?"none":String(s.cost);
      if(quickCost&&quickCost.dataset.cost!==costKey){quickCost.dataset.cost=costKey;quickCost.innerHTML=s.cost===null?"—":s.free?"무료":`<i class="af-gem" aria-hidden="true"></i>${fmt(s.cost)}`}
      const reset=`초기화까지 ${resetText(s.resetInMs)}`;
      setText(quickNote,state==="limit"?`매일 ${s.max}회 · ${reset}`
        :state==="short"?(s.reason==="DIAMONDS"?`다이아 부족 · 필요 ${fmt(s.cost)} / 보유 ${fmt(s.diamonds)}`:QUICK_FAIL[s.reason]||"지금은 사용할 수 없습니다")
        :state==="confirm"?`한 번 더 누르면 다이아 ${fmt(s.cost)} 사용 · 보유 ${fmt(s.diamonds)}`
        :`보유 다이아 ${fmt(s.diamonds)} · ${reset}`);
      const disabled=state==="limit"||state==="short";
      if(quickClaim.disabled!==disabled)quickClaim.disabled=disabled;
      setAttr(quickClaim,"aria-label",state==="confirm"?`다이아 ${fmt(s.cost)} 사용 확인, 2시간분 ${fmt(s.grant)} P 받기`
        :state==="free"?`빠른 보급 무료로 받기, 2시간분 ${fmt(s.grant)} P`
        :state==="paid"?`빠른 보급 다이아 ${fmt(s.cost)} 사용, 2시간분 ${fmt(s.grant)} P`
        :`빠른 보급 사용 불가, ${quickNote?.textContent||""}`);
      return s;
    }
    // a claim can disable the focused button; keep keyboard focus inside the popup (one-shot, after the runtime render)
    function rescueFocus(){requestAnimationFrame(()=>{if(!dialog.open)return;const a=document.activeElement;if(a&&a!==document.body&&dialog.contains(a)&&!a.disabled)return;(quickClaim&&!quickClaim.disabled&&!quick?.hidden?quickClaim:closeButton)?.focus()})}

    let lastInfo=null;
    function mirror(){
      const qs=renderQuick(),idleReady=idle.dataset.ready==="true",freeQuick=Boolean(qs&&qs.available&&qs.free),ready=idleReady||freeQuick;
      const amount=pending?.textContent||"0",width=bar?.style.width||"0%",state=idleReady?"받기 가능":freeQuick?"무료 보급":"누적 중";
      if(chip.dataset.ready!==String(ready))chip.dataset.ready=String(ready);
      setText(chipAmount,amount);setText(chipState,state);
      const label=`방치 보급 ${amount} P, ${state}. 열기`;
      if(chip.getAttribute("aria-label")!==label)chip.setAttribute("aria-label",label);
      if(chipBar&&chipBar.style.width!==width)chipBar.style.width=width;
      const h=Math.max(0,Math.min(72,(parseFloat(width)||0)*.72));
      setText(hours,`${h<10?h.toFixed(1):Math.round(h)} / 72시간`);
      const text=(info?.textContent||"").trim();
      if(stats&&text!==lastInfo){
        lastInfo=text;
        const parts=text?text.split(" · ").map(part=>part.trim()).filter(Boolean).map(part=>{const m=part.match(/^(시간당|보유|효율)\s+(.+)$/);return m?[LABEL[m[1]],m[2]]:["상태",part]}):[];
        stats.replaceChildren(...parts.map(([key,value])=>{const row=document.createElement("div"),dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=key;dd.textContent=value;row.append(dt,dd);return row}));
        stats.hidden=!parts.length;idle.classList.toggle("hid-parsed",parts.length>0);
      }
    }
    const observer=new MutationObserver(mirror);
    observer.observe(idle,{attributes:true,attributeFilter:["data-ready"]});
    if(pending)observer.observe(pending,{childList:true,characterData:true,subtree:true});
    if(info)observer.observe(info,{childList:true,characterData:true,subtree:true});
    if(bar)observer.observe(bar,{attributes:true,attributeFilter:["style"]});
    mirror();
    // the runtime's toast sits under the modal backdrop, so the claim result is echoed inside the popup
    const toastNode=$("toast");
    if(toastNode&&result)new MutationObserver(()=>{if(dialog.open){delete result.dataset.kind;setText(result,toastNode.textContent||"")}}).observe(toastNode,{childList:true,characterData:true,subtree:true});
    claim?.addEventListener("click",rescueFocus); // the runtime's own onclick (claimIdle) runs first
    quickClaim?.addEventListener("click",()=>{
      if(quickClaim.getAttribute("aria-busy")==="true")return;
      const s=renderQuick();if(!s||!s.available)return;
      if(!s.free&&confirmCost!==s.cost){ // first press on a paid use: ask for a confirming second press
        confirmCost=s.cost;clearTimeout(confirmTimer);confirmTimer=setTimeout(()=>{confirmTimer=0;confirmCost=null;renderQuick()},4000);
        renderQuick();return;
      }
      clearConfirm();
      let outcome=null;try{outcome=runtime().claimQuickSupply(s.cost)}catch{outcome={ok:false,reason:"ERROR"}}
      quickClaim.setAttribute("aria-busy","true");clearTimeout(busyTimer);busyTimer=setTimeout(()=>{quickClaim.removeAttribute("aria-busy")},400);
      if(outcome?.ok)delete result.dataset.kind; // the runtime's toast text is echoed into the result line
      else{result.dataset.kind="error";setText(result,QUICK_FAIL[outcome?.reason]||"빠른 보급을 처리하지 못했습니다")}
      renderQuick();rescueFocus();
    });
    openIdle=()=>{
      if(dialog.open||!home.classList.contains("active"))return;
      clearConfirm();
      try{(window.AfterSignalShelterRuntime||window.__AFTERSIGNAL_SHELTER_QA__)?.render?.()}catch{} // fresh values on open (renderIdle via renderShop)
      mirror();setText(result,"");delete result.dataset.kind;
      if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","");
      (claim&&!claim.disabled?claim:quickClaim&&!quickClaim.disabled&&!quick?.hidden?quickClaim:closeButton)?.focus();
    };
    closeIdle=()=>{if(dialog.open)dialog.close()};
    chip.addEventListener("click",openIdle);
    closeButton?.addEventListener("click",closeIdle);
    let downOnBackdrop=false;
    dialog.addEventListener("pointerdown",event=>{downOnBackdrop=event.target===dialog});
    dialog.addEventListener("click",event=>{if(event.target===dialog&&downOnBackdrop)closeIdle();downOnBackdrop=false});
    // keep keys inside the popup: the runtime's 1-5 tab keys and the home arrow keys must not act behind it (Esc still closes)
    dialog.addEventListener("keydown",event=>event.stopPropagation());
    dialog.addEventListener("close",()=>{if(confirmCost!==null){clearConfirm();renderQuick()}if(home.classList.contains("active"))chip.focus({preventScroll:true})});
    new MutationObserver(()=>{if(!home.classList.contains("active"))closeIdle()}).observe(home,{attributes:true,attributeFilter:["class"]});
  }
  window.__AFTERSIGNAL_SHELTER_HOME_V4__=Object.freeze({version:"4.3.0",current,crew,step,openDetail,refresh:()=>paint(current(),false),openIdle:()=>openIdle(),closeIdle:()=>closeIdle()});
})();
