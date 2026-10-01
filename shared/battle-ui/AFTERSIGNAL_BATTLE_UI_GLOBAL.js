(()=>{
  "use strict";
  const root=document.documentElement;
  // CSS contract remains 1.3-compatible; runtime behavior is upgraded to 1.7.
  root.dataset.afBattleUi="1.3";
  const stage=document.body?.dataset.afStage||root.dataset.afStage||"UNKNOWN";
  const one=(s,p=document)=>p.querySelector(s);
  const all=(s,p=document)=>[...p.querySelectorAll(s)];
  const make=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!=null)e.textContent=text;return e};
  const CUTSCENE_KEY="aftersignal:cutscene-enabled";
  const CUTIN_REGISTRY={
    mira:{id:"mira",characterName:"미라 보스",title:"고요한 지평선",composite:"../assets/final_2p5d_v066/cutscenes/SSR-01_MIRA_VOSS_ULTIMATE_CUTSCENE_1280x720.webp",subtitle:"GLOBAL SHIELD DEPLOYMENT"},
    haneul:{id:"haneul",characterName:"하늘-7",title:"제로 컨테미네이션",composite:"../assets/final_2p5d_v066/cutscenes/SSR-02_HANEUL_7_ULTIMATE_CUTSCENE_1280x720.webp",subtitle:"PURIFICATION FLECHETTE FIELD"}
  };
  const cutinCache=new Map();
  const preloadCutinSource=source=>{
    if(!source)return Promise.reject(new Error("cut-in source is empty"));
    if(cutinCache.has(source))return cutinCache.get(source);
    const promise=new Promise((resolve,reject)=>{
      const image=new Image();image.decoding="async";image.onload=()=>resolve(image);image.onerror=()=>reject(new Error(`cut-in load failed: ${source}`));image.src=source;
      if(image.complete&&image.naturalWidth)resolve(image);
    });
    cutinCache.set(source,promise);return promise;
  };
  const preloadCharacterCutin=character=>{
    const entry=CUTIN_REGISTRY[character];
    return entry?preloadCutinSource(entry.composite):Promise.resolve(null);
  };
  Object.keys(CUTIN_REGISTRY).forEach(preloadCharacterCutin);
  const readCutscene=()=>{
    try{const saved=localStorage.getItem(CUTSCENE_KEY);if(saved!==null)return saved!=="0"}catch{}
    try{const value=parent.__AFTERSIGNAL_SETTINGS__?.cutsceneEnabled;if(typeof value==="boolean")return value}catch{}
    return true;
  };
  let cutsceneEnabled=readCutscene();
  const syncCutsceneToggle=()=>{
    const button=one("#cutsceneToggle");if(!button)return;
    button.classList.toggle("on",cutsceneEnabled);
    button.setAttribute("aria-pressed",String(cutsceneEnabled));
    button.textContent=cutsceneEnabled?"C · CUT-IN ON":"C · CUT-IN OFF";
  };
  const setCutsceneEnabled=value=>{
    cutsceneEnabled=Boolean(value);
    try{localStorage.setItem(CUTSCENE_KEY,cutsceneEnabled?"1":"0")}catch{}
    try{parent.__AFTERSIGNAL_SETTINGS__={...(parent.__AFTERSIGNAL_SETTINGS__||{}),cutsceneEnabled}}catch{}
    try{if(parent!==window)parent.postMessage({type:"aftersignal:cutscene-setting",enabled:cutsceneEnabled},"*")}catch{}
    syncCutsceneToggle();
    if(!cutsceneEnabled)closeBurst(one("#afBurstCutin"));
    return cutsceneEnabled;
  };
  function ensureCutsceneToggle(){
    let button=one("#cutsceneToggle");if(button){syncCutsceneToggle();return{button,created:false}}
    const viewport=one(".viewport")||one("#viewport")||document.body;
    button=make("button","cutscene-toggle","C · CUT-IN ON");button.id="cutsceneToggle";button.type="button";
    button.setAttribute("aria-label","필살기 컷인 켜기 또는 끄기");viewport.append(button);syncCutsceneToggle();
    button.addEventListener("click",()=>setCutsceneEnabled(!cutsceneEnabled));
    return{button,created:true};
  }
  const fillAmmo=(ammo,mag,shown,reloading)=>{
    if(!ammo)return;
    mag=Math.max(1,Number(mag)||8);shown=Math.max(0,Math.min(mag,Number(shown)||0));
    ammo.style.setProperty("--cols",String(mag));
    while(ammo.children.length<mag)ammo.append(make("i"));
    while(ammo.children.length>mag)ammo.lastElementChild.remove();
    [...ammo.children].forEach((slot,index)=>slot.classList.toggle("empty",index>=shown));
    ammo.classList.toggle("reloading",Boolean(reloading));
  };
  function normalizeCommon(){
    one(".battle-topbar")?.classList.add("topbar");
    one(".operation-title")?.classList.add("mission");
    all(".fire-toggle,.tactical-auto").forEach(e=>e.classList.add("toggle"));
    one(".command-feed")?.classList.add("feed");
    all(".overlay .primary").forEach(e=>e.classList.add("start"));
  }
  function normalizeLegacy(){
    const squad=one("#squadStatus");
    if(!squad||squad.classList.contains("party"))return;
    const portrait=one("#burstPortrait");
    const ultimate=one("#ultimateButton");
    const oldHealth=one("#playerHealth");
    const oldAmmo=one("#ammoHud");
    const side=one("#ultimateSideToggle");
    squad.className="party legacy-party";
    squad.setAttribute("aria-label","미라 보스 전투 상태");
    const unit=make("article","unit active");unit.dataset.unit="0";unit.tabIndex=0;
    const img=make("img","af-unit-portrait");img.src=portrait?.src||"";img.alt="미라 보스 얼굴";
    unit.append(img,make("small","","1 · SUPPORT / REAR"),make("strong","","미라 보스"),make("span","selected-note","CONTROL"));
    const bars=make("div","bars");
    const hp=make("div","bar hp af-hp"),hpFill=make("i");hp.append(hpFill);
    const shield=make("div","bar shield af-shield"),shieldFill=make("i");shield.append(shieldFill);bars.append(hp,shield);unit.append(bars);
    const ammo=make("div","ammo af-ammo");ammo.dataset.mag="8";ammo.setAttribute("aria-label","미라 보스 잔탄");unit.append(ammo);
    if(ultimate){ultimate.classList.remove("unit-burst");ultimate.classList.add("ult","legacy-ult");unit.append(ultimate)}
    squad.append(unit);
    oldHealth?.classList.add("af-legacy-hidden");oldAmmo?.classList.add("af-legacy-hidden");side?.classList.add("af-legacy-hidden");
    fillAmmo(ammo,8,8,false);
  }
  function normalizeHierarchy(){
    const viewport=one(".viewport")||one("#viewport");
    if(!viewport)return;
    // Critical combat HUD layers are siblings of the canvas. A missing close
    // tag must never be allowed to trap the party HUD inside .locks/.feed.
    const fixed=[".topbar",".feed",".locks",".party",".toast",".cutin",".af-burst-cutin",".overlay"];
    fixed.forEach(selector=>all(selector,viewport).forEach(node=>{
      if(node.parentElement!==viewport)viewport.append(node);
    }));
  }
  function ensureBurstCutin(){
    let node=one("#afBurstCutin");
    if(node)return node;
    const viewport=one(".viewport")||one("#viewport")||document.body;
    node=make("section","af-burst-cutin");node.id="afBurstCutin";node.setAttribute("aria-hidden","true");
    node.innerHTML='<img class="af-burst-composite" alt=""><div class="af-burst-grid"></div><div class="af-burst-ring af-burst-ring-a"></div><div class="af-burst-ring af-burst-ring-b"></div><div class="af-burst-streaks"></div><div class="af-burst-flare"></div><div class="af-burst-scan"></div><div class="af-burst-copy"><small>ULTIMATE SIGNAL</small><b></b><span></span></div>';
    viewport.append(node);return node;
  }
  let burstTimer=0;
  let burstRequest=0;
  const closeBurst=node=>{
    if(!node)return;
    node.classList.remove("show");
    node.setAttribute("aria-hidden","true");
  };
  window.AfterSignalBurstCutin=Object.freeze({
    version:"1.8",
    show({character="mira",name="",subtitle="",duration=1550}={}){
      if(!cutsceneEnabled)return false;
      const request=++burstRequest,registered=CUTIN_REGISTRY[character]||{};
      const composite=registered.composite||"";
      subtitle=subtitle||registered.subtitle||"";
      if(!composite){console.error(`[AFTER SIGNAL] ${character} has no baked standing-art ultimate illustration`);return false}
      const node=ensureBurstCutin();
      node.dataset.character=character;
      const art=one(".af-burst-composite",node);
      closeBurst(node);node.classList.add("loading");
      if(art){art.src=composite;art.alt=`${registered.characterName||character} 스탠딩 일러스트가 포함된 완성형 필살기 컷신`}
      const title=one(".af-burst-copy b",node),sub=one(".af-burst-copy span",node);
      if(title)title.textContent=name||registered.title||registered.characterName||character;if(sub)sub.textContent=subtitle;
      const reveal=()=>{
        if(request!==burstRequest||!cutsceneEnabled)return;
        node.classList.remove("loading","show");void node.offsetWidth;node.classList.add("show");node.setAttribute("aria-hidden","false");
        clearTimeout(burstTimer);burstTimer=setTimeout(()=>closeBurst(node),duration);
        node.addEventListener("animationend",()=>closeBurst(node),{once:true});
      };
      Promise.race([preloadCutinSource(composite).catch(()=>null),new Promise(resolve=>setTimeout(resolve,420))]).then(reveal);
      return true;
    },
    hide(){burstRequest++;closeBurst(one("#afBurstCutin"))},
    preload:preloadCharacterCutin,
    register(character,entry){if(!character||!entry?.composite)throw new Error("Every playable character needs a baked standing-art ultimate composite");CUTIN_REGISTRY[character]={id:character,...entry};preloadCharacterCutin(character);return true},
    registry:()=>structuredClone(CUTIN_REGISTRY)
  });
  normalizeCommon();normalizeLegacy();normalizeHierarchy();ensureBurstCutin();
  const cutsceneControl=ensureCutsceneToggle();
  if(cutsceneControl.created)window.addEventListener("keydown",event=>{
    if(event.code!=="KeyC"||event.repeat)return;event.preventDefault();cutsceneControl.button.click();
  });
  // A result overlay always owns the interaction layer.  Cut-ins must never
  // survive a rotation or cover the operation-complete action.
  all(".overlay").forEach(overlay=>new MutationObserver(()=>{
    if(!overlay.classList.contains("hidden"))window.AfterSignalBurstCutin.hide();
  }).observe(overlay,{attributes:true,attributeFilter:["class"]}));
  window.addEventListener("orientationchange",()=>{
    normalizeHierarchy();
    if(all(".overlay").some(overlay=>!overlay.classList.contains("hidden")))window.AfterSignalBurstCutin.hide();
  });
  window.AfterSignalBattleUI=Object.freeze({
    version:"1.8",stage,normalizeHierarchy,
    cutsceneEnabled:()=>cutsceneEnabled,
    setCutsceneEnabled,
    syncCutsceneToggle,
    syncLegacy(state={}){
      const hp=Number(state.hp),maxHp=Math.max(1,Number(state.maxHp)||1),shield=Number(state.shield),maxShield=Math.max(1,Number(state.maxShield)||1);
      one(".af-hp i")?.style.setProperty("--v",`${Math.max(0,Math.min(100,hp/maxHp*100))}%`);
      one(".af-shield i")?.style.setProperty("--v",`${Math.max(0,Math.min(100,shield/maxShield*100))}%`);
      const ammo=one(".af-ammo");fillAmmo(ammo,state.mag,state.ammo,state.reloading);
      if(ammo)ammo.setAttribute("aria-label",`미라 보스 잔탄 ${Math.max(0,Number(state.ammo)||0)} / ${Math.max(1,Number(state.mag)||8)}${state.reloading?" · 재장전 중":""}`);
      const ult=one("#ultimateButton");if(ult){ult.style.setProperty("--u",String(Number(state.burst)||0));ult.classList.toggle("ready",Number(state.burst)>=100)}
    },
    refreshAmmo:fillAmmo
  });
})();
