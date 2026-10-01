/* AFTER SIGNAL — recruit (대원 모집) wiring for the shelter lobby V1 (2026-09-26, GACHA_RECRUIT_V1).
   - Home chip #homeRecruit (첫 모집 무료 10회 / 첫 모집 / SSR 교환 가능 / SSR 확정 n회) and every [data-recruit-open]
     control (roster toolbar, 미보유 cards, empty-roster card, home nameplate) open the recruit screen
     (AFTERSIGNAL_GACHA_UI_V1.js over AFTERSIGNAL_GACHA_V1.js).
   - After every committed pull / exchange the shelter re-reads the shared profile (syncFromFoundation) so the top-bar
     다이아 chip shows the new balance and no page ever writes an old balance back.
   - While the recruit screen is open the lobby behind it is inert and the screen owns the keyboard (tab keys 1-5 and
     arrows do nothing behind it), like the idle-supply <dialog>.
   - 출격 편성 (repeat-operation formation): a native <dialog> listing OWNED characters only; up to 5, saved to the
     foundation PartyLoadout slot of stage P-99, which the live service uses for every repeat-operation launch.
   - Sound: existing shell cues only (hit_critical / hit_core / ultimate) through the shell's aftersignal:sfx message.
   Only one-shot toast timeouts (no repeating timer). Loaded after AFTERSIGNAL_SHELTER_HOME_V4.js. */
(()=>{
  "use strict";
  const G=window.AfterSignalGacha,UI=window.AfterSignalGachaUI,SHELTER=window.AfterSignalShelter;
  const home=document.getElementById("home");
  if(!G||!UI||!SHELTER||!home)return;
  const VERSION="1.0.0";
  const $=id=>document.getElementById(id);
  const runtime=()=>window.AfterSignalShelterRuntime;
  const embedded=parent!==window;
  const roster=SHELTER.characters;
  const store=G.createStore({roster,economy:window.AfterSignalDiamondEconomy});
  const fmt=n=>Math.max(0,Math.floor(Number(n)||0)).toLocaleString("ko-KR");
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const locked=()=>$("lockLayer")?.classList.contains("show");
  const sfx=cue=>{if(embedded)try{parent.postMessage({type:"aftersignal:sfx",cue},"*")}catch{}};
  let ui=null,inertNodes=[],toastTimer=0,lastOpener=null;

  function toast(text){const node=$("toast");if(!node)return;node.textContent=text;node.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove("show"),2100)}

  /* ---------- shelter refresh after a commit ---------- */
  function sync(){
    try{runtime()?.syncFromFoundation?.()}catch(error){console.warn("[recruit] shelter sync",error)}
    try{window.__AFTERSIGNAL_SHELTER_HOME_V4__?.refresh?.()}catch{}
    renderChip();
  }

  /* ---------- home chip ---------- */
  function chipState(){
    const st=store.status("standard");
    if(!st)return {state:"off",label:"상시 모집",badge:"RECRUIT",aria:"대원 모집 열기"};
    if(st.first.available)return {state:"free",label:"첫 모집",badge:"무료 10회",aria:"첫 모집 무료 10회. 대원 모집 열기"};
    if(!st.ownedCount)return {state:"first",label:"첫 모집",badge:"대원 0명",aria:"보유 대원이 없습니다. 대원 모집 열기"};
    if(st.canExchange)return {state:"mileage",label:"상시 모집",badge:"SSR 교환 가능",aria:`마일리지 ${st.mileage}, SSR 교환 가능. 대원 모집 열기`};
    return {state:"normal",label:"상시 모집",badge:`SSR 확정 ${st.pityIn}회`,aria:`SSR 확정까지 ${st.pityIn}회. 대원 모집 열기`};
  }
  function renderChip(){
    const chip=$("homeRecruit");if(!chip)return;
    const s=chipState();
    if(chip.dataset.state!==s.state)chip.dataset.state=s.state;
    const label=$("homeRecruitLabel"),badge=$("homeRecruitBadge");
    if(label&&label.textContent!==s.label)label.textContent=s.label;
    if(badge&&badge.textContent!==s.badge)badge.textContent=s.badge;
    if(chip.getAttribute("aria-label")!==s.aria)chip.setAttribute("aria-label",s.aria);
  }

  /* ---------- recruit screen ---------- */
  function setInert(on){
    if(on){inertNodes=[document.querySelector("main.app"),$("weaponModal")].filter(node=>node&&!node.inert);for(const node of inertNodes)node.inert=true}
    else{for(const node of inertNodes)node.inert=false;inertNodes=[]}
  }
  function mountUi(){
    if(ui)return ui;
    ui=UI.mount(document.body,{store,roster,economy:window.AfterSignalDiamondEconomy,sfx,shelterOpen:true,
      onCommitted:()=>sync(),
      onClose:()=>{setInert(false);sync();const back=lastOpener&&document.contains(lastOpener)?lastOpener:$("homeRecruit");lastOpener=null;try{back?.focus({preventScroll:true})}catch{}}});
    return ui;
  }
  function open(){
    if(locked())return null;
    if(!store.view()){toast("저장 데이터를 찾을 수 없습니다. 메인 스토리를 먼저 진행하세요.");return null}
    for(const dialog of document.querySelectorAll("dialog[open]"))dialog.close();
    lastOpener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const instance=mountUi();
    setInert(true);
    try{instance.open()}catch(error){setInert(false);console.warn("[recruit] open",error);return null}
    return instance;
  }
  function close(){if(ui&&!ui.el.hidden)ui.close()}

  /* ---------- 출격 편성 (owned only) ---------- */
  let formation=null,picked=[];
  function formationDialog(){
    if(formation)return formation;
    formation=document.createElement("dialog");
    formation.className="gcl-formation";
    formation.setAttribute("aria-labelledby","gclFormationTitle");
    formation.innerHTML=`<div class="gcl-f-panel">
  <header class="gcl-f-head"><h2 id="gclFormationTitle">출격 편성 <small>REPEAT OPERATIONS</small></h2><button type="button" class="gcl-f-x" data-f="close" aria-label="출격 편성 닫기">✕</button></header>
  <p class="gcl-f-note">반복 작전(신호 소탕전·위협체 요격·릴레이 타워·무신호 구역·전술 시뮬레이션)에 출격할 대원입니다. <b>보유 대원만</b> 최대 5명까지 편성할 수 있습니다. 메인 스토리 전투는 스토리 분대가 출격합니다.</p>
  <ol class="gcl-f-slots" aria-label="편성 슬롯"></ol>
  <div class="gcl-f-grid" role="group" aria-label="보유 대원"></div>
  <footer class="gcl-f-foot"><p class="gcl-f-msg" role="status" aria-live="polite"></p><button type="button" class="gcl-f-btn" data-f="auto">자동 편성</button><button type="button" class="gcl-f-btn" data-f="clear">비우기</button><button type="button" class="gcl-f-btn gcl-f-main" data-f="save">저장</button></footer>
</div>`;
    document.body.append(formation);
    formation.addEventListener("keydown",event=>event.stopPropagation()); // lobby tab keys / arrows must not act behind it
    let downOnBackdrop=false;
    formation.addEventListener("pointerdown",event=>{downOnBackdrop=event.target===formation});
    formation.addEventListener("click",event=>{
      if(event.target===formation&&downOnBackdrop){downOnBackdrop=false;return formation.close()}
      downOnBackdrop=false;
      const button=event.target.closest?.("[data-f],[data-f-pick],[data-f-slot]");if(!button||button.disabled)return;
      if(button.dataset.f==="close")return formation.close();
      if(button.dataset.f==="auto"){picked=G.defaultParty(store.view(),{roster,max:5});return renderFormation()}
      if(button.dataset.f==="clear"){picked=[];return renderFormation()}
      if(button.dataset.f==="save")return saveFormation();
      if(button.dataset.fSlot!==undefined){const id=picked[Number(button.dataset.fSlot)];if(id){picked=picked.filter(x=>x!==id);renderFormation()}return}
      if(button.dataset.fPick){const id=button.dataset.fPick;if(picked.includes(id))picked=picked.filter(x=>x!==id);else if(picked.length<5)picked=[...picked,id];else return toastIn("편성은 최대 5명입니다");renderFormation()}
    });
    formation.addEventListener("close",()=>{const opener=$("rosterGrid")?.previousElementSibling?.querySelector?.("[data-formation-open]");try{opener?.focus({preventScroll:true})}catch{}});
    return formation;
  }
  let msgTimer=0;
  function toastIn(text){const node=formation?.querySelector(".gcl-f-msg");if(!node)return;node.textContent=text;clearTimeout(msgTimer);msgTimer=setTimeout(()=>{node.textContent=""},1900)}
  function thumb(id){const s=roster[id]||{};return `<img src="${esc(s.portrait||"")}" alt="" loading="lazy" draggable="false">`}
  function stars(n){return `<span class="gcl-stars" aria-label="한계 돌파 ${n}단계">${[1,2,3,4,5].map(i=>`<i${i<=n?' class="on"':""}></i>`).join("")}</span>`}
  function renderFormation(){
    const p=store.view();if(!p||!formation)return;
    const owned=G.ownedInOrder(p,{roster}).filter(id=>roster[id]);
    picked=picked.filter(id=>owned.includes(id)).slice(0,5);
    formation.querySelector(".gcl-f-slots").innerHTML=Array.from({length:5},(_,slot)=>{const id=picked[slot],s=id?roster[id]:null;return s
      ?`<li><button type="button" class="gcl-f-slot" data-f-slot="${slot}" data-rarity="${esc(s.rarity)}" aria-label="${slot+1}번 슬롯 ${esc(s.name)} 빼기">${thumb(id)}<span class="gcl-f-no">${slot+1}</span><b>${esc(s.name)}</b></button></li>`
      :`<li><span class="gcl-f-slot gcl-f-empty" aria-label="${slot+1}번 슬롯 비어 있음"><span class="gcl-f-no">${slot+1}</span><b>비어 있음</b></span></li>`}).join("");
    formation.querySelector(".gcl-f-grid").innerHTML=owned.length?owned.map(id=>{const s=roster[id],at=picked.indexOf(id);return `<button type="button" class="gcl-f-card" data-f-pick="${esc(id)}" data-rarity="${esc(s.rarity)}" aria-pressed="${at>=0}">${thumb(id)}${at>=0?`<span class="gcl-f-at">${at+1}</span>`:""}<span class="gcl-f-meta"><em>${esc(s.rarity)}</em><b>${esc(s.name)}</b>${stars(G.starsOf(p,id)||0)}</span></button>`}).join("")
      :`<p class="gcl-f-none">보유 대원이 없습니다. <button type="button" class="gcl-f-btn gcl-f-main" data-recruit-open="formation">대원 모집</button></p>`;
    const save=formation.querySelector('[data-f="save"]');save.disabled=!picked.length;
    formation.querySelector('[data-f="auto"]').disabled=!owned.length;formation.querySelector('[data-f="clear"]').disabled=!picked.length;
  }
  function saveFormation(){
    const result=store.saveFormation(picked);
    if(!result?.ok){toastIn(result?.reason==="NO_PROFILE"?"저장 데이터를 찾을 수 없습니다":"저장하지 못했습니다");return}
    formation.close();toast(`출격 편성 저장 · ${result.snapshot.characterIds.filter(Boolean).length}명`);
  }
  function openFormation(){
    if(locked())return null;
    const state=store.formation();if(!state){toast("저장 데이터를 찾을 수 없습니다.");return null}
    const dialog=formationDialog();picked=[...state.party];renderFormation();
    if(!dialog.open){if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","")}
    dialog.querySelector(".gcl-f-card,[data-f='close']")?.focus({preventScroll:true});
    return dialog;
  }

  /* ---------- entry points ---------- */
  document.addEventListener("click",event=>{
    const recruit=event.target.closest?.("[data-recruit-open]");
    if(recruit&&!recruit.closest(".gc-root")){event.preventDefault();if(formation?.open)formation.close();open();return}
    const form=event.target.closest?.("[data-formation-open]");
    if(form){event.preventDefault();openFormation()}
  });
  $("homeRecruit")?.addEventListener("click",()=>open());
  // a repeat-operation launch with no owned character (live service): explain and offer the recruit screen
  addEventListener("aftersignal:recruit-required",()=>{toast("출격할 보유 대원이 없습니다. 대원 모집에서 대원을 영입하세요.");renderChip()});
  // another tab or page changed the save: keep the chip honest (the recruit screen refreshes itself)
  addEventListener("storage",event=>{if(event.key===store.key)renderChip()});
  addEventListener("aftersignal:profile",()=>renderChip());
  new MutationObserver(()=>{if(home.classList.contains("active"))renderChip()}).observe(home,{attributes:true,attributeFilter:["class"]});
  renderChip();
  // the first free recruit is announced once per page load (the grant itself happened in the runtime's boot)
  if(!locked()&&chipState().state==="free")setTimeout(()=>toast("첫 모집 보상 · 무료 10회 모집이 준비되었습니다"),900);

  window.__AFTERSIGNAL_GACHA_LOBBY__=Object.freeze({version:VERSION,store,open,close,openFormation,closeFormation:()=>formation?.open&&formation.close(),renderChip,ui:()=>ui,chipState});
  addEventListener("pagehide",()=>{clearTimeout(toastTimer);clearTimeout(msgTimer)},{once:true});
})();
