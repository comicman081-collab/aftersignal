/* COMBAT_FULLSCREEN_V1: landscape battles cover the whole window (see game_bake_v1/tools/runtime_patches/combat_fullscreen_v1.py). */
(() => {
  // Only combat pages load this runtime (often from <head>, before the canvas exists), so inject unconditionally.
  const style=document.createElement("style");style.id="af-combat-fullscreen-v1";
  style.textContent=`@media (orientation:landscape){html,body{width:100%!important;height:100%!important;overflow:hidden!important}.app,.game-shell,#viewport,.viewport{position:relative!important;width:100vw!important;height:100vh!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;aspect-ratio:auto!important;margin:0!important;overflow:hidden!important;box-shadow:none!important}#game,#battle{position:absolute!important;left:50%!important;top:50%!important;right:auto!important;bottom:auto!important;width:max(100vw,177.78vh)!important;height:max(100vh,56.25vw)!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;transform:translate(-50%,-50%)!important;object-fit:fill!important}}`;
  // Sera now uses a face-framed HUD portrait (SERA_HUD_2026_09_23, tools/make_sera_presentation.py); the old 1.7x zoom
  // rule was written for her full standing image and cropped the new portrait to the top of her hair.
  style.textContent+=`#af-common-party button[data-character-id="sera"] .af-portrait-frame>img[src*="SERA_HUD_"]{object-position:50% 18%!important;transform:none!important}`;
  (document.head||document.documentElement).append(style);
})();
/* Shared production combat runner. Stage differences enter through Foundation data/hooks only. */
(() => {
  "use strict";
  const F=window.AfterSignalFoundation;
  if(!F) throw new Error("AfterSignalFoundation must load before common combat runtime");
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  let currentRunner=null;
  // Keep the in-field cast clearly below the enemy bands and readable as a
  // formation, rather than letting the source canvas dimensions make one
  // character dominate another.  Character identity belongs in the art; the
  // combat station owns one shared presentation scale.
  // Character-body scale, independent from the authored image canvas.  The
  // previous .78 authority made the seated silhouettes dominate the lower
  // field even though their canvas transforms were stable.  .66 preserves the
  // established foot stations while restoring enemy-field depth and spacing.
  const PLAYER_RENDER_SCALE=.66;
  // Perceived character size is owned by the dense body authority, never by
  // the authored canvas, transparent crop, raised weapon or coat tails. 168
  // source-equivalent units x the orientation presentation scale below gives
  // the seated body height. Every character and every FIRE/COVER/RELOAD pose
  // resolves to this same body height, eliminating the visible grow/shrink
  // regression.
  const PLAYER_BODY_AUTHORITY_UNITS=168;
  // BATTLE SCALE V1 (2026-09-23, user request): the former ~95 px seated body
  // (.86 landscape / .62 portrait) was too small to read on PC and phones.
  // Landscape now presents a ~160 px body on the 1280x720 field (~22% of the
  // screen height); portrait keeps five squad slots readable without heavy
  // overlap. Near ground-band mobs grow with the squad; mid/aerial mobs keep
  // their size so tall flyers stay clear of the top HUD; bosses keep their
  // authored renderSize.
  const PLAYER_PRESENTATION_LANDSCAPE=1.45,PLAYER_PRESENTATION_PORTRAIT=.84;
  const playerBodyPx=player=>PLAYER_BODY_AUTHORITY_UNITS*PLAYER_RENDER_SCALE*(player?.presentationScale||1);
  const ENEMY_BAND_SCALE=Object.freeze({background1:1.3,background2:1,background3:1});
  const enemyBandScale=(runner,enemy)=>{const k=ENEMY_BAND_SCALE[enemy?.renderLayer||enemy?.spec?.depthBand||"background1"]??1;return runner?.__afPortrait?1+(k-1)*.35:k;};
  // COMBAT_CAMPAIGN_V1 (2026-09-27): campaign pages name their stage with data-af-stage-id (e.g. CH01-07).
  const stageIdFromBody=body=>body.dataset.afStageId?String(body.dataset.afStageId):`P-${String(body.dataset.afStage||"").replace(/^P/,"").padStart(2,"0")}`;
  // These four strips are the PASS-reviewed, pixel-exact semantic conversion of
  // the authored 3072x960 composites. Placement is top-to-bottom reconstruction;
  // gameplay baselines use the named semantic zones, never an array index guess.
  const FOUR_LAYER_ROOT="../assets/stage_backgrounds_4layer/Prologue";
  // These raster ultimates passed local compositing QA and GPT Pro actual-frame
  // review on 2026-08-17. They are lazy-loaded on first cast so production does
  // not retain all three decoded surfaces before a character uses an ultimate.
  const ULTIMATE_VFX_ASSETS=Object.freeze({
    mira:"../assets/vfx_ultimate_v1/final/MIRA_PRISMATIC_SANCTUARY.webp",
    haneul:"../assets/vfx_ultimate_v1/final/HANEUL_CRYSTALLINE_EXECUTION.webp",
    sera:"../assets/vfx_ultimate_v1/final/SERA_MAGENTA_LANCE.webp"
  });
  // GPT Pro visual-review contract. These remain QA-only until staged combat
  // screenshots pass visual review; production URLs never enable them.
  const ULTIMATE_VFX_COMPOSITE_PROFILES=Object.freeze({
    // Layer authority is intentionally character-specific.  A shared tinted
    // ring was the regression: Mira reads through shield panels/arcs, Haneul
    // through nested triangles/ice spears, and Sera through an asymmetric lance.
    mira:Object.freeze({supportOpacity:.25,debrisOpacity:.35,primaryOpacity:.61,accentOpacity:.49,coreOpacity:.245,maxWidthLandscape:.47,maxWidthPortrait:.61,maxFieldHeight:.50,impactAnchorUV:Object.freeze([.5,.5]),centerOffsetY:0,knockoutRadius:.16,knockoutMultiply:.30,charge:.18,bloom:.21,impact:.09,decay:.30}),
    haneul:Object.freeze({supportOpacity:.15,debrisOpacity:.43,primaryOpacity:.68,accentOpacity:.70,coreOpacity:.22,maxWidthLandscape:.45,maxWidthPortrait:.60,maxFieldHeight:.52,impactAnchorUV:Object.freeze([.5,.5]),centerOffsetY:-.035,knockoutRadius:.17,knockoutMultiply:.25,charge:.22,bloom:.22,impact:.09,decay:.36}),
    sera:Object.freeze({supportOpacity:0,debrisOpacity:.21,primaryOpacity:.46,accentOpacity:0,coreOpacity:.715,maxWidthLandscape:.46,maxWidthPortrait:.60,maxFieldHeight:.46,impactAnchorUV:Object.freeze([.35,.72]),centerOffsetY:.035,knockoutRadius:.135,knockoutMultiply:.35,charge:.14,bloom:.15,impact:.08,decay:.28})
  });
  const ultimateVfxProfile=characterId=>{const profile=ULTIMATE_VFX_COMPOSITE_PROFILES[characterId]||ULTIMATE_VFX_COMPOSITE_PROFILES.mira;return profile.total?profile:{...profile,total:profile.charge+profile.bloom+profile.impact+profile.decay};};
  const fourLayerSet=(stem,compositeSha256)=>Object.freeze({compositeSha256,layers:Object.freeze([
    Object.freeze({semantic:"LAYER4_AERIAL",source:`${FOUR_LAYER_ROOT}/${stem}_LAYER4_AERIAL.webp`,placementY:0}),
    Object.freeze({semantic:"LAYER3_MID",source:`${FOUR_LAYER_ROOT}/${stem}_LAYER3_MID.webp`,placementY:240}),
    Object.freeze({semantic:"LAYER2_GROUND",source:`${FOUR_LAYER_ROOT}/${stem}_LAYER2_GROUND.webp`,placementY:480}),
    Object.freeze({semantic:"LAYER1_CHARACTER",source:`${FOUR_LAYER_ROOT}/${stem}_LAYER1_CHARACTER.webp`,placementY:720})
  ])});
  const P01_BACKGROUND=fourLayerSet("P-01_LUMEN_OUTER_RUINS","48e25bc05c415adf744b8d0891e72249e37822caa75fb9445be240657cca97b6");
  const P02_BACKGROUND=fourLayerSet("P-02_FLOODED_UNDERPASS","ab239d68a55cd76d1ad8339f1e5de99de034fce58dca6d886bc591ce72349f46");
  const P03_BACKGROUND=fourLayerSet("P-03_NO_SIGNAL_WATCH","68781415d27502d011d5f62878969223765b9cd802d84e3dc58e4a9c5f1881e2");
  const P04_BACKGROUND=fourLayerSet("P-04_COLLAPSED_RELAY","ab7ac67045a57718054711e0bf48828ffc85f1f030bf630e5ef103de2a3ebdce");
  const STAGE_BACKGROUND_LAYERS=Object.freeze({
    "P-01":P01_BACKGROUND,
    "P-02":P02_BACKGROUND,
    "P-04":P04_BACKGROUND,
    "P-06":P03_BACKGROUND,
    "P-07":P03_BACKGROUND,
    "P-08":P04_BACKGROUND,
    "P-09":P04_BACKGROUND,
    "P-14":P03_BACKGROUND,
    "P-99":P04_BACKGROUND
  });
  class CommonCombatRunner {
    constructor({body=document.body}={}){
      if(window.__AF_COMBAT_RUNTIME_OWNER__&&window.__AF_COMBAT_RUNTIME_OWNER__!=="COMMON")throw new Error(`COMBAT_RUNTIME_OWNERSHIP_CONFLICT:${this.stageId}`);window.__AF_COMBAT_RUNTIME_OWNER__="COMMON";window.__AF_LEGACY_EXECUTION_ATTEMPTS__=window.__AF_LEGACY_EXECUTION_ATTEMPTS__||0;this.body=body;this.stageId=stageIdFromBody(body);const devPartyIds=String(body.dataset.afDevParty||"").split(",").map(id=>id.trim()).filter(Boolean),devSessionOptions=devPartyIds.length?{unlockedCharacterIds:devPartyIds,partyCharacterIds:devPartyIds}:{};this.devOnly=devPartyIds.length>0;this.session=F.CombatSession.create({stageId:this.stageId,...devSessionOptions}).start();this.canvas=document.querySelector("#game,#battle");if(!this.canvas)throw new Error(`Common combat canvas missing for ${this.stageId}`);this.ctx=this.canvas.getContext("2d");this.width=this.canvas.width||1280;this.height=this.canvas.height||720;this.pointer={x:this.width*.72,y:this.height*.35,down:false};this.images=new Map();this.memory={requestedSources:0,loadedSources:0,failedSources:0,decodedBytesEstimate:0,releasedSources:0,releasedDecodedBytesEstimate:0};this.running=false;this.disposed=false;this.rafId=0;this.last=0;this.auto=true;this.wave=0;this.waveContributors=new Set();this.integrity=this.session.battleSpec.environment.integrity?{...this.session.battleSpec.environment.integrity,value:this.session.battleSpec.environment.integrity.initial}:null;this.enemies=[];this.projectiles=[];this.enemyProjectiles=[];this.impacts=[];this.incomingImpacts=[];this.damageNumbers=[];this.ultimateFx=[];this.ultimateSequence=null;this.hitStop=0;this.camera=0;this.debug={enabled:false,fps:0,frameMs:0};this.completed=false;this.rewardCommitted=false;this.lifecyclePauses=new Set();this.lifecycleWasRunning=false;this.qa={activeCombatLoopCount:0,commonCollisionResolver:1,legacyCollisionResolver:0,legacyRewardCommitter:0,victoryEventCount:0,defeatEventCount:0,rewardCommitCount:0,nextStageCommitCount:0,duplicateReward:0,bossPhaseDoubleTrigger:0,bossPhaseSkip:0,enemyDamageEventCount:0,eventTrace:[]};const initialPresentationScale=matchMedia("(orientation: portrait)").matches?PLAYER_PRESENTATION_PORTRAIT:PLAYER_PRESENTATION_LANDSCAPE,rules=this.session.battleSpec.rules||{},reviveCharges=Math.max(0,Number(rules.reviveChargesPerMember)||0);this.players=this.session.partySpec.slots.map((slot,index)=>{if(!slot.spec)return null;const magazineSize=Math.max(1,Number(slot.spec.combatTiming?.magazineSize)||12);return{slot:index,spec:slot.spec,member:this.session.party.members[index],x:this.width*.5+(index-(F.MAX_PARTY_SIZE-1)/2)*154,y:this.session.deployment.playerBaseline,cooldown:0,coverRequested:false,coverClock:0,reloadClock:0,magazineSize,ammo:magazineSize,presentationScale:initialPresentationScale,reviveCharges,reviveClock:0};});this.installUi();this.loadAssets();this.spawnWave();this.spawnConfiguredBoss();this.frame=this.frame.bind(this);
    }
    backgroundLayers(){const requested=this.body?.dataset.afBackgroundStage,external=typeof window!=="undefined"?window.__AF_STAGE_BACKGROUND_LAYERS__?.[this.stageId]?.layers:null;/* COMBAT_CAMPAIGN_V1 */return external||STAGE_BACKGROUND_LAYERS[requested]?.layers||STAGE_BACKGROUND_LAYERS[this.stageId]?.layers||[];}
    backgroundSources(){return this.backgroundLayers().map(layer=>layer.source);}
    listen(target,type,handler,options){if(!target?.addEventListener||typeof handler!=="function")return handler;target.addEventListener(type,handler,options);(this.__afBoundListeners||(this.__afBoundListeners=[])).push({target,type,handler,options});return handler;}
    schedule(callback,delay){const timer=setTimeout(()=>{this.__afPendingTimeouts?.delete(timer);if(!this.disposed)callback();},delay);(this.__afPendingTimeouts||(this.__afPendingTimeouts=new Set())).add(timer);return timer;}
    scheduleIdle(callback,{timeout=250,fallbackDelay=32}={}){const pending=this.__afPendingIdleCallbacks||(this.__afPendingIdleCallbacks=new Set()),record={kind:typeof requestIdleCallback==="function"?"idle":"timeout",handle:0},run=deadline=>{pending.delete(record);if(!this.disposed)callback(deadline)};record.handle=record.kind==="idle"?requestIdleCallback(run,{timeout}):setTimeout(()=>run({timeRemaining:()=>4,didTimeout:false}),fallbackDelay);pending.add(record);return record;}
    loadAssets(){const playerSources=this.session.partySpec.slots.flatMap(slot=>{const spec=slot.spec,clips=spec?.combatClips||{},sources=[spec?.battleSprite,clips.STAND,clips.AIM,clips.COVER_HOLD,clips.RELOAD,...(clips.FIRE_DIRECTIONAL_FRAMES||[])];if(clips.FIRE_DIRECTIONAL_PREFIX&&clips.FIRE_DIRECTIONAL_FRAME_COUNT)for(let index=1;index<=clips.FIRE_DIRECTIONAL_FRAME_COUNT;index++)sources.push(`${clips.FIRE_DIRECTIONAL_PREFIX}${String(index).padStart(3,"0")}.webp`);if(clips.FIRE_PREFIX&&clips.FIRE_FRAME_COUNT)for(let index=1;index<=clips.FIRE_FRAME_COUNT;index++)sources.push(`${clips.FIRE_PREFIX}${String(index).padStart(3,"0")}.webp`);return sources;}),enemySources=[...this.session.battleSpec.waves.flatMap(wave=>wave.enemyIds||[]),this.session.battleSpec.boss?.id].flatMap(id=>{const spec=F.ENEMY_REGISTRY.get(id);return [spec?.asset,...Object.values(spec?.motionAssets||{})]});[...this.backgroundSources(),...playerSources,...enemySources].filter(Boolean).forEach(src=>{if(this.images.has(src))return;const image=new Image();image.onload=()=>{if(image.__afCounted)return;image.__afCounted=true;this.memory.loadedSources++;this.memory.decodedBytesEstimate+=Math.max(0,image.naturalWidth*image.naturalHeight*4);this.publishRuntimeQa(0);};image.onerror=()=>{this.memory.failedSources++;this.publishRuntimeQa(0);};image.src=src;this.images.set(src,image);this.memory.requestedSources++;});}
    drawBackground(ctx){const layers=this.backgroundLayers(),sourceHeight=960,scaleY=this.height/sourceHeight;let rendered=0;layers.forEach(layer=>{const image=this.images.get(layer.source);if(!image?.complete||!image.naturalWidth)return;const y=layer.placementY*scaleY,nextY=(layer.placementY+240)*scaleY;ctx.drawImage(image,0,y,this.width,nextY-y+1);rendered++;});if(rendered===layers.length&&rendered)return;const field=ctx.createLinearGradient(0,0,0,this.height);field.addColorStop(0,"#182942");field.addColorStop(.54,"#26394d");field.addColorStop(1,"#060c13");ctx.fillStyle=field;ctx.fillRect(0,0,this.width,this.height);}
    installUi(){
      this.ultimateAuto=!new URLSearchParams(location.search).has("qaManualUltimate");this.qaHoldUltimatePeak=new URLSearchParams(location.search).has("qaHoldUltimatePeak");
      this.timeLimitMs=Math.max(0,Number(this.session.battleSpec.rules?.timeLimitMs)||0);this.timeRemainingMs=this.timeLimitMs;
      const combatHudStyle=document.createElement("style");
      combatHudStyle.textContent=`#af-common-party .af-ammo,#af-common-party .af-ammo-text{display:none!important}#af-common-party button{padding-bottom:31px!important}#af-common-party .af-bars{left:56px!important;right:6px!important;bottom:17px!important;height:14px!important;display:grid!important;grid-template-columns:18px minmax(34px,1fr) 43px!important;gap:4px!important;align-items:center!important}#af-common-party .af-hp-label,#af-common-party .af-hp-text{font:900 8px/1 ui-monospace;color:#effff5;font-style:normal;text-shadow:0 1px 2px #000;white-space:nowrap}#af-common-party .af-hp-text{text-align:right}#af-common-party .af-hp{height:8px!important;border-color:#9fffc299!important;box-shadow:0 0 7px #39e99855}#af-common-party .af-hp>u{background:linear-gradient(90deg,#19d979,#b9ff9a)!important}#af-common-party button.low-hp .af-hp{border-color:#ff9d9d!important;box-shadow:0 0 8px #ff456c88}#af-common-party button.low-hp .af-hp>u{background:linear-gradient(90deg,#ff3c67,#ffb35b)!important}#af-common-party .af-bullets{position:absolute;left:56px;right:6px;bottom:5px;height:7px;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(2px,1fr);gap:2px;align-items:stretch}#af-common-party .af-bullets>i{display:block;min-width:2px;border-radius:3px 3px 1px 1px;background:linear-gradient(90deg,#55c8ff,#fff3a4);box-shadow:0 0 5px #55d8ff88}#af-common-party .af-bullets>i.spent{background:#152633;box-shadow:none;opacity:.42}#af-common-actions [data-ultimate].ready{border-color:#ffe798;background:linear-gradient(120deg,#5c235f,#173f67);color:#fff4b5;box-shadow:0 0 18px #ff85dc77}[data-af-standing-cutin="true"] img{left:4%!important;right:auto!important;bottom:0!important;width:46%!important;height:96%!important;max-height:96%!important;object-fit:contain!important;object-position:center bottom!important;transform:none!important}@media(max-aspect-ratio:4/5){#af-common-party button{padding-bottom:29px!important}#af-common-party .af-bars{left:42px!important;right:3px!important;bottom:15px!important;grid-template-columns:14px minmax(24px,1fr) 35px!important;gap:2px!important}#af-common-party .af-hp-label,#af-common-party .af-hp-text{font-size:6px}#af-common-party .af-bullets{left:42px;right:3px;bottom:4px;height:6px;gap:1px}[data-af-standing-cutin="true"] img{left:-4%!important;width:62%!important;height:88%!important}}`;
      combatHudStyle.textContent+=`#af-battle-timer{position:absolute;z-index:48;left:50%;top:max(68px,env(safe-area-inset-top));transform:translateX(-50%);min-width:82px;padding:6px 10px;border:1px solid #87e7f5aa;background:#04101bdc;color:#eaffff;font:900 17px/1 ui-monospace;text-align:center;letter-spacing:.08em;box-shadow:0 0 14px #4ee7ff33;pointer-events:none}#af-battle-timer:before{content:"TIME ";font-size:8px;color:#9bdbe6;vertical-align:3px}#af-battle-timer.warning{border-color:#ffd875;color:#fff2a8;box-shadow:0 0 18px #ffbd4f66}#af-battle-timer.critical{border-color:#ff6d84;color:#fff;animation:afTimerPulse .7s steps(2,end) infinite}@keyframes afTimerPulse{50%{background:#4a0b1de8}}@media(max-aspect-ratio:4/5){#af-battle-timer{top:max(62px,env(safe-area-inset-top));font-size:14px;min-width:70px;padding:5px 7px}}`;
      combatHudStyle.textContent+=`#cutin,#ultimateCutin,.ultimate-cutin{inset:clamp(150px,27vh,220px) auto auto 2%!important;width:min(360px,33%)!important;height:min(250px,38%)!important;place-items:stretch!important;overflow:hidden!important;border:1px solid #bcefffaa!important;border-left:4px solid #fff0ac!important;border-radius:0 16px 16px 0!important;background:linear-gradient(118deg,rgba(3,10,20,.94),rgba(21,16,43,.91))!important;box-shadow:0 0 28px rgba(74,211,255,.24)!important;clip-path:none!important;transform:none!important;pointer-events:none!important}#cutin.show,#ultimateCutin.show,.ultimate-cutin.show{display:block!important;animation:afBoundedCutin .52s ease-out both!important}#cutin img,#ultimateCutin img,.ultimate-cutin img{left:0!important;bottom:0!important;width:54%!important;height:100%!important;max-height:100%!important;object-fit:contain!important;object-position:center bottom!important;transform:none!important;clip-path:none!important}#cutin div,#ultimateCutin div,.ultimate-cutin div{position:absolute!important;z-index:2!important;left:49%!important;right:4%!important;top:18%!important;margin:0!important;max-width:none!important;align-self:auto!important;justify-self:auto!important;text-align:left!important;font-size:clamp(9px,1.1vw,13px)!important;line-height:1.35!important;overflow:hidden!important}#cutin b,#ultimateCutin b,.ultimate-cutin b{font-size:clamp(15px,1.9vw,26px)!important;letter-spacing:-.04em!important}@keyframes afBoundedCutin{0%{opacity:0;transform:translateX(-18px)}18%,74%{opacity:1;transform:none}100%{opacity:0;transform:translateX(8px)}}@media(max-aspect-ratio:4/5){#cutin,#ultimateCutin,.ultimate-cutin{left:2%!important;top:clamp(205px,29vh,275px)!important;bottom:auto!important;width:36%!important;height:28%!important;min-height:150px!important}#cutin img,#ultimateCutin img,.ultimate-cutin img{width:58%!important}#cutin div,#ultimateCutin div,.ultimate-cutin div{left:51%!important;top:14%!important;font-size:8px!important}#cutin b,#ultimateCutin b,.ultimate-cutin b{font-size:13px!important}}`;
      document.head.append(combatHudStyle);
      this.body.dataset.afCommonCombatActive="v1";this.body.dataset.afCommonRuntimeBuild="2026-08-16-dual-orientation-depth-v4";const legacyParty=document.querySelector(".party");if(legacyParty){legacyParty.hidden=true;legacyParty.setAttribute("aria-hidden","true");legacyParty.style.setProperty("display","none","important");}
      const style=document.createElement("style");style.textContent=`#af-common-party{position:absolute;z-index:40;left:2%;right:2%;bottom:max(12px,env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;pointer-events:none}#af-common-party button{min-height:82px;position:relative;text-align:left;padding:7px 7px 20px 56px;background:#07121ce8;border:1px solid #6dc1d966;color:#eafcff;overflow:hidden;pointer-events:auto}#af-common-party button.active{border-color:#fff0b5;box-shadow:inset 0 0 18px #ffb74a44}#af-common-party img{position:absolute;left:3px;top:3px;width:49px;height:62px;object-fit:cover;object-position:center 14%}#af-common-party small,#af-common-party b{display:block}#af-common-party small{font:700 8px/1.3 ui-monospace;color:#a4c6d0}#af-common-party b{font-size:12px}#af-common-party i{font:700 8px ui-monospace;color:#ffdfa0}#af-common-party .af-bars{position:absolute;left:56px;right:6px;bottom:4px;height:13px;display:grid;grid-template-columns:1fr 1fr 34px;gap:3px;align-items:center}#af-common-party .af-meter{height:5px;background:#02070d;border:1px solid #ffffff2b;overflow:hidden}#af-common-party .af-meter>u{display:block;height:100%;width:100%;transform-origin:left center;transition:transform .12s linear}#af-common-party .af-hp>u{background:linear-gradient(90deg,#36df8b,#a7ffb4)}#af-common-party .af-ammo>u{background:linear-gradient(90deg,#55c8ff,#fff3a4)}#af-common-party .af-ammo-text{font:800 7px ui-monospace;color:#f3fbff;text-align:right;white-space:nowrap}#af-common-actions{position:absolute;z-index:46;right:2%;bottom:110px;display:flex;gap:6px}#af-common-actions button{min-width:92px;min-height:42px;border:1px solid #7de8ef;background:#071621e8;color:#eaffff;font:800 10px ui-monospace;letter-spacing:.08em}#af-common-actions button.active{background:#164552;border-color:#fff4ae;color:#fff4ae}img[data-af-canonical-character="mira"],.af-face-portrait[src*="MIRA_HUD_2026_09_23"]{object-fit:cover!important;object-position:center 18%!important}#af-common-party img[src*="SERA_FLINT_EXPOSURE_STAND"]{object-fit:cover!important;object-position:center 4%!important;transform:scale(3.05);transform-origin:center 7%}@media(max-aspect-ratio:4/5){#af-common-party{left:1%;right:1%;gap:3px}#af-common-party button{min-height:68px;padding:5px 3px 17px 42px}#af-common-party img{width:36px;height:55px}#af-common-party b{font-size:9px}#af-common-party .af-bars{left:42px;right:3px;grid-template-columns:1fr 1fr 26px;gap:2px}#af-common-party .af-ammo-text{font-size:6px}#af-common-actions{right:1%;bottom:92px}#af-common-actions button{min-width:72px;min-height:40px;font-size:9px}}`;document.head.append(style);
      const portraitSafetyStyle=document.createElement("style");portraitSafetyStyle.textContent=`#af-common-party .af-portrait-frame{position:absolute;left:3px;top:3px;width:49px;height:62px;overflow:hidden;background:linear-gradient(145deg,#102633,#030911);contain:paint}#af-common-party .af-portrait-frame>img{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;object-fit:cover!important;object-position:50% 18%!important;transform:none!important}#af-common-party button[data-character-id="haneul"] .af-portrait-frame>img{object-position:50% 24%!important}#af-common-party button[data-character-id="sera"] .af-portrait-frame>img{object-position:50% 10%!important;transform:scale(1.7)!important;transform-origin:50% 10%!important}@media(max-aspect-ratio:4/5){#af-common-party .af-portrait-frame{left:2px;top:2px;width:36px;height:55px}}@media(max-height:500px) and (orientation:landscape){#af-common-party .af-portrait-frame{left:3px;top:3px;width:30px;height:46px}}@media(orientation:portrait){#af-common-party .af-portrait-frame{left:2px!important;top:2px!important;width:34px!important;height:54px!important}}`;document.head.append(portraitSafetyStyle);
      const hud=document.createElement("nav");hud.id="af-common-party";hud.setAttribute("aria-label","5-slot PartyRuntime HUD");this.canvas.parentElement?.append(hud);this.hud=hud;this.renderHud();const runtimeQa=document.createElement("script");runtimeQa.id="af-runtime-qa";runtimeQa.type="application/json";runtimeQa.textContent="{}";document.body.append(runtimeQa);this.runtimeQaNode=runtimeQa;const editor=document.createElement("details");editor.id="af-party-layout-editor";editor.setAttribute("aria-label","파티 편성");const allowed=[...new Set((this.session.stageSpec.deployment?.availableCharacterIds||this.session.stageSpec.deployment?.slots||[]).filter(Boolean))];editor.innerHTML=`<summary>파티 편성 <span aria-hidden="true">▾</span></summary><div class="af-party-layout-panel" style="display:grid;gap:8px">${Array.from({length:F.MAX_PARTY_SIZE},(_,slot)=>`<label>${slot+1}번 자리<select data-slot="${slot}" style="width:100%"><option value="">EMPTY</option>${allowed.map(id=>`<option value="${id}" ${this.session.partyLoadout.characterIds[slot]===id?"selected":""}>${F.CHARACTER_REGISTRY.get(id)?.displayName||id}</option>`).join("")}</select></label>`).join("")}<button type="button" data-apply style="padding:5px">적용 후 전투 다시 시작</button></div>`;editor.querySelector("[data-apply]").onclick=()=>{try{const characterIds=Array.from(editor.querySelectorAll("select"),select=>select.value||null),loadout=new F.PartyLoadout({id:this.session.deployment.partyId,characterIds,availableCharacterIds:allowed}),saved=F.PartyLoadout.saveForStage(this.stageId,loadout),roundTrip=F.PartyLoadout.loadForStage(this.stageId,{availableCharacterIds:allowed,unlockedCharacterIds:this.session.unlockedCharacterIds});if(JSON.stringify(saved.characterIds)!==JSON.stringify(roundTrip?.characterIds))throw new Error("Party loadout persistence verification failed");editor.dataset.afPartyApply="saved";location.reload();}catch(error){editor.dataset.afPartyApplyError=String(error?.message||error);let status=editor.querySelector("[data-party-error]");if(!status){status=document.createElement("small");status.dataset.partyError="";status.style.color="#ff9ca9";editor.append(status)}status.textContent=`SAVE ERROR: ${editor.dataset.afPartyApplyError}`;}};this.canvas.parentElement?.append(editor);const debug=document.createElement("pre");debug.id="af-visual-qa-overlay";debug.hidden=true;debug.setAttribute("aria-live","polite");debug.style.cssText="position:absolute;z-index:80;left:8px;top:8px;max-width:54vw;margin:0;padding:7px;background:#02070ddd;color:#d7f8ff;border:1px solid #6fd9ee;font:10px/1.35 ui-monospace;white-space:pre-wrap;pointer-events:none";this.canvas.parentElement?.append(debug);this.debugNode=debug;const timer=document.createElement("output");timer.id="af-battle-timer";timer.setAttribute("role","timer");timer.setAttribute("aria-live","off");this.canvas.parentElement?.append(timer);this.timerNode=timer;this.renderTimer();this.installCombatToolbar(editor);
      const start=document.querySelector("#startButton"),enterCombat=event=>{event?.preventDefault?.();event?.stopImmediatePropagation?.();this.body.dataset.afCombatStarted="true";this.running=true;document.querySelectorAll("#start,#startOverlay,#introOverlay,[data-combat-start-overlay]").forEach(overlay=>{overlay.classList.add("hidden");overlay.classList.add("hide");overlay.setAttribute("aria-hidden","true");overlay.style.pointerEvents="none";overlay.style.display="none";});this.trace("operation_start",{stageId:this.stageId});};if(start){this.body.dataset.afCombatStarted="false";this.listen(start,"click",enterCombat,{capture:true});}else enterCombat();
      const actions=document.createElement("div");actions.id="af-common-actions";actions.innerHTML='<button type="button" data-cover>엄폐 [C]</button><button type="button" data-reload>재장전 [R]</button><button type="button" data-motion-factory>120F 골든 모션 [V]</button><button type="button" data-ultimate>필살기 [E]</button>';this.canvas.parentElement?.append(actions);this.actions=actions;actions.querySelector("[data-cover]").onclick=()=>this.toggleCover();actions.querySelector("[data-reload]").onclick=()=>this.startReload();actions.querySelector("[data-motion-factory]").onclick=()=>this.playMotionFactorySequence();actions.querySelector("[data-ultimate]").onclick=()=>this.castUltimate();if(new URLSearchParams(location.search).has("qa")){const qaDispose=document.createElement("button");qaDispose.type="button";qaDispose.dataset.qaDispose="";qaDispose.textContent="QA DISPOSE";qaDispose.onclick=()=>this.dispose("qa-button");actions.append(qaDispose);}
      if(window.AfterSignalPlatform?.debug?.enabled){const lifecycle=document.createElement("div");lifecycle.id="af-lifecycle-qa";lifecycle.style.cssText="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:6px";lifecycle.innerHTML='<button type="button" data-save>QA SAVE</button><button type="button" data-restore>QA RESTORE</button><button type="button" data-background>QA BACKGROUND</button><button type="button" data-foreground>QA RESUME</button><button type="button" data-offline>QA OFFLINE</button><button type="button" data-reconnect>QA RECONNECT</button><button type="button" data-timeout>QA TIMER 1S</button><button type="button" data-complete>QA COMPLETE</button><small data-status style="grid-column:1/-1;color:#b8f5ff">READY</small>';editor.querySelector("div")?.append(lifecycle);const status=lifecycle.querySelector("[data-status]");lifecycle.querySelector("[data-save]").onclick=()=>{this.save();status.textContent=`SAVED · W${this.wave+1} · E${this.enemies.length}`;};lifecycle.querySelector("[data-restore]").onclick=()=>{const restored=this.restore();status.textContent=restored?`RESTORED · W${this.wave+1} · E${this.enemies.length}`:"RESTORE REJECTED";};lifecycle.querySelector("[data-background]").onclick=()=>{window.AfterSignalPlatform.debug.simulate("background");status.textContent=`BACKGROUND · W${this.wave+1} · E${this.enemies.length}`;};lifecycle.querySelector("[data-foreground]").onclick=()=>{window.AfterSignalPlatform.debug.simulate("resume");status.textContent=`RESUMED · W${this.wave+1} · E${this.enemies.length}`;};lifecycle.querySelector("[data-offline]").onclick=()=>{window.AfterSignalPlatform.debug.simulate("network-loss");status.textContent=`OFFLINE · W${this.wave+1} · E${this.enemies.length}`;};lifecycle.querySelector("[data-reconnect]").onclick=()=>{window.AfterSignalPlatform.debug.simulate("reconnect");status.textContent=`RECONNECTED · W${this.wave+1} · E${this.enemies.length}`;};lifecycle.querySelector("[data-timeout]").onclick=()=>{this.timeRemainingMs=1000;this.__afTimeLimitExpired=false;this.trace("qa_timer_accelerated",{remainingMs:1000});this.renderTimer();status.textContent="TIMER · 1S";};lifecycle.querySelector("[data-complete]").onclick=()=>{this.trace("qa_force_complete",{stageId:this.stageId});this.enemies.length=0;this.wave=Math.max(0,this.session.battleSpec.waves.length-1);this.completed=false;this.update(0);status.textContent="COMPLETE PATH";};}
      const autoControl=document.querySelector("#fireAuto,#fireToggle,#auto"),toggleAuto=event=>{event?.stopImmediatePropagation?.();this.auto=!this.auto;autoControl?.classList.toggle("on",this.auto);autoControl?.setAttribute("aria-pressed",String(this.auto));const label=autoControl?.querySelector("span"),hint=autoControl?.querySelector("small");if(label)label.textContent=this.auto?"파티 자동 조준·사격":"선택 캐릭터 수동 조준·사격";else if(autoControl)autoControl.textContent=this.auto?"AUTO FIRE: PARTY":"MANUAL: SELECTED";if(hint)hint.textContent=this.auto?"A · PARTY AUTO":"A · SELECTED HOLD TO FIRE";this.trace("control_mode_changed",{partyAuto:this.auto,selectedCharacterId:this.selected()?.spec?.id||null,nonSelectedAuto:true});this.publishRuntimeQa(0);return this.auto;};this.listen(autoControl,"click",toggleAuto,{capture:true});
      const tacticalAuto=document.querySelector("#tacticalAuto,[data-ultimate-auto],.tactical-auto"),syncTacticalAuto=()=>{tacticalAuto?.classList.toggle("on",this.ultimateAuto);tacticalAuto?.setAttribute("aria-pressed",String(this.ultimateAuto));const hint=tacticalAuto?.querySelector("small");if(hint)hint.textContent=this.ultimateAuto?"필살기 자동":"필살기 수동";};syncTacticalAuto();this.listen(tacticalAuto,"click",event=>{event.preventDefault();event.stopImmediatePropagation();this.ultimateAuto=!this.ultimateAuto;syncTacticalAuto();this.trace("ultimate_auto_toggled",{enabled:this.ultimateAuto});},{capture:true});
      document.querySelectorAll("#ultimateButton,#ultimate,[data-ultimate]").forEach(control=>this.listen(control,"click",event=>{event.preventDefault();event.stopImmediatePropagation();this.castUltimate();},{capture:true}));
      this.listen(this.canvas,"pointerdown",event=>{this.running=true;this.updatePointer(event);this.triggerPress();});this.listen(this.canvas,"pointermove",event=>this.updatePointer(event));this.listen(window,"pointerup",()=>this.triggerRelease());this.listen(window,"pointercancel",()=>this.triggerCancel("pointercancel"));this.listen(window,"blur",()=>this.triggerCancel("blur"));this.listen(document,"visibilitychange",()=>{if(document.hidden)this.triggerCancel("hidden");});this.listen(window,"keydown",event=>{
        if(event.target?.matches?.('input,textarea,select,[contenteditable="true"]'))return;
        if(event.code==="Tab"||event.key==="Tab"){
          const resultVisible=[...document.querySelectorAll('#result,#resultOverlay')].some(node=>!node.classList.contains('hidden')&&getComputedStyle(node).display!=='none');
          if(!this.running||this.disposed||this.completed||editor.open||resultVisible)return;
          event.preventDefault();if(event.repeat||event.altKey||event.ctrlKey||event.metaKey)return;
          const members=this.session.party.selectableMembers(),at=members.findIndex(member=>member.slot===this.session.party.selectedSlot);
          if(members.length){const next=members[(at+(event.shiftKey?-1:1)+members.length)%members.length];this.session.select(next.slot);this.renderHud();this.trace("party_tab_selected",{slot:next.slot,reverse:event.shiftKey});}
          return;
        }
        if(/^(?:Digit|Numpad)[1-5]$/.test(event.code))this.session.select(+event.code.at(-1)-1);if(event.code==="KeyA")toggleAuto();if(event.code==="KeyE")this.castUltimate();if(event.code==="KeyC")this.toggleCover();if(event.code==="KeyR")this.startReload();if(event.code==="KeyV")this.playMotionFactorySequence();if(event.code==="F3"){event.preventDefault();this.debug.enabled=!this.debug.enabled;if(this.debugNode)this.debugNode.hidden=!this.debug.enabled;}});
      for(const delay of [120,420,1100])this.schedule(()=>this.syncResponsiveLayout(),delay);
      const platformUnsubscribe=window.AfterSignalPlatform?.on(event=>{if(event.type==="background")this.pauseForLifecycle("background");if(event.type==="resume")this.resumeFromLifecycle("background");if(event.type==="network-loss")this.pauseForLifecycle("network");if(event.type==="reconnect")this.resumeFromLifecycle("network")});if(typeof platformUnsubscribe==="function")this.__afPlatformUnsubscribe=platformUnsubscribe;
    }
    installCombatToolbar(editor){
      const toolbar=document.querySelector('.battle-topbar,.topbar,.top,.hud-top')||document.createElement('header');
      if(!toolbar.parentElement)this.canvas.parentElement?.append(toolbar);
      toolbar.classList.add('af-combat-toolbar');this.toolbar=toolbar;
      const fire=document.querySelector('#fireAuto,#fireToggle,#auto'),mission=toolbar.querySelector('.mission,.operation-title'),tactical=document.querySelector('#tacticalAuto,#ultimate'),cutscene=document.querySelector('#cutsceneToggle,.cutscene-toggle');
      for(const [node,area] of [[fire,'fire'],[editor,'party'],[mission,'mission'],[cutscene,'cutscene'],[tactical,'tactical']])if(node){node.dataset.afToolbarArea=area;toolbar.append(node);}
      const style=document.createElement('style');style.textContent=`
        body[data-af-common-combat-active="v1"] .af-combat-toolbar{position:absolute!important;z-index:55!important;inset:auto!important;left:2%!important;right:2%!important;top:max(12px,env(safe-area-inset-top))!important;padding:0!important;display:grid!important;grid-template-columns:minmax(150px,190px) 132px minmax(0,1fr) 132px minmax(150px,190px)!important;grid-template-areas:"fire party mission cutscene tactical"!important;gap:12px!important;align-items:start!important;pointer-events:none!important}
        .af-combat-toolbar>[data-af-toolbar-area]{grid-area:var(--af-toolbar-area);min-width:0;max-width:none!important;pointer-events:auto}
        .af-combat-toolbar>[data-af-toolbar-area="fire"]{grid-area:fire}.af-combat-toolbar>[data-af-toolbar-area="party"]{grid-area:party}.af-combat-toolbar>[data-af-toolbar-area="mission"]{grid-area:mission;pointer-events:none}.af-combat-toolbar>[data-af-toolbar-area="cutscene"]{grid-area:cutscene}.af-combat-toolbar>[data-af-toolbar-area="tactical"]{grid-area:tactical}
        body[data-af-common-combat-active="v1"] .af-combat-toolbar>.cutscene-toggle{position:relative!important;inset:auto!important;min-height:44px!important;margin:0!important;white-space:nowrap;justify-self:stretch}
        body[data-af-common-combat-active="v1"] #af-party-layout-editor{position:relative!important;inset:auto!important;z-index:60;max-width:none!important;margin:0;padding:0;border:0;background:transparent;color:#eafcff;font:700 13px/1.3 CombatKR,system-ui,sans-serif;pointer-events:auto}
        #af-party-layout-editor summary{box-sizing:border-box;min-height:44px;display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 14px;border:1px solid #8eeff7;background:#071621f2;box-shadow:0 0 12px #61ddea22;cursor:pointer;white-space:nowrap;list-style:none}
        #af-party-layout-editor:not([open]) .af-party-layout-panel{display:none!important}#af-party-layout-editor summary::-webkit-details-marker{display:none}#af-party-layout-editor summary:focus-visible{outline:2px solid #fff0ac;outline-offset:3px}#af-party-layout-editor[open] summary{color:#fff0ac;border-color:#fff0ac}#af-party-layout-editor[open] summary span{transform:rotate(180deg)}
        #af-party-layout-editor .af-party-layout-panel{position:absolute;top:calc(100% + 8px);left:0;box-sizing:border-box;width:min(240px,80vw);max-height:calc(100svh - var(--af-toolbar-bottom,80px) - 100px);overflow-y:auto;padding:14px;border:1px solid #8eeff7;background:#06121cfa;box-shadow:0 12px 30px #0009;overscroll-behavior:contain}
        #af-party-layout-editor select,#af-party-layout-editor [data-apply]{min-height:34px;box-sizing:border-box;border:1px solid #668d9d;background:#102330;color:#effcff;font:inherit}
        #af-party-layout-editor select{margin-top:3px}#af-party-layout-editor [data-apply]{padding:8px!important;cursor:pointer}
        body[data-af-common-combat-active="v1"] #af-battle-timer{top:calc(var(--af-toolbar-bottom,76px) + 8px)!important}
        @media(max-width:1100px){body[data-af-common-combat-active="v1"] .af-combat-toolbar{grid-template-columns:150px 116px minmax(0,1fr) 116px 150px!important;gap:8px!important}.af-combat-toolbar .mission b,.af-combat-toolbar .operation-title b{font-size:clamp(18px,2.7vw,30px)!important}}
        @media(max-width:760px){body[data-af-common-combat-active="v1"] .af-combat-toolbar{left:2%!important;right:2%!important;top:max(8px,env(safe-area-inset-top))!important;grid-template-columns:112px minmax(0,1fr) 112px!important;grid-template-areas:"fire mission tactical" "party . cutscene"!important;gap:8px!important}#af-party-layout-editor summary{min-height:36px;padding:7px 10px;font-size:11px}body[data-af-common-combat-active="v1"] .af-combat-toolbar>.cutscene-toggle{min-height:36px!important;font-size:10px!important}.af-combat-toolbar .mission small,.af-combat-toolbar .operation-title small{font-size:8px!important;letter-spacing:0!important;overflow-wrap:anywhere}.af-combat-toolbar .mission b,.af-combat-toolbar .operation-title b{font-size:18px!important;overflow-wrap:anywhere}body[data-af-common-combat-active="v1"] #af-common-actions{top:calc(var(--af-toolbar-bottom,112px) + 84px)!important}}
      `;document.head.append(style);
      this.listen(editor,'toggle',()=>{if(editor.open)editor.querySelector('select')?.focus();});
    }
    syncCombatToolbar(){
      if(!this.toolbar)return;
      const rect=this.toolbar.getBoundingClientRect(),parent=this.canvas.parentElement?.getBoundingClientRect();
      if(window.parent!==window)try{const frame=window.frameElement?.getBoundingClientRect();window.parent.document.body.style.setProperty('--af-combat-toolbar-bottom',Math.ceil(rect.bottom+(frame?.top||0))+'px')}catch{}
      if(parent)this.canvas.parentElement.style.setProperty('--af-toolbar-bottom',Math.ceil(rect.bottom-parent.top)+'px');
    }
    renderTimer(force=false){if(!this.timerNode)return;const remaining=Math.max(0,Number(this.timeRemainingMs)||0),seconds=Math.ceil(remaining/1000);if(!force&&this.__afTimerSecond===seconds){this.qa.timerDomSkipped=(this.qa.timerDomSkipped||0)+1;return;}this.__afTimerSecond=seconds;this.qa.timerDomRendered=(this.qa.timerDomRendered||0)+1;const minutes=Math.floor(seconds/60),rest=seconds%60;this.timerNode.value=`${String(minutes).padStart(2,"0")}:${String(rest).padStart(2,"0")}`;this.timerNode.textContent=this.timerNode.value;this.timerNode.classList.toggle("warning",seconds>10&&seconds<=30);this.timerNode.classList.toggle("critical",seconds<=10);this.timerNode.dataset.profile=this.session.battleSpec.rules?.timeLimitProfile||"UNSPECIFIED";this.timerNode.dataset.remainingMs=String(Math.round(remaining));this.timerNode.setAttribute("aria-label",`전투 제한 시간 ${minutes}분 ${rest}초`);}
    pauseForLifecycle(reason){
      if(!this.lifecyclePauses.size){this.lifecycleWasRunning=this.running;this.save();}
      this.lifecyclePauses.add(reason);this.running=false;this.pointer.down=false;this.projectiles.length=0;this.enemyProjectiles.length=0;this.impacts.length=0;this.incomingImpacts.length=0;this.damageNumbers.length=0;this.ultimateFx.length=0;this.ultimateSequence=null;for(const player of this.players)if(player)player.muzzleFlashClock=0;this.hitStop=0;this.camera=0;
      this.trace("lifecycle_pause",{reason,pausedReasons:[...this.lifecyclePauses],wasRunning:this.lifecycleWasRunning,discardedTransientObjects:true});this.publishRuntimeQa(0);return true;
    }
    resumeFromLifecycle(reason){
      this.lifecyclePauses.delete(reason);if(this.lifecyclePauses.size){this.trace("lifecycle_resume_deferred",{reason,pausedReasons:[...this.lifecyclePauses]});this.publishRuntimeQa(0);return false;}
      const restored=this.restore();this.running=Boolean(restored&&this.lifecycleWasRunning&&!this.completed&&!this.terminalPaused);this.lifecycleResumeGraceUntil=performance.now()+650;this.last=performance.now();this.trace("lifecycle_resume",{reason,restored,running:this.running,resumeGraceMs:650,duplicateProjectile:0,duplicateDamage:0,duplicateReward:this.qa.duplicateReward||0});this.publishRuntimeQa(0);return restored;
    }
    updatePointer(event){const rect=this.canvas.getBoundingClientRect();this.pointer.x=(event.clientX-rect.left)/rect.width*this.width;this.pointer.y=(event.clientY-rect.top)/rect.height*this.height;}
    renderHud(force=false){
      const compact=innerHeight<=500,now=performance.now();
      const signature=[compact?1:0,this.session.party.activeMember()?.slot??-1,...this.session.partySpec.slots.flatMap(slot=>{const member=this.session.party.members[slot.slot],player=this.players[slot.slot];return[slot.spec?.id||"EMPTY",member.state,Math.ceil(member.hp),Math.ceil(member.shield),Math.round(member.ultimateGauge),player?.ammo??-1,Math.round((player?.reloadClock||0)*10),Math.round((player?.reviveClock||0)*10)];})].join("|");
      // Five readable HUD updates per second are sufficient; rebuilding five
      // cards at 10-12 Hz caused avoidable long frames in the in-app browser.
      if(!force&&this.__afHudSignature!==undefined&&((now-(this.__afHudRenderedAt||0)<200)||signature===this.__afHudSignature)){this.qa.hudDomSkipped=(this.qa.hudDomSkipped||0)+1;return;}this.__afHudRenderedAt=now;this.__afHudSignature=signature;this.qa.hudDomRendered=(this.qa.hudDomRendered||0)+1;
      this.session.partySpec.slots.forEach(slot=>{
        const member=this.session.party.members[slot.slot],player=this.players[slot.slot];let button=this.hud.querySelector(`button[data-slot="${slot.slot}"]`);
        if(!button){button=document.createElement("button");button.type="button";button.dataset.slot=String(slot.slot);this.hud.append(button);}
        if(!slot.spec){if(button.dataset.characterId!=="EMPTY"){button.dataset.characterId="EMPTY";button.disabled=true;button.innerHTML=`<small>SLOT ${slot.slot+1}</small><b data-name>${member.state}</b>`;}button.querySelector("[data-name]").textContent=member.state;return;}
        if(button.dataset.characterId!==slot.spec.id){button.dataset.characterId=slot.spec.id;delete button.dataset.afAmmoKey;button.disabled=false;button.innerHTML=`<span class="af-portrait-frame"><img src="${slot.spec.portrait}" alt="${slot.spec.displayName}"></span><small></small><b></b><i data-status></i><span class="af-bars"><em class="af-hp-label">HP</em><span class="af-meter af-hp" role="meter" aria-label="HP" aria-valuemin="0"><u data-hp-fill></u></span><em class="af-hp-text" data-hp-text></em><span class="af-meter af-ammo" aria-label="AMMO"><u data-ammo-fill></u></span><em class="af-ammo-text" data-ammo-text></em></span>`;button.onclick=()=>this.session.select(slot.slot);}
        const hpRatio=clamp(member.maxHp?member.hp/member.maxHp:0,0,1),ammo=player?.ammo??0,magazineSize=player?.magazineSize??1,ammoRatio=clamp(ammo/magazineSize,0,1),reloading=(player?.reloadClock||0)>0;
        let bulletStrip=button.querySelector(".af-bullets");if(!bulletStrip){bulletStrip=document.createElement("span");bulletStrip.className="af-bullets";bulletStrip.setAttribute("aria-hidden","true");button.append(bulletStrip);}const ammoKey=`${ammo}/${magazineSize}`;if(button.dataset.afAmmoKey!==ammoKey){button.dataset.afAmmoKey=ammoKey;if(bulletStrip.children.length!==magazineSize)bulletStrip.innerHTML=Array.from({length:magazineSize},()=>"<i></i>").join("");Array.from(bulletStrip.children).forEach((round,index)=>round.classList.toggle("spent",index>=ammo));}
        // PERF FIX 2026-09-23: only write values that changed; rewriting identical text/attributes still
        // invalidated style for every card at 5 Hz.
        const setText=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;},setAttr=(node,name,value)=>{if(node&&node.getAttribute(name)!==value)node.setAttribute(name,value);},setTransform=(node,value)=>{if(node&&node.style.transform!==value)node.style.transform=value;};
        if(button.classList.contains("active")!==(member.state==="ACTIVE"))button.classList.toggle("active",member.state==="ACTIVE");if(button.classList.contains("reloading")!==reloading)button.classList.toggle("reloading",reloading);if(button.classList.contains("low-hp")!==(hpRatio<=.3))button.classList.toggle("low-hp",hpRatio<=.3);setAttr(button,"aria-label",`${slot.spec.displayName}, HP ${Math.ceil(member.hp)} / ${member.maxHp}, ammo ${ammo} / ${magazineSize}${reloading?", reloading":""}`);
        setText(button.querySelector("small"),compact?`S${slot.slot+1} · ${(slot.spec.role||"").split("/").pop().trim()}`:`${slot.slot+1} · ${slot.spec.role||""}`);setText(button.querySelector("b"),compact||hudEnabled?slot.spec.displayName.replace(hudEnabled?/^(?:SSR\d+|QA-\d+)\s*/:/^SSR07\s*/,"").replace(/^QA-\d+\s*/,""):slot.spec.displayName);const reviveStatus=(player?.reviveClock||0)>0?`REVIVE ${(player.reviveClock||0).toFixed(1)}s`:`${member.state}`;setText(button.querySelector("[data-status]"),compact?`${reviveStatus} · U${Math.round(member.ultimateGauge)}%`:`${reviveStatus} · HP ${Math.ceil(member.hp)}/${member.maxHp} · SH ${Math.ceil(member.shield)} · ULT ${Math.round(member.ultimateGauge)}%`);
        const hpMeter=button.querySelector(".af-hp");setAttr(hpMeter,"aria-valuemax",String(member.maxHp));setAttr(hpMeter,"aria-valuenow",String(Math.ceil(member.hp)));setTransform(button.querySelector("[data-hp-fill]"),`scaleX(${hpRatio})`);setText(button.querySelector("[data-hp-text]"),`${Math.ceil(member.hp)}/${member.maxHp}`);setTransform(button.querySelector("[data-ammo-fill]"),`scaleX(${ammoRatio})`);setText(button.querySelector("[data-ammo-text]"),reloading?"RLD":`${ammo}/${magazineSize}`);
      });
    }
    trace(type,data={}){const raw=performance.now(),previous=Number(this.qa.eventMonotonicMs)||0,monotonicMs=Math.max(raw,previous+.001),sequence=(Number(this.qa.eventSequence)||0)+1;this.qa.eventMonotonicMs=monotonicMs;this.qa.eventSequence=sequence;this.qa.eventTrace.push({type,sequence,monotonicMs,data});if(this.qa.eventTrace.length>2048)this.qa.eventTrace.splice(0,this.qa.eventTrace.length-2048);}
    spawnWave(){const wave=this.session.battleSpec.waves[this.wave];if(!wave)return;this.waveContributors.clear();const bossJoins=this.session.battleSpec.boss?.spawnWithWave===this.wave?1:0,rules=this.session.battleSpec.rules||{};this.wavePressureCount=Math.max(1,wave.enemyIds.length+bossJoins);this.wavePressureScale=Math.min(1,Math.max(1,Number(rules.enemyPressureBudget)||this.wavePressureCount)/this.wavePressureCount);const positions=[[.30,.36],[.62,.30],[.82,.39],[.48,.25],[.72,.20]];this.trace("wave_start",{wave:this.wave+1,count:wave.enemyIds.length,pressureCount:this.wavePressureCount,pressureScale:this.wavePressureScale});wave.enemyIds.forEach((enemyId,index)=>{const position=positions[index%positions.length],runtime=wave.enemyRuntime?.[index]||{};this.spawnEnemy({enemyId,id:`${this.wave}-${index}`,x:this.width*position[0],y:this.height*position[1],runtime});});this.session.emit("onWaveStart",wave);}
    spawnEnemy({enemyId,id,x,y,runtime={},bossRuntime=null}){const spec=F.ENEMY_REGISTRY.get(enemyId);if(!spec)throw new Error(`UNKNOWN_ENEMY:${enemyId}`);const band=spec.depthBand||"background1",bandBaseline=band==="background1"?this.height*.57:band==="background2"?this.height*.39:this.height*.27,bossBaseline=this.height*.60,maxHp=runtime.runtimeMaxHp||100,phase=((this.wave+1)*.71+(this.enemies.length+1)*1.17)%6.28;const enemy={id,spec,x,y:bossRuntime?bossBaseline:bandBaseline,originX:x,originY:bossRuntime?bossBaseline:bandBaseline,renderLayer:band,hp:maxHp,maxHp,img:this.images.get(spec.asset),motionImages:Object.fromEntries(Object.entries(spec.motionAssets||{}).map(([direction,source])=>[direction,this.images.get(source)])),hit:0,radius:runtime.radius||45,displayMaxHp:runtime.displayMaxHp||maxHp,bossRuntime,motionTime:phase,attackClock:(spec.attack?.cadence||2.2)*(.4+(phase/6.28)*.5),attackTelegraph:0,attackPhase:phase,attackSequence:0,activeAttackId:null,pendingResolutionAttackId:null,cooldownCompleteAttackId:null,alive:true,poseDirection:"idle"};this.enemies.push(enemy);this.trace("enemy_spawn",{wave:this.wave+1,enemyId,depthBand:band,baselineY:enemy.y});this.session.emit("onEnemySpawn",{id:enemyId});return enemy;}
    spawnConfiguredBoss(){const config=this.session.battleSpec.boss;if(!config||!config.id||config.spawnWithWave!==this.wave)return null;const boss=this.spawnEnemy({enemyId:config.id,id:`boss-${config.id}`,x:this.width*.5,y:this.height*.35,runtime:{runtimeMaxHp:config.runtimeMaxHp||config.maxHp||100,radius:(config.renderSize||176)*.32,displayMaxHp:config.maxHp||config.runtimeMaxHp},bossRuntime:{config,phaseIndex:0,phaseElapsed:0,nodes:[],phaseHistory:[]}});this.enterBossPhase(boss,0);this.trace("boss_spawn",{bossId:config.id});return boss;}
    enterBossPhase(enemy,index){const runtime=enemy.bossRuntime,phases=runtime?.config?.phases||[];if(!runtime||!phases[index])return false;if(runtime.phaseHistory.includes(index)){this.qa.bossPhaseDoubleTrigger++;return false;}if(index>runtime.phaseIndex+1){this.qa.bossPhaseSkip++;return false;}runtime.phaseIndex=index;runtime.phaseElapsed=0;const phase=phases[index];runtime.nodes=(phase.nodes||[]).map(node=>({id:node.id,offset:node.offset||[0,0],hp:node.runtimeMaxHp||100,maxHp:node.runtimeMaxHp||100,requiresManualReject:Boolean(node.requiresManualReject),broken:false}));runtime.phaseHistory.push(index);this.trace("boss_phase",{bossId:enemy.spec.id,phaseId:phase.id,index,cue:phase.cue||null});window.dispatchEvent(new CustomEvent("aftersignal:boss-phase",{detail:{stageId:this.stageId,bossId:enemy.spec.id,phaseId:phase.id,index,cue:phase.cue||null}}));this.session.commands.playCue(phase.cue||phase.id);return true;}
    updateBossPhases(dt){for(const enemy of this.enemies){const runtime=enemy.bossRuntime;if(!runtime)continue;const phase=runtime.config.phases?.[runtime.phaseIndex];if(!phase||!phase.exposureSeconds)continue;runtime.phaseElapsed+=dt;if(runtime.phaseElapsed<phase.exposureSeconds)continue;const policy=phase.transitionPolicy||"HP_THRESHOLD",ratio=enemy.hp/enemy.maxHp;const next=policy==="ALWAYS_NEXT"?runtime.phaseIndex+1:ratio>(phase.rearmIfHpAbove??1)?runtime.phaseIndex+1:Math.min(runtime.phaseIndex+2,runtime.config.phases.length-1);if(next===runtime.phaseIndex){runtime.phaseElapsed=0;continue;}this.enterBossPhase(enemy,next);}}
    bossNodesRemaining(enemy){return enemy.bossRuntime?.nodes?.some(node=>!node.broken)||false;}
    rejectFakeOrder(){if(this.stageId!=="P-14"||!this.running)return false;const boss=this.enemies.find(enemy=>enemy.bossRuntime?.config?.id==="renewal_mira_voice_echo"),node=boss?.bossRuntime?.nodes?.find(candidate=>!candidate.broken&&candidate.requiresManualReject);if(!boss||!node)return false;node.hp=0;node.broken=true;this.qa.manualRejectCount=(this.qa.manualRejectCount||0)+1;this.trace("forged_command_rejected",{bossId:boss.spec.id,nodeId:node.id,count:this.qa.manualRejectCount});const remaining=boss.bossRuntime.nodes.filter(candidate=>!candidate.broken).length;window.dispatchEvent(new CustomEvent("aftersignal:forged-command-rejected",{detail:{stageId:this.stageId,bossId:boss.spec.id,nodeId:node.id,remaining}}));if(!this.bossNodesRemaining(boss))this.enterBossPhase(boss,boss.bossRuntime.phaseIndex+1);this.renderHud();return true;}
    selected(){return this.players.find(player=>player?.member.state==="ACTIVE")||null;}
    isSelectedPlayer(player){return Boolean(player&&player===this.selected());}
    isAutoControlled(player){return Boolean(player&&(this.auto||!this.isSelectedPlayer(player)));}
    toggleCover(){const player=this.selected();if(!player||!this.running)return false;player.motionFactorySequenceHoldSource=null;player.coverRequested=!player.coverRequested;player.coverClock=0;player.reloadClock=0;this.trace(player.coverRequested?"cover_enter":"cover_exit",{characterId:player.spec.id});return player.coverRequested;}
    startReload(player=this.selected()){if(!player||!this.running||player.reloadClock>0||player.ammo>=player.magazineSize)return false;player.coverRequested=false;player.coverClock=0;player.reloadClock=Math.max(.25,Number(player.spec.combatTiming?.reloadSeconds)||1.08);this.trace("reload_start",{characterId:player.spec.id,ammo:player.ammo,magazineSize:player.magazineSize});this.renderHud();return true;}
    fire(owner,heavy=false){if(!owner||owner.cooldown>0||owner.reloadClock>0||!this.running)return;if(owner.ammo<=0){this.startReload(owner);return;}const controller=this.session.controllers.get(owner.spec.id);controller?.setState(F.CharacterState.FIRE);const spec=F.PROJECTILE_REGISTRY.get(owner.spec.projectileId),autoTarget=this.auto&&this.session.battleSpec.rules.autoTarget&&!this.pointer.down?this.enemies.reduce((closest,enemy)=>!closest||Math.hypot(enemy.x-owner.x,enemy.y-owner.y)<Math.hypot(closest.x-owner.x,closest.y-owner.y)?enemy:closest,null):null,targetX=autoTarget?.x??this.pointer.x,targetY=autoTarget?.y??this.pointer.y,dx=targetX-owner.x,dy=targetY-(owner.y-playerBodyPx(owner)*.7),length=Math.hypot(dx,dy)||1,timing=owner.spec.combatTiming||{};owner.cooldown=heavy?(timing.heavyFireInterval??.55):(timing.normalFireInterval??.34);owner.ammo=Math.max(0,owner.ammo-1);this.projectiles.push({owner,spec,x:owner.x,y:owner.y-playerBodyPx(owner)*.7,px:owner.x,py:owner.y-playerBodyPx(owner)*.7,vx:dx/length*(heavy?940:720),vy:dy/length*(heavy?940:720),age:0,life:1.5,heavy});this.trace("ammo_spent",{characterId:owner.spec.id,ammo:owner.ammo,magazineSize:owner.magazineSize});this.renderHud();}
    castUltimate(owner=this.selected(),automatic=false){
      if(!owner||owner.member.ultimateGauge<100||!this.running||this.ultimateSequence)return false;
      const ultimate=F.ULTIMATE_REGISTRY.get(owner.spec.ultimateId),projectile=F.PROJECTILE_REGISTRY.get(owner.spec.projectileId);
      if(!ultimate||!projectile)throw new Error(`Missing ultimate contract for ${owner.spec.id}`);
      owner.member.ultimateGauge=0;
      this.ultimateSequence={owner,ultimate,projectile,age:0,phase:"cutin",battlefieldFxStarted:false,damageApplied:false};
      this.trace("ultimate_used",{characterId:owner.spec.id,ultimateId:ultimate.id,motifType:ultimate.motifType,automatic});
      for(const phase of ["source","trigger","cutin"])this.trace("ultimate_phase",{characterId:owner.spec.id,phase});
      this.session.emit("onUltimateUsed",owner.spec.id);this.session.commands.playCue(`ultimate:${ultimate.id}:trigger`);
      window.dispatchEvent(new CustomEvent("aftersignal:ultimate",{detail:{stageId:this.stageId,characterId:owner.spec.id,ultimateId:ultimate.id,phases:ultimate.phases}}));
      const cutin=document.querySelector("#cutin,#ultimateCutin,.ultimate-cutin");
      if(cutin){const cutinSource=owner.spec.ultimateCutin||owner.spec.combatClips?.FIRE_DIRECTIONAL_FRAMES?.[Math.floor(owner.spec.combatClips.FIRE_DIRECTIONAL_FRAMES.length/2)]||owner.spec.combatClips?.AIM||owner.spec.battleSprite,cutinVisual=owner.spec.ultimateCutin?null:(this.renderableSprite?.(cutinSource,owner.spec.combatAssetPolicy)||this.images.get(cutinSource)),cutinData=cutinVisual?.toDataURL?(cutinVisual.__afCutinDataUrl||(cutinVisual.__afCutinDataUrl=cutinVisual.toDataURL("image/png"))):cutinSource;cutin.dataset.afStandingCutin=String(Boolean(owner.spec.ultimateCutin));cutin.querySelector("img")?.setAttribute("src",cutinData);cutin.querySelector("b")&&(cutin.querySelector("b").textContent=ultimate.name);cutin.classList.add("show");cutin.setAttribute("aria-hidden","false");}
      this.renderHud();return true;
    }
    projectileCollisionRadius(projectile){return Math.max(3,(projectile.spec.trail.width||8)*1.2*projectile.spec.collisionScale);}
    projectileHitsEnemy(projectile,enemy){return Boolean(this.projectileHitForEnemy?.(projectile,enemy));}
    applyHitStop(kind,requestedMs,source="unknown"){
      const requested=Math.max(0,Number(requestedMs)||0),caps={NORMAL:0,HEAVY:24,ENEMY:12,ULTIMATE:72},cap=caps[kind]??0,now=performance.now();
      let applied=Math.min(requested,cap);if(kind==="ENEMY"&&this.__afLastEnemyHitStopAt&&now-this.__afLastEnemyHitStopAt<90)applied=0;if(kind==="ENEMY"&&applied>0)this.__afLastEnemyHitStopAt=now;
      this.qa.hitStopRequestedMs=(this.qa.hitStopRequestedMs||0)+requested;this.qa.hitStopAppliedMs=(this.qa.hitStopAppliedMs||0)+applied;this.qa.hitStopSuppressedMs=(this.qa.hitStopSuppressedMs||0)+Math.max(0,requested-applied);this.qa.hitStopByKind=this.qa.hitStopByKind||{};const stats=this.qa.hitStopByKind[kind]||(this.qa.hitStopByKind[kind]={events:0,requestedMs:0,appliedMs:0});stats.events++;stats.requestedMs+=requested;stats.appliedMs+=applied;
      if(applied>0)this.hitStop=Math.max(this.hitStop,applied/1000);return applied;
    }
    damage(enemy,amount,spec,owner=null,hitPoint=null){if(owner)this.waveContributors.add(owner.slot);enemy.hit=.18;const aimPoint=hitPoint||enemy.lastHitPoint||this.enemyAimPoint?.(enemy)||{x:enemy.x,y:enemy.y};enemy.lastHitPoint=null;this.impacts.push({x:aimPoint.x,y:aimPoint.y,spec,age:0});const isUltimateImpact=Boolean(this.ultimateSequence?.damageApplied&&owner===this.ultimateSequence.owner&&amount===this.ultimateSequence.ultimate?.damage),impactKind=isUltimateImpact?"ULTIMATE":amount>24?"HEAVY":"NORMAL";this.applyHitStop(impactKind,spec.impact.hitStop,owner?.spec?.id||"player");this.camera=Math.max(this.camera,spec.impact.camera);if(this.bossNodesRemaining(enemy)){const node=enemy.bossRuntime.nodes.find(candidate=>!candidate.broken);node.hp=Math.max(0,node.hp-amount);if(node.hp===0){node.broken=true;this.trace("boss_node_broken",{bossId:enemy.spec.id,nodeId:node.id,phaseIndex:enemy.bossRuntime.phaseIndex});if(!this.bossNodesRemaining(enemy))this.enterBossPhase(enemy,enemy.bossRuntime.phaseIndex+1);}return;}const bossRuntime=enemy.bossRuntime;if(bossRuntime&&bossRuntime.config.lethalPolicy==="FINAL_PHASE_ONLY"&&bossRuntime.phaseIndex<bossRuntime.config.phases.length-1){enemy.hp=Math.max(1,enemy.hp-amount);this.trace("boss_lethal_gated",{bossId:enemy.spec.id,phaseIndex:bossRuntime.phaseIndex});return;}enemy.hp=Math.max(0,enemy.hp-amount);if(enemy.hp===0){enemy.alive=false;this.enemies=this.enemies.filter(candidate=>candidate!==enemy);this.enemyProjectiles=this.enemyProjectiles.filter(shot=>shot.source!==enemy);this.trace("enemy_defeated",{wave:this.wave+1,enemyId:enemy.spec.id,cancelledScheduledDamage:true});this.session.emit("onEnemyDefeated",enemy);this.session.objective.progress++;}}
    guardCompletionNavigation(){const candidate=window.aftersignalCompleteBattle;if(candidate&&candidate!==this.__afCompletionGuard){this.__afCanonicalCompleteBattle=candidate;this.__afCompletionGuard=()=>this.__afCompletionConfirmed?this.__afCanonicalCompleteBattle?.():false;window.aftersignalCompleteBattle=this.__afCompletionGuard;}return this.__afCompletionGuard||null;}
    commitReward(){if(this.rewardCommitted){this.qa.duplicateReward++;return false;}this.rewardCommitted=true;this.qa.rewardCommitCount++;this.qa.nextStageCommitCount++;const detail={stageId:this.stageId,nextStage:this.session.stageSpec.nextStage,transactionId:`${this.stageId}:${this.session.objective.progress}`,reward:this.session.stageSpec.reward};this.session.commands.playCue("reward_commit");this.trace("reward_commit",detail);this.guardCompletionNavigation();window.dispatchEvent(new CustomEvent("aftersignal:reward-committed",{detail}));return true;}
    update(dt){if(!this.running)return;this.session.party.tick(dt);this.updateBossPhases(dt);if(this.integrity){this.integrity.value=Math.max(this.integrity.minimum??0,this.integrity.value-dt*this.enemies.length*(this.integrity.drainPerEnemyPerSecond||0));window.dispatchEvent(new CustomEvent("aftersignal:integrity-change",{detail:{stageId:this.stageId,integrity:this.integrity.value}}));if(this.integrity.value<=((this.integrity.minimum??0))&&this.enemies.length){this.running=false;this.qa.defeatEventCount++;this.trace("environment_failed",{integrity:this.integrity.value});this.session.emit("onBattleLost",{reason:"environment_integrity"});document.querySelector("#result")?.classList.remove("hidden");return;}}if(this.hitStop>0){this.hitStop-=dt;return}const selected=this.selected();for(const player of this.players){if(!player||player.member.state===F.PartyMemberState.DEAD)continue;player.cooldown=Math.max(0,player.cooldown-dt);player.member.ultimateGauge=clamp(player.member.ultimateGauge+dt*8,0,100);const controller=this.session.controllers.get(player.spec.id);controller?.update(dt,{x:player.x,y:player.y});if(controller?.clip.state!==F.CharacterState.FIRE)controller?.setState(player===selected?(this.pointer.down?F.CharacterState.AIM:F.CharacterState.STAND):F.CharacterState.AIM);const shouldFire=(this.isAutoControlled(player)&&this.enemies.some(enemy=>enemy.alive!==false&&enemy.hp>0))||(!this.isAutoControlled(player)&&this.pointer.down);this.advanceTrigger(player,dt,shouldFire);}for(const projectile of this.projectiles){projectile.px=projectile.x;projectile.py=projectile.y;projectile.x+=projectile.vx*dt;projectile.y+=projectile.vy*dt;projectile.age+=dt;const enemy=this.enemies.find(candidate=>this.projectileHitsEnemy(projectile,candidate));if(enemy){this.damage(enemy,projectile.heavy?Math.round(24+31*clamp(projectile.charge??1,0,1)):24,projectile.spec,projectile.owner);projectile.age=projectile.life;}}this.projectiles=this.projectiles.filter(projectile=>projectile.age<projectile.life&&projectile.x<this.width+80&&projectile.y>-80);this.impacts.forEach(impact=>impact.age+=dt);this.impacts=this.impacts.filter(impact=>impact.age<.7);this.ultimateFx.forEach(effect=>effect.age+=dt);this.ultimateFx=this.ultimateFx.filter(effect=>effect.age<effect.life);const requiredContributors=this.session.battleSpec.objective.minDistinctContributors||1;if(!this.enemies.length&&!this.completed&&this.waveContributors.size<requiredContributors){this.trace("contributor_gate_retry",{wave:this.wave+1,contributors:this.waveContributors.size,required:this.session.battleSpec.objective.minDistinctContributors||1});window.dispatchEvent(new CustomEvent("aftersignal:objective-contributor-retry",{detail:{stageId:this.stageId,wave:this.wave+1,contributors:this.waveContributors.size,required:this.session.battleSpec.objective.minDistinctContributors||1}}));this.spawnWave();}else if(!this.enemies.length&&this.wave<this.session.battleSpec.waves.length-1){const completedWave=this.wave+1;this.session.objective.progress=completedWave;this.session.emit("onObjectiveProgress",{id:this.session.objective.id,progress:completedWave,required:this.session.battleSpec.objective.requiredKills});this.trace("wave_clear",{wave:completedWave});window.dispatchEvent(new CustomEvent("aftersignal:objective-progress",{detail:{stageId:this.stageId,objectiveId:this.session.objective.id,progress:completedWave,required:this.session.objective.requiredKills}}));this.wave++;this.spawnWave();}else if(!this.enemies.length&&!this.completed){this.completed=true;this.qa.victoryEventCount++;this.session.objective.progress=this.session.battleSpec.objective.requiredKills||this.session.objective.progress;this.trace("battle_clear",{});this.session.commands.completeObjective();this.commitReward();this.session.emit("onBattleWon");this.session.present("onVictory");const result=document.querySelector("#result");if(result)result.classList.remove("hidden");}this.renderHud();this.renderDebug(dt);}
    publishRuntimeQa(dt){if(!this.runtimeQaNode)return;const controllers=this.session.controllers,lastProjectile=this.projectiles.at(-1),backgroundSet=STAGE_BACKGROUND_LAYERS[this.stageId];this.runtimeQaNode.textContent=JSON.stringify({stageId:this.stageId,devOnly:this.devOnly,running:this.running,terminalPaused:Boolean(this.terminalPaused),disposed:this.disposed,completed:this.completed,rewardCommitted:this.rewardCommitted,activeCombatLoopCount:this.qa.activeCombatLoopCount,legacyExecutionAttempts:window.__AF_LEGACY_EXECUTION_ATTEMPTS__||0,enemyDamageEventCount:this.qa.enemyDamageEventCount||0,manualRejectCount:this.qa.manualRejectCount||0,transientObjects:{playerProjectiles:this.projectiles.length,enemyProjectiles:this.enemyProjectiles.length,impacts:this.impacts.length,incomingImpacts:this.incomingImpacts.length,damageNumbers:this.damageNumbers.length,ultimateFx:this.ultimateFx.length,ultimateSequence:Boolean(this.ultimateSequence),muzzleFlashes:this.players.filter(Boolean).filter(player=>(player.muzzleFlashClock||0)>0).length},layout:{orientation:this.body.dataset.afCombatOrientation||"landscape",portraitPlayable:this.body.dataset.afPortraitPlayable||"supported",playerDepthBand:"PLAYER_FOREGROUND",groundEnemyMaxY:510,playerBaseline:Number(this.body.dataset.afResponsivePlayerBaseline||this.session.deployment.playerBaseline||614),formation:this.body.dataset.afPlayerFormation||null},memory:{...this.memory,retainedSources:this.images.size,retainedDecodedBytesEstimate:this.disposed?0:this.memory.decodedBytesEstimate},auto:this.auto,pointer:{x:Number(this.pointer.x.toFixed(2)),y:Number(this.pointer.y.toFixed(2)),down:Boolean(this.pointer.down)},players:this.players.filter(Boolean).map(player=>{const controller=controllers.get(player.spec.id),clips=player.spec.combatClips||{};return{id:player.spec.id,slot:player.slot,x:player.x,y:player.y,hp:Number(player.member.hp.toFixed(2)),maxHp:player.member.maxHp,shield:Number(player.member.shield.toFixed(2)),ammo:player.ammo,magazineSize:player.magazineSize,state:controller?.clip.state,stateTime:Number((controller?.clip.stateTime||0).toFixed(3)),coverRequested:Boolean(player.coverRequested),coverClock:Number((player.coverClock||0).toFixed(3)),reloadClock:Number((player.reloadClock||0).toFixed(3)),aimFrame:player.aimFrame||null,aimAngle:Number((player.aimAngle||0).toFixed(4)),aimLogicalFrame:player.aimLogicalFrame??null,muzzle:player.muzzle?{x:Number(player.muzzle.x.toFixed(2)),y:Number(player.muzzle.y.toFixed(2))}:null,battleSprite:player.spec.battleSprite,directionalAuthoredPoses:clips.FIRE_DIRECTIONAL_FRAMES?.length||0,directionalLogicalFrames:clips.FIRE_DIRECTIONAL_FRAME_COUNT||0,projectileId:player.spec.projectileId,projectileSilhouette:F.PROJECTILE_REGISTRY.get(player.spec.projectileId)?.silhouette||null,assetPolicy:player.spec.combatAssetPolicy||null,visualEnvelope:player.visualEnvelope||null}}),enemies:this.enemies.map(enemy=>({id:enemy.spec.id,x:Number(enemy.x.toFixed(2)),y:Number(enemy.y.toFixed(2)),originX:Number(enemy.originX.toFixed(2)),originY:Number(enemy.originY.toFixed(2)),poseDirection:enemy.poseDirection,depthBand:enemy.renderLayer||enemy.spec.depthBand,asset:enemy.spec.asset,hp:enemy.hp,maxHp:enemy.maxHp,attackKind:enemy.telegraphKind||enemy.spec.attack?.kind||null,attackTelegraph:Number((enemy.attackTelegraph||0).toFixed(3)),bossPhase:enemy.bossRuntime?.config?.phases?.[enemy.bossRuntime.phaseIndex]?.id||null,bossHasPendingNodes:enemy.bossRuntime?this.bossNodesRemaining(enemy):null,bossUnbrokenNodeCount:enemy.bossRuntime?enemy.bossRuntime.nodes.filter(node=>!node.broken).length:null})),playerProjectiles:this.projectiles.length,lastPlayerProjectile:lastProjectile?{ownerId:lastProjectile.owner?.spec?.id||null,projectileId:lastProjectile.spec?.id||null,silhouette:lastProjectile.spec?.silhouette||null,x:Number(lastProjectile.x.toFixed(2)),y:Number(lastProjectile.y.toFixed(2)),px:Number(lastProjectile.px.toFixed(2)),py:Number(lastProjectile.py.toFixed(2)),sourceX:Number(lastProjectile.sourceX.toFixed(2)),sourceY:Number(lastProjectile.sourceY.toFixed(2)),vx:Number(lastProjectile.vx.toFixed(2)),vy:Number(lastProjectile.vy.toFixed(2))}:null,enemyProjectiles:(this.enemyProjectiles||[]).length,ultimateSequence:this.ultimateSequence?{ownerId:this.ultimateSequence.owner.spec.id,ultimateId:this.ultimateSequence.ultimate.id,phase:this.ultimateSequence.phase,age:Number(this.ultimateSequence.age.toFixed(3)),battlefieldFxStarted:this.ultimateSequence.battlefieldFxStarted,damageApplied:this.ultimateSequence.damageApplied}:null,eventTrace:this.qa.eventTrace.slice(-32).map(entry=>entry.type),background:{contract:"FOUR_LAYER_PASS_RECOMPOSITION",compositeSha256:backgroundSet?.compositeSha256||null,layers:this.backgroundLayers().map(layer=>({...layer,loaded:Boolean(this.images.get(layer.source)?.naturalWidth)}))},dt:Number((dt||0).toFixed(4))});}
    renderDebug(dt){this.publishRuntimeQa(dt);if(!this.debug.enabled||!this.debugNode)return;this.debug.frameMs=dt*1000;this.debug.fps=dt>0?Math.round(1/dt):0;const active=this.selected(),boss=this.enemies.find(enemy=>enemy.bossRuntime),phase=boss?.bossRuntime?.config?.phases?.[boss.bossRuntime.phaseIndex],nodes=boss?.bossRuntime?.nodes||[],safe=getComputedStyle(document.documentElement).getPropertyValue("env(safe-area-inset-bottom)")||"runtime";const party=this.players.filter(Boolean).map(player=>`${player.spec.id}@S${player.slot+1} ${player.member.state} foot(${Math.round(player.x)},${Math.round(player.y)}) muzzle(${Math.round(player.x)},${Math.round(player.y-playerBodyPx(player)*.7)})`).join("\n");const trails=this.projectiles.slice(-3).map(projectile=>`${projectile.spec.ownerId}: visual(${Math.round(projectile.px)},${Math.round(projectile.py)}→${Math.round(projectile.x)},${Math.round(projectile.y)}) trail=${projectile.spec.trail.kind}/${projectile.spec.trail.width} collisionScale=${projectile.spec.collisionScale}`).join("\n")||"none";this.debugNode.textContent=`VISUAL QA · F3\nFPS ${this.debug.fps} / ${this.debug.frameMs.toFixed(1)}ms · safeBottom ${safe}\nACTIVE ${active?.spec.id||"none"} slot ${active?.slot+1||0}\n${party}\nPROJECTILE\n${trails}\nBOSS ${boss?.spec.id||"none"} phase ${phase?.id||"-"} elapsed ${(boss?.bossRuntime?.phaseElapsed||0).toFixed(2)} nodes ${nodes.filter(node=>!node.broken).length}/${nodes.length}\nHITSTOP ${(this.hitStop*1000).toFixed(0)}ms · CAMERA ${this.camera.toFixed(1)} · HUD ${this.hud?.getBoundingClientRect().height||0}px`;}
    draw(){const shake=this.camera>0?(Math.random()-.5)*this.camera:0;this.camera=Math.max(0,this.camera-.6);const ctx=this.ctx;ctx.save();ctx.translate(shake,shake);ctx.clearRect(-30,-30,this.width+60,this.height+60);const field=ctx.createLinearGradient(0,0,0,this.height);field.addColorStop(0,"#182942");field.addColorStop(.54,"#26394d");field.addColorStop(1,"#060c13");ctx.fillStyle=field;ctx.fillRect(0,0,this.width,this.height);this.enemies.forEach(enemy=>{const size=enemy.bossRuntime?.config?.renderSize||176;if(enemy.img?.complete)ctx.drawImage(enemy.img,enemy.x-size/2,enemy.y-size/2,size,size);else{ctx.fillStyle="#9d6680";ctx.beginPath();ctx.arc(enemy.x,enemy.y,size*.27,0,Math.PI*2);ctx.fill()}if(enemy.bossRuntime){const runtime=enemy.bossRuntime,phase=runtime.config.phases?.[runtime.phaseIndex];ctx.save();ctx.globalCompositeOperation="lighter";ctx.strokeStyle="rgba(196,135,255,.72)";ctx.shadowColor="#c281ff";ctx.shadowBlur=18;ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(enemy.x,enemy.y,size*.48,size*.5,0,0,Math.PI*2);ctx.stroke();runtime.nodes.forEach(node=>{if(node.broken)return;const x=enemy.x+node.offset[0],y=enemy.y+node.offset[1];ctx.fillStyle="#dca0ff";ctx.beginPath();ctx.arc(x,y,18,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#fff0ff";ctx.beginPath();ctx.arc(x,y,27,0,Math.PI*2);ctx.stroke()});if(!runtime.nodes.some(node=>!node.broken)){const glow=ctx.createRadialGradient(enemy.x,enemy.y,0,enemy.x,enemy.y,54);glow.addColorStop(0,"rgba(255,255,255,.95)");glow.addColorStop(.32,"rgba(124,244,255,.78)");glow.addColorStop(1,"transparent");ctx.fillStyle=glow;ctx.fillRect(enemy.x-58,enemy.y-58,116,116)}ctx.restore();ctx.fillStyle="#efe1ff";ctx.font="700 12px ui-monospace";ctx.textAlign="center";ctx.fillText(phase?.id||"BOSS",enemy.x,enemy.y-size*.58)}ctx.fillStyle="#081019";ctx.fillRect(enemy.x-54,enemy.y-size*.62,108,7);ctx.fillStyle="#ff7595";ctx.fillRect(enemy.x-54,enemy.y-size*.62,108*enemy.hp/enemy.maxHp,7)});this.players.forEach(player=>{if(!player)return;const image=this.images.get(player.spec.battleSprite);if(image?.complete)ctx.drawImage(image,player.x-82,player.y-178,164,202);ctx.fillStyle="#0008";ctx.beginPath();ctx.ellipse(player.x,player.y+4,43,8,0,0,Math.PI*2);ctx.fill()});this.projectiles.forEach(projectile=>F.CombatVfxRenderer.drawTrail(ctx,projectile));this.impacts.forEach(impact=>F.CombatVfxRenderer.drawImpact(ctx,impact));this.ultimateFx.forEach(effect=>this.drawUltimateFx(ctx,effect));ctx.restore();}
    drawUltimateFx(ctx,effect){const t=effect.age/effect.life,p=1-t,center={x:this.width*.5,y:this.height*.32},colors=effect.owner.spec.palette||["#fff","#8df","#f6a"],visual=effect.ultimate,primitives=visual.primitives||{};ctx.save();ctx.translate(center.x,center.y);ctx.globalCompositeOperation="lighter";ctx.globalAlpha=Math.max(0,p);if(visual.motifType==="HORIZON_ARC"){ctx.strokeStyle=colors[0];ctx.shadowColor=colors[0];ctx.shadowBlur=22;ctx.lineWidth=primitives.width||7;for(let index=-1;index<=1;index++){ctx.beginPath();ctx.moveTo(-(primitives.span||380),70+index*44);ctx.quadraticCurveTo(0,-35+index*44,primitives.span||380,70+index*44);ctx.stroke();}}else if(visual.motifType==="TRIANGULAR_LATTICE"){ctx.strokeStyle=colors[0];ctx.shadowColor=colors[0];ctx.shadowBlur=20;ctx.lineWidth=primitives.width||5;for(let index=0;index<(primitives.triangleCount||3);index++){ctx.rotate(Math.PI*2/(primitives.triangleCount||3));ctx.beginPath();ctx.moveTo(0,-(primitives.radius||190));ctx.lineTo((primitives.radius||190)*.86,(primitives.radius||190)*.58);ctx.lineTo(-(primitives.radius||190)*.86,(primitives.radius||190)*.58);ctx.closePath();ctx.stroke();}}else if(visual.motifType==="SPEAR_CORE_PETALS"){ctx.rotate(-Math.PI/2);const length=primitives.length||540,gradient=ctx.createLinearGradient(-length*.56,0,length*.44,0);gradient.addColorStop(0,"transparent");gradient.addColorStop(.55,colors[2]);gradient.addColorStop(.8,"#fffdf2");gradient.addColorStop(1,colors[0]);ctx.strokeStyle=gradient;ctx.shadowColor=colors[2];ctx.shadowBlur=32;ctx.lineWidth=primitives.width||24;ctx.beginPath();ctx.moveTo(-length*.56,0);ctx.lineTo(length*.44,0);ctx.stroke();for(let index=0;index<(primitives.petalCount||8);index++){ctx.rotate(Math.PI*2/(primitives.petalCount||8));ctx.fillStyle=colors[2];ctx.fillRect(length*.13,-5,length*.24,10);}}else{ctx.strokeStyle=colors[0];ctx.lineWidth=8;ctx.beginPath();ctx.arc(0,0,190,0,Math.PI*2);ctx.stroke();}ctx.restore();}
    save(){try{const enemies=this.enemies.map(enemy=>({id:enemy.id,enemyId:enemy.spec.id,x:enemy.x,y:enemy.y,originX:enemy.originX,originY:enemy.originY,renderLayer:enemy.renderLayer,hp:enemy.hp,maxHp:enemy.maxHp,radius:enemy.radius,displayMaxHp:enemy.displayMaxHp,bossRuntime:enemy.bossRuntime||null,motionTime:enemy.motionTime||0,attackClock:enemy.attackClock||0,attackTelegraph:enemy.attackTelegraph||0,telegraphTotal:enemy.telegraphTotal||0,telegraphKind:enemy.telegraphKind||null,attackPhase:enemy.attackPhase||0,attackSequence:enemy.attackSequence||0,poseDirection:enemy.poseDirection||"idle"}));const players=this.players.filter(Boolean).map(player=>({slot:player.slot,cooldown:player.cooldown||0,coverRequested:Boolean(player.coverRequested),coverClock:player.coverClock||0,reloadClock:player.reloadClock||0,ammo:player.ammo,magazineSize:player.magazineSize,smoothedAim:player.smoothedAim?{...player.smoothedAim}:null,reviveCharges:player.reviveCharges||0,reviveClock:player.reviveClock||0}));localStorage.setItem(`aftersignal:combat:${this.stageId}:v1`,JSON.stringify({schemaVersion:4,session:this.session.snapshot(),wave:this.wave,waveContributors:[...this.waveContributors],integrityValue:this.integrity?.value??null,timeRemainingMs:this.timeRemainingMs,timeLimitMs:this.timeLimitMs,enemies,players,completed:this.completed,rewardCommitted:this.rewardCommitted,qa:this.qa}))}catch{}}
    restore(){try{const saved=localStorage.getItem(`aftersignal:combat:${this.stageId}:v1`);if(!saved)return false;const state=JSON.parse(saved);if(![1,2,3,4].includes(state.schemaVersion??1))throw new Error(`Unsupported combat runner snapshot ${state.schemaVersion}`);this.session.restore(state.session);this.wave=Number.isInteger(state.wave)?state.wave:0;this.completed=Boolean(state.completed);this.rewardCommitted=Boolean(state.rewardCommitted);this.timeRemainingMs=Number.isFinite(state.timeRemainingMs)?clamp(state.timeRemainingMs,0,this.timeLimitMs):this.timeLimitMs;this.qa={...this.qa,...(state.qa||{})};window.__AF_COMMON_COMBAT_QA__=this.qa;this.waveContributors=new Set(state.waveContributors||[]);if(this.integrity&&Number.isFinite(state.integrityValue))this.integrity.value=state.integrityValue;this.enemies=(state.enemies||[]).map(savedEnemy=>{const spec=F.ENEMY_REGISTRY.get(savedEnemy.enemyId);if(!spec)throw new Error(`UNKNOWN_ENEMY:${savedEnemy.enemyId}`);const band=savedEnemy.renderLayer||spec.depthBand||"background1",fallbackBaseline=band==="background1"?this.height*.57:band==="background2"?this.height*.39:this.height*.27;return {...savedEnemy,spec,x:Number.isFinite(savedEnemy.x)?savedEnemy.x:this.width*.5,y:Number.isFinite(savedEnemy.y)?savedEnemy.y:fallbackBaseline,originX:Number.isFinite(savedEnemy.originX)?savedEnemy.originX:savedEnemy.x,originY:Number.isFinite(savedEnemy.originY)?savedEnemy.originY:savedEnemy.y,renderLayer:band,img:this.images.get(spec.asset),motionImages:Object.fromEntries(Object.entries(spec.motionAssets||{}).map(([direction,source])=>[direction,this.images.get(source)])),hit:0,motionTime:savedEnemy.motionTime||0,attackClock:savedEnemy.attackClock??(spec.attack?.cadence||2.2),attackTelegraph:savedEnemy.attackTelegraph||0,telegraphTotal:savedEnemy.telegraphTotal||0,telegraphKind:savedEnemy.telegraphKind||null,attackPhase:savedEnemy.attackPhase||0,attackSequence:savedEnemy.attackSequence||0,activeAttackId:null,alive:true,poseDirection:savedEnemy.poseDirection||"idle"};});for(const savedPlayer of state.players||[]){const player=this.players[savedPlayer.slot];if(!player)continue;player.cooldown=savedPlayer.cooldown||0;player.coverRequested=Boolean(savedPlayer.coverRequested);player.coverClock=savedPlayer.coverClock||0;player.reloadClock=savedPlayer.reloadClock||0;player.magazineSize=Math.max(1,Number(savedPlayer.magazineSize)||player.magazineSize);player.ammo=clamp(Number(savedPlayer.ammo??player.magazineSize),0,player.magazineSize);player.smoothedAim=savedPlayer.smoothedAim?{...savedPlayer.smoothedAim}:null;player.reviveCharges=Math.max(0,Number(savedPlayer.reviveCharges??player.reviveCharges)||0);player.reviveClock=Math.max(0,Number(savedPlayer.reviveClock)||0);}this.projectiles=[];this.enemyProjectiles=[];this.impacts=[];this.incomingImpacts=[];this.damageNumbers=[];this.ultimateFx=[];this.ultimateSequence=null;document.querySelector("#cutin")?.classList.remove("show");this.hitStop=0;this.camera=0;this.trace("resume",{wave:this.wave,enemies:this.enemies.length,timeRemainingMs:this.timeRemainingMs,discardedEnemyProjectiles:true,discardedScheduledDamage:true});this.renderTimer();this.renderHud();return true}catch(error){this.trace("resume_rejected",{message:String(error)});return false}}
    frame(now){if(this.disposed)return;const dt=Math.min(.05,(now-this.last||0)/1000);this.last=now;this.update(dt);this.hitStop=Math.max(0,this.hitStop);this.draw();if(!this.terminalPaused)this.rafId=requestAnimationFrame(this.frame);else this.rafId=0;}
    start(){this.qa.activeCombatLoopCount=1;this.trace("battle_start",{stageId:this.stageId,devOnly:this.devOnly});this.trace("bgm",{cue:"stage_default"});window.__AF_COMMON_COMBAT_QA__=this.qa;this.guardCompletionNavigation();this.__afRewardGuard=event=>{if(event.detail?.stageId!==this.stageId)return;this.__afRewardDetail=event.detail;event.stopImmediatePropagation();};this.listen(window,"aftersignal:reward-committed",this.__afRewardGuard,{capture:true});if(new URLSearchParams(location.search).has("qa"))this.listen(window,"aftersignal:qa-dispose",()=>this.dispose("qa-dom-event"),{once:true});this.rafId=requestAnimationFrame(this.frame);return this;}
    dispose(reason="navigation"){
      if(this.disposed)return false;
      const releasedSources=this.images.size,releasedDecodedBytesEstimate=this.memory.decodedBytesEstimate,releasedListeners=this.__afBoundListeners?.length||0,releasedTimeouts=this.__afPendingTimeouts?.size||0,releasedIdleCallbacks=this.__afPendingIdleCallbacks?.size||0;
      this.disposed=true;this.running=false;this.qa.activeCombatLoopCount=0;if(this.rafId)cancelAnimationFrame(this.rafId);this.rafId=0;for(const binding of this.__afBoundListeners||[]){try{binding.target.removeEventListener(binding.type,binding.handler,binding.options)}catch{}}this.__afBoundListeners=[];for(const timer of this.__afPendingTimeouts||[])clearTimeout(timer);this.__afPendingTimeouts?.clear?.();for(const pending of this.__afPendingIdleCallbacks||[]){try{pending.kind==="idle"&&typeof cancelIdleCallback==="function"?cancelIdleCallback(pending.handle):clearTimeout(pending.handle)}catch{}}this.__afPendingIdleCallbacks?.clear?.();try{this.__afPlatformUnsubscribe?.()}catch{}this.__afPlatformUnsubscribe=null;
      for(const image of this.images.values()){image.onload=null;image.onerror=null;try{image.removeAttribute("src");image.src="";}catch{}}
      this.images.clear();this.projectiles.length=0;this.enemyProjectiles.length=0;this.impacts.length=0;this.incomingImpacts.length=0;this.damageNumbers.length=0;this.ultimateFx.length=0;this.enemies.length=0;this.players.length=0;this.ultimateSequence=null;if(this.__afUltimateCompositeCanvas)this.__afUltimateCompositeCanvas.width=this.__afUltimateCompositeCanvas.height=1;this.__afUltimateCompositeCanvas=null;this.__afUltimateCompositeCtx=null;if(window.__AF_COMMON_COMBAT_RUNNER__===this)window.__AF_COMMON_COMBAT_RUNNER__=null;if(window.__AF_ACTIVE_RUNNER__===this)window.__AF_ACTIVE_RUNNER__=null;
      this.memory.releasedSources=(this.memory.releasedSources||0)+releasedSources;this.memory.releasedDecodedBytesEstimate=(this.memory.releasedDecodedBytesEstimate||0)+releasedDecodedBytesEstimate;this.memory.decodedBytesEstimate=0;const audit={stageId:this.stageId,reason,releasedSources,releasedDecodedBytesEstimate,releasedListeners,releasedTimeouts,releasedIdleCallbacks,retainedSources:0,retainedDecodedBytesEstimate:0,activeCombatLoopCount:0,activeListeners:0,activeTimeouts:0,activeIdleCallbacks:0,activeRafCount:0,ultimateCompositeCanvas:false,timestamp:Date.now()};this.lastDisposeAudit=audit;
      try{sessionStorage.setItem("aftersignal:last-combat-dispose:v1",JSON.stringify(audit));}catch{}
      this.trace("combat_dispose",audit);this.publishRuntimeQa(0);if(this.runtimeQaNode){try{const report=JSON.parse(this.runtimeQaNode.textContent||"{}");report.disposeAudit=audit;this.runtimeQaNode.textContent=JSON.stringify(report)}catch{}}return true;
    }
  }
  // Runtime asset budget: directional combat frames are requested only when a
  // pose is actually presented.  The old eager path decoded 32 large frames
  // for every party member and then duplicated them into full-size canvases.
  CommonCombatRunner.prototype.pumpSpriteDecodeQueue=function(){
    if(this.disposed)return;this.spriteDecodeQueue=this.spriteDecodeQueue||[];this.spriteDecodeActive=this.spriteDecodeActive||0;
    while(this.spriteDecodeActive<2&&this.spriteDecodeQueue.length){const item=this.spriteDecodeQueue.shift();if(!item?.image||item.image.__afDecodeStarted)continue;item.image.__afDecodeStarted=true;item.image.__afQueuedDecode=true;this.spriteDecodeActive++;item.image.src=item.source;}
  };
  CommonCombatRunner.prototype.promoteSpriteDecode=function(source){
    const queue=this.spriteDecodeQueue||[],index=queue.findIndex(item=>item.source===source);if(index>0){const [item]=queue.splice(index,1);queue.unshift(item);}this.pumpSpriteDecodeQueue();
  };
  CommonCombatRunner.prototype.requestAsset=function(source,priority=false){
    if(!source)return null;if(this.images.has(source)){const cached=this.images.get(source);if(priority&&!cached?.__afDecodeStarted)this.promoteSpriteDecode(source);return cached||null;}
    const image=new Image();image.decoding="async";const settleDecode=()=>{if(!image.__afQueuedDecode||image.__afDecodeSettled)return;image.__afDecodeSettled=true;this.spriteDecodeActive=Math.max(0,(this.spriteDecodeActive||0)-1);this.pumpSpriteDecodeQueue();};image.onload=()=>{if(!image.__afCounted){image.__afCounted=true;const bytes=Math.max(0,image.naturalWidth*image.naturalHeight*4);image.__afDecodedBytes=bytes;this.memory.loadedSources++;this.memory.decodedBytesEstimate+=bytes;const policy=this.spriteAssetPolicies?.get(source);if(policy?.chromaKey)this.enqueueSpritePreprocess(source,policy);else if(this.enemyAssetSources?.has(source))this.enqueueEnemyPreprocess(source,image);this.publishRuntimeQa(0);}settleDecode();};image.onerror=()=>{this.memory.failedSources++;this.publishRuntimeQa(0);settleDecode();};this.images.set(source,image);this.memory.requestedSources++;
    const policy=this.spriteAssetPolicies?.get(source);if(policy?.chromaKey){this.spriteDecodeQueue=this.spriteDecodeQueue||[];const item={source,image};if(priority)this.spriteDecodeQueue.unshift(item);else this.spriteDecodeQueue.push(item);this.pumpSpriteDecodeQueue();}else{image.__afDecodeStarted=true;image.src=source;}return image;
  };
  CommonCombatRunner.prototype.enqueueSpritePreprocess=function(source,policy){
    if(!source||!policy?.chromaKey||this.disposed||this.chromaSprites?.has(source))return false;this.spriteAssetPolicies=this.spriteAssetPolicies||new Map();this.spriteAssetPolicies.set(source,policy);this.spritePreprocessQueue=this.spritePreprocessQueue||[];if(!this.spritePreprocessQueue.includes(source))this.spritePreprocessQueue.push(source);if(this.__afSpritePreprocessScheduled)return true;this.__afSpritePreprocessScheduled=true;
    const run=deadline=>{this.__afSpritePreprocessScheduled=false;if(this.disposed)return;const queued=this.spritePreprocessQueue?.shift();if(queued){const queuedPolicy=this.spriteAssetPolicies?.get(queued);this.renderableSprite(queued,queuedPolicy,true);this.qa.spriteIdleProcessed=(this.qa.spriteIdleProcessed||0)+1;}if(this.spritePreprocessQueue?.length){this.__afSpritePreprocessScheduled=true;this.scheduleIdle(run,{timeout:250,fallbackDelay:32});}};
    this.scheduleIdle(run,{timeout:250,fallbackDelay:32});return true;
  };
  CommonCombatRunner.prototype.prepareEnemySprite=function(source,image){
    if(!source||!image?.complete||!image.naturalWidth||image.__afEnemyPrepared||this.disposed)return null;
    const forceReadbackFallback=(()=>{try{return new URLSearchParams((window.top===window.self?window.location:window.top.location).search).get("assetfallback")==="1"}catch{return false}})();if(forceReadbackFallback){image.__afEnemyPreparationBypassed=true;this.qa.enemyReadbackBypassed=(this.qa.enemyReadbackBypassed||0)+1;return image;}
    const sourceWidth=image.naturalWidth,sourceHeight=image.naturalHeight,scanScale=Math.min(1,384/Math.max(sourceWidth,sourceHeight)),scan=document.createElement("canvas");scan.width=Math.max(1,Math.round(sourceWidth*scanScale));scan.height=Math.max(1,Math.round(sourceHeight*scanScale));const scanCtx=scan.getContext("2d",{willReadFrequently:true});scanCtx.drawImage(image,0,0,scan.width,scan.height);
    let minX=scan.width,minY=scan.height,maxX=-1,maxY=-1;try{const pixels=scanCtx.getImageData(0,0,scan.width,scan.height).data;for(let offset=3;offset<pixels.length;offset+=4){if(pixels[offset]<12)continue;const index=(offset-3)/4,x=index%scan.width,y=(index-x)/scan.width;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}catch{image.__afEnemyPreparationBypassed=true;this.qa.enemyReadbackBypassed=(this.qa.enemyReadbackBypassed||0)+1;scan.width=scan.height=1;return image}if(maxX<minX){image.__afEnemyPreparationBypassed=true;scan.width=scan.height=1;return image;}
    const pad=2,left=Math.max(0,minX-pad),top=Math.max(0,minY-pad),right=Math.min(scan.width,maxX+pad+1),bottom=Math.min(scan.height,maxY+pad+1),sourceLeft=left/scanScale,sourceTop=top/scanScale,sourceCropWidth=(right-left)/scanScale,sourceCropHeight=(bottom-top)/scanScale,outputScale=Math.min(1,512/Math.max(sourceCropWidth,sourceCropHeight)),outputScaleHi=Math.max(outputScale,Math.min(1,512*(this.__afHiresEnemyMul||1)/Math.max(sourceCropWidth,sourceCropHeight))),sprite=document.createElement("canvas");sprite.width=Math.max(1,Math.round(sourceCropWidth*outputScaleHi));sprite.height=Math.max(1,Math.round(sourceCropHeight*outputScaleHi));const spriteCtx=sprite.getContext("2d");spriteCtx.imageSmoothingEnabled=true;spriteCtx.imageSmoothingQuality="high";spriteCtx.drawImage(image,sourceLeft,sourceTop,sourceCropWidth,sourceCropHeight,0,0,sprite.width,sprite.height);sprite.__afEnemyPrepared=true;sprite.__afSourceRect={left:0,top:0,width:sprite.width,height:sprite.height};sprite.__afCrop={left:sourceLeft,top:sourceTop,width:sourceCropWidth,height:sourceCropHeight,naturalWidth:sourceWidth,naturalHeight:sourceHeight};/* COMBAT_ENEMY_LIVE2D_V1 */scan.width=scan.height=1;
    const originalBytes=image.__afDecodedBytes||sourceWidth*sourceHeight*4,cachedBytes=sprite.width*sprite.height*4;image.onload=image.onerror=null;try{image.removeAttribute("src");image.src="";}catch{}this.memory.releasedSources++;this.memory.releasedDecodedBytesEstimate+=originalBytes;this.memory.decodedBytesEstimate=Math.max(0,this.memory.decodedBytesEstimate-originalBytes)+cachedBytes;this.images.set(source,sprite);this.enemySpriteOrder=this.enemySpriteOrder||[];this.enemySpriteOrder.push(source);
    while(this.enemySpriteOrder.length>28){const evictedSource=this.enemySpriteOrder.shift(),evicted=this.images.get(evictedSource);if(!evicted?.__afEnemyPrepared)continue;this.images.delete(evictedSource);this.memory.decodedBytesEstimate=Math.max(0,this.memory.decodedBytesEstimate-(evicted.width||0)*(evicted.height||0)*4);evicted.width=evicted.height=1;}return sprite;
  };
  CommonCombatRunner.prototype.enqueueEnemyPreprocess=function(source,image){
    if(!source||!image||image.__afEnemyPrepared||this.disposed)return false;this.enemyPreprocessQueue=this.enemyPreprocessQueue||[];if(!this.enemyPreprocessQueue.some(item=>item.source===source))this.enemyPreprocessQueue.push({source,image});if(this.__afEnemyPreprocessScheduled)return true;this.__afEnemyPreprocessScheduled=true;const run=()=>{this.__afEnemyPreprocessScheduled=false;if(this.disposed)return;const item=this.enemyPreprocessQueue?.shift();if(item&&this.images.get(item.source)===item.image){const sprite=this.prepareEnemySprite(item.source,item.image);if(sprite)this.qa.enemyIdleProcessed=(this.qa.enemyIdleProcessed||0)+1;}if(this.enemyPreprocessQueue?.length){this.__afEnemyPreprocessScheduled=true;this.scheduleIdle(run,{timeout:320,fallbackDelay:40});}};this.scheduleIdle(run,{timeout:320,fallbackDelay:40});return true;
  };
  CommonCombatRunner.prototype.loadAssets=function(){
    this.spriteAssetPolicies=this.spriteAssetPolicies||new Map();const enemyIds=[...this.session.battleSpec.waves.flatMap(wave=>wave.enemyIds||[]),this.session.battleSpec.boss?.id],playerSources=this.session.partySpec.slots.flatMap(slot=>{const spec=slot.spec,clips=spec?.combatClips||{},directional=clips.FIRE_DIRECTIONAL_FRAMES||[],sequence=clips.REAR_COVER_FIRE_RETURN_FRAMES||[],center=directional.length?directional[Math.floor(directional.length/2)]:null,sources=[spec?.battleSprite,clips.STAND,clips.AIM,clips.COVER_HOLD,clips.RELOAD,center,...sequence].filter(Boolean);for(const source of sources)this.spriteAssetPolicies.set(source,spec?.combatAssetPolicy||{});return sources;}),enemySources=enemyIds.flatMap(id=>{const spec=F.ENEMY_REGISTRY.get(id);return[spec?.asset]}).filter(Boolean);this.enemyAssetSources=this.enemyAssetSources||new Set();for(const id of enemyIds){const spec=F.ENEMY_REGISTRY.get(id);for(const source of [spec?.asset,...Object.values(spec?.motionAssets||{})].filter(Boolean))this.enemyAssetSources.add(source);}[...this.backgroundSources(),...playerSources,...enemySources].filter(Boolean).forEach(source=>this.requestAsset(source));
  };
  const coreDrawBackgroundLayers=CommonCombatRunner.prototype.drawBackground;
  CommonCombatRunner.prototype.drawBackground=function(ctx){
    if(this.backgroundComposite){ctx.drawImage(this.backgroundComposite,0,0,this.width,this.height);return;}
    const layers=this.backgroundLayers(),ready=layers.length&&layers.every(layer=>{const image=this.images.get(layer.source);return image?.complete&&image.naturalWidth;});
    if(!ready){coreDrawBackgroundLayers.call(this,ctx);return;}
    const composite=document.createElement("canvas");composite.width=this.width;composite.height=this.height;const compositeCtx=composite.getContext("2d"),sourceHeight=960,scaleY=this.height/sourceHeight;
    for(const layer of layers){const image=this.images.get(layer.source),y=layer.placementY*scaleY,nextY=(layer.placementY+240)*scaleY;compositeCtx.drawImage(image,0,y,this.width,nextY-y+1);}
    this.backgroundComposite=composite;this.memory.backgroundCompositeBytes=this.width*this.height*4;ctx.drawImage(composite,0,0,this.width,this.height);
  };
  const coreDisposeWithSpriteCache=CommonCombatRunner.prototype.dispose;
  CommonCombatRunner.prototype.dispose=function(reason="navigation"){
    for(const sprite of this.chromaSprites?.values?.()||[]){const bytes=(sprite.width||0)*(sprite.height||0)*4;this.memory.decodedBytesEstimate=Math.max(0,this.memory.decodedBytesEstimate-bytes);sprite.width=sprite.height=1;}this.chromaSprites?.clear?.();this.chromaSpriteOrder=[];
    for(const raster of this.runtimeRasterCache?.values?.()||[]){try{raster.width=raster.height=1}catch{}}this.runtimeRasterCache?.clear?.();this.runtimeRasterOrder=[];this.memory.runtimeRasterBytes=0;this.memory.runtimeRasterSurfaces=0;
    this.spritePreprocessQueue=[];this.spriteDecodeQueue=[];this.spriteDecodeActive=0;this.enemyPreprocessQueue=[];this.enemySpriteOrder=[];this.enemyAssetSources?.clear?.();this.spriteAssetPolicies?.clear?.();this.__afSpritePreprocessScheduled=false;this.__afEnemyPreprocessScheduled=false;
    if(this.backgroundComposite){this.backgroundComposite.width=this.backgroundComposite.height=1;this.backgroundComposite=null;this.memory.backgroundCompositeBytes=0;}
    const disposed=coreDisposeWithSpriteCache.call(this,reason);if(disposed&&currentRunner===this)currentRunner=null;return disposed;
  };
  CommonCombatRunner.prototype.frame=function(now){
    if(this.disposed)return;const profile=window.AfterSignalPlatform?.performance?.get?.()||"MID",targetFps=profile==="LOW"?24:profile==="HIGH"?60:30,interval=1000/targetFps;
    // Present against a monotonic deadline with enough tolerance for a 100 Hz
    // host to alternate 10/20 ms callbacks into a true ~60 Hz stream. The old
    // 0.1 ms tolerance rejected the near-deadline callback and repeatedly
    // doubled cadence to 32 ms; drawing every RAF instead wastes CPU at 100 Hz.
    const deadlineTolerance=profile==="HIGH"?2.25:.75;
    if(!this.__afNextFrameAt||now-this.__afNextFrameAt>interval*4)this.__afNextFrameAt=now;
    if(now+deadlineTolerance<this.__afNextFrameAt){this.rafId=requestAnimationFrame(this.frame);return;}
    while(this.__afNextFrameAt<=now+deadlineTolerance)this.__afNextFrameAt+=interval;
    const frameIntervalMs=this.last?now-this.last:0,dt=Math.min(.05,frameIntervalMs/1000);if(frameIntervalMs>0){const stats=this.frameIntervalStats||(this.frameIntervalStats={count:0,totalMs:0,maxMs:0,longFrameCount:0,buckets:Array(101).fill(0)});stats.count++;stats.totalMs+=frameIntervalMs;stats.maxMs=Math.max(stats.maxMs,frameIntervalMs);if(frameIntervalMs>50)stats.longFrameCount++;stats.buckets[Math.min(100,Math.floor(frameIntervalMs/2))]++;}
    this.last=now;const updateStarted=performance.now();this.update(dt);const drawStarted=performance.now();this.hitStop=Math.max(0,this.hitStop);this.draw();const frameEnded=performance.now(),costs=this.frameCostStats||(this.frameCostStats={count:0,updateTotalMs:0,drawTotalMs:0,maxUpdateMs:0,maxDrawMs:0});costs.count++;const updateMs=drawStarted-updateStarted,drawMs=frameEnded-drawStarted;costs.updateTotalMs+=updateMs;costs.drawTotalMs+=drawMs;costs.maxUpdateMs=Math.max(costs.maxUpdateMs,updateMs);costs.maxDrawMs=Math.max(costs.maxDrawMs,drawMs);if(!this.terminalPaused)this.rafId=requestAnimationFrame(this.frame);else this.rafId=0;
  };
  const coreRestoreWithoutScheduledDamage=CommonCombatRunner.prototype.restore;
  CommonCombatRunner.prototype.restore=function(){
    const restored=coreRestoreWithoutScheduledDamage.call(this);
    if(!restored)return restored;
    const wave=this.session.battleSpec.waves[this.wave]||{enemyIds:[]},rules=this.session.battleSpec.rules||{},bossJoins=this.session.battleSpec.boss?.spawnWithWave===this.wave?1:0;
    this.wavePressureCount=Math.max(1,wave.enemyIds.length+bossJoins);this.wavePressureScale=Math.min(1,Math.max(1,Number(rules.enemyPressureBudget)||this.wavePressureCount)/this.wavePressureCount);
    for(const enemy of this.enemies){const cadence=enemy.spec.attack?.cadence||2.2;enemy.attackClock=Math.max(enemy.attackClock||0,cadence*.35);enemy.attackTelegraph=0;enemy.telegraphTotal=0;enemy.telegraphKind=null;enemy.activeAttackId=null;enemy.alive=true;}
    this.enemyProjectiles.length=0;this.trace("resume_scheduled_damage_cancelled",{enemies:this.enemies.length,queuedProjectiles:0});return true;
  };
  // Legacy draw has the stage field fill inlined.  Intercept only that full-canvas
  // fill and replace it with the authored stage layers; UI/enemy health fills keep
  // their normal canvas behavior.
  // Render the production depth contract directly.  This replaces the old
  // fillRect interception, which made every enemy share the legacy draw pass.
  const enemySourceRect=(runner,image)=>{
    const naturalWidth=image?.naturalWidth||image?.width||0,naturalHeight=image?.naturalHeight||image?.height||0;if(!image||!naturalWidth||!naturalHeight||(typeof image.complete==="boolean"&&!image.complete))return null;if(image.__afSourceRect)return image.__afSourceRect;
    runner.enemySourceRects=runner.enemySourceRects||new WeakMap();
    if(runner.enemySourceRects.has(image))return runner.enemySourceRects.get(image);
    const sourceWidth=naturalWidth,sourceHeight=naturalHeight,scanScale=Math.min(1,384/Math.max(sourceWidth,sourceHeight)),work=document.createElement("canvas");work.width=Math.max(1,Math.round(sourceWidth*scanScale));work.height=Math.max(1,Math.round(sourceHeight*scanScale));const workCtx=work.getContext("2d",{willReadFrequently:true});workCtx.drawImage(image,0,0,work.width,work.height);
    let rect={left:0,top:0,width:sourceWidth,height:sourceHeight};
    try{const pixels=workCtx.getImageData(0,0,work.width,work.height).data;let minX=work.width,minY=work.height,maxX=-1,maxY=-1;for(let offset=3;offset<pixels.length;offset+=4){if(pixels[offset]<12)continue;const index=(offset-3)/4,x=index%work.width,y=(index-x)/work.width;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}if(maxX>=minX){const pad=2,left=Math.max(0,minX-pad),top=Math.max(0,minY-pad),right=Math.min(work.width,maxX+pad+1),bottom=Math.min(work.height,maxY+pad+1);rect={left:left/scanScale,top:top/scanScale,width:(right-left)/scanScale,height:(bottom-top)/scanScale};}}catch{}
    work.width=work.height=1;runner.enemySourceRects.set(image,rect);return rect;
  };
  const decodedRenderable=image=>Boolean(image&&((image.width>1&&typeof image.complete!=="boolean")||(image.complete&&(image.naturalWidth||image.width)>1)));
  const enemyVisualMetrics=(runner,enemy)=>{
    // Runtime alpha-cropping is an optional memory optimisation, never an
    // authority gate. file:// and strict embedded clients may forbid canvas
    // readback while still allowing the decoded PNG to be drawn safely.
    const size=enemy.bossRuntime?.config?.renderSize||196*enemyBandScale(runner,enemy)*(enemy.afDepthScale||1),image=decodedRenderable(enemy.img)?enemy.img:null,rect=image?enemySourceRect(runner,image):null,aspect=rect?rect.width/rect.height:1,drawWidth=aspect>=1?size:size*aspect,drawHeight=aspect>=1?size/aspect:size;
    return {size,image,rect,drawWidth,drawHeight,left:enemy.x-drawWidth/2,top:enemy.y-drawHeight,centerX:enemy.x,centerY:enemy.y-drawHeight*.5};
  };
  // PERF FIX 2026-09-23: the boss bar called this every frame, forcing a synchronous DOM layout read
  // (canvas + header rects). The header layout only changes on resize/HUD changes; cache for 500 ms.
  const combatUpperSafeY=runner=>{
    const now=performance.now(),cache=runner.__afUpperSafeCache;
    if(cache&&now-cache.at<500&&cache.w===runner.width&&cache.h===runner.height)return cache.value;
    const value=combatUpperSafeYUncached(runner);runner.__afUpperSafeCache={at:now,w:runner.width,h:runner.height,value};return value;
  };
  const combatUpperSafeYUncached=runner=>{
    const canvasRect=runner.canvas?.getBoundingClientRect?.(),candidates=[...document.querySelectorAll(".topbar,.hud-top,.mission,#af-battle-timer")];
    let headerBottom=0;
    if(canvasRect?.height){const scaleY=runner.height/canvasRect.height;for(const node of candidates){const rect=node.getBoundingClientRect?.();if(!rect||rect.bottom<=canvasRect.top||rect.top>=canvasRect.bottom)continue;headerBottom=Math.max(headerBottom,(rect.bottom-canvasRect.top)*scaleY);}}
    return Math.min(runner.height*.34,Math.max(105,headerBottom+10));
  };
  CommonCombatRunner.prototype.enemyAimPoint=function(enemy){const metrics=enemyVisualMetrics(this,enemy);return{x:metrics.centerX,y:metrics.centerY};};
  CommonCombatRunner.prototype.projectileHitForEnemy=function(projectile,enemy){
    const metrics=enemyVisualMetrics(this,enemy),padding=this.projectileCollisionRadius(projectile),rx=Math.max(enemy.radius||0,metrics.drawWidth*.38)+padding,ry=Math.max(enemy.radius||0,metrics.drawHeight*.43)+padding;
    const ax=(projectile.px-metrics.centerX)/rx,ay=(projectile.py-metrics.centerY)/ry,bx=(projectile.x-metrics.centerX)/rx,by=(projectile.y-metrics.centerY)/ry,dx=bx-ax,dy=by-ay,lengthSq=dx*dx+dy*dy||1,t=clamp(-(ax*dx+ay*dy)/lengthSq,0,1),closestX=ax+dx*t,closestY=ay+dy*t;
    if(closestX*closestX+closestY*closestY>1)return null;
    const hit={x:projectile.px+(projectile.x-projectile.px)*t,y:projectile.py+(projectile.y-projectile.py)*t,centerX:metrics.centerX,centerY:metrics.centerY,radiusX:rx,radiusY:ry};enemy.lastHitPoint=hit;enemy.lastHitShotId=projectile.shotId||null;enemy.lastHitSourceAtFire=projectile.sourceAtFire||null;return hit;
  };
  const drawEnemyPlane=(runner,ctx,enemy)=>{
    const {size,image,rect,drawWidth,drawHeight}=enemyVisualMetrics(runner,enemy);
    if(!(image&&rect&&(image.naturalWidth||image.width))){
      // A sprite requested during the opening frames must not leave a floating
      // shadow, HP bar or hit marker before its body is decoded.
      runner.qa.enemyVisualPendingFrames=(runner.qa.enemyVisualPendingFrames||0)+1;
      const base=runner.images.get(enemy.spec.asset);
      if(base?.complete&&!base.naturalWidth)runner.qa.missingEnemyVisualFrames=(runner.qa.missingEnemyVisualFrames||0)+1;
      return;
    }
    ctx.fillStyle="#0007";ctx.beginPath();ctx.ellipse(enemy.x,enemy.y+3,Math.max(28,drawWidth*.28),Math.max(6,drawHeight*.055),0,0,Math.PI*2);ctx.fill();
    // COMBAT_ENEMY_LIVE2D_V1 (2026-09-28): rigged enemies (CH06+) are drawn by the enemy Live2D renderer.
    if(!(typeof window!=="undefined"&&window.AfterSignalEnemyLive2D?.draw?.(runner,ctx,enemy,image,rect,enemy.x-drawWidth/2,enemy.y-drawHeight,drawWidth,drawHeight)))ctx.drawImage(image,rect.left,rect.top,rect.width,rect.height,enemy.x-drawWidth/2,enemy.y-drawHeight,drawWidth,drawHeight);
    if(enemy.attackTelegraph>0){const total=Math.max(.01,enemy.telegraphTotal||enemy.attackTelegraph),charge=1-enemy.attackTelegraph/total,pulse=.55+.45*Math.sin(charge*Math.PI*8),kind=enemy.telegraphKind||"signal_orb",target=(()=>{const alive=runner.players.filter(player=>player&&player.member.hp>0&&player.member.targetable!==false);return alive.length?alive[Math.max(0,(enemy.attackSequence||1)-1)%alive.length]:runner.selected();})();ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=.48+.42*charge;ctx.strokeStyle=kind==="signal_erase_wave"?"#ff3c8d":kind==="core_line"?"#fff1c7":kind==="plate_lance"?"#ff9b54":"#ff617d";if(epicEnabled){const glowColor=ctx.strokeStyle;epicGlowAt(ctx,enemy.x,enemy.y-drawHeight*.48,24+38*charge,glowColor,.5+.4*charge);ctx.globalAlpha=.48+.42*charge;}else{ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=18+22*charge;}ctx.lineWidth=3+4*charge;if(kind==="core_line"||kind==="plate_lance"){ctx.beginPath();ctx.moveTo(enemy.x,enemy.y-drawHeight*.48);ctx.lineTo(target?.x??enemy.x,target?target.y-playerBodyPx(target)*.6:enemy.y+240);ctx.stroke();}else if(kind==="signal_erase_wave"){for(let ring=0;ring<3;ring++){ctx.beginPath();ctx.arc(enemy.x,enemy.y-drawHeight*.42,28+(ring+charge)*25,0,Math.PI*2);ctx.stroke();}}else{ctx.beginPath();ctx.arc(enemy.x,enemy.y-drawHeight*.48,22+charge*30*pulse,0,Math.PI*2);ctx.stroke();}ctx.restore();}
    if(enemy.bossRuntime){
      const runtime=enemy.bossRuntime,phase=runtime.config.phases?.[runtime.phaseIndex],bossCenterX=enemy.x,bossCenterY=enemy.y-drawHeight*.5;
      ctx.save();ctx.globalCompositeOperation="lighter";ctx.strokeStyle="rgba(196,135,255,.72)";ctx.shadowColor="#c281ff";ctx.shadowBlur=18;ctx.lineWidth=4;
      ctx.beginPath();ctx.ellipse(bossCenterX,bossCenterY,size*.48,size*.5,0,0,Math.PI*2);ctx.stroke();
      runtime.nodes.forEach(node=>{if(node.broken)return;const x=bossCenterX+node.offset[0],y=bossCenterY+node.offset[1];ctx.fillStyle="#dca0ff";ctx.beginPath();ctx.arc(x,y,18,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#fff0ff";ctx.beginPath();ctx.arc(x,y,27,0,Math.PI*2);ctx.stroke();});
      if(!runtime.nodes.some(node=>!node.broken)){const glow=ctx.createRadialGradient(bossCenterX,bossCenterY,0,bossCenterX,bossCenterY,54);glow.addColorStop(0,"rgba(255,255,255,.95)");glow.addColorStop(.32,"rgba(124,244,255,.78)");glow.addColorStop(1,"transparent");ctx.fillStyle=glow;ctx.fillRect(bossCenterX-58,bossCenterY-58,116,116);}
      ctx.restore();ctx.fillStyle="#efe1ff";ctx.font="700 12px ui-monospace";ctx.textAlign="center";ctx.fillText(phase?.id||"BOSS",bossCenterX,bossCenterY-size*.58);
    }
    if(!enemy.bossRuntime){const hpY=enemy.y-drawHeight-13;ctx.fillStyle="#081019";ctx.fillRect(enemy.x-54,hpY,108,7);ctx.fillStyle="#ff7595";ctx.fillRect(enemy.x-54,hpY,108*Math.max(0,enemy.hp/enemy.maxHp),7);}
  };
  const drawBossHud=(runner,ctx)=>{
    const boss=runner.enemies.find(enemy=>enemy.alive!==false&&enemy.bossRuntime);if(!boss)return;
    const ratio=Math.max(0,Math.min(1,boss.maxHp?boss.hp/boss.maxHp:0)),barWidth=Math.min(332,runner.width*.34),barHeight=11,x=(runner.width-barWidth)/2,y=combatUpperSafeY(runner)+8,phase=boss.bossRuntime.config.phases?.[boss.bossRuntime.phaseIndex]?.id||"BOSS";
    ctx.save();ctx.textAlign="center";ctx.font="900 10px ui-monospace";ctx.strokeStyle="#03070dcc";ctx.lineWidth=4;ctx.strokeText(`${phase} · HP ${Math.ceil(boss.hp)} / ${boss.maxHp}`,runner.width*.5,y-5);ctx.fillStyle="#f7eeff";ctx.fillText(`${phase} · HP ${Math.ceil(boss.hp)} / ${boss.maxHp}`,runner.width*.5,y-5);
    ctx.fillStyle="#030913e8";ctx.fillRect(x-2,y-2,barWidth+4,barHeight+4);ctx.strokeStyle="#c99aff";ctx.lineWidth=1.5;ctx.strokeRect(x-.5,y-.5,barWidth+1,barHeight+1);const fill=ctx.createLinearGradient(x,0,x+barWidth,0);fill.addColorStop(0,"#ff4d88");fill.addColorStop(.62,"#ff8cc8");fill.addColorStop(1,"#fff3b0");ctx.fillStyle=fill;ctx.fillRect(x,y,barWidth*ratio,barHeight);ctx.restore();
  };
  const coreDamage=CommonCombatRunner.prototype.damage;
  const SFX_TRACKS={
    mira_fire:{srcs:["e63645efe5d106a443ce.flac","dd81e41a7474d6215d99.flac","3963a6561ff70752bd3c.flac"],gain:.29,cooldownMs:62},
    mira_impact:{srcs:["78b154f33115aaa47c2f.flac","6f667d831b56193ff7b5.flac","f96033277b1c244d0fa7.flac"],gain:0.38,cooldownMs:42},
    haneul_fire:{srcs:["dd81e41a7474d6215d99.flac","3963a6561ff70752bd3c.flac"],gain:.27,cooldownMs:54},
    haneul_impact:{srcs:["279044b571ebafbf7a1d.flac","f51794107c5fe13ba971.flac","6c7245ff3d31b417a64e.flac"],gain:0.39,cooldownMs:42},
    sera_fire:{srcs:["3963a6561ff70752bd3c.flac","e63645efe5d106a443ce.flac"],gain:.34,cooldownMs:70},
    sera_impact:{srcs:["9c035c19608bd93b30a9.flac","a7e9e32812169367ee82.flac","f20bb21081f5c90bf6d8.flac"],gain:0.38,cooldownMs:42},
    hit_critical:{srcs:["c692643c5c2d6c3f3b62.flac","3073e7023c69c302e0b5.flac","d0c74554ddd8f53121ad.flac"],gain:.49,cooldownMs:56},
    hit_core:{srcs:["c9dc33ebb7bf0dea9254.flac","58c61d9ae2b67886feca.flac","68d537931bc98fdeb282.flac"],gain:.57,cooldownMs:64},
    player_shield:{srcs:["03c2fb365c0d1b9c2e21.flac","aa6b37224ba0c6f6988a.flac","53c986642a1340b696b6.flac"],gain:.48,cooldownMs:82},
    player_hp:{srcs:["6976ae2c903e2c28d447.flac","74a937558e3ee4fcc80c.flac","89205cd1f1a198a658bf.flac"],gain:.57,cooldownMs:92},
    ultimate:{srcs:["498ccd410fe89b216e12.flac"],gain:.62,cooldownMs:900},
    karin_fire:{srcs:["6bf647047848bae51e22.flac","0c2d269b2d4cb43ec9a8.flac","e12186a5a8d551f41748.flac"],gain:0.29,cooldownMs:62},
    karin_impact:{srcs:["7e6405b32ea2e7026289.flac","e868b1bd9d16bf270833.flac","386cb4f3c884fc0bdee3.flac"],gain:0.39,cooldownMs:42},
    karin_crit:{srcs:["0e5a014bea190b404f74.flac","d4de7a57be5bb9400c88.flac","39327dd97b2ae1dfdde5.flac"],gain:0.51,cooldownMs:56},
    karin_ult:{srcs:["4e7f13c1a12fc64e7ddf.flac"],gain:0.62,cooldownMs:900},
    serin_fire:{srcs:["c4f57c948af7e0088391.flac","c58094cbd7d8db0fb473.flac","c15bbd5d1f2cd2708e04.flac"],gain:0.33,cooldownMs:62},
    serin_impact:{srcs:["b11d3817262f2c271106.flac","02ad0fdb65d4fa34af15.flac","de064538c80ca2b6659f.flac"],gain:0.39,cooldownMs:42},
    serin_crit:{srcs:["5ad2f1618502b92b596a.flac","88f8cedda93b9f1731bd.flac","748d6a94f4bce6b2973b.flac"],gain:0.51,cooldownMs:56},
    serin_ult:{srcs:["df79c7c89d18a1b0e80d.flac"],gain:0.63,cooldownMs:900},
    arin_fire:{srcs:["1c0643c0da6d4e8f2e39.flac","e3529479a6b7e0d05226.flac","c9ce3ff77fbe6e94bbd3.flac"],gain:0.32,cooldownMs:62},
    arin_impact:{srcs:["de28632bd1de3dbfb4d5.flac","03b7d923cc2ebe12d8f5.flac","d74fe479a6066b1061e8.flac"],gain:0.39,cooldownMs:42},
    arin_crit:{srcs:["f084797afa5e3da1bafb.flac","551cb462394de946e733.flac","d7056e25157e8c4f5d94.flac"],gain:0.5,cooldownMs:56},
    arin_ult:{srcs:["261dbfb93aac441275f0.flac"],gain:0.63,cooldownMs:900},
    jaein_fire:{srcs:["e78ea083f6c2c5e1de41.flac","21b2cc5edfae50823c73.flac","484518eb3bfabf9a1f3c.flac"],gain:0.35,cooldownMs:62},
    jaein_impact:{srcs:["078c114f0e2f347b7253.flac","94cf4a5699bcc0826940.flac","4a154383181077ec1d6c.flac"],gain:0.4,cooldownMs:42},
    jaein_crit:{srcs:["bcb529a96691497f9185.flac","d0ebf009f3f9a3991834.flac","18c665c9a2fd8ddb6196.flac"],gain:0.5,cooldownMs:56},
    jaein_ult:{srcs:["51dbb89ae44d37595c3f.flac"],gain:0.66,cooldownMs:900},
    roa_fire:{srcs:["3b78e987eae8dc69e447.flac","728be7b8485e0a5cda91.flac","311e8509c99372fcc401.flac"],gain:0.31,cooldownMs:62},
    roa_impact:{srcs:["f43dfff739a923e4c941.flac","323e28a1fe99906e438f.flac","3f2255d52faa58f47982.flac"],gain:0.39,cooldownMs:42},
    roa_crit:{srcs:["d581802e87f4a27844e5.flac","9472a93774cb5e7fb945.flac","59959b916e48aa70029c.flac"],gain:0.51,cooldownMs:56},
    roa_ult:{srcs:["f71cc421335b0c5911c7.flac"],gain:0.63,cooldownMs:900},
    noella_fire:{srcs:["1321d9d335256f8fff36.flac","ff2a99169d9c3ec6aafb.flac","7b0f95c7f0aae52f5c41.flac"],gain:0.31,cooldownMs:62},
    noella_impact:{srcs:["7a051595e7c3768b4ebb.flac","b9883fb762ff0d652067.flac","7683ee8c3ce6fc11967b.flac"],gain:0.38,cooldownMs:42},
    noella_crit:{srcs:["6c35743ad2976633cb38.flac","b1ae6639d9b0e0b60287.flac","9f766387bf93694d3018.flac"],gain:0.5,cooldownMs:56},
    noella_ult:{srcs:["322396f0d47b1bd6d20e.flac"],gain:0.64,cooldownMs:900},
    ria_fire:{srcs:["ce1d25dd7bb476d32754.flac","d1cf3560ed39f196d3d2.flac","e53fea1cc7325890705d.flac"],gain:0.34,cooldownMs:62},
    ria_impact:{srcs:["8400f7bc98af1a36c767.flac","f71647d6b3aabc411227.flac","dd0b32bd466343db3384.flac"],gain:0.39,cooldownMs:42},
    ria_crit:{srcs:["e27bcebcac12da147492.flac","940591c4e2826109355d.flac","223a557da1711a9ab07f.flac"],gain:0.51,cooldownMs:56},
    ria_ult:{srcs:["12531908ddcc490e44bc.flac"],gain:0.63,cooldownMs:900},
    bomin_fire:{srcs:["969557db215caf03d29f.flac","576f094d7de398ae55a9.flac","4e151c0db4fa639c3a4c.flac"],gain:0.33,cooldownMs:62},
    bomin_impact:{srcs:["71cb2da783e2f70288e3.flac","e8316949ecd9549e23ea.flac","7954da3585cc5c009f7c.flac"],gain:0.39,cooldownMs:42},
    bomin_crit:{srcs:["a5c2398de33917a43167.flac","57d82f3a9b18226d2e25.flac","4d2e8a7a88605665f39e.flac"],gain:0.51,cooldownMs:56},
    bomin_ult:{srcs:["14336ea06d64836a48f6.flac"],gain:0.63,cooldownMs:900},
    luna_fire:{srcs:["9445b49901cc4871a8ea.flac","b53ee3fa9bdb8c8693ac.flac","4a787d8dd23ebf388a65.flac"],gain:0.31,cooldownMs:62},
    luna_impact:{srcs:["46aa772f12303bafef2a.flac","c68faa8f5e745cf206f0.flac","92dbc8af8f02e66b9b74.flac"],gain:0.38,cooldownMs:42},
    luna_crit:{srcs:["02c51558eae3ea82d4a8.flac","299156be08c9163799fa.flac","93198b01c4735e9e00d4.flac"],gain:0.5,cooldownMs:56},
    luna_ult:{srcs:["c0fa933874b8e0fe300e.flac"],gain:0.63,cooldownMs:900},
    naru_fire:{srcs:["6c1aa5dd1225e51d5325.flac","2f4afded6f27f3859086.flac","8b52286ee4c80ae17849.flac"],gain:0.34,cooldownMs:62},
    naru_impact:{srcs:["9ec0c2ccd503ef30c6e0.flac","7422671aa5a55321c685.flac","246e18ec1ed43f97277c.flac"],gain:0.39,cooldownMs:42},
    naru_crit:{srcs:["c0ee138c6d34bed23b12.flac","50ce62cca87b302d6b0e.flac","c6385b83333c5b88bb68.flac"],gain:0.5,cooldownMs:56},
    naru_ult:{srcs:["b9560e90274d9a337276.flac"],gain:0.72,cooldownMs:900},
    astra_fire:{srcs:["c1d727919a4368c6d4ab.flac","acda96c2039c8f43a8d2.flac","091a5ab1f0b466982346.flac"],gain:0.31,cooldownMs:62},
    astra_impact:{srcs:["3905df356bae0f10b1b6.flac","503eeae762f7c51ae6ff.flac","031ca671610ca64de5ff.flac"],gain:0.39,cooldownMs:42},
    astra_crit:{srcs:["60873a05285e16eb867a.flac","4e2c3554ceddc219752c.flac","46859048992a09cc60bb.flac"],gain:0.51,cooldownMs:56},
    astra_ult:{srcs:["6fba54e3144b958f5cd3.flac"],gain:0.63,cooldownMs:900},
    tessa_fire:{srcs:["23d58658d7ace5095ba3.flac","6ec7c6311c7d486a5bae.flac","fa8ae7263fecc1c0673b.flac"],gain:0.31,cooldownMs:62},
    tessa_impact:{srcs:["aded55ae14be170cbfda.flac","e1c4ec003d2e1f22dcdd.flac","6bb672db7753f0390b97.flac"],gain:0.38,cooldownMs:42},
    tessa_crit:{srcs:["154a5fa8007a7564cdb4.flac","449288f0985a2d77734a.flac","ec204afdf80371bdf329.flac"],gain:0.5,cooldownMs:56},
    tessa_ult:{srcs:["6e5fbfb0c668f6f5c325.flac"],gain:0.64,cooldownMs:900},
    yunseo_fire:{srcs:["041bc45efa5e6856e01c.flac","68decc6d5f56277b5569.flac","647956b321b19fd14fe8.flac"],gain:0.33,cooldownMs:62},
    yunseo_impact:{srcs:["a027079ee72578dec522.flac","d36bd2eb664359a64d4b.flac","88223619acb7059b9937.flac"],gain:0.38,cooldownMs:42},
    yunseo_crit:{srcs:["1e09ddf7a91a353b47e3.flac","aee431e37af974d42e98.flac","464c93d0d3ceda9af5d8.flac"],gain:0.5,cooldownMs:56},
    yunseo_ult:{srcs:["e88448237672455b36c2.flac"],gain:0.63,cooldownMs:900},
    orin_fire:{srcs:["9c475977318b9835b1bb.flac","ac7bd4455aff2b882c7b.flac","ccf4bf23f64c2db7af22.flac"],gain:0.33,cooldownMs:62},
    orin_impact:{srcs:["f610aa3e2875da11f47c.flac","4bf558b58a2d8ccf37fc.flac","249c16eabe0cedcd86ca.flac"],gain:0.39,cooldownMs:42},
    orin_crit:{srcs:["02a194908e0f18cf5309.flac","a08c57036aef576250a2.flac","3aee55ceaacc5ec98022.flac"],gain:0.5,cooldownMs:56},
    orin_ult:{srcs:["3a9dac9707e9ae04bc4d.flac"],gain:0.63,cooldownMs:900},
    yura_fire:{srcs:["992c1bdc55be375fe1f4.flac","bae950363016611dd55b.flac","548498512d6475bd9162.flac"],gain:0.34,cooldownMs:62},
    yura_impact:{srcs:["6f0ef3ba387d2d87e4ac.flac","e3de16a12a5f0604e00c.flac","2f4267ec541f83c3907c.flac"],gain:0.38,cooldownMs:42},
    yura_crit:{srcs:["612a27620ee0d5bb69ca.flac","14a67d5e91991f5bcc5b.flac","8a84d1c5163af92b3246.flac"],gain:0.5,cooldownMs:56},
    yura_ult:{srcs:["d41ac40d4fb0f29b54db.flac"],gain:0.63,cooldownMs:900},
    narae_fire:{srcs:["35bc5cd68586a0c133c0.flac","e81085c455bb61dbc4de.flac","6f51e17737c538806cc0.flac"],gain:0.33,cooldownMs:62},
    narae_impact:{srcs:["5b8ddcb34eb2737010d0.flac","30ce72677e0632f7d39f.flac","1d07c78ae9f01ed5ffa0.flac"],gain:0.38,cooldownMs:42},
    narae_crit:{srcs:["28883a5ef2104a109634.flac","34e9885a0d2759a18de1.flac","5be2075371c623ea3834.flac"],gain:0.5,cooldownMs:56},
    narae_ult:{srcs:["435ac472c1b15d3f8dd9.flac"],gain:0.63,cooldownMs:900},
    yeonhwa_fire:{srcs:["2e621e5fbdad18efaffe.flac","ce344f1a76dfcfd2f711.flac","b429a57433af352b2e03.flac"],gain:0.32,cooldownMs:62},
    yeonhwa_impact:{srcs:["df164b3be7fb080bb906.flac","273d025df7e2fbf3c974.flac","20b83b87673db21edfd7.flac"],gain:0.38,cooldownMs:42},
    yeonhwa_crit:{srcs:["c0f73efc86d797b288d1.flac","61a80412c60550c79c70.flac","3cd2b3754a24267d92a0.flac"],gain:0.5,cooldownMs:56},
    yeonhwa_ult:{srcs:["978b15fe8562c1402279.flac"],gain:0.63,cooldownMs:900},
    moa_fire:{srcs:["7f04edc9ea92867dbadf.flac","7e8d6958112e63a3ba3a.flac","91c8ce6fd90ec3e940df.flac"],gain:0.36,cooldownMs:62},
    moa_impact:{srcs:["2598a3e8e19118019182.flac","c5d4bee34697475ef91e.flac","13bd5bc2d91c9e697607.flac"],gain:0.39,cooldownMs:42},
    moa_crit:{srcs:["0c6444d59d547cc68387.flac","eacb347c373f22bf93ea.flac","253584fac72f14499f08.flac"],gain:0.5,cooldownMs:56},
    moa_ult:{srcs:["04c8f49eabd7003a8953.flac"],gain:0.77,cooldownMs:900},
    iona_fire:{srcs:["97ab68287fbf5efca51f.flac","0c7fc237965dc00817e7.flac","80c77e1c830c9b4119eb.flac"],gain:0.35,cooldownMs:62},
    iona_impact:{srcs:["7d6bff9af569f8b600f5.flac","0b0f8110a64c95458953.flac","8686f2e453b5dd63d074.flac"],gain:0.39,cooldownMs:42},
    iona_crit:{srcs:["bab36c40ea27f981cf31.flac","97e1d8fd2fdc629b6eaa.flac","8518e25d56d4f201deac.flac"],gain:0.53,cooldownMs:56},
    iona_ult:{srcs:["10db5a39cdaae87d2030.flac"],gain:0.7,cooldownMs:900},
    somi_fire:{srcs:["b3114673c90fb22920d9.flac","a8de6441afa103e153ad.flac","9beb909f6ac62a36e40d.flac"],gain:0.31,cooldownMs:62},
    somi_impact:{srcs:["9ae2bf71c82905b9d99d.flac","c75eef2a8684c9e4a08e.flac","470fb777b1f75e8dffd9.flac"],gain:0.39,cooldownMs:42},
    somi_crit:{srcs:["adc15ed7b23a3f9a5aea.flac","84d011a67204544c3cf4.flac","6aad129bd6deaa1728b6.flac"],gain:0.51,cooldownMs:56},
    somi_ult:{srcs:["dd7c84f6a234f36ea9b9.flac"],gain:0.63,cooldownMs:900},
    bella_fire:{srcs:["3f6c31d8a1ddc6a11547.flac","a637ec24353749f8c0d2.flac","9e9ae78fec284d61227d.flac"],gain:0.36,cooldownMs:62},
    bella_impact:{srcs:["6817a76be2f7045c0c6c.flac","4fabf855925fd45a59fb.flac","c13921c24c673d4a8681.flac"],gain:0.38,cooldownMs:42},
    bella_crit:{srcs:["6b1296378a4fec7a912b.flac","fe001251f4dd46a8f42a.flac","5ec928378185bea0efa9.flac"],gain:0.51,cooldownMs:56},
    bella_ult:{srcs:["83aefcdbc18b26f9ef07.flac"],gain:0.82,cooldownMs:900},
    mei_fire:{srcs:["f7760875b70271b17f17.flac","1061f89d41228c13d216.flac","aebb8edecd7961eeebfb.flac"],gain:0.32,cooldownMs:62},
    mei_impact:{srcs:["cf9a9891c9abd8b19509.flac","efe9deda63ffd4d34c94.flac","2f1d0f7d8f8b7cba447b.flac"],gain:0.38,cooldownMs:42},
    mei_crit:{srcs:["092318b23001b441eac9.flac","0787e8db788d3d689e72.flac","ad90022838ce1ee4712d.flac"],gain:0.5,cooldownMs:56},
    mei_ult:{srcs:["3d5bd767ec3f3a826d74.flac"],gain:0.71,cooldownMs:900},
    dana_fire:{srcs:["7a7aca22e02f9e3ec349.flac","c06699df168e364c28b3.flac","9e8e8b951e90b2d5ffce.flac"],gain:0.31,cooldownMs:62},
    dana_impact:{srcs:["180833b9c5dbdc40508e.flac","2dba3ac1917724083040.flac","66a2b7eaa29cb0f04479.flac"],gain:0.38,cooldownMs:42},
    dana_crit:{srcs:["3f1e83d883db175c8ab5.flac","b75e7066b98954718777.flac","2bf41a521bad88ddf5b8.flac"],gain:0.5,cooldownMs:56},
    dana_ult:{srcs:["9c06df6f95f60d535bd2.flac"],gain:0.69,cooldownMs:900},
    harin_fire:{srcs:["32ab939c07d7821c22df.flac","8988334a2047bf4705bd.flac","15aef3aecc0417429b31.flac"],gain:0.38,cooldownMs:62},
    harin_impact:{srcs:["10a9462f76b636411f14.flac","f76423e9adc4a64daba4.flac","b9e9f0d76fa83a7f8bb4.flac"],gain:0.39,cooldownMs:42},
    harin_crit:{srcs:["eb0be03d32e73cd37c1c.flac","e5cfe9b8d6db190eb2e3.flac","fc4761b7403d67814c3d.flac"],gain:0.51,cooldownMs:56},
    harin_ult:{srcs:["adf725e2db5a5856d344.flac"],gain:0.71,cooldownMs:900},
    yujin_fire:{srcs:["dc953e906fae5b8ece86.flac","0655ac522901a3c73635.flac","28028449c93d84fae770.flac"],gain:0.39,cooldownMs:62},
    yujin_impact:{srcs:["adffd96c7dd5198f77b6.flac","7d400c5776fae8995cc9.flac","bd76aa2f404ee9e59b19.flac"],gain:0.39,cooldownMs:42},
    yujin_crit:{srcs:["1e332119d4390e411eef.flac","caf783e67da6e46210c9.flac","07b506cef053780f18d7.flac"],gain:0.5,cooldownMs:56},
    yujin_ult:{srcs:["a01cc8912bad2362a1ca.flac"],gain:0.65,cooldownMs:900},
    lumi_fire:{srcs:["c743372a773a4240d157.flac","b865e1da3ecc002cdd28.flac","5dca1d7b332fe7fc640c.flac"],gain:0.35,cooldownMs:62},
    lumi_impact:{srcs:["fcb67b261fa4e07f778a.flac","9451909e2e8723072325.flac","1dcf4d91e23b0687559e.flac"],gain:0.39,cooldownMs:42},
    lumi_crit:{srcs:["7b996c07352c93c4e1c8.flac","7c4f561b8832ba72e6c9.flac","16b2ad2d1805a74d0c66.flac"],gain:0.52,cooldownMs:56},
    lumi_ult:{srcs:["531f20867372297a4a1e.flac"],gain:0.63,cooldownMs:900},
    yuria_fire:{srcs:["8777c0ca67ac4bd736b4.flac","17fbfe07aade2e575fce.flac","95dcf55e9cfac0049428.flac"],gain:0.45,cooldownMs:62},
    yuria_impact:{srcs:["8065a2bcea7ff519a4d3.flac","1429365ae4bd495d945e.flac","6ce9d3eb22e2ece79fe1.flac"],gain:0.4,cooldownMs:42},
    yuria_crit:{srcs:["0271c4da3d0b7f483aa9.flac","60fed458d1bfaf4c5663.flac","eb36eda7a1f8a982c11e.flac"],gain:0.53,cooldownMs:56},
    yuria_ult:{srcs:["172f99d5d0e0f7a8ab8a.flac"],gain:0.63,cooldownMs:900},
    yumi_fire:{srcs:["0ebf48e815270a74be2b.flac","63d8b46e45caf445e8a0.flac","afc4d426766b64992f87.flac"],gain:0.33,cooldownMs:62},
    yumi_impact:{srcs:["f8c1a6358f7cf86648d6.flac","f7c432bbc72214d6fa22.flac","9126d2151e5b912c8007.flac"],gain:0.39,cooldownMs:42},
    yumi_crit:{srcs:["01dd77038aa64fcd3fee.flac","e372e065cc8fb98d2a29.flac","e67c96984e43ddb99d62.flac"],gain:0.5,cooldownMs:56},
    yumi_ult:{srcs:["586b027f732b9f757c7e.flac"],gain:0.65,cooldownMs:900},
    sion_fire:{srcs:["1f1c63f4aa480b2786ee.flac","64fa2eef64d1140bf8ab.flac","d6deaa12a4759e2680c3.flac"],gain:0.32,cooldownMs:62},
    sion_impact:{srcs:["dbb777b670f114f49ac7.flac","86bbc0a108b0d63c3c4f.flac","d2cb2c78c7efe3224c5a.flac"],gain:0.38,cooldownMs:42},
    sion_crit:{srcs:["87aca4d8d4adb8302825.flac","8889d04755c4c63b4f39.flac","068fd6f3fb2d3bbdd608.flac"],gain:0.5,cooldownMs:56},
    sion_ult:{srcs:["0dfcdaf2fbbd19025f63.flac"],gain:0.63,cooldownMs:900},
    dabin_fire:{srcs:["c42d0b757691d0f57704.flac","a777b42444b54338326d.flac","ea2d67e3450525aee302.flac"],gain:0.3,cooldownMs:62},
    dabin_impact:{srcs:["9f49d02a29a079448435.flac","1639cd5d6821d5e49813.flac","e41c173f216d75c286bd.flac"],gain:0.38,cooldownMs:42},
    dabin_crit:{srcs:["bcb4456052cc77d52bd0.flac","ea384b309b25a0befcd4.flac","d16fd6711429c1e2e709.flac"],gain:0.5,cooldownMs:56},
    dabin_ult:{srcs:["5254e8fd355069bfe498.flac"],gain:0.62,cooldownMs:900},
    soha_fire:{srcs:["071769af5ead7c03a4e8.flac","4fb6697962a9410d841d.flac","586ee01ec30b9d8d7b29.flac"],gain:0.33,cooldownMs:62},
    soha_impact:{srcs:["944e82a5bd085b24d1ca.flac","997d12ca61b5f51a9ec2.flac","0edbaab033f0c0ccf455.flac"],gain:0.39,cooldownMs:42},
    soha_crit:{srcs:["55712e2dbb5b22d420c3.flac","8df27714cfd026d71745.flac","fee1a2f6ed62d9988496.flac"],gain:0.5,cooldownMs:56},
    soha_ult:{srcs:["1e9e0afffbe2fd557c02.flac"],gain:0.63,cooldownMs:900},
    seorin_fire:{srcs:["7333a62da7bed7779766.flac","d03be176de179f17a93f.flac","e55e8269de7e2a3d7b0d.flac"],gain:0.34,cooldownMs:62},
    seorin_impact:{srcs:["97326e63312e7c1d96fe.flac","ea54bd98c133f10dcfa1.flac","2dc2d6cb2d818a8abb4d.flac"],gain:0.39,cooldownMs:42},
    seorin_crit:{srcs:["542f83f31e47c8a7b889.flac","9c1ad20e7e5a0b24d34a.flac","8de26fc73a72d74a3807.flac"],gain:0.52,cooldownMs:56},
    seorin_ult:{srcs:["57f41a24398fd61322ff.flac"],gain:0.7,cooldownMs:900},
    eve_fire:{srcs:["6e64d709e7e971adecdf.flac","952fc7bb8aff66e56cd3.flac","dca285343751e3e6f78c.flac"],gain:0.3,cooldownMs:62},
    eve_impact:{srcs:["dec548cb398e6118da53.flac","77bb911c23cc8cdfae0d.flac","c672293826288a34cdb6.flac"],gain:0.39,cooldownMs:42},
    eve_crit:{srcs:["47031626e61910a3fb3c.flac","297cea44735848e1204d.flac","130a029efc46bbf2f2c2.flac"],gain:0.5,cooldownMs:56},
    eve_ult:{srcs:["67b9231433d725648b4b.flac"],gain:0.65,cooldownMs:900},
    chaerin_fire:{srcs:["6e97c7c03162af59fa1f.flac","b800779a04fe3d27a6bd.flac","af16892c911766afd662.flac"],gain:0.31,cooldownMs:62},
    chaerin_impact:{srcs:["2de06af960d1e24e3b8e.flac","8c5192d5979d6a26f799.flac","90dbfe9d3ef3ad39e1e8.flac"],gain:0.39,cooldownMs:42},
    chaerin_crit:{srcs:["9b3083461e94ac1bee3b.flac","29ad578600e88568f20f.flac","f14df6d608f57079957f.flac"],gain:0.52,cooldownMs:56},
    chaerin_ult:{srcs:["fe0e15b7f12c96f3b843.flac"],gain:0.62,cooldownMs:900},
    liora_fire:{srcs:["5aea1593b4ec85b65687.flac","aba0ff6732cd4e4e08d8.flac","bb38c539d4f7ec1c0eac.flac"],gain:0.31,cooldownMs:62},
    liora_impact:{srcs:["5358c7db0894320d9125.flac","eabcf4af4819425ed899.flac","1ee72421d1cf3a12a86a.flac"],gain:0.39,cooldownMs:42},
    liora_crit:{srcs:["b530754957a55e406502.flac","a3e02c3b20cd1c25ee86.flac","b8ff071df82eadc5870f.flac"],gain:0.5,cooldownMs:56},
    liora_ult:{srcs:["141725738b93cccad5f8.flac"],gain:0.63,cooldownMs:900},
    haejin_fire:{srcs:["0feafbb89636e8daed77.flac","9c3a4b783e85f3a59249.flac","5b21ebf6a3003ed66b93.flac"],gain:0.37,cooldownMs:62},
    haejin_impact:{srcs:["c1abfc736b02cfa2e0cf.flac","fa4516bbdd794321263e.flac","8e980248563d559592ef.flac"],gain:0.39,cooldownMs:42},
    haejin_crit:{srcs:["9843663032adebb4abf1.flac","4606df03836fa3923f21.flac","a4610c372d4aa4457ca9.flac"],gain:0.51,cooldownMs:56},
    haejin_ult:{srcs:["67c317f49c7beb1bf35c.flac"],gain:0.65,cooldownMs:900},
    sea_fire:{srcs:["d7dc9fc185259d8cb2f2.flac","375ab1345a8e0b4fb3ea.flac","f0cfc6f7f8b497791e8c.flac"],gain:0.35,cooldownMs:62},
    sea_impact:{srcs:["6b5e7db64ff2cf19a4ce.flac","35d49c2b3d3de2a8ea26.flac","0d70eebce86d582dfca8.flac"],gain:0.39,cooldownMs:42},
    sea_crit:{srcs:["2f1c9719551c9855187e.flac","27aa1f350a292ed47a5c.flac","eb0929a50a6e7e8963cb.flac"],gain:0.5,cooldownMs:56},
    sea_ult:{srcs:["cad162c6f17e0eb9af98.flac"],gain:0.64,cooldownMs:900},
    mira_crit:{srcs:["1b60f4a61d8a2f39146e.flac","93c8b0743723fb1e227f.flac","53ea783b551c793336a8.flac"],gain:0.55,cooldownMs:56},
    haneul_crit:{srcs:["0843be8f0346e6d1a11d.flac","f8ea3dc6be941988aac5.flac","b21af6d6e8c44dadc468.flac"],gain:0.51,cooldownMs:56},
    sera_crit:{srcs:["fda602b64bcaf04381ee.flac","246020e023596bf6e6ec.flac","ff63104d3a0d048fb747.flac"],gain:0.5,cooldownMs:56}
  };
  // Character SFX v3 (tools/sfx_patches/character_sfx_v3.py): own fire/impact/crit/ultimate cues per character.
  CommonCombatRunner.prototype.characterSfxCues=Object.freeze({karin:Object.freeze({fire:"karin_fire",impact:"karin_impact",crit:"karin_crit",ult:"karin_ult"}),serin:Object.freeze({fire:"serin_fire",impact:"serin_impact",crit:"serin_crit",ult:"serin_ult"}),arin:Object.freeze({fire:"arin_fire",impact:"arin_impact",crit:"arin_crit",ult:"arin_ult"}),jaein:Object.freeze({fire:"jaein_fire",impact:"jaein_impact",crit:"jaein_crit",ult:"jaein_ult"}),roa:Object.freeze({fire:"roa_fire",impact:"roa_impact",crit:"roa_crit",ult:"roa_ult"}),noella:Object.freeze({fire:"noella_fire",impact:"noella_impact",crit:"noella_crit",ult:"noella_ult"}),ria:Object.freeze({fire:"ria_fire",impact:"ria_impact",crit:"ria_crit",ult:"ria_ult"}),bomin:Object.freeze({fire:"bomin_fire",impact:"bomin_impact",crit:"bomin_crit",ult:"bomin_ult"}),luna:Object.freeze({fire:"luna_fire",impact:"luna_impact",crit:"luna_crit",ult:"luna_ult"}),naru:Object.freeze({fire:"naru_fire",impact:"naru_impact",crit:"naru_crit",ult:"naru_ult"}),astra:Object.freeze({fire:"astra_fire",impact:"astra_impact",crit:"astra_crit",ult:"astra_ult"}),tessa:Object.freeze({fire:"tessa_fire",impact:"tessa_impact",crit:"tessa_crit",ult:"tessa_ult"}),yunseo:Object.freeze({fire:"yunseo_fire",impact:"yunseo_impact",crit:"yunseo_crit",ult:"yunseo_ult"}),orin:Object.freeze({fire:"orin_fire",impact:"orin_impact",crit:"orin_crit",ult:"orin_ult"}),yura:Object.freeze({fire:"yura_fire",impact:"yura_impact",crit:"yura_crit",ult:"yura_ult"}),narae:Object.freeze({fire:"narae_fire",impact:"narae_impact",crit:"narae_crit",ult:"narae_ult"}),yeonhwa:Object.freeze({fire:"yeonhwa_fire",impact:"yeonhwa_impact",crit:"yeonhwa_crit",ult:"yeonhwa_ult"}),moa:Object.freeze({fire:"moa_fire",impact:"moa_impact",crit:"moa_crit",ult:"moa_ult"}),iona:Object.freeze({fire:"iona_fire",impact:"iona_impact",crit:"iona_crit",ult:"iona_ult"}),somi:Object.freeze({fire:"somi_fire",impact:"somi_impact",crit:"somi_crit",ult:"somi_ult"}),bella:Object.freeze({fire:"bella_fire",impact:"bella_impact",crit:"bella_crit",ult:"bella_ult"}),mei:Object.freeze({fire:"mei_fire",impact:"mei_impact",crit:"mei_crit",ult:"mei_ult"}),dana:Object.freeze({fire:"dana_fire",impact:"dana_impact",crit:"dana_crit",ult:"dana_ult"}),harin:Object.freeze({fire:"harin_fire",impact:"harin_impact",crit:"harin_crit",ult:"harin_ult"}),yujin:Object.freeze({fire:"yujin_fire",impact:"yujin_impact",crit:"yujin_crit",ult:"yujin_ult"}),lumi:Object.freeze({fire:"lumi_fire",impact:"lumi_impact",crit:"lumi_crit",ult:"lumi_ult"}),yuria:Object.freeze({fire:"yuria_fire",impact:"yuria_impact",crit:"yuria_crit",ult:"yuria_ult"}),yumi:Object.freeze({fire:"yumi_fire",impact:"yumi_impact",crit:"yumi_crit",ult:"yumi_ult"}),sion:Object.freeze({fire:"sion_fire",impact:"sion_impact",crit:"sion_crit",ult:"sion_ult"}),dabin:Object.freeze({fire:"dabin_fire",impact:"dabin_impact",crit:"dabin_crit",ult:"dabin_ult"}),soha:Object.freeze({fire:"soha_fire",impact:"soha_impact",crit:"soha_crit",ult:"soha_ult"}),seorin:Object.freeze({fire:"seorin_fire",impact:"seorin_impact",crit:"seorin_crit",ult:"seorin_ult"}),eve:Object.freeze({fire:"eve_fire",impact:"eve_impact",crit:"eve_crit",ult:"eve_ult"}),chaerin:Object.freeze({fire:"chaerin_fire",impact:"chaerin_impact",crit:"chaerin_crit",ult:"chaerin_ult"}),liora:Object.freeze({fire:"liora_fire",impact:"liora_impact",crit:"liora_crit",ult:"liora_ult"}),haejin:Object.freeze({fire:"haejin_fire",impact:"haejin_impact",crit:"haejin_crit",ult:"haejin_ult"}),sea:Object.freeze({fire:"sea_fire",impact:"sea_impact",crit:"sea_crit",ult:"sea_ult"}),mira:Object.freeze({fire:"mira_fire",impact:"mira_impact",crit:"mira_crit"}),haneul:Object.freeze({fire:"haneul_fire",impact:"haneul_impact",crit:"haneul_crit"}),sera:Object.freeze({fire:"sera_fire",impact:"sera_impact",crit:"sera_crit"})});
  CommonCombatRunner.prototype.playSfx=function(cue){
    const contract=SFX_TRACKS[cue];if(!contract)return false;
    const stats=window.__afCommonSfxStats||(window.__afCommonSfxStats={counts:{},lastCue:null,lastAt:0});stats.counts[cue]=(stats.counts[cue]||0)+1;stats.lastCue=cue;stats.lastAt=Date.now();
    if(window.parent&&window.parent!==window){window.parent.postMessage({type:"aftersignal:sfx",cue},"*");return true;}
    this.__afSfxLast=this.__afSfxLast||{};const now=globalThis.performance?.now?.()??Date.now();if(now-(this.__afSfxLast[cue]||0)<contract.cooldownMs)return false;this.__afSfxLast[cue]=now;
    const AudioCtor=window.Audio||globalThis.Audio;if(typeof AudioCtor!=="function")return true;const index=stats.counts[cue]%contract.srcs.length,audio=new AudioCtor(`../assets/${contract.srcs[index]}`),master=Math.max(0,Math.min(1,Number(globalThis.localStorage?.getItem?.("aftersignal:sfx-volume")??1)));audio.volume=contract.gain*master;audio.play().catch(()=>{});return true;
  };
  const coreCastUltimate=CommonCombatRunner.prototype.castUltimate;
  CommonCombatRunner.prototype.castUltimate=function(){const used=coreCastUltimate.apply(this,arguments);if(used)this.playSfx(this.characterSfxCues?.[this.ultimateSequence?.owner?.spec?.id]?.ult||"ultimate");return used;};
  // >>> GROWTH_COMBAT_V1 (2026-09-27, Claude Code): crew level + limit-break stars from the shared profile scale combat.
  // LV.1 / 0-star is the balanced baseline (x1). atk=(1+.08(LV-1))(1+.05*star) multiplies outgoing hits; incoming hits are
  // divided by guard=hp*def, hp=(1+.055(LV-1))(1+.05*star), def=1+.05*star, so the 100-point HP pool and its heal/revive/
  // shield rules stay absolute. Read once per battle from aftersignal:profile:v3 (characters[id].level, gacha.owned[id].stars).
  const GROWTH_COMBAT_V1=Object.freeze({profileKey:"aftersignal:profile:v3",atkPerLevel:.08,hpPerLevel:.055,perStar:.05,starMax:5,levelMax:999});
  const growthEntry=(level,stars)=>{const g=GROWTH_COMBAT_V1,lv=Math.max(1,Math.min(g.levelMax,Math.floor(Number(level)||1))),st=Math.max(0,Math.min(g.starMax,Math.floor(Number(stars)||0))),def=1+g.perStar*st,atk=(1+g.atkPerLevel*(lv-1))*def,hp=(1+g.hpPerLevel*(lv-1))*def;return Object.freeze({level:lv,stars:st,atk,hp,def,guard:hp*def});};
  CommonCombatRunner.prototype.growthOf=function(characterId){
    if(!characterId)return null;
    if(!this.__afGrowthTable){
      const table=new Map();let profile=null;try{profile=JSON.parse(globalThis.localStorage?.getItem?.(GROWTH_COMBAT_V1.profileKey)||"null");}catch{}
      const characters=profile?.characters&&typeof profile.characters==="object"?profile.characters:{},owned=profile?.gacha?.owned&&typeof profile.gacha.owned==="object"?profile.gacha.owned:{};
      for(const id of new Set([...Object.keys(characters),...Object.keys(owned)]))table.set(id,growthEntry(characters[id]?.level,owned[id]?.stars));
      this.__afGrowthTable=table;
      const party={};for(const player of Array.isArray(this.players)?this.players:[]){const id=player?.spec?.id;if(id)party[id]=table.get(id)||growthEntry(1,0);}
      this.trace?.("growth_applied",{version:"GROWTH_COMBAT_V1",party});
    }
    return this.__afGrowthTable.get(characterId)||null;
  };
  // <<< GROWTH_COMBAT_V1
  CommonCombatRunner.prototype.damage=function(enemy,amount,spec,owner,hitPoint=null){
    const contentAmount=amount===24?(spec.damage??amount):amount===55?(spec.heavyDamage??amount):amount;
    const impactVariant=amount===55?"heavy":amount>80?"ultimate":"normal",impact=spec.impact||{},tunedSpec={...spec,impactVariant,impact:{...impact,hitStop:impactVariant==="ultimate"?Math.round((impact.hitStop||0)*1.65):impactVariant==="heavy"?Math.round((impact.hitStop||0)*1.35):(impact.hitStop||0),camera:impactVariant==="ultimate"?(impact.camera||0)+4:impactVariant==="heavy"?(impact.camera||0)+2:(impact.camera||0)}};
    this.qa.outgoingHitSequence=(this.qa.outgoingHitSequence||0)+1;
    const phaseId=enemy.bossRuntime?.config?.phases?.[enemy.bossRuntime.phaseIndex]?.id||"",kind=(amount>80||/CORE_EXPOSED|FINAL_CORE/i.test(phaseId))?"CORE":(amount===55||this.qa.outgoingHitSequence%5===0)?"CRITICAL":"NORMAL",multiplier=kind==="CORE"?(spec.coreMultiplier??2.2):kind==="CRITICAL"?(spec.criticalMultiplier??1.65):1,growthAtk=this.growthOf?.(owner?.spec?.id)?.atk??1,resolvedAmount=Math.max(1,Math.round(contentAmount*multiplier*growthAtk));
    const shotId=enemy.lastHitShotId||`${owner?.spec?.id||"system"}:ultimate:${this.qa.ultimateHitSequence=(this.qa.ultimateHitSequence||0)+1}`,hitId=`${shotId}:hit:${this.qa.hitSequence=(this.qa.hitSequence||0)+1}`,sourceAtFire=enemy.lastHitSourceAtFire||null;enemy.lastHitShotId=null;enemy.lastHitSourceAtFire=null;
    const aimPoint=hitPoint||enemy.lastHitPoint||this.enemyAimPoint?.(enemy)||{x:enemy.x,y:enemy.y},bossRuntime=enemy.bossRuntime,beforeHp=enemy.hp,targetNode=bossRuntime?.nodes?.find(node=>!node.broken)||null,beforeNodeHp=targetNode?.hp??0;
    const phaseCount=bossRuntime?.config?.phases?.length||0,phaseIndex=bossRuntime?.phaseIndex??0,floorRatios=bossRuntime?.config?.hpFloorRatios||[],floorHp=bossRuntime?bossRuntime.config.runtimeMaxHp*(floorRatios[Math.min(phaseIndex,floorRatios.length-1)]??0):0;
    let extraMultiplier=1;if(amount<=55&&this.extraModifiers?.projectile_damage_20)extraMultiplier*=1.2;if(amount===55&&this.extraModifiers?.heavy_multiplier_15)extraMultiplier*=1.15;if(targetNode&&this.extraModifiers?.core_damage_30)extraMultiplier*=1.3;
    if(targetNode?.requiresManualReject){
      // P-14's forged-command marks are deliberately immune until the player
      // rejects them, but an early return used to swallow every visible hit.
      // Preserve the mechanic while completing the shot transaction: the
      // projectile now collides with the live shield, produces a bounded
      // deflection bloom/SFX and reports an explicit zero-damage BLOCK.
      const blockHitId=`${shotId}:blocked:${this.qa.blockedHitSequence=(this.qa.blockedHitSequence||0)+1}`;
      const blockPoint=aimPoint||this.enemyAimPoint?.(enemy)||{x:enemy.x,y:enemy.y};
      this.impacts=this.impacts||[];this.impacts.push({x:blockPoint.x,y:blockPoint.y,spec:tunedSpec,age:0,blocked:true,life:.62});
      const feedbackNow=performance.now(),showBlockLabel=!enemy.__afLastBlockFeedbackAt||feedbackNow-enemy.__afLastBlockFeedbackAt>=260;
      if(showBlockLabel){enemy.__afLastBlockFeedbackAt=feedbackNow;this.damageNumbers=this.damageNumbers||[];this.damageNumbers.push({hitId:blockHitId,shotId,x:blockPoint.x,y:blockPoint.y-18,text:"BLOCK",label:"SIGNAL SHIELD",kind:"BLOCK",age:0,life:.62});}
      this.playSfx("player_shield");
      this.trace("impact_sfx_link",{shotId,hitId:blockHitId,cue:"player_shield",kind:"BLOCK",x:Math.round(blockPoint.x),y:Math.round(blockPoint.y)});
      this.trace("outgoing_damage_blocked",{shotId,hitId:blockHitId,sourceAtFire,enemyId:enemy.spec?.id||null,ownerId:owner?.spec?.id||null,nodeId:targetNode.id,phaseId,appliedDamage:0,x:Math.round(blockPoint.x),y:Math.round(blockPoint.y)});
      this.trace("forged_command_manual_gate",{bossId:enemy.spec?.id||null,nodeId:targetNode.id,phaseId,ownerId:owner?.spec?.id||null,shotId,visualFeedback:true});
      return false;
    }
    let passedAmount=Math.max(1,Math.round(resolvedAmount*extraMultiplier));if(bossRuntime&&!targetNode&&phaseIndex<phaseCount-1)passedAmount=Math.min(passedAmount,Math.max(0,enemy.hp-floorHp));
    const result=coreDamage.call(this,enemy,passedAmount,tunedSpec,owner,aimPoint);
    let bossChip=0;if(bossRuntime&&targetNode){bossChip=Math.min(Math.max(0,enemy.hp-floorHp),Math.max(1,Math.round(resolvedAmount*.18)));enemy.hp=Math.max(floorHp,enemy.hp-bossChip);}
    const nodeDamage=Math.max(0,beforeNodeHp-(targetNode?.hp??beforeNodeHp)),hpDamage=Math.max(0,beforeHp-enemy.hp),appliedDamage=Math.max(0,nodeDamage+hpDamage),displayDamage=Math.max(1,Math.round(nodeDamage||hpDamage||resolvedAmount));
    this.qa.outgoingDamageByKind=this.qa.outgoingDamageByKind||{NORMAL:0,CRITICAL:0,CORE:0};this.qa.outgoingDamageByKind[kind]++;
    this.damageNumbers=this.damageNumbers||[];this.damageNumbers.push({hitId,shotId,x:aimPoint.x,y:aimPoint.y-18,text:String(displayDamage),label:kind,kind,age:0,life:kind==="CORE"?1.05:.86});
    const ownerImpactCue=this.characterSfxCues?.[owner?.spec?.id]?.impact||(owner?.spec?.id==="sera"?"sera_impact":owner?.spec?.id==="haneul"?"haneul_impact":"mira_impact"),ownerCritCue=this.characterSfxCues?.[owner?.spec?.id]?.crit,impactCue=kind==="CORE"||kind==="CRITICAL"?(ownerCritCue||(kind==="CORE"?"hit_core":"hit_critical")):ownerImpactCue;this.playSfx(impactCue);this.trace("impact_sfx_link",{shotId,hitId,cue:impactCue,kind,x:Math.round(aimPoint.x),y:Math.round(aimPoint.y)});
    this.trace("outgoing_damage_resolve",{shotId,hitId,sourceAtFire,enemyId:enemy.spec?.id||null,ownerId:owner?.spec?.id||null,phaseId,kind,baseDamage:contentAmount,multiplier,growthAtk,resolvedDamage:resolvedAmount,appliedDamage,nodeDamage,hpDamage,bossChip,phaseFloor:floorHp,hpBefore:beforeHp,hpAfter:enemy.hp,x:Math.round(aimPoint.x),y:Math.round(aimPoint.y)});
    window.dispatchEvent(new CustomEvent("aftersignal:enemy-damaged",{detail:{stageId:this.stageId,enemyId:enemy.spec?.id||null,kind,damage:displayDamage,appliedDamage,hp:enemy.hp,maxHp:enemy.maxHp}}));
    return result;
  };
  // A single pose transform owns body placement, muzzle position and projectile
  // origin.  Authored frames may have different transparent margins, so using a
  // fixed canvas corner as a muzzle/foot anchor is forbidden.
  CommonCombatRunner.prototype.aimTargetFor=function(player){
    if(this.isAutoControlled(player)&&this.session.battleSpec.rules.autoTarget){
      // Keep one target until it is defeated. Re-selecting the mathematically
      // closest enemy every frame made the authored body snap between distant
      // aim poses when two targets crossed. The lock is presentation-only;
      // collision and damage still resolve against the shared combat model.
      let locked=this.enemies.find(enemy=>enemy.id===player.autoAimTargetId&&enemy.alive!==false&&enemy.hp>0);
      if(!locked){
        const closest=this.enemies.reduce((best,enemy)=>{if(enemy.alive===false||enemy.hp<=0)return best;const point=this.enemyAimPoint(enemy),distance=Math.hypot(point.x-player.x,point.y-(player.y-playerBodyPx(player)*.7));return!best||distance<best.distance?{enemy,point,distance}:best;},null);
        locked=closest?.enemy||null;player.autoAimTargetId=locked?.id||null;
      }
      return locked?this.enemyAimPoint(locked):this.pointer;
    }
    return this.pointer;
  };
  CommonCombatRunner.prototype.poseAnchorFor=function(player,source){
    const contract=player?.spec?.combatAnchor||{},match=(contract.bySource||[]).find(entry=>source?.includes(entry.match));
    const clips=player?.spec?.combatClips||{},frameMatch=/seated_aim32_v2[678]\/AIM_(\d{3})\.(?:png|webp)$/i.exec(source||""),frameIndex=frameMatch?Number(frameMatch[1])-1:-1,frameAnchorX=clips.FIRE_DIRECTIONAL_ANCHOR_X?.[frameIndex],frameOpaqueHeight=clips.FIRE_DIRECTIONAL_OPAQUE_HEIGHTS?.[frameIndex],frameBodyHeight=clips.FIRE_DIRECTIONAL_BODY_HEIGHTS?.[frameIndex],frameVisualScale=clips.FIRE_DIRECTIONAL_VISUAL_SCALES?.[frameIndex];
    const isCover=[clips.STAND,clips.COVER_DESCENT,clips.COVER_SETTLE,clips.COVER_HOLD,clips.RELOAD,player?.spec?.battleSprite].filter(Boolean).includes(source),coverOpaqueHeight=isCover?clips.COVER_OPAQUE_HEIGHT:null,coverBodyHeight=isCover?clips.COVER_BODY_HEIGHT:null,coverVisualScale=isCover?clips.COVER_VISUAL_SCALE:null,sourceOpaqueHeight=Number.isFinite(frameOpaqueHeight)?frameOpaqueHeight:(Number.isFinite(coverOpaqueHeight)?coverOpaqueHeight:null),sourceBodyHeight=Number.isFinite(frameBodyHeight)?frameBodyHeight:(Number.isFinite(coverBodyHeight)?coverBodyHeight:null),visualScale=Number.isFinite(frameVisualScale)?frameVisualScale:(Number.isFinite(coverVisualScale)?coverVisualScale:null);
    return {...(contract.default||{}),...(match||{}),...(Number.isFinite(frameAnchorX)?{sourceAnchorX:frameAnchorX}:{}),...(Number.isFinite(sourceOpaqueHeight)?{sourceOpaqueHeight}:{}),...(Number.isFinite(sourceBodyHeight)?{sourceBodyHeight}:{}),...(Number.isFinite(visualScale)?{visualScale}:{})};
  };
  CommonCombatRunner.prototype.spriteTransform=function(player,source,image){
    const anchor=this.poseAnchorFor(player,source),crop=image?.__afSourceRect||null;
    const sourceWidth=anchor.sourceWidth||crop?.sourceWidth||image?.naturalWidth||image?.width||1;
    const sourceHeight=anchor.sourceHeight||crop?.sourceHeight||image?.naturalHeight||image?.height||1;
    const authoredRenderWidth=anchor.renderWidth||292,authoredRenderHeight=anchor.renderHeight||authoredRenderWidth*(sourceHeight/sourceWidth);
    const presentationScale=player?.presentationScale||1,renderWidth=authoredRenderWidth*PLAYER_RENDER_SCALE*presentationScale,renderHeight=authoredRenderHeight*PLAYER_RENDER_SCALE*presentationScale;
    // CharacterPack presentation scale is invariant across every authored
    // firing/cover pose. Transparent margins and weapon reach may change, but
    // no runtime detector is allowed to resize the person frame by frame.
    const authoredVisualScale=anchor.visualScale??1,sourceBodyHeight=Number(anchor.sourceBodyHeight);
    const bodyAuthorityScale=Number.isFinite(sourceBodyHeight)&&sourceBodyHeight>0
      ?(PLAYER_BODY_AUTHORITY_UNITS*PLAYER_RENDER_SCALE*presentationScale)/sourceBodyHeight
      :null;
    const scaleX=bodyAuthorityScale??(renderWidth/sourceWidth*authoredVisualScale),scaleY=bodyAuthorityScale??(renderHeight/sourceHeight*authoredVisualScale);
    const sourceAnchorX=anchor.sourceAnchorX??sourceWidth*.5;
    const left=crop?.left||0,top=crop?.top||0,cropWidth=crop?.width||sourceWidth,cropHeight=crop?.height||sourceHeight;
    // Legacy authored AIM families use their inspected opaque bottom because
    // they do not carry audited anatomical contacts. Golden candidates do:
    // their declared per-boot source authority must survive the renderer
    // unchanged, so alpha-crop padding can never redefine the foot station.
    const lockedBaseline=anchor.sourceBaselinePolicy==="DECLARED_ANATOMICAL_CONTACT_AUTHORITY";
    const sourceBaseline=lockedBaseline?(anchor.sourceBaseline??sourceHeight*.9):(crop?(top+cropHeight):(anchor.sourceBaseline??sourceHeight*.9));
    return {anchor,sourceBaseline,sourceBaselinePolicy:lockedBaseline?"DECLARED_ANATOMICAL_CONTACT_AUTHORITY":"OPAQUE_BOTTOM_OR_METADATA_FALLBACK",scalePolicy:bodyAuthorityScale?"FIXED_CHARACTER_BODY_AUTHORITY":"FIXED_CHARACTER_PACK_SCALE_FALLBACK",scaleX,scaleY,drawX:player.x+(left-sourceAnchorX)*scaleX,drawY:player.y+(top-sourceBaseline)*scaleY,drawWidth:cropWidth*scaleX,drawHeight:cropHeight*scaleY};
  };
  CommonCombatRunner.prototype.posePointToWorld=function(player,source,image,point){
    const transform=this.spriteTransform(player,source,image),anchor=transform.anchor;
    const sourceWidth=anchor.sourceWidth||image?.__afSourceRect?.sourceWidth||image?.naturalWidth||image?.width||1;
    const sourceHeight=anchor.sourceHeight||image?.__afSourceRect?.sourceHeight||image?.naturalHeight||image?.height||1;
    const anchorX=anchor.sourceAnchorX??sourceWidth*.5,baseline=transform.sourceBaseline;
    const px=point?.x??anchor.muzzleX,py=point?.y??anchor.muzzleY;
    if(!Number.isFinite(px)||!Number.isFinite(py))return null;
    const mirror=Boolean(point?.mirror);
    return {x:player.x+(mirror?-(px-anchorX):(px-anchorX))*transform.scaleX,y:player.y+(py-baseline)*transform.scaleY};
  };
  const smooth01=value=>{const t=clamp(value,0,1);return t*t*(3-2*t);};
  const mix=(a,b,t)=>a+(b-a)*t;
  const mixAngle=(a,b,t)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
  CommonCombatRunner.prototype.playMotionFactorySequence=function(characterId=null,{loop=false}={}){
    const requestedId=characterId||this.selected()?.spec?.id,player=this.players.find(candidate=>candidate?.spec?.id===requestedId),clips=player?.spec?.combatClips||{},frames=clips.REAR_COVER_FIRE_RETURN_FRAMES||[];
    if(!player||!frames.length||!this.running)return false;
    player.motionFactorySequenceClock=0;player.motionFactorySequenceFrame=0;player.motionFactorySequencePlaying=true;player.motionFactorySequenceLoop=Boolean(loop);player.motionFactorySequenceHoldSource=null;player.motionFactorySequenceEvents=[];player.motionFactorySequenceShotEvents=[];player.coverRequested=false;player.coverClock=0;player.reloadClock=0;player.cooldown=Math.max(player.cooldown||0,.12);
    for(const source of frames)this.requestAsset(source);
    this.trace("motion_factory_sequence_start",{characterId:player.spec.id,preset:"REAR_COVER_FIRE_RETURN",fps:clips.REAR_COVER_FIRE_RETURN_FPS||30,frameCount:frames.length,bodyScalePolicy:"FIXED_CHARACTER_BODY_AUTHORITY"});
    return true;
  };
  CommonCombatRunner.prototype.advanceMotionFactorySequences=function(dt){
    for(const player of this.players){
      if(!player?.motionFactorySequencePlaying)continue;
      const clips=player.spec.combatClips||{},frames=clips.REAR_COVER_FIRE_RETURN_FRAMES||[],fps=Math.max(1,Number(clips.REAR_COVER_FIRE_RETURN_FPS)||30),previous=Math.max(-1,Number(player.motionFactorySequenceFrame??-1));
      if(!frames.length){player.motionFactorySequencePlaying=false;continue;}
      player.motionFactorySequenceClock=Math.max(0,(player.motionFactorySequenceClock||0)+Math.max(0,dt));
      const current=Math.min(frames.length-1,Math.floor(player.motionFactorySequenceClock*fps));player.motionFactorySequenceFrame=current;
      const directional=clips.FIRE_DIRECTIONAL_FRAMES||[],lastAim=Math.max(0,directional.length-1),middleAim=Math.round(lastAim/2),fireEvents=new Map([[22,{aimIndex:lastAim,angle:0,label:"3_OCLOCK"}],[45,{aimIndex:middleAim,angle:-Math.PI/2,label:"12_OCLOCK"}],[74,{aimIndex:0,angle:-Math.PI,label:"9_OCLOCK"}]]);
      for(let frame=previous+1;frame<=current;frame++){
        const event=fireEvents.get(frame);if(!event)continue;
        const aimSource=clips.FIRE_DIRECTIONAL_FRAMES?.[event.aimIndex],registered=clips.FIRE_DIRECTIONAL_MUZZLES?.[event.aimIndex],world=aimSource&&registered?this.posePointToWorld(player,aimSource,null,{x:registered[0],y:registered[1]}):null;
        if(world)player.muzzle={x:world.x,y:world.y,angle:event.angle,poseAngle:event.angle};
        const projectileCountBefore=this.projectiles.length;player.__afMotionFactoryShot={frame:frame+1,axis:event.label,angle:event.angle};player.cooldown=0;this.fire(player,false);delete player.__afMotionFactoryShot;
        const shotCreated=this.projectiles.length>projectileCountBefore,shotId=shotCreated?this.projectiles.at(-1)?.shotId||null:null;player.muzzleFlashClock=.11;player.motionFactorySequenceEvents.push(frame+1);player.motionFactorySequenceShotEvents.push({frame:frame+1,axis:event.label,angle:event.angle,shotCreated,shotId,muzzleX:world?.x??null,muzzleY:world?.y??null});this.trace("motion_factory_fire_event",{characterId:player.spec.id,preset:"REAR_COVER_FIRE_RETURN",frame:frame+1,axis:event.label,muzzleX:world?.x??null,muzzleY:world?.y??null,shotCreated,shotId});
      }
      this.requestAsset(frames[current],true);for(let ahead=1;ahead<=3;ahead++)if(frames[current+ahead])this.requestAsset(frames[current+ahead]);
      if(current<frames.length-1)continue;
      if(player.motionFactorySequenceLoop){player.motionFactorySequenceClock=0;player.motionFactorySequenceFrame=0;player.motionFactorySequenceEvents=[];player.motionFactorySequenceShotEvents=[];this.trace("motion_factory_sequence_loop",{characterId:player.spec.id});continue;}
      player.motionFactorySequencePlaying=false;player.motionFactorySequenceHoldSource=frames.at(-1);player.coverRequested=true;player.coverClock=.68;this.trace("motion_factory_sequence_complete",{characterId:player.spec.id,preset:"REAR_COVER_FIRE_RETURN",framesPresented:frames.length,fireEventFrames:[...player.motionFactorySequenceEvents]});
    }
  };
  // Directional sprites run on a 120-tick logical clock backed by 32 authored
  // seated poses.  The visual pose is a single authored frame at any instant;
  // only the weapon/muzzle trajectory interpolates continuously.  Alpha
  // blending two full-body images created a visible duplicate-body afterimage
  // during touch aim, so it is forbidden for the player silhouette.
  CommonCombatRunner.prototype.presentAim=function(player,dt=0){
    const clips=player?.spec?.combatClips||{},frames=clips.FIRE_DIRECTIONAL_FRAMES||[];
    if(!player||!frames.length)return null;
    // Never render directly from an instantaneous touch/pointer coordinate.
    // The shared smoothed aim owns the body, muzzle and fired projectile path.
    const target=player.smoothedAim||this.aimTargetFor(player);
    const raw=Math.atan2(target.y-(player.y-playerBodyPx(player)*.7),target.x-player.x),targetAngle=clamp(raw,-Math.PI,0);
    const logicalCount=Math.max(2,clips.FIRE_DIRECTIONAL_FRAME_COUNT||frames.length),targetPosition=clamp(((targetAngle+Math.PI)/Math.PI)*(frames.length-1),0,frames.length-1);
    const poseAt=position=>{const authoredPosition=clamp(position,0,frames.length-1),lower=Math.floor(authoredPosition),upper=Math.min(frames.length-1,lower+1),blend=lower===upper?0:smooth01(authoredPosition-lower),poseMuzzle=index=>{const source=frames[index],image=null,anchor=this.poseAnchorFor(player,source),registered=clips.FIRE_DIRECTIONAL_MUZZLES?.[index];return this.posePointToWorld(player,source,image,{x:registered?.[0]??anchor.muzzleX,y:registered?.[1]??anchor.muzzleY,mirror:Boolean(clips.FIRE_DIRECTIONAL_MIRROR?.[index])});},lowerMuzzle=poseMuzzle(lower),upperMuzzle=poseMuzzle(upper),fallback={x:player.x+Math.cos(targetAngle)*92,y:player.y-playerBodyPx(player)*.7+Math.sin(targetAngle)*92},muzzle=lowerMuzzle&&upperMuzzle?{x:mix(lowerMuzzle.x,upperMuzzle.x,blend),y:mix(lowerMuzzle.y,upperMuzzle.y,blend)}:lowerMuzzle||upperMuzzle||fallback,lowerWeaponAngle=clips.FIRE_DIRECTIONAL_ANGLES?.[lower]??targetAngle,upperWeaponAngle=clips.FIRE_DIRECTIONAL_ANGLES?.[upper]??targetAngle;return{authoredPosition,lower,upper,blend,muzzle,weaponAngle:mixAngle(lowerWeaponAngle,upperWeaponAngle,blend)};};
    let authoredPosition=Number.isFinite(player.presentedAuthoredPosition)?player.presentedAuthoredPosition:targetPosition;
    // Frame-rate-independent muzzle-distance limiter. It bounds the rendered
    // pose path itself, rather than merely slowing the pointer, so source-frame
    // spacing cannot pull a gun or projectile ahead of the body.
    if(dt>0&&authoredPosition!==targetPosition){const from=poseAt(authoredPosition),to=poseAt(targetPosition),distance=Math.hypot(to.muzzle.x-from.muzzle.x,to.muzzle.y-from.muzzle.y),budget=this.isAutoControlled(player)?Math.max(2.5,Math.min(8,dt*420)):Math.max(4,Math.min(60,dt*2200));if(distance>budget){let lo=0,hi=1,best=0;for(let iteration=0;iteration<14;iteration++){const mid=(lo+hi)/2,candidate=poseAt(authoredPosition+(targetPosition-authoredPosition)*mid),step=Math.hypot(candidate.muzzle.x-from.muzzle.x,candidate.muzzle.y-from.muzzle.y);if(step<=budget){best=mid;lo=mid}else hi=mid;}authoredPosition+=((targetPosition-authoredPosition)*best);}else authoredPosition=targetPosition;}
    const pose=poseAt(authoredPosition),visualAngle=-Math.PI+(authoredPosition/(frames.length-1))*Math.PI,requestedPoseIndex=pose.blend<.5?pose.lower:pose.upper;
    // A single authored silhouette is always visible. A small Schmitt-trigger
    // dead band stops one-pixel pointer noise from alternating adjacent full
    // bodies, while the muzzle and projectile continue on the smooth 120-tick
    // logical trajectory.
    let aimPoseIndex=Number.isInteger(player.displayPoseIndex)?clamp(player.displayPoseIndex,0,frames.length-1):requestedPoseIndex;
    const poseDelta=authoredPosition-aimPoseIndex;
    if(poseDelta>.68)aimPoseIndex=Math.min(frames.length-1,aimPoseIndex+Math.max(1,Math.floor(poseDelta-.18)));
    else if(poseDelta<-.68)aimPoseIndex=Math.max(0,aimPoseIndex-Math.max(1,Math.floor(-poseDelta-.18)));
    player.displayPoseIndex=aimPoseIndex;
    player.presentedAuthoredPosition=authoredPosition;player.aimTargetAngle=targetAngle;player.aimPoseAngle=pose.weaponAngle;player.aimAngle=visualAngle;player.aimPoseIndex=aimPoseIndex;player.aimFrame=frames[aimPoseIndex];player.aimLogicalFrame=Math.round(authoredPosition/(frames.length-1)*(logicalCount-1));player.aimPose={primary:frames[aimPoseIndex],secondary:frames[aimPoseIndex],blend:0,primaryIndex:aimPoseIndex,secondaryIndex:aimPoseIndex,primaryMirror:Boolean(clips.FIRE_DIRECTIONAL_MIRROR?.[aimPoseIndex]),secondaryMirror:Boolean(clips.FIRE_DIRECTIONAL_MIRROR?.[aimPoseIndex])};
    // The interpolated muzzle owns both flash and projectile source.  The shot
    // direction stays continuous as well, preserving precise small-core hits.
    player.muzzle={x:pose.muzzle.x,y:pose.muzzle.y,angle:visualAngle,poseAngle:pose.weaponAngle};
    return frames[aimPoseIndex];
  };
  CommonCombatRunner.prototype.publishAimSweepQa=function(){
    // PERF FIX 2026-09-23: this ran on every rendered frame. A new shot still publishes immediately (the
    // firing-instant contract below); otherwise the rows are refreshed at most four times per second.
    const shotKey=this.players.map(player=>player?.lastShot?.logicalTick??player?.lastShot?.projectileSpawnX??"").join("|"),nowMs=performance.now();if(shotKey===this.__afAimQaShotKey&&nowMs-(this.__afAimQaAt||0)<250)return;this.__afAimQaShotKey=shotKey;this.__afAimQaAt=nowMs;
    let node=this.__afAimQaNode?.isConnected?this.__afAimQaNode:document.querySelector("#af-aim-sweep-qa");if(!node){node=document.createElement("script");node.id="af-aim-sweep-qa";node.type="application/json";document.body.append(node)}this.__afAimQaNode=node;
    // Compare at the firing instant, never against a muzzle that has already
    // swept to a later target.  That turns the visual source contract into a
    // deterministic, meaningful spawnDelta=0 assertion.
    const rows=this.players.filter(Boolean).map(player=>{const shot=player.lastShot||null,pose=player.aimPose||{},projectileAngle=shot?.projectileAngle??null,weaponAngle=shot?.weaponAngle??player.muzzle?.angle??null,angularError=projectileAngle==null||weaponAngle==null?null:Math.abs(Math.atan2(Math.sin(projectileAngle-weaponAngle),Math.cos(projectileAngle-weaponAngle))),spawnDelta=shot?Math.hypot(shot.projectileSpawnX-shot.muzzleX,shot.projectileSpawnY-shot.muzzleY):null;return{characterId:player.spec.id,logicalTick:shot?.logicalTick??player.aimLogicalFrame??null,poseIndex:shot?.poseIndex??player.aimPoseIndex??null,primaryPoseIndex:shot?.primaryPoseIndex??pose.primaryIndex??null,secondaryPoseIndex:shot?.secondaryPoseIndex??pose.secondaryIndex??null,poseBlend:shot?.poseBlend??Number((pose.blend||0).toFixed(4)),targetAngle:shot?.targetAngle??player.aimTargetAngle??null,authoredWeaponAngle:weaponAngle,projectileAngle,muzzleX:shot?.muzzleX??player.muzzle?.x??null,muzzleY:shot?.muzzleY??player.muzzle?.y??null,projectileSpawnX:shot?.projectileSpawnX??null,projectileSpawnY:shot?.projectileSpawnY??null,angularError,spawnDelta};});
    node.textContent=JSON.stringify({stageId:this.stageId,rows});
  };
  const coreRenderDebugWithAimQa=CommonCombatRunner.prototype.renderDebug;
  CommonCombatRunner.prototype.renderDebug=function(dt){this.publishAimSweepQa();return coreRenderDebugWithAimQa.call(this,dt)};
  CommonCombatRunner.prototype.playerVisualSource=function(player){
    const clips=player.spec.combatClips||{},controller=this.session.controllers.get(player.spec.id),state=controller?.clip.state;
    if(player.motionFactorySequencePlaying){const frames=clips.REAR_COVER_FIRE_RETURN_FRAMES||[],source=frames[player.motionFactorySequenceFrame||0];if(source)return source;}
    if(player.motionFactorySequenceHoldSource)return player.motionFactorySequenceHoldSource;
    if(player.reloadClock>0)return clips.RELOAD||clips.COVER_HOLD||player.spec.battleSprite;
    if(player.coverRequested){
      if(player.coverClock<.38)return clips.COVER_DESCENT||clips.COVER_HOLD||player.spec.battleSprite;
      if(player.coverClock<.68)return clips.COVER_SETTLE||clips.COVER_HOLD||player.spec.battleSprite;
      return clips.COVER_HOLD||player.spec.battleSprite;
    }
    if(state===F.CharacterState.STAND)return clips.STAND||clips.COVER_HOLD||player.spec.battleSprite;
    return this.presentAim(player)||clips.AIM||player.spec.battleSprite;
  };
  CommonCombatRunner.prototype.presentCompletion=function(){
    if(!this.completed||this.__afCompletionPresented)return false;
    this.quiesceCombat("victory");
    this.__afCompletionPresented=true;
    let result=document.querySelector("#result,#resultOverlay");
    if(!result){
      result=document.createElement("section");result.id="result";result.className="overlay hidden result";result.setAttribute("role","dialog");result.setAttribute("aria-label","전투 결과");
      result.style.cssText="position:absolute;inset:0;z-index:80;display:grid;place-items:center;background:rgba(1,5,10,.78);backdrop-filter:blur(5px)";
      result.innerHTML='<article style="width:min(620px,86vw);padding:42px;text-align:center;border:1px solid rgba(99,237,245,.7);background:linear-gradient(145deg,rgba(2,18,26,.98),rgba(8,10,24,.97));box-shadow:0 20px 70px #000"><small style="letter-spacing:.2em;color:#77eaf5">OPERATION COMPLETE</small><h1 style="margin:14px 0;font-size:42px">SIGNAL SECURED</h1><p id="resultCopy">전투 목표를 확보했습니다.</p><button id="finishButton" type="button" style="margin-top:22px;padding:15px 28px;border:1px solid #63edf5;background:#07303a;color:#fff;font:800 18px inherit;letter-spacing:.12em;cursor:pointer">STORY CONTINUE</button></article>';
      (document.querySelector("#viewport,.viewport,main")||document.body).append(result);this.trace("completion_surface_installed",{stageId:this.stageId});
    }
    result.classList.remove("hidden");
    const eyebrow=result.querySelector(".eyebrow,small"),heading=result.querySelector("h1");
    if(eyebrow)eyebrow.textContent="OPERATION COMPLETE";
    if(heading)heading.textContent="SIGNAL SECURED";
    const copy=result.querySelector("#resultCopy,#resultText");
    if(copy){
      const preserved=this.integrity?Math.max(0,Math.round(this.integrity.value)):null;
      copy.textContent=preserved===null
        ?"전투 목표를 확보했습니다. 다음 기록으로 진행하세요."
        :`권한 로그 세 조각을 복구하고 잔류 무결성 ${preserved}%를 보존했습니다. 다음 기록으로 진행하세요.`;
    }
    const legacyAction=result.querySelector("#finishButton,#retryButton,button");
    if(legacyAction){
      // Replace, rather than repurpose, a legacy RETRY node.  Cloning removes
      // page-local reload handlers so victory has exactly one forward route.
      const finish=legacyAction.cloneNode(true);legacyAction.replaceWith(finish);finish.id="finishButton";finish.dataset.afResultAction="continue";finish.textContent="다음 기록으로 계속";
      this.listen(finish,"click",event=>{event.preventDefault();event.stopImmediatePropagation();this.__afCompletionConfirmed=true;if(typeof window.aftersignalCompleteBattle==="function")window.aftersignalCompleteBattle();},{capture:true});
    }
    this.trace("completion_presented",{stageId:this.stageId});
    return true;
  };
  CommonCombatRunner.prototype.quiesceCombat=function(reason="terminal"){
    if(this.terminalPaused)return false;
    this.running=false;this.terminalPaused=true;this.pointer.down=false;this.qa.activeCombatLoopCount=0;
    this.projectiles.length=0;this.enemyProjectiles.length=0;this.impacts.length=0;this.incomingImpacts.length=0;this.damageNumbers.length=0;this.ultimateFx.length=0;this.ultimateSequence=null;
    this.hitStop=0;this.camera=0;document.querySelector("#cutin,#ultimateCutin,.ultimate-cutin")?.classList.remove("show");
    for(const player of this.players){if(!player)continue;player.cooldown=0;player.reloadClock=0;player.muzzleFlashClock=0;player.coverRequested=false;}
    for(const enemy of this.enemies){enemy.attackClock=Infinity;enemy.attackTelegraph=0;enemy.activeAttackId=null;}
    this.trace("combat_quiesced",{stageId:this.stageId,reason,playerProjectiles:0,enemyProjectiles:0,impacts:0,ultimateFx:0});
    this.publishRuntimeQa(0);
    return true;
  };
  CommonCombatRunner.prototype.playerPoseHorizontalBounds=function(player){
    const anchor=player?.spec?.combatAnchor?.default||{},presentationScale=player?.presentationScale||1,renderWidth=(anchor.renderWidth||292)*PLAYER_RENDER_SCALE*presentationScale,half=Math.max(72,renderWidth*.62);return{left:-half,right:half};
  };
  CommonCombatRunner.prototype.syncResponsiveLayout=function(){
    this.syncCombatToolbar();
    const canvasRect=this.canvas?.getBoundingClientRect(),hudRect=this.hud?.getBoundingClientRect();
    if(!canvasRect?.height||!hudRect?.height)return false;
    const portrait=matchMedia("(orientation: portrait)").matches;this.__afPortrait=portrait;
    const hudTopCanvas=(hudRect.top-canvasRect.top)/canvasRect.height*this.height;
    const authoredBaseline=Number(this.session.deployment.playerBaseline||614);
    // The player station is below the complete enemy field. The HUD clamp is
    // only a final safe-area guard; it must never promote players into GROUND.
    const safeBaseline=Math.max(this.height*.76,Math.min(authoredBaseline,hudTopCanvas-28));
    const visiblePlayers=this.players.filter(Boolean),zigzagY=[-18,0,-18,0,-18];
    const visibleLeft=clamp((0-canvasRect.left)/canvasRect.width*this.width,0,this.width),visibleRight=clamp((innerWidth-canvasRect.left)/canvasRect.width*this.width,0,this.width),visibleWidth=Math.max(1,visibleRight-visibleLeft),slotWidth=visibleWidth/F.MAX_PARTY_SIZE;
    const rawX=visiblePlayers.map(player=>visibleLeft+slotWidth*(player.slot+.5));
    visiblePlayers.forEach((player,index)=>{player.presentationScale=portrait?PLAYER_PRESENTATION_PORTRAIT:PLAYER_PRESENTATION_LANDSCAPE;const bounds=this.playerPoseHorizontalBounds(player),margin=12,minX=visibleLeft+margin-bounds.left,maxX=visibleRight-margin-bounds.right;player.x=portrait?rawX[index]:(minX<=maxX?clamp(rawX[index],minX,maxX):(visibleLeft+visibleRight)*.5);player.y=safeBaseline+(zigzagY[player.slot]??0);});
    // Portrait uses a centered tactical crop of the authored 16:9 battlefield.
    // Re-project both actors and enemy origins into the visible corridor while
    // retaining the exact same simulation, depth bands and pointer projection.
    this.enemies.forEach((enemy,index)=>{
      if(!Number.isFinite(enemy.afLandscapeOriginX))enemy.afLandscapeOriginX=enemy.originX;
      const target=portrait?this.width*.5+(index-(this.enemies.length-1)/2)*70:enemy.afLandscapeOriginX;
      const delta=target-enemy.originX;enemy.originX=target;enemy.x+=delta;
    });
    this.body.dataset.afCombatOrientation=portrait?"portrait":"landscape";
    this.body.dataset.afPortraitPlayable=portrait?"true":"supported";
    this.body.dataset.afPlayerDepthBand="PLAYER_FOREGROUND";
    this.body.dataset.afGroundEnemyMaxY="510";
    this.body.dataset.afPlayerRenderScale=String(PLAYER_RENDER_SCALE);
    this.body.dataset.afPlayerFormation="hud-slot-zigzag-up-down";
    this.body.dataset.afResponsivePlayerBaseline=String(Math.round(safeBaseline));
    return true;
  };
  CommonCombatRunner.prototype.presentDefeat=function(reason="party_defeated"){
    if(this.__afDefeatPresented)return false;this.quiesceCombat(reason);this.__afDefeatPresented=true;let result=document.querySelector("#result,#resultOverlay");if(!result){result=document.createElement("section");result.id="result";result.className="overlay hidden result";result.setAttribute("role","dialog");result.style.cssText="position:absolute;inset:0;z-index:80;display:grid;place-items:center;background:rgba(8,1,6,.82);backdrop-filter:blur(5px)";result.innerHTML='<article style="width:min(620px,86vw);padding:42px;text-align:center;border:1px solid rgba(255,86,130,.72);background:rgba(24,4,14,.97)"><small class="eyebrow">OPERATION FAILED</small><h1>SIGNAL LOST</h1><p id="resultCopy"></p><button id="retryButton" type="button">RETRY</button></article>';(document.querySelector("#viewport,.viewport,main")||document.body).append(result);this.trace("defeat_surface_installed",{stageId:this.stageId});}result.classList.remove("hidden");const eyebrow=result.querySelector(".eyebrow"),heading=result.querySelector("h1"),copy=result.querySelector("#resultCopy,#resultText"),retry=result.querySelector("#finishButton,#retryButton");if(eyebrow)eyebrow.textContent="OPERATION FAILED";if(heading)heading.textContent="SIGNAL LOST";if(copy)copy.textContent=reason==="environment_integrity"?"방어 대상의 무결성이 붕괴했습니다. 체크포인트에서 다시 시도하세요.":"전투 인원이 모두 행동 불능입니다. 체크포인트에서 다시 시도하세요.";if(retry){retry.textContent="RETRY";this.listen(retry,"click",event=>{event.preventDefault();event.stopImmediatePropagation();location.reload();},{capture:true});}this.trace("defeat_presented",{stageId:this.stageId,reason});return true;
  };
  const corePresentDefeatWithTimeLimit=CommonCombatRunner.prototype.presentDefeat;
  CommonCombatRunner.prototype.presentDefeat=function(reason="party_defeated"){
    const presented=corePresentDefeatWithTimeLimit.call(this,reason);
    if(reason==="time_limit"){const copy=document.querySelector("#resultCopy,#resultText");if(copy)copy.textContent="작전 제한 시간이 종료되었습니다. 전술과 화력을 정비한 뒤 다시 시도하세요.";}
    return presented;
  };
  CommonCombatRunner.prototype.renderableSprite=function(source,policy,fromPreprocessQueue=false){
    this.spriteAssetPolicies=this.spriteAssetPolicies||new Map();if(policy)this.spriteAssetPolicies.set(source,policy);
    const requestedRasterScale=Number(policy?.runtimeRasterScale||0),runtimeRasterScale=requestedRasterScale>0?Math.max(1.5,requestedRasterScale):0,runtimeRasterKey=runtimeRasterScale>=1.5?`${source}::${runtimeRasterScale}`:null;
    this.runtimeRasterCache=this.runtimeRasterCache||new Map();this.runtimeRasterOrder=this.runtimeRasterOrder||[];if(runtimeRasterKey&&this.runtimeRasterCache.has(runtimeRasterKey)){this.runtimeRasterOrder=this.runtimeRasterOrder.filter(key=>key!==runtimeRasterKey);this.runtimeRasterOrder.push(runtimeRasterKey);return this.runtimeRasterCache.get(runtimeRasterKey);}
    let image=this.images.get(source);if(!image){this.requestAsset(source,true);return null;}
    if(!image?.complete||!image.naturalWidth){this.promoteSpriteDecode(source);return image;}
    // Transparent candidate frames can stay at their approved SHA-locked
    // source bytes while the runtime keeps a higher-resolution presentation
    // raster in memory.  This is a deterministic browser cache, never an
    // authored-source replacement: body scale and pose coordinates continue
    // to use the declared source canvas, while the texture is sampled from a
    // 2x (or explicitly larger) backing surface.  A minimum of 1.5x is
    // enforced so new high-resolution combat characters cannot silently fall
    // back to the old 384px preprocessing path.
    if(runtimeRasterKey&&policy?.alpha==="RGBA"&&!policy?.chromaKey){
      const raster=document.createElement("canvas"),width=Math.max(1,Math.round(image.naturalWidth*runtimeRasterScale)),height=Math.max(1,Math.round(image.naturalHeight*runtimeRasterScale));raster.width=width;raster.height=height;const rasterCtx=raster.getContext("2d");rasterCtx.imageSmoothingEnabled=true;rasterCtx.imageSmoothingQuality="high";rasterCtx.drawImage(image,0,0,width,height);raster.__afRuntimeRasterScale=runtimeRasterScale;raster.__afRuntimeRasterSource={width:image.naturalWidth,height:image.naturalHeight};const maxSurfaces=36;while(this.runtimeRasterOrder.length>=maxSurfaces){const evictedKey=this.runtimeRasterOrder.shift(),evicted=this.runtimeRasterCache.get(evictedKey);if(evicted){this.memory.runtimeRasterBytes=Math.max(0,(this.memory.runtimeRasterBytes||0)-(evicted.width||0)*(evicted.height||0)*4);this.memory.runtimeRasterSurfaces=Math.max(0,(this.memory.runtimeRasterSurfaces||0)-1);try{evicted.width=evicted.height=1}catch{ } }this.runtimeRasterCache.delete(evictedKey);}this.runtimeRasterCache.set(runtimeRasterKey,raster);this.runtimeRasterOrder.push(runtimeRasterKey);this.memory.runtimeRasterSurfaces=(this.memory.runtimeRasterSurfaces||0)+1;this.memory.runtimeRasterBytes=(this.memory.runtimeRasterBytes||0)+width*height*4;return raster;
    }
    // QA can force the exact local-file/CORS fallback used by standalone
    // clients. spriteTransform must then rely on CharacterPack opaque-height
    // metadata rather than canvas pixels.
    const forcePoseMetadata=(()=>{if(document.documentElement.dataset.afForcePoseMetadata==="true")return true;try{const query=new URLSearchParams((window.top===window.self?window.location:window.top.location).search);return query.get("posefallback")==="1"||query.get("assetfallback")==="1"}catch{return false}})();
    if(forcePoseMetadata){if(!image.__afDirectRenderable){image.__afDirectRenderable=true;this.qa.playerReadbackBypassed=(this.qa.playerReadbackBypassed||0)+1;}return image;}
    if(policy?.chromaKey&&!fromPreprocessQueue&&!this.chromaSprites?.has(source)&&!image.__afDirectRenderable){this.enqueueSpritePreprocess(source,policy);return image;}
    this.chromaSprites=this.chromaSprites||new Map();
    if(this.chromaSprites.has(source))return this.chromaSprites.get(source);
    const sourceWidth=image.naturalWidth,sourceHeight=image.naturalHeight,processingScale=Math.max(Math.min(1,384/Math.max(sourceWidth,sourceHeight)),Math.min(1,384*(this.__afHiresSpriteMul||1)/Math.max(sourceWidth,sourceHeight))),work=document.createElement("canvas");work.width=Math.max(1,Math.round(sourceWidth*processingScale));work.height=Math.max(1,Math.round(sourceHeight*processingScale));
    const workCtx=work.getContext("2d",{willReadFrequently:true});workCtx.imageSmoothingEnabled=true;workCtx.imageSmoothingQuality="high";workCtx.drawImage(image,0,0,work.width,work.height);
    let data;try{data=workCtx.getImageData(0,0,work.width,work.height)}catch{image.__afDirectRenderable=true;this.qa.playerReadbackBypassed=(this.qa.playerReadbackBypassed||0)+1;work.width=work.height=1;return image}
    let minX=work.width,minY=work.height,maxX=-1,maxY=-1;
    // Row-major scan with running x/y (same key and bounds as the former per-pixel index/modulo form).
    const pixels=data.data,scanWidth=work.width,scanHeight=work.height,keyGreen=Boolean(policy?.chromaKey);
    for(let y=0,offset=0;y<scanHeight;y++)for(let x=0;x<scanWidth;x++,offset+=4){if(keyGreen){const r=pixels[offset],g=pixels[offset+1],b=pixels[offset+2];if(g>r*1.28&&g>b*1.22&&g>110)pixels[offset+3]=0;}if(pixels[offset+3]>2){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}}
    if(maxX<minX)return image;
    // Preserve a measurable lower-body read in the cropped asset.  It is used
    // by the production QA surface to prove that both lower sides survived
    // the actual renderer instead of trusting filename or canvas dimensions.
    const lowerSupportStart=minY+(maxY-minY)*.62,midX=(minX+maxX)/2;let lowerLeftPixels=0,lowerRightPixels=0;
    for(let y=Math.max(0,Math.ceil(lowerSupportStart));y<=maxY;y++)for(let x=minX,offset=(y*scanWidth+minX)*4;x<=maxX;x++,offset+=4){if(pixels[offset+3]<=2)continue;if(x<midX)lowerLeftPixels++;else lowerRightPixels++;}
    workCtx.putImageData(data,0,0);const pad=3,left=Math.max(0,minX-pad),top=Math.max(0,minY-pad),right=Math.min(work.width,maxX+pad+1),bottom=Math.min(work.height,maxY+pad+1),sprite=document.createElement("canvas");sprite.width=right-left;sprite.height=bottom-top;sprite.getContext("2d").drawImage(work,left,top,sprite.width,sprite.height,0,0,sprite.width,sprite.height);sprite.__afSourceRect={left:left/processingScale,top:top/processingScale,width:sprite.width/processingScale,height:sprite.height/processingScale,sourceWidth,sourceHeight};sprite.__afOpaqueSupport={left:lowerLeftPixels,right:lowerRightPixels};work.width=work.height=1;const originalBytes=image.__afDecodedBytes||sourceWidth*sourceHeight*4,cachedBytes=sprite.width*sprite.height*4;image.onload=image.onerror=null;try{image.removeAttribute("src");image.src="";}catch{}this.memory.releasedSources++;this.memory.releasedDecodedBytesEstimate+=originalBytes;this.memory.decodedBytesEstimate=Math.max(0,this.memory.decodedBytesEstimate-originalBytes)+cachedBytes;this.images.set(source,sprite);this.chromaSprites.set(source,sprite);this.chromaSpriteOrder=(this.chromaSpriteOrder||[]).filter(item=>item!==source);this.chromaSpriteOrder.push(source);while(this.chromaSpriteOrder.length>this.processedPoseCacheLimit()||this.processedPoseCacheOverBudget()){const evictedSource=this.chromaSpriteOrder.shift(),evicted=this.chromaSprites.get(evictedSource);if(!evicted)continue;this.chromaSprites.delete(evictedSource);if(this.images.get(evictedSource)===evicted)this.images.delete(evictedSource);this.memory.decodedBytesEstimate=Math.max(0,this.memory.decodedBytesEstimate-(evicted.width||0)*(evicted.height||0)*4);evicted.width=evicted.height=1;}return sprite;
  };
  CommonCombatRunner.prototype.drawPlayerSprite=function(ctx,player){
    const clips=player.spec.combatClips||{};
    // Emit the exact rendered envelope rather than inferring it from a source
    // canvas.  This makes AIM/FIRE/COVER scale and foot-baseline regressions
    // observable in every runtime, including the no-readback standalone path.
    const down=player.member.hp<=0;if(down&&(player.reviveClock||0)<=0){player.visualEnvelope={state:"DEAD",baselineY:player.y,footY:player.y,layers:[]};return;}const bodyAlpha=down?.26:1;
    player.visualEnvelope={state:down?"REVIVE_PENDING":this.session.controllers.get(player.spec.id)?.clip.state||null,baselineY:player.y,footY:player.y,layers:[]};
    const drawSource=(source,alpha=1,mirror=false,role="body")=>{
      let image=this.renderableSprite(source,player.spec.combatAssetPolicy),ready=Boolean(image&&((image.complete&&image.naturalWidth)||image.width));if(!ready&&player.__afLastRenderableSource&&player.__afLastRenderableSource!==source){source=player.__afLastRenderableSource;mirror=Boolean(player.__afLastRenderableMirror);image=this.renderableSprite(source,player.spec.combatAssetPolicy);ready=Boolean(image&&((image.complete&&image.naturalWidth)||image.width));}if(!ready)return false;player.__afLastRenderableSource=source;player.__afLastRenderableMirror=mirror;player.__afLastRasterScale=Number(image.__afRuntimeRasterScale||1);
      const transform=this.spriteTransform(player,source,image),anchor=transform.anchor||{},sourceOpaqueHeight=image?.__afSourceRect?.height||anchor.sourceOpaqueHeight||anchor.sourceHeight||image?.naturalHeight||image?.height||0,sourceBodyHeight=anchor.sourceBodyHeight||sourceOpaqueHeight,support=image?.__afOpaqueSupport||null;
      player.visualEnvelope.layers.push({role,source,alpha:Number(alpha.toFixed(4)),mirror:Boolean(mirror),scalePolicy:transform.scalePolicy,sourceBaselinePolicy:transform.sourceBaselinePolicy,characterCanvasScale:{x:Number(transform.scaleX.toFixed(5)),y:Number(transform.scaleY.toFixed(5))},renderScaleX:Number(transform.scaleX.toFixed(5)),renderScaleY:Number(transform.scaleY.toFixed(5)),opaqueRenderHeight:Number((sourceOpaqueHeight*transform.scaleY).toFixed(3)),bodyRenderHeight:Number((sourceBodyHeight*transform.scaleY).toFixed(3)),sourceBaseline:Number(transform.sourceBaseline.toFixed(3)),recoilPivot:Number((player.recoilImpulse||0).toFixed(4)),lowerSupport:{left:support?.left||0,right:support?.right||0,twoSided:Boolean((support?.left||0)>0&&(support?.right||0)>0)},opaqueBounds:{left:Number(transform.drawX.toFixed(3)),top:Number(transform.drawY.toFixed(3)),right:Number((transform.drawX+transform.drawWidth).toFixed(3)),bottom:Number((transform.drawY+transform.drawHeight).toFixed(3))}});
      ctx.save();ctx.globalAlpha=alpha;const recoil=player.recoilImpulse||0,recoilDirection=Math.cos(player.muzzle?.angle??-Math.PI*.5)>=0?-1:1;ctx.translate(player.x,player.y);ctx.rotate(recoilDirection*recoil*.0045);ctx.translate(-player.x,-player.y);if(mirror){ctx.translate(player.x*2,0);ctx.scale(-1,1);}ctx.drawImage(image,transform.drawX,transform.drawY,transform.drawWidth,transform.drawHeight);ctx.restore();return true;
    };
    const drawAimPose=(pose,alpha=bodyAlpha)=>{if(!pose?.primary){drawSource(clips.AIM||player.spec.battleSprite,alpha,false,"aim-fallback");return;}const useSecondary=(pose.blend||0)>=.5,source=useSecondary?pose.secondary:pose.primary,mirror=useSecondary?pose.secondaryMirror:pose.primaryMirror;drawSource(source,alpha,mirror,"aim");};
    {const k=playerBodyPx(player)/95;ctx.fillStyle="#0008";ctx.beginPath();ctx.ellipse(player.x,player.y+4,43*k,8*k,0,0,Math.PI*2);ctx.fill();}
    // Cover is a clocked hand-off within the same approved seated AIM32 family.
    // It cannot introduce a differently framed image or a scale discontinuity.
    if(player.coverRequested&&player.coverClock<.16){drawAimPose(player.aimPose);}
    else{const source=this.playerVisualSource(player),pose=player.aimPose;if(!player.coverRequested&&pose&&[pose.primary,pose.secondary].includes(source))drawAimPose(pose);else drawSource(source,bodyAlpha,false,player.coverRequested?"cover":"state");}
    if(!down&&player.muzzleFlashClock>0&&player.muzzle&&!this.drawCharacterMuzzle?.(ctx,player)){const muzzle=player.muzzle,glow=ctx.createRadialGradient(muzzle.x,muzzle.y,0,muzzle.x,muzzle.y,18);glow.addColorStop(0,"rgba(255,255,255,.98)");glow.addColorStop(.3,"rgba(146,238,255,.92)");glow.addColorStop(1,"rgba(80,176,255,0)");ctx.save();ctx.globalCompositeOperation="lighter";ctx.fillStyle=glow;ctx.beginPath();ctx.arc(muzzle.x,muzzle.y,18,0,Math.PI*2);ctx.fill();ctx.restore();}
    this.capturePoseEvidence?.(player);
  };
  CommonCombatRunner.prototype.capturePoseEvidence=function(player){
    const layer=player?.visualEnvelope?.layers?.at(-1);if(!layer)return;
    const now=Math.round(performance.now()),sample={timestamp:now,characterId:player.spec.id,state:player.visualEnvelope.state,logicalTick:player.aimLogicalFrame??null,poseIndex:player.aimPoseIndex??null,scalePolicy:layer.scalePolicy,characterCanvasScale:layer.characterCanvasScale,renderScale:{x:layer.renderScaleX,y:layer.renderScaleY},opaqueRenderHeight:layer.opaqueRenderHeight,bodyRenderHeight:layer.bodyRenderHeight,screenOpaqueBounds:layer.opaqueBounds,baselineY:player.visualEnvelope.baselineY,footY:player.visualEnvelope.footY,lowerSupport:layer.lowerSupport,source:layer.source,alpha:layer.alpha};
    const records=this.qa.poseEvidence||(this.qa.poseEvidence=[]),previous=player.__afLastPoseSample;
    if(previous&&previous.state===sample.state&&previous.poseIndex===sample.poseIndex&&now-previous.timestamp<90)return;
    player.__afLastPoseSample=sample;records.push(sample);if(records.length>360)records.splice(0,records.length-360);
  };
  CommonCombatRunner.prototype.captureEnemyMotionEvidence=function(enemy,phaseId){
    if(!enemy)return;
    const direction=enemy.poseDirection||"front",records=this.qa.enemyMotionEvidence||(this.qa.enemyMotionEvidence=[]),previous=enemy.__afLastMotionSample;
    if(previous?.direction===direction)return;
    const sample={timestamp:Math.round(performance.now()),enemyId:enemy.spec.id,phaseId:phaseId||null,direction,asset:enemy.motionImages?.[direction]?enemy.spec.motionAssets?.[direction]||null:enemy.spec.asset,x:Number(enemy.x.toFixed(2)),y:Number(enemy.y.toFixed(2)),hpBefore:Number(enemy.hp.toFixed(2)),hpAfter:Number(enemy.hp.toFixed(2))};
    enemy.__afLastMotionSample=sample;records.push(sample);if(records.length>180)records.splice(0,records.length-180);this.trace("enemy_pose_direction",sample);
  };
  // P-14's false commands are gameplay state, not a presentation counter.
  // Signal IDs are persisted with the normal runtime QA/save payload, so a
  // duplicate click, resize or resumed renderer can never count the same
  // command twice or enter the core before exactly four distinct rejections.
  const coreEnterBossPhaseWithSignalAudit=CommonCombatRunner.prototype.enterBossPhase;
  CommonCombatRunner.prototype.enterBossPhase=function(enemy,index){
    const entered=coreEnterBossPhaseWithSignalAudit.call(this,enemy,index);if(!entered||this.stageId!=="P-14")return entered;
    const phase=enemy?.bossRuntime?.config?.phases?.[enemy.bossRuntime.phaseIndex];
    for(const node of enemy?.bossRuntime?.nodes||[])if(node.requiresManualReject)this.trace("fake_signal_presented",{bossId:enemy.spec.id,signalId:node.id,phaseId:phase?.id||null});
    if(phase?.id==="CORE_EXPOSED"){this.qa.p14CorePhaseEnterCount=(this.qa.p14CorePhaseEnterCount||0)+1;this.trace("core_phase_entered",{bossId:enemy.spec.id,rejectionCount:this.qa.manualRejectCount||0,count:this.qa.p14CorePhaseEnterCount});}
    return entered;
  };
  const coreRejectFakeOrderWithSignalAudit=CommonCombatRunner.prototype.rejectFakeOrder;
  CommonCombatRunner.prototype.rejectFakeOrder=function(){
    if(this.stageId!=="P-14")return coreRejectFakeOrderWithSignalAudit.call(this);
    const boss=this.enemies.find(enemy=>enemy.bossRuntime?.config?.id==="renewal_mira_voice_echo"),signal=boss?.bossRuntime?.nodes?.find(node=>!node.broken&&node.requiresManualReject),accepted=this.qa.manualRejectedSignalIds||(this.qa.manualRejectedSignalIds=[]);
    if(!signal)return false;
    if(accepted.includes(signal.id)){this.trace("fake_signal_duplicate_rejected",{bossId:boss.spec.id,signalId:signal.id,rejectionCount:this.qa.manualRejectCount||0});return false;}
    const rejected=coreRejectFakeOrderWithSignalAudit.call(this);
    if(rejected){accepted.push(signal.id);this.trace("fake_signal_rejected",{bossId:boss.spec.id,signalId:signal.id,rejectionCount:this.qa.manualRejectCount||0,distinctSignals:accepted.length});}
    return rejected;
  };
  const coreFire=CommonCombatRunner.prototype.fire;
  CommonCombatRunner.prototype.fire=function(owner,heavy=false){
    const motionFactoryShot=owner?.__afMotionFactoryShot||null;
    if(owner&&!motionFactoryShot&&this.pointer.down&&!this.isAutoControlled(owner)&&!owner.__afImmediatePress){const target=this.aimTargetFor(owner),targetAngle=clamp(Math.atan2(target.y-(owner.y-playerBodyPx(owner)*.7),target.x-owner.x),-Math.PI,0),presented=owner.muzzle?.angle??targetAngle,turnError=Math.abs(Math.atan2(Math.sin(targetAngle-presented),Math.cos(targetAngle-presented)));if(turnError>.075){owner.pendingFire=true;return false;}}
    if(owner)owner.pendingFire=false;if(!motionFactoryShot)this.presentAim(owner);const before=this.projectiles.length,result=coreFire.call(this,owner,heavy),projectile=this.projectiles[before];
    if(projectile&&owner?.muzzle){
      const angle=owner.muzzle.angle,speed=heavy?940:720,shotId=`${this.stageId}:${owner.spec.id}:${owner.shotSequence=(owner.shotSequence||0)+1}`;
      const poseSource=owner.aimPose?.primary||owner.aimFrame||owner.spec.battleSprite,poseImage=this.renderableSprite(poseSource,owner.spec.combatAssetPolicy),poseTransform=poseImage?this.spriteTransform(owner,poseSource,poseImage):null;
      const trackedTarget=motionFactoryShot?{x:owner.muzzle.x+Math.cos(angle)*640,y:owner.muzzle.y+Math.sin(angle)*640}:owner.smoothedAim||this.aimTargetFor(owner),targetDistance=Math.hypot(trackedTarget.x-owner.x,trackedTarget.y-(owner.y-playerBodyPx(owner)*.7));
      projectile.shotId=shotId;projectile.charge=clamp(owner.__afChargeCommit??1,0,1);projectile.x=projectile.px=projectile.sourceX=owner.muzzle.x;projectile.y=projectile.py=projectile.sourceY=owner.muzzle.y;projectile.vx=Math.cos(angle)*speed;projectile.vy=Math.sin(angle)*speed;projectile.weaponAngle=angle;
      const firedPose={shotId,characterId:owner.spec.id,charge:projectile.charge,logicalTick:owner.aimLogicalFrame??null,poseIndex:owner.aimPoseIndex??null,primaryPoseIndex:owner.aimPose?.primaryIndex??null,secondaryPoseIndex:owner.aimPose?.secondaryIndex??null,poseBlend:Number((owner.aimPose?.blend||0).toFixed(4)),bodyTransform:poseTransform?{scalePolicy:poseTransform.scalePolicy,scaleX:Number(poseTransform.scaleX.toFixed(5)),scaleY:Number(poseTransform.scaleY.toFixed(5)),drawX:Number(poseTransform.drawX.toFixed(3)),drawY:Number(poseTransform.drawY.toFixed(3)),drawWidth:Number(poseTransform.drawWidth.toFixed(3)),drawHeight:Number(poseTransform.drawHeight.toFixed(3)),baselineY:owner.y}:null,targetX:Number(trackedTarget.x.toFixed(3)),targetY:Number(trackedTarget.y.toFixed(3)),targetDistance:Number(targetDistance.toFixed(3)),targetAngle:owner.aimTargetAngle??angle,weaponAngle:angle,muzzleX:owner.muzzle.x,muzzleY:owner.muzzle.y,muzzleFlashX:owner.muzzle.x,muzzleFlashY:owner.muzzle.y,projectileSpawnX:projectile.sourceX,projectileSpawnY:projectile.sourceY,projectileAngle:Math.atan2(projectile.vy,projectile.vx),spawnDelta:Number(Math.hypot(projectile.sourceX-owner.muzzle.x,projectile.sourceY-owner.muzzle.y).toFixed(4)),ammoAfter:owner.ammo};
      projectile.sourceAtFire=firedPose;owner.lastShot=firedPose;owner.muzzleFlashClock=.11;owner.recoilImpulse=Math.min(1,(owner.recoilImpulse||0)+(heavy?.72:.42));this.qa.shotsByCharacter=this.qa.shotsByCharacter||{};this.qa.shotsByCharacter[owner.spec.id]=(this.qa.shotsByCharacter[owner.spec.id]||0)+1;this.trace("ammo_consume_link",{shotId,characterId:owner.spec.id,ammoAfter:owner.ammo,magazineSize:owner.magazineSize});this.trace("player_shot",firedPose);const fireCue=this.characterSfxCues?.[owner.spec.id]?.fire||(owner.spec.id==="sera"?"sera_fire":owner.spec.id==="haneul"?"haneul_fire":"mira_fire");this.playSfx(fireCue);this.trace("fire_sfx_link",{shotId,characterId:owner.spec.id,cue:fireCue});if(owner.ammo===0)this.startReload(owner);
    }
    return result;
  };
  const bossAttackContracts={
    warning_pulse:{kind:"warning_pulse",damage:12,cadence:1.9,telegraph:.58,projectileSpeed:250,hitStop:34,camera:4},
    core_line:{kind:"core_line",damage:18,cadence:1.65,telegraph:.46,projectileSpeed:330,hitStop:46,camera:6},
    signal_erase_wave:{kind:"signal_erase_wave",damage:28,cadence:2.25,telegraph:.72,projectileSpeed:220,hitStop:65,camera:9},
    command_needle:{kind:"command_needle",damage:15,cadence:1.45,telegraph:.32,projectileSpeed:360,hitStop:34,camera:4},
    relay_reflection_fan:{kind:"relay_reflection_fan",damage:21,cadence:1.85,telegraph:.52,projectileSpeed:300,hitStop:48,camera:6},
    trust_blockade:{kind:"trust_blockade",damage:26,cadence:2.25,telegraph:.68,projectileSpeed:235,hitStop:60,camera:8}
  };
  const enemyAttackContract=(enemy,bossKind)=>enemy.bossRuntime?bossAttackContracts[bossKind]||bossAttackContracts.core_line:enemy.spec.attack||{kind:"signal_orb",damage:8,cadence:2,telegraph:.28,projectileSpeed:270,hitStop:24,camera:3};
  CommonCombatRunner.prototype.advanceUltimateSequence=function(dt){
    const sequence=this.ultimateSequence;if(!sequence)return;
    sequence.age+=Math.max(0,dt);const {owner,ultimate,projectile}=sequence,profile=ultimateVfxProfile(owner.spec.id),fieldStart=.64,bloomAt=fieldStart+profile.charge,impactAt=bloomAt+profile.bloom,decayAt=impactAt+profile.impact,completeAt=fieldStart+profile.total+.12;
    if(!sequence.battlefieldFxStarted&&sequence.age>=fieldStart){sequence.battlefieldFxStarted=true;sequence.phase="charge";const cutin=document.querySelector("#cutin,#ultimateCutin,.ultimate-cutin");cutin?.classList.remove("show");cutin?.setAttribute("aria-hidden","true");const targets=this.enemies.filter(enemy=>enemy.alive!==false),priority=targets.reduce((best,enemy)=>!best||enemy.maxHp>best.maxHp?enemy:best,null),visualPoint=enemy=>this.enemyAimPoint(enemy),priorityPoint=priority?visualPoint(priority):null,targetX=priorityPoint?.x??(targets.length?targets.reduce((sum,enemy)=>sum+visualPoint(enemy).x,0)/targets.length:this.width*.5),targetY=priorityPoint?.y??(targets.length?targets.reduce((sum,enemy)=>sum+visualPoint(enemy).y,0)/targets.length:this.height*.32),targetPoints=targets.map(enemy=>{const point=visualPoint(enemy);return{id:enemy.id,x:point.x,y:point.y,boss:Boolean(enemy.bossRuntime),weight:Math.max(.65,Math.min(1.35,enemy.maxHp/Math.max(1,priority?.maxHp||enemy.maxHp)))};});this.ultimateFx.push({owner,ultimate,age:0,life:profile.total,targetX,targetY,targetPoints,primaryTargetId:priority?.id||null,signature:`${owner.spec.id}:${ultimate.motifType}:gpt-pro-five-layer-enemy-safe-v6k`});this.trace("ultimate_phase",{characterId:owner.spec.id,phase:"charge",signature:`${owner.spec.id}:${ultimate.motifType}:gpt-pro-five-layer-enemy-safe-v6k`,targetX:+targetX.toFixed(2),targetY:+targetY.toFixed(2),targetCount:targetPoints.length,targetLock:priority?.id||null,targetAuthority:"ENEMY_VISUAL_CENTER",profile:{supportOpacity:profile.supportOpacity,debrisOpacity:profile.debrisOpacity,primaryOpacity:profile.primaryOpacity,accentOpacity:profile.accentOpacity,coreOpacity:profile.coreOpacity,impactAnchorUV:profile.impactAnchorUV,knockoutMultiply:profile.knockoutMultiply}});this.session.commands.playCue(`ultimate:${ultimate.id}:battlefield`);}
    if(sequence.battlefieldFxStarted&&!sequence.bloomTraced&&sequence.age>=bloomAt){sequence.bloomTraced=true;sequence.phase="bloom";this.trace("ultimate_phase",{characterId:owner.spec.id,phase:"bloom"});}
    if(!sequence.damageApplied&&sequence.age>=impactAt){sequence.damageApplied=true;sequence.phase="impact";this.trace("ultimate_phase",{characterId:owner.spec.id,phase:"damage"});this.enemies.slice().forEach(enemy=>this.damage(enemy,ultimate.damage,projectile,owner));for(const phase of ["impact","audio","hitStop","cameraImpulse"])this.trace("ultimate_phase",{characterId:owner.spec.id,phase});this.session.commands.playCue(`ultimate:${ultimate.id}:impact`);this.applyHitStop("ULTIMATE",projectile.impact.hitStop||0,owner.spec.id);this.camera=Math.max(this.camera,Math.min(4.5,(projectile.impact.camera||0)*.45+1.8));}
    if(sequence.damageApplied&&!sequence.decayTraced&&sequence.age>=decayAt){sequence.decayTraced=true;sequence.phase="decay";this.trace("ultimate_phase",{characterId:owner.spec.id,phase:"decay"});}
    if(sequence.age>=completeAt){this.trace("ultimate_sequence_complete",{characterId:owner.spec.id,ultimateId:ultimate.id});this.ultimateSequence=null;}
  };
  // Character-owned layered battlefield signatures.  These deliberately use
  // different silhouettes, timings and particle languages; a recoloured ring
  // is not an acceptable ultimate implementation.
  CommonCombatRunner.prototype.drawUltimateFx=function(ctx,effect){
    const t=clamp(effect.age/effect.life,0,1),intro=clamp(t/.14,0,1),outro=clamp((1-t)/.22,0,1),energy=Math.sin(intro*Math.PI*.5)*outro,pulse=.5+.5*Math.sin(t*Math.PI*22),locked=this.enemies.find(enemy=>enemy.alive!==false&&enemy.id===effect.primaryTargetId),lockedPoint=locked?this.enemyAimPoint(locked):null,x=lockedPoint?.x??effect.targetX??this.width*.5,y=lockedPoint?.y??effect.targetY??this.height*.32,liveById=new Map(this.enemies.filter(enemy=>enemy.alive!==false).map(enemy=>[enemy.id,enemy])),targets=(effect.targetPoints?.length?effect.targetPoints:[{x,y,boss:false,weight:1}]).map(target=>{const live=liveById.get(target.id),point=live?this.enemyAimPoint(live):null;return point?{...target,x:point.x,y:point.y}:target}),colors=effect.owner.spec.palette||["#fff","#8df","#f6a"],id=effect.owner.spec.id,playerSafeY=Math.max(this.height*.48,Math.min(...this.players.filter(player=>player&&player.member.hp>0).map(player=>player.y-playerBodyPx(player)*1.12),this.height*.72));
    const ring=(radius,width,color,alpha,rotation=0)=>{ctx.save();ctx.rotate(rotation);ctx.strokeStyle=color;ctx.globalAlpha=alpha*energy;ctx.lineWidth=width;ctx.shadowColor=color;ctx.shadowBlur=18;ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.stroke();ctx.restore();};
    const rayBurst=(count,inner,outer,color,width,spin=0,alpha=1)=>{ctx.save();ctx.rotate(spin);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.globalAlpha=alpha*energy;ctx.shadowColor=color;ctx.shadowBlur=16;for(let index=0;index<count;index++){ctx.rotate(Math.PI*2/count);ctx.beginPath();ctx.moveTo(inner,0);ctx.lineTo(outer*(.78+(index%3)*.11),0);ctx.stroke();}ctx.restore();};
    const crystalBlade=(angle,inner,length,width,color,alpha=1)=>{ctx.save();ctx.rotate(angle);ctx.globalAlpha=alpha*energy;ctx.fillStyle=color;ctx.strokeStyle="#ffffff";ctx.lineWidth=1.2;ctx.shadowColor=color;ctx.shadowBlur=22;ctx.beginPath();ctx.moveTo(inner,0);ctx.lineTo(inner+length*.72,-width*.42);ctx.lineTo(inner+length,0);ctx.lineTo(inner+length*.72,width*.42);ctx.lineTo(inner+length*.17,width*.18);ctx.closePath();ctx.fill();ctx.globalAlpha*=.68;ctx.stroke();ctx.restore();};
    ctx.save();
    // Battlefield impact belongs to the enemy planes.  Keep the dense bloom,
    // rays and particles above the living-player silhouette safety line so an
    // ultimate never turns the lower combat formation into a white occlusion.
    ctx.beginPath();ctx.rect(-64,-64,this.width+128,playerSafeY+64);ctx.clip();
    ctx.globalCompositeOperation="source-over";ctx.globalAlpha=.34*energy;ctx.fillStyle="#020713";ctx.fillRect(-64,-64,this.width+128,playerSafeY+64);ctx.globalAlpha=1;ctx.globalCompositeOperation="screen";
    const downRoom=Math.max(138,playerSafeY-y),flashRadius=Math.min(292,Math.max(196,this.height*.34),downRoom),flash=ctx.createRadialGradient(x,y,0,x,y,flashRadius);flash.addColorStop(0,`rgba(255,255,255,${.18*energy})`);flash.addColorStop(.13,`${colors[1]}48`);flash.addColorStop(.42,`${colors[2]}24`);flash.addColorStop(.72,`${colors[0]}0e`);flash.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=flash;ctx.fillRect(x-flashRadius,y-flashRadius,flashRadius*2,flashRadius*2);
    ctx.translate(x,y);
    ring(34+188*t,7*(1-t)+2,colors[1],.58*(1-t));ring(22+122*t,3,colors[2],.66*(1-t),t*2.6);ring(62+34*pulse,2,"#ffffff",.48);
    if(id==="mira"){
      // Reference 01: prismatic containment sanctuary. Perspective rings and
      // separated shield-glass panels collapse around a vertical judgement key.
      for(let orbit=0;orbit<5;orbit++){ctx.save();ctx.rotate((orbit%2?1:-1)*(t*.44+orbit*.08));ctx.scale(1,.46+orbit*.025);ring(62+orbit*31+18*pulse,orbit===0?8:3,orbit%2?"#d9f5ff":"#79bbff",.94-orbit*.1);ctx.restore();}
      for(let panel=0;panel<12;panel++){const angle=panel*Math.PI/6+t*(panel%2?.16:-.12),radius=105+(panel%3)*27;ctx.save();ctx.rotate(angle);ctx.translate(radius,0);ctx.rotate(Math.PI/2+Math.sin(t*5+panel)*.08);ctx.globalAlpha=energy*(.34+(panel%3)*.13);ctx.fillStyle=panel%2?"rgba(155,215,255,.30)":"rgba(231,248,255,.22)";ctx.strokeStyle=panel%2?"#8bc8ff":"#eafaff";ctx.lineWidth=2;ctx.shadowColor="#8ed8ff";ctx.shadowBlur=18;ctx.beginPath();ctx.moveTo(-31,-14);ctx.lineTo(25,-24);ctx.lineTo(38,1);ctx.lineTo(14,30);ctx.lineTo(-36,17);ctx.closePath();ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(-22,-10);ctx.lineTo(18,18);ctx.moveTo(3,-20);ctx.lineTo(-8,22);ctx.stroke();ctx.restore();}
      crystalBlade(-Math.PI/2,18,245,31,"#dff8ff",.98);crystalBlade(Math.PI/2,16,212,25,"#8ec9ff",.82);for(let side of [-1,1])for(let row=0;row<4;row++)crystalBlade((side<0?Math.PI:0)+(row-1.5)*.16,56+row*22,92-row*8,15,row%2?"#ffdcb7":"#a6d7ff",.66);
      rayBurst(28,24,180+28*pulse,"#ffffff",2,-t*.72,.78);ring(28+10*pulse,12,"#ffffff",.94);ring(49+22*pulse,4,"#ffd5ae",.74,t*.6);
    }else if(id==="haneul"){
      // Reference 02: crystalline triangular execution array. Large authored
      // ice-spears, nested triangles and a radial lattice read independently.
      for(let layer=0;layer<5;layer++){const radius=52+layer*28+10*pulse,spin=(layer%2?1:-1)*(t*.65+layer*.11);ctx.save();ctx.rotate(spin);ctx.globalAlpha=energy*(.96-layer*.1);ctx.strokeStyle=layer%2?"#dfffff":"#77eaff";ctx.shadowColor="#8ffaff";ctx.shadowBlur=25;ctx.lineWidth=layer===0?8:3;ctx.beginPath();for(let corner=0;corner<3;corner++){const angle=-Math.PI/2+corner*Math.PI*2/3,px=Math.cos(angle)*radius,py=Math.sin(angle)*radius;if(!corner)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.closePath();ctx.stroke();ctx.restore();}
      for(let blade=0;blade<18;blade++){const angle=-Math.PI/2+blade*Math.PI/9+(blade%2?t*.12:-t*.08),inner=88+(blade%3)*19,length=blade%3===0?142:92,width=blade%3===0?24:15;crystalBlade(angle,inner,length,width,blade%2?"#cfffff":"#6eeeff",.62+(blade%3)*.12);}
      for(let node=0;node<24;node++){const angle=node*Math.PI/12-t*.48,radius=58+(node%4)*34;ctx.save();ctx.translate(Math.cos(angle)*radius,Math.sin(angle)*radius);ctx.rotate(angle+Math.PI/4);ctx.globalAlpha=energy*.7;ctx.strokeStyle=node%2?"#ffffff":"#68f5ff";ctx.lineWidth=1.5;ctx.strokeRect(-5,-5,10,10);ctx.restore();}
      rayBurst(36,18,226,"#eaffff",2,t*.44,.78);ring(24+12*pulse,13,"#ffffff",.96);ring(72+18*pulse,5,"#6cf7ff",.88,-t*.7);
    }else{
      // Reference 03: magenta crystal-lance detonation. The diagonal spear is
      // born at the enemy core; asymmetric petals and fragments expand outward.
      const spearAngle=-.72;for(const [inner,length,width,color,alpha] of [[-52,360,55,"#ff258f",.34],[-36,330,31,"#ff70c5",.7],[-18,306,13,"#fff8ff",1]])crystalBlade(spearAngle,inner,length,width,color,alpha);
      ctx.save();ctx.rotate(spearAngle);ctx.globalAlpha=energy*.88;ctx.strokeStyle="#fff";ctx.shadowColor="#ff35a7";ctx.shadowBlur=38;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-82,0);ctx.lineTo(286,0);ctx.stroke();ctx.restore();
      ctx.save();ctx.rotate(t*.58);for(let petal=0;petal<14;petal++){ctx.save();ctx.rotate(petal*Math.PI/7);const reach=78+(petal%4)*26+26*pulse,bend=(petal%2?1:-1)*26;ctx.globalAlpha=energy*(.58+(petal%3)*.16);ctx.fillStyle=petal%2?"#ff248d":"#ff75d2";ctx.shadowColor="#ff2b9b";ctx.shadowBlur=24;ctx.beginPath();ctx.moveTo(12,-5);ctx.quadraticCurveTo(reach*.52,bend,reach,0);ctx.quadraticCurveTo(reach*.48,-bend*.42,12,5);ctx.closePath();ctx.fill();ctx.restore();}ctx.restore();
      for(let fragment=0;fragment<44;fragment++){const angle=fragment*Math.PI*2/44+(fragment%2?t:-t)*.72,radius=44+215*t*(.48+(fragment%7)*.065),size=3+(fragment%5);ctx.save();ctx.translate(Math.cos(angle)*radius,Math.sin(angle)*radius);ctx.rotate(angle+t*5);ctx.globalAlpha=energy*(.5+(fragment%3)*.18);ctx.fillStyle=fragment%3?"#ff4eae":"#fff0fb";ctx.shadowColor="#ff258f";ctx.shadowBlur=16;ctx.beginPath();ctx.moveTo(size*3,0);ctx.lineTo(-size,size*.62);ctx.lineTo(0,0);ctx.lineTo(-size,-size*.62);ctx.closePath();ctx.fill();ctx.restore();}
      rayBurst(48,25,230+30*pulse,"#fff5fb",2,-t*.72,.82);ring(34+15*pulse,13,"#ffffff",.96);ring(104+46*t,7,"#ff2e9d",.9*(1-t));ring(158+62*t,3,"#ff9bd8",.68*(1-t),t*.8);
    }
    // Every living enemy receives a compact contact burst.  The hero-to-field
    // beam remains secondary, while impact readability is locked to enemy
    // silhouettes and boss cores.
    for(const target of targets){const tx=target.x-x,ty=target.y-y,weight=target.weight||1;ctx.save();ctx.translate(tx,ty);ring((target.boss?48:30)+26*pulse,5,colors[0],.62*weight);ring((target.boss?72:48)+54*t,2,colors[2],.5*(1-t)*weight,-t*2);rayBurst(target.boss?24:16,12,(target.boss?108:72)+24*pulse,"#ffffff",target.boss?2.4:1.7,t*2.4,.58*weight);ctx.globalAlpha=.62*energy*weight;ctx.fillStyle="#ffffff";ctx.shadowColor=colors[0];ctx.shadowBlur=24;ctx.beginPath();ctx.arc(0,0,(target.boss?13:9)+6*pulse,0,Math.PI*2);ctx.fill();ctx.restore();}
    ctx.restore();
  };
  CommonCombatRunner.prototype.isRasterUltimateVfxEnabled=function(){return new URLSearchParams(location.search).get("qaProceduralUltimate")!=="1";};
  CommonCombatRunner.prototype.requestRasterUltimateAsset=function(characterId){
    if(!this.isRasterUltimateVfxEnabled())return null;const source=ULTIMATE_VFX_ASSETS[characterId];if(!source)return null;const retained=this.images.get(source);if(retained)return retained;
    const image=new Image();image.decoding="async";image.onload=()=>{if(image.__afCounted)return;image.__afCounted=true;this.memory.loadedSources++;this.memory.decodedBytesEstimate+=Math.max(0,image.naturalWidth*image.naturalHeight*4);this.trace("ultimate_vfx_asset_loaded",{characterId,source,width:image.naturalWidth,height:image.naturalHeight,mode:"RASTER_VOLUMETRIC_PRODUCTION"});this.publishRuntimeQa(0);};image.onerror=()=>{this.memory.failedSources++;this.trace("ultimate_vfx_asset_failed",{characterId,source});this.publishRuntimeQa(0);};image.src=source;this.images.set(source,image);this.memory.requestedSources++;this.trace("ultimate_vfx_asset_requested",{characterId,source,policy:"LAZY_ON_FIRST_CAST"});return image;
  };
  const coreCastUltimateWithRasterCandidate=CommonCombatRunner.prototype.castUltimate;
  CommonCombatRunner.prototype.castUltimate=function(){const used=coreCastUltimateWithRasterCandidate.apply(this,arguments);if(used){if(this.qaHoldUltimatePeak)this.ultimateFx.length=0;const characterId=this.ultimateSequence?.owner?.spec?.id;if(characterId)this.requestRasterUltimateAsset(characterId);}return used;};
  const coreDrawUltimateProceduralV5=CommonCombatRunner.prototype.drawUltimateFx;
  const smoothstep01=value=>{const x=clamp(value,0,1);return x*x*(3-2*x);};
  const ultimatePhaseWeights=(age,profile)=>{
    const chargeEnd=profile.charge,bloomEnd=chargeEnd+profile.bloom,impactEnd=bloomEnd+profile.impact,total=profile.total;
    if(age<chargeEnd){const p=smoothstep01(age/Math.max(.001,profile.charge));return{phase:"charge",charge:p,bloom:0,impact:0,fade:1,debris:.12*p,primary:.08*p,core:.58*p};}
    if(age<bloomEnd){const p=smoothstep01((age-chargeEnd)/Math.max(.001,profile.bloom));return{phase:"bloom",charge:1,bloom:p,impact:0,fade:1,debris:.18+.52*p,primary:p,core:.42+.2*p};}
    if(age<impactEnd){const p=clamp((age-bloomEnd)/Math.max(.001,profile.impact),0,1),peak=Math.sin(p*Math.PI);return{phase:"impact",charge:1,bloom:1,impact:peak,fade:1,debris:1,primary:1,core:.62+.38*peak};}
    const fade=1-smoothstep01((age-impactEnd)/Math.max(.001,total-impactEnd));return{phase:"decay",charge:1,bloom:1,impact:0,fade,debris:fade,primary:Math.pow(fade,1.25),core:Math.pow(fade,2.4)};
  };
  const clipUltimateMask=(ctx,id,layer,size,anchor)=>{
    const ax=anchor[0]*size,ay=anchor[1]*size;ctx.beginPath();
    if(layer==="debris"){ctx.rect(0,0,size,size);ctx.clip();return;}
    if(id==="mira"){
      if(layer==="core"){ctx.rect(ax-size*.042,size*.065,size*.084,size*.87);ctx.arc(ax,ay,size*.145,0,Math.PI*2);}
      else if(layer==="support"){ctx.arc(ax,ay,size*.30,0,Math.PI*2);ctx.arc(ax,ay,size*.12,0,Math.PI*2,true);}
      else if(layer==="accent"){ctx.arc(ax,ay,size*.48,0,Math.PI*2);ctx.arc(ax,ay,size*.31,0,Math.PI*2,true);}
      else{for(let panel=0;panel<12;panel++){const angle=panel*Math.PI/6,px=ax+Math.cos(angle)*size*.30,py=ay+Math.sin(angle)*size*.30;ctx.save();ctx.translate(px,py);ctx.rotate(angle+Math.PI/2);ctx.rect(-size*.075,-size*.15,size*.15,size*.30);ctx.restore();}}
    }else if(id==="haneul"){
      if(layer==="core"){ctx.moveTo(ax,ay-size*.16);ctx.lineTo(ax+size*.14,ay+size*.12);ctx.lineTo(ax-size*.14,ay+size*.12);ctx.closePath();ctx.arc(ax,ay,size*.11,0,Math.PI*2);}
      else if(layer==="support"){ctx.arc(ax,ay,size*.37,0,Math.PI*2);ctx.arc(ax,ay,size*.31,0,Math.PI*2,true);}
      else if(layer==="accent"){ctx.rect(0,0,size,size);ctx.moveTo(ax,ay-size*.29);ctx.lineTo(ax+size*.26,ay+size*.22);ctx.lineTo(ax-size*.26,ay+size*.22);ctx.closePath();}
      else{ctx.moveTo(ax,ay-size*.39);ctx.lineTo(ax+size*.35,ay+size*.30);ctx.lineTo(ax-size*.35,ay+size*.30);ctx.closePath();ctx.moveTo(ax,ay-size*.27);ctx.lineTo(ax+size*.24,ay+size*.20);ctx.lineTo(ax-size*.24,ay+size*.20);ctx.closePath();}
    }else{
      if(layer==="core"){ctx.arc(ax,ay,size*.145,0,Math.PI*2);ctx.moveTo(ax-size*.07,ay+size*.05);ctx.lineTo(size*.985,size*.015);ctx.lineTo(size*.92,size*.12);ctx.lineTo(ax+size*.04,ay+size*.08);ctx.closePath();}else ctx.arc(ax,ay,size*.43,0,Math.PI*2);
    }
    ctx.clip(layer==="support"||id==="haneul"&&layer==="accent"?"evenodd":"nonzero");
  };
  const drawUltimateRasterLayer=(ctx,image,id,layer,size,anchor,alpha,scale=1)=>{
    if(alpha<=.001)return;ctx.save();clipUltimateMask(ctx,id,layer,size,anchor);const ax=anchor[0]*size,ay=anchor[1]*size;ctx.translate(ax,ay);ctx.scale(scale,scale);ctx.translate(-ax,-ay);ctx.globalCompositeOperation=layer==="core"?"lighter":"screen";ctx.globalAlpha=alpha;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.drawImage(image,0,0,size,size);ctx.restore();
  };
  const applyUltimateEnemyKnockout=(ctx,size,profile)=>{const [u,v]=profile.impactAnchorUV,x=u*size,y=v*size,r=size*profile.knockoutRadius,remove=1-profile.knockoutMultiply,gradient=ctx.createRadialGradient(x,y,0,x,y,r*1.45);gradient.addColorStop(0,`rgba(0,0,0,${remove})`);gradient.addColorStop(.72,`rgba(0,0,0,${remove*.82})`);gradient.addColorStop(1,"rgba(0,0,0,0)");ctx.save();ctx.globalCompositeOperation="destination-out";ctx.fillStyle=gradient;ctx.fillRect(x-r*1.5,y-r*1.5,r*3,r*3);ctx.restore();};
  const applyUltimateUpperFeather=(ctx,size,upperSafeY,top,mainSize,featherPx=20)=>{const local=(upperSafeY-top)/mainSize*size,feather=Math.max(1,featherPx/mainSize*size);if(local<=-feather)return;ctx.save();ctx.globalCompositeOperation="destination-in";const mask=ctx.createLinearGradient(0,local,0,local+feather);mask.addColorStop(0,"rgba(0,0,0,0)");mask.addColorStop(1,"rgba(0,0,0,1)");ctx.fillStyle=mask;ctx.fillRect(0,0,size,size);ctx.restore();};
  CommonCombatRunner.prototype.drawUltimateFx=function(ctx,effect){
    if(!this.isRasterUltimateVfxEnabled())return coreDrawUltimateProceduralV5.call(this,ctx,effect);
    const id=effect.owner?.spec?.id,image=this.requestRasterUltimateAsset(id);if(!image?.complete||!image.naturalWidth)return coreDrawUltimateProceduralV5.call(this,ctx,effect);
    const profile=ultimateVfxProfile(id),weights=ultimatePhaseWeights(effect.age,profile),locked=this.enemies.find(enemy=>enemy.alive!==false&&enemy.id===effect.primaryTargetId),lockedPoint=locked?this.enemyAimPoint(locked):null,targetX=lockedPoint?.x??effect.targetX??this.width*.5,baseTargetY=lockedPoint?.y??effect.targetY??this.height*.32,players=this.players.filter(player=>player&&player.member.hp>0),playerSafeY=Math.max(this.height*.48,Math.min(...players.map(player=>player.y-playerBodyPx(player)*1.12),this.height*.72)),upperFxSafeY=combatUpperSafeY(this),portrait=this.height>this.width,mainSize=Math.max(128,Math.min(this.width*(portrait?profile.maxWidthPortrait:profile.maxWidthLandscape),this.height*profile.maxFieldHeight)),targetY=baseTargetY+profile.centerOffsetY*mainSize,surfaceSize=this.__afHiresUltSurface||512,anchor=profile.impactAnchorUV,left=targetX-anchor[0]*mainSize,top=targetY-anchor[1]*mainSize,colors=effect.owner.spec.palette||["#ffffff","#8defff","#ff72c6"],liveById=new Map(this.enemies.filter(enemy=>enemy.alive!==false).map(enemy=>[enemy.id,enemy]));
    if(!this.__afUltimateCompositeCanvas){this.__afUltimateCompositeCanvas=document.createElement("canvas");this.__afUltimateCompositeCanvas.width=surfaceSize;this.__afUltimateCompositeCanvas.height=surfaceSize;this.__afUltimateCompositeCtx=this.__afUltimateCompositeCanvas.getContext("2d");}
    const fxCtx=this.__afUltimateCompositeCtx;fxCtx.setTransform(1,0,0,1,0,0);fxCtx.clearRect(0,0,surfaceSize,surfaceSize);drawUltimateRasterLayer(fxCtx,image,id,"support",surfaceSize,anchor,profile.supportOpacity*weights.primary,.92+.08*weights.bloom);drawUltimateRasterLayer(fxCtx,image,id,"debris",surfaceSize,anchor,profile.debrisOpacity*weights.debris,.98);drawUltimateRasterLayer(fxCtx,image,id,"primary",surfaceSize,anchor,profile.primaryOpacity*weights.primary,.84+.16*weights.bloom);drawUltimateRasterLayer(fxCtx,image,id,"accent",surfaceSize,anchor,profile.accentOpacity*Math.pow(weights.primary,1.35),.90+.10*weights.bloom);drawUltimateRasterLayer(fxCtx,image,id,"core",surfaceSize,anchor,profile.coreOpacity*weights.core,1);applyUltimateEnemyKnockout(fxCtx,surfaceSize,profile);applyUltimateUpperFeather(fxCtx,surfaceSize,upperFxSafeY,top,mainSize,20);
    ctx.save();ctx.beginPath();ctx.rect(-32,upperFxSafeY,this.width+64,Math.max(0,playerSafeY-upperFxSafeY));ctx.clip();ctx.globalCompositeOperation="source-over";ctx.globalAlpha=.055*Math.max(weights.primary,weights.core);ctx.fillStyle=id==="sera"?"#170515":"#020b19";ctx.fillRect(-32,upperFxSafeY,this.width+64,Math.max(0,playerSafeY-upperFxSafeY));ctx.globalCompositeOperation="screen";ctx.globalAlpha=1;ctx.drawImage(this.__afUltimateCompositeCanvas,left,top,mainSize,mainSize);
    // A restrained local core pulse ties the authored raster to the live enemy
    // coordinate without returning to the former screen-filling line effect.
    const pulse=.5+.5*Math.sin(effect.age*Math.PI*18),coreRadius=(locked?.bossRuntime?26:18)*(1+.12*pulse),core=ctx.createRadialGradient(targetX,targetY,0,targetX,targetY,coreRadius*2.1);core.addColorStop(0,"rgba(255,255,255,.78)");core.addColorStop(.24,colors[1]+"88");core.addColorStop(1,"rgba(0,0,0,0)");ctx.globalAlpha=profile.coreOpacity*weights.core;ctx.fillStyle=core;ctx.fillRect(targetX-coreRadius*2.1,targetY-coreRadius*2.1,coreRadius*4.2,coreRadius*4.2);
    // Secondary enemies get compact volumetric contact blooms only; the hero
    // formation never receives dense ultimate geometry.
    for(const target of effect.targetPoints||[]){const live=liveById.get(target.id),point=live?this.enemyAimPoint(live):target;if(!point||point.x===targetX&&point.y===targetY)continue;const radius=(target.boss?30:20)*(1+.18*pulse);const bloom=ctx.createRadialGradient(point.x,point.y,0,point.x,point.y,radius*2);bloom.addColorStop(0,"rgba(255,255,255,.68)");bloom.addColorStop(.28,colors[0]+"72");bloom.addColorStop(1,"rgba(0,0,0,0)");ctx.globalAlpha=.42*Math.max(weights.impact,weights.primary*.35)*(target.weight||1);ctx.fillStyle=bloom;ctx.fillRect(point.x-radius*2,point.y-radius*2,radius*4, radius*4);}
    ctx.restore();
  };
  CommonCombatRunner.prototype.applyEnemyHit=function(shot,target){
    if(!target?.member||target.member.hp<=0)return false;
    const member=target.member,rules=this.session.battleSpec.rules||{},baseDamage=Math.max(0,Number(shot.damage)||0),baseDamageScale=Math.max(0,Number(rules.enemyDamageScale??1)),materializedAttackers=Math.max(1,Number(this.wavePressureCount)||this.enemies.length||1),pressureBudget=Math.max(1,Number(rules.enemyPressureBudget)||materializedAttackers),densityScale=Number.isFinite(this.wavePressureScale)?this.wavePressureScale:Math.min(1,pressureBudget/materializedAttackers),damageScale=baseDamageScale*densityScale,raw=baseDamage*damageScale,mitigation=(target.coverRequested&&((target.__afCoverHP??100)>0||shot.__afHadCover) ? .38 : 1)*(this.extraModifiers?.incoming_damage_minus_15?.85:1),growthGuard=this.growthOf?.(target?.spec?.id)?.guard??1,amount=Math.max(1,Math.round(raw*mitigation/growthGuard)),before={hp:member.hp,shield:member.shield};
    const absorbed=Math.min(member.shield,amount),shieldAfter=Math.max(0,member.shield-absorbed),hpAfter=Math.max(0,member.hp-(amount-absorbed));
    this.qa.enemyDamageEventCount++;this.applyHitStop("ENEMY",shot.hitStop||24,shot.kind||"enemy");this.camera=Math.max(this.camera,shot.camera||3.5);this.incomingImpacts.push({x:target.x,y:target.y-playerBodyPx(target)*.6,kind:shot.kind,age:0,life:.46});this.damageNumbers.push({x:target.x,y:target.y-playerBodyPx(target)*1.2,text:`-${amount}`,label:absorbed>0?"SHIELD":"DAMAGE",kind:"INCOMING",age:0,life:.72});this.playSfx(absorbed>0?"player_shield":"player_hp");
    const resolved={attackId:shot.attackId||null,enemyId:shot.source?.spec?.id||null,kind:shot.kind,target:target.spec.id,baseDamage,baseDamageScale,materializedAttackers,pressureBudget,densityScale,damageScale,rawDamage:raw,coverMitigation:mitigation,growthGuard,appliedDamage:amount,shieldBefore:before.shield,shieldAfter,hpBefore:before.hp,hpAfter};this.trace("damageResolve",resolved);member.shield=shieldAfter;member.hp=hpAfter;this.trace("player_hp_mutation",{attackId:shot.attackId||null,enemyId:shot.source?.spec?.id||null,characterId:target.spec.id,shieldBefore:before.shield,shieldAfter,hpBefore:before.hp,hpAfter});this.trace("enemy_attack_hit",resolved);this.trace("cooldown",{attackId:shot.attackId||null,enemyId:shot.source?.spec?.id||null,seconds:shot.cooldownSeconds||shot.source?.spec?.attack?.cadence||2,state:"armed_after_resolution"});if(shot.source){shot.source.pendingResolutionAttackId=null;shot.source.cooldownCompleteAttackId=shot.attackId||null;}
    const legacyMeter=document.querySelector("#playerHealth"),legacyText=document.querySelector("#playerHpText"),legacyFill=document.querySelector("#playerHpFill");if(legacyMeter){legacyMeter.setAttribute("aria-valuemin","0");legacyMeter.setAttribute("aria-valuemax",String(member.maxHp));legacyMeter.setAttribute("aria-valuenow",String(member.hp));}if(legacyText)legacyText.textContent=`${Math.ceil(member.hp)} / ${member.maxHp}`;if(legacyFill)legacyFill.style.width=`${member.maxHp?member.hp/member.maxHp*100:0}%`;
    window.dispatchEvent(new CustomEvent("aftersignal:player-damaged",{detail:{stageId:this.stageId,characterId:target.spec.id,kind:shot.kind,rawDamage:raw,appliedDamage:amount,shield:member.shield,hp:member.hp}}));
    if(member.hp===0){member.state=F.PartyMemberState.DEAD;member.targetable=false;const canRevive=Boolean(rules.allowRevive)&&target.reviveCharges>0;if(canRevive){target.reviveCharges--;target.reviveClock=Math.max(.4,Number(rules.reviveDelaySeconds)||2.4);this.trace("character_revive_scheduled",{characterId:target.spec.id,delaySeconds:target.reviveClock,chargesRemaining:target.reviveCharges,hpRatio:Number(rules.reviveHpRatio)||.55});}else this.trace("character_defeated",{characterId:target.spec.id,reviveAvailable:false});const replacement=this.session.party.members.find(candidate=>candidate.targetable&&candidate.hp>0);if(replacement)this.session.party.select(replacement.slot);else if(!this.players.some(player=>player&&(player.reviveClock||0)>0)){this.running=false;this.qa.defeatEventCount++;this.session.emit("onBattleLost",{reason:"party_defeated"});this.presentDefeat("party_defeated");}}
    this.renderHud();return true;
  };
  const corePublishRuntimeWithAttackTrace=CommonCombatRunner.prototype.publishRuntimeQa;
  CommonCombatRunner.prototype.publishRuntimeQa=function(dt){
    corePublishRuntimeWithAttackTrace.call(this,dt);if(!this.runtimeQaNode)return;
    try{const report=JSON.parse(this.runtimeQaNode.textContent||"{}");report.attackTransactions=this.qa.eventTrace.filter(entry=>["telegraphStart","attackCommit","cooldown_started","hitWindow","collision","damageResolve","player_hp_mutation","outgoing_damage_resolve","cooldown","cooldown_complete","attackMiss","resume_scheduled_damage_cancelled","enemy_defeated"].includes(entry.type)).slice(-96);report.shotTransactions=this.qa.eventTrace.filter(entry=>["ammo_consume_link","player_shot","fire_sfx_link","outgoing_damage_resolve","impact_sfx_link"].includes(entry.type)).slice(-160);report.ultimateTransactions=this.qa.eventTrace.filter(entry=>["ultimate_auto_toggled","ultimate_used","ultimate_phase","ultimate_sequence_complete"].includes(entry.type)).slice(-48);report.outgoingDamageKinds={...(this.qa.outgoingDamageByKind||{})};report.playerShots={...(this.qa.shotsByCharacter||{})};report.poseEvidence=(this.qa.poseEvidence||[]).slice(-180);report.enemyMotionEvidence=(this.qa.enemyMotionEvidence||[]).slice(-120);report.rewardTransaction={committed:Boolean(this.rewardCommitted),rewardCommitCount:this.qa.rewardCommitCount||0,nextStageCommitCount:this.qa.nextStageCommitCount||0,duplicateReward:this.qa.duplicateReward||0,completionConfirmed:Boolean(this.__afCompletionConfirmed),nextStage:this.session.stageSpec.nextStage};report.p14SignalAudit={rejectionCount:this.qa.manualRejectCount||0,distinctSignalIds:[...(this.qa.manualRejectedSignalIds||[])],corePhaseEnterCount:this.qa.p14CorePhaseEnterCount||0};report.ultimateAuto=this.ultimateAuto;report.ultimateControls={manualButtons:document.querySelectorAll("#ultimateButton,#ultimate,[data-ultimate]").length,tacticalAuto:Boolean(document.querySelector("#tacticalAuto,[data-ultimate-auto],.tactical-auto"))};report.sfx={...(window.__afCommonSfxStats||{counts:{}}),counts:{...(window.__afCommonSfxStats?.counts||{})}};report.lifecycle={pausedReasons:[...(this.lifecyclePauses||[])],wasRunning:Boolean(this.lifecycleWasRunning),networkOnline:window.AfterSignalPlatform?.network?.isOnline?.()??true,resumeEvents:this.qa.eventTrace.filter(entry=>["lifecycle_pause","lifecycle_resume","lifecycle_resume_deferred","resume","resume_scheduled_damage_cancelled"].includes(entry.type)).slice(-24),duplicateProjectile:0,duplicateDamage:0,duplicateReward:this.qa.duplicateReward||0};if(this.projectiles.at(-1)){const projectile=this.projectiles.at(-1);report.lastPlayerProjectile={...(report.lastPlayerProjectile||{}),shotId:projectile.shotId||null,sourceAtFire:projectile.sourceAtFire||null};}this.runtimeQaNode.textContent=JSON.stringify(report);}catch{}
  };
  const corePublishRuntimeWithBlockedShots=CommonCombatRunner.prototype.publishRuntimeQa;
  CommonCombatRunner.prototype.publishRuntimeQa=function(dt){
    corePublishRuntimeWithBlockedShots.call(this,dt);if(!this.runtimeQaNode)return;
    try{const report=JSON.parse(this.runtimeQaNode.textContent||"{}"),blocked=this.qa.eventTrace.filter(entry=>entry.type==="outgoing_damage_blocked").slice(-48);report.blockedShotTransactions=blocked;report.blockedShotCount=blocked.length;this.runtimeQaNode.textContent=JSON.stringify(report);}catch{}
  };
  const corePublishRuntimeWithTimer=CommonCombatRunner.prototype.publishRuntimeQa;
  CommonCombatRunner.prototype.publishRuntimeQa=function(dt){
    corePublishRuntimeWithTimer.call(this,dt);if(!this.runtimeQaNode)return;
    try{const report=JSON.parse(this.runtimeQaNode.textContent||"{}");report.timer={limitMs:this.timeLimitMs,remainingMs:Math.max(0,Math.round(this.timeRemainingMs||0)),profile:this.session.battleSpec.rules?.timeLimitProfile||null,visible:Boolean(this.timerNode&&getComputedStyle(this.timerNode).display!=="none"),text:this.timerNode?.textContent||null,running:Boolean(this.running&&!this.completed&&!this.terminalPaused),expired:Boolean(this.__afTimeLimitExpired)};this.runtimeQaNode.textContent=JSON.stringify(report);}catch{}
  };
  const corePublishRuntimeWithAssetBudget=CommonCombatRunner.prototype.publishRuntimeQa;
  CommonCombatRunner.prototype.publishRuntimeQa=function(dt){
    corePublishRuntimeWithAssetBudget.call(this,dt);if(!this.runtimeQaNode)return;
    try{const profile=window.AfterSignalPlatform?.performance?.get?.()||"MID",report=JSON.parse(this.runtimeQaNode.textContent||"{}"),stats=this.frameIntervalStats||{count:0,totalMs:0,maxMs:0,longFrameCount:0,buckets:[]},costs=this.frameCostStats||{count:0,updateTotalMs:0,drawTotalMs:0,maxUpdateMs:0,maxDrawMs:0},threshold=Math.max(1,Math.ceil(stats.count*.95));let accumulated=0,p95Ms=0;for(let index=0;index<stats.buckets.length;index++){accumulated+=stats.buckets[index]||0;if(accumulated>=threshold){p95Ms=index*2;p95Ms+=2;break;}}const unprocessedPoseSources=[...this.images].filter(([source,image])=>this.spriteAssetPolicies?.has(source)&&!this.chromaSprites?.has(source)&&image?.complete&&image.naturalWidth).length;report.assetBudget={strategy:"LAZY_DIRECTIONAL_IDLE_LRU",maxProcessedPoseCache:this.processedPoseCacheLimit(),maxProcessingSide:384,maxConcurrentSpriteDecodes:2,processedPoseCache:this.chromaSprites?.size||0,pendingSpriteDecodes:this.spriteDecodeQueue?.length||0,activeSpriteDecodes:this.spriteDecodeActive||0,pendingSpritePreprocess:this.spritePreprocessQueue?.length||0,idleSpriteProcessed:this.qa.spriteIdleProcessed||0,residentUnprocessedPoseSources:unprocessedPoseSources,residentSources:this.images.size,activeImageSourceCount:this.images.size,decodedBytesEstimate:this.memory.decodedBytesEstimate,releasedDecodedBytesEstimate:this.memory.releasedDecodedBytesEstimate,runtimeRasterSurfaceLimit:36,runtimeRasterSurfaces:this.memory.runtimeRasterSurfaces||0,runtimeRasterBytes:this.memory.runtimeRasterBytes||0,backgroundCompositeReady:Boolean(this.backgroundComposite),backgroundCompositeBytes:this.memory.backgroundCompositeBytes||0};report.performance={profile,targetFps:profile==="LOW"?24:profile==="HIGH"?60:30,frameIntervalAverageMs:stats.count?Number((stats.totalMs/stats.count).toFixed(2)):0,frameIntervalP95Ms:p95Ms,maxFrameIntervalMs:Number((stats.maxMs||0).toFixed(2)),longFrameCount:stats.longFrameCount||0,presentedFrameCount:stats.count||0,activeRafCount:this.terminalPaused||this.disposed?0:1,battleTimerClockCount:this.running&&!this.completed&&!this.terminalPaused&&this.timeLimitMs>0?1:0,fullScreenCutin:false,cameraImpulseMaxPx:4.5,averageUpdateCostMs:costs.count?Number((costs.updateTotalMs/costs.count).toFixed(3)):0,averageDrawCostMs:costs.count?Number((costs.drawTotalMs/costs.count).toFixed(3)):0,maxUpdateCostMs:Number((costs.maxUpdateMs||0).toFixed(3)),maxDrawCostMs:Number((costs.maxDrawMs||0).toFixed(3)),hudDomRendered:this.qa.hudDomRendered||0,hudDomSkipped:this.qa.hudDomSkipped||0,timerDomRendered:this.qa.timerDomRendered||0,timerDomSkipped:this.qa.timerDomSkipped||0,hitStopRequestedMs:Number((this.qa.hitStopRequestedMs||0).toFixed(2)),hitStopAppliedMs:Number((this.qa.hitStopAppliedMs||0).toFixed(2)),hitStopSuppressedMs:Number((this.qa.hitStopSuppressedMs||0).toFixed(2)),hitStopByKind:{...(this.qa.hitStopByKind||{})}};report.telemetryBudget={eventTraceCount:this.qa.eventTrace.length,poseEvidenceCount:(this.qa.poseEvidence||[]).length,enemyMotionEvidenceCount:(this.qa.enemyMotionEvidence||[]).length,publishedAttackTransactions:report.attackTransactions?.length||0,publishedShotTransactions:report.shotTransactions?.length||0,publishedPoseEvidence:report.poseEvidence?.length||0,publishedEnemyMotionEvidence:report.enemyMotionEvidence?.length||0};this.runtimeQaNode.textContent=JSON.stringify(report);}catch{}
  };
  const corePublishRuntimeUnthrottled=CommonCombatRunner.prototype.publishRuntimeQa;
  CommonCombatRunner.prototype.publishRuntimeQa=function(dt){
    const now=performance.now(),interval=window.AfterSignalPlatform?.debug?.enabled?500:1500,urgent=Boolean(this.disposed||this.terminalPaused||this.completed||this.__afTimeLimitExpired);
    if(!urgent&&this.__afLastQaPublishAt&&now-this.__afLastQaPublishAt<interval)return;
    // PERF_FULLCHECK_20260926: outside QA the ~340 KB report is only published at start and for terminal states; the
    // periodic rebuild (six JSON passes, 26-62 ms at 4x CPU) caused a stutter every 1.5 s on slower devices.
    if(!urgent&&this.__afLastQaPublishAt&&!window.AfterSignalPlatform?.debug?.enabled&&!window.__AF_RUNTIME_QA_LIVE__)return;
    this.__afLastQaPublishAt=now;const started=performance.now();corePublishRuntimeUnthrottled.call(this,dt);const cost=performance.now()-started;this.qa.qaPublishCount=(this.qa.qaPublishCount||0)+1;this.qa.qaPublishCostTotal=(this.qa.qaPublishCostTotal||0)+cost;this.qa.qaPublishCostMax=Math.max(this.qa.qaPublishCostMax||0,cost);
  };
  const coreUpdate=CommonCombatRunner.prototype.update;
  CommonCombatRunner.prototype.update=function(dt){
    if((this.lifecycleResumeGraceUntil||0)>performance.now())return;
    if(this.running&&!this.completed&&!this.terminalPaused&&this.timeLimitMs>0){this.timeRemainingMs=Math.max(0,this.timeRemainingMs-dt*1000);this.renderTimer();if(this.timeRemainingMs<=0&&!this.__afTimeLimitExpired){this.__afTimeLimitExpired=true;this.qa.defeatEventCount++;this.trace("time_limit_expired",{stageId:this.stageId,timeLimitMs:this.timeLimitMs,profile:this.session.battleSpec.rules?.timeLimitProfile||null});this.session.emit("onBattleLost",{reason:"time_limit"});this.presentDefeat("time_limit");this.publishRuntimeQa(dt);return false;}}
    if(this.running)this.advanceUltimateSequence(dt);
    const actionStates=[];
    // Manual mode is scoped to the selected slot only. Every other living,
    // actionable party member retains auto-target and auto-fire so selecting a
    // character never stalls the rest of the five-slot party.
    if(this.running&&this.hitStop<=0){
      for(const player of this.players){
        if(!player||(player.reviveClock||0)<=0)continue;
        player.reviveClock=Math.max(0,player.reviveClock-dt);
        if(player.reviveClock>0)continue;
        const rules=this.session.battleSpec.rules||{},hp=Math.max(1,Math.round(player.member.maxHp*(Number(rules.reviveHpRatio)||.55)));
        this.session.party.transition(player.slot,"revive",{hp});player.ammo=player.magazineSize;player.reloadClock=0;player.coverRequested=false;player.coverClock=0;
        if(!this.session.party.activeMember()?.targetable||this.session.party.activeMember()?.hp<=0)this.session.party.select(player.slot);
        this.trace("character_revived",{characterId:player.spec.id,hp,maxHp:player.member.maxHp,chargesRemaining:player.reviveCharges});this.renderHud();
      }
      for(const player of this.players){
        if(!player)continue;
        player.muzzleFlashClock=Math.max(0,(player.muzzleFlashClock||0)-dt);player.recoilImpulse=(player.recoilImpulse||0)*Math.exp(-Math.max(0,dt)*20);
        const desired=this.aimTargetFor(player),aim=player.smoothedAim||(player.smoothedAim={x:desired.x,y:desired.y}),alpha=this.isAutoControlled(player)?1-Math.exp(-Math.max(0,dt)*5.8):1/* COMBAT_AIM_RESPONSE_V1 */;aim.x+=(desired.x-aim.x)*alpha;aim.y+=(desired.y-aim.y)*alpha;this.presentAim(player,dt);const controller=this.session.controllers.get(player.spec.id),firePoseSeconds=player.spec.combatTiming?.firePoseSeconds??.18;if(controller?.clip.state===F.CharacterState.FIRE&&controller.clip.stateTime>=firePoseSeconds)controller.setState(F.CharacterState.AIM);
        let state=null;
        if(player.reloadClock>0){
          player.reloadClock=Math.max(0,player.reloadClock-dt);
          player.cooldown=Math.max(player.cooldown,.12);
          state=F.CharacterState.RELOAD;
          if(player.reloadClock===0){player.ammo=player.magazineSize;this.trace("reload_complete",{characterId:player.spec.id,ammo:player.ammo,magazineSize:player.magazineSize});this.renderHud();}
        }else if(player.coverRequested){
          player.coverClock+=dt;
          player.cooldown=Math.max(player.cooldown,.12);
          state=player.coverClock<.38?F.CharacterState.COVER_DESCENT:(player.coverClock<.68?F.CharacterState.COVER_SETTLE:F.CharacterState.COVER_HOLD);
        }
        if(state)actionStates.push({player,state});
      }
    }
    if(this.running&&this.hitStop<=0){
      this.enemyProjectiles=this.enemyProjectiles||[];
      for(const enemy of this.enemies){
        const bossPhase=enemy.bossRuntime?.config?.phases?.[enemy.bossRuntime.phaseIndex]||null;
        const bossKinds=String(bossPhase?.attackProfile||"signal_lance").split("/").filter(Boolean);
        const bossKind=bossKinds[Math.floor((enemy.motionTime||0)/1.7)%bossKinds.length]||"signal_lance";
        const registeredMotion=enemy.spec.movement||{},motion=registeredMotion.mode?registeredMotion:(enemy.bossRuntime?{mode:"ground_patrol",stepSeconds:1.7,stepDistance:44}:registeredMotion),attack=enemyAttackContract(enemy,bossKind),phase=enemy.attackPhase||0;
        enemy.motionTime=(enemy.motionTime||0)+dt;
        if(motion.mode==="aerial_orbit"){
          const cycle=Math.max(.5,motion.cycleSeconds||2.2),angle=enemy.motionTime/cycle*Math.PI*2+phase;
          enemy.x=enemy.originX+Math.sin(angle)*(motion.rangeX||40);
          enemy.y=enemy.originY+Math.cos(angle*1.27)*(motion.rangeY||26);
          const velocityX=Math.cos(angle)*(motion.rangeX||40),velocityY=-Math.sin(angle*1.27)*1.27*(motion.rangeY||26);
          const absX=Math.abs(velocityX),absY=Math.abs(velocityY),transitionBand=Math.abs(absX-absY)/Math.max(1,absX+absY);
          enemy.poseDirection=transitionBand<.16?"front":(absY>absX?(velocityY>0?"down":"up"):(velocityX>0?"right":"left"));
        }else if(motion.mode){
          const cycle=Math.max(.5,motion.stepSeconds||1.1),phase01=(enemy.motionTime/cycle+phase)%2,forward=phase01<1?phase01:2-phase01;
          enemy.x=enemy.originX+(forward-.5)*(motion.stepDistance||32);
          enemy.y=enemy.originY;
          enemy.poseDirection=phase01<1?"right":"left";
        }
        const motionSource=enemy.spec.motionAssets?.[enemy.poseDirection]||null;if(motionSource&&!this.images.has(motionSource))this.requestAsset(motionSource);const motionImage=motionSource?this.images.get(motionSource):null;if(decodedRenderable(motionImage)){enemy.motionImages=enemy.motionImages||{};enemy.motionImages[enemy.poseDirection]=motionImage;enemy.__afLastRenderableImage=motionImage;if(motionImage.__afEnemyPrepared)enemy.__afLastPreparedImage=motionImage;}const baseImage=this.images.get(enemy.spec.asset);if(decodedRenderable(baseImage)){enemy.__afLastRenderableImage=baseImage;if(baseImage.__afEnemyPrepared)enemy.__afLastPreparedImage=baseImage;}const directionalImage=enemy.motionImages?.[enemy.poseDirection];enemy.img=decodedRenderable(directionalImage)?directionalImage:enemy.__afLastPreparedImage||enemy.__afLastRenderableImage||null;this.captureEnemyMotionEvidence(enemy,bossPhase?.id||null);
        if(enemy.attackTelegraph>0){
          enemy.attackTelegraph-=dt;
          if(enemy.attackTelegraph<=0){
            const aliveTargets=this.players.filter(player=>player&&player.member.hp>0&&player.member.targetable!==false),target=aliveTargets.length?aliveTargets[Math.max(0,(enemy.attackSequence||1)-1)%aliveTargets.length]:null;
            if(target&&enemy.alive!==false){const sx=enemy.x,sy=enemy.y,dx=target.x-sx,dy=(target.y-playerBodyPx(target)*.6)-sy,length=Math.hypot(dx,dy)||1,speed=attack.projectileSpeed||270,attackId=enemy.activeAttackId||`${enemy.id}:${++enemy.attackSequence}`;
              this.enemyProjectiles.push({x:sx,y:sy,px:sx,py:sy,vx:dx/length*speed,vy:dy/length*speed,age:0,life:2.6,radius:["plate_lance","core_line","signal_erase_wave"].includes(attack.kind)?9:6,kind:attack.kind||"signal_orb",damage:attack.damage||8,hitStop:attack.hitStop||24,camera:attack.camera||3,cooldownSeconds:attack.cadence||2,source:enemy,target,attackId});
              this.trace("attackCommit",{attackId,enemyId:enemy.spec.id,kind:attack.kind||"signal_orb",phaseId:bossPhase?.id||null,damage:attack.damage||8,projectileSpeed:speed});
              this.trace(enemy.bossRuntime?"boss_skill":"enemy_attack",{attackId,enemyId:enemy.spec.id,kind:attack.kind||"signal_orb",phaseId:bossPhase?.id||null});
              enemy.pendingResolutionAttackId=attackId;this.trace("cooldown_started",{attackId,enemyId:enemy.spec.id,seconds:attack.cadence||2,state:"timer_reserved"});enemy.activeAttackId=null;
            }
          }
        }else{
          enemy.attackClock=(enemy.attackClock??(attack.cadence||2))-dt;
          if(enemy.attackClock<=0&&!enemy.pendingResolutionAttackId){if(enemy.cooldownCompleteAttackId){this.trace("cooldown_complete",{attackId:enemy.cooldownCompleteAttackId,enemyId:enemy.spec.id});enemy.cooldownCompleteAttackId=null;}enemy.attackClock=attack.cadence||2;enemy.attackTelegraph=attack.telegraph||.28;enemy.telegraphTotal=enemy.attackTelegraph;enemy.telegraphKind=attack.kind||"signal_orb";enemy.activeAttackId=`${enemy.id}:${++enemy.attackSequence}`;this.trace("telegraphStart",{attackId:enemy.activeAttackId,enemyId:enemy.spec.id,kind:enemy.telegraphKind,duration:enemy.telegraphTotal,phaseId:bossPhase?.id||null});this.trace(enemy.bossRuntime?"boss_skill_telegraph":"enemy_attack_telegraph",{attackId:enemy.activeAttackId,enemyId:enemy.spec.id,kind:enemy.telegraphKind,duration:enemy.telegraphTotal});}
        }
      }
      for(const shot of this.enemyProjectiles){
        shot.px=shot.x;shot.py=shot.y;shot.x+=shot.vx*dt;shot.y+=shot.vy*dt;shot.age+=dt;
        const target=shot.target?.member?.hp>0?shot.target:this.players.find(player=>player&&player.member.hp>0&&player.member.targetable!==false);
        if(this.resolveStagePropShot(shot,false))continue;
        if(target&&shot.source?.alive!==false&&Math.hypot(target.x-shot.x,target.y-playerBodyPx(target)*.6-shot.y)<Math.max(44,playerBodyPx(target)*.34)){shot.age=shot.life;this.trace("hitWindow",{attackId:shot.attackId,enemyId:shot.source?.spec?.id,target:target.spec.id});this.trace("collision",{attackId:shot.attackId,enemyId:shot.source?.spec?.id,target:target.spec.id,x:Number(shot.x.toFixed(2)),y:Number(shot.y.toFixed(2))});this.applyEnemyHit(shot,target);}
      }
      for(const shot of this.enemyProjectiles){const expired=shot.age>=shot.life||shot.x<=-90||shot.x>=this.width+90||shot.y<=-90||shot.y>=this.height+90;if(expired&&shot.source?.pendingResolutionAttackId===shot.attackId){this.trace("attackMiss",{attackId:shot.attackId,enemyId:shot.source?.spec?.id||null,kind:shot.kind});this.trace("cooldown",{attackId:shot.attackId,enemyId:shot.source?.spec?.id||null,seconds:shot.cooldownSeconds||2,state:"armed_after_miss"});shot.source.pendingResolutionAttackId=null;shot.source.cooldownCompleteAttackId=shot.attackId||null;}}
      this.enemyProjectiles=this.enemyProjectiles.filter(shot=>shot.source?.alive!==false&&shot.age<shot.life&&shot.x>-90&&shot.x<this.width+90&&shot.y>-90&&shot.y<this.height+90);
      this.incomingImpacts.forEach(effect=>effect.age+=dt);this.incomingImpacts=this.incomingImpacts.filter(effect=>effect.age<effect.life);
      this.damageNumbers.forEach(effect=>{effect.age+=dt;effect.y-=dt*34;});this.damageNumbers=this.damageNumbers.filter(effect=>effect.age<effect.life);
    }
    const guardedControllers=actionStates.map(({player,state})=>{const controller=this.session.controllers.get(player.spec.id),setState=controller?.setState;if(controller&&controller.clip.state!==state)setState.call(controller,state);if(controller)controller.setState=next=>{if(next===state)setState.call(controller,next);};return{controller,setState};});
    for(const player of this.players)if(player?.motionFactorySequencePlaying)player.cooldown=Math.max(player.cooldown||0,.12);
    const combatAimGuards=this.players.filter(player=>player&&!player.coverRequested&&player.reloadClock<=0).map(player=>{const controller=this.session.controllers.get(player.spec.id),setState=controller?.setState;if(controller)controller.setState=next=>setState.call(controller,next===F.CharacterState.STAND?F.CharacterState.AIM:next);return{controller,setState};});
    const pinUltimatePeak=()=>{if(!this.qaHoldUltimatePeak)return;for(const effect of this.ultimateFx){const profile=ultimateVfxProfile(effect.owner?.spec?.id);effect.age=profile.charge+profile.bloom+profile.impact*.5;}};pinUltimatePeak();const result=coreUpdate.call(this,dt);this.advanceMotionFactorySequences(dt);pinUltimatePeak();
    if(this.running&&this.ultimateAuto&&!this.ultimateSequence){const ready=this.players.find(player=>player&&player.member.hp>0&&player.member.ultimateGauge>=100);if(ready)this.castUltimate(ready,true);}
    for(const guard of combatAimGuards)if(guard.controller)guard.controller.setState=guard.setState;
    for(const guard of guardedControllers)if(guard.controller)guard.controller.setState=guard.setState;
    if(!this.running&&!this.completed&&this.qa.defeatEventCount)this.presentDefeat(this.integrity?.value<=0?"environment_integrity":"party_defeated");
    this.presentCompletion();
    this.actions?.querySelector("[data-cover]")?.classList.toggle("active",Boolean(this.selected()?.coverRequested));
    this.actions?.querySelector("[data-reload]")?.classList.toggle("active",Boolean(this.selected()?.reloadClock>0));
    const motionFactoryAction=this.actions?.querySelector("[data-motion-factory]"),motionFactorySelected=this.selected(),motionFactoryAvailable=Boolean(motionFactorySelected?.spec?.combatClips?.REAR_COVER_FIRE_RETURN_FRAMES?.length);if(motionFactoryAction){const motionDisabled=!motionFactoryAvailable,motionPlaying=Boolean(motionFactorySelected?.motionFactorySequencePlaying),motionText=motionPlaying?`120F 골든 모션 ${String((motionFactorySelected.motionFactorySequenceFrame||0)+1).padStart(3,"0")}/120`:`120F 골든 모션 [V]`;if(motionFactoryAction.disabled!==motionDisabled)motionFactoryAction.disabled=motionDisabled;if(motionFactoryAction.classList.contains("active")!==motionPlaying)motionFactoryAction.classList.toggle("active",motionPlaying);if(motionFactoryAction.textContent!==motionText)motionFactoryAction.textContent=motionText;}
    const ultimateAction=this.actions?.querySelector("[data-ultimate]"),ultimateOwner=this.selected();if(ultimateAction){const gauge=Math.round(ultimateOwner?.member.ultimateGauge||0),ultimateText=`필살기 [E] · ${gauge}%`,ultimateDisabled=!ultimateOwner||gauge<100||Boolean(this.ultimateSequence);if(ultimateAction.textContent!==ultimateText)ultimateAction.textContent=ultimateText;if(ultimateAction.classList.contains("ready")!==(gauge>=100))ultimateAction.classList.toggle("ready",gauge>=100);if(ultimateAction.disabled!==ultimateDisabled)ultimateAction.disabled=ultimateDisabled;}
    if(actionStates.length)this.publishRuntimeQa(dt);
    return result;
  };
  const enemyShotPalette=kind=>({relay_bolt:["#fff5df","#ff8e60","#ff476f"],shard_bolt:["#efffff","#76e7ff","#7661ff"],plate_lance:["#fff4ce","#ffad4d","#ff365e"],signal_orb:["#fff8ef","#ff6c91","#7f48ff"],guard_lance:["#f5ffff","#5ff4ff","#b44cff"],warning_pulse:["#fff1fb","#ff63ba","#842bff"],core_line:["#ffffff","#ffd974","#ff3b62"],signal_erase_wave:["#ffffff","#ff4ba0","#5b20ff"]}[kind]||["#fff7ec","#ff667c","#7f48ff"]);
  const drawEnemyProjectiles=(ctx,shots)=>shots.forEach(shot=>{const palette=enemyShotPalette(shot.kind),dx=shot.x-shot.px,dy=shot.y-shot.py,angle=Math.atan2(dy,dx),trail=ctx.createLinearGradient(shot.px,shot.py,shot.x,shot.y);trail.addColorStop(0,"rgba(255,90,130,0)");trail.addColorStop(.62,palette[1]);trail.addColorStop(1,palette[0]);ctx.save();ctx.globalCompositeOperation="lighter";ctx.strokeStyle=trail;ctx.lineWidth=shot.kind==="signal_erase_wave"?shot.radius*3:shot.radius*1.45;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(shot.px,shot.py);ctx.lineTo(shot.x,shot.y);ctx.stroke();ctx.translate(shot.x,shot.y);ctx.rotate(angle);if(epicEnabled){const bossShot=Boolean(shot.source?.bossRuntime),wobble=2.2+.5*Math.sin((shot.age||0)*30);epicGlowAt(ctx,0,0,shot.radius*(bossShot?6.5:4.6),palette[1],.85);if(bossShot)epicRing(ctx,0,0,shot.radius*wobble,shot.radius*wobble,1.6,palette[0],.8);ctx.globalAlpha=1;}else{ctx.shadowColor=palette[1];ctx.shadowBlur=20;}ctx.fillStyle=palette[0];if(["plate_lance","guard_lance","core_line"].includes(shot.kind)){ctx.beginPath();ctx.moveTo(shot.radius*2.8,0);ctx.lineTo(-shot.radius*1.8,-shot.radius*.72);ctx.lineTo(-shot.radius*.8,0);ctx.lineTo(-shot.radius*1.8,shot.radius*.72);ctx.closePath();ctx.fill();}else if(shot.kind==="shard_bolt"){ctx.beginPath();ctx.moveTo(shot.radius*2.1,0);ctx.lineTo(0,-shot.radius);ctx.lineTo(-shot.radius*1.3,0);ctx.lineTo(0,shot.radius);ctx.closePath();ctx.fill();}else{const halo=ctx.createRadialGradient(0,0,0,0,0,shot.radius*(shot.kind==="signal_erase_wave"?5:3));halo.addColorStop(0,"#fffdf4");halo.addColorStop(.24,palette[1]);halo.addColorStop(1,"rgba(255,70,130,0)");ctx.fillStyle=halo;ctx.beginPath();ctx.arc(0,0,shot.radius*(shot.kind==="signal_erase_wave"?5:3),0,Math.PI*2);ctx.fill();if(shot.kind==="warning_pulse"||shot.kind==="signal_erase_wave"){ctx.strokeStyle=palette[0];ctx.lineWidth=2;for(let ring=1;ring<=3;ring++){ctx.beginPath();ctx.arc(0,0,shot.radius*(1.3+ring),0,Math.PI*2);ctx.stroke();}}}ctx.restore();});
  const drawIncomingImpacts=(ctx,effects,numbers)=>{effects.forEach(effect=>{const t=effect.age/effect.life,p=1-t,palette=enemyShotPalette(effect.kind);ctx.save();ctx.translate(effect.x,effect.y);ctx.globalCompositeOperation="lighter";ctx.globalAlpha=p;ctx.strokeStyle=palette[1];if(!epicEnabled){ctx.shadowColor=palette[2];ctx.shadowBlur=22;}ctx.lineWidth=4;for(let ray=0;ray<8;ray++){ctx.rotate(Math.PI/4);ctx.beginPath();ctx.moveTo(12,0);ctx.lineTo(22+34*t,0);ctx.stroke();}ctx.restore();});numbers.forEach(number=>{const colors={NORMAL:["#eafbff","#123b51"],CRITICAL:["#ffe46b","#6b2e00"],CORE:["#ff78c9","#3b063d"],INCOMING:["#ffdae5","#2a0714"]}[number.kind]||["#ffdae5","#2a0714"];ctx.save();ctx.globalAlpha=Math.max(0,1-number.age/number.life);ctx.textAlign="center";ctx.strokeStyle=colors[1];ctx.fillStyle=colors[0];ctx.lineWidth=5;ctx.font=number.kind==="CORE"?"1000 32px ui-monospace":"900 26px ui-monospace";ctx.strokeText(number.text,number.x,number.y);ctx.fillText(number.text,number.x,number.y);if(number.label){ctx.lineWidth=3;ctx.font="900 11px ui-monospace";ctx.strokeText(number.label,number.x,number.y-28);ctx.fillText(number.label,number.x,number.y-28);}ctx.restore();});};
  CommonCombatRunner.prototype.draw=function(){
    const shake=this.camera>0?(Math.random()-.5)*Math.min(4.5,this.camera):0;this.camera=Math.max(0,this.camera-.9);
    const ctx=this.ctx;ctx.save();ctx.translate(shake,shake);ctx.clearRect(-30,-30,this.width+60,this.height+60);this.drawBackground(ctx);
    // Plane 1: player character, anchored above the HUD-safe baseline.
    this.drawSquadCoverBase?.(ctx);/* COMBAT_COVER_PLACEMENT_V1: cover stands between the unit and the enemies */
    this.players.forEach(player=>{if(!player)return;this.drawPlayerSprite(ctx,player);});
    // Planes 2-4: ground, mid, aerial.  The order is semantic, not spawn order.
    this.drawStageGroundPlane(ctx,drawEnemyPlane);
    ["background2","background3"].forEach(plane=>this.enemies.filter(enemy=>(enemy.renderLayer||enemy.spec.depthBand||"background1")===plane).forEach(enemy=>drawEnemyPlane(this,ctx,enemy)));
    // Bosses keep their configured mid-plane even when an older data entry has no depth band.
    this.enemies.filter(enemy=>enemy.bossRuntime&&!enemy.renderLayer).forEach(enemy=>drawEnemyPlane(this,ctx,enemy));
    drawEnemyProjectiles(ctx,this.enemyProjectiles||[]);
    this.drawSquadCover(ctx);
    drawIncomingImpacts(ctx,this.incomingImpacts||[],this.damageNumbers||[]);
    this.projectiles.forEach(projectile=>projectile.spec?.silhouette==="page-card"&&epicEnabled?drawPageCard(ctx,projectile):projectile.spec?.silhouette==="drone-dart"&&epicEnabled?drawDroneDart(ctx,projectile):projectile.spec?.silhouette==="coil-bolt"&&epicEnabled?drawCoilBolt(ctx,projectile):projectile.spec?.silhouette==="star-rail"&&epicEnabled?drawStarRail(ctx,projectile):projectile.spec?.silhouette==="cross-seal"&&epicEnabled?drawCrossSeal(ctx,projectile):projectile.spec?.silhouette==="vanguard-pulse"&&epicEnabled?drawVanguardPulse(ctx,projectile):projectile.spec?.silhouette==="amber-rail"&&epicEnabled?drawAmberRailV2(ctx,projectile):projectile.spec?.silhouette==="seal-glyph"&&epicEnabled?drawSealGlyph(ctx,projectile):projectile.spec?.silhouette==="twin-needle"&&epicEnabled?drawTwinNeedle(ctx,projectile):projectile.spec?.silhouette==="lattice-pulse"&&epicEnabled?drawLatticePulse(ctx,projectile):projectile.spec?.silhouette==="hunter-slug"&&epicEnabled?drawHunterSlug(ctx,projectile):projectile.spec?.silhouette==="channel-vane"&&epicEnabled?drawChannelVane(ctx,projectile):projectile.spec?.id==="karin_foundry_heavy_round"&&epicEnabled?drawFoundryRound(ctx,projectile):projectile.spec?.id==="serin_seal_thread"&&epicEnabled?drawSealThread(ctx,projectile):CHAR_VFX_SHOTS[projectile.spec?.silhouette]?.trail&&epicEnabled?CHAR_VFX_SHOTS[projectile.spec.silhouette].trail(ctx,projectile):F.CombatVfxRenderer.drawTrail(ctx,projectile));
    this.impacts.forEach(impact=>impact.spec?.silhouette==="page-card"&&epicEnabled?drawPageCardImpact(ctx,impact):impact.spec?.silhouette==="drone-dart"&&epicEnabled?drawDroneImpact(ctx,impact):impact.spec?.silhouette==="coil-bolt"&&epicEnabled?drawCoilImpact(ctx,impact):impact.spec?.silhouette==="star-rail"&&epicEnabled?drawStarImpact(ctx,impact):impact.spec?.silhouette==="cross-seal"&&epicEnabled?drawCrossImpact(ctx,impact):impact.spec?.silhouette==="vanguard-pulse"&&epicEnabled?drawVanguardImpact(ctx,impact):impact.spec?.silhouette==="amber-rail"&&epicEnabled?drawAmberRailImpact(ctx,impact):impact.spec?.silhouette==="seal-glyph"&&epicEnabled?drawSealGlyphImpact(ctx,impact):impact.spec?.silhouette==="twin-needle"&&epicEnabled?drawEvidenceTagImpact(ctx,impact):impact.spec?.silhouette==="lattice-pulse"&&epicEnabled?drawSurveyPinImpact(ctx,impact):impact.spec?.silhouette==="hunter-slug"&&epicEnabled?drawSlugPunchImpact(ctx,impact):impact.spec?.silhouette==="channel-vane"&&epicEnabled?drawVaneSealImpact(ctx,impact):impact.spec?.id==="karin_foundry_heavy_round"&&epicEnabled?drawFoundryImpact(ctx,impact):impact.spec?.id==="serin_seal_thread"&&epicEnabled?drawSealImpact(ctx,impact):CHAR_VFX_SHOTS[impact.spec?.silhouette]?.impact&&epicEnabled?CHAR_VFX_SHOTS[impact.spec.silhouette].impact(ctx,impact):F.CombatVfxRenderer.drawImpact(ctx,impact));
    this.ultimateFx.forEach(effect=>this.drawUltimateFx(ctx,effect));this.drawEpicVfx?.(ctx);this.drawAimReticle?.(ctx);if(hudEnabled)this.drawBossHudNikke(ctx);else drawBossHud(this,ctx);ctx.restore();
  };
  const responsiveStyle=document.createElement("style");responsiveStyle.textContent=`#af-orientation-gate{display:none!important}@media (max-height:500px) and (orientation:landscape){#af-common-party{bottom:max(4px,env(safe-area-inset-bottom));gap:2px;padding:0 4px}#af-common-party button{height:68px;min-height:0;padding:4px 3px 17px 36px;overflow:hidden}#af-common-party img{left:3px;width:30px;height:46px;object-position:50% 18%}#af-common-party small,#af-common-party b,#af-common-party i{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#af-common-party small{font-size:6px;line-height:1.05;letter-spacing:0}#af-common-party b{font-size:8px;line-height:1.15}#af-common-party i{font-size:6px;line-height:1.1}#af-common-party .af-bars{left:36px;right:3px;grid-template-columns:1fr 1fr 25px;gap:2px}#af-common-party .af-ammo-text{font-size:6px}#af-common-actions{top:max(54px,env(safe-area-inset-top))!important;left:max(6px,env(safe-area-inset-left))!important;right:auto!important;bottom:auto!important;width:72px!important;display:flex;flex-direction:column;gap:4px}#af-common-actions button{width:72px!important;min-width:72px;min-height:28px;padding:3px 6px;font-size:9px}}@media (orientation:portrait){html,body{width:100%!important;height:100%!important;min-height:0!important;overflow:hidden!important}.app,.game-shell,#viewport,.viewport{position:relative!important;width:100vw!important;height:100svh!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;aspect-ratio:auto!important;margin:0!important;overflow:hidden!important}#game,#battle{position:absolute!important;top:0!important;bottom:auto!important;left:50%!important;right:auto!important;width:auto!important;height:100%!important;min-width:100%!important;max-width:none!important;transform:translateX(-50%)!important;transform-origin:center!important}#af-common-party{left:max(4px,env(safe-area-inset-left))!important;right:max(4px,env(safe-area-inset-right))!important;bottom:max(5px,env(safe-area-inset-bottom))!important;gap:3px!important}#af-common-party button{height:72px!important;min-height:72px!important;padding:4px 2px 17px 38px!important}#af-common-party img{left:2px!important;top:2px!important;width:34px!important;height:54px!important}#af-common-party small{font-size:6px!important;line-height:1.05!important}#af-common-party b{font-size:8px!important;line-height:1.1!important}#af-common-party i{font-size:6px!important;line-height:1.05!important}#af-common-party .af-bars{left:38px!important;right:2px!important;grid-template-columns:1fr 1fr 24px!important;gap:2px!important}#af-common-party .af-ammo-text{font-size:6px!important}#af-common-actions{top:max(86px,env(safe-area-inset-top))!important;right:max(6px,env(safe-area-inset-right))!important;bottom:auto!important;display:flex!important;flex-direction:column!important;gap:4px!important}#af-common-actions button{width:70px!important;min-width:70px!important;min-height:30px!important;padding:3px!important;font-size:8px!important}#af-party-layout-editor{top:max(158px,env(safe-area-inset-top))!important;right:max(6px,env(safe-area-inset-right))!important;max-width:152px!important;font-size:9px!important}.mission,.mission-card,.objective{max-width:68vw!important}.topbar,.hud-top{padding-left:max(6px,env(safe-area-inset-left))!important;padding-right:max(6px,env(safe-area-inset-right))!important}}`;document.head.append(responsiveStyle);
  const overlaySafetyStyle=document.createElement("style");overlaySafetyStyle.textContent=`body[data-af-common-combat-active="v1"][data-af-combat-started="false"] :is(#af-common-party,#af-common-actions,#af-party-layout-editor){visibility:hidden!important;pointer-events:none!important}body[data-af-common-combat-active="v1"] :is(#start,#startOverlay,#introOverlay,[data-combat-start-overlay],#result,#resultOverlay){z-index:100!important;pointer-events:auto!important;overscroll-behavior:contain}body[data-af-common-combat-active="v1"] :is(#start,#startOverlay,#introOverlay,[data-combat-start-overlay],#result,#resultOverlay)>*{position:relative;z-index:1;max-height:calc(100svh - max(16px,env(safe-area-inset-top)) - max(16px,env(safe-area-inset-bottom)));overflow-y:auto;overscroll-behavior:contain}body[data-af-common-combat-active="v1"] :is(#startButton,#finishButton,#retryButton){position:relative!important;z-index:3!important;pointer-events:auto!important;touch-action:manipulation!important;cursor:pointer!important}@media (orientation:portrait){body[data-af-common-combat-active="v1"] :is(#start,#startOverlay,#introOverlay,[data-combat-start-overlay],#result,#resultOverlay){inset:0!important;padding:max(8px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left))!important;place-items:center!important;overflow:hidden!important}body[data-af-common-combat-active="v1"] :is(#start,#startOverlay,#introOverlay,[data-combat-start-overlay],#result,#resultOverlay)>*{width:min(94vw,620px)!important;max-height:calc(100svh - max(16px,env(safe-area-inset-top)) - max(16px,env(safe-area-inset-bottom)))!important;box-sizing:border-box!important;padding:clamp(12px,2.8vh,26px)!important;margin:0!important}body[data-af-common-combat-active="v1"] :is(#start,#startOverlay,#introOverlay,[data-combat-start-overlay]) h1{font-size:clamp(28px,7vw,48px)!important;margin:.25em 0!important}body[data-af-common-combat-active="v1"] :is(#start,#startOverlay,#introOverlay,[data-combat-start-overlay]) p{margin:.55em 0!important;line-height:1.35!important}body[data-af-common-combat-active="v1"] :is(#start,#startOverlay,#introOverlay,[data-combat-start-overlay]) :is(.deploy,.deployment,.roster,.cards){margin:.7em 0!important;gap:6px!important}body[data-af-common-combat-active="v1"] :is(#startButton,#finishButton,#retryButton){margin-top:10px!important;min-height:48px!important}}`;document.head.append(overlaySafetyStyle);
  const corePublishRuntimeWithControlContract=CommonCombatRunner.prototype.publishRuntimeQa;
  CommonCombatRunner.prototype.publishRuntimeQa=function(dt){
    // PERF FIX 2026-09-23: this wrapper sits outside the 1.5 s QA throttle. Only enrich the report when the
    // throttled inner publish actually ran; otherwise it JSON-parsed/stringified the whole report every frame.
    const publishedBefore=this.qa?.qaPublishCount||0;
    corePublishRuntimeWithControlContract.call(this,dt);
    if((this.qa?.qaPublishCount||0)===publishedBefore)return;
    if(!this.runtimeQaNode?.textContent)return;
    try{
      const report=JSON.parse(this.runtimeQaNode.textContent),selected=this.selected();
      report.controlContract={partyAuto:Boolean(this.auto),selectedCharacterId:selected?.spec?.id||null,manualCharacterId:this.auto?null:(selected?.spec?.id||null),nonSelectedAuto:true};
      report.motionContract={referenceStyle:"REAR_COVER_SHOOTER",targetLock:"UNTIL_TARGET_DEFEATED",aimSmoothing:"FRAME_RATE_INDEPENDENT_EXPONENTIAL_5_8",bodyPose:"SINGLE_AUTHORED_FRAME_HYSTERESIS",authoredBodyFrames:32,logicalInterpolationTicks:120,muzzlePath:"120_TICK_CONTINUOUS",recoil:"LOWER_BODY_PIVOT_DECAY",alphaGhostBodies:0,astra:{provider:"LOCAL_MOTION_FACTORY",preset:"REAR_COVER_FIRE_RETURN",authoredFrames:120,fps:30,canvas:[512,512],bodyAuthorityHeight:274,soleBaseline:486,externalImageApiCalls:0,blenderProcesses:0,comfyUiProcesses:0}};
      report.players=(report.players||[]).map(row=>{const alive=row.hp>0,automatic=this.auto||row.id!==selected?.spec?.id,player=this.players.find(candidate=>candidate?.spec?.id===row.id);return{...row,state:alive?row.state:"DEAD",controlMode:automatic?"AUTO":"MANUAL_SELECTED",autoTarget:alive&&automatic,autoFire:alive&&automatic&&!row.coverRequested,motionFactorySequence:player?.spec?.combatClips?.REAR_COVER_FIRE_RETURN_FRAMES?{available:true,playing:Boolean(player.motionFactorySequencePlaying),frame:Number(player.motionFactorySequenceFrame||0)+1,frameCount:player.spec.combatClips.REAR_COVER_FIRE_RETURN_FRAMES.length,fireEventFrames:[...(player.motionFactorySequenceEvents||[])],shotEvents:[...(player.motionFactorySequenceShotEvents||[])]}:null};});
      const playerVisuals=this.players.filter(Boolean).map(player=>{const source=player.__afLastRenderableSource||this.playerVisualSource(player),requestedRasterScale=Number(player.spec.combatAssetPolicy?.runtimeRasterScale||0),runtimeRasterScale=requestedRasterScale>0?Math.max(1.5,requestedRasterScale):0;return{id:player.spec.id,source,rendered:Boolean(player.visualEnvelope?.layers?.length),layers:player.visualEnvelope?.layers?.length||0,runtimeRasterScale:Number(player.__afLastRasterScale||1),runtimeRasterPixels:player.__afLastRenderableSource&&runtimeRasterScale>=1.5?this.runtimeRasterCache?.get(`${player.__afLastRenderableSource}::${runtimeRasterScale}`)?.width||null:null};}),enemyVisuals=this.enemies.map(enemy=>({id:enemy.spec.id,source:enemy.spec.asset,rendered:decodedRenderable(enemy.img),prepared:Boolean(enemy.img?.__afEnemyPrepared),readbackBypassed:Boolean(enemy.img?.__afEnemyPreparationBypassed)}));
      report.assetVisualGate={pinkFallbackEnabled:false,playerReadbackBypassed:this.qa.playerReadbackBypassed||0,enemyReadbackBypassed:this.qa.enemyReadbackBypassed||0,players:playerVisuals,enemies:enemyVisuals,failedSources:this.memory.failedSources||0,pass:playerVisuals.every(row=>row.rendered)&&enemyVisuals.every(row=>row.rendered)&&(this.memory.failedSources||0)===0};
      this.runtimeQaNode.textContent=JSON.stringify(report);
    }catch{}
  };
  // PERF FIX 2026-09-23 (PC + Android/iOS): each directional pose is cropped and measured once on the main
  // thread (canvas readback + pixel scan: ~4-9 ms on desktop, 20-50 ms on phones) the first time it is drawn.
  // Five deployed characters aim together, so one sweep hit several of these in the same frame (100-260 ms
  // hitches on phones), and the old 36-entry processed-pose cache (5 characters x 34 poses) repeated the work
  // on every later sweep. Now (1) the cache holds the deployed party's poses inside a byte budget
  // (48 MB touch/low-memory, 128 MB desktop; processed crops are ~0.2 MB and the full source decode is
  // released after processing), (2) poses are processed ahead of time, nearest-to-centre first:
  // continuously in short slices while the deployment overlay is up, and only in genuine idle slack once the
  // battle runs, and (3) drawing processes at most one new pose per frame; any other character keeps its
  // previous pose for that frame. The processing itself and its output are unchanged.
  const touchOrLowMemory=()=>{try{const memory=Number(navigator.deviceMemory||0);return matchMedia("(pointer: coarse)").matches||(memory>0&&memory<=4)}catch{return true}};
  CommonCombatRunner.prototype.processedPoseCacheLimit=function(){
    if(this.__afPoseCacheLimit)return this.__afPoseCacheLimit;
    let sources=0;try{for(const slot of this.session?.partySpec?.slots||[]){const unique=new Set();for(const value of Object.values(slot?.spec?.combatClips||{}))for(const item of Array.isArray(value)?value:[value])if(typeof item==="string"&&item)unique.add(item);sources+=unique.size;}}catch{}
    const limit=Math.max(36,Math.min(240,sources+8));if(sources)this.__afPoseCacheLimit=limit;return limit;
  };
  CommonCombatRunner.prototype.processedPoseCacheOverBudget=function(){
    if((this.chromaSpriteOrder?.length||0)<=36)return false;
    let bytes=0;for(const sprite of this.chromaSprites?.values?.()||[])bytes+=(sprite.width||0)*(sprite.height||0)*4;
    return bytes>(touchOrLowMemory()?48:128)*1048576;
  };
  // MODULAR_TRANSITION_V1 (2026-09-24, Claude Code): modular-bake characters used to snap between an aim frame and
  // their single cover frame at every reload/cover and hold one still image for the whole reload. Ease a per-player
  // cover weight on the wall clock and show the character's own baked aim->cover intermediates (nearest baked aim
  // bucket), then its baked reload frames by reload progress. One authored full-body image per frame, never blended.
  const coreVisualSourceMT=CommonCombatRunner.prototype.playerVisualSource;
  CommonCombatRunner.prototype.playerVisualSource=function(player){
    const base=coreVisualSourceMT.call(this,player),clips=player?.spec?.combatClips||{},mt=clips.MODULAR_TRANSITION;
    if(!mt||!base||player.motionFactorySequencePlaying)return base;
    const now=performance.now()/1000,dt=Math.min(.1,Math.max(0,now-(player.__mtClock??now)));player.__mtClock=now;
    const target=base===clips.COVER_HOLD?1:0;let w=player.__mtWeight??target;
    w=target>w?Math.min(target,w+dt/mt.descendSeconds):Math.max(target,w-dt/mt.riseSeconds);player.__mtWeight=w;
    if(!(player.reloadClock>0))player.__mtReloadTotal=0;
    const frames=clips.FIRE_DIRECTIONAL_FRAMES||[],index=Number.isInteger(player.displayPoseIndex)?player.displayPoseIndex:Math.floor(frames.length/2);
    if(w>=1){
      if(player.reloadClock>0&&mt.reload?.length){const total=player.__mtReloadTotal=Math.max(player.__mtReloadTotal||0,player.reloadClock),progress=Math.min(.999,Math.max(0,1-player.reloadClock/total));return mt.reload[Math.min(mt.reload.length-1,Math.floor(progress*mt.reload.length))];}
      return base;
    }
    if(w<=0||!mt.trans?.length)return base;
    let bucket=0;for(let i=1;i<mt.aims.length;i++)if(Math.abs(mt.aims[i]-index)<Math.abs(mt.aims[bucket]-index))bucket=i;
    const row=mt.trans[bucket],stage=Math.round(w*(row.length+1));
    if(stage<=0)return target?(frames[index]||base):base;
    if(stage>row.length)return clips.COVER_HOLD;
    return row[stage-1];
  };
  const corePrimeLoadAssets=CommonCombatRunner.prototype.loadAssets;
  CommonCombatRunner.prototype.loadAssets=function(...args){
    const result=corePrimeLoadAssets.apply(this,args);
    try{
      const lists=[];
      for(const slot of this.session?.partySpec?.slots||[]){
        const spec=slot?.spec,clips=spec?.combatClips||{},frames=clips.FIRE_DIRECTIONAL_FRAMES||[],policy=spec?.combatAssetPolicy;if(!spec||!frames.length||policy?.chromaKey)continue;
        const mid=(frames.length-1)/2,items=frames.map((source,index)=>({source,policy,rank:Math.abs(index-mid)}));
        for(const key of ["COVER_DESCENT","COVER_SETTLE","COVER_HOLD","RELOAD","MODULAR_TRANSITION_FRAMES"])for(const source of [].concat(clips[key]||[]))if(typeof source==="string"&&source)items.push({source,policy,rank:4.5});
        const seen=new Set();lists.push(items.sort((x,y)=>x.rank-y.rank).filter(item=>!seen.has(item.source)&&seen.add(item.source)));
      }
      const queue=[];for(let i=0;lists.some(list=>i<list.length);i++)for(const list of lists)if(list[i])queue.push(list[i]);
      const prime=this.qa.directionalPrime={candidates:queue.length,processed:0,alreadyProcessed:0,failed:0,processedWhileRunning:0,cacheLimit:this.processedPoseCacheLimit()};
      for(const item of queue)if(!this.images.has(item.source))this.renderableSprite(item.source,item.policy);
      this.__afPrimeQueue=queue;
      const step=deadline=>{
        if(this.disposed||!this.__afPrimeQueue?.length)return;
        const running=Boolean(this.running&&!this.terminalPaused),started=performance.now();
        for(let pass=this.__afPrimeQueue.length;pass>0&&this.__afPrimeQueue.length;pass--){
          // running battle: only when this device's measured per-pose cost fits the idle slack before the next
          // frame; slower devices (> 11 ms per pose) process on demand in the draw budget instead
          const need=(this.__afPoseCostMs||8)+1;if(running?need>12||!(deadline?.timeRemaining?.()>=need):performance.now()-started>12)break;
          const item=this.__afPrimeQueue.shift();
          if(this.chromaSprites?.has(item.source)){prime.alreadyProcessed++;continue;}
          const image=this.images.get(item.source);
          if(!image){this.renderableSprite(item.source,item.policy);this.__afPrimeQueue.push(item);continue;}
          if(!image.complete||!image.naturalWidth){if((item.tries=(item.tries||0)+1)<=60)this.__afPrimeQueue.push(item);else prime.failed++;continue;}
          this.processPoseMeasured(item.source,item.policy,true);prime.processed++;if(running)prime.processedWhileRunning++;
        }
        if(this.__afPrimeQueue.length)this.scheduleIdle(step,running?{timeout:1000,fallbackDelay:200}:{timeout:60,fallbackDelay:16});
      };
      this.scheduleIdle(step,{timeout:60,fallbackDelay:16});
    }catch{}
    return result;
  };
  const coreRenderableSpriteDrawBudget=CommonCombatRunner.prototype.renderableSprite;
  CommonCombatRunner.prototype.renderableSprite=function(source,policy,fromPreprocessQueue=false){
    const budget=this.__afDrawPoseBudget;
    if(budget&&!fromPreprocessQueue&&source&&!policy?.chromaKey&&!(Number(policy?.runtimeRasterScale||0)>0)&&!this.chromaSprites?.has(source)){
      const image=this.images.get(source);
      if(image?.tagName==="IMG"&&image.complete&&image.naturalWidth&&!image.__afDirectRenderable){
        if(budget.left<=0&&budget.player?.__afLastRenderableSource){this.qa.poseProcessDeferred=(this.qa.poseProcessDeferred||0)+1;return null;}
        budget.left--;this.qa.poseProcessedInDraw=(this.qa.poseProcessedInDraw||0)+1;return this.processPoseMeasured(source,policy,fromPreprocessQueue);
      }
    }
    return coreRenderableSpriteDrawBudget.call(this,source,policy,fromPreprocessQueue);
  };
  CommonCombatRunner.prototype.processPoseMeasured=function(source,policy,fromPreprocessQueue){
    const started=performance.now(),result=coreRenderableSpriteDrawBudget.call(this,source,policy,fromPreprocessQueue),cost=performance.now()-started;
    if(this.chromaSprites?.has(source)){this.__afPoseCostMs=this.__afPoseCostMs?this.__afPoseCostMs*.7+cost*.3:cost;this.qa.poseProcessCostMs=+this.__afPoseCostMs.toFixed(2);}
    return result;
  };
  const coreDrawPoseBudget=CommonCombatRunner.prototype.draw;
  CommonCombatRunner.prototype.draw=function(...args){this.__afDrawPoseBudget={left:1,player:null};try{return coreDrawPoseBudget.apply(this,args)}finally{this.__afDrawPoseBudget=null}};
  const coreDrawPlayerPoseBudget=CommonCombatRunner.prototype.drawPlayerSprite;
  CommonCombatRunner.prototype.drawPlayerSprite=function(ctx,player){const budget=this.__afDrawPoseBudget,previous=budget?.player??null;if(budget)budget.player=player;try{return coreDrawPlayerPoseBudget.call(this,ctx,player)}finally{if(budget)budget.player=previous}};
  // PERF FIX 2026-09-23 (Android/iOS): on touch devices that cannot hold the HIGH 60 fps target, an uneven
  // 35-50 fps stream reads as stutter. Judge running play in rolling 3 s windows (the first 2 s after a start,
  // resume or tab return are skipped as warm-up): display-callback p75 > 22 ms, >= 12 % of callbacks over 34 ms,
  // or median presented cost > 12 ms marks a window slow; two consecutive slow windows fall back once to the
  // existing MID profile (steady 30 fps) and remember it for later battles in this app session (sessionStorage).
  // Windows keep being judged, so later thermal throttling is caught too.
  // Desktop (fine pointer) pacing is unchanged.
  const coreAdaptiveFrame=CommonCombatRunner.prototype.frame;
  CommonCombatRunner.prototype.frame=function(now){
    const platform=window.AfterSignalPlatform,coarse=this.__afCoarse??(this.__afCoarse=(()=>{try{return matchMedia("(pointer: coarse)").matches}catch{return false}})());
    if(!this.__afAdaptiveInit){this.__afAdaptiveInit=true;try{if(coarse&&sessionStorage.getItem("aftersignal:auto-profile:v1")==="MID"&&platform?.performance?.get?.()==="HIGH"){platform.performance.set("MID");this.qa.adaptiveProfile={action:"SESSION_MID"};}}catch{}}
    const watch=coarse&&!this.__afAdaptiveDone&&platform?.performance?.get?.()==="HIGH";
    if(!watch)return coreAdaptiveFrame.call(this,now);
    const started=performance.now(),result=coreAdaptiveFrame.call(this,now),cost=performance.now()-started;
    try{
      const active=this.running&&!this.completed&&!this.terminalPaused&&!document.hidden;
      let w=this.__afAdaptive;
      if(!active||!w||now-w.last>500){this.__afAdaptive=active?{t0:now,last:now,windowStart:now+2000,costs:[],gaps:[],slow:w?.slow||0,windows:w?.windows||0}:null;return result;}
      const gap=now-w.last;w.last=now;
      if(now<w.windowStart)return result;
      if(gap>0)w.gaps.push(gap);if(cost>.5)w.costs.push(cost);
      if(now-w.windowStart>=3000&&w.gaps.length>=30){
        const sorted=w.gaps.slice().sort((p,q)=>p-q),costs=w.costs.slice().sort((p,q)=>p-q);
        const gapP75=sorted[Math.floor(sorted.length*.75)],longShare=sorted.filter(g=>g>34).length/sorted.length,medianCost=costs.length?costs[Math.floor(costs.length*.5)]:0;
        const slowWindow=gapP75>22||longShare>=.12||medianCost>12;w.slow=slowWindow?w.slow+1:0;w.windows++;
        const downgrade=w.slow>=2;
        this.qa.adaptiveProfile={windows:w.windows,callbackIntervalP75Ms:+gapP75.toFixed(1),longCallbackShare:+longShare.toFixed(3),medianPresentCostMs:+medianCost.toFixed(1),consecutiveSlowWindows:w.slow,action:downgrade?"HIGH_TO_MID":"KEEP_HIGH"};
        if(downgrade){this.__afAdaptiveDone=true;this.__afAdaptive=null;try{platform.performance.set("MID")}catch{}try{sessionStorage.setItem("aftersignal:auto-profile:v1","MID")}catch{}}
        else{w.windowStart=now;w.gaps=[];w.costs=[];}
      }
    }catch{}
    return result;
  };
  // ===== EPIC VFX V1 (2026-09-23, Claude Code) =====
  // Character ultimates get a themed charge -> launch -> impact -> aftermath layer that is synced to the
  // existing ultimate sequence (damage timing, bounded cut-in card, hit-stop and the 4.5 px camera cap are
  // unchanged; dense field geometry stays above the player formation line). Boss skills get a charging core
  // with the REAL target marked, a launch blast, phase-shift shockwaves and defeat explosions; heavy shots
  // and incoming hits get small spark bursts. Glows are cached radial sprites drawn additively (no canvas
  // shadowBlur); particle budgets scale with the LOW/MID/HIGH profile and touch devices.
  // ?vfx=classic restores the previous presentation.
  const epicEnabled=(()=>{const off=value=>/(?:[?&])vfx=classic(?:&|$)/.test(String(value||""));try{if(off(location.search))return false;}catch{}try{if(off(window.top.location.search))return false;}catch{}return true;})();
  const EPIC_THEMES=Object.freeze({
    mira:{motif:"horizon",core:"#ffffff",a:"#77f5ff",b:"#488cff",c:"#d9fbff"},
    haneul:{motif:"lattice",core:"#ffffff",a:"#62ffd2",b:"#33b9a5",c:"#ecfff8"},
    naru:{motif:"lattice",core:"#ffffff",a:"#9ffcff",b:"#2fd3cb",c:"#f7f2dc"},
    sera:{motif:"supernova",core:"#fff8ef",a:"#ffbd5c",b:"#ff4d9a",c:"#fff5db"},
    astra:{motif:"starcompass",core:"#f4f8ff",a:"#4d7dff",b:"#1b2f9e",c:"#cfdcff"},
    iona:{motif:"verdict",core:"#fff4f2",a:"#ff3b35",b:"#ff8a55",c:"#ffd0c8"},
    tessa:{motif:"aegis",core:"#ffffff",a:"#ff45b5",b:"#41e8e0",c:"#d9c6ff"},
    karin:{motif:"artillery",core:"#fff4e0",a:"#ff3a4a",b:"#ff9a3c",c:"#e8c07a"},
    luna:{motif:"hexwall",core:"#f2ffff",a:"#3fe6e0",b:"#1f8fff",c:"#e6d3a6"},
    serin:{motif:"seal",core:"#fbf6ff",a:"#b77dff",b:"#6a3dd6",c:"#f0d8ff"},
    arin:{motif:"cardstorm",core:"#fff6e6",a:"#e0a94a",b:"#b8243a",c:"#f3e6c8"},
    jaein:{motif:"swarm",core:"#eafff4",a:"#2fe08a",b:"#0e3b33",c:"#f0d9a8"},
    roa:{motif:"coilrail",core:"#f2ffff",a:"#3fe6e0",b:"#ff7a1a",c:"#ffb45a"},
    noella:{motif:"crossseal",core:"#fffaf0",a:"#f2c14e",b:"#8a6a2a",c:"#fff1c9"},
    ria:{motif:"vanguardlance",core:"#f4fbff",a:"#5fd4ff",b:"#1f6fd6",c:"#ffd27a"},
    bomin:{motif:"amberline",core:"#fff6e0",a:"#ffb13b",b:"#2a3a6e",c:"#ff7a1a"},
    yunseo:{motif:"crossverify",core:"#f4f7ff",a:"#3d6bff",b:"#1b2a7a",c:"#ffb347"},
    orin:{motif:"executionseal",core:"#fff4e2",a:"#d0304f",b:"#5a1020",c:"#e3b457"},
    yura:{motif:"contoursurvey",core:"#f6efd9",a:"#8fbf4a",b:"#2e4a1c",c:"#e0873a"},
    narae:{motif:"lastround",core:"#fff3d6",a:"#ffc21a",b:"#3a2a08",c:"#d9703a"},
    yeonhwa:{motif:"returnline",core:"#fff6e2",a:"#e8b64c",b:"#3a1a34",c:"#8a3f7a"}
  });
  // CHAR_VFX_REGISTRY_V1 (tools/char_pipeline/vfx_lib.py): per-character themes and shot drawers registered by the character blocks before coreDisposeEpic.
  const CHAR_VFX_THEMES={},CHAR_VFX_SHOTS={};
  const epicThemeFor=spec=>{const known=EPIC_THEMES[spec?.id]||CHAR_VFX_THEMES[spec?.id];if(known)return known;const palette=spec?.palette||["#77f5ff","#ffffff","#488cff"],motifType=F.ULTIMATE_REGISTRY?.get?.(spec?.ultimateId)?.motifType;return{motif:motifType==="TRIANGULAR_LATTICE"?"lattice":motifType==="HORIZON_ARC"?"aegis":"vector",core:"#ffffff",a:palette[0],b:palette[2]||palette[0],c:palette[1]||"#ffffff"};};
  const epicClamp=value=>Math.max(0,Math.min(1,value));
  const epicSmooth=value=>{const x=epicClamp(value);return x*x*(3-2*x);};
  const epicOut=value=>{const x=epicClamp(value);return 1-Math.pow(1-x,3);};
  const epicIn=value=>{const x=epicClamp(value);return x*x;};
  const epicHash=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
  const epicRgba=(hex,alpha)=>{const h=String(hex||"#ffffff").replace("#",""),full=h.length===3?h.split("").map(c=>c+c).join(""):h.slice(0,6),n=parseInt(full,16)||0;return`rgba(${n>>16&255},${n>>8&255},${n&255},${alpha})`;};
  const epicSprites=new Map();
  const epicGlow=(color,hot=true)=>{const key=`${color}|${hot?1:0}`;let sprite=epicSprites.get(key);if(sprite)return sprite;sprite=document.createElement("canvas");sprite.width=sprite.height=128;const g=sprite.getContext("2d"),grad=g.createRadialGradient(64,64,0,64,64,64);if(hot){grad.addColorStop(0,"rgba(255,255,255,1)");grad.addColorStop(.14,epicRgba(color,.96));}else grad.addColorStop(0,epicRgba(color,.85));grad.addColorStop(.42,epicRgba(color,.3));grad.addColorStop(1,epicRgba(color,0));g.fillStyle=grad;g.fillRect(0,0,128,128);epicSprites.set(key,sprite);return sprite;};
  const epicGlowAt=(ctx,x,y,r,color,alpha=1,hot=true)=>{if(!(alpha>.004)||!(r>.5))return;ctx.globalAlpha=Math.min(1,alpha);ctx.drawImage(epicGlow(color,hot),x-r,y-r,r*2,r*2);};
  const epicGlowRect=(ctx,x,y,w,h,color,alpha=1,hot=true)=>{if(!(alpha>.004)||!(w>.5)||!(h>.5))return;ctx.globalAlpha=Math.min(1,alpha);ctx.drawImage(epicGlow(color,hot),x,y,w,h);};
  const epicGlowLine=(ctx,x1,y1,x2,y2,thick,color,alpha=1,hot=true)=>{const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy);if(!(alpha>.004)||len<1)return;ctx.save();ctx.translate(x1,y1);ctx.rotate(Math.atan2(dy,dx));epicGlowRect(ctx,-thick*.6,-thick,len+thick*1.2,thick*2,color,alpha,hot);ctx.restore();};
  const epicRing=(ctx,x,y,rx,ry,width,color,alpha,rotation=0,start=0,end=Math.PI*2)=>{if(!(alpha>.004)||!(rx>.5))return;ctx.globalAlpha=Math.min(1,alpha);ctx.strokeStyle=color;ctx.lineWidth=Math.max(.6,width);ctx.beginPath();ctx.ellipse(x,y,rx,Math.max(.5,ry),rotation,start,end);ctx.stroke();};
  const epicStroke=(ctx,points,width,color,alpha)=>{if(!(alpha>.004)||points.length<2)return;ctx.globalAlpha=Math.min(1,alpha);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap="round";ctx.lineJoin="round";ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);for(let i=1;i<points.length;i++)ctx.lineTo(points[i][0],points[i][1]);ctx.stroke();};
  const epicBeam=(ctx,x1,y1,x2,y2,width,theme,alpha)=>{epicStroke(ctx,[[x1,y1],[x2,y2]],width*2.4,theme.b,.22*alpha);epicStroke(ctx,[[x1,y1],[x2,y2]],width,theme.a,.62*alpha);epicStroke(ctx,[[x1,y1],[x2,y2]],Math.max(1.5,width*.28),theme.core,.95*alpha);};
  const epicRays=(ctx,x,y,count,inner,outer,spread,color,alpha,spin,seed)=>{if(!(alpha>.004))return;ctx.globalAlpha=Math.min(1,alpha);ctx.fillStyle=color;ctx.beginPath();for(let i=0;i<count;i++){const angle=spin+i*Math.PI*2/count+(epicHash(seed+i)-.5)*.32,len=outer*(.5+.5*epicHash(seed+i*7.3)),w=spread*(.55+.9*epicHash(seed+i*3.1));ctx.moveTo(x+Math.cos(angle-w)*inner,y+Math.sin(angle-w)*inner);ctx.lineTo(x+Math.cos(angle)*len,y+Math.sin(angle)*len);ctx.lineTo(x+Math.cos(angle+w)*inner,y+Math.sin(angle+w)*inner);}ctx.fill();};
  const epicPoly=(ctx,x,y,radius,sides,rotation,width,color,alpha,fillAlpha=0)=>{if(!(alpha>.004)||!(radius>.5))return;ctx.beginPath();for(let i=0;i<=sides;i++){const angle=rotation+i*Math.PI*2/sides,px=x+Math.cos(angle)*radius,py=y+Math.sin(angle)*radius;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}if(fillAlpha>0){ctx.globalAlpha=Math.min(1,fillAlpha);ctx.fillStyle=color;ctx.fill();}ctx.globalAlpha=Math.min(1,alpha);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();};
  const epicCoarse=(()=>{try{return matchMedia("(pointer: coarse)").matches}catch{return false}})();
  const epicBudget=()=>{const profile=window.AfterSignalPlatform?.performance?.get?.()||"HIGH";return(profile==="LOW"?.4:profile==="MID"?.65:1)*(epicCoarse?.75:1);};
  const enemyEpicPalette=kind=>({warning_pulse:["#fff1fb","#ff63ba","#842bff"],core_line:["#ffffff","#ffd974","#ff3b62"],signal_erase_wave:["#ffffff","#ff4ba0","#5b20ff"],command_needle:["#f5ffff","#5ff4ff","#b44cff"],relay_reflection_fan:["#fff5df","#ff8e60","#ff476f"],trust_blockade:["#fff4ce","#ffad4d","#ff365e"]}[kind]||["#fff7ec","#ff667c","#7f48ff"]);
  const epicSpawn=(state,x,y,count,{speed=[260,900],angle=0,spread=Math.PI*2,life=[.45,1],size=[1.5,3.2],colors=["#ffffff"],kind="spark",grav=900,drag=.9,lift=0}={})=>{
    const n=Math.max(0,Math.round(count*epicBudget()));
    for(let i=0;i<n&&state.parts.length<520;i++){const r=Math.random,a=angle+(r()-.5)*spread,v=speed[0]+(speed[1]-speed[0])*r();state.parts.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-lift,age:0,life:life[0]+(life[1]-life[0])*r(),size:size[0]+(size[1]-size[0])*r(),color:colors[Math.floor(r()*colors.length)],kind,grav,drag,rot:r()*6.28,vr:(r()-.5)*14,seed:r()*100});}
  };
  CommonCombatRunner.prototype.epicState=function(){return this.__afEpic||(this.__afEpic={effects:[],parts:[],last:performance.now(),seen:new WeakSet(),snapshot:[]});};
  CommonCombatRunner.prototype.epicSafeY=function(){const players=this.players.filter(Boolean);return Math.max(this.height*.48,Math.min(...players.map(player=>player.y-playerBodyPx(player)*1.12),this.height*.72));};
  CommonCombatRunner.prototype.epicUltimateTarget=function(owner){
    const live=this.enemies.filter(enemy=>enemy.alive!==false),boss=live.find(enemy=>enemy.bossRuntime),pick=boss||live.slice().sort((a,b)=>Math.abs(a.x-this.width/2)-Math.abs(b.x-this.width/2))[0];
    if(!pick)return{x:this.width/2,y:this.height*.36,enemy:null};const point=this.enemyAimPoint?.(pick)||{x:pick.x,y:pick.y-60};return{x:point.x,y:point.y,enemy:pick};
  };
  CommonCombatRunner.prototype.spawnEpicUltimate=function(){
    const sequence=this.ultimateSequence,owner=sequence?.owner;if(!owner)return;const state=this.epicState(),profile=ultimateVfxProfile(owner.spec.id),impactAt=.64+profile.charge+profile.bloom,target=this.epicUltimateTarget(owner);
    state.effects=state.effects.filter(effect=>effect.type!=="ultimate"||effect.age>effect.impactAt+.4);
    state.effects.push({type:"ultimate",owner,sequence,theme:epicThemeFor(owner.spec),age:0,impactAt,life:impactAt+2.1,tx:target.x,ty:target.y,targetEnemy:target.enemy,points:[],seed:Math.random()*1000,spawned:{}});
    const cutin=document.querySelector("#cutin,#ultimateCutin,.ultimate-cutin"),theme=epicThemeFor(owner.spec);
    if(cutin){cutin.classList.remove("af-epic");void cutin.offsetWidth;cutin.style.setProperty("--af-epic-a",theme.a);cutin.style.setProperty("--af-epic-b",theme.b);cutin.style.setProperty("--af-epic-glow",epicRgba(theme.a,.42));cutin.style.setProperty("--af-epic-line",epicRgba(theme.c,.22));cutin.classList.add("af-epic");}
  };
  const coreTraceEpic=CommonCombatRunner.prototype.trace;
  CommonCombatRunner.prototype.trace=function(type,data={}){
    const result=coreTraceEpic.call(this,type,data);
    if(!epicEnabled||this.disposed)return result;
    try{
      const state=this.epicState();
      if(type==="ultimate_used")this.spawnEpicUltimate();
      else if(type==="boss_skill_telegraph"||type==="enemy_attack_telegraph"){const enemy=this.enemies.find(candidate=>candidate.activeAttackId===data.attackId);if(enemy){const alive=this.players.filter(player=>player&&player.member.hp>0&&player.member.targetable!==false),target=alive.length?alive[Math.max(0,(enemy.attackSequence||1)-1)%alive.length]:null;state.effects.push({type:"charge",boss:Boolean(enemy.bossRuntime),enemy,target,kind:data.kind||enemy.telegraphKind,age:0,life:Math.max(.2,enemy.telegraphTotal||.4)+.05,seed:Math.random()*100});}}
      else if(type==="attackCommit"){const enemy=this.enemies.find(candidate=>candidate.spec.id===data.enemyId&&candidate.bossRuntime);if(enemy){const point=this.enemyAimPoint?.(enemy)||{x:enemy.x,y:enemy.y-80},palette=enemyEpicPalette(data.kind);state.effects.push({type:"blast",x:point.x,y:point.y,palette,age:0,life:.5});epicSpawn(state,point.x,point.y,26,{speed:[220,760],life:[.3,.7],colors:palette,grav:520});}}
      else if(type==="boss_phase"){const boss=this.enemies.find(enemy=>enemy.bossRuntime&&enemy.spec.id===data.bossId);if(boss){const point=this.enemyAimPoint?.(boss)||{x:boss.x,y:boss.y-100},arrival=!data.index;state.effects.push({type:"phase",x:point.x,y:point.y,arrival,age:0,life:arrival?1.1:1.5,seed:Math.random()*100});if(!arrival)epicSpawn(state,point.x,point.y,90,{speed:[300,1100],life:[.5,1.2],colors:["#ffffff","#ff63ba","#ffd974","#8d51ff"],grav:700});}}
      else if(type==="enemy_defeated"){const gone=state.snapshot.find(entry=>entry.id===data.enemyId&&!this.enemies.includes(entry.enemy));if(gone){gone.enemy=null;const boss=gone.boss;state.effects.push({type:"defeat",x:gone.x,y:gone.y,boss,age:0,life:boss?2.2:.7,seed:Math.random()*100});epicSpawn(state,gone.x,gone.y,boss?150:22,{speed:boss?[320,1300]:[200,640],life:boss?[.6,1.5]:[.3,.7],colors:boss?["#ffffff","#ffd974","#ff63ba","#8d51ff"]:["#ffffff","#ffb36b","#ff5f8a"],grav:boss?620:820});if(boss)epicSpawn(state,gone.x,gone.y,40,{kind:"ember",speed:[60,260],life:[1,2],size:[4,9],colors:["#ffd974","#ff63ba"],grav:-60,drag:.95});}}
    }catch{}
    return result;
  };
  const coreDrawUltimateEpic=CommonCombatRunner.prototype.drawUltimateFx;
  CommonCombatRunner.prototype.drawUltimateFx=function(ctx,effect){
    // Characters without an authored raster ultimate previously fell back to one shared magenta lance;
    // the epic layer now draws their own signature, so only the raster characters keep the core layer.
    if(epicEnabled&&effect?.owner&&!(this.isRasterUltimateVfxEnabled()&&ULTIMATE_VFX_ASSETS[effect.owner.spec.id]))return;
    return coreDrawUltimateEpic.call(this,ctx,effect);
  };
  CommonCombatRunner.prototype.drawEpicVfx=function(ctx){
    if(!epicEnabled)return;const state=this.epicState(),now=performance.now(),dt=Math.min(.05,Math.max(0,(now-state.last)/1000));state.last=now;
    // positions of the living enemies for defeat explosions (they leave the list before the trace fires)
    state.snapshot=this.enemies.filter(enemy=>enemy.alive!==false).map(enemy=>{const point=this.enemyAimPoint?.(enemy)||(enemy.bossRuntime?{x:enemy.x,y:enemy.y-90}:{x:enemy.x,y:enemy.y-54});return{enemy,id:enemy.spec.id,boss:Boolean(enemy.bossRuntime),x:point.x,y:point.y};});
    for(const impact of this.impacts||[]){if(state.seen.has(impact))continue;state.seen.add(impact);const variant=impact.spec?.impactVariant,palette=impact.spec?.palette||["#ffffff","#9ff","#48f"];if(impact.blocked)continue;if(variant==="heavy"){state.effects.push({type:"hit",x:impact.x,y:impact.y,palette,age:0,life:.42});epicSpawn(state,impact.x,impact.y,16,{speed:[240,720],life:[.22,.5],colors:palette,grav:700});}else if(variant!=="ultimate"&&Math.random()<.5)epicSpawn(state,impact.x,impact.y,4,{speed:[160,480],life:[.16,.34],colors:palette,grav:600});}
    for(const hit of this.incomingImpacts||[]){if(state.seen.has(hit))continue;state.seen.add(hit);const palette=enemyEpicPalette(hit.kind);state.effects.push({type:"incoming",x:hit.x,y:hit.y,palette,age:0,life:.4});epicSpawn(state,hit.x,hit.y,12,{speed:[200,620],life:[.2,.45],colors:palette,grav:760});}
    ctx.save();
    for(const effect of state.effects){
      if(effect.type==="ultimate"){const sequence=this.ultimateSequence;effect.age=sequence&&sequence===effect.sequence?Math.max(effect.age,sequence.age):effect.age+dt;}else effect.age+=dt;
    }
    state.effects=state.effects.filter(effect=>effect.age<effect.life);
    // Dark smoke first (normal blending), then every additive layer.
    ctx.globalCompositeOperation="source-over";
    for(const effect of state.effects)if(effect.type==="ultimate")this.drawEpicUltimateBase(ctx,effect);
    for(const part of state.parts)if(part.kind==="smoke"){const t=part.age/part.life;epicGlowAt(ctx,part.x,part.y,part.size*(1+1.6*t),"#120a14",.42*(1-t),false);}
    ctx.globalCompositeOperation="lighter";
    for(const effect of state.effects){
      if(effect.type==="ultimate")this.drawEpicUltimate(ctx,effect,dt);
      else if(effect.type==="charge")this.drawEpicCharge(ctx,effect);
      else{const t=effect.age/effect.life,p=1-t;
        if(effect.type==="blast"){epicGlowAt(ctx,effect.x,effect.y,40+110*epicOut(t),effect.palette[1],.9*p);epicRing(ctx,effect.x,effect.y,20+120*epicOut(t),20+120*epicOut(t),5*p+1,effect.palette[0],.8*p);}
        else if(effect.type==="hit"){epicGlowAt(ctx,effect.x,effect.y,24+60*epicOut(t),effect.palette[0],.75*p);epicRing(ctx,effect.x,effect.y,10+56*epicOut(t),(10+56*epicOut(t))*.8,3*p+.8,effect.palette[1],.85*p);}
        else if(effect.type==="incoming"){epicGlowAt(ctx,effect.x,effect.y,30+50*epicOut(t),effect.palette[1],.7*p);epicRing(ctx,effect.x,effect.y+40,24+70*epicOut(t),8+20*epicOut(t),3*p+.8,effect.palette[1],.7*p);}
        else if(effect.type==="phase"){const k=epicOut(t);if(effect.arrival){for(let ring=0;ring<3;ring++){const r=240*(1-epicOut(epicClamp(t*1.4-ring*.12)))+30;epicRing(ctx,effect.x,effect.y,r,r,3,ring%2?"#8d51ff":"#ff63ba",.8*p);}epicGlowAt(ctx,effect.x,effect.y,120*k,"#8d51ff",.7*p);}else{epicGlowAt(ctx,effect.x,effect.y,120+380*k,"#ff63ba",.85*Math.pow(p,1.4));epicGlowAt(ctx,effect.x,effect.y,60+120*k,"#ffffff",Math.pow(p,2));for(let ring=0;ring<3;ring++){const q=epicClamp(t*1.25-ring*.1),r=40+(520+ring*80)*epicOut(q),width=(9-ring*2.5)*(1-q)+1,color=["#ff9bd8","#ffd974","#8d51ff"][ring];epicRing(ctx,effect.x,effect.y,r,r*.42,width*4.5,color,.16*(1-q));epicRing(ctx,effect.x,effect.y,r,r*.42,width,ring?color:"#ffffff",.9*(1-q));}epicRays(ctx,effect.x,effect.y,18,26,300+260*k,.05,"#ffe6f4",.5*p,t*.6,effect.seed);}}
        else if(effect.type==="defeat"){if(effect.boss){for(let blast=0;blast<5;blast++){const d=blast*.16,q=epicClamp((effect.age-d)/.7);if(q<=0||q>=1)continue;const bx=effect.x+(blast?(epicHash(effect.seed+blast)-.5)*220:0),by=effect.y+(blast?(epicHash(effect.seed+blast*3)-.5)*140:0);epicGlowAt(ctx,bx,by,90+260*epicOut(q),blast%2?"#ff63ba":"#ffd974",(1-q)*.95);epicGlowAt(ctx,bx,by,40+90*epicOut(q),"#ffffff",Math.pow(1-q,2));const rr=40+400*epicOut(q);epicRing(ctx,bx,by+20,rr,rr*.36,26*(1-q)+3,blast%2?"#ff63ba":"#ffd974",.16*(1-q));epicRing(ctx,bx,by+20,rr,rr*.36,5*(1-q)+1,"#ffffff",.85*(1-q));}const fl=Math.exp(-effect.age/.14);if(fl>.02){ctx.globalAlpha=.45*fl;ctx.fillStyle="#ffe6f0";ctx.fillRect(-40,-40,this.width+80,this.epicSafeY()+40);}epicRays(ctx,effect.x,effect.y,22,30,620*epicOut(t*1.4),.045,"#fff0f6",.55*p,t*.4,effect.seed);}else{epicGlowAt(ctx,effect.x,effect.y,30+90*epicOut(t),"#ffb36b",.9*p);epicGlowAt(ctx,effect.x,effect.y,14+30*epicOut(t),"#ffffff",p*p);epicRing(ctx,effect.x,effect.y+14,16+90*epicOut(t),(16+90*epicOut(t))*.38,4*p+.8,"#ffd6b0",.8*p);}}
      }
    }
    this.drawEpicParticles(ctx,dt);
    ctx.restore();
  };
  CommonCombatRunner.prototype.drawEpicParticles=function(ctx,dt){
    const state=this.epicState(),parts=state.parts,buckets=new Map();
    for(const part of parts){part.age+=dt;const damp=Math.pow(part.drag,dt*60);part.vx*=damp;part.vy=part.vy*damp+part.grav*dt;part.x+=part.vx*dt;part.y+=part.vy*dt;part.rot+=part.vr*dt;}
    state.parts=parts.filter(part=>part.age<part.life);
    for(const part of state.parts){const t=part.age/part.life,alpha=1-t;
      if(part.kind==="spark"){const key=`${part.color}|${alpha>.66?3:alpha>.33?2:1}|${part.size>2.4?1:0}`;let list=buckets.get(key);if(!list)buckets.set(key,list=[]);list.push(part);}
      else if(part.kind==="ember")epicGlowAt(ctx,part.x,part.y,part.size*(1-.4*t),part.color,alpha*(.55+.45*Math.sin(part.age*18+part.seed)));
      else if(part.kind==="debris"){ctx.save();ctx.translate(part.x,part.y);ctx.rotate(part.rot);ctx.globalAlpha=Math.min(1,alpha*1.2);ctx.fillStyle=part.color;ctx.fillRect(-part.size,-part.size*.45,part.size*2,part.size*.9);ctx.restore();}
    }
    for(const [key,list] of buckets){const [color,level,thick]=key.split("|");ctx.globalAlpha=Number(level)/3;ctx.strokeStyle=color;ctx.lineWidth=thick==="1"?3:1.6;ctx.lineCap="round";ctx.beginPath();for(const part of list){ctx.moveTo(part.x,part.y);ctx.lineTo(part.x-part.vx*.03,part.y-part.vy*.03);}ctx.stroke();}
  };
  CommonCombatRunner.prototype.drawEpicCharge=function(ctx,effect){
    const enemy=effect.enemy;if(!enemy||enemy.alive===false||!this.enemies.includes(enemy))return;const point=this.enemyAimPoint?.(enemy)||{x:enemy.x,y:enemy.y-80},palette=enemyEpicPalette(effect.kind),k=epicSmooth(effect.age/Math.max(.05,effect.life-.05)),x=point.x,y=effect.boss?point.y:point.y-10;
    if(!effect.boss){epicGlowAt(ctx,x,y,14+26*k,palette[1],.55*k);return;}
    const n=Math.round(14*epicBudget());ctx.globalAlpha=.75*k;ctx.strokeStyle=palette[0];ctx.lineWidth=1.8;ctx.beginPath();for(let i=0;i<n;i++){const ph=(effect.age*1.9+i/n)%1,angle=i*2.399+effect.seed,r=170*Math.pow(1-ph,1.5)+10,len=26*(1-ph)+4;ctx.moveTo(x+Math.cos(angle)*r,y+Math.sin(angle)*r);ctx.lineTo(x+Math.cos(angle)*(r+len),y+Math.sin(angle)*(r+len));}ctx.stroke();
    epicGlowAt(ctx,x,y,26+70*k+8*Math.sin(effect.age*34),palette[1],.9*k);epicGlowAt(ctx,x,y,10+22*k,"#ffffff",k);
    epicPoly(ctx,x,y,46+30*(1-k),6,effect.age*2.4,2,palette[2],.8*k);epicPoly(ctx,x,y,62+30*(1-k),6,-effect.age*1.6,1.4,palette[1],.55*k);
    const target=effect.target;if(target&&target.member?.hp>0){const tx=target.x,ty=target.y-playerBodyPx(target)*.6,pulse=.6+.4*Math.sin(effect.age*26);
      ctx.save();ctx.globalAlpha=.24*k;ctx.strokeStyle=palette[2];ctx.lineWidth=30;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(tx,ty);ctx.stroke();ctx.restore();
      const dx=tx-x,dy=ty-y,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len;ctx.globalAlpha=.85*k;ctx.strokeStyle=palette[1];ctx.lineWidth=2.6;ctx.beginPath();for(let c=0;c<7;c++){const d=((effect.age*2.2+c/7)%1)*len,cx=x+ux*d,cy=y+uy*d;ctx.moveTo(cx-uy*12-ux*9,cy+ux*12-uy*9);ctx.lineTo(cx,cy);ctx.lineTo(cx+uy*12-ux*9,cy-ux*12-uy*9);}ctx.stroke();
      epicRing(ctx,tx,ty,44-14*k,44-14*k,2.5,palette[1],.85*k*pulse);epicRing(ctx,tx,target.y+2,52,12,2,palette[1],.6*k*pulse);epicGlowAt(ctx,tx,ty,40,palette[2],.35*k*pulse,false);}
  };
  CommonCombatRunner.prototype.drawEpicUltimateBase=function(ctx,e){
    // field dim (normal blending) during the build-up; the living formation below the safe line stays lit
    const a=e.age,since=a-e.impactAt,dim=.4*epicSmooth(a/.5)*(since<0?1:epicClamp(1-since/.9));if(dim<=.01)return;const safeY=this.epicSafeY();
    ctx.globalAlpha=dim;ctx.fillStyle="#02030b";ctx.fillRect(-40,-40,this.width+80,safeY+40);const fade=ctx.createLinearGradient(0,safeY,0,safeY+60);fade.addColorStop(0,"rgba(2,3,11,1)");fade.addColorStop(1,"rgba(2,3,11,0)");ctx.fillStyle=fade;ctx.fillRect(-40,safeY,this.width+80,60);
    if(e.theme.motif==="artillery"&&since>.05)for(let puff=0;puff<5;puff++){const q=epicClamp((since-.05-puff*.07)/1.6);if(q<=0||q>=1)continue;epicGlowAt(ctx,e.tx+(epicHash(e.seed+puff)-.5)*200,e.ty-60*q+(epicHash(e.seed+puff*5)-.5)*60,70+170*epicOut(q),"#1a0c08",.55*(1-q),false);}
  };
  CommonCombatRunner.prototype.drawEpicUltimate=function(ctx,e,dt){
    const owner=e.owner,theme=e.theme,state=this.epicState(),a=e.age,tCut=.64,imp=e.impactAt,charge=epicSmooth(a/tCut),launch=epicClamp((a-tCut)/Math.max(.05,imp-tCut)),since=a-imp,W=this.width,safeY=this.epicSafeY(),topY=Math.min(safeY-160,combatUpperSafeY(this)+10);
    // live target until the hit, frozen afterwards
    if(since<0){const coreFx=this.ultimateFx.find(fx=>fx.owner===owner);if(coreFx&&!e.points.length){e.points=(coreFx.targetPoints||[]).slice(0,8);e.primaryId=coreFx.primaryTargetId;}const live=this.enemies.find(enemy=>enemy.alive!==false&&(e.primaryId?enemy.id===e.primaryId:enemy===e.targetEnemy));if(live){const point=this.enemyAimPoint?.(live);if(point){e.tx=point.x;e.ty=point.y;}}else if(coreFx&&Number.isFinite(coreFx.targetX)){e.tx=coreFx.targetX;e.ty=coreFx.targetY;}}
    const tx=e.tx,ty=e.ty,muzzle=owner.muzzle||{x:owner.x,y:owner.y-playerBodyPx(owner)*.75};if(since<0){e.sx=muzzle.x;e.sy=muzzle.y;}const sx=e.sx??muzzle.x,sy=e.sy??muzzle.y;
    // 1. caster charge: converging streaks, muzzle orb, sigils and a rising light column
    const k=charge*(since<0?1:epicClamp(1-since/.18));
    if(k>.01){epicGlowRect(ctx,sx-16,sy-280*k,32,280*k+24,theme.a,.5*k,false);epicStroke(ctx,[[sx,sy],[sx,sy-250*k]],2,theme.core,.55*k);
      const n=Math.round(18*epicBudget());ctx.globalAlpha=.85*k;ctx.strokeStyle=theme.c;ctx.lineWidth=1.8;ctx.beginPath();for(let i=0;i<n;i++){const ph=(a*1.7+i/n)%1,angle=i*2.399+e.seed,r=160*Math.pow(1-ph,1.6)+8,len=24*(1-ph)+4;ctx.moveTo(sx+Math.cos(angle)*r,sy+Math.sin(angle)*r*.85);ctx.lineTo(sx+Math.cos(angle)*(r+len),sy+Math.sin(angle)*(r+len)*.85);}ctx.stroke();
      epicGlowAt(ctx,sx,sy,22+56*k+7*Math.sin(a*31),theme.a,.95*k);epicGlowAt(ctx,sx,sy,10+20*k,"#ffffff",k);
      epicRing(ctx,sx,sy,30+24*k,(30+24*k)*.92,2,theme.a,.8*k,a*2.2,0,Math.PI*1.5);epicRing(ctx,sx,sy,44+30*k,(44+30*k)*.92,1.2,theme.c,.55*k,-a*1.6,0,Math.PI*1.2);
      {const g=playerBodyPx(owner)/95;epicRing(ctx,owner.x,owner.y-4,(62+22*k)*g,(14+5*k)*g,2,theme.a,.6*k,0);epicRing(ctx,owner.x,owner.y-4,(40+14*k)*g,(9+3*k)*g,1.2,theme.c,.5*k,0);}}
    // 2. target lock-on while the cut-in plays
    const lock=epicClamp((a-.18)/.46)*(since<0?1:0);
    if(lock>.01){const r=160-86*epicSmooth(lock);epicRing(ctx,tx,ty,r,r,2.6,theme.b,.85*lock);epicRing(ctx,tx,ty,r*.64,r*.64,1.4,theme.c,.7*lock,0,0,Math.PI*2);ctx.globalAlpha=.85*lock;ctx.strokeStyle=theme.a;ctx.lineWidth=2.4;ctx.beginPath();for(let i=0;i<12;i++){const angle=i*Math.PI/6-a*1.4;ctx.moveTo(tx+Math.cos(angle)*r*1.06,ty+Math.sin(angle)*r*1.06);ctx.lineTo(tx+Math.cos(angle)*r*1.2,ty+Math.sin(angle)*r*1.2);}for(const [qx,qy] of [[-1,-1],[1,-1],[1,1],[-1,1]]){const cx=tx+qx*r*.92,cy=ty+qy*r*.92;ctx.moveTo(cx,cy-qy*22);ctx.lineTo(cx,cy);ctx.lineTo(cx-qx*22,cy);}ctx.stroke();}
    // 3. field layers are clipped above the formation line
    ctx.save();ctx.beginPath();ctx.rect(-60,-60,W+120,safeY+90);ctx.clip();
    const motif=theme.motif,draw=this[`drawEpicMotif_${motif}`]||this.drawEpicMotif_vector;draw.call(this,ctx,e,{theme,a,tCut,imp,launch,since,sx,sy,tx,ty,W,safeY,topY,state});
    if(since>=0){
      const fl=Math.exp(-since/.1);if(fl>.02){const flash=ctx.createLinearGradient(0,0,0,safeY+40);flash.addColorStop(0,epicRgba(theme.c,.34*fl));flash.addColorStop(Math.max(.05,(safeY-140)/(safeY+40)),epicRgba(theme.c,.4*fl));flash.addColorStop(1,epicRgba(theme.c,0));ctx.globalAlpha=1;ctx.fillStyle=flash;ctx.fillRect(-60,-60,W+120,safeY+100);}
      epicGlowAt(ctx,tx,ty,170+330*epicOut(since/.42),theme.a,epicClamp(1-since/.6));epicGlowAt(ctx,tx,ty,60+90*epicOut(since/.3),"#ffffff",.9*epicClamp(1-since/.3));
      for(let j=0;j<3;j++){const q=epicClamp((since-[0,.07,.16][j])/.66);if(q<=0||q>=1)continue;const R=40+(560+j*70)*epicOut(q),width=(10-j*3)*(1-q)+1,color=[theme.a,theme.c,theme.b][j];epicRing(ctx,tx,ty+14,R,R*.34,width*4.5,color,.16*(1-q));epicRing(ctx,tx,ty+14,R,R*.34,width,j?color:theme.core,.9*(1-q));}
      const cq=epicClamp(since/.42);if(cq<1){const R=30+290*epicOut(cq);epicRing(ctx,tx,ty,R,R,24*(1-cq)+3,theme.a,.2*(1-cq));epicRing(ctx,tx,ty,R,R,5*(1-cq)+1,theme.core,.9*(1-cq));}
      const pq=epicClamp(since/.75);if(pq<1){const w=200*Math.pow(1-pq,.7)*epicClamp(since/.05);epicGlowRect(ctx,tx-w/2,topY-80,w,ty-topY+150,theme.a,.9*(1-pq),false);epicGlowRect(ctx,tx-w*.13,topY-80,w*.26,ty-topY+150,"#ffffff",1-pq,true);}
      const rq=epicClamp(since/.85);if(rq<1)epicRays(ctx,tx,ty,20,30,270+320*epicOut(rq),.05,theme.c,.55*(1-rq),since*.3,e.seed);
      e.points.forEach((point,index)=>{if(Math.abs(point.x-tx)<6&&Math.abs(point.y-ty)<6)return;const q=epicClamp((since-.05-index*.07)/.55);if(q<=0||q>=1)return;epicGlowAt(ctx,point.x,point.y,40+110*epicOut(q),theme.a,.9*(1-q));epicRing(ctx,point.x,point.y+8,20+120*epicOut(q),(20+120*epicOut(q))*.4,5*(1-q)+.8,theme.core,.8*(1-q));const key=`p${index}`;if(!e.spawned[key]){e.spawned[key]=true;epicSpawn(state,point.x,point.y,14,{speed:[200,640],life:[.25,.6],colors:[theme.core,theme.a,theme.c],grav:700});}});
      if(!e.spawned.impact){e.spawned.impact=true;epicSpawn(state,tx,ty,120,{speed:[320,1250],life:[.45,1.15],size:[1.4,3.6],colors:[theme.core,theme.a,theme.c,theme.b],grav:760,drag:.93});epicSpawn(state,tx,ty,26,{kind:"ember",speed:[60,300],life:[1,1.9],size:[4,10],colors:[theme.a,theme.c],grav:-70,drag:.95,lift:40});}
      if(since<.7&&Math.random()<dt*28*epicBudget())epicSpawn(state,tx+(Math.random()-.5)*160,ty+(Math.random()-.5)*50,1,{kind:"ember",speed:[20,90],spread:1,angle:-Math.PI/2,life:[1,1.8],size:[3,7],colors:[theme.a,theme.c],grav:-90,drag:.97});
    }
    ctx.restore();
  };
  // --- per-character signatures (launch + impact + aftermath) ---
  CommonCombatRunner.prototype.drawEpicMotif_vector=function(ctx,e,m){
    const {theme,launch,since,sx,sy,tx,ty}=m,head=epicIn(launch);
    if(launch>0&&since<.2){const hx=sx+(tx-sx)*head,hy=sy+(ty-sy)*head,fade=since<0?1:epicClamp(1-since/.2);epicBeam(ctx,sx,sy,hx,hy,20,theme,fade);epicGlowAt(ctx,hx,hy,46,theme.a,fade);epicGlowAt(ctx,hx,hy,16,"#ffffff",fade);}
    if(since>=0){const q=epicClamp(since/1.1),angle=-.72;epicGlowLine(ctx,tx-Math.cos(angle)*360,ty-Math.sin(angle)*360,tx+Math.cos(angle)*360,ty+Math.sin(angle)*360,28*(1-q)+4,theme.a,.9*(1-q));epicGlowLine(ctx,tx-Math.cos(angle)*300,ty-Math.sin(angle)*300,tx+Math.cos(angle)*300,ty+Math.sin(angle)*300,8*(1-q)+2,"#ffffff",1-q);
      ctx.globalAlpha=.75*(1-q);ctx.fillStyle=theme.b;ctx.beginPath();for(let petal=0;petal<10;petal++){const pa=petal*Math.PI/5+since*.8,reach=70+170*epicOut(since/.5),bend=petal%2?.22:-.22;ctx.moveTo(tx,ty);ctx.quadraticCurveTo(tx+Math.cos(pa+bend)*reach*.7,ty+Math.sin(pa+bend)*reach*.7,tx+Math.cos(pa)*reach,ty+Math.sin(pa)*reach);ctx.quadraticCurveTo(tx+Math.cos(pa-bend)*reach*.5,ty+Math.sin(pa-bend)*reach*.5,tx,ty);}ctx.fill();}
  };
  CommonCombatRunner.prototype.drawEpicMotif_supernova=function(ctx,e,m){
    const {theme,launch,since,sx,sy,tx,ty,a}=m;
    if(launch>0&&since<.2){const head=epicIn(launch),hx=sx+(tx-sx)*head,hy=sy+(ty-sy)*head,fade=since<0?1:epicClamp(1-since/.2);epicBeam(ctx,sx,sy,hx,hy,22,theme,fade);epicGlowAt(ctx,hx,hy,50,theme.a,fade);}
    if(since<0&&launch>0)for(let petal=0;petal<8;petal++){const pa=petal*Math.PI/4+a*2,r=190*(1-epicOut(launch))+20;epicGlowAt(ctx,tx+Math.cos(pa)*r,ty+Math.sin(pa)*r,18,theme.b,.8*launch);}
    if(since>=0){const q=epicClamp(since/1.2),flare=1-q;epicGlowRect(ctx,tx-480,ty-14*flare-3,960,28*flare+6,theme.a,.9*flare);epicGlowRect(ctx,tx-12*flare-3,ty-280,24*flare+6,560,theme.c,.8*flare);epicGlowRect(ctx,tx-260,ty-5,520,10,"#ffffff",flare);
      ctx.fillStyle=theme.b;ctx.globalAlpha=.7*flare;ctx.beginPath();for(let petal=0;petal<12;petal++){const pa=petal*Math.PI/6+since*.9,reach=60+190*epicOut(since/.45),bend=petal%2?.3:-.3;ctx.moveTo(tx,ty);ctx.quadraticCurveTo(tx+Math.cos(pa+bend)*reach*.75,ty+Math.sin(pa+bend)*reach*.75,tx+Math.cos(pa)*reach,ty+Math.sin(pa)*reach);ctx.quadraticCurveTo(tx+Math.cos(pa-bend)*reach*.45,ty+Math.sin(pa-bend)*reach*.45,tx,ty);}ctx.fill();
      epicRing(ctx,tx,ty,90+180*epicOut(q),90+180*epicOut(q),4*flare+1,theme.b,.8*flare,since*.5,0,Math.PI*1.6);}
  };
  CommonCombatRunner.prototype.drawEpicMotif_horizon=function(ctx,e,m){
    const {theme,launch,since,sx,sy,tx,ty,W,a}=m;
    if(launch>0&&since<.2){const head=epicIn(launch),hx=sx+(tx-sx)*head,hy=sy+(ty-sy)*head,fade=since<0?1:epicClamp(1-since/.2);epicBeam(ctx,sx,sy,hx,hy,18,theme,fade);epicGlowAt(ctx,hx,hy,44,theme.a,fade);}
    const form=since<0?launch:1;if(form>0){const fade=since<0?1:epicClamp(1-since/1.3);for(let panel=0;panel<6;panel++){const pa=panel*Math.PI/3+a*.5,r=(130-40*epicOut(form))+(since>0?260*epicOut(since/.8):0);epicPoly(ctx,tx+Math.cos(pa)*r,ty+Math.sin(pa)*r*.55,22+8*form,6,a+panel,1.8,theme.c,.85*form*fade,.12*form*fade);}}
    if(since>=0){const q=epicClamp(since/1.25),spread=epicOut(since/.2),h=74*Math.pow(1-q,.8)+4,left=tx-(tx+60)*spread,right=tx+(W+60-tx)*spread;epicGlowRect(ctx,left,ty-h/2,right-left,h,theme.a,.85*(1-q),false);epicStroke(ctx,[[left,ty],[right,ty]],3*(1-q)+.8,"#ffffff",1-q);
      for(let arc=0;arc<3;arc++){const r=150+arc*62+50*epicOut(q);epicRing(ctx,tx,ty-10,r,r*.42,3-arc*.6,arc===1?theme.b:theme.a,.8*(1-q),0,Math.PI,Math.PI*2);}}
  };
  CommonCombatRunner.prototype.drawEpicMotif_lattice=function(ctx,e,m){
    const {theme,launch,since,tx,ty,topY,a}=m,spears=7;
    if(launch>0){for(let i=0;i<spears;i++){const d=i*.06,q=epicClamp((launch-d)/(1-d*1.2)),lx=tx+(i-3)*64+(epicHash(e.seed+i)-.5)*30,ly=ty+(epicHash(e.seed+i*3)-.5)*70;if(q<=0)continue;const fade=since<0?1:epicClamp(1-since/.25),y=topY-60+(ly-topY+60)*epicIn(q);if(fade<=0)continue;epicGlowLine(ctx,lx,y-150,lx,y,10,theme.a,.8*fade);ctx.globalAlpha=.95*fade;ctx.fillStyle=theme.c;ctx.beginPath();ctx.moveTo(lx,y+14);ctx.lineTo(lx+7,y-40);ctx.lineTo(lx,y-120);ctx.lineTo(lx-7,y-40);ctx.closePath();ctx.fill();}}
    const grow=since<0?epicSmooth(launch)*.55:.55+.45*epicOut(since/.3),fade=since<0?1:epicClamp(1-since/1.4);
    if(launch>0&&fade>0)for(let tri=0;tri<3;tri++){const r=(80+tri*62)*grow,rot=(tri%2?1:-1)*(a*.9+tri*.4)-Math.PI/2;epicPoly(ctx,tx,ty,r,3,rot,3-tri*.6,tri===1?theme.b:theme.a,.9*fade,.06*fade);for(let v=0;v<3;v++){const va=rot+v*Math.PI*2/3;epicGlowAt(ctx,tx+Math.cos(va)*r,ty+Math.sin(va)*r,14,theme.c,.9*fade);}}
    if(since>=0&&!e.spawned.shards){e.spawned.shards=true;epicSpawn(m.state,tx,ty,34,{kind:"debris",speed:[200,700],life:[.6,1.2],size:[3,7],colors:[theme.c,theme.a,"#ffffff"],grav:900,drag:.95});}
  };
  CommonCombatRunner.prototype.drawEpicMotif_verdict=function(ctx,e,m){
    const {theme,launch,since,sx,sy,tx,ty,a}=m;
    if(launch>0&&since<.1)for(const side of [-1,1]){const q=epicOut(launch),cx=tx+side*(260*(1-q)+10),fade=since<0?1:0;epicRing(ctx,cx,ty,70,110,6,theme.a,.85*fade,side*.3,side>0?Math.PI*.6:-Math.PI*.4,side>0?Math.PI*1.4:Math.PI*.4);epicGlowAt(ctx,cx,ty,40,theme.a,.6*fade);}
    if(since>=0){const q=epicClamp(since/1.0),draw=epicOut(since/.12);for(const angle of [.78,-.78]){const len=340*draw,x1=tx-Math.cos(angle)*len,y1=ty-Math.sin(angle)*len,x2=tx+Math.cos(angle)*len,y2=ty+Math.sin(angle)*len;epicGlowLine(ctx,x1,y1,x2,y2,34*(1-q)+4,theme.a,.9*(1-q));epicStroke(ctx,[[x1,y1],[x2,y2]],5*(1-q)+1,"#ffffff",1-q);}
      if(!e.spawned.shards){e.spawned.shards=true;epicSpawn(m.state,tx,ty,30,{kind:"debris",speed:[260,820],life:[.5,1.1],size:[3,8],colors:[theme.a,theme.b,"#ffffff"],grav:1000});}}
  };
  CommonCombatRunner.prototype.drawEpicMotif_aegis=function(ctx,e,m){
    const {theme,launch,since,tx,ty,a,W}=m;
    if(launch>0&&since<.1){const q=epicOut(launch),fade=since<0?1:0;for(const side of [-1,1]){const cx=tx+side*(W*.45*(1-q));epicRing(ctx,cx,ty,120,170,8,side>0?theme.b:theme.a,.85*fade,0,side>0?Math.PI*.55:-Math.PI*.45,side>0?Math.PI*1.45:Math.PI*.45);epicGlowAt(ctx,cx,ty,60,side>0?theme.b:theme.a,.5*fade);}}
    if(since>=0){const q=epicClamp(since/1.4),fade=1-q;for(let dome=0;dome<4;dome++){const r=(110+dome*55)*(.6+.4*epicOut(since/.3)),pulse=.75+.25*Math.sin(since*14+dome);epicRing(ctx,tx,ty+30,r,r*.8,5-dome,dome%2?theme.b:theme.a,.85*fade*pulse,0,Math.PI,Math.PI*2);}
      for(let ring=0;ring<2;ring++)for(let i=0;i<(ring?12:6);i++){const angle=i*Math.PI*2/(ring?12:6)+Math.PI/6,r=ring?96:50,hx=tx+Math.cos(angle)*r,hy=ty+Math.sin(angle)*r*.7;epicPoly(ctx,hx,hy,22,6,Math.PI/6,1.6,theme.b,.7*fade*(.5+.5*Math.sin(since*18+i)),.1*fade);}}
  };
  CommonCombatRunner.prototype.drawEpicMotif_artillery=function(ctx,e,m){
    const {theme,launch,since,sx,sy,tx,ty,a,state}=m,path=u=>[sx+(tx-sx)*u,sy+(ty-sy)*u-Math.sin(Math.PI*u)*120];
    if(a>=m.tCut&&!e.spawned.muzzle){e.spawned.muzzle=true;epicSpawn(state,sx,sy,18,{speed:[200,620],angle:-Math.PI/2,spread:1.6,life:[.2,.45],colors:[theme.core,theme.b,theme.a],grav:500});epicSpawn(state,sx+10,sy+10,4,{kind:"debris",speed:[180,340],angle:-.6,spread:.8,life:[.7,1],size:[4,5],colors:[theme.c],grav:1100});}
    const mq=epicClamp((a-m.tCut)/.3);if(mq>0&&mq<1){epicGlowAt(ctx,sx,sy,40+90*epicOut(mq),theme.b,.95*(1-mq));epicRing(ctx,sx,sy,20+80*epicOut(mq),20+80*epicOut(mq),5*(1-mq)+1,theme.core,1-mq);}
    if(launch>0&&since<0){const u=epicIn(launch),[hx,hy]=path(u),trail=[];for(let s=0;s<=10;s++){trail.push(path(Math.max(0,u-.4)+(u-Math.max(0,u-.4))*s/10));}epicStroke(ctx,trail,26,theme.a,.3);epicStroke(ctx,trail,11,theme.b,.8);epicStroke(ctx,trail,3,"#ffffff",.95);epicGlowAt(ctx,hx,hy,54,theme.b,1);epicGlowAt(ctx,hx,hy,20,"#ffffff",1);if(Math.random()<.6)epicSpawn(state,hx,hy,2,{kind:"smoke",speed:[10,40],life:[.5,.9],size:[16,26],colors:["#000"],grav:-40,drag:.9});}
    if(since>=0){const q=epicClamp(since/1.0);epicGlowAt(ctx,tx,ty,150+250*epicOut(since/.35),theme.b,epicClamp(1-since/.9));epicGlowAt(ctx,tx,ty,90+120*epicOut(since/.3),theme.a,epicClamp(1-since/.7));
      for(let blast=0;blast<3;blast++){const d=.16+blast*.14,bq=epicClamp((since-d)/.5);if(bq<=0||bq>=1)continue;const bx=tx+[-110,120,-20][blast],by=ty+[30,-20,-70][blast];epicGlowAt(ctx,bx,by,50+150*epicOut(bq),blast===1?theme.a:theme.b,.95*(1-bq));epicGlowAt(ctx,bx,by,24+50*epicOut(bq),"#ffffff",Math.pow(1-bq,2));epicRing(ctx,bx,by+16,20+160*epicOut(bq),(20+160*epicOut(bq))*.36,6*(1-bq)+1,theme.core,.85*(1-bq));const key=`b${blast}`;if(!e.spawned[key]){e.spawned[key]=true;epicSpawn(state,bx,by,24,{speed:[240,760],life:[.3,.8],colors:[theme.core,theme.b,theme.a],grav:800});}}
      for(let plume=0;plume<3;plume++){const pq=epicClamp((since-.1-plume*.08)/1.5);if(pq<=0||pq>=1)continue;const px=tx+[-70,40,120][plume],h=(150+60*plume)*Math.sin(Math.PI*pq),flick=.8+.2*Math.sin(since*40+plume*2);epicGlowRect(ctx,px-24,ty-h,48,h+30,theme.b,.75*(1-pq)*flick,false);epicGlowRect(ctx,px-10,ty-h*.7,20,h*.7+20,"#fff0c8",.6*(1-pq)*flick,true);}
      if(!e.spawned.debris){e.spawned.debris=true;epicSpawn(state,tx,ty,26,{kind:"debris",speed:[260,900],angle:-Math.PI/2,spread:2.6,life:[.7,1.3],size:[3,7],colors:["#3a2a22","#6b4a33",theme.c],grav:1300,drag:.97});}}
  };
  CommonCombatRunner.prototype.drawEpicMotif_hexwall=function(ctx,e,m){
    const {theme,launch,since,sx,sy,tx,ty,a,state}=m,offsets=[[0,0],...Array.from({length:6},(_,i)=>[Math.cos(i*Math.PI/3)*64,Math.sin(i*Math.PI/3)*64])];
    if(launch>0){offsets.forEach(([ox,oy],i)=>{const q=since<0?epicOut(epicClamp(launch*1.25-i*.05)):1,burst=since<0?0:epicOut(since/.5),fade=since<0?1:epicClamp(1-since/.55),x=sx+(tx+ox*(1+1.9*burst)-sx)*q,y=sy+(ty+oy*(1+1.9*burst)-sy)*q,rot=Math.PI/6+(since>0?since*(i%2?3:-3):0);if(fade<=0)return;epicPoly(ctx,x,y,34*(since<0?.6+.4*q:1+.3*burst),6,rot,2.4,since>=0&&since<.06?"#ffffff":theme.a,.95*fade,.16*fade);epicGlowAt(ctx,x,y,30,theme.a,.35*fade,false);});}
    if(since>=0){const q=epicClamp(since/.9);if(q<1){const seed=Math.floor(since*16);ctx.globalAlpha=.9*(1-q);ctx.strokeStyle=theme.c;ctx.lineWidth=2;ctx.beginPath();for(let bolt=0;bolt<6;bolt++){const angle=epicHash(seed*13+bolt)*Math.PI*2,len=120+110*epicHash(seed*7+bolt);ctx.moveTo(tx,ty);for(let s=1;s<=6;s++){const d=len*s/6,j=(epicHash(seed*31+bolt*7+s)-.5)*34;ctx.lineTo(tx+Math.cos(angle)*d-Math.sin(angle)*j,ty+Math.sin(angle)*d+Math.cos(angle)*j);}}ctx.stroke();}
      const lq=epicClamp(since/1.5);offsets.forEach(([ox,oy])=>epicPoly(ctx,tx+ox*1.5,ty+oy*1.5,40,6,Math.PI/6,1.2,theme.b,.5*(1-lq)));
      if(!e.spawned.shards){e.spawned.shards=true;epicSpawn(state,tx,ty,30,{kind:"debris",speed:[240,760],life:[.5,1.1],size:[4,8],colors:[theme.a,theme.c,"#ffffff"],grav:700});}}
  };
  CommonCombatRunner.prototype.drawEpicMotif_seal=function(ctx,e,m){
    const {theme,launch,since,sx,sy,tx,ty,a}=m,form=epicClamp((a-m.tCut+.25)/(m.imp-m.tCut+.25));
    if(since<.15&&launch>0){const fade=since<0?1:epicClamp(1-since/.15);for(let thread=0;thread<5;thread++){const angle=-Math.PI/2+(thread-2)*.55,ex=tx+Math.cos(angle)*170,ey=ty+Math.sin(angle)*170,cx=(sx+ex)/2+(thread-2)*60,cy=Math.min(sy,ey)-120,points=[];const u=epicOut(launch);for(let s=0;s<=14;s++){const v=u*s/14,iv=1-v;points.push([iv*iv*sx+2*iv*v*cx+v*v*ex,iv*iv*sy+2*iv*v*cy+v*v*ey]);}epicStroke(ctx,points,2.2,theme.c,.85*fade);epicStroke(ctx,points,7,theme.a,.25*fade);}}
    let scale=1,alpha=form;if(since>=0){scale=since<.1?1-.62*epicSmooth(since/.1):.38+1.3*epicOut((since-.1)/.9);alpha=since<.1?1:epicClamp(1-(since-.1)/1.5);}
    if(form>0&&alpha>.01){const R=175*scale,rot=a*.7;epicRing(ctx,tx,ty,R,R,3,theme.a,.95*alpha,0,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.min(1,form*1.3));epicRing(ctx,tx,ty,R*.8,R*.8,1.4,theme.c,.8*alpha*form,rot);
      ctx.globalAlpha=.9*alpha*form;ctx.strokeStyle=theme.c;ctx.lineWidth=2;ctx.beginPath();for(let tick=0;tick<24;tick++){const angle=tick*Math.PI/12-rot*.6,r1=R*.84,r2=R*(tick%3?.92:.97);ctx.moveTo(tx+Math.cos(angle)*r1,ty+Math.sin(angle)*r1);ctx.lineTo(tx+Math.cos(angle)*r2,ty+Math.sin(angle)*r2);}ctx.stroke();
      for(let tri=0;tri<2;tri++)epicPoly(ctx,tx,ty,R*.72,3,rot*(tri?-1:1)+(tri?Math.PI:0)-Math.PI/2,2.2,tri?theme.b:theme.a,.9*alpha*form);
      epicRing(ctx,tx,ty,R*.34,R*.34,2,theme.a,.9*alpha*form,-rot*2);for(let dot=0;dot<6;dot++){const angle=dot*Math.PI/3+rot;epicGlowAt(ctx,tx+Math.cos(angle)*R*.72,ty+Math.sin(angle)*R*.72,12,theme.c,.9*alpha*form);}
      epicRing(ctx,tx,ty+130*scale,R*1.05,R*.24,2,theme.a,.6*alpha*form,0);}
    if(since>=0&&since<1.8){const echo=epicClamp(since/1.8);epicRing(ctx,tx,ty,175*(1+1.2*epicOut(echo)),175*(1+1.2*epicOut(echo)),3*(1-echo)+.6,theme.b,.7*(1-echo));}
  };
  // Arin (SR-10) fires page cards from her floating book hub: a spinning burgundy/ivory card with a brass rim,
  // a soft glow and an ivory sparkle trail; hits burst into small card shards.
  const epicCard=(ctx,x,y,w,h,rot,face,alpha=1)=>{ctx.save();ctx.translate(x,y);ctx.rotate(rot);ctx.globalAlpha=alpha;ctx.globalCompositeOperation="source-over";ctx.fillStyle=face?"#f3e6c8":"#8e1c2e";ctx.fillRect(-w/2,-h/2,w,h);ctx.strokeStyle="#e0a94a";ctx.lineWidth=Math.max(1,w*.12);ctx.strokeRect(-w/2+.5,-h/2+.5,w-1,h-1);ctx.beginPath();ctx.moveTo(0,-h*.32);ctx.lineTo(0,h*.32);ctx.moveTo(-w*.3,0);ctx.lineTo(w*.3,0);ctx.stroke();ctx.beginPath();ctx.arc(0,0,Math.min(w,h)*.2,0,Math.PI*2);ctx.stroke();ctx.restore();};
  const drawPageCard=(ctx,q)=>{
    const dx=q.x-q.px,dy=q.y-q.py,angle=Math.atan2(dy,dx),t=q.age||0,spin=t*18+(q.shotId?q.shotId.length:0);
    ctx.save();ctx.globalCompositeOperation="lighter";const trail=ctx.createLinearGradient(q.px,q.py,q.x,q.y);trail.addColorStop(0,"rgba(243,230,200,0)");trail.addColorStop(1,"rgba(243,230,200,.75)");ctx.strokeStyle=trail;ctx.lineWidth=3;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(q.px,q.py);ctx.lineTo(q.x,q.y);ctx.stroke();
    epicGlowAt(ctx,q.x,q.y,26,"#e0a94a",.75);for(let k=1;k<=3;k++)epicGlowAt(ctx,q.x-Math.cos(angle)*k*9+Math.sin(spin+k)*3,q.y-Math.sin(angle)*k*9+Math.cos(spin+k)*3,4,"#fff6e6",.7-k*.18);ctx.restore();
    epicCard(ctx,q.x,q.y,11,16,angle+Math.sin(spin)*.6,Math.sin(spin*.5)>0);
  };
  const drawPageCardImpact=(ctx,v)=>{
    const t=Math.min(1,(v.age||0)/.6),p=1-t;ctx.save();ctx.globalCompositeOperation="lighter";epicGlowAt(ctx,v.x,v.y,20+60*epicOut(t),"#e0a94a",.8*p);epicRing(ctx,v.x,v.y,10+50*epicOut(t),10+50*epicOut(t),3*p+.8,"#f3e6c8",.8*p);ctx.restore();
    for(let k=0;k<5;k++){const a=k*1.2566+(v.x%7),r=8+42*epicOut(t);epicCard(ctx,v.x+Math.cos(a)*r,v.y+Math.sin(a)*r+18*t*t,6,9,a+t*6,k%2===0,p);}
  };
  CommonCombatRunner.prototype.drawEpicMotif_cardstorm=function(ctx,e,m){
    // Twelve page cards leave the book, spiral into a ring around the target, then detonate as a card storm with
    // an open "formula" circle (Arin rewrites the judgement formula in the scenario).
    const {theme,launch,since,sx,sy,tx,ty,a,state}=m,N=12;
    if(launch>0&&since<.05)for(let i=0;i<N;i++){const d=i*.035,q=epicClamp((launch-d)/(1-d*1.1)),ang=i*Math.PI*2/N+a*3,rr=110*(1-q)+60;const bx=sx+(tx-sx)*epicOut(q)+Math.cos(ang)*rr*q,by=sy+(ty-sy)*epicOut(q)+Math.sin(ang)*rr*q*.8-Math.sin(Math.PI*q)*60;ctx.save();ctx.globalCompositeOperation="lighter";epicGlowAt(ctx,bx,by,16,theme.a,.7*q);ctx.restore();epicCard(ctx,bx,by,13,19,ang+q*4,i%2===0,.95);}
    if(since>=0){const q=epicClamp(since/1.3),fade=1-q;
      const R=150+60*epicOut(since/.4);ctx.save();ctx.globalCompositeOperation="lighter";epicRing(ctx,tx,ty,R,R,3*fade+.8,theme.a,.9*fade,0,0,Math.PI*2);epicRing(ctx,tx,ty,R*.72,R*.72,1.6,theme.c,.75*fade,since*.8);
      ctx.globalAlpha=.85*fade;ctx.strokeStyle=theme.c;ctx.lineWidth=1.6;ctx.beginPath();for(let k=0;k<3;k++){const aa=since*.6+k*Math.PI*2/3;ctx.moveTo(tx+Math.cos(aa)*R*.72,ty+Math.sin(aa)*R*.72);ctx.lineTo(tx+Math.cos(aa+Math.PI)*R*.72,ty+Math.sin(aa+Math.PI)*R*.72);}ctx.stroke();ctx.restore();
      for(let i=0;i<N;i++){const ang=i*Math.PI*2/N+since*2.2,rr=R*(1+.25*Math.sin(since*6+i));epicCard(ctx,tx+Math.cos(ang)*rr,ty+Math.sin(ang)*rr*.85,14,20,ang+Math.PI/2,i%2===0,fade);}
      if(!e.spawned.cards){e.spawned.cards=true;epicSpawn(state,tx,ty,36,{kind:"debris",speed:[240,760],life:[.7,1.4],size:[5,8],colors:["#f3e6c8","#8e1c2e","#e0a94a"],grav:620,drag:.96});}}
  };
  // Jaein (SSR-08) launches small jade/gold drone modules from her crescent hub: each shot is a spinning octagonal
  // drone with a jade core and twin thruster streaks; hits burst into a jade hex ring with gold shards.
  const epicDrone=(ctx,x,y,r,rot,alpha=1)=>{ctx.save();ctx.translate(x,y);ctx.rotate(rot);ctx.globalAlpha=alpha;ctx.globalCompositeOperation="source-over";
    ctx.beginPath();for(let k=0;k<8;k++){const a=k*Math.PI/4+Math.PI/8;ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r*1.12);}ctx.closePath();ctx.fillStyle="#1a2f2a";ctx.fill();ctx.lineWidth=Math.max(1,r*.28);ctx.strokeStyle="#e6c68a";ctx.stroke();
    ctx.beginPath();ctx.arc(0,0,r*.46,0,Math.PI*2);ctx.fillStyle="#2fe08a";ctx.fill();ctx.beginPath();ctx.arc(-r*.12,-r*.12,r*.16,0,Math.PI*2);ctx.fillStyle="#eafff4";ctx.fill();ctx.restore();};
  const drawDroneDart=(ctx,q)=>{
    const dx=q.x-q.px,dy=q.y-q.py,angle=Math.atan2(dy,dx),t=q.age||0,nx=-Math.sin(angle),ny=Math.cos(angle);
    ctx.save();ctx.globalCompositeOperation="lighter";
    for(const side of [-1,1]){const ox=nx*4*side,oy=ny*4*side,trail=ctx.createLinearGradient(q.px+ox,q.py+oy,q.x+ox,q.y+oy);trail.addColorStop(0,"rgba(47,224,138,0)");trail.addColorStop(1,"rgba(120,255,190,.8)");ctx.strokeStyle=trail;ctx.lineWidth=2.4;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(q.px+ox-dx*.6,q.py+oy-dy*.6);ctx.lineTo(q.x+ox,q.y+oy);ctx.stroke();}
    epicGlowAt(ctx,q.x,q.y,24,"#2fe08a",.8);epicGlowAt(ctx,q.x-Math.cos(angle)*10,q.y-Math.sin(angle)*10,10,"#f0d9a8",.5);ctx.restore();
    epicDrone(ctx,q.x,q.y,7,angle+t*14,1);
  };
  const drawDroneImpact=(ctx,v)=>{
    const t=Math.min(1,(v.age||0)/.55),p=1-t,R=8+46*epicOut(t);ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowAt(ctx,v.x,v.y,18+54*epicOut(t),"#2fe08a",.85*p);epicPoly(ctx,v.x,v.y,R,6,t*2,2.2*p+.6,"#9dffd0",.85*p);epicPoly(ctx,v.x,v.y,R*.6,6,-t*3,1.4,"#f0d9a8",.7*p);ctx.restore();
    for(let k=0;k<6;k++){const a=k*1.0472+t*1.5,r=6+40*epicOut(t);ctx.save();ctx.globalAlpha=p;ctx.fillStyle=k%2?"#e6c68a":"#2fe08a";ctx.translate(v.x+Math.cos(a)*r,v.y+Math.sin(a)*r+16*t*t);ctx.rotate(a+t*8);ctx.fillRect(-2.5,-2.5,5,5);ctx.restore();}
  };
  CommonCombatRunner.prototype.drawEpicMotif_swarm=function(ctx,e,m){
    // Nine drones leave the raised crescent hub, spiral into a crescent formation around the target and converge in
    // jade beams on a hexagonal lattice (Vox Swarm).
    const {theme,launch,since,sx,sy,tx,ty,a,state}=m,N=9;
    if(launch>0&&since<.05)for(let i=0;i<N;i++){const d=i*.04,q=epicClamp((launch-d)/(1-d*1.2)),ang=Math.PI*(1.1+i/(N-1)*.8)+a*2,rr=150*(1-q)+90;const bx=sx+(tx-sx)*epicOut(q)+Math.cos(ang)*rr*q,by=sy+(ty-sy)*epicOut(q)+Math.sin(ang)*rr*q*.7-Math.sin(Math.PI*q)*70;ctx.save();ctx.globalCompositeOperation="lighter";epicGlowAt(ctx,bx,by,18,theme.a,.75*q);ctx.restore();epicDrone(ctx,bx,by,8,ang+q*6,.95);}
    if(since>=0){const q=epicClamp(since/1.3),fade=1-q,R=140+50*epicOut(since/.4),pts=[];
      for(let i=0;i<N;i++){const ang=Math.PI*(1.05+i/(N-1)*.9)+since*1.6;pts.push([tx+Math.cos(ang)*R,ty+Math.sin(ang)*R*.8]);}
      ctx.save();ctx.globalCompositeOperation="lighter";
      for(const [px,py] of pts)epicBeam(ctx,px,py,tx,ty,3.2*fade+1,theme,.8*fade);
      epicPoly(ctx,tx,ty,R*.62,6,since*.9,2.6*fade+.8,theme.a,.9*fade,.08*fade);epicPoly(ctx,tx,ty,R*.36,6,-since*1.3,1.8,theme.c,.8*fade);
      epicRing(ctx,tx,ty,R,R*.8,2.2*fade+.6,theme.c,.7*fade,0,Math.PI*1.02,Math.PI*1.98);epicGlowAt(ctx,tx,ty,60+80*epicOut(since/.35),theme.a,.9*fade);ctx.restore();
      for(const [px,py] of pts)epicDrone(ctx,px,py,9,since*5,fade);
      if(!e.spawned.swarm){e.spawned.swarm=true;epicSpawn(state,tx,ty,34,{kind:"debris",speed:[240,760],life:[.6,1.3],size:[3,6],colors:["#2fe08a","#e6c68a","#eafff4"],grav:520,drag:.95});}}
  };
  // Roa (SR-03) fires coil-accelerated bolts from her orange/copper coil rifle: a cyan slug core wrapped by spinning
  // orange coil rings along its path; hits flash cyan with copper sparks and a ring shockwave.
  const drawCoilBolt=(ctx,q)=>{
    const dx=q.x-q.px,dy=q.y-q.py,angle=Math.atan2(dy,dx),t=q.age||0,ux=Math.cos(angle),uy=Math.sin(angle);
    ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowLine(ctx,q.px-dx*.8,q.py-dy*.8,q.x,q.y,5,"#3fe6e0",.75);
    for(let k=0;k<3;k++){const back=10+k*12,cx=q.x-ux*back,cy=q.y-uy*back;epicRing(ctx,cx,cy,4.5,9,1.8,"#ff9a3a",.85-k*.22,angle,0,Math.PI*2);}
    epicGlowAt(ctx,q.x,q.y,22,"#3fe6e0",.9);epicGlowAt(ctx,q.x,q.y,9,"#f2ffff",1);ctx.restore();
  };
  const drawCoilImpact=(ctx,v)=>{
    const t=Math.min(1,(v.age||0)/.5),p=1-t,R=6+44*epicOut(t);ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowAt(ctx,v.x,v.y,16+50*epicOut(t),"#3fe6e0",.9*p);epicRing(ctx,v.x,v.y,R,R*.72,2.4*p+.6,"#ff9a3a",.9*p);epicRing(ctx,v.x,v.y,R*.55,R*.4,1.6,"#f2ffff",.8*p);
    epicRays(ctx,v.x,v.y,8,4,10+30*epicOut(t),.1,"#ffb45a",.7*p,t*2,17);ctx.restore();
  };
  CommonCombatRunner.prototype.drawEpicMotif_coilrail=function(ctx,e,m){
    // Forge Overdrive: copper coil rings charge along the line to the target, then a cyan rail discharge tears through
    // it with ring shockwaves and orange sparks.
    const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,ang=Math.atan2(dy,dx),N=7;
    if(launch>0&&since<.05)for(let i=0;i<N;i++){const f=(i+1)/(N+1),q=epicClamp(launch*1.4-i*.08),x=sx+dx*f,y=sy+dy*f;ctx.save();ctx.globalCompositeOperation="lighter";epicRing(ctx,x,y,10+14*q,22+26*q,2.2,theme.b,.9*q,ang,0,Math.PI*2);epicGlowAt(ctx,x,y,14*q,theme.c,.5*q);ctx.restore();}
    if(since>=0){const q=epicClamp(since/1.1),fade=1-q;ctx.save();ctx.globalCompositeOperation="lighter";
      epicBeam(ctx,sx,sy,tx,ty,9*fade+2,theme,.95*fade);
      for(let i=0;i<N;i++){const f=(i+1)/(N+1),x=sx+dx*f,y=sy+dy*f,s=1+since*2.5;epicRing(ctx,x,y,12*s,26*s,2*fade+.5,theme.b,.8*fade,ang,0,Math.PI*2);}
      const R=60+140*epicOut(since/.5);epicRing(ctx,tx,ty,R,R*.62,3*fade+.8,theme.a,.9*fade);epicRing(ctx,tx,ty,R*.6,R*.38,2,theme.c,.8*fade);
      epicGlowAt(ctx,tx,ty,70+90*epicOut(since/.35),theme.a,.95*fade);ctx.restore();
      if(!e.spawned.coil){e.spawned.coil=true;epicSpawn(state,tx,ty,30,{kind:"debris",speed:[260,820],life:[.5,1.2],size:[2,5],colors:["#ff9a3a","#3fe6e0","#ffe0b0"],grav:520,drag:.95});}}
  };
  // Astra (SSR-11) restyle to the new Codex art (silver hair, star-compass hairpin, white/navy/cobalt precision rifle):
  // a thin silver precision slug with a cobalt trace and a four-point star glint; hits flash a compass star and a cobalt ring.
  const astraStar=(ctx,x,y,r,inner,rot,color,alpha)=>{if(!(alpha>.004)||!(r>.5))return;ctx.globalAlpha=Math.min(1,alpha);ctx.fillStyle=color;ctx.beginPath();
    for(let k=0;k<8;k++){const an=rot+k*Math.PI/4,rr=k%2?inner:r,px=x+Math.cos(an)*rr,py=y+Math.sin(an)*rr;k?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();ctx.fill();};
  const drawStarRail=(ctx,q)=>{
    const dx=q.x-q.px,dy=q.y-q.py,angle=Math.atan2(dy,dx),t=q.age||0;
    ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowLine(ctx,q.px-dx*2.4,q.py-dy*2.4,q.x,q.y,5,"#4d7dff",.7);
    epicGlowLine(ctx,q.px-dx*1.2,q.py-dy*1.2,q.x,q.y,1.8,"#f4f8ff",.95);
    epicGlowAt(ctx,q.x,q.y,20,"#4d7dff",.85);astraStar(ctx,q.x,q.y,12,2.2,angle+t*5,"#f4f8ff",.95);ctx.restore();
  };
  const drawStarImpact=(ctx,v)=>{
    const t=Math.min(1,(v.age||0)/.5),p=1-t,R=8+46*epicOut(t);ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowAt(ctx,v.x,v.y,18+46*epicOut(t),"#4d7dff",.9*p);astraStar(ctx,v.x,v.y,14+40*epicOut(t),3+2*p,t*.6,"#f4f8ff",.95*p);
    epicRing(ctx,v.x,v.y,R,R,1.8*p+.6,"#8fb0ff",.9*p);epicRays(ctx,v.x,v.y,6,4,10+26*epicOut(t),.08,"#cfdcff",.65*p,t*2,23);ctx.restore();
  };
  CommonCombatRunner.prototype.drawEpicMotif_starcompass=function(ctx,e,m){
    // Afterglow Vector (star-compass restyle): a cobalt scope reticle locks onto the target, a silver precision rail fires from
    // the rifle, then a four-point compass star detonates with cobalt ring shockwaves, compass ticks and silver shards.
    const {theme,launch,since,sx,sy,tx,ty,a,state}=m;
    if(launch>0&&since<0){const lock=epicOut(launch),r=40+170*(1-lock),rot=a*1.5;ctx.save();ctx.globalCompositeOperation="lighter";
      epicRing(ctx,tx,ty,r,r,2.2,theme.a,.85*lock);epicRing(ctx,tx,ty,r*.62,r*.62,1.4,theme.c,.7*lock,0,rot,rot+Math.PI*1.5);
      for(let k=0;k<4;k++){const an=k*Math.PI/2+rot*.25;epicStroke(ctx,[[tx+Math.cos(an)*(r+14),ty+Math.sin(an)*(r+14)],[tx+Math.cos(an)*r*.35,ty+Math.sin(an)*r*.35]],2,theme.c,.85*lock);}
      astraStar(ctx,tx,ty,18*lock+6,3,rot*.5,theme.core,.8*lock);ctx.restore();}
    if(launch>0&&since<.22){const head=epicIn(launch),hx=sx+(tx-sx)*head,hy=sy+(ty-sy)*head,fade=since<0?1:epicClamp(1-since/.22);ctx.save();ctx.globalCompositeOperation="lighter";
      epicBeam(ctx,sx,sy,hx,hy,11,theme,fade);epicGlowAt(ctx,hx,hy,38,theme.a,fade);astraStar(ctx,hx,hy,22,4,0,theme.core,fade);ctx.restore();}
    if(since>=0){const q=epicClamp(since/1.15),f=1-q,S=120+420*epicOut(since/.35),R=50+230*epicOut(since/.55);ctx.save();ctx.globalCompositeOperation="lighter";
      epicGlowAt(ctx,tx,ty,80+120*epicOut(since/.3),theme.a,.95*f);
      astraStar(ctx,tx,ty,S,10*f+3,0,theme.c,.55*f);astraStar(ctx,tx,ty,S*.62,6*f+2,Math.PI/4,theme.a,.6*f);astraStar(ctx,tx,ty,S*.45,4*f+1.5,0,theme.core,.95*f);
      epicRing(ctx,tx,ty,R,R*.9,3*f+.8,theme.a,.9*f);epicRing(ctx,tx,ty,R*.6,R*.55,2,theme.c,.8*f);
      for(let k=0;k<16;k++){const an=k*Math.PI/8,r1=R*1.02,r2=R*(k%4?1.07:1.16);epicStroke(ctx,[[tx+Math.cos(an)*r1,ty+Math.sin(an)*r1],[tx+Math.cos(an)*r2,ty+Math.sin(an)*r2]],k%4?1.2:2.4,theme.c,.8*f);}
      epicGlowAt(ctx,tx,ty,36,"#ffffff",f);ctx.restore();
      if(!e.spawned.star){e.spawned.star=true;epicSpawn(state,tx,ty,28,{kind:"debris",speed:[240,760],life:[.5,1.2],size:[1.5,4],colors:["#cfdcff","#4d7dff","#ffffff"],grav:420,drag:.95});}}
  };
  // Noella (SSR-12) fires small seal discs from the compass head of her ivory/gold staff: a spinning gold compass ring with
  // a four-arm cross and a warm ivory core, trailing gold light; hits stamp a cross seal with a ring and gold rays.
  const noellaCross=(ctx,x,y,r,rot,color,alpha,width=2)=>{if(!(alpha>.004)||!(r>.5))return;
    for(let k=0;k<2;k++){const an=rot+k*Math.PI/2,c=Math.cos(an)*r,s2=Math.sin(an)*r;epicGlowLine(ctx,x-c,y-s2,x+c,y+s2,width,color,alpha);}};
  const drawCrossSeal=(ctx,q)=>{
    const dx=q.x-q.px,dy=q.y-q.py,t=q.age||0;
    ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowLine(ctx,q.px-dx*1.8,q.py-dy*1.8,q.x,q.y,6,"#f2c14e",.6);
    epicGlowLine(ctx,q.px-dx*.9,q.py-dy*.9,q.x,q.y,2,"#fff1c9",.9);
    epicGlowAt(ctx,q.x,q.y,20,"#f2c14e",.8);epicRing(ctx,q.x,q.y,9,9,1.8,"#ffd978",.95,0,t*9,t*9+Math.PI*1.6);
    noellaCross(ctx,q.x,q.y,11,t*6,"#fffaf0",.95,1.6);epicGlowAt(ctx,q.x,q.y,6,"#ffffff",1);ctx.restore();
  };
  const drawCrossImpact=(ctx,v)=>{
    const t=Math.min(1,(v.age||0)/.5),p=1-t,R=8+42*epicOut(t);ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowAt(ctx,v.x,v.y,16+44*epicOut(t),"#f2c14e",.9*p);noellaCross(ctx,v.x,v.y,12+34*epicOut(t),Math.PI/4*t,"#fffaf0",.9*p,2.4*p+.6);
    epicRing(ctx,v.x,v.y,R,R,1.8*p+.6,"#ffd978",.9*p);epicRays(ctx,v.x,v.y,8,4,10+24*epicOut(t),.08,"#fff1c9",.6*p,t*1.5,31);ctx.restore();
  };
  CommonCombatRunner.prototype.drawEpicMotif_crossseal=function(ctx,e,m){
    // Testimony Seal: a gold compass circle is drawn around the target with its cross and cardinal ticks, a gold beam leaves
    // the staff head, then two cross pillars of light stamp the seal with ivory ring shockwaves and falling gold motes.
    const {theme,launch,since,sx,sy,tx,ty,a,state}=m;
    if(launch>0&&since<0){const draw=epicOut(launch),r=150-40*draw,rot=a*.6;ctx.save();ctx.globalCompositeOperation="lighter";
      epicRing(ctx,tx,ty,r,r*.82,2.4,theme.a,.9,0,-Math.PI/2,-Math.PI/2+Math.PI*2*draw);epicRing(ctx,tx,ty,r*.66,r*.54,1.4,theme.c,.75*draw,0,rot,rot+Math.PI*1.5);
      for(let k=0;k<4;k++){const an=k*Math.PI/2,q=epicClamp(draw*4-k);epicStroke(ctx,[[tx+Math.cos(an)*r*1.12,ty+Math.sin(an)*r*.92],[tx+Math.cos(an)*r*.2,ty+Math.sin(an)*r*.16]],2,theme.c,.85*q);}
      epicGlowAt(ctx,tx,ty,24*draw+8,theme.a,.7*draw);ctx.restore();}
    if(launch>0&&since<.22){const head=epicIn(launch),hx=sx+(tx-sx)*head,hy=sy+(ty-sy)*head,fade=since<0?1:epicClamp(1-since/.22);ctx.save();ctx.globalCompositeOperation="lighter";
      epicBeam(ctx,sx,sy,hx,hy,10,theme,fade);epicGlowAt(ctx,hx,hy,34,theme.a,fade);noellaCross(ctx,hx,hy,18,0,theme.core,fade,2.4);ctx.restore();}
    if(since>=0){const q=epicClamp(since/1.2),f=1-q,H=160+360*epicOut(since/.3),R=50+220*epicOut(since/.55);ctx.save();ctx.globalCompositeOperation="lighter";
      epicGlowAt(ctx,tx,ty,80+120*epicOut(since/.3),theme.a,.95*f);
      epicGlowLine(ctx,tx,ty-H,tx,ty+H*.5,22*f+4,theme.a,.75*f);epicGlowLine(ctx,tx-H*.62,ty-H*.12,tx+H*.62,ty-H*.12,18*f+3,theme.a,.7*f);
      epicGlowLine(ctx,tx,ty-H,tx,ty+H*.5,6*f+1.5,theme.core,.95*f);epicGlowLine(ctx,tx-H*.62,ty-H*.12,tx+H*.62,ty-H*.12,5*f+1.2,theme.core,.9*f);
      epicRing(ctx,tx,ty,R,R*.82,3*f+.8,theme.a,.9*f);epicRing(ctx,tx,ty,R*.62,R*.5,2,theme.c,.8*f);
      for(let k=0;k<12;k++){const an=k*Math.PI/6,r1=R*1.02,r2=R*(k%3?1.08:1.18);epicStroke(ctx,[[tx+Math.cos(an)*r1,ty+Math.sin(an)*r1*.82],[tx+Math.cos(an)*r2,ty+Math.sin(an)*r2*.82]],k%3?1.2:2.4,theme.c,.8*f);}
      epicGlowAt(ctx,tx,ty,34,"#ffffff",f);ctx.restore();
      if(!e.spawned.seal){e.spawned.seal=true;epicSpawn(state,tx,ty-40,30,{kind:"debris",speed:[160,560],life:[.7,1.5],size:[1.5,4],colors:["#fff1c9","#f2c14e","#ffffff"],grav:260,drag:.94});}}
  };
  // Ria (SR-04) fires cyan pulse lances from the spear-tip muzzle of her Vanguard rifle: a white spear-head chevron with a
  // cyan wake flanked by two thin gold shield-fin streaks; hits flash a hexagonal shield ring with short white rays.
  const riaChevron=(ctx,x,y,ang,len,wid,color,alpha,width=2)=>{if(!(alpha>.004))return;const c=Math.cos(ang),s2=Math.sin(ang),nx=-s2,ny=c,bx=x-c*len*.5,by=y-s2*len*.5;
    epicStroke(ctx,[[bx+nx*wid,by+ny*wid],[x+c*len*.5,y+s2*len*.5],[bx-nx*wid,by-ny*wid]],width,color,alpha);};
  const riaKite=(ctx,x,y,ang,len,wid,color,alpha,fill)=>{if(!(alpha>.004)||!(len>.5))return;const c=Math.cos(ang),s2=Math.sin(ang),nx=-s2,ny=c;
    ctx.beginPath();ctx.moveTo(x+c*len*.55,y+s2*len*.55);ctx.lineTo(x+nx*wid-c*len*.08,y+ny*wid-s2*len*.08);ctx.lineTo(x-c*len*.45,y-s2*len*.45);ctx.lineTo(x-nx*wid-c*len*.08,y-ny*wid-s2*len*.08);ctx.closePath();
    if(fill>0){ctx.globalAlpha=Math.min(1,fill);ctx.fillStyle=color;ctx.fill();}ctx.globalAlpha=Math.min(1,alpha);ctx.strokeStyle=color;ctx.lineWidth=1.8;ctx.lineJoin="round";ctx.stroke();};
  const drawVanguardPulse=(ctx,q)=>{
    const dx=q.x-q.px,dy=q.y-q.py,ang=Math.atan2(dy,dx),c=Math.cos(ang),s2=Math.sin(ang),nx=-s2,ny=c;
    ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowLine(ctx,q.px-dx*2,q.py-dy*2,q.x,q.y,7,"#5fd4ff",.55);
    epicGlowLine(ctx,q.px-dx*1.1,q.py-dy*1.1,q.x,q.y,2,"#f4fbff",.95);
    for(const k of [-1,1]){const ox=nx*5*k,oy=ny*5*k;epicGlowLine(ctx,q.px-dx*.9+ox,q.py-dy*.9+oy,q.x-c*6+ox,q.y-s2*6+oy,1.4,"#ffd27a",.8);}
    epicGlowAt(ctx,q.x,q.y,18,"#5fd4ff",.85);riaChevron(ctx,q.x,q.y,ang,14,7,"#f4fbff",.95,2);epicGlowAt(ctx,q.x+c*4,q.y+s2*4,6,"#ffffff",1);ctx.restore();
  };
  const drawVanguardImpact=(ctx,v)=>{
    const t=Math.min(1,(v.age||0)/.5),p=1-t,R=10+40*epicOut(t);ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowAt(ctx,v.x,v.y,18+46*epicOut(t),"#5fd4ff",.9*p);epicPoly(ctx,v.x,v.y,R,6,Math.PI/6+t*.4,2.2*p+.6,"#9fe6ff",.9*p);
    epicPoly(ctx,v.x,v.y,R*.55,6,Math.PI/6-t*.6,1.4,"#ffd27a",.8*p);epicRays(ctx,v.x,v.y,6,5,12+28*epicOut(t),.07,"#f4fbff",.65*p,t*1.2,43);ctx.restore();
  };
  CommonCombatRunner.prototype.drawEpicMotif_vanguardlance=function(ctx,e,m){
    // Vanguard Break: three cyan shield-fin panels lock across the aim line ahead of Ria while the muzzle charges, a white-gold
    // spear lance crosses to the target, then pierces through it with forward chevron shockwaves, a hexagonal shield ring,
    // gold rays and a burst of sparks and round embers.
    const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ang=Math.atan2(dy,dx),c=dx/D,s2=dy/D,nx=-s2,ny=c;
    const panels=since<0?1:epicClamp(1-since/.45);
    if(launch>0&&panels>0){const lead=Math.min(150,D*.35),px0=sx+c*lead,py0=sy+s2*lead;ctx.save();ctx.globalCompositeOperation="lighter";
      for(let i=-1;i<=1;i++){const q=epicSmooth(launch*1.8-(i+1)*.18),off=i*46*q,x=px0+nx*off-c*Math.abs(i)*16,y=py0+ny*off-s2*Math.abs(i)*16,al=q*panels;
        riaKite(ctx,x,y,ang,44*q,17*q,theme.a,.9*al,.16*al);riaKite(ctx,x,y,ang,26*q,9*q,theme.c,.7*al,0);epicGlowAt(ctx,x,y,22*q,theme.a,.45*al);}
      epicGlowAt(ctx,sx,sy,16+30*launch,theme.a,.8*launch*panels);epicGlowAt(ctx,sx,sy,8+10*launch,"#ffffff",.9*launch*panels);ctx.restore();}
    if(launch>0&&since<.22){const head=epicIn(launch),hx=sx+dx*head,hy=sy+dy*head,fade=since<0?1:epicClamp(1-since/.22);ctx.save();ctx.globalCompositeOperation="lighter";
      epicBeam(ctx,sx,sy,hx,hy,10,theme,fade);epicGlowAt(ctx,hx,hy,34,theme.a,fade);riaChevron(ctx,hx,hy,ang,30,14,theme.core,fade,3);riaChevron(ctx,hx-c*14,hy-s2*14,ang,22,12,theme.c,.8*fade,2);ctx.restore();}
    if(since>=0){const q=epicClamp(since/1.2),f=1-q,L=90+430*epicOut(since/.35),R=40+200*epicOut(since/.5);ctx.save();ctx.globalCompositeOperation="lighter";
      if(since<.5){const bf=1-since/.5;epicBeam(ctx,sx,sy,tx,ty,8*bf+2,theme,.85*bf);}
      epicGlowAt(ctx,tx,ty,80+120*epicOut(since/.3),theme.a,.95*f);
      epicGlowLine(ctx,tx-c*60,ty-s2*60,tx+c*L,ty+s2*L,20*f+4,theme.a,.75*f);epicGlowLine(ctx,tx-c*60,ty-s2*60,tx+c*L,ty+s2*L,6*f+1.5,theme.core,.95*f);
      for(let k=0;k<4;k++){const d=since*620-k*55;if(d<0)continue;const al=f*epicClamp(1-d/520),w=18+d*.16;riaChevron(ctx,tx+c*d,ty+s2*d,ang,20+d*.05,w,k%2?theme.c:theme.core,.9*al,3*al+1);}
      epicPoly(ctx,tx,ty,R,6,Math.PI/6+since*.5,3*f+.8,theme.a,.9*f);epicPoly(ctx,tx,ty,R*.6,6,Math.PI/6-since*.7,2,theme.c,.8*f);
      epicRing(ctx,tx,ty,R*1.12,R*.9,1.4,theme.b,.7*f);epicRays(ctx,tx,ty,10,10,60+160*epicOut(since/.3),.06,theme.c,.7*f,a*.3,53);
      epicGlowAt(ctx,tx,ty,34,"#ffffff",f);ctx.restore();
      if(!e.spawned.lance){e.spawned.lance=true;epicSpawn(state,tx,ty,26,{kind:"spark",speed:[300,900],angle:ang,spread:1.3,life:[.3,.7],size:[1.4,3],colors:["#f4fbff","#5fd4ff","#ffd27a"],grav:200,drag:.9});
        epicSpawn(state,tx,ty-20,16,{kind:"ember",speed:[80,320],life:[.6,1.3],size:[3,7],colors:["#5fd4ff","#ffd27a","#ffffff"],grav:-40,drag:.93});}}
  };
  // Bomin (R-02) fires thin amber rail needles from the muzzle brake of her long Vanguard rail rifle: a white-hot needle
  // core in an amber glow with a faint navy edge and small relay-beacon diamonds left in the wake; hits flash the amber
  // optic reticle (four tick arcs closing on the point) with short white rays.
  const bominDiamond=(ctx,x,y,ang,r,color,alpha,fill=0)=>{if(!(alpha>.004)||!(r>.3))return;const c=Math.cos(ang),s2=Math.sin(ang),nx=-s2,ny=c;
    ctx.beginPath();ctx.moveTo(x+c*r,y+s2*r);ctx.lineTo(x+nx*r*.62,y+ny*r*.62);ctx.lineTo(x-c*r,y-s2*r);ctx.lineTo(x-nx*r*.62,y-ny*r*.62);ctx.closePath();
    if(fill>0){ctx.globalAlpha=Math.min(1,fill);ctx.fillStyle=color;ctx.fill();}ctx.globalAlpha=Math.min(1,alpha);ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.lineJoin="round";ctx.stroke();};
  const bominReticle=(ctx,x,y,r,rot,width,color,alpha)=>{if(!(alpha>.004)||!(r>.5))return;
    for(let k=0;k<4;k++){const a0=rot+k*Math.PI/2+.28;epicRing(ctx,x,y,r,r,width,color,alpha,0,a0,a0+Math.PI/2-.56);
      const ca=Math.cos(rot+k*Math.PI/2),sa=Math.sin(rot+k*Math.PI/2);epicStroke(ctx,[[x+ca*r*.72,y+sa*r*.72],[x+ca*r*1.22,y+sa*r*1.22]],width,color,alpha);}};
  const drawAmberRail=(ctx,q)=>{
    const dx=q.x-q.px,dy=q.y-q.py,ang=Math.atan2(dy,dx),c=Math.cos(ang),s2=Math.sin(ang);
    ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowLine(ctx,q.px-dx*2.4,q.py-dy*2.4,q.x,q.y,6,"#ffb13b",.5);
    epicGlowLine(ctx,q.px-dx*1.6,q.py-dy*1.6,q.x,q.y,1.6,"#fff6e0",.95);
    epicGlowLine(ctx,q.px-dx*2.4,q.py-dy*2.4,q.x-c*10,q.y-s2*10,9,"#2a3a6e",.22,false);
    for(let k=1;k<=2;k++){const f=k/3;bominDiamond(ctx,q.px-dx*(f*2.2),q.py-dy*(f*2.2),ang,4.5-k,"#ffb13b",.75-k*.2,.2);}
    epicGlowAt(ctx,q.x,q.y,13,"#ffb13b",.85);epicGlowAt(ctx,q.x+c*3,q.y+s2*3,5,"#ffffff",1);ctx.restore();
  };
  const drawAmberRailImpact=(ctx,v)=>{
    const t=Math.min(1,(v.age||0)/.42),p=1-t,R=30-18*epicOut(t);ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowAt(ctx,v.x,v.y,14+34*epicOut(t),"#ffb13b",.9*p);bominReticle(ctx,v.x,v.y,R,t*.9,1.8,"#ffd58a",.9*p);
    epicRays(ctx,v.x,v.y,4,4,10+22*epicOut(t),.06,"#fff6e0",.7*p,Math.PI/4,61);epicGlowAt(ctx,v.x,v.y,6,"#ffffff",p);ctx.restore();
  };
  CommonCombatRunner.prototype.drawEpicMotif_amberline=function(ctx,e,m){
    // Amber Line: the amber optic reticle locks onto the target (closing tick arcs, rotating a quarter turn) while relay
    // beacons (small amber diamonds) light up along the firing line; a white-amber rail shot crosses in one frame, pierces
    // through the target and leaves an orange sash-ribbon wake along the line, expanding reticle rings, rays and a burst
    // of sparks and round embers.
    const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ang=Math.atan2(dy,dx),c=dx/D,s2=dy/D,nx=-s2,ny=c;
    const lockFade=since<0?1:epicClamp(1-since/.35);
    if(launch>0&&lockFade>0){const q=epicSmooth(launch),r=150-104*q;ctx.save();ctx.globalCompositeOperation="lighter";
      bominReticle(ctx,tx,ty,r,(1-q)*Math.PI/2,2.4,theme.a,.9*q*lockFade);epicRing(ctx,tx,ty,r*.42,r*.42,1.2,theme.core,.6*q*lockFade);
      epicGlowAt(ctx,tx,ty,10+16*q,theme.a,.7*q*lockFade);
      for(let i=1;i<=5;i++){const f=i/6,on=epicSmooth(launch*1.6-f*.9),x=sx+dx*f,y=sy+dy*f;bominDiamond(ctx,x,y,ang,7*on,theme.a,.85*on*lockFade,.25*on*lockFade);epicGlowAt(ctx,x,y,12*on,theme.a,.35*on*lockFade);}
      epicGlowAt(ctx,sx,sy,12+22*launch,theme.a,.8*launch*lockFade);epicGlowAt(ctx,sx,sy,6+8*launch,"#ffffff",.9*launch*lockFade);ctx.restore();}
    if(since>=0){const q=epicClamp(since/1.2),f=1-q,L=80+460*epicOut(since/.3),R=36+190*epicOut(since/.5);ctx.save();ctx.globalCompositeOperation="lighter";
      if(since<.42){const bf=1-since/.42;epicBeam(ctx,sx,sy,tx,ty,7*bf+1.5,theme,.9*bf);epicGlowLine(ctx,sx,sy,tx,ty,1.6,"#ffffff",bf);}
      epicGlowAt(ctx,tx,ty,70+110*epicOut(since/.3),theme.a,.95*f);
      epicGlowLine(ctx,tx-c*40,ty-s2*40,tx+c*L,ty+s2*L,14*f+3,theme.a,.75*f);epicGlowLine(ctx,tx-c*40,ty-s2*40,tx+c*L,ty+s2*L,4*f+1.2,theme.core,.95*f);
      // orange sash-ribbon wake: two phase-shifted sine ribbons along the firing line, travelling toward the target
      const rib=epicClamp(1-since/.9);if(rib>0){for(const k of [0,1]){const pts=[];for(let i=0;i<=28;i++){const u=i/28,w=Math.sin(u*Math.PI*3-since*14+k*Math.PI)*(10+18*u)*rib*Math.sin(u*Math.PI);
          pts.push([sx+dx*u+nx*w,sy+dy*u+ny*w]);}epicStroke(ctx,pts,3.2*rib+1,k?theme.c:theme.a,.75*rib);}}
      bominReticle(ctx,tx,ty,R,since*.8,3*f+.8,theme.a,.9*f);epicRing(ctx,tx,ty,R*.62,R*.62,1.6,theme.core,.75*f);
      epicRing(ctx,tx,ty,R*1.15,R*.95,1.2,theme.b,.6*f);epicRays(ctx,tx,ty,8,10,54+150*epicOut(since/.3),.05,theme.c,.7*f,a*.3+Math.PI/8,67);
      epicGlowAt(ctx,tx,ty,30,"#ffffff",f);ctx.restore();
      if(!e.spawned.rail){e.spawned.rail=true;epicSpawn(state,tx,ty,24,{kind:"spark",speed:[320,960],angle:ang,spread:1.1,life:[.3,.7],size:[1.3,2.8],colors:["#fff6e0","#ffb13b","#ff7a1a"],grav:200,drag:.9});
        epicSpawn(state,tx,ty-16,14,{kind:"ember",speed:[80,300],life:[.6,1.3],size:[3,6.5],colors:["#ffb13b","#ff7a1a","#fff6e0"],grav:-40,drag:.93});}}
  };
  // Bomin VFX v2 (tools/vfx_patches/bomin_runtime_vfx_v2.py): heavy shots get a wider orange sheath under the amber rail;
  // her muzzle fires an amber rail discharge from the muzzle brake instead of the shared cyan glow.
  const drawAmberRailV2=(ctx,q)=>{
    if(q.heavy){const dx=q.x-q.px,dy=q.y-q.py;ctx.save();ctx.globalCompositeOperation="lighter";
      epicGlowLine(ctx,q.px-dx*3.4,q.py-dy*3.4,q.x,q.y,14,"#ff7a1a",.32);epicGlowAt(ctx,q.x,q.y,24,"#ffb13b",.55);ctx.restore();}
    drawAmberRail(ctx,q);
  };
  CommonCombatRunner.prototype.drawBominMuzzle=function(ctx,player){
    if(!epicEnabled)return false;
    const m=player.muzzle,t=epicClamp(1-(player.muzzleFlashClock||0)/.11),p=1-t,ang=Number.isFinite(m.angle)?m.angle:-Math.PI/2,
      c=Math.cos(ang),s2=Math.sin(ang),nx=-s2,ny=c,g=Math.max(.7,Math.min(1.6,playerBodyPx(player)/95)),L=(24+20*epicOut(t))*g;
    ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowAt(ctx,m.x,m.y,(15+11*t)*g,"#ffb13b",.9*p);
    epicGlowLine(ctx,m.x,m.y,m.x+c*L,m.y+s2*L,(5*p+1.2)*g,"#ffb13b",.85*p);
    epicGlowLine(ctx,m.x,m.y,m.x+c*L*.78,m.y+s2*L*.78,1.7*g,"#fff6e0",p);
    const bx=m.x-c*5*g,by=m.y-s2*5*g,vl=(10+10*epicOut(t))*g;
    for(const side of [-1,1]){const vx=-c*.3+nx*side,vy=-s2*.3+ny*side;epicGlowLine(ctx,bx,by,bx+vx*vl,by+vy*vl,(3.2*p+1)*g,"#ff8a1f",.95*p);}
    bominReticle(ctx,m.x,m.y,(5+11*epicOut(t))*g,ang+Math.PI/4,1.6,"#ffa526",.9*p);
    epicGlowAt(ctx,m.x,m.y,6*g,"#ffffff",p);ctx.restore();return true;
  };
  // Character muzzle discharges + Karin/Serin rounds (tools/vfx_patches/character_muzzle_vfx_v1.py).
  const MUZZLE_STYLES={
    karin:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(30+30*epicOut(t))*g;
      epicGlowAt(ctx,m.x,m.y,(22+16*t)*g,"#ff3a4a",.85*p);epicGlowLine(ctx,m.x,m.y,m.x+c*L,m.y+s2*L,(8*p+2)*g,"#ff9a3c",.9*p);
      for(const k of [-1,1]){const a=ang+k*.42,l=L*.62;epicGlowLine(ctx,m.x,m.y,m.x+Math.cos(a)*l,m.y+Math.sin(a)*l,(5*p+1.4)*g,"#ff3a4a",.85*p);
        const bx=m.x-c*6*g,by=m.y-s2*6*g,vl=(12+12*epicOut(t))*g;epicGlowLine(ctx,bx,by,bx+nx*k*vl,by+ny*k*vl,(3.4*p+1)*g,"#e8c07a",.8*p);}
      epicRing(ctx,m.x+c*10*g,m.y+s2*10*g,(10+26*epicOut(t))*g,(8+20*epicOut(t))*g,(2.6*p+.5)*g,"#b8864f",.55*p,ang);
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.7,m.y+s2*L*.7,2*g,"#fff0e6",p);epicGlowAt(ctx,m.x,m.y,9*g,"#ffffff",p);},
    serin:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(22+20*epicOut(t))*g;
      epicGlowAt(ctx,m.x,m.y,(14+10*t)*g,"#6a3dd6",.8*p);
      for(const k of [-1,1]){const ox=nx*k*3.2*g,oy=ny*k*3.2*g;epicGlowLine(ctx,m.x+ox,m.y+oy,m.x+ox+c*L,m.y+oy+s2*L,(2.6*p+.8)*g,"#b77dff",.95*p);
        epicGlowLine(ctx,m.x+ox,m.y+oy,m.x+ox+c*L*.8,m.y+oy+s2*L*.8,1.1*g,"#fbf6ff",p);}
      epicPoly(ctx,m.x,m.y,(6+10*epicOut(t))*g,3,ang+t*2.4,1.5,"#f0d8ff",.9*p);epicGlowAt(ctx,m.x,m.y,5*g,"#ffffff",p);},
    arin:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(20+16*epicOut(t))*g;
      epicGlowAt(ctx,m.x,m.y,(16+12*t)*g,"#e0a94a",.85*p);riaKite(ctx,m.x+c*L*.45,m.y+s2*L*.45,ang,L,(7*p+3)*g,"#f3e6c8",.95*p,.25*p);
      epicRing(ctx,m.x,m.y,(7+12*epicOut(t))*g,(7+12*epicOut(t))*g,1.6,"#b8243a",.85*p,ang,0,Math.PI*2*Math.min(1,.3+t*1.4));
      epicGlowAt(ctx,m.x,m.y,6*g,"#ffffff",p);},
    jaein:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const R=(6+11*epicOut(t))*g;
      epicGlowAt(ctx,m.x,m.y,(15+10*t)*g,"#2fe08a",.85*p);epicPoly(ctx,m.x,m.y,R,6,ang+t,1.6,"#2fe08a",.9*p);
      for(let k=0;k<3;k++){const a=ang+k*Math.PI*2/3,l=(10+16*epicOut(t))*g;epicGlowLine(ctx,m.x,m.y,m.x+Math.cos(a)*l,m.y+Math.sin(a)*l,(2.4*p+.8)*g,k?"#f0d9a8":"#eafff4",.9*p);}
      epicGlowAt(ctx,m.x,m.y,5*g,"#ffffff",p);},
    roa:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(26+22*epicOut(t))*g;
      epicGlowAt(ctx,m.x,m.y,(16+10*t)*g,"#ff7a1a",.8*p);
      for(let k=0;k<3;k++){const d=(4+k*7)*g*(1-.3*t),x=m.x-c*d,y=m.y-s2*d,r=(6+3*k)*g*(1+.4*t);epicRing(ctx,x,y,r*.35,r,(2.2*p+.6)*g,k===1?"#ffb45a":"#ff7a1a",.9*p,ang);}
      epicGlowLine(ctx,m.x,m.y,m.x+c*L,m.y+s2*L,(4*p+1.2)*g,"#3fe6e0",.9*p);epicGlowLine(ctx,m.x,m.y,m.x+c*L*.75,m.y+s2*L*.75,1.5*g,"#f2ffff",p);
      epicGlowAt(ctx,m.x,m.y,6*g,"#ffffff",p);},
    noella:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(26+18*epicOut(t))*g,w=(12+8*epicOut(t))*g;
      epicGlowAt(ctx,m.x,m.y,(18+12*t)*g,"#f2c14e",.8*p);epicGlowLine(ctx,m.x-c*w*.5,m.y-s2*w*.5,m.x+c*L,m.y+s2*L,(3.2*p+1)*g,"#f2c14e",.9*p);
      epicGlowLine(ctx,m.x+c*6*g-nx*w,m.y+s2*6*g-ny*w,m.x+c*6*g+nx*w,m.y+s2*6*g+ny*w,(3*p+1)*g,"#f2c14e",.9*p);
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.7,m.y+s2*L*.7,1.4*g,"#fffaf0",p);epicRing(ctx,m.x+c*6*g,m.y+s2*6*g,w*.8,w*.8,1.2,"#fff1c9",.7*p);epicGlowAt(ctx,m.x,m.y,6*g,"#ffffff",p);},
    ria:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(18+14*epicOut(t))*g;
      epicGlowAt(ctx,m.x,m.y,(16+10*t)*g,"#5fd4ff",.85*p);riaChevron(ctx,m.x+c*L*.6,m.y+s2*L*.6,ang,L,(8+6*epicOut(t))*g,"#f4fbff",.95*p,2.4);
      for(const k of [-1,1]){const ox=nx*k*6*g,oy=ny*k*6*g;epicGlowLine(ctx,m.x+ox-c*4*g,m.y+oy-s2*4*g,m.x+ox+c*L*.8,m.y+oy+s2*L*.8,(2*p+.6)*g,"#ffd27a",.85*p);}
      epicGlowAt(ctx,m.x,m.y,6*g,"#ffffff",p);},
    // Luna/Naru/Astra/Tessa (tools/vfx_patches/character_muzzle_vfx_v2.py)
    luna:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(22+18*epicOut(t))*g;
      epicGlowAt(ctx,m.x,m.y,(16+10*t)*g,"#3fe6e0",.85*p);epicPoly(ctx,m.x,m.y,(7+9*epicOut(t))*g,6,ang+t*6,1.8,"#3fe6e0",.9*p);
      for(const k of [-1,0,1]){const ox=nx*k*4.5*g,oy=ny*k*4.5*g,l=L*(k?.7:1);epicGlowLine(ctx,m.x+ox,m.y+oy,m.x+ox+c*l,m.y+oy+s2*l,(2.4*p+.8)*g,k?"#e6d3a6":"#eefbff",.9*p);}
      epicGlowAt(ctx,m.x,m.y,6*g,"#ffffff",p);},
    naru:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const R=(6+12*epicOut(t))*g,L=(24+18*epicOut(t))*g;
      epicGlowAt(ctx,m.x,m.y,(16+12*t)*g,"#2fd3cb",.75*p);
      for(let k=0;k<6;k++){const a=ang+k*Math.PI/3+t*.6;epicGlowLine(ctx,m.x,m.y,m.x+Math.cos(a)*R,m.y+Math.sin(a)*R,(1.8*p+.6)*g,"#9ffcff",.9*p);}
      epicGlowLine(ctx,m.x,m.y,m.x+c*L,m.y+s2*L,1.2*g,"#f7f2dc",.95*p);epicRing(ctx,m.x,m.y,R*1.2,R*1.2,1.1,"#c9ffff",.6*p);epicGlowAt(ctx,m.x,m.y,5*g,"#ffffff",p);},
    astra:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(20+18*epicOut(t))*g,w=(8+8*epicOut(t))*g;
      epicGlowAt(ctx,m.x,m.y,(16+12*t)*g,"#4d7dff",.85*p);epicGlowLine(ctx,m.x-c*L*.35,m.y-s2*L*.35,m.x+c*L,m.y+s2*L,(2.6*p+.8)*g,"#cfdcff",.95*p);
      epicGlowLine(ctx,m.x-nx*w,m.y-ny*w,m.x+nx*w,m.y+ny*w,(2*p+.6)*g,"#cfdcff",.9*p);epicRing(ctx,m.x,m.y,w*1.1,w*1.1,1.2,"#4d7dff",.7*p,ang);
      epicGlowAt(ctx,m.x,m.y,6*g,"#f4f8ff",p);},
    tessa:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(26+20*epicOut(t))*g,R=(10+12*epicOut(t))*g;
      epicGlowAt(ctx,m.x,m.y,(20+14*t)*g,"#ff45b5",.85*p);epicGlowLine(ctx,m.x,m.y,m.x+c*L,m.y+s2*L,(6*p+1.6)*g,"#ff45b5",.9*p);
      epicRing(ctx,m.x+c*8*g,m.y+s2*8*g,R,R,(2.6*p+.6)*g,"#41e8e0",.85*p,ang,-1.1,1.1);
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.7,m.y+s2*L*.7,1.8*g,"#fff0fa",p);epicGlowAt(ctx,m.x,m.y,8*g,"#ffffff",p);},
    // Yunseo (tools/vfx_patches/yunseo_runtime_vfx.py): the lens hub flares cobalt inside an upright seal triangle that
    // turns a little as it opens, amber sparks sit on its three corners, a short white shot line leaves along the aim.
    yunseo:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(22+18*epicOut(t))*g,R=(7+11*epicOut(t))*g,rot=-Math.PI/2+t*.8;
      epicGlowAt(ctx,m.x,m.y,(18+12*t)*g,"#3d6bff",.85*p);epicPoly(ctx,m.x,m.y,R,3,rot,1.8,"#9db8ff",.9*p,.12*p);
      epicGlowLine(ctx,m.x,m.y,m.x+c*L,m.y+s2*L,(3*p+1)*g,"#f4f7ff",.95*p);
      for(let k=0;k<3;k++){const a=rot+k*Math.PI*2/3;epicGlowAt(ctx,m.x+Math.cos(a)*R,m.y+Math.sin(a)*R,3.4*g,"#ffb347",.9*p);}
      epicGlowAt(ctx,m.x,m.y,6*g,"#ffffff",p);},
    // Orin (tools/vfx_patches/orin_runtime_vfx.py): the twin needle muzzles spit two parallel wine-red jets with ivory cores
    // and brass sparks leave the two tips (no frame at the muzzle: the evidence brackets belong to the target).
    orin:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(26+20*epicOut(t))*g,o=3.2*g;
      epicGlowAt(ctx,m.x,m.y,(16+10*t)*g,"#d0304f",.85*p);
      for(const k of [-1,1]){const x=m.x+nx*o*k,y=m.y+ny*o*k;epicGlowLine(ctx,x,y,x+c*L,y+s2*L,(3.2*p+1)*g,"#d0304f",.8*p);epicGlowLine(ctx,x,y,x+c*L*.8,y+s2*L*.8,1.3*g,"#fff4e2",.95*p);epicGlowAt(ctx,x+c*L*.8,y+s2*L*.8,2.6*g,"#e3b457",.9*p);}
      epicGlowAt(ctx,m.x,m.y,6*g,"#ffffff",p);},
    // Yura (tools/vfx_patches/yura_runtime_vfx.py): a sand-white arc jumps between the two emitter prongs over the copper
    // coil and a moss-green pulse jet leaves the coil; copper sparks sit on both prong tips.
    yura:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(24+18*epicOut(t))*g,o=4.4*g,j=2.2*g*p;
      ctx.save();ctx.globalCompositeOperation="source-over";epicGlowAt(ctx,m.x,m.y,(14+8*t)*g,"#6fbf2f",.55*p,false);epicGlowLine(ctx,m.x,m.y,m.x+c*L*.9,m.y+s2*L*.9,(3*p+1)*g,"#6fbf2f",.55*p,false);ctx.restore();
      epicGlowAt(ctx,m.x,m.y,(16+10*t)*g,"#7fd13f",.6*p,false);
      epicGlowLine(ctx,m.x,m.y,m.x+c*L,m.y+s2*L,(3.4*p+1)*g,"#7fd13f",.85*p,false);epicGlowLine(ctx,m.x,m.y,m.x+c*L*.8,m.y+s2*L*.8,1.4*g,"#f6efd9",.95*p);
      const arc=[];for(let i=0;i<=4;i++){const f=i/4*2-1,z=(i%2?1:-1)*(i%4?j:0);arc.push([m.x+nx*o*f+c*z,m.y+ny*o*f+s2*z]);}
      epicStroke(ctx,arc,1.3*g,"#f6efd9",.95*p);
      for(const k of [-1,1])epicGlowAt(ctx,m.x+nx*o*k,m.y+ny*o*k,2.6*g,"#e0873a",.9*p);
      epicGlowAt(ctx,m.x,m.y,6*g,"#ffffff",p);},
    // Narae (tools/vfx_patches/narae_runtime_vfx.py): the ported muzzle brake vents three pairs of hazard-yellow side jets
    // behind the muzzle, two copper coil rings flash on the barrel and a short white-hot slug flash leaves the bore.
    narae:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(26+22*epicOut(t))*g,J=(9+13*epicOut(t))*g;
      ctx.save();ctx.globalCompositeOperation="source-over";
      for(const b of [2.5,6,9.5]){const bx=m.x-c*b*g,by=m.y-s2*b*g;for(const k of [-1,1])epicGlowLine(ctx,bx,by,bx+nx*J*k-c*2*g,by+ny*J*k-s2*2*g,(2.2*p+.8)*g,"#ffc21a",.8*p,false);}
      for(const b of [13,18])epicRing(ctx,m.x-c*b*g,m.y-s2*b*g,5.2*g,2.2*g,1.5*g,"#d9703a",.95*p,ang+Math.PI/2);
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.85,m.y+s2*L*.85,(3.6*p+1)*g,"#ffc21a",.7*p,false);ctx.restore();
      epicGlowLine(ctx,m.x,m.y,m.x+c*L,m.y+s2*L,1.8*g,"#fff3d6",.95*p);
      epicGlowAt(ctx,m.x,m.y,(12+8*t)*g,"#fff3d6",.55*p);epicGlowAt(ctx,m.x,m.y,6*g,"#ffffff",p);},
    // Yeonhwa (tools/vfx_patches/yeonhwa_runtime_vfx.py): the fan face throws a half circle of seven gold rays toward the aim,
    // a gold arc over their tips and two short parallel aubergine channel dashes along the aim line.
    yeonhwa:(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const R=(16+20*epicOut(t))*g,L=(22+20*epicOut(t))*g;
      ctx.save();ctx.globalCompositeOperation="source-over";
      for(let i=0;i<7;i++){const a=ang+(i/6-.5)*Math.PI*.9,r0=4*g;epicStroke(ctx,[[m.x+Math.cos(a)*r0,m.y+Math.sin(a)*r0],[m.x+Math.cos(a)*R,m.y+Math.sin(a)*R]],(2.2*p+.6)*g,i%2?"#fff6e2":"#e8b64c",.9*p);}
      epicRing(ctx,m.x,m.y,R*1.08,R*1.08,(1.8*p+.5)*g,"#e8b64c",.85*p,0,ang-Math.PI*.47,ang+Math.PI*.47);
      for(const k of [-1,1])epicStroke(ctx,[[m.x+nx*k*5*g+c*R*.6,m.y+ny*k*5*g+s2*R*.6],[m.x+nx*k*5*g+c*(R*.6+L),m.y+ny*k*5*g+s2*(R*.6+L)]],(1.8*p+.5)*g,"#8a3f7a",.9*p);
      ctx.restore();
      epicGlowAt(ctx,m.x+c*4*g,m.y+s2*4*g,(12+10*t)*g,"#fff6e2",.55*p);epicGlowAt(ctx,m.x,m.y,6*g,"#ffffff",p);}
  };
  CommonCombatRunner.prototype.drawCharacterMuzzle=function(ctx,player){
    const id=player.spec?.id;if(id==="bomin")return !!this.drawBominMuzzle?.(ctx,player);
    const style=MUZZLE_STYLES[id];if(!epicEnabled||!style)return false;
    const m=player.muzzle,t=epicClamp(1-(player.muzzleFlashClock||0)/.11),p=1-t,ang=Number.isFinite(m.angle)?m.angle:-Math.PI/2,
      c=Math.cos(ang),s2=Math.sin(ang),g=Math.max(.7,Math.min(1.6,playerBodyPx(player)/95));
    ctx.save();ctx.globalCompositeOperation="lighter";style(ctx,m,t,p,g,c,s2,-s2,c,ang);ctx.restore();return true;
  };
  const drawFoundryRound=(ctx,q)=>{
    const dx=q.x-q.px,dy=q.y-q.py,h=q.heavy?1.45:1;ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowLine(ctx,q.px-dx*2.8,q.py-dy*2.8,q.x,q.y,13*h,"#b8864f",.34);epicGlowLine(ctx,q.px-dx*2.2,q.py-dy*2.2,q.x,q.y,6*h,"#ff3a4a",.85);
    epicGlowLine(ctx,q.px-dx*1.2,q.py-dy*1.2,q.x,q.y,2.2*h,"#fff0e6",.95);epicGlowAt(ctx,q.x,q.y,20*h,"#ff9a3c",.8);epicGlowAt(ctx,q.x,q.y,7*h,"#ffffff",1);ctx.restore();
  };
  const drawFoundryImpact=(ctx,v)=>{
    const t=Math.min(1,(v.age||0)/.55),p=1-t,R=12+62*epicOut(t);ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowAt(ctx,v.x,v.y,22+58*epicOut(t),"#ff3a4a",.9*p);epicGlowAt(ctx,v.x,v.y,12+26*epicOut(t),"#ff9a3c",.95*p);
    epicRing(ctx,v.x,v.y,R,R*.8,3.2*p+.6,"#e8c07a",.85*p);epicRays(ctx,v.x,v.y,9,6,16+40*epicOut(t),.08,"#fff0e6",.7*p,t,31);
    epicGlowAt(ctx,v.x,v.y,10*p,"#ffffff",p);ctx.restore();
  };
  const drawSealThread=(ctx,q)=>{
    const dx=q.x-q.px,dy=q.y-q.py,ang=Math.atan2(dy,dx),c=Math.cos(ang),s2=Math.sin(ang),nx=-s2,ny=c,h=q.heavy?1.4:1;ctx.save();ctx.globalCompositeOperation="lighter";
    const tx=q.px-dx*2.4,ty=q.py-dy*2.4;
    for(const k of [-1,1]){const ox=nx*k*3.6*h,oy=ny*k*3.6*h;epicGlowLine(ctx,q.px-dx*1.6+ox,q.py-dy*1.6+oy,q.x+ox,q.y+oy,4.5*h,"#b77dff",.6);epicGlowLine(ctx,q.px-dx*1.1+ox,q.py-dy*1.1+oy,q.x+ox,q.y+oy,1.4*h,"#fbf6ff",.95);
      epicStroke(ctx,[[tx,ty],[q.px-dx*1.6+ox,q.py-dy*1.6+oy]],1,"#6a3dd6",.7);}
    epicPoly(ctx,q.x,q.y,6*h,3,ang,1.3,"#f0d8ff",.9);epicGlowAt(ctx,q.x,q.y,11*h,"#b77dff",.8);ctx.restore();
  };
  const drawSealImpact=(ctx,v)=>{
    const t=Math.min(1,(v.age||0)/.45),p=1-t,R=8+36*epicOut(t);ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowAt(ctx,v.x,v.y,14+34*epicOut(t),"#b77dff",.85*p);epicPoly(ctx,v.x,v.y,R,3,-Math.PI/2+t*1.6,2.2*p+.6,"#f0d8ff",.9*p);
    epicPoly(ctx,v.x,v.y,R*.55,3,Math.PI/2-t*2,1.4,"#b77dff",.85*p);epicRays(ctx,v.x,v.y,6,4,10+22*epicOut(t),.06,"#fbf6ff",.6*p,t,17);ctx.restore();
  };
  // Yunseo (R-10) fires small triangular seal glyphs from the lens hub of her seal projector: a white-hot core inside a cobalt
  // glow, an amber triangle outline pointing along the flight, and two amber annotation ticks left in the wake. Hits stamp an
  // upright cobalt seal triangle that snaps into place, an inverted white inner triangle and short amber rays from its corners.
  const yunseoTri=(ctx,x,y,r,rot,width,color,alpha,fill=0)=>epicPoly(ctx,x,y,r,3,rot,width,color,alpha,fill);
  const yunseoCheck=(ctx,x,y,sz,width,color,alpha)=>epicStroke(ctx,[[x-.5*sz,y-.02*sz],[x-.1*sz,y+.38*sz],[x+.6*sz,y-.5*sz]],width,color,alpha);
  const drawSealGlyph=(ctx,q)=>{
    const dx=q.x-q.px,dy=q.y-q.py,ang=Math.atan2(dy,dx),len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len,h=q.heavy?1.4:1;
    ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowLine(ctx,q.px-dx*2.4,q.py-dy*2.4,q.x,q.y,6*h,"#3d6bff",.55);
    epicGlowLine(ctx,q.px-dx*1.6,q.py-dy*1.6,q.x,q.y,1.6*h,"#f4f7ff",.95);
    for(let k=1;k<=2;k++){const f=k/3,x=q.px-dx*(f*2.2),y=q.py-dy*(f*2.2),l=(5-k)*h;epicGlowLine(ctx,x-nx*l,y-ny*l,x+nx*l,y+ny*l,1.4,"#ffb347",.75-k*.2);}
    epicGlowAt(ctx,q.x,q.y,13*h,"#3d6bff",.85);yunseoTri(ctx,q.x,q.y,6*h,ang,1.6,"#ffd89a",.95,.3);
    epicGlowAt(ctx,q.x,q.y,4.5*h,"#ffffff",1);ctx.restore();
  };
  const drawSealGlyphImpact=(ctx,v)=>{
    const t=Math.min(1,(v.age||0)/.44),p=1-t,snap=epicOut(Math.min(1,t*2.4)),R=30-12*snap,rot=-Math.PI/2+(1-snap)*.7;
    ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowAt(ctx,v.x,v.y,14+30*epicOut(t),"#3d6bff",.85*p);yunseoTri(ctx,v.x,v.y,R,rot,2.2,"#8fb0ff",.95*p,.12*p);
    yunseoTri(ctx,v.x,v.y,R*.48,rot+Math.PI,1.4,"#f4f7ff",.85*p);
    for(let k=0;k<3;k++){const a=rot+k*Math.PI*2/3,ca=Math.cos(a),sa=Math.sin(a),o=10+16*epicOut(t);epicGlowLine(ctx,v.x+ca*R,v.y+sa*R,v.x+ca*(R+o),v.y+sa*(R+o),2.2*p+.6,"#ffb347",.85*p);}
    epicGlowAt(ctx,v.x,v.y,6,"#ffffff",p);ctx.restore();
  };
  CommonCombatRunner.prototype.drawEpicMotif_crossverify=function(ctx,e,m){
    // Cross Verification Lines: three cobalt verification lines grow from the corners of a large triangle around the target
    // toward it while amber check marks tick on along each line and a faint triangle closes between the corners; the lens hub
    // charges. On the hit a white-cobalt shot crosses from the projector, the three lines flash white and collapse, a white-amber
    // seal triangle stamps the target (rotating into place), two triangle shock rings expand, amber rays and sparks/embers burst.
    const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ang=Math.atan2(dy,dx);
    const lockFade=since<0?1:epicClamp(1-since/.35),spin=(launch||0)*.5;
    const corner=(k,r)=>{const t=-Math.PI/2+spin+k*Math.PI*2/3;return [tx+Math.cos(t)*r,ty+Math.sin(t)*r];};
    if(launch>0&&lockFade>0){const q=epicSmooth(launch),r0=200-40*q;ctx.save();ctx.globalCompositeOperation="lighter";
      const vs=[0,1,2].map(k=>corner(k,r0));
      epicStroke(ctx,[...vs,vs[0]],1.4,theme.b,.55*q*lockFade);
      for(let k=0;k<3;k++){const on=epicSmooth(launch*1.5-k*.18),[vx,vy]=vs[k],ex=vx+(tx-vx)*on,ey=vy+(ty-vy)*on;
        epicGlowLine(ctx,vx,vy,ex,ey,5*on+1,theme.a,.6*on*lockFade);epicGlowLine(ctx,vx,vy,ex,ey,1.4,theme.core,.9*on*lockFade);
        epicGlowAt(ctx,vx,vy,10+8*on,theme.a,.7*on*lockFade);
        for(const f of [.3,.55,.8]){const tick=epicSmooth((on-f)*6);if(tick>0){const cx=vx+(tx-vx)*f,cy=vy+(ty-vy)*f;yunseoCheck(ctx,cx,cy-9,9*tick,2,theme.c,.9*tick*lockFade);}}}
      yunseoTri(ctx,tx,ty,40-14*q,-Math.PI/2+spin,1.6,theme.core,.7*q*lockFade);epicGlowAt(ctx,tx,ty,10+14*q,theme.a,.6*q*lockFade);
      epicGlowAt(ctx,sx,sy,12+22*launch,theme.a,.8*launch*lockFade);yunseoTri(ctx,sx,sy,8+10*launch,-Math.PI/2+spin*2,1.6,theme.c,.8*launch*lockFade);
      epicGlowAt(ctx,sx,sy,6+8*launch,"#ffffff",.9*launch*lockFade);ctx.restore();}
    if(since>=0){const q=epicClamp(since/1.2),f=1-q,snap=epicOut(since/.22),R=150-90*snap,rot=-Math.PI/2+.5+(1-snap)*.9;ctx.save();ctx.globalCompositeOperation="lighter";
      if(since<.42){const bf=1-since/.42;epicBeam(ctx,sx,sy,tx,ty,7*bf+1.5,theme,.9*bf);epicGlowLine(ctx,sx,sy,tx,ty,1.6,"#ffffff",bf);}
      const col=epicClamp(1-since/.3);if(col>0){for(let k=0;k<3;k++){const [vx,vy]=corner(k,160*(1-epicOut(since/.3)));epicGlowLine(ctx,vx,vy,tx,ty,6*col+1,"#ffffff",.85*col);}}
      epicGlowAt(ctx,tx,ty,70+110*epicOut(since/.3),theme.a,.95*f);
      yunseoTri(ctx,tx,ty,R,rot,4*f+1.2,theme.core,.95*f,.14*f);yunseoTri(ctx,tx,ty,R*.5,rot+Math.PI,2.4*f+.8,theme.c,.9*f);
      for(const [d0,w] of [[0,3],[.12,2]]){const u=epicOut(Math.max(0,since-d0)/.6),rr=60+220*u;yunseoTri(ctx,tx,ty,rr,rot,w*(1-u)+.6,theme.a,.8*(1-u)*f);}
      epicRays(ctx,tx,ty,9,12,54+150*epicOut(since/.3),.05,theme.c,.7*f,a*.3+Math.PI/9,71);
      epicGlowAt(ctx,tx,ty,30,"#ffffff",f);ctx.restore();
      if(!e.spawned.seal){e.spawned.seal=true;epicSpawn(state,tx,ty,24,{kind:"spark",speed:[300,920],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.3,2.8],colors:["#f4f7ff","#3d6bff","#ffb347"],grav:200,drag:.9});
        epicSpawn(state,tx,ty-16,14,{kind:"ember",speed:[80,300],life:[.6,1.3],size:[3,6.5],colors:["#3d6bff","#ffb347","#f4f7ff"],grav:-40,drag:.93});}}
  };
  // Orin (SSR-03) fires paired adjudicator needles: two thin parallel wine-red streaks with ivory cores and brass tips, and
  // short brass tick marks left in the wake. A hit pins the target with the two needles crossing into an X, a brass evidence
  // frame with corner brackets snaps shut around it and a small wine seal lights inside ("only the lit seal is executed").
  const orinRect=(w,h,rot)=>{const c=Math.cos(rot),s=Math.sin(rot);return [[-w,-h],[w,-h],[w,h],[-w,h]].map(([x,y])=>[x*c-y*s,x*s+y*c]);};
  const orinFrame=(ctx,x,y,w,h,rot,width,color,alpha)=>{const v=orinRect(w,h,rot).map(([a,b])=>[x+a,y+b]);epicStroke(ctx,[...v,v[0]],width,color,alpha);};
  // brass frames/brackets are drawn source-over: additive blending washes brass to white over the blue stage
  const orinSolid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};
  function orinBrackets(ctx,x,y,w,h,rot,len,width,color,alpha){const v=orinRect(w,h,rot).map(([a,b])=>[x+a,y+b]);
    for(let k=0;k<4;k++){const [cx,cy]=v[k],[px,py]=v[(k+3)%4],[qx,qy]=v[(k+1)%4],dp=Math.hypot(px-cx,py-cy)||1,dq=Math.hypot(qx-cx,qy-cy)||1,lp=Math.min(len,dp*.45),lq=Math.min(len,dq*.45);
      epicStroke(ctx,[[cx+(px-cx)/dp*lp,cy+(py-cy)/dp*lp],[cx,cy],[cx+(qx-cx)/dq*lq,cy+(qy-cy)/dq*lq]],width,color,alpha);}}
  const drawTwinNeedle=(ctx,q)=>{
    const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len,h=q.heavy?1.4:1,o=3.4*h;
    ctx.save();ctx.globalCompositeOperation="lighter";
    for(const k of [-1,1]){const ox=nx*o*k,oy=ny*o*k;
      epicGlowLine(ctx,q.px-dx*2.6+ox,q.py-dy*2.6+oy,q.x+ox,q.y+oy,4.2*h,"#d0304f",.6);
      epicGlowLine(ctx,q.px-dx*1.5+ox,q.py-dy*1.5+oy,q.x+ox,q.y+oy,1.2*h,"#fff4e2",.95);
      epicGlowAt(ctx,q.x+ox,q.y+oy,3.2*h,"#e3b457",.95);}
    for(let k=1;k<=2;k++){const f=k/3,x=q.px-dx*(f*2.3),y=q.py-dy*(f*2.3),l=(6-k)*h;epicGlowLine(ctx,x-nx*l,y-ny*l,x+nx*l,y+ny*l,1.2,"#e3b457",.7-k*.2);}
    epicGlowAt(ctx,q.x,q.y,11*h,"#d0304f",.7);epicGlowAt(ctx,q.x,q.y,3.6*h,"#ffffff",.9);ctx.restore();
  };
  const drawEvidenceTagImpact=(ctx,v)=>{
    const t=Math.min(1,(v.age||0)/.46),p=1-t,snap=epicOut(Math.min(1,t*2.6)),W=26-9*snap,H=W*.72,rot=(1-snap)*.5,X=10+6*snap;
    ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowAt(ctx,v.x,v.y,14+28*epicOut(t),"#d0304f",.85*p);
    epicGlowLine(ctx,v.x-X,v.y-X,v.x+X,v.y+X,2.4*p+.6,"#fff4e2",.9*p);epicGlowLine(ctx,v.x-X,v.y+X,v.x+X,v.y-X,2.4*p+.6,"#fff4e2",.9*p);
    orinSolid(ctx,()=>{orinBrackets(ctx,v.x,v.y,W,H,rot,W*.5,2.2,"#e3b457",.95*p);orinFrame(ctx,v.x,v.y,W*.62,H*.62,rot,1,"#c99a3e",.5*p);});
    epicRing(ctx,v.x,v.y,5+3*snap,5+3*snap,1.8,"#ff6a80",.9*p);
    epicGlowAt(ctx,v.x,v.y,5.5,"#ffffff",p);ctx.restore();
  };
  CommonCombatRunner.prototype.drawEpicMotif_executionseal=function(ctx,e,m){
    // Execution Seal: a large brass evidence frame with corner brackets closes onto the target while a round wine seal inside it
    // lights up segment by segment (the verdict is held until the seal is lit); two parallel needle sight-lines reach from the
    // SMG to the target and the muzzle charges. On the hit two twin-needle beams converge, the brackets slam shut, a white-brass
    // round seal stamps inside the frame, a rectangular and a round shock ring expand, brass rays and sparks/embers burst.
    const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ang=Math.atan2(dy,dx),nx=-dy/D,ny=dx/D;
    const lockFade=since<0?1:epicClamp(1-since/.35);
    if(launch>0&&lockFade>0){const q=epicSmooth(launch),W=150-70*q,H=W*.72,rot=(1-q)*.6;ctx.save();ctx.globalCompositeOperation="lighter";
      orinSolid(ctx,()=>{orinBrackets(ctx,tx,ty,W,H,rot,W*.42,3,theme.c,.95*q*lockFade);orinFrame(ctx,tx,ty,W*.9,H*.9,rot,1,theme.c,.35*q*lockFade);});
      const lit=epicClamp(launch*1.25);for(let k=0;k<8;k++){const on=epicSmooth((lit*8-k)),a0=-Math.PI/2+k*Math.PI/4;
        if(on>0)epicRing(ctx,tx,ty,26,26,3.2,theme.a,.9*on*lockFade,0,a0+.06,a0+Math.PI/4-.06);}
      epicRing(ctx,tx,ty,17,17,1.2,theme.core,.6*q*lockFade);epicGlowAt(ctx,tx,ty,10+18*lit,theme.a,.55*lit*lockFade);
      for(const k of [-1,1]){const ox=nx*6*k,oy=ny*6*k,reach=epicSmooth(launch*1.4);
        epicGlowLine(ctx,sx+ox,sy+oy,sx+ox+dx*reach,sy+oy+dy*reach,1.1,theme.a,.55*reach*lockFade);}
      epicGlowAt(ctx,sx,sy,12+20*launch,theme.a,.8*launch*lockFade);
      epicGlowAt(ctx,sx,sy,6+8*launch,"#ffffff",.9*launch*lockFade);ctx.restore();}
    if(since>=0){const q=epicClamp(since/1.2),f=1-q,snap=epicOut(since/.2),W=80-30*snap,H=W*.72;ctx.save();ctx.globalCompositeOperation="lighter";
      if(since<.42){const bf=1-since/.42;for(const k of [-1,1]){const ox=nx*9*k*(1-epicOut(since/.12)),oy=ny*9*k*(1-epicOut(since/.12));
          epicBeam(ctx,sx+ox,sy+oy,tx,ty,5*bf+1.2,theme,.85*bf);epicGlowLine(ctx,sx+ox,sy+oy,tx,ty,1.3,"#ffffff",bf);}}
      epicGlowAt(ctx,tx,ty,70+110*epicOut(since/.3),theme.a,.95*f);
      orinBrackets(ctx,tx,ty,W,H,0,W*.45,4*f+1.2,theme.c,.95*f);orinFrame(ctx,tx,ty,W*.7,H*.7,0,1.6*f+.6,theme.core,.6*f);
      epicRing(ctx,tx,ty,30,30,5*f+1.4,theme.core,.95*f);epicRing(ctx,tx,ty,20,20,3*f+1,theme.a,.9*f);
      epicStroke(ctx,[[tx-12,ty],[tx+12,ty]],2.4*f+.6,theme.c,.9*f);epicStroke(ctx,[[tx,ty-12],[tx,ty+12]],2.4*f+.6,theme.c,.9*f);
      for(const [d0,w] of [[0,3],[.12,2]]){const u=epicOut(Math.max(0,since-d0)/.6);orinFrame(ctx,tx,ty,60+200*u,(60+200*u)*.72,0,w*(1-u)+.6,theme.a,.8*(1-u)*f);}
      {const u=epicOut(since/.5);epicRing(ctx,tx,ty,40+170*u,40+170*u,2.4*(1-u)+.5,theme.c,.7*(1-u)*f);}
      epicRays(ctx,tx,ty,8,14,56+150*epicOut(since/.3),.05,theme.c,.7*f,a*.3+Math.PI/8,59);
      epicGlowAt(ctx,tx,ty,30,"#ffffff",f);ctx.restore();
      if(!e.spawned.seal){e.spawned.seal=true;epicSpawn(state,tx,ty,24,{kind:"spark",speed:[300,940],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.3,2.8],colors:["#fff4e2","#d0304f","#e3b457"],grav:220,drag:.9});
        epicSpawn(state,tx,ty-16,14,{kind:"ember",speed:[80,300],life:[.6,1.3],size:[3,6.5],colors:["#d0304f","#e3b457","#fff4e2"],grav:-40,drag:.93});}}
  };
  // Yura (R-05) fires lattice pulses: a moss-green streak with a sand-white core, a copper coil ring across the head and small
  // lattice diamonds left in the wake. A hit rings the ground with contour lines, a copper survey pin with a diamond head
  // plants on the target and four copper ticks mark it ("내 표식 뒤만 밟아").
  // copper pins/ticks/route markers are drawn source-over: additive blending washes copper to white over the blue stage
  const yuraSolid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};
  const yuraDiamond=(ctx,x,y,ux,uy,l,w,width,color,alpha)=>{const nx=-uy,ny=ux;
    epicStroke(ctx,[[x+ux*l,y+uy*l],[x+nx*w,y+ny*w],[x-ux*l,y-uy*l],[x-nx*w,y-ny*w],[x+ux*l,y+uy*l]],width,color,alpha);};
  function yuraPin(ctx,x,y,h,width,alpha){ // survey stake from the ground point (x,y) up h px with a diamond head
    epicStroke(ctx,[[x,y],[x,y-h]],width,"#e0873a",alpha);
    epicPoly(ctx,x,y-h-4,5.5,4,0,1.6,"#e0873a",alpha,.85);epicPoly(ctx,x,y-h-4,2.4,4,0,1,"#f6efd9",alpha,.9);}
  function yuraTicks(ctx,x,y,r0,r1,width,color,alpha){for(const [a,b] of [[1,0],[0,1],[-1,0],[0,-1]])epicStroke(ctx,[[x+a*r0,y+b*r0*.62],[x+a*r1,y+b*r1*.62]],width,color,alpha);}
  const drawLatticePulse=(ctx,q)=>{
    const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,h=q.heavy?1.4:1;
    ctx.save();ctx.globalCompositeOperation="lighter";
    // the moss haze is painted source-over (additive green over the blue stage reads cyan), the core stays additive
    yuraSolid(ctx,()=>{epicGlowLine(ctx,q.px-dx*2.4,q.py-dy*2.4,q.x,q.y,5.5*h,"#6fbf2f",.6,false);epicGlowAt(ctx,q.x,q.y,9*h,"#6fbf2f",.55,false);});
    epicGlowLine(ctx,q.px-dx*2.4,q.py-dy*2.4,q.x,q.y,6*h,"#7fd13f",.35,false);
    epicGlowLine(ctx,q.px-dx*1.3,q.py-dy*1.3,q.x,q.y,1.6*h,"#f6efd9",.9);
    for(let k=1;k<=3;k++){const f=k/4,x=q.px-dx*(f*2.2),y=q.py-dy*(f*2.2),l=(5.2-k)*1.6*h;yuraDiamond(ctx,x,y,ux,uy,l,l*.62,1.1,"#8fbf4a",.8-k*.18);}
    epicGlowAt(ctx,q.x,q.y,10*h,"#7fd13f",.8,false);epicGlowAt(ctx,q.x,q.y,3*h,"#ffffff",.85);ctx.restore();
    yuraSolid(ctx,()=>epicRing(ctx,q.x,q.y,2.2*h,5.4*h,1.8,"#e0873a",.95,Math.atan2(dy,dx)));
  };
  const drawSurveyPinImpact=(ctx,v)=>{
    const t=Math.min(1,(v.age||0)/.46),p=1-t,snap=epicOut(Math.min(1,t*3));
    ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowAt(ctx,v.x,v.y,14+26*epicOut(t),"#7fd13f",.85*p,false);
    for(let k=0;k<3;k++){const u=epicOut(epicClamp(t*1.5-k*.16)),rx=6+(16+k*9)*u;if(u>0)epicRing(ctx,v.x,v.y,rx,rx*.62,1.5,k?"#8fbf4a":"#f6efd9",.85*(1-u)*p,.08*k);}
    yuraSolid(ctx,()=>{yuraTicks(ctx,v.x,v.y,9,16,2,"#e0873a",.95*p);yuraPin(ctx,v.x,v.y,6+10*snap,1.8,.95*p);});
    epicGlowAt(ctx,v.x,v.y,5,"#ffffff",p);ctx.restore();
  };
  CommonCombatRunner.prototype.drawEpicMotif_contoursurvey=function(ctx,e,m){
    // Contour Survey: moss-green contour rings ripple over the ground around the target while a dashed copper detour route
    // curves from the rifle to it with diamond route markers, and a copper survey pin drops onto the target (the route is
    // plotted before anyone steps). On the hit a sand-white lattice pulse runs the whole route, the pin flares, three
    // ground contour shock rings expand, copper rays and moss/sand sparks and embers burst.
    const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ang=Math.atan2(dy,dx),nx=-dy/D,ny=dx/D;
    const bend=Math.min(90,D*.12)*(dx<0?-1:1),route=f=>[sx+dx*f+nx*Math.sin(Math.PI*f)*bend,sy+dy*f+ny*Math.sin(Math.PI*f)*bend];
    const lockFade=since<0?1:epicClamp(1-since/.35);
    if(launch>0&&lockFade>0){const q=epicSmooth(launch),reach=epicSmooth(launch*1.3);ctx.save();ctx.globalCompositeOperation="lighter";
      for(let k=0;k<4;k++){const u=(launch*1.6+k*.25)%1,rx=30+150*u;epicRing(ctx,tx,ty,rx,rx*.5,1.6,theme.a,.55*(1-u)*q*lockFade,.05*Math.sin(k*1.7));}
      for(let i=0;i<18;i++){const f0=i/18,f1=f0+.55/18;if(f0>reach)break;const [x0,y0]=route(f0),[x1,y1]=route(Math.min(f1,reach));
        epicGlowLine(ctx,x0,y0,x1,y1,4.2,theme.a,.5*lockFade,false);}
      yuraSolid(ctx,()=>{for(let i=0;i<18;i++){const f0=i/18,f1=f0+.55/18;if(f0>reach)break;const [x0,y0]=route(f0),[x1,y1]=route(Math.min(f1,reach));epicStroke(ctx,[[x0,y0],[x1,y1]],2.4,theme.c,.95*lockFade);}
        for(const f of [.25,.5,.75])if(reach>f){const [x,y]=route(f);epicPoly(ctx,x,y,5,4,0,1.5,theme.c,.95*lockFade,.55);}
        const drop=epicOut(epicClamp(launch*1.4-.2));if(drop>0)yuraPin(ctx,tx,ty-90*(1-drop),26,2.2,.95*drop*lockFade);
        yuraTicks(ctx,tx,ty,18,30,2.2,theme.c,.9*q*lockFade);});
      epicRing(ctx,tx,ty,14,14*.62,1.4,theme.core,.7*q*lockFade);
      epicGlowAt(ctx,tx,ty-30,8+14*q,theme.a,.5*q*lockFade);
      epicGlowAt(ctx,sx,sy,12+18*launch,theme.a,.8*launch*lockFade);
      epicGlowAt(ctx,sx,sy,6+8*launch,"#ffffff",.9*launch*lockFade);ctx.restore();}
    if(since>=0){const q=epicClamp(since/1.2),f=1-q;ctx.save();ctx.globalCompositeOperation="lighter";
      if(since<.45){const bf=1-since/.45,head=epicOut(since/.22),pts=[];for(let i=0;i<=24;i++){const g=i/24*head;pts.push(route(g));}
        for(let i=1;i<pts.length;i++){epicGlowLine(ctx,pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1],6*bf+1.4,theme.a,.85*bf);epicGlowLine(ctx,pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1],1.4,"#ffffff",bf);}
        const [hx,hy]=pts[pts.length-1];epicGlowAt(ctx,hx,hy,16*bf+4,theme.core,.9*bf);}
      epicGlowAt(ctx,tx,ty,70+110*epicOut(since/.3),theme.a,.95*f,false);epicGlowAt(ctx,tx,ty,40+50*epicOut(since/.3),theme.a,.6*f);
      for(const [d0,w] of [[0,3],[.1,2.2],[.2,1.6]]){const u=epicOut(Math.max(0,since-d0)/.7);epicRing(ctx,tx,ty,40+220*u,(40+220*u)*.5,w*(1-u)+.5,d0?theme.a:theme.core,.8*(1-u)*f);}
      epicRing(ctx,tx,ty,24,24*.62,4*f+1.2,theme.core,.9*f);
      epicRays(ctx,tx,ty,8,14,56+150*epicOut(since/.3),.05,theme.c,.7*f,a*.3,61);
      epicGlowAt(ctx,tx,ty-30,26*f+6,theme.c,.85*f);
      epicGlowAt(ctx,tx,ty,30,"#ffffff",f);ctx.restore();
      yuraSolid(ctx,()=>{yuraPin(ctx,tx,ty,26,2.6*f+.8,.95*f);yuraTicks(ctx,tx,ty,20,34+12*epicOut(since/.3),2.4*f+.6,theme.c,.9*f);});
      if(!e.spawned.survey){e.spawned.survey=true;epicSpawn(state,tx,ty,24,{kind:"spark",speed:[300,940],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.3,2.8],colors:["#f6efd9","#8fbf4a","#e0873a"],grav:220,drag:.9});
        epicSpawn(state,tx,ty-16,14,{kind:"ember",speed:[80,300],life:[.6,1.3],size:[3,6.5],colors:["#8fbf4a","#e0873a","#f6efd9"],grav:-40,drag:.93});}}
  };
  // Narae (SR-05) fires hunter slugs: a heavy white-hot slug in a hazard-yellow sheath, two copper coil rings behind the head
  // and short hazard dashes in the wake. A hit punches: white flash, a copper dent ring and heavy copper shrapnel streaks.
  const naraeSolid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};
  function naraeBrackets(ctx,x,y,r,l,width,alpha){ // hazard corner brackets (yellow over a dark under-stroke)
    for(const [qx,qy] of [[-1,-1],[1,-1],[1,1],[-1,1]]){const cx=x+qx*r,cy=y+qy*r*.72,pts=[[cx,cy-qy*l],[cx,cy],[cx-qx*l,cy]];
      epicStroke(ctx,pts,width+2.4,"#1a1406",.7*alpha);epicStroke(ctx,pts,width,"#ffc21a",alpha);}}
  function naraeGauge(ctx,x,y,r,v,alpha){ // analog dial: dark face, copper rim, ticks, red zone, needle at v (0..1 over 240 deg)
    const a0=Math.PI*.83,span=Math.PI*1.34,at=f=>a0+span*f;
    ctx.globalAlpha=Math.min(1,.78*alpha);ctx.fillStyle="#17130b";ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    epicRing(ctx,x,y,r,r,2.4,"#d9703a",alpha);epicRing(ctx,x,y,r*.78,r*.78,3.2,"#e8412c",.95*alpha,0,at(.78),at(1));
    for(let i=0;i<=8;i++){const a=at(i/8),q=i%2?.84:.74;epicStroke(ctx,[[x+Math.cos(a)*r*q,y+Math.sin(a)*r*q],[x+Math.cos(a)*r*.93,y+Math.sin(a)*r*.93]],i%2?1.2:2,"#fff3d6",.9*alpha);}
    const a=at(v);epicStroke(ctx,[[x-Math.cos(a)*r*.14,y-Math.sin(a)*r*.14],[x+Math.cos(a)*r*.86,y+Math.sin(a)*r*.86]],2.4,v>.78?"#ff5a3c":"#ffc21a",alpha);
    epicPoly(ctx,x,y,r*.12,10,0,1,"#d9703a",alpha,1);}
  const drawHunterSlug=(ctx,q)=>{
    const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,h=q.heavy?1.4:1,ang=Math.atan2(dy,dx);
    naraeSolid(ctx,()=>{epicGlowLine(ctx,q.px-dx*2.2,q.py-dy*2.2,q.x,q.y,5*h,"#ffc21a",.55,false);
      for(let k=1;k<=3;k++){const f0=.55+k*.5,f1=f0+.28;epicStroke(ctx,[[q.x-dx*f0,q.y-dy*f0],[q.x-dx*f1,q.y-dy*f1]],2.4*h,"#ffc21a",.9-k*.22);}
      for(const b of [.35,.7])epicRing(ctx,q.x-dx*b,q.y-dy*b,5.6*h,2.4*h,1.6,"#d9703a",.95,ang+Math.PI/2);});
    ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowLine(ctx,q.px-dx*1.1,q.py-dy*1.1,q.x,q.y,2.4*h,"#fff3d6",.95);
    epicGlowAt(ctx,q.x,q.y,11*h,"#fff3d6",.55);epicGlowAt(ctx,q.x+ux*2,q.y+uy*2,4*h,"#ffffff",.95);ctx.restore();
  };
  const drawSlugPunchImpact=(ctx,v)=>{
    const t=Math.min(1,(v.age||0)/.42),p=1-t,snap=epicOut(Math.min(1,t*2.6));
    ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowAt(ctx,v.x,v.y,16+22*epicOut(t),"#fff3d6",.8*p);epicGlowAt(ctx,v.x,v.y,6,"#ffffff",p);ctx.restore();
    naraeSolid(ctx,()=>{epicGlowAt(ctx,v.x,v.y,14+30*epicOut(t),"#ffc21a",.55*p,false);
      const R=8+26*snap;epicRing(ctx,v.x,v.y,R,R*.66,3*p+.6,"#d9703a",.95*p);epicRing(ctx,v.x,v.y,R*.55,R*.36,1.6*p+.4,"#ffc21a",.9*p);
      for(let i=0;i<6;i++){const a=i*Math.PI/3+.3,r0=6+10*snap,r1=r0+10+18*snap;epicStroke(ctx,[[v.x+Math.cos(a)*r0,v.y+Math.sin(a)*r0*.7],[v.x+Math.cos(a)*r1,v.y+Math.sin(a)*r1*.7]],2.2*p+.5,i%2?"#d9703a":"#ffc21a",.95*p);}});
  };
  CommonCombatRunner.prototype.drawEpicMotif_lastround=function(ctx,e,m){
    // Last Round: the camp raises a hazard-yellow approval flare over the shooter while her analog gauge needle swings into the
    // red, copper coil rings march down the aim line and hazard brackets close on the target (the last shot waits for the
    // camp's approval). On the hit one white-hot slug line punches through with rail sparks along it, a copper dent ring,
    // heavy shrapnel streaks, a yellow shockwave and copper/yellow sparks and embers.
    const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ang=Math.atan2(dy,dx),ux=dx/D,uy=dy/D,nx=-uy,ny=ux;
    const lockFade=since<0?1:epicClamp(1-since/.35);
    if(launch>0&&lockFade>0){const q=epicSmooth(launch);
      naraeSolid(ctx,()=>{
        // approval flare: rises above the shooter, bursts and hangs
        const rise=epicOut(epicClamp(launch*1.8)),fx=sx-40,fy=sy-60-150*rise;
        epicStroke(ctx,[[sx-8,sy-40],[fx,fy]],2,"#ffc21a",.5*(1-rise*.6)*lockFade);
        epicGlowAt(ctx,fx,fy,18+26*rise,"#ffc21a",.75*lockFade,false);epicGlowAt(ctx,fx,fy,7,"#fff3d6",.95*lockFade,false);
        // analog gauge beside the shooter; the needle swings into the red zone
        naraeGauge(ctx,sx+64,sy-54,30,epicClamp(launch*1.25)*.96,.95*lockFade);
        // copper coil rings march from the rifle toward the target
        for(let k=0;k<6;k++){const u=(launch*1.4+k/6)%1,f=.08+.84*u,x=sx+dx*f,y=sy+dy*f,r=10+6*Math.sin(u*Math.PI);
          epicRing(ctx,x,y,r,r*.42,2,theme.c,.9*Math.sin(u*Math.PI)*q*lockFade,ang+Math.PI/2);}
        // hazard brackets close on the target
        naraeBrackets(ctx,tx,ty,96-44*q,24,3,.95*q*lockFade);});
      ctx.save();ctx.globalCompositeOperation="lighter";
      epicGlowLine(ctx,sx,sy,sx+dx*q,sy+dy*q,1.4,theme.core,.45*q*lockFade);
      epicGlowAt(ctx,sx,sy,10+16*launch,theme.core,.75*launch*lockFade);epicGlowAt(ctx,sx,sy,5+7*launch,"#ffffff",.9*launch*lockFade);ctx.restore();}
    if(since>=0){const q=epicClamp(since/1.2),f=1-q;
      ctx.save();ctx.globalCompositeOperation="lighter";
      if(since<.4){const bf=1-since/.4,head=epicOut(since/.16);
        epicGlowLine(ctx,sx,sy,sx+dx*head,sy+dy*head,11*bf+2,theme.core,.9*bf);epicGlowLine(ctx,sx,sy,sx+dx*head,sy+dy*head,2.4,"#ffffff",bf);
        epicGlowAt(ctx,sx+dx*head,sy+dy*head,20*bf+5,"#ffffff",.95*bf);}
      epicGlowAt(ctx,tx,ty,50+70*epicOut(since/.3),theme.core,.85*f);epicGlowAt(ctx,tx,ty,26,"#ffffff",f);ctx.restore();
      naraeSolid(ctx,()=>{
        if(since<.5){const bf=1-since/.5;epicGlowLine(ctx,sx,sy,tx,ty,6*bf+1,theme.a,.6*bf,false);
          for(let i=1;i<9;i++){const g=i/9,j=(i%2?1:-1)*(6+4*Math.sin(i*2.3)),x=sx+dx*g,y=sy+dy*g;epicStroke(ctx,[[x,y],[x+nx*j+ux*6,y+ny*j+uy*6]],1.8*bf+.4,i%3?theme.a:theme.c,.9*bf);}}
        epicGlowAt(ctx,tx,ty,60+120*epicOut(since/.35),theme.a,.7*f,false);
        for(const [d0,w] of [[0,3.4],[.1,2.4],[.2,1.6]]){const u=epicOut(Math.max(0,since-d0)/.7);epicRing(ctx,tx,ty,30+210*u,(30+210*u)*.55,w*(1-u)+.5,d0?theme.c:theme.a,.9*(1-u)*f);}
        epicRing(ctx,tx,ty,26,26*.62,4*f+1.2,theme.c,.95*f);
        for(let i=0;i<8;i++){const a2=i*Math.PI/4+.2,r0=18,r1=48+80*epicOut(since/.3);epicStroke(ctx,[[tx+Math.cos(a2)*r0,ty+Math.sin(a2)*r0*.7],[tx+Math.cos(a2)*r1,ty+Math.sin(a2)*r1*.7]],3.2*f+.6,i%2?theme.c:theme.a,.9*f);}
        naraeBrackets(ctx,tx,ty,52+30*epicOut(since/.3),24,3*f+.6,.9*f);});
      epicRays(ctx,tx,ty,8,14,50+140*epicOut(since/.3),.05,theme.core,.55*f,a*.3,67);
      if(!e.spawned.lastround){e.spawned.lastround=true;epicSpawn(state,tx,ty,26,{kind:"spark",speed:[320,980],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.3,2.8],colors:["#fff3d6","#ffc21a","#d9703a"],grav:260,drag:.9});
        epicSpawn(state,tx,ty-14,12,{kind:"ember",speed:[80,300],life:[.6,1.3],size:[3,6.5],colors:["#ffc21a","#d9703a","#fff3d6"],grav:-40,drag:.93});
        for(let i=1;i<6;i++)epicSpawn(state,sx+dx*i/6,sy+dy*i/6,3,{kind:"spark",speed:[160,420],angle:ang+Math.PI/2,spread:Math.PI*2,life:[.2,.45],size:[1,2],colors:["#ffc21a","#fff3d6"],grav:420,drag:.9});}}
  };
  // Yeonhwa (R-07) fires channel vanes: a gold-rimmed ivory vane with a diamond tip and two parallel aubergine channel lines
  // in the wake that never merge; heavy shots fan three vanes. A hit opens seven short vanes in a half circle inside a gold
  // seal ring with an aubergine inner ring and an ivory flash.
  const yeonhwaSolid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};
  function yeonhwaVane(ctx,x,y,len,w,rot,alpha){ // one fan vane from its root (x,y): ivory body, gold rim, diamond tip
    const c=Math.cos(rot),s2=Math.sin(rot),nx=-s2,ny=c,pts=[[x,y],[x+c*len*.6+nx*w,y+s2*len*.6+ny*w],[x+c*len,y+s2*len],[x+c*len*.6-nx*w,y+s2*len*.6-ny*w]];
    ctx.globalAlpha=Math.min(1,.88*alpha);ctx.fillStyle="#fff6e2";ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);for(const q of pts.slice(1))ctx.lineTo(q[0],q[1]);ctx.closePath();ctx.fill();
    epicStroke(ctx,[...pts,pts[0]],Math.max(1,w*.34),"#e8b64c",alpha);
    epicPoly(ctx,x+c*len*.84,y+s2*len*.84,Math.max(1.4,w*.42),4,rot,1,"#e8b64c",alpha,alpha);}
  const drawChannelVane=(ctx,q)=>{
    const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux,h=q.heavy?1.35:1,ang=Math.atan2(dy,dx);
    yeonhwaSolid(ctx,()=>{
      for(const k of [-1,1]){const ox=nx*k*4.6*h,oy=ny*k*4.6*h;epicStroke(ctx,[[q.px-dx*2.4+ox,q.py-dy*2.4+oy],[q.x-ux*6*h+ox,q.y-uy*6*h+oy]],2*h,"#8a3f7a",.85);}
      epicGlowLine(ctx,q.px-dx*1.6,q.py-dy*1.6,q.x,q.y,4.5*h,"#e8b64c",.5,false);
      const spread=q.heavy?[-.42,0,.42]:[0];
      for(const a of spread)yeonhwaVane(ctx,q.x-ux*14*h,q.y-uy*14*h,20*h*(a?0.8:1),4.2*h,ang+a,.95);});
    ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowLine(ctx,q.px-dx*1.1,q.py-dy*1.1,q.x,q.y,1.6*h,"#fff6e2",.9);
    epicGlowAt(ctx,q.x,q.y,10*h,"#fff6e2",.5);epicGlowAt(ctx,q.x+ux*2,q.y+uy*2,3.6*h,"#ffffff",.95);ctx.restore();
  };
  const drawVaneSealImpact=(ctx,v)=>{
    const t=Math.min(1,(v.age||0)/.46),p=1-t,snap=epicOut(Math.min(1,t*2.4));
    ctx.save();ctx.globalCompositeOperation="lighter";
    epicGlowAt(ctx,v.x,v.y,14+20*epicOut(t),"#fff6e2",.75*p);epicGlowAt(ctx,v.x,v.y,6,"#ffffff",p);ctx.restore();
    yeonhwaSolid(ctx,()=>{
      for(let i=0;i<7;i++){const a=-Math.PI+(i+.5)*Math.PI/7,r0=5+4*snap;yeonhwaVane(ctx,v.x+Math.cos(a)*r0,v.y+Math.sin(a)*r0*.8,8+16*snap,2.6,a,.95*p);}
      const R=10+22*snap;epicRing(ctx,v.x,v.y,R,R*.72,2.6*p+.6,"#e8b64c",.95*p);epicRing(ctx,v.x,v.y,R*.5,R*.36,1.8*p+.4,"#8a3f7a",.9*p);});
  };
  CommonCombatRunner.prototype.drawEpicMotif_returnline=function(ctx,e,m){
    // Return Line: the seven vanes unfold into a gold-ivory half-circle barrier in front of her, two separate aubergine channel
    // lines run to the target (three and five signal pulses; they never merge) and a gold seal ring with seven diamond marks
    // closes on it. On the hit the vanes fold and fly down both lines, the seal ring snaps shut, gold shock rings spread and
    // gold/ivory sparks and aubergine embers rise; the two channel lines stay drawn a moment after the hit.
    const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ang=Math.atan2(dy,dx),ux=dx/D,uy=dy/D,nx=-uy,ny=ux;
    const lockFade=since<0?1:epicClamp(1-since/.35),off=16;
    const lineA=[sx+nx*off,sy+ny*off,tx+nx*off*.5,ty+ny*off*.5],lineB=[sx-nx*off,sy-ny*off,tx-nx*off*.5,ty-ny*off*.5];
    const drawLines=(q,alpha)=>{for(const [L,n] of [[lineA,3],[lineB,5]]){const ex=L[0]+(L[2]-L[0])*q,ey=L[1]+(L[3]-L[1])*q;
      epicStroke(ctx,[[L[0],L[1]],[ex,ey]],3.4,theme.c,.85*alpha);epicStroke(ctx,[[L[0],L[1]],[ex,ey]],1.1,theme.core,.8*alpha);
      for(let k=0;k<n;k++){const u=((launch>0?launch:1)*(n===3?1.2:2)+k/n)%1;if(u>q)continue;epicPoly(ctx,L[0]+(L[2]-L[0])*u,L[1]+(L[3]-L[1])*u,4.2,4,ang,1.2,theme.a,alpha,.9*alpha);}}};
    if(launch>0&&lockFade>0){const q=epicSmooth(launch),open=epicOut(epicClamp(launch*1.6));
      yeonhwaSolid(ctx,()=>{
        // barrier: seven vanes unfold into a half circle facing the target
        const bx=sx+ux*26,by=sy+uy*26;
        for(let i=0;i<7;i++){const a2=ang+(i/6-.5)*Math.PI*open;yeonhwaVane(ctx,bx,by,40+36*open,7,a2,.95*lockFade);}
        epicRing(ctx,bx,by,78*open+4,78*open+4,2.6,theme.a,.9*open*lockFade,0,ang-Math.PI/2*open,ang+Math.PI/2*open);
        // two channel lines, never merged
        drawLines(q,lockFade);
        // gold seal ring with seven diamond marks closes on the target
        const R=96-46*q;epicRing(ctx,tx,ty,R,R*.7,2.6,theme.a,.95*q*lockFade);
        for(let i=0;i<7;i++){const a2=i*Math.PI*2/7+launch*1.4;epicPoly(ctx,tx+Math.cos(a2)*R,ty+Math.sin(a2)*R*.7,5.4,4,a2,1.2,theme.a,.95*q*lockFade,.85*q*lockFade);}});
      ctx.save();ctx.globalCompositeOperation="lighter";
      epicGlowAt(ctx,sx+ux*26,sy+uy*26,14+22*launch,theme.core,.6*launch*lockFade);epicGlowAt(ctx,sx,sy,5+7*launch,"#ffffff",.85*launch*lockFade);ctx.restore();}
    if(since>=0){const q=epicClamp(since/1.2),f=1-q;
      ctx.save();ctx.globalCompositeOperation="lighter";
      epicGlowAt(ctx,tx,ty,46+66*epicOut(since/.3),theme.core,.8*f);epicGlowAt(ctx,tx,ty,24,"#ffffff",f);ctx.restore();
      yeonhwaSolid(ctx,()=>{
        if(since<.8)drawLines(1,1-since/.8);
        // the vanes fold and fly down both lines to the target
        if(since<.32){const head=epicOut(since/.26),vf=1-since/.32;
          for(let i=0;i<7;i++){const L=i%2?lineB:lineA,lag=i*.05,u=epicClamp(head-lag);yeonhwaVane(ctx,L[0]+(L[2]-L[0])*u,L[1]+(L[3]-L[1])*u,30,5,ang,.95*vf);}}
        epicGlowAt(ctx,tx,ty,56+110*epicOut(since/.35),theme.a,.6*f,false);
        for(const [d0,w] of [[0,3.2],[.1,2.2],[.2,1.5]]){const u=epicOut(Math.max(0,since-d0)/.7);epicRing(ctx,tx,ty,28+200*u,(28+200*u)*.58,w*(1-u)+.5,d0===.1?theme.c:theme.a,.9*(1-u)*f);}
        // the seal ring snaps shut and holds, seven diamond marks locked on it
        const R=50-24*epicOut(epicClamp(since/.18));epicRing(ctx,tx,ty,R,R*.7,4*f+1.2,theme.a,.95*f);epicRing(ctx,tx,ty,R*.62,R*.43,2*f+.6,theme.c,.9*f);
        for(let i=0;i<7;i++){const a2=i*Math.PI*2/7+a*.4;epicPoly(ctx,tx+Math.cos(a2)*R,ty+Math.sin(a2)*R*.7,5,4,a2,1.2,theme.a,.95*f,.9*f);}
        for(let i=0;i<7;i++){const a2=-Math.PI+(i+.5)*Math.PI/7;yeonhwaVane(ctx,tx+Math.cos(a2)*(R+4),ty+Math.sin(a2)*(R+4)*.7,18+30*epicOut(since/.3),4,a2,.9*f);}});
      epicRays(ctx,tx,ty,7,14,48+130*epicOut(since/.3),.06,theme.core,.5*f,a*.3,71);
      if(!e.spawned.returnline){e.spawned.returnline=true;epicSpawn(state,tx,ty,24,{kind:"spark",speed:[300,900],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.3,2.6],colors:["#fff6e2","#e8b64c","#ffffff"],grav:240,drag:.9});
        epicSpawn(state,tx,ty-12,12,{kind:"ember",speed:[70,260],life:[.7,1.4],size:[3,6],colors:["#8a3f7a","#e8b64c","#fff6e2"],grav:-50,drag:.93});
        for(const L of [lineA,lineB])for(let i=1;i<5;i++)epicSpawn(state,L[0]+(L[2]-L[0])*i/5,L[1]+(L[3]-L[1])*i/5,2,{kind:"spark",speed:[120,340],angle:ang+Math.PI/2,spread:Math.PI*2,life:[.2,.45],size:[1,2],colors:["#e8b64c","#fff6e2"],grav:380,drag:.9});}}
  };
  // >>> CHAR_VFX moa (tools/char_pipeline/vfx/moa.js sha256 ed4bb98ef6c5ee42; installed by vfx_lib.py)
  {
    // CHAR_VFX moa — 모아 (SR-08). Written from tools/char_pipeline/vfx/_TEMPLATE.js by Claude Code (2026-09-26); installed by vfx_lib.py.
    // Moa (Silent Commune, DEFENSE / FRONT) holds a tall white anchor plate with a cyan centre seam and a hexagonal hub; she
    // "holds the line" for the others ("전방 방벽 3초. 이오나, 네 길만 보고 달려. 뒤는 내가 받는다.", "내 사선에 들어오면 적이
    // 아니어도 밀어낸다."). Her shapes:
    //   shot   anchor bolt: a small dark plate with a light rim, a cyan seam and a hex hub, flying edge-first between two parallel
    //          cyan barrier lines joined by grey-teal rungs (her "사선", the firing lane she keeps); heavy shots carry a hex ring.
    //   hit    anchor-plate slam: the plate lands flat across the shot as a dark barrier bar with a light top edge, six rim
    //          tremors shiver along it (the hit SFX: the edge buzzing on its hinge) and a cyan hex hub ring spreads.
    //   muzzle the hub hexagon flares and two parallel pressure vents blow along the aim (the latch-and-air launch).
    //   ult    쌍선 봉쇄 (Dual Line Seal): two broad cyan horizon arcs ride two parallel lanes from her to the target, shrinking
    //          as they go; the rear arc swings around so the pair closes on the target as one seal around a hex hub. On the hit
    //          the seal compresses inward in one heavy pulse, a flat barrier bar snaps out across the line with six tremors,
    //          hex shock rings spread and cyan/ivory sparks rise.
    // Palette: main #2dd8d1 (theme.a), light #e4fffb (theme.core), accent #6f9c99 (theme.c = her hair teal), dark #26373e (theme.b);
    // the plate rim uses her jacket white #eeeae8. Coloured shapes are source-over; only the light cores are "lighter".

    // ---- theme: the ultimate motif name and colours (motif must match specs/moa.json vfx.motif)
    CHAR_VFX_THEMES.moa={motif:"dualhorizonseal",core:"#e4fffb",a:"#2dd8d1",b:"#26373e",c:"#6f9c99"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // a small anchor plate: dark body, light rim, cyan seam along its length and a hex hub. (x,y) centre, (ux,uy) its long axis.
    const plateMark=(ctx,x,y,ux,uy,len,w,alpha)=>{const nx=-uy,ny=ux;
      const P=[[x+ux*len+nx*w,y+uy*len+ny*w],[x+ux*len-nx*w,y+uy*len-ny*w],[x-ux*len-nx*w,y-uy*len-ny*w],[x-ux*len+nx*w,y-uy*len+ny*w]];
      ctx.globalAlpha=Math.min(1,.9*alpha);ctx.fillStyle="#26373e";ctx.beginPath();ctx.moveTo(P[0][0],P[0][1]);
      for(const q of P.slice(1))ctx.lineTo(q[0],q[1]);ctx.closePath();ctx.fill();ctx.globalAlpha=1;
      epicStroke(ctx,[...P,P[0]],Math.max(1,w*.3),"#eeeae8",alpha);
      epicStroke(ctx,[[x+ux*len*.82,y+uy*len*.82],[x-ux*len*.82,y-uy*len*.82]],Math.max(1,w*.28),"#2dd8d1",alpha);
      epicPoly(ctx,x,y,Math.max(1.6,w*.55),6,Math.atan2(uy,ux),1,"#2dd8d1",alpha,.8*alpha);};

    // ---- normal/heavy shot and its hit. q: {x,y,px,py,heavy,...}; v: {x,y,age} only (no direction: draw as if from below).
    CHAR_VFX_SHOTS["anchor-plate"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux,h=q.heavy?1.35:1;
        const bx=q.px-dx*2.6,by=q.py-dy*2.6,ex=q.x-ux*9*h,ey=q.y-uy*9*h,lane=4.6*h;
        solid(ctx,()=>{
          epicGlowLine(ctx,bx,by,q.x,q.y,4*h,"#6f9c99",.4,false);
          for(const k of [-1,1])epicStroke(ctx,[[bx+nx*k*lane,by+ny*k*lane],[ex+nx*k*lane,ey+ny*k*lane]],1.7*h,"#2dd8d1",.85); // the two lane lines
          for(let i=1;i<=3;i++){const f=i/4,cx=bx+(ex-bx)*f,cy=by+(ey-by)*f;                                                // rungs between them
            epicStroke(ctx,[[cx+nx*lane,cy+ny*lane],[cx-nx*lane,cy-ny*lane]],1.2*h,"#6f9c99",.35+.5*f);}
          plateMark(ctx,q.x-ux*2*h,q.y-uy*2*h,ux,uy,9.5*h,4.3*h,.95);
          if(q.heavy)epicPoly(ctx,q.x-ux*2*h,q.y-uy*2*h,17*h,6,Math.atan2(uy,ux),1.6,"#2dd8d1",.8);
        });
        ctx.save();ctx.globalCompositeOperation="lighter"; // light core only
        epicGlowLine(ctx,q.px-dx*1.2,q.py-dy*1.2,q.x,q.y,1.3*h,"#e4fffb",.8);
        epicGlowAt(ctx,q.x+ux*8*h,q.y+uy*8*h,3*h,"#ffffff",.85);ctx.restore();
      },
      impact(ctx,v){
        const age=v.age||0,t=Math.min(1,age/.46),p=1-t,snap=epicOut(Math.min(1,t*2.6)),x=v.x,y=v.y,W=10+20*snap;
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,x,y,12+16*epicOut(t),"#e4fffb",.7*p);epicGlowAt(ctx,x,y,5,"#ffffff",p);ctx.restore();
        solid(ctx,()=>{
          const R=6+18*epicOut(t);epicPoly(ctx,x,y,R,6,Math.PI/6,1.8*p+.4,"#2dd8d1",.85*p);                 // hex hub ring
          ctx.globalAlpha=Math.min(1,.85*p);ctx.fillStyle="#26373e";ctx.fillRect(x-W,y-3,W*2,6);ctx.globalAlpha=1; // the plate lands flat
          epicStroke(ctx,[[x-W,y-3],[x+W,y-3]],2,"#eeeae8",.95*p);epicStroke(ctx,[[x-W,y+3],[x+W,y+3]],1.4,"#2dd8d1",.9*p);
          for(let i=0;i<6;i++){const fx=x-W+W*2*(i+.5)/6,j=Math.sin(age*90+i*2.1)*2.2*p,hh=3+5*p;                   // six rim tremors
            epicStroke(ctx,[[fx,y-4],[fx+j,y-4-hh]],1.3,"#6f9c99",.9*p);}
          for(const k of [-1,1])epicStroke(ctx,[[x+k*(W+3),y],[x+k*(W+3+10*snap),y+6*snap]],1.6,"#2dd8d1",.8*p);     // the lane edges bend away
        });
      }
    };

    // ---- muzzle flash: the hub hexagon flares and two parallel pressure vents blow along the aim.
    MUZZLE_STYLES.moa=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(20+18*epicOut(t))*g;
      solid(ctx,()=>{epicPoly(ctx,m.x,m.y,(8+6*epicOut(t))*g,6,ang,(1.8*p+.5)*g,"#2dd8d1",.9*p,.25*p);
        for(const k of [-1,1]){const ox=nx*k*5*g,oy=ny*k*5*g;
          epicStroke(ctx,[[m.x+ox+c*6*g,m.y+oy+s2*6*g],[m.x+ox+c*L,m.y+oy+s2*L]],(2*p+.6)*g,"#6f9c99",.9*p);
          epicStroke(ctx,[[m.x+ox+c*6*g,m.y+oy+s2*6*g],[m.x+ox+c*L*.7,m.y+oy+s2*L*.7]],(.9*p+.3)*g,"#e4fffb",.9*p);}});
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.6,m.y+s2*L*.6,1.2*g,"#e4fffb",.9*p);
      epicGlowAt(ctx,m.x,m.y,6*g,"#ffffff",p);
    };

    // ---- ultimate 쌍선 봉쇄. The game clips this above ~10 px over her muzzle, so everything is drawn along the line and at the
    // target. m: {theme,launch,since,sx,sy,tx,ty,a,state}; launch 0->1 while charging, since = seconds after the hit.
    CommonCombatRunner.prototype.drawEpicMotif_dualhorizonseal=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ang=Math.atan2(dy,dx),nx=-dy/D,ny=dx/D;
      const lockFade=since<0?1:epicClamp(1-since/.35),SPAN=230,off=34;
      // one horizon arc: a wide wall across the path centred at (x,y), bulging along rot (the forward half of an ellipse)
      const horizon=(x,y,depth,hw,rot,alpha)=>{epicRing(ctx,x,y,depth,hw,4.2,theme.a,.9*alpha,rot,-Math.PI/2,Math.PI/2);
        epicRing(ctx,x,y,depth,hw,1.4,theme.core,.85*alpha,rot,-Math.PI/2,Math.PI/2);};
      if(launch>0&&lockFade>0){const q=epicSmooth(launch),reach=epicSmooth(epicClamp(launch*1.25)),flip=epicSmooth(epicClamp((launch-.6)/.4));
        const uA=reach,uB=Math.max(0,reach-.14*(1-q)),lat=off*(1-q);
        solid(ctx,()=>{
          for(const k of [-1,1])for(let i=0;i<14;i++){const f0=i/14,f1=f0+.45/14;if(f0>reach)break;                 // the two lanes
            epicStroke(ctx,[[sx+dx*f0+nx*k*off*(1-f0*q),sy+dy*f0+ny*k*off*(1-f0*q)],[sx+dx*Math.min(f1,reach)+nx*k*off*(1-f1*q),sy+dy*Math.min(f1,reach)+ny*k*off*(1-f1*q)]],2,theme.c,.85*lockFade);}
          const hwA=SPAN*(1-.62*uA),hwB=SPAN*(1-.62*uB),dA=24+30*(1-uA),dB=24+30*(1-uB);
          horizon(sx+dx*uA+nx*lat,sy+dy*uA+ny*lat,dA,hwA,ang,epicClamp(launch*3)*lockFade);                         // front arc
          horizon(sx+dx*uB-nx*lat,sy+dy*uB-ny*lat,dB,hwB,ang+Math.PI*flip,epicClamp(launch*3-.3)*lockFade);          // rear arc swings round
          const H=18+26*(1-q);epicPoly(ctx,tx,ty,H,6,launch*2.4,2,theme.a,.9*q*lockFade,.18*q*lockFade);            // the hub the seal locks on
          epicPoly(ctx,tx,ty,H*.5,6,-launch*2.4,1.4,theme.c,.9*q*lockFade);});
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,sx+dx*uA,sy+dy*uA,10+10*q,theme.core,.45*lockFade);epicGlowAt(ctx,tx,ty,8+18*q,theme.core,.6*q*lockFade);ctx.restore();}
      if(since>=0){const f=1-epicClamp(since/1.2),comp=epicOut(epicClamp(since/.22));
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.3){const bf=1-since/.3;epicGlowLine(ctx,sx,sy,tx,ty,5*bf+1.2,theme.core,.8*bf);}
        epicGlowAt(ctx,tx,ty,40+56*epicOut(since/.3),theme.core,.75*f);epicGlowAt(ctx,tx,ty,22,"#ffffff",f);ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,tx,ty,60+90*epicOut(since/.3),theme.a,.55*f,false);
          const hw=SPAN*.38*(1-.68*comp),dd=24*(1-.7*comp);                                                            // the seal compresses
          epicRing(ctx,tx,ty,dd,hw,4*f+1.2,theme.a,.95*f,ang);epicRing(ctx,tx,ty,dd,hw,1.4,theme.core,.9*f,ang);
          const W=40+SPAN*1.7*epicOut(epicClamp(since/.4)),bw=7*f+1;                                                 // barrier bar snaps out
          epicStroke(ctx,[[tx-nx*W,ty-ny*W],[tx+nx*W,ty+ny*W]],bw*1.8,theme.b,.85*f);
          epicStroke(ctx,[[tx-nx*W,ty-ny*W],[tx+nx*W,ty+ny*W]],bw*.5,theme.core,.95*f);
          for(let i=0;i<6;i++){const s=(i+.5)/6*2-1,px=tx+nx*W*s,py=ty+ny*W*s,j=Math.sin(since*80+i*1.7)*5*f;        // six tremors
            epicStroke(ctx,[[px,py],[px-Math.cos(ang)*(10+j),py-Math.sin(ang)*(10+j)]],2,theme.c,.9*f);}
          for(const [d0,w] of [[0,3],[.08,2.2],[.16,1.5]]){const u=epicOut(Math.max(0,since-d0)/.6);                   // hex shock rings
            epicPoly(ctx,tx,ty,30+190*u,6,a*.2+d0*4,w*(1-u)+.5,d0===.08?theme.c:theme.a,.85*(1-u)*f);}
          epicRays(ctx,tx,ty,6,14,48+120*epicOut(since/.3),.06,theme.a,.5*f,a*.3,83);});
        if(!e.spawned.dualhorizonseal){e.spawned.dualhorizonseal=true;
          epicSpawn(state,tx,ty,24,{kind:"spark",speed:[300,900],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.3,2.6],colors:[theme.core,theme.a,"#eeeae8"],grav:220,drag:.9});
          epicSpawn(state,tx,ty-14,12,{kind:"ember",speed:[70,280],life:[.6,1.3],size:[3,6],colors:[theme.a,theme.c,theme.core],grav:-40,drag:.93});}}
    };
  }
  // <<< CHAR_VFX moa
  // >>> CHAR_VFX bella (tools/char_pipeline/vfx/bella.js sha256 8fcc7b24459ab8c6; installed by vfx_lib.py)
  {
    // CHAR_VFX bella — 벨라 루멘 (SSR-15). Written from tools/char_pipeline/vfx/_TEMPLATE.js; installed by vfx_lib.py.
    // Bella's Field Surveyor launches a sealed triage dart; 응급 이송선 sends paired rescue arcs around the marked target.
    // Palette: silver-mint hair #cbd1d0, warm shell #faeeeb, bright signal teal #34c4b8, deep channel teal #238f89.
    //
    // Runtime helpers you can call (all draw on ctx; alpha fades are your job):
    //   epicGlowAt(ctx,x,y,r,color,alpha,hot=true)            soft round glow. hot=false keeps the colour (use for green/gold/brass).
    //   epicGlowLine(ctx,x1,y1,x2,y2,thick,color,alpha,hot)   soft glow along a segment.
    //   epicStroke(ctx,[[x,y],...],width,color,alpha)          round-capped polyline.
    //   epicRing(ctx,x,y,rx,ry,width,color,alpha,rot=0,a0=0,a1=2PI)   ellipse outline or arc.
    //   epicPoly(ctx,x,y,radius,sides,rot,width,color,alpha,fillAlpha=0)   regular polygon; fillAlpha is ABSOLUTE (multiply by your fade).
    //   epicRays(ctx,x,y,count,inner,outer,spread,color,alpha,spin,seed)    filled ray burst.
    //   epicSpawn(state,x,y,count,{kind:"spark"|"ember",speed:[a,b],angle,spread,life:[a,b],size:[a,b],colors:[...],grav,drag})
    //   epicClamp(v) 0..1, epicOut(v) ease-out, epicSmooth(v) smoothstep, epicIn(v) ease-in, epicHash(n) 0..1.
    // Rules that came from real failures:
    //   - Coloured haze and solid shapes: draw with ctx.globalCompositeOperation="source-over" (the solid() helper below).
    //     Additive ("lighter") green, gold, brass or copper turns cyan/white over the blue stage. Keep only white/light cores additive.
    //   - Every ctx.save() needs its ctx.restore(). Never touch document/window/timers/game state. Particles only via epicSpawn,
    //     and only once per ultimate (guard with e.spawned.<name>). Sparks and round embers only (no rectangular debris).
    //   - Shapes must come from THIS character: her weapon, her ultimate name, her lines. Change the marked shapes below.

    // ---- theme: the ultimate motif name and colours (motif must match specs/bella.json vfx.motif)
    CHAR_VFX_THEMES.bella={motif:"triagesignal",core:"#34c4b8",a:"#cbd1d0",b:"#faeeeb",c:"#238f89"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // The Field Surveyor dart has a forward capsule point, two split fins and a short triage cross in its sealed body.
    const headMark=(ctx,x,y,ux,uy,len,w,color,alpha)=>{const nx=-uy,ny=ux;
      const pts=[[x+ux*len,y+uy*len],[x+ux*len*.2+nx*w,y+uy*len*.2+ny*w],[x-ux*len*.38+nx*w*.72,y-uy*len*.38+ny*w*.72],[x-ux*len*.7+nx*w*.38,y-uy*len*.7+ny*w*.38],[x-ux*len*.88,y-uy*len*.88],
                 [x-ux*len*.7-nx*w*.38,y-uy*len*.7-ny*w*.38],[x-ux*len*.38-nx*w*.72,y-uy*len*.38-ny*w*.72],[x+ux*len*.2-nx*w,y+uy*len*.2-ny*w],[x+ux*len,y+uy*len]];
      epicStroke(ctx,pts,Math.max(1.25,w*.34),color,alpha);
      epicStroke(ctx,[[x-ux*len*.42+nx*w*.42,y-uy*len*.42+ny*w*.42],[x+ux*len*.08+nx*w*.42,y+uy*len*.08+ny*w*.42]],Math.max(1,w*.22),"#faeeeb",.92*alpha);
      const cx=x-ux*len*.03,cy=y-uy*len*.03;
      epicStroke(ctx,[[cx-nx*w*.32-ux*len*.12,cy-ny*w*.32-uy*len*.12],[cx+nx*w*.32+ux*len*.12,cy+ny*w*.32+uy*len*.12]],Math.max(1,w*.2),"#34c4b8",alpha);};

    // ---- normal/heavy shot and its hit. q: {x,y,px,py,heavy,...} (px,py = previous position); v: {x,y,age} ONLY - a hit has no
    // direction: shots fly UP the screen, so draw the hit as if the shot came from below (ux=0, uy=-1).
    CHAR_VFX_SHOTS["scanner-dart"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux,h=q.heavy?1.35:1;
        solid(ctx,()=>{ // coloured wake and head, source-over
          epicGlowLine(ctx,q.px-dx*2.2,q.py-dy*2.2,q.x,q.y,5*h,"#cbd1d0",.6,false);
          epicGlowAt(ctx,q.x,q.y,8*h,"#cbd1d0",.55,false);
          headMark(ctx,q.x-ux*4*h,q.y-uy*4*h,ux,uy,11*h,4.2*h,"#238f89",.95);
          for(let k=1;k<=3;k++){const f=k/4,cx=q.px-dx*f*2,cy=q.py-dy*f*2,ww=(3.4-k*.45)*h;
            epicStroke(ctx,[[cx-ux*2*h+nx*ww,cy-uy*2*h+ny*ww],[cx+ux*2*h-nx*ww,cy+uy*2*h-ny*ww]],1.5*h,"#238f89",.78-k*.16);} // three triage pulse cuts in the wake
        });
        ctx.save();ctx.globalCompositeOperation="lighter"; // light core only
        epicGlowLine(ctx,q.px-dx*1.2,q.py-dy*1.2,q.x,q.y,1.5*h,"#34c4b8",.9);
        epicGlowAt(ctx,q.x,q.y,3*h,"#ffffff",.85);ctx.restore();
      },
      impact(ctx,v){
        const t=Math.min(1,(v.age||0)/.46),p=1-t,snap=epicOut(Math.min(1,t*2.6));
        const ux=0,uy=-1,nx=-uy,ny=ux; // impact has no direction; the dart is drawn as arriving from below
        solid(ctx,()=>{
          for(let k=0;k<2;k++){const u=epicOut(epicClamp(t*1.45-k*.22)),r=8+(17+k*10)*u;if(u>0)
            epicRing(ctx,v.x,v.y+uy*2*k, r,r*.72,2.1-k*.45,"#cbd1d0",.85*(1-u)*p,0,-Math.PI*.78,Math.PI*.12);}
          const r=7+12*snap;
          epicRing(ctx,v.x,v.y,r,r*.64,2*p+.5,"#238f89",.95*p,0,Math.PI*.18,Math.PI*.82);
          epicStroke(ctx,[[v.x+nx*6,v.y+ny*6],[v.x+nx*6+ux*12,v.y+ny*6+uy*12],[v.x-nx*6+ux*12,v.y-ny*6+uy*12],[v.x-nx*6,v.y-ny*6]],1.8,"#238f89",.9*p);
          epicStroke(ctx,[[v.x-ux*3,v.y-uy*3],[v.x+ux*3,v.y+uy*3]],2.1,"#faeeeb",.95*p);
          epicStroke(ctx,[[v.x-nx*3,v.y-ny*3],[v.x+nx*3,v.y+ny*3]],2.1,"#faeeeb",.95*p);
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,6+7*epicOut(t),"#34c4b8",.52*p);epicGlowAt(ctx,v.x,v.y,3.2,"#ffffff",p);ctx.restore();
      }
    };

    // ---- muzzle flash: the carbine's twin pressure vents frame a short teal dart launch and three calibration cuts.
    MUZZLE_STYLES.bella=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(18+15*epicOut(t))*g,J=(7+8*epicOut(t))*g;
      solid(ctx,()=>{
        epicRing(ctx,m.x-c*5*g,m.y-s2*5*g,7*g,3.2*g,1.5*g,"#cbd1d0",.82*p,ang+Math.PI/2);
        for(const k of [-1,1]){
          const bx=m.x-c*2*g+nx*k*2.7*g,by=m.y-s2*2*g+ny*k*2.7*g;
          epicGlowLine(ctx,bx,by,bx-c*J*.28+nx*k*J,by-s2*J*.28+ny*k*J,(2*p+.7)*g,"#238f89",.9*p,false);
          epicGlowLine(ctx,bx,by,bx+c*L*.34,by+s2*L*.34,(1.2*p+.4)*g,"#faeeeb",.82*p,false);
        }
        epicGlowLine(ctx,m.x,m.y,m.x+c*L,m.y+s2*L,(2.7*p+.8)*g,"#34c4b8",.72*p,false);
        for(let i=1;i<=3;i++){const u=i/4,x=m.x+c*L*u,y=m.y+s2*L*u,w=(3.3-.35*i)*g;
          epicStroke(ctx,[[x+nx*w,y+ny*w],[x-nx*w,y-ny*w]],(1.1*p+.3)*g,"#238f89",.9*p);}
      });
      ctx.save();ctx.globalCompositeOperation="lighter";
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.55,m.y+s2*L*.55,1.2*g,"#ffffff",.9*p);
      epicGlowAt(ctx,m.x,m.y,4.5*g,"#ffffff",p);ctx.restore();
    };

    // ---- ultimate. The GAME CLIPS this function above the formation line (about 10 px above her muzzle): a build-up drawn at her
    // muzzle or lower is invisible in the game (Moa self-test). Draw it above her head, along the line or at the target. The game
    // also draws shared light and ring layers on top; theme.c is the deep teal accent, keeping the hit readable instead of white.
    // m: {theme,launch,since,sx,sy,tx,ty,a,state}. launch 0->1 while the shot charges (after the cut-in),
    // since = seconds after the hit (negative before it). (sx,sy) = her muzzle, (tx,ty) = the target. e.spawned guards one-shot spawns.
    CommonCombatRunner.prototype.drawEpicMotif_triagesignal=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ang=Math.atan2(dy,dx),ux=dx/D,uy=dy/D,nx=-uy,ny=ux;
      const lockFade=since<0?1:epicClamp(1-since/.35);
      const sealCross=(x,y,r,alpha)=>{
        epicRing(ctx,x,y,r*1.18,r*.9,1.8,theme.c,alpha);
        epicStroke(ctx,[[x-r*.56,y],[x+r*.56,y]],Math.max(2,r*.26),theme.c,alpha);
        epicStroke(ctx,[[x,y-r*.56],[x,y+r*.56]],Math.max(2,r*.26),theme.c,alpha);
        epicStroke(ctx,[[x-r*.32,y],[x+r*.32,y]],Math.max(1,r*.1),theme.b,.95*alpha);
        epicStroke(ctx,[[x,y-r*.32],[x,y+r*.32]],Math.max(1,r*.1),theme.b,.95*alpha);
      };
      if(launch>0&&lockFade>0){const q=epicSmooth(launch),reach=epicSmooth(launch*1.2),cx=sx+ux*24,cy=sy+uy*24;
        // Two teal rescue arcs open around the target while paired route rails carry the signal from Bella's carbine.
        solid(ctx,()=>{
          for(const k of [-1,1]){
            const ox=nx*k*7,oy=ny*k*7;
            epicStroke(ctx,[[cx+ox,cy+oy],[cx+dx*reach+ox,cy+dy*reach+oy]],2.2,theme.c,.78*lockFade);
            for(let i=1;i<=3;i++){const f=((launch*1.45+i/4)%1);if(f>reach)continue;
              epicPoly(ctx,cx+dx*f+ox,cy+dy*f+oy,4.2,4,ang,1.1,theme.a,.92*lockFade,.48*lockFade);}
          }
          for(let j=0;j<2;j++){
            const phase=launch*1.35+j*Math.PI*.92,start=-Math.PI*.78+phase,rx=40+66*q,ry=rx*.62;
            epicRing(ctx,tx,ty,rx,ry,5.2, j?theme.c:theme.core,.82*q*lockFade,0,start,start+Math.PI*1.26);
            const mark=start+Math.PI*(.32+.7*epicSmooth(launch));
            epicPoly(ctx,tx+Math.cos(mark)*rx,ty+Math.sin(mark)*ry,5.4,4,mark,1.4,theme.b,.95*lockFade,.8*lockFade);
          }
          sealCross(tx,ty,8+5*q,.78*q*lockFade);
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,sx+ux*24,sy+uy*24,7+9*launch,theme.core,.45*launch*lockFade);
        epicGlowAt(ctx,tx,ty,8+10*q,"#ffffff",.58*q*lockFade);ctx.restore();
      }
      if(since>=0){const f=1-epicClamp(since/1.2),grow=epicOut(since/.55),rx=36+188*grow,ry=rx*.57;
        // The paired arcs sweep into a patient-protection ring; a clear triage cross remains inside the seal.
        solid(ctx,()=>{
          for(let j=0;j<2;j++){
            const phase=a*.18+j*Math.PI,start=-Math.PI*.92+phase+since*.22;
            epicRing(ctx,tx,ty,rx,ry,6.2*(1-grow)+1.4,j?theme.c:theme.core,.86*(1-grow)*f,0,start,start+Math.PI*1.18);
          }
          epicRing(ctx,tx,ty,22+rx*.18,15+ry*.2,2.4*f+.5,theme.a,.88*f);
          sealCross(tx,ty,10+6*(1-grow),.92*f);
          for(let i=0;i<4;i++){
            const mark=i*Math.PI/2+a*.08,rxx=22+rx*.18,ryy=15+ry*.2,x=tx+Math.cos(mark)*rxx,y=ty+Math.sin(mark)*ryy;
            epicPoly(ctx,x,y,4.6,4,mark,1.1,theme.b,.92*f,.72*f);
          }
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.28)epicGlowLine(ctx,sx+ux*24,sy+uy*24,tx,ty,3.2*(1-since/.28),theme.core,.42*(1-since/.28));
        epicGlowAt(ctx,tx,ty,12+20*epicOut(since/.3),theme.core,.38*f);
        epicGlowAt(ctx,tx,ty,4.2,"#ffffff",.8*f);ctx.restore();
        if(!e.spawned.triagesignal){e.spawned.triagesignal=true;
          epicSpawn(state,tx,ty,20,{kind:"spark",speed:[240,700],angle:ang,spread:Math.PI*2,life:[.28,.64],size:[1.2,2.5],colors:[theme.core,theme.a,theme.b],grav:190,drag:.91});
          epicSpawn(state,tx,ty-12,10,{kind:"ember",speed:[55,220],life:[.55,1.1],size:[2.5,5],colors:[theme.a,theme.b,theme.c],grav:-32,drag:.94});}
      }
    };
  }
  // <<< CHAR_VFX bella
  // >>> CHAR_VFX somi (tools/char_pipeline/vfx/somi.js sha256 3ad04ab19d0fec12; installed by vfx_lib.py)
  {
    // CHAR_VFX somi — 소미 (R-04). Six-barrel relay cannon and the TRIANGULAR_LATTICE ultimate “끊기지 않은 답신”.
    // Palette: main #e72f83 (theme.a), light #f4eabb (theme.core), accent #b6b939 (theme.c), dark #32282c (theme.b).
    //
    // Runtime helpers you can call (all draw on ctx; alpha fades are your job):
    //   epicGlowAt(ctx,x,y,r,color,alpha,hot=true)            soft round glow. hot=false keeps the colour (use for green/gold/brass).
    //   epicGlowLine(ctx,x1,y1,x2,y2,thick,color,alpha,hot)   soft glow along a segment.
    //   epicStroke(ctx,[[x,y],...],width,color,alpha)          round-capped polyline.
    //   epicRing(ctx,x,y,rx,ry,width,color,alpha,rot=0,a0=0,a1=2PI)   ellipse outline or arc.
    //   epicPoly(ctx,x,y,radius,sides,rot,width,color,alpha,fillAlpha=0)   regular polygon; fillAlpha is ABSOLUTE (multiply by your fade).
    //   epicRays(ctx,x,y,count,inner,outer,spread,color,alpha,spin,seed)    filled ray burst.
    //   epicSpawn(state,x,y,count,{kind:"spark"|"ember",speed:[a,b],angle,spread,life:[a,b],size:[a,b],colors:[...],grav,drag})
    //   epicClamp(v) 0..1, epicOut(v) ease-out, epicSmooth(v) smoothstep, epicIn(v) ease-in, epicHash(n) 0..1.
    // Rules:
    //   - Coloured haze and solid shapes use source-over via solid(). Additive "lighter" is for white/light cores only.
    //   - Every ctx.save() has a matching ctx.restore(). Do not touch document/window/timers/game state.
    //   - Particles only via epicSpawn, once per ultimate guarded by e.spawned.relaytriad. Sparks and round embers only.
    //   - Hit input v only has x, y and age. Shot direction comes from q; never read an angle from v.

    CHAR_VFX_THEMES.somi={motif:"relaytriad",core:"#f4eabb",a:"#e72f83",b:"#32282c",c:"#b6b939"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // Six shallow flutes and a blunt central jacket distinguish the rotary-cannon slug.
    const headMark=(ctx,x,y,ux,uy,len,w,color,alpha)=>{const nx=-uy,ny=ux;
      const pts=[[x+ux*len,y+uy*len],[x+nx*w*.62,y+ny*w*.62],
        [x+ux*len*.3+nx*w,y+uy*len*.3+ny*w],[x+ux*len*.08,y+uy*len*.08],
        [x-nx*w,y-ny*w],[x-ux*len*.3-nx*w*.62,y-uy*len*.3-ny*w*.62],
        [x-ux*len,y-uy*len],[x-ux*len*.3+nx*w*.62,y-uy*len*.3+ny*w*.62],
        [x-nx*w,y-ny*w],[x+ux*len*.08,y+uy*len*.08],
        [x+ux*len*.3-nx*w,y+uy*len*.3-ny*w],[x+nx*w*.62,y+ny*w*.62],
        [x+ux*len,y+uy*len]];
      epicStroke(ctx,pts,Math.max(1.3,w*.38),color,alpha);
      epicStroke(ctx,[[x-ux*len*.42,y-uy*len*.42],[x+ux*len*.42,y+uy*len*.42]],Math.max(1,w*.2),"#f4eabb",alpha*.78);};

    // Normal/heavy shot and impact. q: {x,y,px,py,heavy,...}; v: {x,y,age} only.
    CHAR_VFX_SHOTS["rotary-shell"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux,h=q.heavy?1.32:1;
        solid(ctx,()=>{
          epicGlowLine(ctx,q.px-dx*2.4,q.py-dy*2.4,q.x,q.y,7*h,"#32282c",.86,false);
          epicGlowLine(ctx,q.px-dx*2,q.py-dy*2,q.x,q.y,4.2*h,"#e72f83",.84,false);
          for(let i=0;i<3;i++){const f=.35+i*.28,side=i%2?1:-1,reach=(5-i)*h;
            epicStroke(ctx,[[q.x-dx*f+nx*reach*side,q.y-dy*f+ny*reach*side],
              [q.x-dx*(f+.16)+nx*reach*.3*side,q.y-dy*(f+.16)+ny*reach*.3*side]],1.7*h,"#b6b939",.88);}
          headMark(ctx,q.x-ux*4*h,q.y-uy*4*h,ux,uy,12*h,4.5*h,"#b6b939",.98);
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowLine(ctx,q.px-dx*1.3,q.py-dy*1.3,q.x,q.y,1.5*h,"#f4eabb",.9);
        epicGlowAt(ctx,q.x,q.y,2.6*h,"#ffffff",.82);ctx.restore();
      },
      impact(ctx,v){
        const t=Math.min(1,(v.age||0)/.5),p=1-t,u=epicOut(Math.min(1,t*2.4)),ux=0,uy=-1,nx=1,ny=0;
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,11+20*u,"#f4eabb",.62*p);
        epicGlowAt(ctx,v.x,v.y,4.5,"#ffffff",.88*p);ctx.restore();
        solid(ctx,()=>{
          for(let k=0;k<3;k++){const r=7+(13+k*8)*epicOut(epicClamp(t*1.7-k*.16));
            epicRing(ctx,v.x,v.y,r,r*.64,1.5,"#e72f83",(.76-k*.12)*(1-epicClamp(t*1.4-k*.2))*p,k*.18);}
          for(let i=0;i<6;i++){const a=i*Math.PI/3-Math.PI/2,ca=Math.cos(a),sa=Math.sin(a),r0=8+7*u,r1=15+19*u;
            epicStroke(ctx,[[v.x+ca*r0,v.y+sa*r0],[v.x+ca*r1,v.y+sa*r1]],2.1,"#b6b939",.92*p);
            epicRing(ctx,v.x+ca*(r1+3),v.y+sa*(r1+3),2.3,2.3,1,"#f4eabb",.84*p);
          }
          epicStroke(ctx,[[v.x+nx*4,v.y+ny*4],[v.x+ux*17,v.y+uy*17]],1.4,"#32282c",.82*p);
        });
      }
    };

    // Six short combustion vanes flare from the rotary muzzle, aligned to its actual aim axis.
    MUZZLE_STYLES.somi=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(24+18*epicOut(t))*g;
      solid(ctx,()=>{
        epicGlowAt(ctx,m.x,m.y,(13+8*t)*g,"#e72f83",.6*p,false);
        epicGlowLine(ctx,m.x-c*7*g,m.y-s2*7*g,m.x+c*L,m.y+s2*L,5.5*g,"#32282c",.82*p,false);
        epicGlowLine(ctx,m.x,m.y,m.x+c*L*.82,m.y+s2*L*.82,3.2*g,"#e72f83",.9*p,false);
        for(let i=0;i<6;i++){const k=i-2.5,base=3.2*g,tip=(14+9*(i%2))*g;
          epicStroke(ctx,[[m.x+nx*k*base,m.y+ny*k*base],
            [m.x+c*L*.52+nx*k*tip,m.y+s2*L*.52+ny*k*tip],
            [m.x+c*L*.82+nx*k*base*.65,m.y+s2*L*.82+ny*k*base*.65]],(1.7*p+.4)*g,i%2?"#b6b939":"#f4eabb",.94*p);}
      });
      ctx.save();ctx.globalCompositeOperation="lighter";
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.7,m.y+s2*L*.7,1.5*g,"#f4eabb",.92*p);
      epicGlowAt(ctx,m.x,m.y,5.5*g,"#ffffff",p);ctx.restore();
    };

    // The game clips below the muzzle line. Put the three triangular lock frames at the target.
    const relayTriangle=(ctx,x,y,r,rot,width,color,alpha)=>{const pts=[];
      for(let i=0;i<3;i++){const a=rot-Math.PI/2+i*Math.PI*2/3;pts.push([x+Math.cos(a)*r,y+Math.sin(a)*r]);}
      epicStroke(ctx,[pts[0],pts[1],pts[2],pts[0]],width,color,alpha);};

    CommonCombatRunner.prototype.drawEpicMotif_relaytriad=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ang=Math.atan2(dy,dx);
      const lockFade=since<0?1:epicClamp(1-since/.35);
      if(launch>0&&lockFade>0){const q=epicSmooth(launch),reach=epicSmooth(launch*1.3);
        solid(ctx,()=>{
          for(let i=0;i<9;i++){const f0=i/9,f1=Math.min(1,f0+.045);if(f0>reach)break;
            epicStroke(ctx,[[sx+dx*f0,sy+dy*f0],[sx+dx*Math.min(f1,reach),sy+dy*Math.min(f1,reach)]],2.2,theme.c,.82*lockFade);}
          for(let i=0;i<3;i++){const r=178+21*i+18*q,rot=-Math.PI/2+i*.19+launch*.12;
            relayTriangle(ctx,tx,ty,r,rot,6,[theme.a,theme.c,theme.b][i],(.72-i*.1)*q*lockFade);}
          for(let i=0;i<3;i++){const rot=-Math.PI/2+i*.19+launch*.12,a0=rot-Math.PI/2;
            epicRing(ctx,tx+Math.cos(a0)*200,ty+Math.sin(a0)*200,5,5,1.4,theme.core,.8*q*lockFade);}
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,tx,ty,12+12*launch,theme.core,.66*launch*lockFade);
        epicGlowAt(ctx,tx,ty,4+5*launch,"#ffffff",.86*launch*lockFade);ctx.restore();
      }
      if(since>=0){const f=1-epicClamp(since/1.2),expand=epicOut(epicClamp(since/.34));
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.35){const bf=1-since/.35;epicGlowLine(ctx,sx,sy,tx,ty,5.5*bf+1.2,theme.core,.78*bf);}
        epicGlowAt(ctx,tx,ty,34+56*expand,theme.core,.66*f);
        epicGlowAt(ctx,tx,ty,22,"#ffffff",.72*f);ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,tx,ty,58+66*expand,theme.a,.68*f,false);
          for(let i=0;i<3;i++){const r=180+20*i+40*expand,rot=-Math.PI/2+i*.2+a*.04;
            relayTriangle(ctx,tx,ty,r,rot,6,[theme.c,theme.a,theme.b][i],(.92-i*.17)*(1-expand*.4)*f);}
          for(let i=0;i<3;i++){const angle=-Math.PI/2+i*Math.PI*2/3,rr=82+48*expand;
            epicStroke(ctx,[[tx+Math.cos(angle)*rr,ty+Math.sin(angle)*rr],
              [tx-Math.cos(angle)*rr*.18,ty-Math.sin(angle)*rr*.18]],2.2,theme.c,.72*(1-expand*.35)*f);}
          epicRays(ctx,tx,ty,9,12,42+86*expand,.035,theme.c,.62*f,a*.12,64);
        });
        if(!e.spawned.relaytriad){e.spawned.relaytriad=true;
          epicSpawn(state,tx,ty,21,{kind:"spark",speed:[280,760],angle:ang,spread:Math.PI*2,life:[.28,.62],size:[1.2,2.5],colors:[theme.core,theme.a,theme.c],grav:200,drag:.91});
          epicSpawn(state,tx,ty-12,9,{kind:"ember",speed:[70,240],life:[.55,1.1],size:[2.5,5],colors:[theme.a,theme.c,theme.core],grav:-28,drag:.94});}
      }
    };
  }
  // <<< CHAR_VFX somi
  // >>> CHAR_VFX dana (tools/char_pipeline/vfx/dana.js sha256 02fe566e53c8d4f8; installed by vfx_lib.py)
  {
    // CHAR_VFX dana — 다나 (SR-11). Relay Union observer with the twin-fork vanguard carbine and the TRIANGULAR_LATTICE
    // ultimate “현재 시각의 좌표”: every hit is stamped like a surveyed bullet mark ("좌표와 시각을 전부 적었습니다").
    // Palette: main #5e9fe9 (theme.a, her record tablet), light #eaf4ff (theme.core), accent #f57f2a (theme.c, power cell),
    // dark #373d56 (theme.b, navy shorts and boots).
    //
    // Runtime helpers you can call (all draw on ctx; alpha fades are your job):
    //   epicGlowAt(ctx,x,y,r,color,alpha,hot=true)            soft round glow. hot=false keeps the colour (use for green/gold/brass).
    //   epicGlowLine(ctx,x1,y1,x2,y2,thick,color,alpha,hot)   soft glow along a segment.
    //   epicStroke(ctx,[[x,y],...],width,color,alpha)          round-capped polyline.
    //   epicRing(ctx,x,y,rx,ry,width,color,alpha,rot=0,a0=0,a1=2PI)   ellipse outline or arc.
    //   epicPoly(ctx,x,y,radius,sides,rot,width,color,alpha,fillAlpha=0)   regular polygon; fillAlpha is ABSOLUTE (multiply by your fade).
    //   epicRays(ctx,x,y,count,inner,outer,spread,color,alpha,spin,seed)    filled ray burst.
    //   epicSpawn(state,x,y,count,{kind:"spark"|"ember",speed:[a,b],angle,spread,life:[a,b],size:[a,b],colors:[...],grav,drag})
    //   epicClamp(v) 0..1, epicOut(v) ease-out, epicSmooth(v) smoothstep, epicIn(v) ease-in, epicHash(n) 0..1.
    // Rules:
    //   - Coloured haze and solid shapes use source-over via solid(). Additive "lighter" is for white/light cores only.
    //   - Every ctx.save() has a matching ctx.restore(). Do not touch document/window/timers/game state.
    //   - Particles only via epicSpawn, once per ultimate guarded by e.spawned.timestampfix. Sparks and round embers only.
    //   - Hit input v only has x, y and age. Shot direction comes from q; never read an angle from v.

    CHAR_VFX_THEMES.dana={motif:"timestampfix",core:"#eaf4ff",a:"#5e9fe9",b:"#373d56",c:"#f57f2a"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // The pulse head is her carbine's twin fork: two forward prongs joined at a short stem, the orange cell dot behind.
    const headMark=(ctx,x,y,ux,uy,len,w,color,alpha)=>{const nx=-uy,ny=ux;
      for(const s of [-1,1])epicStroke(ctx,[[x-ux*len*.15+nx*w*.25*s,y-uy*len*.15+ny*w*.25*s],[x+ux*len*.25+nx*w*s,y+uy*len*.25+ny*w*s],
        [x+ux*len+nx*w*.8*s,y+uy*len+ny*w*.8*s]],Math.max(1.2,w*.3),color,alpha);
      epicStroke(ctx,[[x-ux*len*.6,y-uy*len*.6],[x-ux*len*.12,y-uy*len*.12]],Math.max(1.3,w*.36),color,alpha);
      epicGlowAt(ctx,x-ux*len*.72,y-uy*len*.72,Math.max(1.6,w*.45),"#f57f2a",alpha,false);};

    // A survey reticle: four corner brackets around a point (the mark she writes down).
    const reticle=(ctx,x,y,r,arm,width,color,alpha,rot=0)=>{
      for(let i=0;i<4;i++){const a=rot+Math.PI/4+i*Math.PI/2,ca=Math.cos(a),sa=Math.sin(a),px=x+ca*r,py=y+sa*r;
        const bx=Math.cos(a+Math.PI*.75),by=Math.sin(a+Math.PI*.75),cx=Math.cos(a-Math.PI*.75),cy=Math.sin(a-Math.PI*.75);
        epicStroke(ctx,[[px+bx*arm,py+by*arm],[px,py],[px+cx*arm,py+cy*arm]],width,color,alpha);}};

    CHAR_VFX_SHOTS["fork-pulse"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux,h=q.heavy?1.35:1;
        solid(ctx,()=>{
          epicGlowLine(ctx,q.px-dx*2.4,q.py-dy*2.4,q.x,q.y,6.5*h,"#373d56",.8,false);
          epicGlowLine(ctx,q.px-dx*2.1,q.py-dy*2.1,q.x,q.y,3.8*h,"#5e9fe9",.85,false);
          for(let k=1;k<=3;k++){const f=k*.55,tl=(k%2?5:3)*h;                                  // timestamp ticks along the wake
            epicStroke(ctx,[[q.x-dx*f+nx*tl,q.y-dy*f+ny*tl],[q.x-dx*f-nx*tl,q.y-dy*f-ny*tl]],1.4*h,"#f57f2a",.9-k*.18);}
          headMark(ctx,q.x-ux*4*h,q.y-uy*4*h,ux,uy,12*h,4.4*h,"#5e9fe9",.98);
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowLine(ctx,q.px-dx*1.2,q.py-dy*1.2,q.x,q.y,1.4*h,"#eaf4ff",.9);
        epicGlowAt(ctx,q.x,q.y,2.8*h,"#ffffff",.85);ctx.restore();
      },
      impact(ctx,v){
        const t=Math.min(1,(v.age||0)/.48),p=1-t,snap=epicOut(Math.min(1,t*2.8)),u=epicOut(Math.min(1,t*1.6));
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,10+16*u,"#eaf4ff",.62*p);epicGlowAt(ctx,v.x,v.y,4.5,"#ffffff",.9*p);ctx.restore();
        solid(ctx,()=>{
          reticle(ctx,v.x,v.y,20-8*snap,7,2.1,"#5e9fe9",.95*p);                                 // the stamp closes onto the mark
          epicPoly(ctx,v.x,v.y,9+22*u,4,Math.PI/4,1.4,"#5e9fe9",.7*(1-u)*p);
          for(const [ax,ay] of [[1,0],[0,1]])epicStroke(ctx,[[v.x-ax*(6+10*snap),v.y-ay*(6+10*snap)],[v.x+ax*(6+10*snap),v.y+ay*(6+10*snap)]],1.3,"#373d56",.85*p);
          epicStroke(ctx,[[v.x+14,v.y-14],[v.x+14+10*snap,v.y-14]],2,"#f57f2a",.95*p);           // the time tick written beside it
          epicStroke(ctx,[[v.x+14,v.y-9],[v.x+14+6*snap,v.y-9]],1.6,"#f57f2a",.8*p);
        });
      }
    };

    // Twin fork discharge: two holo-blue prongs split from the muzzle along the aim axis, an orange cell spark between.
    MUZZLE_STYLES.dana=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(22+16*epicOut(t))*g,sp=(4+7*epicOut(t))*g;
      solid(ctx,()=>{epicGlowAt(ctx,m.x,m.y,(12+7*t)*g,"#5e9fe9",.55*p,false);
        epicGlowLine(ctx,m.x-c*6*g,m.y-s2*6*g,m.x+c*L*.5,m.y+s2*L*.5,4.5*g,"#373d56",.75*p,false);
        for(const k of [-1,1])epicStroke(ctx,[[m.x+nx*k*2*g,m.y+ny*k*2*g],[m.x+c*L*.45+nx*k*sp,m.y+s2*L*.45+ny*k*sp],
          [m.x+c*L+nx*k*sp*.7,m.y+s2*L+ny*k*sp*.7]],(1.8*p+.5)*g,"#5e9fe9",.95*p);
        epicGlowAt(ctx,m.x+c*4*g,m.y+s2*4*g,3.5*g,"#f57f2a",.95*p,false);});
      ctx.save();ctx.globalCompositeOperation="lighter";
      for(const k of [-1,1])epicGlowLine(ctx,m.x,m.y,m.x+c*L*.8+nx*k*sp*.6,m.y+s2*L*.8+ny*k*sp*.6,1.2*g,"#eaf4ff",.9*p);
      epicGlowAt(ctx,m.x,m.y,5.5*g,"#ffffff",p);ctx.restore();
    };

    // ---- ultimate: three survey markers triangulate the target (radius 200), orange time ticks run along the triangle edges,
    // the fix locks and a white-hot burst stamps the point inside a reticle. Drawn at the target (the game clips below her muzzle).
    CommonCombatRunner.prototype.drawEpicMotif_timestampfix=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,ang=Math.atan2(dy,dx);
      const lockFade=since<0?1:epicClamp(1-since/.35),R=200,rot=-Math.PI/2;
      const vtx=r=>[0,1,2].map(i=>{const q=rot+i*Math.PI*2/3;return [tx+Math.cos(q)*r,ty+Math.sin(q)*r*.62];});
      if(launch>0&&lockFade>0){const q=epicSmooth(launch),draw=epicSmooth(epicClamp(launch*1.4-.15)),V=vtx(R*(1.1-.1*q));
        solid(ctx,()=>{
          for(let i=-2;i<=2;i++){                                                                 // faint coordinate grid
            epicStroke(ctx,[[tx-R*.9,ty+i*34],[tx+R*.9,ty+i*34]],1,theme.a,.22*q*lockFade);
            epicStroke(ctx,[[tx+i*56,ty-R*.55],[tx+i*56,ty+R*.55]],1,theme.a,.22*q*lockFade);}
          V.forEach(([x,y],i)=>{const on=epicClamp(launch*3-i*.45);if(on<=0)return;               // the three marker pins
            epicStroke(ctx,[[x,y-22*on],[x,y+4]],5,theme.b,.9*lockFade);
            epicStroke(ctx,[[x,y-22*on],[x,y+4]],2.4,theme.a,.98*lockFade);
            epicStroke(ctx,[[x-9,y+7],[x,y+2],[x+9,y+7]],2,theme.a,.9*on*lockFade);
            epicGlowAt(ctx,x,y-22*on,6,theme.c,.95*on*lockFade,false);
            epicRing(ctx,x,y+4,12*on,5*on,1.4,theme.core,.7*on*lockFade);});
          for(let i=0;i<3;i++){const [x0,y0]=V[i],[x1,y1]=V[(i+1)%3],f=draw;if(f<=0)continue;         // triangulation lines
            epicStroke(ctx,[[x0,y0],[x0+(x1-x0)*f,y0+(y1-y0)*f]],2.4,theme.a,.8*lockFade);
            for(let k=1;k<6;k++){const g=k/6;if(g>f)break;const mx=x0+(x1-x0)*g,my=y0+(y1-y0)*g,ex=-(y1-y0),ey=x1-x0,el=Math.hypot(ex,ey)||1;
              epicStroke(ctx,[[mx-ex/el*5,my-ey/el*5],[mx+ex/el*5,my+ey/el*5]],1.6,theme.c,.9*lockFade);}}
          V.forEach(([x,y])=>epicStroke(ctx,[[x,y],[x+(tx-x)*draw*.85,y+(ty-y)*draw*.85]],1.2,theme.core,.45*q*lockFade));
          reticle(ctx,tx,ty,60-26*q,16,2.4,theme.a,.85*q*lockFade);
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,tx,ty,10+14*launch,theme.core,.7*launch*lockFade);epicGlowAt(ctx,tx,ty,4+5*launch,"#ffffff",.85*launch*lockFade);ctx.restore();}
      if(since>=0){const f=1-epicClamp(since/1.2),u=epicOut(epicClamp(since/.32)),V=vtx(R*(1-.55*u));
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.35){const bf=1-since/.35;epicGlowLine(ctx,sx,sy,tx,ty,5*bf+1.2,theme.core,.8*bf);}
        epicGlowAt(ctx,tx,ty,36+58*u,theme.core,.68*f);epicGlowAt(ctx,tx,ty,22,"#ffffff",.8*f);ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,tx,ty,60+80*u,theme.a,.66*f,false);
          epicStroke(ctx,[V[0],V[1],V[2],V[0]],5*(1-u)+1.5,theme.a,.9*f);                       // the triangle locks onto the point
          V.forEach(([x,y])=>epicStroke(ctx,[[x,y],[tx,ty]],2,theme.c,.75*(1-u)*f));
          reticle(ctx,tx,ty,28+120*u,18+14*u,6*(1-u)+2.4,theme.b,.85*f);                         // the stamp frame opens out
          reticle(ctx,tx,ty,28+120*u,18+14*u,3*(1-u)+1.2,theme.a,.95*f);
          epicPoly(ctx,tx,ty,40+190*u,4,Math.PI/4,2.2*(1-u)+.6,theme.c,.8*(1-u)*f);
          for(let i=0;i<4;i++){const y=ty-50-i*12;epicStroke(ctx,[[tx+64,y],[tx+64+(34-i*6)*u,y]],2,theme.c,.9*f*(1-i*.15));} // time ticks
          epicRays(ctx,tx,ty,6,14,44+120*u,.04,theme.c,.62*f,a*.2,73);
        });
        if(!e.spawned.timestampfix){e.spawned.timestampfix=true;
          epicSpawn(state,tx,ty,22,{kind:"spark",speed:[300,850],angle:ang,spread:Math.PI*2,life:[.28,.65],size:[1.2,2.6],colors:[theme.core,theme.a,theme.c],grav:210,drag:.9});
          epicSpawn(state,tx,ty-14,10,{kind:"ember",speed:[70,260],life:[.55,1.2],size:[2.5,5],colors:[theme.a,theme.c,theme.core],grav:-32,drag:.93});}}
    };
  }
  // <<< CHAR_VFX dana
  // >>> CHAR_VFX mei (tools/char_pipeline/vfx/mei.js sha256 bf632ea48131abe7; installed by vfx_lib.py)
  {
    // CHAR_VFX mei — 메이 (SR-15). Field nurse with the long ivory surveyor rifle; her shot is a name-tag dart (a sage paper tag
    // with a plum-inked name behind a fine needle: "약품 상자마다 환자 이름표를 붙여 뒀어요"). Her SPEAR_CORE_PETALS ultimate
    // “깨어나실 때까지” opens eight consent slips around the target and folds them onto a white-hot ivory core with one soft
    // mint pressure ring ("저분들이 직접 말할 수 있을 때까지요").
    // Palette: main #8fd2b4 (theme.a, mint glow = her sage lifted), light #f4f1e8 (theme.core, ivory), accent #9daca0
    // (theme.c, sage top and apron), dark #4f333e (theme.b, plum hair and ink).
    //
    // Runtime helpers you can call (all draw on ctx; alpha fades are your job):
    //   epicGlowAt(ctx,x,y,r,color,alpha,hot=true)            soft round glow. hot=false keeps the colour (use for green/gold/brass).
    //   epicGlowLine(ctx,x1,y1,x2,y2,thick,color,alpha,hot)   soft glow along a segment.
    //   epicStroke(ctx,[[x,y],...],width,color,alpha)          round-capped polyline.
    //   epicRing(ctx,x,y,rx,ry,width,color,alpha,rot=0,a0=0,a1=2PI)   ellipse outline or arc.
    //   epicPoly(ctx,x,y,radius,sides,rot,width,color,alpha,fillAlpha=0)   regular polygon; fillAlpha is ABSOLUTE (multiply by your fade).
    //   epicRays(ctx,x,y,count,inner,outer,spread,color,alpha,spin,seed)    filled ray burst.
    //   epicSpawn(state,x,y,count,{kind:"spark"|"ember",speed:[a,b],angle,spread,life:[a,b],size:[a,b],colors:[...],grav,drag})
    //   epicClamp(v) 0..1, epicOut(v) ease-out, epicSmooth(v) smoothstep, epicIn(v) ease-in, epicHash(n) 0..1.
    // Rules:
    //   - Coloured haze, tags and petals are drawn source-over via solid(). Additive "lighter" is for ivory/white cores only.
    //   - Every ctx.save() has a matching ctx.restore(). Do not touch document/window/timers/game state.
    //   - Particles only via epicSpawn, once per ultimate guarded by e.spawned.consentbloom. Sparks and round embers only.
    //   - Hit input v only has x, y and age. Shot direction comes from q; never read an angle from v.

    CHAR_VFX_THEMES.mei={motif:"consentbloom",core:"#f4f1e8",a:"#8fd2b4",b:"#4f333e",c:"#9daca0"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // A paper slip along unit (ux,uy) from r0 to r1 around (cx,cy): pointed front, square back, a punched hole and two
    // handwritten plum lines. sq squashes y (the ultimate lies flat on the ground at .62; a flying tag uses 1).
    const slip=(ctx,cx,cy,ux,uy,r0,r1,w,sq,fill,line,alpha)=>{if(alpha<=0||r1<=r0)return;const L=r1-r0;
      const P=(f,s)=>{const d=r0+L*f;return [cx+ux*d-uy*w*s,cy+(uy*d+ux*w*s)*sq];};
      ctx.save();ctx.globalAlpha*=alpha;ctx.beginPath();
      for(const [f,s] of [[0,-.5],[0,.5],[.84,.5],[1,0],[.84,-.5]]){const [px,py]=P(f,s);ctx.lineTo(px,py);}
      ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.lineWidth=Math.max(1,w*.12);ctx.strokeStyle=line;ctx.stroke();
      ctx.beginPath();for(const [f,s] of [[.06,-.34],[.06,.34],[.62,.34],[.62,-.34]]){const [px,py]=P(f,s);ctx.lineTo(px,py);}  // the paper label
      ctx.closePath();ctx.fillStyle="#e2dad0";ctx.globalAlpha*=.92;ctx.fill();ctx.restore();
      for(const s of [.16,-.1])epicStroke(ctx,[P(.12,s),P(.52,s)],Math.max(.8,w*.07),line,.85*alpha);
      const [hx,hy]=P(.76,0);epicGlowAt(ctx,hx,hy,Math.max(1.2,w*.12),line,alpha,false);};

    // The dart head: a fine ivory needle in front of her name tag.
    const headMark=(ctx,x,y,ux,uy,len,w,alpha)=>{
      epicStroke(ctx,[[x+ux*len*.2,y+uy*len*.2],[x+ux*len,y+uy*len]],Math.max(1,w*.24),"#e2dad0",alpha);
      slip(ctx,x,y,ux,uy,-len*.75,len*.2,w*2,1,"#9daca0","#4f333e",alpha);};

    // A small medical cross, mint over a plum shadow.
    const cross=(ctx,x,y,r,width,alpha)=>{
      for(const [col,wd] of [["#4f333e",width+1.6],["#8fd2b4",width]]){
        epicStroke(ctx,[[x-r,y],[x+r,y]],wd,col,alpha);epicStroke(ctx,[[x,y-r],[x,y+r]],wd,col,alpha);}};

    CHAR_VFX_SHOTS["tag-dart"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux,h=q.heavy?1.35:1;
        solid(ctx,()=>{
          epicGlowLine(ctx,q.px-dx*2.3,q.py-dy*2.3,q.x,q.y,6*h,"#4f333e",.7,false);
          epicGlowLine(ctx,q.px-dx*2,q.py-dy*2,q.x,q.y,3.2*h,"#8fd2b4",.82,false);
          const pts=[];for(let k=0;k<=6;k++){const f=k/6*2.1,wv=Math.sin(k*1.9+q.y*.07)*2.4*h;             // a handwritten wake line
            pts.push([q.x-dx*f+nx*wv,q.y-dy*f+ny*wv]);}
          epicStroke(ctx,pts,1.2*h,"#e2dad0",.7);
          headMark(ctx,q.x-ux*3*h,q.y-uy*3*h,ux,uy,12*h,3.6*h,.98);
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowLine(ctx,q.px-dx*1.1,q.py-dy*1.1,q.x,q.y,1.3*h,"#f4f1e8",.85);
        epicGlowAt(ctx,q.x+ux*9*h,q.y+uy*9*h,2.6*h,"#ffffff",.85);ctx.restore();
      },
      impact(ctx,v){
        const t=Math.min(1,(v.age||0)/.46),p=1-t,snap=epicOut(Math.min(1,t*2.6)),u=epicOut(Math.min(1,t*1.5));
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,9+14*u,"#f4f1e8",.6*p);epicGlowAt(ctx,v.x,v.y,4,"#ffffff",.9*p);ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,v.x,v.y,12+12*u,"#8fd2b4",.35*p,false);
          epicRing(ctx,v.x,v.y,7+20*u,(7+20*u)*.7,1.8,"#8fd2b4",.85*(1-u)*p);                          // the soft vial pop
          const tu=Math.sin(.4),tv=Math.cos(.4);                                                         // the tag pinned on, hanging
          slip(ctx,v.x,v.y,tu,tv,2,2+18*(.6+.4*snap),7,1,"#9daca0","#4f333e",.95*p);
          epicStroke(ctx,[[v.x,v.y+2],[v.x,v.y-7*snap]],1.4,"#e2dad0",.95*p);                             // the needle in the target
          cross(ctx,v.x+13,v.y-13-5*snap,3+2*snap,2,.95*p);
        });
      }
    };

    // Pneumatic tap: a short puff of air rolls out of the long barrel, two sage vents blow back at the sides.
    MUZZLE_STYLES.mei=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(18+14*epicOut(t))*g,R=(5+10*epicOut(t))*g;
      solid(ctx,()=>{
        epicGlowLine(ctx,m.x-c*5*g,m.y-s2*5*g,m.x+c*L*.4,m.y+s2*L*.4,4*g,"#4f333e",.6*p,false);
        for(const [f,r] of [[.3,.6],[.62,.85],[.95,1]])epicGlowAt(ctx,m.x+c*L*f,m.y+s2*L*f,R*r,"#8fd2b4",.42*p,false);
        for(const k of [-1,1])epicStroke(ctx,[[m.x+nx*k*3*g,m.y+ny*k*3*g],[m.x+nx*k*(3*g+R*.7)-c*R*.4,m.y+ny*k*(3*g+R*.7)-s2*R*.4]],
          (1.4*p+.4)*g,"#9daca0",.9*p);});
      ctx.save();ctx.globalCompositeOperation="lighter";
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.6,m.y+s2*L*.6,1.3*g,"#f4f1e8",.9*p);
      epicGlowAt(ctx,m.x,m.y,5*g,"#ffffff",p);ctx.restore();
    };

    // ---- ultimate: eight consent slips (width 20, reach 250 = span 500) open around the target one after another, then fold
    // in onto a white-hot ivory core and one mint pressure ring rolls out. Drawn at the target (the game clips below her muzzle).
    CommonCombatRunner.prototype.drawEpicMotif_consentbloom=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,ang=Math.atan2(dy,dx);
      const lockFade=since<0?1:epicClamp(1-since/.35),N=8,W=20,R=250,R0=16;
      const petals=(reach,width,alpha)=>{for(let i=0;i<N;i++){const pa=-Math.PI/2+i*Math.PI*2/N+a*.05,o=reach(i);if(o<=0)continue;
        slip(ctx,tx,ty,Math.cos(pa),Math.sin(pa),R0,R0+(R-R0)*o,width*(.55+.45*o),.62,theme.c,theme.b,alpha);}};
      if(launch>0&&lockFade>0){const q=epicSmooth(launch),reach=epicSmooth(epicClamp(launch*1.3));
        solid(ctx,()=>{
          for(let i=0;i<14;i++){const f0=i/14,f1=f0+.45/14;if(f0>reach)break;                            // her guiding thread
            epicStroke(ctx,[[sx+dx*f0,sy+dy*f0],[sx+dx*Math.min(f1,reach),sy+dy*Math.min(f1,reach)]],1.8,theme.c,.8*lockFade);}
          epicGlowAt(ctx,tx,ty,R*.5*q,theme.a,.26*q*lockFade,false);
          petals(i=>epicSmooth(epicClamp(launch*1.7-i*.08)),W,.92*lockFade);                               // the slips open one by one
          epicRing(ctx,tx,ty,R0+10,(R0+10)*.62,2,theme.b,.7*q*lockFade);
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,tx,ty,10+18*launch,theme.core,.75*launch*lockFade);epicGlowAt(ctx,tx,ty,4+6*launch,"#ffffff",.9*launch*lockFade);ctx.restore();}
      if(since>=0){const f=1-epicClamp(since/1.2),fold=1-epicOut(epicClamp(since/.28)),ru=epicOut(epicClamp(since/.75));
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.35){const bf=1-since/.35;epicGlowLine(ctx,sx,sy,tx,ty,5*bf+1.2,theme.core,.8*bf);}
        epicGlowAt(ctx,tx,ty,16+20*epicOut(epicClamp(since/.3)),theme.core,.6*f);epicGlowAt(ctx,tx,ty,13,"#ffffff",.9*f);ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,tx,ty,44+46*ru,theme.a,.4*f*(1-ru*.6),false);
          epicGlowAt(ctx,tx,ty,26+22*ru,theme.core,.5*f,false);                                            // the ivory core, source-over
          petals(()=>fold,W,.92*fold*f);                                                                   // the slips fold onto the core
          epicRing(ctx,tx,ty,30+240*ru,(30+240*ru)*.62,5*(1-ru)+.8,theme.a,.9*(1-ru)*f);                   // one soft mint pressure ring
          epicRing(ctx,tx,ty,24+200*ru,(24+200*ru)*.62,2*(1-ru)+.5,theme.b,.7*(1-ru)*f);
          cross(ctx,tx,ty-54-40*ru,9+5*(1-fold),4,.9*f);
          epicRays(ctx,tx,ty,8,16,40+110*ru,.04,theme.c,.55*f,a*.2,57);
        });
        if(!e.spawned.consentbloom){e.spawned.consentbloom=true;
          epicSpawn(state,tx,ty,22,{kind:"spark",speed:[260,780],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.2,2.6],colors:[theme.core,theme.a,theme.c],grav:200,drag:.9});
          epicSpawn(state,tx,ty-14,14,{kind:"ember",speed:[70,260],life:[.7,1.4],size:[2.5,5.5],colors:[theme.c,theme.a,theme.core],grav:-36,drag:.93});}}
    };
  }
  // <<< CHAR_VFX mei
  // >>> CHAR_VFX yujin (tools/char_pipeline/vfx/yujin.js sha256 3080451709e10f88; installed by vfx_lib.py)
  {
    // CHAR_VFX yujin — 유진 (SR-01). Relay Union rescue lead with the six-barrel 바스티온 리피터; every shot is a short rotary burst of
    // heavy slugs and every hit a braced plate that holds the line. Her HORIZON_ARC ultimate “착륙 회랑” raises three landing-corridor
    // guide arcs over the target and slams them down into one braced shield line ("착륙 회랑은 내가 끝까지 비워 둔다").
    // Palette: main #46c2bf (theme.a, her teal crosses and cannon lights lifted), light #effaf8 (theme.core), accent #f08940
    // (theme.c, orange tabs), dark #383739 (theme.b, graphite armor and cannon); measured teal #318f92.
    //
    // Runtime helpers you can call (all draw on ctx; alpha fades are your job):
    //   epicGlowAt(ctx,x,y,r,color,alpha,hot=true)            soft round glow. hot=false keeps the colour (use for green/gold/brass).
    //   epicGlowLine(ctx,x1,y1,x2,y2,thick,color,alpha,hot)   soft glow along a segment.
    //   epicStroke(ctx,[[x,y],...],width,color,alpha)          round-capped polyline.
    //   epicRing(ctx,x,y,rx,ry,width,color,alpha,rot=0,a0=0,a1=2PI)   ellipse outline or arc.
    //   epicPoly(ctx,x,y,radius,sides,rot,width,color,alpha,fillAlpha=0)   regular polygon; fillAlpha is ABSOLUTE (multiply by your fade).
    //   epicRays(ctx,x,y,count,inner,outer,spread,color,alpha,spin,seed)    filled ray burst.
    //   epicSpawn(state,x,y,count,{kind:"spark"|"ember",speed:[a,b],angle,spread,life:[a,b],size:[a,b],colors:[...],grav,drag})
    //   epicClamp(v) 0..1, epicOut(v) ease-out, epicSmooth(v) smoothstep, epicIn(v) ease-in, epicHash(n) 0..1.
    // Rules:
    //   - Coloured haze, slugs, plates and arcs are drawn source-over via solid(). Additive "lighter" is for white/light cores only.
    //   - Every ctx.save() has a matching ctx.restore(). Do not touch document/window/timers/game state.
    //   - Particles only via epicSpawn, once per ultimate guarded by e.spawned.landingcorridor. Sparks and round embers only.
    //   - Hit input v only has x, y and age. Shot direction comes from q; never read an angle from v.

    CHAR_VFX_THEMES.yujin={motif:"landingcorridor",core:"#effaf8",a:"#46c2bf",b:"#383739",c:"#f08940"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // One heavy rotary slug: a blunt graphite casing with a teal core and a white band.
    const slug=(ctx,x,y,ux,uy,len,w,alpha)=>{
      epicStroke(ctx,[[x-ux*len*.5,y-uy*len*.5],[x+ux*len*.5,y+uy*len*.5]],w+2.2,"#383739",alpha);
      epicStroke(ctx,[[x-ux*len*.45,y-uy*len*.45],[x+ux*len*.42,y+uy*len*.42]],w,"#46c2bf",alpha);
      const nx=-uy,ny=ux;epicStroke(ctx,[[x+ux*len*.12+nx*w*.6,y+uy*len*.12+ny*w*.6],[x+ux*len*.12-nx*w*.6,y+uy*len*.12-ny*w*.6]],1.2,"#effaf8",alpha);};

    // A braced plate edge: a short arc bowed toward the camera, graphite rim under a teal face.
    const brace=(ctx,x,y,rx,ry,width,alpha)=>{
      epicRing(ctx,x,y,rx,ry,width+2.4,"#383739",alpha,0,Math.PI*1.1,Math.PI*1.9);
      epicRing(ctx,x,y,rx,ry,width,"#46c2bf",alpha,0,Math.PI*1.1,Math.PI*1.9);};

    CHAR_VFX_SHOTS["bastion-burst"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux,h=q.heavy?1.35:1;
        solid(ctx,()=>{
          epicGlowLine(ctx,q.px-dx*2.2,q.py-dy*2.2,q.x,q.y,7*h,"#383739",.7,false);
          epicGlowLine(ctx,q.px-dx*1.8,q.py-dy*1.8,q.x,q.y,3*h,"#46c2bf",.7,false);
          for(let k=0;k<3;k++){const b=k*9*h,s=(k-1)*3.2*h;                                           // the rotary burst: three slugs
            slug(ctx,q.x-ux*b+nx*s,q.y-uy*b+ny*s,ux,uy,9*h,2.6*h,.98-k*.12);}
          for(let k=1;k<=2;k++)epicGlowAt(ctx,q.x-dx*k*.9,q.y-dy*k*.9,(3-k)*1.6*h,"#f08940",.8-k*.25,false);   // hot orange tail
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,q.x+ux*4*h,q.y+uy*4*h,2.6*h,"#ffffff",.8);ctx.restore();
      },
      impact(ctx,v){
        const t=Math.min(1,(v.age||0)/.5),p=1-t,slam=epicOut(Math.min(1,t*3)),u=epicOut(Math.min(1,t*1.5));
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,9+12*u,"#effaf8",.55*p);epicGlowAt(ctx,v.x,v.y,4,"#ffffff",.9*p);ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,v.x,v.y,14+14*u,"#46c2bf",.3*p,false);
          brace(ctx,v.x,v.y+10-10*slam,24+8*u,12-6*slam,2.6,.95*p);                                     // the plate slams down
          for(const s of [-1,1]){const r0=10+6*slam,r1=18+16*slam;                                      // orange sparks thrown sideways
            epicStroke(ctx,[[v.x+s*r0,v.y+2],[v.x+s*r1,v.y+5+3*slam]],2,"#f08940",.95*p);
            epicStroke(ctx,[[v.x+s*(r0-2),v.y-4],[v.x+s*(r1-6),v.y-7]],1.4,"#f08940",.7*p);}
          epicRing(ctx,v.x,v.y+4,10+22*u,(10+22*u)*.4,1.6,"#383739",.7*(1-u)*p);                        // the dust ring at its foot
        });
      }
    };

    // Six-barrel muzzle: six flashes on a spinning ring across the aim line, a graphite smoke line and a hot orange core.
    MUZZLE_STYLES.yujin=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(20+14*epicOut(t))*g,R=5.5*g,spin=t*2.4;
      solid(ctx,()=>{
        epicGlowLine(ctx,m.x,m.y,m.x+c*L,m.y+s2*L,5*g*p+1,"#383739",.55*p,false);
        epicGlowAt(ctx,m.x+c*L*.35,m.y+s2*L*.35,(9+8*t)*g,"#46c2bf",.45*p,false);
        for(let i=0;i<6;i++){const a=spin+i*Math.PI/3,o=Math.cos(a)*R,d=Math.sin(a)*R*.45,fx=m.x+nx*o+c*d,fy=m.y+ny*o+s2*d;
          epicStroke(ctx,[[fx,fy],[fx+c*L*(.35+.2*(i%2)),fy+s2*L*(.35+.2*(i%2))]],(1.5*p+.4)*g,"#46c2bf",.9*p);}
        epicGlowAt(ctx,m.x,m.y,4*g,"#f08940",.95*p,false);});
      ctx.save();ctx.globalCompositeOperation="lighter";
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.7,m.y+s2*L*.7,1.4*g,"#effaf8",.9*p);
      epicGlowAt(ctx,m.x,m.y,5*g,"#ffffff",p);ctx.restore();
    };

    // ---- ultimate: three landing-corridor guide arcs (span 420, width 8) rise over the target with orange marker lamps running along
    // them toward the centre, then slam down into one braced shield line. Drawn at the target (the game clips below her muzzle).
    CommonCombatRunner.prototype.drawEpicMotif_landingcorridor=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,ang=Math.atan2(dy,dx);
      const lockFade=since<0?1:epicClamp(1-since/.35),SPAN=420,W=8,A=3;
      const arc=(k,rise,width,alpha,lamps)=>{const rx=SPAN/2*(1-k*.16),ry=(70+k*38)*rise,y=ty;if(ry<1||alpha<=0)return;
        epicRing(ctx,tx,y,rx,ry,width+3,theme.b,.85*alpha,0,Math.PI,Math.PI*2);
        epicRing(ctx,tx,y,rx,ry,width,theme.a,alpha,0,Math.PI,Math.PI*2);
        for(let i=1;i<8;i++){const q=Math.PI+i*Math.PI/8,on=lamps(i,k);if(on<=0)continue;                   // the marker lamps
          const lx=tx+Math.cos(q)*rx,ly=y+Math.sin(q)*ry;epicGlowAt(ctx,lx,ly,7+4*on,theme.c,.95*on*alpha,false);
          epicPoly(ctx,lx,ly,3.2,4,Math.PI/4,1.2,theme.b,alpha,.95*on*alpha);epicGlowAt(ctx,lx,ly,2.2,theme.core,on*alpha,false);}};
      if(launch>0&&lockFade>0){const q=epicSmooth(launch);
        solid(ctx,()=>{
          epicGlowAt(ctx,tx,ty,SPAN*.3*q,theme.a,.18*q*lockFade,false);
          for(let k=0;k<A;k++){const rise=epicSmooth(epicClamp(launch*1.8-k*.22));
            arc(k,rise,W*(1-k*.2),.92*lockFade,(i,kk)=>{const run=(launch*3+kk*.3)%1,pos=Math.abs(i-4)/4;return epicClamp(1-Math.abs(pos-(1-run))*4);});}
          epicStroke(ctx,[[tx,ty-260*q],[tx,ty-40]],2,theme.core,.5*q*lockFade);                            // the descent line
          epicStroke(ctx,[[tx-SPAN/2,ty],[tx+SPAN/2,ty]],2,theme.b,.5*q*lockFade);
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,tx,ty,8+14*launch,theme.core,.7*launch*lockFade);epicGlowAt(ctx,tx,ty,4+5*launch,"#ffffff",.85*launch*lockFade);ctx.restore();}
      if(since>=0){const f=1-epicClamp(since/1.2),down=1-epicOut(epicClamp(since/.22)),u=epicOut(epicClamp(since/.7));
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.35){const bf=1-since/.35;epicGlowLine(ctx,sx,sy,tx,ty,5*bf+1.2,theme.core,.8*bf);}
        epicGlowAt(ctx,tx,ty,16+20*epicOut(epicClamp(since/.3)),theme.core,.6*f);epicGlowAt(ctx,tx,ty,12,"#ffffff",.9*f);ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,tx,ty,50+60*u,theme.a,.4*f*(1-u*.6),false);
          for(let k=0;k<A;k++)arc(k,down,W*(1-k*.2),.9*down*f,()=>1);                                       // the arcs slam down
          const bw=SPAN*(.5+.1*u);                                                                           // the braced shield line
          epicStroke(ctx,[[tx-bw,ty],[tx+bw,ty]],W*1.6*(1-u)+3,theme.b,.9*f);
          epicStroke(ctx,[[tx-bw,ty],[tx+bw,ty]],W*(1-u)+1.6,theme.a,.95*f);
          for(let i=-3;i<=3;i++){const lx=tx+i*bw/3.4;epicGlowAt(ctx,lx,ty,8*(1-u)+4,theme.c,.95*f,false);  // lamps along the line
            epicGlowAt(ctx,lx,ty,2.4,theme.core,.9*f*(1-u),false);}
          epicRing(ctx,tx,ty,40+220*u,(40+220*u)*.3,3*(1-u)+.6,theme.b,.7*(1-u)*f);                         // dust thrown along the ground
          epicRays(ctx,tx,ty,6,12,36+100*u,.05,theme.c,.5*f,a*.15,31);
        });
        if(!e.spawned.landingcorridor){e.spawned.landingcorridor=true;
          epicSpawn(state,tx,ty,24,{kind:"spark",speed:[260,820],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.2,2.8],colors:[theme.core,theme.a,theme.c],grav:260,drag:.9});
          epicSpawn(state,tx,ty-10,10,{kind:"ember",speed:[60,220],life:[.6,1.3],size:[2.5,5],colors:[theme.c,theme.a,theme.core],grav:-30,drag:.93});}}
    };
  }
  // <<< CHAR_VFX yujin
  // >>> CHAR_VFX harin (tools/char_pipeline/vfx/harin.js sha256 59f26dcc87132d8b; installed by vfx_lib.py)
  {
    // CHAR_VFX harin — 하린 (R-08). Continuity Office custody archivist with the pump-action 하린 커스터디 브리치; every shot is one heavy
    // custody slug and every hit a hold seal pressed onto the target. Her SPEAR_CORE_PETALS ultimate “아흔세 칸” bursts nine pale archive
    // cards with empty name slots out of a white-hot breach core like a shotgun pattern, stops them in a ring and stamps them shut as one
    // navy hold seal ("이름이 비어 있는 아흔세 칸은 삭제가 아니라" kept as holds, not deleted).
    // Palette: main #ff5a48 (theme.a, her brick-red bob #9e3a32 lifted), light #fff3ec (theme.core), accent #ff9a6a (theme.c, the red
    // toward the breach heat), dark #2c2f3f (theme.b, navy crop top and shorts); the plate white #d0c8c4 is the card face only.
    //
    // Runtime helpers you can call (all draw on ctx; alpha fades are your job):
    //   epicGlowAt(ctx,x,y,r,color,alpha,hot=true)            soft round glow. hot=false keeps the colour (use for green/gold/brass).
    //   epicGlowLine(ctx,x1,y1,x2,y2,thick,color,alpha,hot)   soft glow along a segment.
    //   epicStroke(ctx,[[x,y],...],width,color,alpha)          round-capped polyline.
    //   epicRing(ctx,x,y,rx,ry,width,color,alpha,rot=0,a0=0,a1=2PI)   ellipse outline or arc.
    //   epicPoly(ctx,x,y,radius,sides,rot,width,color,alpha,fillAlpha=0)   regular polygon; fillAlpha is ABSOLUTE (multiply by your fade).
    //   epicRays(ctx,x,y,count,inner,outer,spread,color,alpha,spin,seed)    filled ray burst.
    //   epicSpawn(state,x,y,count,{kind:"spark"|"ember",speed:[a,b],angle,spread,life:[a,b],size:[a,b],colors:[...],grav,drag})
    //   epicClamp(v) 0..1, epicOut(v) ease-out, epicSmooth(v) smoothstep, epicIn(v) ease-in, epicHash(n) 0..1.
    // Rules:
    //   - Slugs, cards, seals and haze are drawn source-over via solid(). Additive "lighter" is for white/light cores only.
    //   - Every ctx.save() has a matching ctx.restore(). Do not touch document/window/timers/game state.
    //   - Particles only via epicSpawn, once per ultimate guarded by e.spawned.holdregister. Sparks and round embers only.
    //   - Hit input v only has x, y and age. Shot direction comes from q; never read an angle from v.

    CHAR_VFX_THEMES.harin={motif:"holdregister",core:"#fff3ec",a:"#ff5a48",b:"#2c2f3f",c:"#ff9a6a"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // One custody slug: a blunt navy casing, a red core and a pale seal band across it.
    const slug=(ctx,x,y,ux,uy,len,w,alpha)=>{const nx=-uy,ny=ux;
      epicStroke(ctx,[[x-ux*len*.5,y-uy*len*.5],[x+ux*len*.5,y+uy*len*.5]],w+2.6,"#2c2f3f",alpha);
      epicStroke(ctx,[[x-ux*len*.44,y-uy*len*.44],[x+ux*len*.4,y+uy*len*.4]],w,"#ff5a48",alpha);
      epicStroke(ctx,[[x-ux*len*.16+nx*w*.62,y-uy*len*.16+ny*w*.62],[x-ux*len*.16-nx*w*.62,y-uy*len*.16-ny*w*.62]],1.5,"#d0c8c4",alpha);};

    // An archive card: a pale face edged in red with an empty name slot (a short navy line near its top), long axis (ux,uy).
    const card=(ctx,x,y,ux,uy,len,w,alpha,sq)=>{if(alpha<=0)return;const nx=-uy,ny=ux,hl=len/2,hw=w/2,s=sq||1;
      const P=[[1,1],[1,-1],[-1,-1],[-1,1]].map(([a,b])=>[x+ux*hl*a+nx*hw*b,y+(uy*hl*a+ny*hw*b)*s]);
      ctx.save();ctx.globalAlpha*=alpha;ctx.beginPath();ctx.moveTo(P[0][0],P[0][1]);for(let i=1;i<4;i++)ctx.lineTo(P[i][0],P[i][1]);
      ctx.closePath();ctx.fillStyle="#d0c8c4";ctx.fill();ctx.lineWidth=Math.max(1.2,w*.12);ctx.strokeStyle="#ff5a48";ctx.stroke();ctx.restore();
      const a0=[x+ux*hl*.62+nx*hw*.5,y+(uy*hl*.62+ny*hw*.5)*s],a1=[x+ux*hl*.62-nx*hw*.5,y+(uy*hl*.62-ny*hw*.5)*s];
      epicStroke(ctx,[a0,a1],Math.max(1,w*.09),"#2c2f3f",alpha);};

    // The hold seal: a round navy seal ring with a red face and a square HOLD frame stamped in it, squashed by the press.
    const seal=(ctx,x,y,r,press,alpha)=>{if(alpha<=0)return;const ry=r*(.62-.2*press);
      epicRing(ctx,x,y,r,ry,3.4,"#2c2f3f",alpha);epicRing(ctx,x,y,r*.8,ry*.8,2,"#ff5a48",alpha);
      const q=r*.42,qy=ry*.42;epicStroke(ctx,[[x-q,y-qy],[x+q,y-qy],[x+q,y+qy],[x-q,y+qy],[x-q,y-qy]],1.8,"#2c2f3f",alpha);
      epicStroke(ctx,[[x-q*.55,y],[x+q*.55,y]],1.4,"#ff5a48",alpha);};

    CHAR_VFX_SHOTS["breach-slug"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux,h=q.heavy?1.35:1;
        solid(ctx,()=>{
          epicGlowLine(ctx,q.px-dx*2.4,q.py-dy*2.4,q.x,q.y,8*h,"#2c2f3f",.6,false);                     // the navy powder wake
          epicGlowLine(ctx,q.px-dx*1.6,q.py-dy*1.6,q.x,q.y,3.4*h,"#ff5a48",.75,false);
          slug(ctx,q.x-ux*3*h,q.y-uy*3*h,ux,uy,13*h,4.2*h,.98);                                          // the custody slug
          for(const s of [-1,1]){const b=10*h+(s>0?4:0),o=s*5.5*h;                                       // two card flecks shed behind it
            card(ctx,q.x-ux*b+nx*o,q.y-uy*b+ny*o,ux*.7+nx*s*.7,uy*.7+ny*s*.7,5.2*h,3.4*h,.8);}
          epicGlowAt(ctx,q.x-dx*.9,q.y-dy*.9,2.6*h,"#ff9a6a",.75,false);
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,q.x+ux*5*h,q.y+uy*5*h,2.6*h,"#ffffff",.8);ctx.restore();
      },
      impact(ctx,v){
        const t=Math.min(1,(v.age||0)/.5),p=1-t,press=epicOut(Math.min(1,t*3.2)),u=epicOut(Math.min(1,t*1.6));
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,9+12*u,"#fff3ec",.5*p);epicGlowAt(ctx,v.x,v.y,4,"#ffffff",.9*p);ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,v.x,v.y,14+12*u,"#ff5a48",.3*p,false);
          seal(ctx,v.x,v.y+2,15+5*press,press,.95*p);                                                    // the hold seal pressed down
          for(let i=0;i<4;i++){const a=-Math.PI/2+(i-1.5)*.62,r=12+22*u;                                 // card chips thrown up and out
            card(ctx,v.x+Math.cos(a)*r,v.y+Math.sin(a)*r*.8,Math.cos(a+1.2),Math.sin(a+1.2),5,3.4,.9*p);}
          epicRing(ctx,v.x,v.y+4,10+24*u,(10+24*u)*.4,1.6,"#2c2f3f",.7*(1-u)*p);                        // the breach dust ring
        });
      }
    };

    // Breach muzzle: a wide short red cone for the pump shot, a navy smoke puff, two card flakes and a hot red-orange core.
    MUZZLE_STYLES.harin=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(18+12*epicOut(t))*g,W=(7+6*t)*g;
      solid(ctx,()=>{
        epicGlowAt(ctx,m.x+c*L*.3,m.y+s2*L*.3,(10+9*t)*g,"#2c2f3f",.5*p,false);                          // navy smoke
        ctx.save();ctx.globalAlpha*=.8*p;ctx.beginPath();ctx.moveTo(m.x,m.y);                             // the wide breach cone
        ctx.lineTo(m.x+c*L+nx*W,m.y+s2*L+ny*W);ctx.lineTo(m.x+c*L*1.15,m.y+s2*L*1.15);ctx.lineTo(m.x+c*L-nx*W,m.y+s2*L-ny*W);ctx.closePath();
        ctx.fillStyle="#ff5a48";ctx.fill();ctx.restore();
        for(const k of [-1,1])card(ctx,m.x+c*L*.7+nx*k*W*1.3,m.y+s2*L*.7+ny*k*W*1.3,c,s2,5*g,3.2*g,.85*p);
        epicGlowAt(ctx,m.x,m.y,5*g,"#ff9a6a",.95*p,false);});
      ctx.save();ctx.globalCompositeOperation="lighter";
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.7,m.y+s2*L*.7,1.4*g,"#fff3ec",.9*p);
      epicGlowAt(ctx,m.x,m.y,5*g,"#ffffff",p);ctx.restore();
    };

    // ---- ultimate: nine archive cards (petalCount 9, card width 24, ring length 500 = radius 250) burst from a white-hot breach core at
    // the target, stop in a ring and are stamped shut by one navy hold seal. Drawn at the target (the game clips below her muzzle).
    CommonCombatRunner.prototype.drawEpicMotif_holdregister=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,ang=Math.atan2(dy,dx);
      const lockFade=since<0?1:epicClamp(1-since/.35),N=9,W=24,R=250,SQ=.62;
      const cards=(reach,alpha,tilt)=>{for(let i=0;i<N;i++){const pa=-Math.PI/2+i*Math.PI*2/N+a*.04,o=reach(i);if(o<=0)continue;
        const r=28+(R-28)*o,ux=Math.cos(pa),uy=Math.sin(pa),t2=tilt*(i%2?1:-1);
        card(ctx,tx+ux*r,ty+uy*r*SQ,ux*Math.cos(t2)-uy*Math.sin(t2),ux*Math.sin(t2)+uy*Math.cos(t2),W*1.5,W,alpha,SQ);}};
      if(launch>0&&lockFade>0){const q=epicSmooth(launch),reach=epicSmooth(epicClamp(launch*1.3));
        solid(ctx,()=>{
          for(let i=0;i<12;i++){const f0=i/12,f1=f0+.5/12;if(f0>reach)break;                            // the custody line to the target
            epicStroke(ctx,[[sx+dx*f0,sy+dy*f0],[sx+dx*Math.min(f1,reach),sy+dy*Math.min(f1,reach)]],2.2,theme.b,.85*lockFade);}
          epicGlowAt(ctx,tx,ty,R*.45*q,theme.a,.2*q*lockFade,false);
          for(let k=0;k<3;k++){const u=(launch*1.4+k/3)%1,r=120-90*u;epicRing(ctx,tx,ty,r,r*SQ,1.8,theme.a,.6*u*q*lockFade);}  // the breach tightens
          cards(i=>.12*epicSmooth(epicClamp(launch*1.6-i*.06)),.9*lockFade,.5);                         // cards stacked at the core
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,tx,ty,10+20*launch,theme.core,.8*launch*lockFade);epicGlowAt(ctx,tx,ty,5+7*launch,"#ffffff",.9*launch*lockFade);ctx.restore();}
      if(since>=0){const f=1-epicClamp(since/1.2),burst=epicOut(epicClamp(since/.22)),stamp=epicClamp((since-.34)/.16),ru=epicOut(epicClamp(since/.75));
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.35){const bf=1-since/.35;epicGlowLine(ctx,sx,sy,tx,ty,6*bf+1.4,theme.core,.85*bf);}
        epicGlowAt(ctx,tx,ty,18+26*epicOut(epicClamp(since/.3)),theme.core,.7*f);epicGlowAt(ctx,tx,ty,14,"#ffffff",.95*f*(1-stamp*.6));ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,tx,ty,50+60*ru,theme.a,.35*f*(1-ru*.6),false);
          cards(()=>burst,.95*f,.5*(1-burst)+.05);                                                        // nine cards burst out and hold in a ring
          epicRing(ctx,tx,ty,R+10,(R+10)*SQ,2.4,theme.b,.6*burst*f);                                     // the register ring
          if(stamp>0){const s=epicOut(stamp),r=90*(1.35-.35*s);                                          // the navy hold seal stamps shut
            epicGlowAt(ctx,tx,ty,r*1.2,theme.b,.5*s*f,false);
            epicRing(ctx,tx,ty,r,r*SQ,8*s+1,theme.b,.95*f);epicRing(ctx,tx,ty,r*.78,r*.78*SQ,3,theme.a,.9*s*f);
            const qx=r*.4,qy=r*.4*SQ;epicStroke(ctx,[[tx-qx,ty-qy],[tx+qx,ty-qy],[tx+qx,ty+qy],[tx-qx,ty+qy],[tx-qx,ty-qy]],4,theme.b,.95*s*f);}
          epicRing(ctx,tx,ty,30+240*ru,(30+240*ru)*SQ,4*(1-ru)+.8,theme.c,.8*(1-ru)*f);                  // the breach pressure ring
          epicRays(ctx,tx,ty,9,16,40+120*ru,.04,theme.c,.5*f,a*.2,93);
        });
        if(!e.spawned.holdregister){e.spawned.holdregister=true;
          epicSpawn(state,tx,ty,24,{kind:"spark",speed:[280,860],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.3,2.8],colors:[theme.core,theme.a,theme.c],grav:230,drag:.9});
          epicSpawn(state,tx,ty-12,12,{kind:"ember",speed:[70,260],life:[.6,1.3],size:[2.5,5.5],colors:[theme.c,theme.a,theme.core],grav:-36,drag:.93});}}
    };
  }
  // <<< CHAR_VFX harin
  // >>> CHAR_VFX yumi (tools/char_pipeline/vfx/yumi.js sha256 b8470a4d33009849; installed by vfx_lib.py)
  {
    // CHAR_VFX yumi — 유미 (SR-09), adjudicator needle and 쌍방 보호선.
    // Her shot is a thin silver-purple needle between two separated protection tracks.
    // A hit cuts the connecting line upward, then closes two independent seals.
    // The ultimate raises two purple arcs above her head and carries two uncrossed
    // ward lines to the target: "두 심박선, 따로 지킨다." Coloured layers are source-over.
    CHAR_VFX_THEMES.yumi={motif:"dualwardline",core:"#cac9d3",a:"#774cca",b:"#1d1722",c:"#774cca"};

    const yumiSolid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};
    const yumiNeedle=(ctx,x,y,ux,uy,L,w,colour,alpha)=>{
      const nx=-uy,ny=ux;
      epicStroke(ctx,[[x-ux*L*.72,y-uy*L*.72],[x+ux*L,y+uy*L]],Math.max(.8,w*.36),colour,alpha);
      epicStroke(ctx,[[x-ux*L*.3+nx*w,y-uy*L*.3+ny*w],[x+ux*L,y+uy*L],[x-ux*L*.3-nx*w,y-uy*L*.3-ny*w]],Math.max(.8,w*.24),colour,alpha);
      epicStroke(ctx,[[x-ux*L*.72,y-uy*L*.72],[x-ux*L*.95+nx*w*.7,y-uy*L*.95+ny*w*.7]],Math.max(.7,w*.2),colour,alpha);
    };

    CHAR_VFX_SHOTS["adjudicator-needle"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,D=Math.hypot(dx,dy)||1,ux=dx/D,uy=dy/D,nx=-uy,ny=ux,h=q.heavy?1.38:1;
        yumiSolid(ctx,()=>{
          for(const k of [-1,1]){
            const off=3.4*k*h;
            epicStroke(ctx,[[q.px-dx*2.1+nx*off,q.py-dy*2.1+ny*off],[q.x-ux*5*h+nx*off,q.y-uy*5*h+ny*off]],1.5*h,"#774cca",.76);
          }
          epicGlowLine(ctx,q.px-dx*1.5,q.py-dy*1.5,q.x,q.y,3.2*h,"#774cca",.45,false);
          yumiNeedle(ctx,q.x-ux*4*h,q.y-uy*4*h,ux,uy,13*h,3.6*h,"#cac9d3",.98);
          if(q.heavy){
            for(const k of [-1,1])yumiNeedle(ctx,q.x-ux*9*h+nx*k*5*h,q.y-uy*9*h+ny*k*5*h,ux,uy,8*h,2.2*h,"#774cca",.85);
          }
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowLine(ctx,q.px-dx*1.1,q.py-dy*1.1,q.x,q.y,1.3*h,"#cac9d3",.82);
        epicGlowAt(ctx,q.x,q.y,2.8*h,"#ffffff",.8);ctx.restore();
      },
      impact(ctx,v){
        // Impact receives only x/y/age. Every shot approaches from below: (ux,uy)=(0,-1).
        const t=epicClamp((v.age||0)/.46),fade=1-t,open=epicOut(epicClamp(t*2.6));
        const ux=0,uy=-1,nx=-uy,ny=ux;
        yumiSolid(ctx,()=>{
          yumiNeedle(ctx,v.x,v.y+14-12*open,ux,uy,13+15*open,3.3,"#cac9d3",.94*fade);
          for(const k of [-1,1]){
            const cx=v.x+nx*k*(10+8*open),cy=v.y+ny*k*(10+8*open);
            epicRing(ctx,cx,cy,6+12*open,11+8*open,2.4,"#774cca",.87*fade,0,-Math.PI*.78,Math.PI*.78);
            epicStroke(ctx,[[cx+k*3,cy+7],[cx+k*3,cy-9-10*open]],1.5,"#1d1722",.8*fade);
          }
          epicStroke(ctx,[[v.x,v.y+10],[v.x,v.y-16-20*open]],1.4,"#774cca",.9*fade);
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,7+11*open,"#cac9d3",.62*fade);
        epicGlowAt(ctx,v.x,v.y,3.5,"#ffffff",.7*fade);ctx.restore();
      }
    };

    MUZZLE_STYLES.yumi=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{
      const reach=(20+17*epicOut(t))*g;
      yumiSolid(ctx,()=>{
        for(const k of [-1,1]){
          const off=4.4*k*g;
          epicStroke(ctx,[[m.x+nx*off,m.y+ny*off],[m.x+c*reach*.68+nx*off*1.3,m.y+s2*reach*.68+ny*off*1.3],[m.x+c*reach+nx*off*.5,m.y+s2*reach+ny*off*.5]],(1.7*p+.5)*g,"#774cca",.93*p);
        }
        yumiNeedle(ctx,m.x+c*reach*.54,m.y+s2*reach*.54,c,s2,reach*.38,3.1*g,"#cac9d3",.93*p);
        epicGlowAt(ctx,m.x,m.y,11*g,"#774cca",.52*p,false);
      });
      ctx.save();ctx.globalCompositeOperation="lighter";
      epicGlowLine(ctx,m.x,m.y,m.x+c*reach*.84,m.y+s2*reach*.84,1.3*g,"#cac9d3",.91*p);
      epicGlowAt(ctx,m.x,m.y,4.5*g,"#ffffff",.8*p);ctx.restore();
    };

    CommonCombatRunner.prototype.drawEpicMotif_dualwardline=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m;
      const dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ux=dx/D,uy=dy/D,nx=-uy,ny=ux;
      const fade=since<0?1:epicClamp(1-since/.48);
      const lines=[-1,1].map(k=>({
        x0:sx+nx*k*16,y0:sy-30+ny*k*16,
        x1:tx+nx*k*19,y1:ty+ny*k*19,k
      }));
      if(launch>0&&fade>0){
        const q=epicSmooth(launch),arc=epicOut(epicClamp(launch*1.7));
        yumiSolid(ctx,()=>{
          // These two arcs sit above the head and remain separate at the muzzle clip.
          for(const k of [-1,1]){
            const bx=sx+k*26,by=sy-76;
            epicRing(ctx,bx,by,18+33*arc,17+24*arc,2.2,theme.a,.84*arc*fade,0,-Math.PI*.88,-Math.PI*.12);
            epicStroke(ctx,[[bx+k*9,by-13],[bx+k*9,by-30-12*arc]],1.6,theme.core,.85*arc*fade);
          }
          for(const L of lines){
            const ex=L.x0+(L.x1-L.x0)*q,ey=L.y0+(L.y1-L.y0)*q;
            epicStroke(ctx,[[L.x0,L.y0],[ex,ey]],2.5,theme.c,.9*fade);
            for(let n=0;n<3;n++){
              const u=(n/3+launch*.6)%1;
              if(u<=q)yumiNeedle(ctx,L.x0+(L.x1-L.x0)*u,L.y0+(L.y1-L.y0)*u,ux,uy,6,1.8,theme.core,.78*fade);
            }
            epicRing(ctx,L.x1,L.y1,27-10*q,33-9*q,2.1,theme.a,.82*q*fade,0,-Math.PI*.82,Math.PI*.82);
          }
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        for(const L of lines)epicGlowAt(ctx,L.x0,L.y0,5+6*launch,theme.core,.5*launch*fade);
        ctx.restore();
      }
      if(since>=0){
        const q=epicClamp(since/1.15),f=1-q,spread=epicOut(epicClamp(since/.34));
        yumiSolid(ctx,()=>{
          if(since<.45)for(const L of lines){
            epicStroke(ctx,[[L.x0,L.y0],[L.x1,L.y1]],2.2,theme.c,.7*(1-since/.45));
          }
          for(const L of lines){
            const cx=L.x1,cy=L.y1,r=20+46*spread;
            epicRing(ctx,cx,cy,r,r*.72,3*(1-q)+.6,theme.a,.9*f,0,-Math.PI*.8,Math.PI*.8);
            epicRing(ctx,cx,cy,r*.51,r*.47,1.6,theme.b,.72*f);
            epicStroke(ctx,[[cx,cy+19],[cx,cy-29-24*spread]],3.0,theme.c,.9*f);
            yumiNeedle(ctx,cx,cy-8-15*spread,0,-1,17+15*spread,3.6,theme.core,.9*f);
          }
          // The two seals close without one target replacing the other.
          epicStroke(ctx,[[lines[0].x1,lines[0].y1],[tx,ty-22],[lines[1].x1,lines[1].y1]],1.6,theme.c,.55*f);
          epicGlowAt(ctx,tx,ty-20,24+35*spread,theme.a,.44*f,false);
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        for(const L of lines)epicGlowAt(ctx,L.x1,L.y1,11+14*spread,theme.core,.45*f);
        ctx.restore();
        if(!e.spawned.dualwardline){
          e.spawned.dualwardline=true;
          for(const L of lines){
            epicSpawn(state,L.x1,L.y1,12,{kind:"spark",speed:[220,690],angle:-Math.PI/2,spread:Math.PI*.8,life:[.25,.62],size:[1.1,2.5],colors:[theme.core,theme.a,theme.c],grav:170,drag:.9});
            epicSpawn(state,L.x1,L.y1-10,7,{kind:"ember",speed:[50,180],angle:-Math.PI/2,spread:Math.PI,life:[.5,1.0],size:[2.5,5],colors:[theme.a,theme.c],grav:-25,drag:.94});
          }
        }
      }
    };
  }
  // <<< CHAR_VFX yumi
  // >>> CHAR_VFX lumi (tools/char_pipeline/vfx/lumi.js sha256 965c8f0d06b47f88; installed by vfx_lib.py)
  {
    // CHAR_VFX lumi — 루미 (SR-07). Resonance Wave front-line anchor with the 루미 페이즈 앵커 barrier projector; every shot is a small
    // hexagonal crystal beat with its count marks behind it and every hit a hex panel that snaps open on the beat and splits into three
    // shards. Her TRIANGULAR_LATTICE ultimate “다섯 트랙 동시 재생” snaps three magenta crystal triangles open around the target on three
    // different beats, each panelled with the hexagon cells of her barrier and turning at its own speed, until they lock into one
    // lattice with a mint core flash (all tracks end on one count).
    // Palette: main #f688c2 (theme.a, her barrier magenta; measured raspberry #ec659e), light #fff4fa (theme.core), accent #63d0a7
    // (theme.c, the mint gauntlet core), dark #352a2f (theme.b, graphite suit); ivory #f1e6e8 is the crystal face.
    //
    // Runtime helpers you can call (all draw on ctx; alpha fades are your job):
    //   epicGlowAt(ctx,x,y,r,color,alpha,hot=true)            soft round glow. hot=false keeps the colour (use for green/gold/brass).
    //   epicGlowLine(ctx,x1,y1,x2,y2,thick,color,alpha,hot)   soft glow along a segment.
    //   epicStroke(ctx,[[x,y],...],width,color,alpha)          round-capped polyline.
    //   epicRing(ctx,x,y,rx,ry,width,color,alpha,rot=0,a0=0,a1=2PI)   ellipse outline or arc.
    //   epicPoly(ctx,x,y,radius,sides,rot,width,color,alpha,fillAlpha=0)   regular polygon; fillAlpha is ABSOLUTE (multiply by your fade).
    //   epicRays(ctx,x,y,count,inner,outer,spread,color,alpha,spin,seed)    filled ray burst.
    //   epicSpawn(state,x,y,count,{kind:"spark"|"ember",speed:[a,b],angle,spread,life:[a,b],size:[a,b],colors:[...],grav,drag})
    //   epicClamp(v) 0..1, epicOut(v) ease-out, epicSmooth(v) smoothstep, epicIn(v) ease-in, epicHash(n) 0..1.
    // Rules:
    //   - Crystals, panels, mint ticks and haze are drawn source-over via solid() (additive mint turns cyan on the blue stage).
    //     Additive "lighter" is for white/ivory cores only. epicPoly fillAlpha is always passed as fade * value.
    //   - Every ctx.save() has a matching ctx.restore(). Do not touch document/window/timers/game state.
    //   - Particles only via epicSpawn, once per ultimate guarded by e.spawned.polyrhythmwall. Sparks and round embers only.
    //   - Hit input v only has x, y and age. Shot direction comes from q; never read an angle from v.

    CHAR_VFX_THEMES.lumi={motif:"polyrhythmwall",core:"#fff4fa",a:"#f688c2",b:"#352a2f",c:"#63d0a7"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // One barrier hex cell: graphite rim, magenta edge, ivory face (fill fades with alpha).
    const hexCell=(ctx,x,y,r,rot,alpha,face)=>{if(alpha<=0)return;
      epicPoly(ctx,x,y,r,6,rot,2.6,"#352a2f",alpha,0);
      epicPoly(ctx,x,y,r*.86,6,rot,1.6,"#f688c2",alpha,(face||.55)*alpha);};

    // The crystal beat: a hexagonal crystal head with an ivory facet line along the flight.
    const beatHead=(ctx,x,y,ux,uy,r,alpha)=>{hexCell(ctx,x,y,r,Math.atan2(uy,ux),alpha,.7);
      epicStroke(ctx,[[x-ux*r*.55,y-uy*r*.55],[x+ux*r*.55,y+uy*r*.55]],1.3,"#f1e6e8",alpha);};

    // A crystal triangle of the lattice: magenta frame over graphite with hex cells at its corners and edge midpoints.
    const tri=(ctx,cx,cy,r,rot,sq,width,alpha)=>{if(alpha<=0||r<1)return;
      const V=[0,1,2].map(i=>{const q=rot+i*Math.PI*2/3;return [cx+Math.cos(q)*r,cy+Math.sin(q)*r*sq];});
      epicStroke(ctx,[V[0],V[1],V[2],V[0]],width+3,"#352a2f",alpha*.85);
      epicStroke(ctx,[V[0],V[1],V[2],V[0]],width,"#f688c2",alpha);
      for(let i=0;i<3;i++){const [x0,y0]=V[i],[x1,y1]=V[(i+1)%3];
        hexCell(ctx,x0,y0,9,rot,alpha,.7);hexCell(ctx,(x0+x1)/2,(y0+y1)/2,6,rot+.5,alpha,.5);}};

    CHAR_VFX_SHOTS["crystal-beat"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,h=q.heavy?1.35:1;
        solid(ctx,()=>{
          epicGlowLine(ctx,q.px-dx*2,q.py-dy*2,q.x,q.y,5*h,"#f688c2",.5,false);
          for(let k=1;k<=3;k++){const b=(7+k*7)*h;                                                       // the count marks: 1-2-3
            epicPoly(ctx,q.x-ux*b,q.y-uy*b,(3.6-k*.6)*h,6,0,1.2,"#63d0a7",.95-k*.2,(.9-k*.2)*.8);}
          beatHead(ctx,q.x,q.y,ux,uy,6.5*h,.98);
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowLine(ctx,q.px-dx*.8,q.py-dy*.8,q.x,q.y,1.3*h,"#fff4fa",.85);
        epicGlowAt(ctx,q.x,q.y,2.6*h,"#ffffff",.85);ctx.restore();
      },
      impact(ctx,v){
        const t=Math.min(1,(v.age||0)/.46),p=1-t,snap=epicOut(Math.min(1,t*3.4)),split=epicOut(epicClamp((t-.22)*2.2));
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,9+12*snap,"#fff4fa",.55*p);epicGlowAt(ctx,v.x,v.y,4,"#ffffff",.9*p);ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,v.x,v.y,12+12*snap,"#f688c2",.3*p,false);
          if(split<1)hexCell(ctx,v.x,v.y,6+12*snap,0,.95*p*(1-split),.6);                                // the hex panel snaps open on the beat
          for(let i=0;i<3;i++){const a=-Math.PI/2+i*Math.PI*2/3,r=4+20*split;                           // then splits into three shards
            if(split>0)epicPoly(ctx,v.x+Math.cos(a)*r,v.y+Math.sin(a)*r*.8,5+2*(1-split),3,a,1.4,"#f688c2",.95*p,.6*p);}
          epicRing(ctx,v.x,v.y,8+20*snap,(8+20*snap)*.7,1.4,"#63d0a7",.85*(1-snap)*p);                    // the mint count ring
        });
      }
    };

    // Phase-anchor muzzle: a hex lens opening across the aim line, two magenta projector rails and a mint count tick at the lens.
    MUZZLE_STYLES.lumi=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(20+14*epicOut(t))*g;
      solid(ctx,()=>{
        epicGlowAt(ctx,m.x+c*L*.3,m.y+s2*L*.3,(10+8*t)*g,"#f688c2",.45*p,false);
        hexCell(ctx,m.x+c*4*g,m.y+s2*4*g,(6+7*epicOut(t))*g,ang,.9*p,.4);                                // the hex lens
        for(const k of [-1,1])epicStroke(ctx,[[m.x+nx*k*4*g,m.y+ny*k*4*g],[m.x+nx*k*4*g+c*L*.7,m.y+ny*k*4*g+s2*L*.7]],(1.5*p+.4)*g,"#f688c2",.9*p);
        epicGlowAt(ctx,m.x,m.y,3.6*g,"#63d0a7",.95*p,false);});
      ctx.save();ctx.globalCompositeOperation="lighter";
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.75,m.y+s2*L*.75,1.4*g,"#fff4fa",.9*p);
      epicGlowAt(ctx,m.x,m.y,5*g,"#ffffff",p);ctx.restore();
    };

    // ---- ultimate: three crystal triangles (triangleCount 3, frame width 6, radius 200) snap open around the target on three beats,
    // each turning at its own speed; at the hit they lock into one lattice with a mint core flash. Drawn at the target.
    CommonCombatRunner.prototype.drawEpicMotif_polyrhythmwall=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,ang=Math.atan2(dy,dx);
      const lockFade=since<0?1:epicClamp(1-since/.35),R=200,W=6,SQ=.62,BEATS=[0,.22,.44],SPEED=[1.6,-2.3,3.1];
      if(launch>0&&lockFade>0){const q=epicSmooth(launch);
        solid(ctx,()=>{
          for(let i=0;i<12;i++){const f0=i/12,f1=f0+.4/12,reach=epicSmooth(epicClamp(launch*1.3));if(f0>reach)break;   // the beat line to the target
            epicStroke(ctx,[[sx+dx*f0,sy+dy*f0],[sx+dx*Math.min(f1,reach),sy+dy*Math.min(f1,reach)]],2,theme.a,.8*lockFade);}
          epicGlowAt(ctx,tx,ty,R*.4*q,theme.a,.2*q*lockFade,false);
          for(let k=0;k<3;k++){const on=epicOut(epicClamp((launch-BEATS[k])*4));if(on<=0)continue;         // each triangle snaps open on its beat
            tri(ctx,tx,ty,R*(.55+.2*k)*on,-Math.PI/2+SPEED[k]*launch,SQ,W*(1-k*.15),.92*lockFade);}
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,tx,ty,10+16*launch,theme.core,.75*launch*lockFade);epicGlowAt(ctx,tx,ty,4+6*launch,"#ffffff",.9*launch*lockFade);ctx.restore();}
      if(since>=0){const f=1-epicClamp(since/1.2),lock=epicOut(epicClamp(since/.24)),ru=epicOut(epicClamp(since/.75));
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.35){const bf=1-since/.35;epicGlowLine(ctx,sx,sy,tx,ty,5*bf+1.2,theme.core,.8*bf);}
        epicGlowAt(ctx,tx,ty,16+22*epicOut(epicClamp(since/.3)),theme.core,.65*f);epicGlowAt(ctx,tx,ty,12,"#ffffff",.9*f);ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,tx,ty,40+50*ru,theme.c,.45*f*(1-ru*.5),false);                                   // the mint core flash, source-over
          epicGlowAt(ctx,tx,ty,50+60*ru,theme.a,.3*f*(1-ru*.6),false);
          for(let k=0;k<3;k++){const r=R*((.55+.2*k)*(1-lock)+.75*lock),rot=-Math.PI/2+(SPEED[k]*(1-lock))+k*Math.PI/3*lock;
            tri(ctx,tx,ty,r*(1+.25*ru),rot,SQ,W*(1-k*.15)+2*(1-ru),.95*f*(1-ru*.4));}                      // all three lock into one lattice
          epicRing(ctx,tx,ty,30+230*ru,(30+230*ru)*SQ,4*(1-ru)+.8,theme.c,.85*(1-ru)*f);                   // the count ring
          epicRing(ctx,tx,ty,24+190*ru,(24+190*ru)*SQ,2*(1-ru)+.5,theme.b,.7*(1-ru)*f);
          epicRays(ctx,tx,ty,6,16,40+120*ru,.05,theme.a,.55*f,a*.2,77);
        });
        if(!e.spawned.polyrhythmwall){e.spawned.polyrhythmwall=true;
          epicSpawn(state,tx,ty,24,{kind:"spark",speed:[280,840],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.2,2.6],colors:[theme.core,theme.a,theme.c],grav:210,drag:.9});
          epicSpawn(state,tx,ty-14,12,{kind:"ember",speed:[70,260],life:[.6,1.3],size:[2.5,5],colors:[theme.a,theme.c,theme.core],grav:-34,drag:.93});}}
    };
  }
  // <<< CHAR_VFX lumi
  // >>> CHAR_VFX dabin (tools/char_pipeline/vfx/dabin.js sha256 815f9b5251ea366b; installed by vfx_lib.py)
  {
    // Dabin R-09: six-sided phase cells protect the route she promises to run to its end.
    // Gold cell outlines, purple pressure plates and three triangular corridor braces.
    // Coloured surfaces use source-over; only small ivory cores use additive blending.
    CHAR_VFX_THEMES.dabin={motif:"transitcell",core:"#fff0d8",a:"#fbc07c",b:"#533d5d",c:"#9252bd"};
    const solid=(ctx,draw)=>{ctx.save();ctx.globalCompositeOperation="source-over";draw();ctx.restore();};
    const cell=(ctx,x,y,r,rot,w,color,alpha,fill=0)=>{
      epicPoly(ctx,x,y,r,6,rot,w,color,alpha,fill*alpha);
    };
    const brace=(ctx,x,y,r,rot,w,color,alpha)=>{
      epicPoly(ctx,x,y,r,3,rot,w,color,alpha,0);
    };
    const ivory=(ctx,draw)=>{ctx.save();ctx.globalCompositeOperation="lighter";draw();ctx.restore();};

    CHAR_VFX_SHOTS["refuge-cell"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,D=Math.hypot(dx,dy)||1,ux=dx/D,uy=dy/D,nx=-uy,ny=ux;
        const h=q.heavy?1.55:1,rot=Math.atan2(uy,ux),r=7*h;
        solid(ctx,()=>{
          cell(ctx,q.x,q.y,r,rot,2*h,"#fbc07c",.97,.16);
          cell(ctx,q.x,q.y,r*.55,rot,1.4*h,"#9252bd",.95,.30);
          for(const side of [-1,1]){
            epicStroke(ctx,[[q.x-ux*r+nx*r*.55*side,q.y-uy*r+ny*r*.55*side],[q.px-dx*1.8+nx*r*.22*side,q.py-dy*1.8+ny*r*.22*side]],1.4*h,"#9252bd",.65);
          }
          for(let i=1;i<=3;i++){
            cell(ctx,q.x-ux*(14+10*i)*h,q.y-uy*(14+10*i)*h,(4-i*.7)*h,rot,1,"#fbc07c",.48-i*.10);
          }
          if(q.heavy)cell(ctx,q.x,q.y,r+4,rot,1.4,"#9252bd",.85);
        });
        ivory(ctx,()=>epicGlowAt(ctx,q.x+ux*2,q.y+uy*2,2.7*h,"#fff0d8",.9));
      },
      impact(ctx,v){
        const t=epicClamp((v.age||0)/.52),fade=1-t,u=epicOut(t),ux=0,uy=-1;
        solid(ctx,()=>{
          epicGlowAt(ctx,v.x,v.y,12+24*u,"#533d5d",.65*fade,false);
          cell(ctx,v.x,v.y,7+16*u,Math.PI/6,2.5*fade+.5,"#fbc07c",fade,.13);
          for(let i=0;i<6;i++){
            const a=Math.PI/6+i*Math.PI/3,r=9+27*u,x=v.x+Math.cos(a)*r,y=v.y+Math.sin(a)*r;
            const tx=-Math.sin(a),ty=Math.cos(a);
            epicStroke(ctx,[[x-tx*5*fade,y-ty*5*fade],[x+tx*5*fade,y+ty*5*fade]],2.3,"#9252bd",.95*fade);
          }
          epicStroke(ctx,[[v.x-ux*8,v.y-uy*8],[v.x-ux*(10+25*u),v.y-uy*(10+25*u)]],3*fade+.5,"#fbc07c",.7*fade);
        });
        ivory(ctx,()=>epicGlowAt(ctx,v.x,v.y,5+8*(1-u),"#fff0d8",fade*fade));
      }
    };

    MUZZLE_STYLES.dabin=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{
      const r=(7+14*epicOut(t))*g,L=(12+18*t)*g;
      solid(ctx,()=>{
        cell(ctx,m.x+c*L*.45,m.y+s2*L*.45,r,ang,2*g,"#fbc07c",p,.10);
        for(const k of [-1,1]){
          epicStroke(ctx,[[m.x+nx*r*k,m.y+ny*r*k],[m.x+c*L+nx*r*.45*k,m.y+s2*L+ny*r*.45*k]],2*g,"#9252bd",.9*p);
        }
      });
      ivory(ctx,()=>epicGlowLine(ctx,m.x,m.y,m.x+c*L*.7,m.y+s2*L*.7,1.7*g,"#fff0d8",p));
    };

    CommonCombatRunner.prototype.drawEpicMotif_transitcell=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m;
      const bx=sx,by=sy-125,dx=tx-bx,dy=ty-by,D=Math.hypot(dx,dy)||1,ux=dx/D,uy=dy/D,nx=-uy,ny=ux,rot=Math.atan2(dy,dx);
      const pre=since<0?1:epicClamp(1-since/.30);
      if(launch>0&&pre>0){
        const q=epicSmooth(launch);
        solid(ctx,()=>{
          for(let i=0;i<3;i++){
            const f=.12+i*.36,x=bx+dx*f,y=by+dy*f,r=(48-i*8)*( .45+.55*q);
            brace(ctx,x,y,r,rot+Math.PI/2,4+i*.5,theme.c,q*pre);
            cell(ctx,x,y,r*.60,rot,2,theme.a,q*pre,.045);
          }
          for(const k of [-1,1]){
            epicStroke(ctx,[[bx+nx*30*k,by+ny*30*k],[tx+nx*20*k,ty+ny*20*k]],2.5,theme.a,.65*q*pre);
          }
          for(let i=0;i<6;i++){
            const f=(launch*.85+i/6)%1,x=bx+dx*f,y=by+dy*f;
            cell(ctx,x,y,8+4*q,rot,1.8,theme.a,.85*q*pre,.13);
          }
          cell(ctx,tx,ty,50-21*q,rot,3,theme.c,q*pre);
        });
        ivory(ctx,()=>epicGlowAt(ctx,tx,ty,7+9*q,theme.core,.5*q*pre));
      }
      if(since>=0){
        const f=1-epicClamp(since/1.25),u=epicOut(epicClamp(since/.6));
        solid(ctx,()=>{
          cell(ctx,tx,ty,24+95*u,rot,5*(1-u)+1,theme.c,f,.08);
          for(let i=0;i<6;i++){
            const ang=rot+i*Math.PI/3,r=28+110*u,x=tx+Math.cos(ang)*r,y=ty+Math.sin(ang)*r*.65;
            cell(ctx,x,y,13*(1-u)+5,ang,2,theme.a,.9*f,.12);
          }
          for(let i=0;i<3;i++)brace(ctx,tx,ty,45+i*18+65*u,rot+Math.PI/2+i*Math.PI/3,3,theme.c,f*.60);
          epicRing(ctx,tx,ty,30+200*u,18+92*u,3,theme.c,.65*f);
          for(const k of [-1,1])epicStroke(ctx,[[bx+nx*30*k,by+ny*30*k],[tx+nx*20*k,ty+ny*20*k]],2.3,theme.a,f*.6);
        });
        ivory(ctx,()=>{
          if(since<.20)epicGlowLine(ctx,bx,by,tx,ty,3,theme.core,(1-since/.20)*.8);
          epicGlowAt(ctx,tx,ty,17+20*u,theme.core,.45*f*f);
        });
        if(!e.spawned.transitcell){
          e.spawned.transitcell=true;
          epicSpawn(state,tx,ty,30,{kind:"spark",speed:[160,650],angle:rot,spread:Math.PI*2,life:[.3,.8],size:[1.3,2.5],colors:[theme.a,theme.c],grav:160,drag:.92});
          epicSpawn(state,tx,ty,12,{kind:"ember",speed:[55,170],life:[.55,1.2],size:[2,4],colors:[theme.a,theme.c],grav:55,drag:.94});
        }
      }
    };
  }
  // <<< CHAR_VFX dabin
  // >>> CHAR_VFX sion (tools/char_pipeline/vfx/sion.js sha256 111a108e52371158; installed by vfx_lib.py)
  {
    // CHAR_VFX sion — 시온 (R-03), PRESS LINE BREAKER. Weapon: 시온 포지 브레이커, a twin-barrel overdrive coil rifle (cyan coils, brass bands).
    // Shot: a flat-nosed brass slug driven down twin cyan rails, coil loops left in its wake. Hit: a press plate slams down on an anvil
    // plate at the target, steam vents sideways and brass chips spray up. Muzzle: twin rail flashes through two brass coil loops.
    // Ultimate 세 갈래 절단 ("원본 라인을 물리적으로 세 갈래로 절단한다", "다섯 슬롯 중 교차 세 칸에 프레스 그림자"): three triangular press
    // blades gather around the target at 120 degrees, drop and meet at one point, and the zone splits into three cyan cut lanes with
    // brass sparks over a dark navy press shadow.
    // Palette: main #3cabc1 (theme.a), light #cfc7bb (theme.core), accent #cf9d45 (theme.c), dark #2f3345 (theme.b).
    //
    // Runtime helpers: epicGlowAt / epicGlowLine / epicStroke / epicRing / epicPoly / epicRays / epicSpawn / epicClamp / epicOut /
    // epicSmooth / epicIn / epicHash (see vfx/_TEMPLATE.js). Coloured shapes source-over (solid), only light cores "lighter".

    // ---- theme: the ultimate motif name and colours (motif must match specs/sion.json vfx.motif)
    CHAR_VFX_THEMES.sion={motif:"threewaycut",core:"#cfc7bb",a:"#3cabc1",b:"#2f3345",c:"#cf9d45"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // a flat-nosed brass slug (a press ram, not a point)
    const slugMark=(ctx,x,y,ux,uy,len,w,color,alpha)=>{const nx=-uy,ny=ux;
      epicStroke(ctx,[[x+ux*len+nx*w,y+uy*len+ny*w],[x+ux*len-nx*w,y+uy*len-ny*w],[x-ux*len*.6-nx*w*.7,y-uy*len*.6-ny*w*.7],
        [x-ux*len*.6+nx*w*.7,y-uy*len*.6+ny*w*.7],[x+ux*len+nx*w,y+uy*len+ny*w]],Math.max(1.2,w*.45),color,alpha);};
    // one coil loop across the flight line
    const coilLoop=(ctx,x,y,ux,uy,r,color,alpha)=>epicRing(ctx,x,y,r,r*.38,1.3,color,alpha,Math.atan2(uy,ux)+Math.PI/2);
    // a triangular press blade whose tip sits at (x,y), its base out along ang; the ground plane is squashed (sq) like the rings
    const pressBlade=(ctx,x,y,ang,r,w,edge,alpha,fill,fillColor,sq)=>{
      const P=[[x,y],[x+Math.cos(ang-.3)*r,y+Math.sin(ang-.3)*r*sq],[x+Math.cos(ang+.3)*r,y+Math.sin(ang+.3)*r*sq]];
      if(fill>0){ctx.save();ctx.globalAlpha*=fill;ctx.beginPath();ctx.moveTo(P[0][0],P[0][1]);ctx.lineTo(P[1][0],P[1][1]);
        ctx.lineTo(P[2][0],P[2][1]);ctx.closePath();ctx.fillStyle=fillColor;ctx.fill();ctx.restore();}
      epicStroke(ctx,[P[0],P[1],P[2],P[0]],w,edge,alpha);};

    // ---- normal/heavy shot and its hit. A hit has no direction: shots fly UP the screen (ux=0, uy=-1).
    CHAR_VFX_SHOTS["coil-rail-bolt"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux,h=q.heavy?1.35:1;
        solid(ctx,()=>{
          for(const k of [-1,1])epicGlowLine(ctx,q.px-dx*2.4+nx*k*3*h,q.py-dy*2.4+ny*k*3*h,q.x+nx*k*3*h,q.y+ny*k*3*h,2.6*h,"#3cabc1",.65,false); // twin rails
          for(let k=1;k<=3;k++){const f=k*.6;coilLoop(ctx,q.x-dx*f,q.y-dy*f,ux,uy,(6-k)*h,"#3cabc1",.8-k*.18);}   // coil loops in the wake
          epicGlowAt(ctx,q.x,q.y,7*h,"#2f3345",.35,false);
          slugMark(ctx,q.x,q.y,ux,uy,7*h,3.4*h,"#cf9d45",.95);
        });
        ctx.save();ctx.globalCompositeOperation="lighter"; // light core only
        epicGlowLine(ctx,q.px-dx*1.1,q.py-dy*1.1,q.x,q.y,1.3*h,"#cfc7bb",.85);
        epicGlowAt(ctx,q.x+ux*6*h,q.y+uy*6*h,2.6*h,"#ffffff",.85);ctx.restore();
      },
      impact(ctx,v){
        const t=Math.min(1,(v.age||0)/.46),p=1-t,close=epicOut(Math.min(1,t*3.2)),w=16+6*close,top=v.y-24+18*close;
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,8+14*epicOut(t),"#cfc7bb",.6*p);epicGlowAt(ctx,v.x,v.y,4,"#ffffff",p);ctx.restore();
        solid(ctx,()=>{
          epicStroke(ctx,[[v.x-w,top],[v.x+w,top]],4*p+1,"#cfc7bb",.9*p);                   // the press plate comes down
          epicStroke(ctx,[[v.x-w*.75,top-4],[v.x+w*.75,top-4]],2,"#2f3345",.85*p);
          epicStroke(ctx,[[v.x-w,v.y+5],[v.x+w,v.y+5]],3*p+1,"#3cabc1",.9*p);                // the anvil plate under the target
          const u=epicOut(epicClamp(t*1.6-.1));
          if(u>0)for(const k of [-1,1])epicGlowAt(ctx,v.x+k*(w+14*u),v.y-2,5+9*u,"#cfc7bb",.45*(1-u),false); // steam vents sideways
          for(let i=0;i<5;i++){const a=-Math.PI*.5+(i-2)*.5,r0=6+6*close,r1=10+16*close;     // brass chips spray up
            epicStroke(ctx,[[v.x+Math.cos(a)*r0,v.y+Math.sin(a)*r0*.7],[v.x+Math.cos(a)*r1,v.y+Math.sin(a)*r1*.7]],1.6,"#cf9d45",.9*p);}
        });
      }
    };

    // ---- muzzle flash: twin rail flashes through two brass coil loops.
    MUZZLE_STYLES.sion=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(24+16*epicOut(t))*g;
      solid(ctx,()=>{epicGlowAt(ctx,m.x,m.y,(12+8*t)*g,"#3cabc1",.5*p,false);
        for(const k of [-1,1])epicGlowLine(ctx,m.x+nx*k*3.5*g,m.y+ny*k*3.5*g,m.x+nx*k*3.5*g+c*L,m.y+ny*k*3.5*g+s2*L,(2.2*p+.6)*g,"#3cabc1",.8*p,false);
        for(let k=0;k<2;k++){const f=.25+k*.3;epicRing(ctx,m.x+c*L*f,m.y+s2*L*f,(9-2*k)*g*(.6+.4*p),(3.4-k)*g,1.3*g,"#cf9d45",.9*p,ang+Math.PI/2);}});
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.7,m.y+s2*L*.7,1.3*g,"#cfc7bb",.95*p);
      epicGlowAt(ctx,m.x,m.y,5*g,"#ffffff",p);
    };

    // ---- ultimate 세 갈래 절단 (TRIANGULAR_LATTICE: 3 blades, width 6, radius 200). Clipped above the formation line: all at the target.
    CommonCombatRunner.prototype.drawEpicMotif_threewaycut=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,R=200,W=6,SQ=.62;
      const dirs=[0,1,2].map(k=>-Math.PI/2+k*2*Math.PI/3),cuts=dirs.map(d=>d+Math.PI/3);
      const lockFade=since<0?1:epicClamp(1-since/.35);
      if(launch>0&&lockFade>0){const q=epicSmooth(launch),reach=epicSmooth(launch*1.3);
        solid(ctx,()=>{
          for(let i=0;i<16;i++){const f0=i/16,f1=f0+.5/16;if(f0>reach)break;          // the coil rail line to the target
            epicStroke(ctx,[[sx+dx*f0,sy+dy*f0],[sx+dx*Math.min(f1,reach),sy+dy*Math.min(f1,reach)]],2.2,theme.a,.85*lockFade);}
          epicRing(ctx,tx,ty,R*(1.1-.4*q),R*(1.1-.4*q)*SQ,1.4,theme.c,.5*q*lockFade);      // the marked slot
          dirs.forEach((d,k)=>{const u=epicClamp(q*1.4-k*.15),dist=R*(1-.7*epicSmooth(u));  // three press blades gather in turn
            if(u>0)pressBlade(ctx,tx+Math.cos(d)*dist,ty+Math.sin(d)*dist*SQ,d,70,W*.5,theme.core,.9*u*lockFade,.55*u*lockFade,theme.b,SQ);});
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,tx,ty,8+20*q,theme.core,.5*q*lockFade);ctx.restore();}
      if(since>=0){const f=1-epicClamp(since/1.2),snap=epicOut(epicClamp(since/.14)),open=epicOut(epicClamp(since/.35)),L=R*open;
        solid(ctx,()=>{
          epicGlowAt(ctx,tx,ty,60+90*open,theme.b,.55*f,false);                              // the dark press shadow
          if(since<.45){const bf=1-since/.45;dirs.forEach(d=>{const dist=R*.3*(1-snap);     // the blades meet at one point
            pressBlade(ctx,tx+Math.cos(d)*dist,ty+Math.sin(d)*dist*SQ,d,70,W*.5,theme.core,.95*bf,.6*bf,theme.b,SQ);});}
          cuts.forEach(c=>{const ex=tx+Math.cos(c)*L,ey=ty+Math.sin(c)*L*SQ;                  // the line splits three ways
            epicStroke(ctx,[[tx,ty],[ex,ey]],W*f+1,theme.a,.95*f);
            epicStroke(ctx,[[tx+Math.cos(c)*L*.2,ty+Math.sin(c)*L*.2*SQ],[ex,ey]],2,theme.c,.9*f);});
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.3){const bf=1-since/.3;epicGlowLine(ctx,sx,sy,tx,ty,5*bf+1.5,theme.core,.8*bf);}
        epicGlowAt(ctx,tx,ty,30+50*open,theme.core,.6*f);epicGlowAt(ctx,tx,ty,20,"#ffffff",f);
        cuts.forEach(c=>epicGlowLine(ctx,tx,ty,tx+Math.cos(c)*L,ty+Math.sin(c)*L*SQ,1.6,theme.core,.8*f));
        ctx.restore();
        if(!e.spawned.threewaycut){e.spawned.threewaycut=true;
          cuts.forEach(c=>epicSpawn(state,tx,ty,10,{kind:"spark",speed:[300,850],angle:c,spread:.5,life:[.3,.7],size:[1.3,2.6],colors:[theme.c,theme.core,theme.a],grav:240,drag:.9}));
          epicSpawn(state,tx,ty-10,10,{kind:"ember",speed:[60,240],life:[.6,1.2],size:[3,5],colors:[theme.c,theme.a],grav:-30,drag:.93});}}
    };
  }
  // <<< CHAR_VFX sion
  // >>> CHAR_VFX liora (tools/char_pipeline/vfx/liora.js sha256 08c92765acbf6df9; installed by vfx_lib.py)
  {
    // CHAR_VFX liora — 리오라 크레스트 (SSR-09). Written from tools/char_pipeline/vfx/_TEMPLATE.js; installed by vfx_lib.py.
    // Her weapon is one long heraldic spear (gold butt cap, black shaft, gold-teal cross guard, white blade), and her ultimate
    // 서약의 창끝 ("oath's spear tip") opens a six-petal gold-teal crest around a white-hot core, then closes it as a ring of teal light:
    //   shot  crest-lance : a gold spear-leaf head with a teal gem and a twin gold wake; the hit is a cross-guard seat (four gold spikes,
    //                       long one up, a teal gem and one ring) - the lance seating on the plate, like "앞은 제가 막겠습니다".
    //   muzzle            : a forward gold blade flash with two short cross-guard wings and a teal gem.
    //   ultimate oathcrest: lance leaves fly along the line, six crest petals gather on the target, then open around a white-hot core
    //                       and close into a teal ring ("그 의사를 새 서약으로 수호하겠습니다").
    // Palette: main #e99e2a (theme.a), light #fffaf0 (theme.core), accent #06c4d0 (theme.c), dark #252128 (theme.b).
    //
    // Runtime helpers you can call (all draw on ctx; alpha fades are your job):
    //   epicGlowAt(ctx,x,y,r,color,alpha,hot=true)            soft round glow. hot=false keeps the colour (use for green/gold/brass).
    //   epicGlowLine(ctx,x1,y1,x2,y2,thick,color,alpha,hot)   soft glow along a segment.
    //   epicStroke(ctx,[[x,y],...],width,color,alpha)          round-capped polyline.
    //   epicRing(ctx,x,y,rx,ry,width,color,alpha,rot=0,a0=0,a1=2PI)   ellipse outline or arc.
    //   epicRays(ctx,x,y,count,inner,outer,spread,color,alpha,spin,seed)    filled ray burst.
    //   epicSpawn(state,x,y,count,{kind:"spark"|"ember",speed:[a,b],angle,spread,life:[a,b],size:[a,b],colors:[...],grav,drag})
    //   epicClamp(v) 0..1, epicOut(v) ease-out, epicSmooth(v) smoothstep, epicIn(v) ease-in, epicHash(n) 0..1.
    // Rules that came from real failures: coloured shapes source-over (solid() below), only white/light cores additive; every save()
    // has its restore(); particles only via epicSpawn, once per ultimate (e.spawned.oathcrest).

    // ---- theme: the ultimate motif name and colours (motif must match specs/liora.json vfx.motif)
    CHAR_VFX_THEMES.liora={motif:"oathcrest",core:"#fffaf0",a:"#e99e2a",b:"#252128",c:"#06c4d0"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // A spear-leaf: filled kite from (x,y) along ang, length len, half-width w. edge (optional) outlines it.
    const leaf=(ctx,x,y,ang,len,w,color,alpha,edge)=>{ctx.save();ctx.translate(x,y);ctx.rotate(ang);ctx.globalAlpha=alpha;ctx.fillStyle=color;
      ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(len*.45,-w,len,0);ctx.quadraticCurveTo(len*.45,w,0,0);ctx.closePath();ctx.fill();
      if(edge){ctx.strokeStyle=edge;ctx.lineWidth=Math.max(1,w*.2);ctx.stroke();}ctx.restore();};

    // The teal crest gem: a tall diamond.
    const gem=(ctx,x,y,r,color,alpha)=>{ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle=color;
      ctx.beginPath();ctx.moveTo(x,y-r*1.3);ctx.lineTo(x+r*.8,y);ctx.lineTo(x,y+r*1.3);ctx.lineTo(x-r*.8,y);ctx.closePath();ctx.fill();ctx.restore();};

    // The projectile head: a gold spear leaf with a teal gem in its middle.
    const lanceHead=(ctx,x,y,ux,uy,len,w,alpha)=>{const ang=Math.atan2(uy,ux);
      leaf(ctx,x-ux*len*.45,y-uy*len*.45,ang,len*1.5,w,"#e99e2a",alpha,"#fffaf0");
      gem(ctx,x+ux*len*.1,y+uy*len*.1,w*.42,"#06c4d0",alpha);};

    // ---- normal/heavy shot and its hit. q: {x,y,px,py,heavy,...} (px,py = previous position); v: {x,y,age} ONLY - a hit has no
    // direction: shots fly UP the screen, so the hit is drawn as if the shot came from below (ux=0, uy=-1).
    CHAR_VFX_SHOTS["crest-lance"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux,h=q.heavy?1.35:1;
        solid(ctx,()=>{
          for(const k of [-1,1])epicGlowLine(ctx,q.px-dx*2.4+nx*k*2.4*h,q.py-dy*2.4+ny*k*2.4*h,q.x+nx*k*2.4*h,q.y+ny*k*2.4*h,2.4*h,"#e99e2a",.55,false);   // twin gold wake
          epicGlowAt(ctx,q.x,q.y,8*h,"#e99e2a",.5,false);
          lanceHead(ctx,q.x-ux*3*h,q.y-uy*3*h,ux,uy,12*h,4.6*h,.95);
          for(let k=1;k<=2;k++){const f=k/3;gem(ctx,q.px-dx*f*2.4,q.py-dy*f*2.4,(2.6-k*.5)*h,"#06c4d0",.75-k*.2);}                              // teal gems along the wake
        });
        ctx.save();ctx.globalCompositeOperation="lighter"; // light core only
        epicGlowLine(ctx,q.px-dx*1.2,q.py-dy*1.2,q.x,q.y,1.4*h,"#fffaf0",.9);
        epicGlowAt(ctx,q.x,q.y,3*h,"#ffffff",.85);ctx.restore();
      },
      impact(ctx,v){
        const t=Math.min(1,(v.age||0)/.46),p=1-t,snap=epicOut(Math.min(1,t*2.4));
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,11+16*epicOut(t),"#fffaf0",.6*p);epicGlowAt(ctx,v.x,v.y,5,"#ffffff",p);ctx.restore();
        solid(ctx,()=>{
          const u=epicOut(t),r=8+22*u;epicRing(ctx,v.x,v.y,r,r*.68,1.8,"#e99e2a",.85*(1-u)*p);                                  // one seat ring
          for(const [a,L,w] of [[-Math.PI/2,26,4.2],[0,17,3.2],[Math.PI,17,3.2],[Math.PI/2,10,2.8]])                              // cross guard: long spike up
            leaf(ctx,v.x,v.y,a,L*(.4+.6*snap),w,"#e99e2a",.95*p,"#fffaf0");
          gem(ctx,v.x,v.y,4.2*(1-.3*t),"#06c4d0",p);
        });
      }
    };

    // ---- muzzle flash. m: muzzle {x,y}; t: 0->1 over the flash, p=1-t; g: body scale; (c,s2) aim direction; (nx,ny) its normal.
    // A forward gold blade with two short cross-guard wings and a teal gem.
    MUZZLE_STYLES.liora=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(26+20*epicOut(t))*g;
      solid(ctx,()=>{epicGlowAt(ctx,m.x,m.y,(13+7*t)*g,"#e99e2a",.5*p,false);
        leaf(ctx,m.x,m.y,ang,L*1.25,4.2*g*(1-.4*t),"#e99e2a",.85*p,"#fffaf0");                                                   // forward blade
        for(const k of [-1,1])leaf(ctx,m.x+c*L*.16,m.y+s2*L*.16,ang+k*Math.PI/2,9*g*(1-.3*t),2.4*g,"#e99e2a",.9*p);               // cross-guard wings
        gem(ctx,m.x+c*L*.16,m.y+s2*L*.16,2.6*g,"#06c4d0",.95*p);});
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.85,m.y+s2*L*.85,1.3*g,"#fffaf0",.95*p);
      epicGlowAt(ctx,m.x,m.y,5.5*g,"#ffffff",p);
    };

    // ---- ultimate 서약의 창끝. The GAME CLIPS this function above the formation line (about 10 px above her muzzle): a build-up drawn
    // at her muzzle or lower is invisible in the game. So the build-up runs along the line and on the target. The game also draws its
    // own shared layers on top: a light column at her, a full-screen flash in theme.c, big rings in a/c/b and rays in theme.c at the hit.
    // m: {theme,launch,since,sx,sy,tx,ty,a,state}. launch 0->1 while the shot charges, since = seconds after the hit (negative before).
    CommonCombatRunner.prototype.drawEpicMotif_oathcrest=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ang=Math.atan2(dy,dx);
      const lockFade=since<0?1:epicClamp(1-since/.35);
      if(launch>0&&lockFade>0){const q=epicSmooth(launch),reach=epicSmooth(launch*1.3);
        // build-up: spear leaves fly along the line toward the target, six crest petals gather on it with a teal lock ring
        solid(ctx,()=>{
          for(let i=0;i<9;i++){const f=(i+.5)/9;if(f>reach)break;leaf(ctx,sx+dx*f-Math.cos(ang)*9,sy+dy*f-Math.sin(ang)*9,ang,18,3.4,theme.a,.85*lockFade,theme.core);}
          for(let i=0;i<6;i++){const pa=i*Math.PI/3+launch*1.6,r=90*(1-.55*q);
            leaf(ctx,tx+Math.cos(pa)*r,ty+Math.sin(pa)*r*.62,pa+Math.PI,26*q+4,7*q+1.5,i%2?theme.c:theme.a,.75*q*lockFade);}
          const rr=70-30*q;epicRing(ctx,tx,ty,rr,rr*.62,1.8,theme.c,.85*q*lockFade);
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,sx,sy,10+16*launch,theme.core,.8*launch*lockFade);epicGlowAt(ctx,sx,sy,5+6*launch,"#ffffff",.9*launch*lockFade);ctx.restore();}
      if(since>=0){const f=1-epicClamp(since/1.2),o=epicOut(epicClamp(since/.4)),cl=epicSmooth(epicClamp((since-.35)/.6));
        // hit: flash and white-hot core, the six-petal crest opens, then a ring of teal light closes over the target
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.35){const bf=1-since/.35;epicGlowLine(ctx,sx,sy,tx,ty,5*bf+1.4,theme.core,.85*bf);}
        epicGlowAt(ctx,tx,ty,34+50*epicOut(since/.3),theme.core,.7*f);epicGlowAt(ctx,tx,ty,24,"#ffffff",f);ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,tx,ty,60+70*epicOut(since/.3),theme.a,.55*f,false);
          for(let i=0;i<6;i++){const pa=i*Math.PI/3+a*.05,L=(26+112*o)*(1-.25*cl),w=(9+18*o)*(1-.3*cl);
            leaf(ctx,tx+Math.cos(pa)*10,ty+Math.sin(pa)*10*.62,pa,L,w,theme.a,.95*f,theme.core);                                   // gold crest petal
            leaf(ctx,tx+Math.cos(pa)*18,ty+Math.sin(pa)*18*.62,pa,L*.34,w*.26,theme.c,.85*f);}                                       // small teal inner leaf
          const cr=(170-95*cl)*(0.55+.45*o);epicRing(ctx,tx,ty,cr,cr*.5,2*(1-.4*cl)+.5,theme.c,.7*f*epicClamp(since/.2));         // the closing oath ring
          gem(ctx,tx,ty-6,7,theme.c,.85*f);
        });
        if(!e.spawned.oathcrest){e.spawned.oathcrest=true;
          epicSpawn(state,tx,ty,22,{kind:"spark",speed:[300,880],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.3,2.8],colors:[theme.core,theme.a,theme.c],grav:220,drag:.9});
          epicSpawn(state,tx,ty-16,10,{kind:"ember",speed:[80,280],life:[.6,1.3],size:[3,6],colors:[theme.a,theme.c,theme.core],grav:-40,drag:.93});}}
    };
  }
  // <<< CHAR_VFX liora
  // >>> CHAR_VFX seorin (tools/char_pipeline/vfx/seorin.js sha256 053c8ade4565bdf0; installed by vfx_lib.py)
  {
    // CHAR_VFX seorin — 서린 (SR-06). Written from tools/char_pipeline/vfx/_TEMPLATE.js; installed by vfx_lib.py.
    // Her weapon is the 서린 콰이어 이미터: a black staff with a brass bell ring and paper talismans. Her shot is one resonance chord:
    //   shot   = a small brass bell ring with a red clapper, three forward-bulging chord arcs trailing behind it (a struck bell, not a bullet);
    //   hit    = the bell stopped by a hand: one round ring that snaps out and is muffled at once, four short gold ticks, no long glow;
    //   muzzle = a ring of resonance pushed out of the staff's bell ring, seen edge-on (a thin ellipse across the aim line), two gold marks;
    //   ult    = "세 갈래 공명" ("명령, 생체, 기억을 한 번에 끊지 마세요" / "한 갈래씩 풀겠습니다"): three thin arcs are released one
    //            after another - crimson (command), gold (body), white (memory) - each on its own tilted line and never merging, over a pale
    //            open channel line that stays drawn between her and the target ("철회 채널").
    // Palette: main #ff4e5a (theme.a), light #fff8f2 (theme.core), accent #e8c07a (theme.c), dark #272123 (theme.b).
    //
    // Runtime helpers you can call (all draw on ctx; alpha fades are your job):
    //   epicGlowAt(ctx,x,y,r,color,alpha,hot=true)            soft round glow. hot=false keeps the colour (use for green/gold/brass).
    //   epicGlowLine(ctx,x1,y1,x2,y2,thick,color,alpha,hot)   soft glow along a segment.
    //   epicStroke(ctx,[[x,y],...],width,color,alpha)          round-capped polyline.
    //   epicRing(ctx,x,y,rx,ry,width,color,alpha,rot=0,a0=0,a1=2PI)   ellipse outline or arc.
    //   epicPoly(ctx,x,y,radius,sides,rot,width,color,alpha,fillAlpha=0)   regular polygon; fillAlpha is ABSOLUTE (multiply by your fade).
    //   epicRays(ctx,x,y,count,inner,outer,spread,color,alpha,spin,seed)    filled ray burst.
    //   epicSpawn(state,x,y,count,{kind:"spark"|"ember",speed:[a,b],angle,spread,life:[a,b],size:[a,b],colors:[...],grav,drag})
    //   epicClamp(v) 0..1, epicOut(v) ease-out, epicSmooth(v) smoothstep, epicIn(v) ease-in, epicHash(n) 0..1.
    // Rules that came from real failures:
    //   - Coloured haze and solid shapes: draw with ctx.globalCompositeOperation="source-over" (the solid() helper below).
    //     Additive ("lighter") green, gold, brass or copper turns cyan/white over the blue stage. Keep only white/light cores additive.
    //   - Every ctx.save() needs its ctx.restore(). Never touch document/window/timers/game state. Particles only via epicSpawn,
    //     and only once per ultimate (guard with e.spawned.<name>). Sparks and round embers only (no rectangular debris).
    //   - Shapes must come from THIS character: her weapon, her ultimate name, her lines.

    // ---- theme: the ultimate motif name and colours (motif must match specs/seorin.json vfx.motif)
    CHAR_VFX_THEMES.seorin={motif:"threestrandchannel",core:"#fff8f2",a:"#ff4e5a",b:"#272123",c:"#e8c07a"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // The projectile head: a small brass bell ring (open circle) with a red clapper dot, the ring turned to face the flight line.
    // Declare helpers with const (not `function`): the block keeps them private to this character.
    const bellHead=(ctx,x,y,ux,uy,r,color,alpha)=>{
      epicRing(ctx,x,y,r,r,Math.max(1.3,r*.28),color,alpha);
      epicGlowAt(ctx,x-ux*r*.15,y-uy*r*.15,Math.max(1.6,r*.42),"#ff4e5a",alpha,false);};
    // One chord arc: a forward-bulging arc (like ")" turned along the flight line) centred behind the head.
    const chordArc=(ctx,x,y,ux,uy,dist,r,width,color,alpha)=>{
      epicRing(ctx,x-ux*dist,y-uy*dist,r*.55,r*1.25,width,color,alpha,Math.atan2(uy,ux),-1.05,1.05);};

    // ---- normal/heavy shot and its hit. q: {x,y,px,py,heavy,...} (px,py = previous position); v: {x,y,age} ONLY - a hit has no
    // direction: shots fly UP the screen, so draw the hit as if the shot came from below (ux=0, uy=-1).
    CHAR_VFX_SHOTS["bell-chord"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,h=q.heavy?1.35:1;
        solid(ctx,()=>{ // coloured wake and head, source-over
          epicGlowLine(ctx,q.px-dx*2.2,q.py-dy*2.2,q.x,q.y,3.6*h,"#ff4e5a",.5,false);
          for(let k=1;k<=3;k++)chordArc(ctx,q.x,q.y,ux,uy,(5+7*k)*h,(4.6+1.5*k)*h,Math.max(1,(2-k*.4)*h),k===2?"#e8c07a":"#ff4e5a",.85-k*.2);
          bellHead(ctx,q.x,q.y,ux,uy,6.4*h,"#e8c07a",.95);
        });
        ctx.save();ctx.globalCompositeOperation="lighter"; // light core only
        epicGlowLine(ctx,q.px-dx*1.2,q.py-dy*1.2,q.x,q.y,1.2*h,"#fff8f2",.8);
        epicGlowAt(ctx,q.x,q.y,2.6*h,"#ffffff",.85);ctx.restore();
      },
      impact(ctx,v){
        // the bell is struck and stopped at once by a hand: one round ring snaps out and is cut short, no long ringing
        const t=Math.min(1,(v.age||0)/.4),p=1-t,snap=epicOut(Math.min(1,t*3));
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,10+12*epicOut(t),"#fff8f2",.6*p);epicGlowAt(ctx,v.x,v.y,4.5,"#ffffff",p);ctx.restore();
        solid(ctx,()=>{
          const r=5+17*snap;epicRing(ctx,v.x,v.y,r,r*.72,2.4*p+.6,"#ff4e5a",.9*p);          // the stopped bell's rim
          const r2=3+9*snap;epicRing(ctx,v.x,v.y,r2,r2*.72,1.4,"#e8c07a",.8*p*(t<.7?1:(1-t)/.3));    // its small inner echo
          for(let i=0;i<4;i++){const a=i*Math.PI/2+Math.PI/4,r0=9+5*snap,r1=15+8*snap;              // four short gold ticks (bell fittings)
            epicStroke(ctx,[[v.x+Math.cos(a)*r0,v.y+Math.sin(a)*r0*.72],[v.x+Math.cos(a)*r1,v.y+Math.sin(a)*r1*.72]],1.8,"#e8c07a",.9*p);}
        });
      }
    };

    // ---- muzzle flash. m: muzzle {x,y}; t: 0->1 over the flash, p=1-t; g: body scale; (c,s2) aim direction; (nx,ny) its normal.
    // A ring of resonance leaves the staff's bell ring: seen edge-on it is a thin ellipse across the aim line, plus a second one behind it.
    MUZZLE_STYLES.seorin=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(16+16*epicOut(t))*g;
      solid(ctx,()=>{
        epicGlowAt(ctx,m.x,m.y,(11+6*t)*g,"#ff4e5a",.45*p,false);
        for(let k=0;k<2;k++){const u=epicClamp(t*1.4-k*.22);if(u<=0)continue;
          epicRing(ctx,m.x+c*L*(.45+.35*k)*u,m.y+s2*L*(.45+.35*k)*u,(3+2*u)*g,(9+9*u)*g,(1.8*(1-u)+.5)*g,k?"#e8c07a":"#ff4e5a",.9*(1-u)*(k?.8:1),ang);}
        for(const k of [-1,1])epicGlowAt(ctx,m.x+nx*k*7*g+c*L*.5,m.y+ny*k*7*g+s2*L*.5,1.8*g,"#e8c07a",.9*p,false);
      });
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.6,m.y+s2*L*.6,1.2*g,"#fff8f2",.9*p);
      epicGlowAt(ctx,m.x,m.y,5*g,"#ffffff",p);
    };

    // ---- ultimate. The GAME CLIPS this function above the formation line (about 10 px above her muzzle): a build-up drawn at her
    // muzzle or lower is invisible in the game (Moa self-test). Draw it above her head, along the line or at the target. The game
    // also draws its own shared layers on top: a light column at her, a full-screen flash in theme.c, big rings in a/c/b and
    // rays in theme.c at the hit - so a near-white theme.c makes every hit white; pick a coloured accent for c.
    // m: {theme,launch,since,sx,sy,tx,ty,a,state}. launch 0->1 while the shot charges (after the cut-in),
    // since = seconds after the hit (negative before it). (sx,sy) = her muzzle, (tx,ty) = the target. e.spawned guards one-shot spawns.
    CommonCombatRunner.prototype.drawEpicMotif_threestrandchannel=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ang=Math.atan2(dy,dx);
      const lockFade=since<0?1:epicClamp(1-since/.35);
      // the three strands: [colour, tilt of its own line, ring width, delay of its release in seconds] - crimson command, gold body, white memory
      const strands=[[theme.a,-.30,3.2,0],[theme.c,0,3.2,.14],[theme.core,.30,2.0,.28]];
      if(launch>0&&lockFade>0){const q=epicSmooth(launch),reach=epicSmooth(launch*1.3);
        // build-up: the pale open channel line is drawn from her to the target, then three small rings gather on the target one after another
        solid(ctx,()=>{
          epicGlowLine(ctx,sx,sy,sx+dx*reach,sy+dy*reach,2.2,theme.core,.42*lockFade,false);
          for(let k=0;k<3;k++){const u=epicClamp(launch*1.6-k*.3);if(u<=0)continue;
            const r=95-62*u;epicRing(ctx,tx,ty,r,r*.34,strands[k][2]*.7,strands[k][0],.75*u*lockFade,strands[k][1]);}
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,sx,sy,9+14*launch,theme.core,.7*launch*lockFade);epicGlowAt(ctx,sx,sy,4+5*launch,"#ffffff",.85*launch*lockFade);ctx.restore();}
      if(since>=0){const f=1-epicClamp(since/1.3);
        // hit: the channel line stays as a pale thread; the three arcs are released one after another, each sweeping out on its own tilted line
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.3){const bf=1-since/.3;epicGlowLine(ctx,sx,sy,tx,ty,4*bf+1.2,theme.core,.7*bf);}
        epicGlowAt(ctx,tx,ty,34+44*epicOut(since/.3),theme.core,.5*f);epicGlowAt(ctx,tx,ty,20,"#ffffff",.9*f);ctx.restore();
        solid(ctx,()=>{
          epicGlowLine(ctx,sx,sy,tx,ty,1.6,theme.core,.3*f*(since<.8?1:(1.3-since)/.5),false);
          epicGlowAt(ctx,tx,ty,60+70*epicOut(since/.3),theme.a,.55*f,false);
          for(const [col,tilt,w,d0] of strands){const u=epicOut(epicClamp((since-d0)/.75));if(u<=0)continue;
            const rx=34+230*u,fade=(1-u*.7)*f;
            epicRing(ctx,tx,ty,rx,rx*.3,w*(1-u*.6)+.5,col,.9*fade,tilt,Math.PI*1.08,Math.PI*1.92);   // the back half of its arc, sweeping outward
            epicRing(ctx,tx,ty,rx,rx*.3,w*(1-u*.6)+.5,col,.9*fade,tilt,Math.PI*.08,Math.PI*.92);}    // the front half
        });
        if(!e.spawned.threestrandchannel){e.spawned.threestrandchannel=true;
          epicSpawn(state,tx,ty,20,{kind:"spark",speed:[260,820],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.3,2.6],colors:[theme.core,theme.a,theme.c],grav:220,drag:.9});
          epicSpawn(state,tx,ty-14,10,{kind:"ember",speed:[70,260],life:[.6,1.3],size:[3,5.5],colors:[theme.a,theme.c,theme.core],grav:-40,drag:.93});}}
    };
  }
  // <<< CHAR_VFX seorin
  // >>> CHAR_VFX eve (tools/char_pipeline/vfx/eve.js sha256 a118ec19c6cae7db; installed by vfx_lib.py)
  {
    // CHAR_VFX eve — 이브 녹턴 (SSR-10). Written from tools/char_pipeline/vfx/_TEMPLATE.js; installed by vfx_lib.py.
    // Her weapon is a small folded gull-wing signal emitter (ivory + black, two forward wing blades, a cyan ring), her lines are about
    // cutting signals and hiding in shadow, and her ultimate 암흑 우회선 ("dark detour line") is:
    //   shot  gull-vane : a slim cyan gull-wing head (a V of two swept-back blades) with a black shadow band and thin silver edges behind it;
    //                     the hit is a "switch-off" - a black core shrinking inside a cyan X cut and one silver ring.
    //   muzzle          : two cyan wing blades open in a V along the aim line with a white spark.
    //   ultimate gullwing: a black shadow band is cut along the line to the target, a thin cyan detour line bends around the target,
    //                     two cyan wing arcs open left and right; at the hit the light drops (a black ellipse) and the arcs close into a silver ring.
    // Palette: main #41c9dc (theme.a), light #f2fdff (theme.core), silver #c9c2c9 (theme.c), black #1c1b1f (theme.b).
    //
    // Runtime helpers you can call (all draw on ctx; alpha fades are your job):
    //   epicGlowAt(ctx,x,y,r,color,alpha,hot=true)            soft round glow. hot=false keeps the colour.
    //   epicGlowLine(ctx,x1,y1,x2,y2,thick,color,alpha,hot)   soft glow along a segment.
    //   epicStroke(ctx,[[x,y],...],width,color,alpha)          round-capped polyline.
    //   epicRing(ctx,x,y,rx,ry,width,color,alpha,rot=0,a0=0,a1=2PI)   ellipse outline or arc.
    //   epicSpawn(state,x,y,count,{kind:"spark"|"ember",speed:[a,b],angle,spread,life:[a,b],size:[a,b],colors:[...],grav,drag})
    //   epicClamp(v) 0..1, epicOut(v) ease-out, epicSmooth(v) smoothstep, epicIn(v) ease-in, epicHash(n) 0..1.
    // Rules that came from real failures: coloured shapes source-over (solid() below), only white/light cores additive; every save()
    // has its restore(); particles only via epicSpawn, once per ultimate (e.spawned.gullwing).

    // ---- theme: the ultimate motif name and colours (motif must match specs/eve.json vfx.motif)
    CHAR_VFX_THEMES.eve={motif:"gullwing",core:"#f2fdff",a:"#41c9dc",b:"#1c1b1f",c:"#c9c2c9"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // A swept blade: a slim curved leaf from (x,y) along ang, length len, half-width w; the tip is sharp, the base is narrow.
    const blade=(ctx,x,y,ang,len,w,color,alpha,edge)=>{ctx.save();ctx.translate(x,y);ctx.rotate(ang);ctx.globalAlpha=alpha;ctx.fillStyle=color;
      ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(len*.35,-w,len,-w*.15);ctx.quadraticCurveTo(len*.5,w*.5,0,0);ctx.closePath();ctx.fill();
      if(edge){ctx.strokeStyle=edge;ctx.lineWidth=Math.max(1,w*.25);ctx.stroke();}ctx.restore();};

    // The gull-wing head: two blades swept back from the tip, one to each side, plus a short forward blade.
    const gullHead=(ctx,x,y,ux,uy,len,w,alpha)=>{const ang=Math.atan2(uy,ux);
      for(const k of [-1,1])blade(ctx,x,y,ang+Math.PI+k*.62,len,w*(k<0?1:-1),"#41c9dc",alpha,"#f2fdff");
      blade(ctx,x-ux*len*.1,y-uy*len*.1,ang,len*.7,w*.7,"#41c9dc",alpha,"#f2fdff");};

    // ---- normal/heavy shot and its hit. q: {x,y,px,py,heavy,...} (px,py = previous position); v: {x,y,age} ONLY - a hit has no
    // direction: shots fly UP the screen, so the hit is drawn as if the shot came from below (ux=0, uy=-1).
    CHAR_VFX_SHOTS["gull-vane"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux,h=q.heavy?1.35:1;
        solid(ctx,()=>{
          epicStroke(ctx,[[q.px-dx*2.6,q.py-dy*2.6],[q.x,q.y]],6.5*h,"#1c1b1f",.6);                                            // black shadow band
          for(const k of [-1,1])epicStroke(ctx,[[q.px-dx*2.6+nx*k*4.2*h,q.py-dy*2.6+ny*k*4.2*h],[q.x+nx*k*4.2*h,q.y+ny*k*4.2*h]],1.1,"#c9c2c9",.55);   // thin silver edges
          epicGlowAt(ctx,q.x,q.y,7*h,"#41c9dc",.5,false);
          gullHead(ctx,q.x,q.y,ux,uy,14*h,4.4*h,.95);
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowLine(ctx,q.px-dx*1.1,q.py-dy*1.1,q.x,q.y,1.3*h,"#f2fdff",.9);
        epicGlowAt(ctx,q.x,q.y,2.8*h,"#ffffff",.85);ctx.restore();
      },
      impact(ctx,v){
        const t=Math.min(1,(v.age||0)/.46),p=1-t,snap=epicOut(Math.min(1,t*2.6));
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,10+14*epicOut(t),"#f2fdff",.55*p);epicGlowAt(ctx,v.x,v.y,4.5,"#ffffff",p*(1-t));ctx.restore();
        solid(ctx,()=>{
          for(const a of [-Math.PI*.25,-Math.PI*.75,Math.PI*.25,Math.PI*.75])blade(ctx,v.x,v.y,a,26*(.35+.65*snap),3.6,"#41c9dc",.95*p,"#f2fdff");   // the X cut
          ctx.save();ctx.globalAlpha=.85*p;ctx.fillStyle="#1c1b1f";ctx.beginPath();ctx.arc(v.x,v.y,7*(1-.55*t),0,Math.PI*2);ctx.fill();ctx.restore();       // the black switch-off core
          const u=epicOut(t),r=9+22*u;epicRing(ctx,v.x,v.y,r,r*.66,1.6,"#c9c2c9",.85*(1-u)*p);
        });
      }
    };

    // ---- muzzle flash. m: muzzle {x,y}; t: 0->1 over the flash, p=1-t; g: body scale; (c,s2) aim direction; (nx,ny) its normal.
    // Two cyan wing blades open in a V along the aim line, a white spark in the middle.
    MUZZLE_STYLES.eve=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(22+18*epicOut(t))*g;
      solid(ctx,()=>{epicGlowAt(ctx,m.x,m.y,(12+7*t)*g,"#41c9dc",.5*p,false);
        for(const k of [-1,1])blade(ctx,m.x,m.y,ang+k*(.34+.14*t),L*1.2,3.8*g*(1-.35*t)*(k<0?1:-1),"#41c9dc",.9*p,"#f2fdff");
        epicStroke(ctx,[[m.x-c*8*g,m.y-s2*8*g],[m.x+c*L*.5,m.y+s2*L*.5]],2.2*g,"#1c1b1f",.55*p);});
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.85,m.y+s2*L*.85,1.2*g,"#f2fdff",.95*p);
      epicGlowAt(ctx,m.x,m.y,5*g,"#ffffff",p);
    };

    // ---- ultimate 암흑 우회선. The GAME CLIPS this function above the formation line (about 10 px above her muzzle): a build-up drawn
    // at her muzzle or lower is invisible in the game. So the build-up runs along the line and on the target. The game also draws its
    // own shared layers on top: a light column at her, a full-screen flash in theme.c, big rings in a/c/b and rays in theme.c at the hit.
    // m: {theme,launch,since,sx,sy,tx,ty,a,state}. launch 0->1 while the shot charges, since = seconds after the hit (negative before).
    CommonCombatRunner.prototype.drawEpicMotif_gullwing=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ux=dx/D,uy=dy/D,nx=-uy,ny=ux,ang=Math.atan2(dy,dx);
      const lockFade=since<0?1:epicClamp(1-since/.35);
      // the detour line: from the muzzle it swings out to one side, bends around the target and comes back onto it
      const bend=(f,side)=>{const s=Math.sin(f*Math.PI),k=side*Math.min(120,D*.28);return [sx+dx*f+nx*k*s*(1-f*.4),sy+dy*f+ny*k*s*(1-f*.4)];};
      if(launch>0&&lockFade>0){const q=epicSmooth(launch),reach=epicSmooth(launch*1.25);
        solid(ctx,()=>{
          epicStroke(ctx,[[sx,sy],[sx+dx*reach,sy+dy*reach]],16*q+2,"#1c1b1f",.5*lockFade);                                          // the black shadow band
          for(const k of [-1,1])epicStroke(ctx,[[sx+nx*k*11*q,sy+ny*k*11*q],[sx+dx*reach+nx*k*11*q,sy+dy*reach+ny*k*11*q]],1.2,theme.c,.6*q*lockFade);
          const pts=[];for(let i=0;i<=16;i++){const f=i/16;if(f>reach)break;pts.push(bend(f,1));}
          if(pts.length>1)epicStroke(ctx,pts,2.2,theme.a,.9*q*lockFade);                                                              // the detour line
          for(const k of [-1,1]){const r=60+90*q;epicRing(ctx,tx,ty,r*1.6,r*.34,2.2,theme.a,.7*q*lockFade,k*.1,k>0?0:Math.PI,k>0?Math.PI:Math.PI*2);} // the two wing arcs open
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,sx,sy,9+15*launch,theme.core,.8*launch*lockFade);epicGlowAt(ctx,sx,sy,4+6*launch,"#ffffff",.9*launch*lockFade);ctx.restore();}
      if(since>=0){const f=1-epicClamp(since/1.2),o=epicOut(epicClamp(since/.4)),cl=epicSmooth(epicClamp((since-.3)/.6));
        // hit: the light drops (a black ellipse), the cyan arcs open wide and then close into a silver ring
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.3){const bf=1-since/.3;epicGlowLine(ctx,sx,sy,tx,ty,4*bf+1.2,theme.core,.85*bf);}
        epicGlowAt(ctx,tx,ty,30+40*epicOut(since/.3),theme.core,.6*f);epicGlowAt(ctx,tx,ty,20,"#ffffff",f);ctx.restore();
        solid(ctx,()=>{
          ctx.save();ctx.globalAlpha=.6*f;ctx.fillStyle=theme.b;ctx.beginPath();ctx.ellipse(tx,ty,(60+120*o)*(1-.4*cl),(30+56*o)*(1-.4*cl),0,0,Math.PI*2);ctx.fill();ctx.restore();
          for(const k of [-1,1]){const r=(70+150*o)*(1-.35*cl);epicRing(ctx,tx,ty,r*1.7,r*.36,3.4*(1-.4*cl)+.7,theme.a,.95*f,k*.1,k>0?0:Math.PI,k>0?Math.PI:Math.PI*2);}
          for(let i=0;i<4;i++){const pa=ang+Math.PI*(.25+.5*i);blade(ctx,tx,ty,pa,(40+90*o)*(1-.3*cl),7+8*o,theme.a,.9*f,theme.core);}       // the X cut of the hit
          const cr=(150-90*cl)*(.55+.45*o);epicRing(ctx,tx,ty,cr,cr*.5,2*(1-.4*cl)+.5,theme.c,.85*f*epicClamp(since/.2));               // the silver ring closes
        });
        if(!e.spawned.gullwing){e.spawned.gullwing=true;
          epicSpawn(state,tx,ty,20,{kind:"spark",speed:[280,820],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.3,2.8],colors:[theme.core,theme.a,theme.c],grav:200,drag:.9});
          epicSpawn(state,tx,ty-14,8,{kind:"ember",speed:[60,220],life:[.6,1.3],size:[3,6],colors:[theme.a,theme.c],grav:-40,drag:.93});}}
    };
  }
  // <<< CHAR_VFX eve
  // >>> CHAR_VFX chaerin (tools/char_pipeline/vfx/chaerin.js sha256 028741fe2fc1ea7b; installed by vfx_lib.py)
  {
    // CHAR_VFX chaerin — 채린 (SR-12). Written from tools/char_pipeline/vfx/_TEMPLATE.js; installed by vfx_lib.py.
    // She is the bureau's retreat-route handler ("퇴로는 케이블마다 하나씩 그어 뒀어요"), her weapon is a compact three-prong triangular
    // arc launcher with an amber route core, and her ultimate 남은 길 개통 ("open the remaining route") draws three retreat routes,
    // strikes two of them off and keeps the last one open:
    //   shot  route-arc : a small amber triangle head (a three-prong route mark) pulling a thin vermilion cable with small anchor ticks;
    //                     the hit stamps a route mark - an amber triangle outline with three short cable lines and one vermilion ring.
    //   muzzle          : three amber prongs fan out along the aim line with a small triangle spark in the middle.
    //   ultimate routetri: three cable lines fly from her to the target and each ends in a triangle route; at the hit two triangles are
    //                     struck off by dark bars and collapse, the last triangle stays open and glows amber, then a vermilion cable ring closes.
    // Palette: main #de923e amber (theme.a), light #fff3df (theme.core), vermilion #ca6032 (theme.c), dark #232224 (theme.b).
    //
    // Runtime helpers you can call (all draw on ctx; alpha fades are your job):
    //   epicGlowAt(ctx,x,y,r,color,alpha,hot=true)            soft round glow. hot=false keeps the colour.
    //   epicGlowLine(ctx,x1,y1,x2,y2,thick,color,alpha,hot)   soft glow along a segment.
    //   epicStroke(ctx,[[x,y],...],width,color,alpha)          round-capped polyline.
    //   epicRing(ctx,x,y,rx,ry,width,color,alpha,rot=0,a0=0,a1=2PI)   ellipse outline or arc.
    //   epicSpawn(state,x,y,count,{kind:"spark"|"ember",speed:[a,b],angle,spread,life:[a,b],size:[a,b],colors:[...],grav,drag})
    //   epicClamp(v) 0..1, epicOut(v) ease-out, epicSmooth(v) smoothstep, epicIn(v) ease-in, epicHash(n) 0..1.
    // Rules that came from real failures: coloured shapes source-over (solid() below), only white/light cores additive; every save()
    // has its restore(); particles only via epicSpawn, once per ultimate (e.spawned.routetri).

    // ---- theme: the ultimate motif name and colours (motif must match specs/chaerin.json vfx.motif)
    CHAR_VFX_THEMES.chaerin={motif:"routetri",core:"#fff3df",a:"#de923e",b:"#232224",c:"#ca6032"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // A triangle outline (or fill) centred on (x,y), circumradius r, rotated by rot.
    const tri=(ctx,x,y,r,rot,width,color,alpha,fill)=>{ctx.save();ctx.globalAlpha=alpha;ctx.lineJoin="round";ctx.beginPath();
      for(let i=0;i<3;i++){const a=rot+i*Math.PI*2/3;const px=x+Math.cos(a)*r,py=y+Math.sin(a)*r;if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);}
      ctx.closePath();if(fill){ctx.fillStyle=color;ctx.fill();}else{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}ctx.restore();};

    // ---- normal/heavy shot and its hit. q: {x,y,px,py,heavy,...} (px,py = previous position); v: {x,y,age} ONLY - a hit has no
    // direction: shots fly UP the screen, so the hit is drawn as if the shot came from below (ux=0, uy=-1).
    CHAR_VFX_SHOTS["route-arc"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux,h=q.heavy?1.35:1,ang=Math.atan2(uy,ux);
        solid(ctx,()=>{
          epicStroke(ctx,[[q.px-dx*2.8,q.py-dy*2.8],[q.x,q.y]],2.6*h,"#ca6032",.75);                                               // the vermilion cable
          for(let k=1;k<=3;k++){const f=k*.85,bx=q.x-dx*f*1.4,by=q.y-dy*f*1.4;epicStroke(ctx,[[bx-nx*3*h,by-ny*3*h],[bx+nx*3*h,by+ny*3*h]],1.3,"#de923e",.8-k*.15);}  // anchor ticks
          epicGlowAt(ctx,q.x,q.y,7*h,"#de923e",.5,false);
          tri(ctx,q.x,q.y,7.2*h,ang,0,"#de923e",.95,true);tri(ctx,q.x,q.y,7.2*h,ang,1.2,"#fff3df",.9,false);                       // the route mark head
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowLine(ctx,q.px-dx*1.1,q.py-dy*1.1,q.x,q.y,1.2*h,"#fff3df",.85);
        epicGlowAt(ctx,q.x,q.y,2.6*h,"#ffffff",.8);ctx.restore();
      },
      impact(ctx,v){
        const t=Math.min(1,(v.age||0)/.46),p=1-t,snap=epicOut(Math.min(1,t*2.4));
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,10+12*epicOut(t),"#fff3df",.55*p);epicGlowAt(ctx,v.x,v.y,4.5,"#ffffff",p*(1-t));ctx.restore();
        solid(ctx,()=>{
          const r=8+10*snap;tri(ctx,v.x,v.y,r,-Math.PI/2,2.4,"#de923e",.95*p,false);                                                  // the stamped route mark
          for(let i=0;i<3;i++){const a=-Math.PI/2+i*Math.PI*2/3,L=(r+16*snap);epicStroke(ctx,[[v.x+Math.cos(a)*r,v.y+Math.sin(a)*r],[v.x+Math.cos(a)*L,v.y+Math.sin(a)*L]],1.8,"#ca6032",.9*p);}
          const u=epicOut(t),rr=10+24*u;epicRing(ctx,v.x,v.y,rr,rr*.66,1.5,"#ca6032",.8*(1-u)*p);
        });
      }
    };

    // ---- muzzle flash. m: muzzle {x,y}; t: 0->1 over the flash, p=1-t; g: body scale; (c,s2) aim direction; (nx,ny) its normal.
    // Three amber prongs fan out along the aim line, a small triangle spark in the middle.
    MUZZLE_STYLES.chaerin=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(20+16*epicOut(t))*g;
      solid(ctx,()=>{epicGlowAt(ctx,m.x,m.y,(11+6*t)*g,"#de923e",.5*p,false);
        for(const k of [-1,0,1]){const a=ang+k*.42,l=L*(k?.8:1.15);epicStroke(ctx,[[m.x,m.y],[m.x+Math.cos(a)*l,m.y+Math.sin(a)*l]],(k?2.6:3.4)*g*(1-.3*t),"#de923e",.9*p);}
        tri(ctx,m.x+c*L*.28,m.y+s2*L*.28,4.6*g,ang,1.1*g,"#fff3df",.85*p,false);});
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.85,m.y+s2*L*.85,1.2*g,"#fff3df",.95*p);
      epicGlowAt(ctx,m.x,m.y,5*g,"#ffffff",p);
    };

    // ---- ultimate 남은 길 개통. The GAME CLIPS this function above the formation line (about 10 px above her muzzle): a build-up drawn
    // at her muzzle or lower is invisible in the game. So the build-up runs along the line and on the target. The game also draws its
    // own shared layers on top: a light column at her, a full-screen flash in theme.c, big rings in a/c/b and rays in theme.c at the hit.
    // m: {theme,launch,since,sx,sy,tx,ty,a,state}. launch 0->1 while the shot charges, since = seconds after the hit (negative before).
    CommonCombatRunner.prototype.drawEpicMotif_routetri=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,nx=-dy/D,ny=dx/D,ang=Math.atan2(dy,dx);
      const lockFade=since<0?1:epicClamp(1-since/.35);
      const off=[-1,0,1];                                                     // three routes: left, straight, right of the aim line
      const endOf=(i)=>[tx+nx*off[i]*110,ty+ny*off[i]*110-Math.abs(off[i])*18];
      if(launch>0&&lockFade>0){const q=epicSmooth(launch);
        solid(ctx,()=>{
          for(let i=0;i<3;i++){const [ex,ey]=endOf(i),rc=epicSmooth(epicClamp(launch*1.4-i*.12)),cx=sx+(ex-sx)*rc+nx*off[i]*40*Math.sin(rc*Math.PI),cy=sy+(ey-sy)*rc+ny*off[i]*40*Math.sin(rc*Math.PI);
            epicStroke(ctx,[[sx,sy],[(sx+cx)/2+nx*off[i]*26*rc,(sy+cy)/2+ny*off[i]*26*rc],[cx,cy]],2.4,theme.c,.85*lockFade);            // the cable
            tri(ctx,cx,cy,6+18*rc,ang,0,theme.a,.9*lockFade,true);tri(ctx,cx,cy,6+18*rc,ang,1.4,theme.core,.85*lockFade,false);}         // the route triangle
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,sx,sy,9+14*launch,theme.core,.8*launch*lockFade);epicGlowAt(ctx,sx,sy,4+6*launch,"#ffffff",.9*launch*lockFade);ctx.restore();}
      if(since>=0){const f=1-epicClamp(since/1.2),o=epicOut(epicClamp(since/.4)),cl=epicSmooth(epicClamp((since-.35)/.6));
        // hit: three triangles open around the target; two are struck off by dark bars and collapse, the last one stays open, then a cable ring closes
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.3){const bf=1-since/.3;epicGlowLine(ctx,sx,sy,tx,ty,4*bf+1.2,theme.core,.85*bf);}
        epicGlowAt(ctx,tx,ty,30+40*epicOut(since/.3),theme.core,.65*f);epicGlowAt(ctx,tx,ty,20,"#ffffff",f);ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,tx,ty,50+80*o,theme.a,.5*f,false);
          for(let i=0;i<3;i++){const r=(60+130*o)-i*24,rot=ang+i*Math.PI*2/9,last=i===2;
            const alpha=(last?1:1-cl)*f;
            tri(ctx,tx,ty,r*(last?1:1-.5*cl),rot,last?5:3,theme.a,.95*alpha,false);
            if(!last&&cl>.05){for(const k of [-1,1]){const bx=tx+Math.cos(rot+1)*r*.2,by=ty+Math.sin(rot+1)*r*.2;                        // the dark strike-off bars
              epicStroke(ctx,[[bx-r*.7,by-k*r*.3],[bx+r*.7,by+k*r*.3]],4*cl+1,theme.b,.85*alpha);}}}
          const cr=(180-100*cl)*(.55+.45*o);epicRing(ctx,tx,ty,cr,cr*.5,2.6*(1-.4*cl)+.6,theme.c,.9*f*epicClamp(since/.2));            // the vermilion cable ring closes
        });
        if(!e.spawned.routetri){e.spawned.routetri=true;
          epicSpawn(state,tx,ty,20,{kind:"spark",speed:[260,800],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.3,2.8],colors:[theme.core,theme.a,theme.c],grav:220,drag:.9});
          epicSpawn(state,tx,ty-14,8,{kind:"ember",speed:[60,240],life:[.6,1.2],size:[3,6],colors:[theme.a,theme.c],grav:-40,drag:.93});}}
    };
  }
  // <<< CHAR_VFX chaerin
  // >>> CHAR_VFX soha (tools/char_pipeline/vfx/soha.js sha256 26b7795d47ba22ce; installed by vfx_lib.py)
  {
    // CHAR_VFX soha — 소하 (SR-14). Written from tools/char_pipeline/vfx/_TEMPLATE.js; installed by vfx_lib.py.
    // She is the bureau's late-arriving scout who watches the broadcast blind spots ("지하 입구가 둘이라고 적혀 있지? 셋이야. 세 번째는 지도에서
    // 빠졌어."), her weapon is a harmonic rifle with two parallel amber rails and a green capacitor, and her ultimate 누락된 세 번째 길 ("the
    // missing third way") opens three yellow-green triangle routes, each with a gap in one side like an entrance, and sends a double rail
    // through every gap until the rails close on the target from three directions:
    //   shot  split-rail-key : two parallel amber rails with a green capacitor bar between them and a hollow key bow behind; three uneven
    //                          grit ticks trail it. The hit is a broken triangle (a gap in one side) with three short uneven fragment lines.
    //   muzzle               : two very close parallel rail flashes along the aim line, a green tick and a few loose-contact crackle strokes.
    //   ultimate mapgap      : three gap triangles appear one after another above her head and ahead of the aim line, an amber double rail
    //                          passes through each gap and closes on the target from three directions; at the hit a dark triangle keeps its
    //                          three vertices open and small rectangular map pieces are pushed outward.
    // Palette: main #e8b542 (theme.a), light #fff3b0 (theme.core), accent #b5c745 (theme.c), dark #313033 (theme.b).
    //
    // Runtime helpers you can call (all draw on ctx; alpha fades are your job):
    //   epicGlowAt(ctx,x,y,r,color,alpha,hot=true)            soft round glow. hot=false keeps the colour (use for green/gold/brass).
    //   epicGlowLine(ctx,x1,y1,x2,y2,thick,color,alpha,hot)   soft glow along a segment.
    //   epicStroke(ctx,[[x,y],...],width,color,alpha)          round-capped polyline.
    //   epicRing(ctx,x,y,rx,ry,width,color,alpha,rot=0,a0=0,a1=2PI)   ellipse outline or arc.
    //   epicSpawn(state,x,y,count,{kind:"spark"|"ember",speed:[a,b],angle,spread,life:[a,b],size:[a,b],colors:[...],grav,drag})
    //   epicClamp(v) 0..1, epicOut(v) ease-out, epicSmooth(v) smoothstep, epicIn(v) ease-in, epicHash(n) 0..1.
    // Rules that came from real failures: coloured shapes source-over (solid() below), only white/light cores additive; every save()
    // has its restore(); particles only via epicSpawn (sparks and embers), once per ultimate (e.spawned.mapgap).

    // ---- theme: the ultimate motif name and colours (motif must match specs/soha.json vfx.motif)
    CHAR_VFX_THEMES.soha={motif:"mapgap",core:"#fff3b0",a:"#e8b542",b:"#313033",c:"#b5c745"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // Two parallel rails from (x1,y1) to (x2,y2), gap = half the distance between them.
    const railPair=(ctx,x1,y1,x2,y2,w,gap,color,alpha)=>{const dx=x2-x1,dy=y2-y1,L=Math.hypot(dx,dy)||1,nx=-dy/L*gap,ny=dx/L*gap;
      epicStroke(ctx,[[x1+nx,y1+ny],[x2+nx,y2+ny]],w,color,alpha);epicStroke(ctx,[[x1-nx,y1-ny],[x2-nx,y2-ny]],w,color,alpha);};

    const triPts=(x,y,r,rot)=>[0,1,2].map(i=>[x+Math.cos(rot+i*Math.PI*2/3)*r,y+Math.sin(rot+i*Math.PI*2/3)*r]);
    const lerp2=(p,q,f)=>[p[0]+(q[0]-p[0])*f,p[1]+(q[1]-p[1])*f];

    // Triangle outline with an entrance-like gap in side `gi` (between vertex gi and gi+1); returns the gap centre.
    const gapTri=(ctx,x,y,r,rot,width,color,alpha,gi,gf)=>{
      const P=triPts(x,y,r,rot),A=P[gi%3],B=P[(gi+1)%3],C=P[(gi+2)%3];
      epicStroke(ctx,[lerp2(A,B,.5+gf/2),B,C,A,lerp2(A,B,.5-gf/2)],width,color,alpha);
      return lerp2(A,B,.5);};

    const fillTri=(ctx,x,y,r,rot,color,alpha)=>{const P=triPts(x,y,r,rot);ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle=color;
      ctx.beginPath();ctx.moveTo(P[0][0],P[0][1]);ctx.lineTo(P[1][0],P[1][1]);ctx.lineTo(P[2][0],P[2][1]);ctx.closePath();ctx.fill();ctx.restore();};

    // ---- normal/heavy shot and its hit. q: {x,y,px,py,heavy,...} (px,py = previous position); v: {x,y,age} ONLY - a hit has no
    // direction: shots fly UP the screen, so the hit is drawn as if the shot came from below (ux=0, uy=-1).
    CHAR_VFX_SHOTS["split-rail-key"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux,h=q.heavy?1.35:1;
        solid(ctx,()=>{
          railPair(ctx,q.px-dx*2.6,q.py-dy*2.6,q.x+ux*4*h,q.y+uy*4*h,2.2*h,3.2*h,"#e8b542",.88);                                  // the twin amber rails
          epicStroke(ctx,[[q.x-ux*10*h,q.y-uy*10*h],[q.x-ux*3*h,q.y-uy*3*h]],3.2*h,"#b5c745",.95);                                  // the green capacitor bar
          const bx=q.x-ux*17*h,by=q.y-uy*17*h,s=4.6*h;                                                                              // the hollow key bow
          epicStroke(ctx,[[bx+ux*s,by+uy*s],[bx+nx*s,by+ny*s],[bx-ux*s,by-uy*s],[bx-nx*s,by-ny*s],[bx+ux*s,by+uy*s]],1.5*h,"#e8b542",.85);
          for(let k=0;k<3;k++){const f=[.7,1.5,2.6][k],o=[3.2,-4.2,1.8][k];                                                          // three uneven grit ticks
            const gx=q.px-dx*f*1.6+nx*o*h,gy=q.py-dy*f*1.6+ny*o*h;epicStroke(ctx,[[gx,gy],[gx-ux*3*h,gy-uy*3*h]],1.4,"#b5c745",.8-k*.2);}
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowLine(ctx,q.px-dx*1.1,q.py-dy*1.1,q.x,q.y,1.2*h,"#fff3b0",.85);
        epicGlowAt(ctx,q.x,q.y,2.8*h,"#ffffff",.8);ctx.restore();
      },
      impact(ctx,v){
        const t=Math.min(1,(v.age||0)/.46),p=1-t,snap=epicOut(Math.min(1,t*2.6));
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,10+14*epicOut(t),"#fff3b0",.6*p);epicGlowAt(ctx,v.x,v.y,4.5,"#ffffff",p*(1-t));ctx.restore();
        solid(ctx,()=>{
          const r=7+9*snap;gapTri(ctx,v.x,v.y,r,-Math.PI/2,2.2,"#b5c745",.95*p,0,.5);                                                // a broken triangle: the missing side
          const A=[-2.5,-.45,1.15],L=[16,24,13],Dl=[0,.05,.11];
          for(let i=0;i<3;i++){const u=epicOut(Math.min(1,Math.max(0,(t-Dl[i])*2.4))),r0=r+3,r1=r0+L[i]*u;                             // three uneven fragments
            epicStroke(ctx,[[v.x+Math.cos(A[i])*r0,v.y+Math.sin(A[i])*r0],[v.x+Math.cos(A[i])*r1,v.y+Math.sin(A[i])*r1]],2,"#e8b542",.9*p);}
          const u=epicOut(t),rr=8+22*u;epicRing(ctx,v.x,v.y,rr,rr*.66,1.4,"#e8b542",.7*(1-u)*p);
        });
      }
    };

    // ---- muzzle flash. m: muzzle {x,y}; t: 0->1 over the flash, p=1-t; g: body scale; (c,s2) aim direction; (nx,ny) its normal.
    // Two very close parallel rail flashes, a green tick and a few loose-contact crackle strokes.
    MUZZLE_STYLES.soha=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(22+18*epicOut(t))*g;
      solid(ctx,()=>{epicGlowAt(ctx,m.x,m.y,(12+7*t)*g,"#e8b542",.5*p,false);
        railPair(ctx,m.x,m.y,m.x+c*L,m.y+s2*L,(2.6*p+.8)*g,3*g,"#e8b542",.92*p);                                                     // the first rail discharge
        railPair(ctx,m.x+c*L*.2,m.y+s2*L*.2,m.x+c*L*.62,m.y+s2*L*.62,(1.6*p+.5)*g,3*g,"#b5c745",.9*p);                               // the second, right behind it
        for(let k=0;k<3;k++){const a=ang+[-.9,.6,1.25][k],l=[10,13,8][k]*g,o=[.3,.5,.4][k]*L;                                       // loose-contact crackle
          epicStroke(ctx,[[m.x+c*o,m.y+s2*o],[m.x+c*o+Math.cos(a)*l,m.y+s2*o+Math.sin(a)*l]],1.2*g,"#b5c745",.8*p);}});
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.8,m.y+s2*L*.8,1.3*g,"#fff3b0",.95*p);
      epicGlowAt(ctx,m.x,m.y,5*g,"#ffffff",p);
    };

    // ---- ultimate 누락된 세 번째 길. The GAME CLIPS this function above the formation line (about 10 px above her muzzle): a build-up drawn
    // at her muzzle or lower is invisible in the game. So the three gap triangles sit above her head and ahead of the aim line. The game
    // also draws its own shared layers on top: a light column at her, a full-screen flash in theme.c, big rings in a/c/b and rays in
    // theme.c at the hit. m: {theme,launch,since,sx,sy,tx,ty,a,state}. launch 0->1 while the shot charges, since = seconds after the
    // hit (negative before).
    CommonCombatRunner.prototype.drawEpicMotif_mapgap=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ux=dx/D,uy=dy/D,nx=-uy,ny=ux,ang=Math.atan2(dy,dx);
      const lockFade=since<0?1:epicClamp(1-since/.35);
      const at=[0,1,2].map(i=>{const f=.28+.2*i,off=(i-1)*88;return [sx+dx*f+nx*off,sy+dy*f+ny*off-18-(i===1?12:0)];});   // the three triangles, apart from each other
      const endOf=[0,1,2].map(i=>{const b=-Math.PI/2+i*Math.PI*2/3;return [tx+Math.cos(b)*34,ty+Math.sin(b)*34];});          // the rails close from three directions
      if(launch>0&&lockFade>0){
        solid(ctx,()=>{
          for(let i=0;i<3;i++){const ap=epicSmooth(epicClamp((launch-i*.2)/.22));if(ap<=0)continue;
            const [px,py]=at[i],toT=Math.atan2(ty-py,tx-px),r=16+20*ap;
            fillTri(ctx,px,py,r,toT-Math.PI/3,theme.b,.35*ap*lockFade);
            const gc=gapTri(ctx,px,py,r,toT-Math.PI/3,3.6,theme.c,.92*ap*lockFade,0,.46);                                              // yellow-green triangle route with its entrance gap
            const rp=epicSmooth(epicClamp((launch-i*.2-.14)/.5));
            if(rp>0){const [ex,ey]=endOf[i],cx=(gc[0]+ex)/2+nx*(i-1)*46,cy=(gc[1]+ey)/2+ny*(i-1)*46,pts=[];
              for(let k=0;k<=10;k++){const s=rp*k/10,o=1-s;pts.push([o*o*gc[0]+2*o*s*cx+s*s*ex,o*o*gc[1]+2*o*s*cy+s*s*ey]);}
              for(let k=1;k<pts.length;k++)railPair(ctx,pts[k-1][0],pts[k-1][1],pts[k][0],pts[k][1],2.4,2.6,theme.a,.9*lockFade);}}       // the amber double rail through the gap
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,sx,sy,9+14*launch,theme.core,.8*launch*lockFade);epicGlowAt(ctx,sx,sy,4+6*launch,"#ffffff",.9*launch*lockFade);ctx.restore();}
      if(since>=0){const f=1-epicClamp(since/1.2),o=epicOut(epicClamp(since/.4));
        // hit: a dark triangle keeps its three vertices open, the rails close on it from three sides, small map pieces are pushed outward
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.3){const bf=1-since/.3;epicGlowLine(ctx,sx,sy,tx,ty,4*bf+1.2,theme.core,.85*bf);}
        epicGlowAt(ctx,tx,ty,30+44*epicOut(since/.3),theme.core,.6*f);epicGlowAt(ctx,tx,ty,20,"#ffffff",f);ctx.restore();
        solid(ctx,()=>{
          const R=(60+138*o),rot=-Math.PI/2,P=triPts(tx,ty,R,rot);
          fillTri(ctx,tx,ty,R,rot,theme.b,.6*f);                                                                                    // the black inside
          for(let i=0;i<3;i++){const A=P[i],B=P[(i+1)%3];
            epicStroke(ctx,[lerp2(A,B,.15),lerp2(A,B,.85)],6*(1-.3*o)+1,theme.c,.9*f);                                            // the sides stop short of every vertex
            const mid=lerp2(A,B,.5);railPair(ctx,mid[0],mid[1],tx+(mid[0]-tx)*.38,ty+(mid[1]-ty)*.38,2.6,2.8,theme.a,.9*f);}       // the rails close from three sides
          for(let k=0;k<7;k++){const h1=epicHash(k*7+3),h2=epicHash(k*13+5),dir=h1*Math.PI*2,dist=(34+150*o)*(.55+.45*h2);          // small rectangular map pieces
            const px=tx+Math.cos(dir)*dist,py=ty+Math.sin(dir)*dist*.7,w=6+6*h2,hh=4+4*h1;
            ctx.save();ctx.globalAlpha=.9*f;ctx.translate(px,py);ctx.rotate(dir+since*(h1<.5?-2.4:2.4));ctx.fillStyle=k%3===0?theme.b:(k%3===1?theme.a:theme.c);
            ctx.fillRect(-w/2,-hh/2,w,hh);ctx.restore();}
        });
        if(!e.spawned.mapgap){e.spawned.mapgap=true;
          epicSpawn(state,tx,ty,22,{kind:"spark",speed:[260,820],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.3,2.8],colors:[theme.core,theme.a,theme.c],grav:220,drag:.9});
          epicSpawn(state,tx,ty-14,8,{kind:"ember",speed:[60,240],life:[.6,1.2],size:[3,6],colors:[theme.a,theme.c],grav:-40,drag:.93});}}
    };
  }
  // <<< CHAR_VFX soha
  // >>> CHAR_VFX yuria (tools/char_pipeline/vfx/yuria.js sha256 7c8f4c5d88c74290; installed by vfx_lib.py)
  {
    // CHAR_VFX yuria — 유리아 글린트 SSR-14.
    // Compact twin rounds leave paired radio ticks; the on-air impact is a stopped
    // record arc. '하나, 둘, 셋. 지금' builds three paired equalizer spears, with the
    // fourth count releasing six magenta/violet blades into the target. Colour uses
    // source-over; only small white cores add light. No edits to shared characters.
    CHAR_VFX_THEMES.yuria={motif:"countinnow",core:"#fff2fb",a:"#ff4fd8",b:"#18121b",c:"#b98cff"};
    const ink=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};
    const tickPair=(ctx,x,y,ux,uy,h,fade)=>{
     const nx=-uy,ny=ux;
     for(const k of [-1,1])epicStroke(ctx,[[x+nx*k*3*h-ux*8*h,y+ny*k*3*h-uy*8*h],[x+nx*k*3*h+ux*4*h,y+ny*k*3*h+uy*4*h]],2*h,"#ff4fd8",fade);
     epicStroke(ctx,[[x-ux*5*h,y-uy*5*h],[x+ux*7*h,y+uy*7*h]],1.2*h,"#fff2fb",fade);
    };
    CHAR_VFX_SHOTS["twin-beat"]={
     trail(ctx,q){
      const dx=q.x-q.px,dy=q.y-q.py,d=Math.hypot(dx,dy)||1,ux=dx/d,uy=dy/d,h=q.heavy?1.5:1;
      ink(ctx,()=>{epicGlowLine(ctx,q.px-dx,q.py-dy,q.x,q.y,4*h,"#ff4fd8",.45,false);tickPair(ctx,q.x,q.y,ux,uy,h,.95);
       for(let k=1;k<=3;k++){const f=k*.65;epicStroke(ctx,[[q.x-dx*f-uy*3*h,q.y-dy*f+ux*3*h],[q.x-dx*f+uy*3*h,q.y-dy*f-ux*3*h]],1.1*h,"#b98cff",.65-k*.14);}});
      ctx.save();ctx.globalCompositeOperation="lighter";epicGlowAt(ctx,q.x,q.y,3*h,"#fff2fb",.75);ctx.restore();
     },
     impact(ctx,v){
      const t=Math.min(1,(v.age||0)/.45),fade=1-t,r=8+25*epicOut(t);
      ink(ctx,()=>{epicRing(ctx,v.x,v.y,r,r*.7,1.6,"#ff4fd8",fade,.0,-Math.PI*.9,Math.PI*.6);
       epicRing(ctx,v.x,v.y,r*.65,r*.45,1.4,"#b98cff",.85*fade,0,Math.PI*.2,Math.PI*1.6);
       for(let k=0;k<3;k++){const x=v.x+(k-1)*8;epicStroke(ctx,[[x,v.y+8+9*t],[x,v.y-8-(k===1?14:8)*epicOut(t)]],2,"#ff4fd8",fade);}});
      ctx.save();ctx.globalCompositeOperation="lighter";epicGlowAt(ctx,v.x,v.y,6+10*epicOut(t),"#fff2fb",.65*fade);ctx.restore();
     }
    };
    MUZZLE_STYLES.yuria=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{
     const reach=(18+13*epicOut(t))*g;
     ink(ctx,()=>{for(const k of [-1,1]){const ox=nx*k*3*g,oy=ny*k*3*g;epicStroke(ctx,[[m.x+ox,m.y+oy],[m.x+ox+c*reach,m.y+oy+s2*reach]],(1+2*p)*g,k<0?"#ff4fd8":"#b98cff",.9*p);}
      epicRing(ctx,m.x+c*8*g,m.y+s2*8*g,7*g,3*g,1.2*g,"#ff4fd8",.7*p,ang);});
     ctx.save();ctx.globalCompositeOperation="lighter";epicGlowLine(ctx,m.x,m.y,m.x+c*reach*.7,m.y+s2*reach*.7,1.5*g,"#fff2fb",p);epicGlowAt(ctx,m.x,m.y,4*g,"#ffffff",.8*p);ctx.restore();
    };
    CommonCombatRunner.prototype.drawEpicMotif_countinnow=function(ctx,e,m){
     const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,d=Math.hypot(dx,dy)||1,ux=dx/d,uy=dy/d,nx=-uy,ny=ux;
     const locked=since<0?1:epicClamp(1-since/.25);
     if(launch>0&&locked>0){
      ink(ctx,()=>{for(let beat=0;beat<3;beat++){const step=epicClamp(launch*3-beat),f=epicSmooth(step)*locked;if(!f)continue;
       for(const side of [-1,1]){const spread=side*(17+beat*14),bx=tx-dx*.30+nx*spread,by=ty-dy*.30+ny*spread;
        epicStroke(ctx,[[bx-ux*(22+beat*8)*f,by-uy*(22+beat*8)*f],[bx+ux*12,by+uy*12]],3+beat,side<0?theme.a:theme.c,.9*f);
        epicStroke(ctx,[[bx+ux*12-nx*5,by+uy*12-ny*5],[bx+ux*22,by+uy*22],[bx+ux*12+nx*5,by+uy*12+ny*5]],2,theme.a,f);}
       epicRing(ctx,tx,ty,18+beat*11,11+beat*7,1.4,theme.c,.7*f,0,-Math.PI*.9,Math.PI*.55);}});
     }
     if(since>=0){const fade=1-epicClamp(since/1.05),burst=epicOut(epicClamp(since/.22));
      ink(ctx,()=>{for(let beat=0;beat<3;beat++)for(const side of [-1,1]){const offset=side*(14+beat*17)*(1+burst),len=(35+beat*13)*(1+burst);
       const bx=tx+nx*offset,by=ty+ny*offset;epicStroke(ctx,[[bx-ux*len,by-uy*len],[bx+ux*len*.8,by+uy*len*.8]],(4-beat*.6)*fade+.4,side<0?theme.a:theme.c,.95*fade);}
       for(let k=0;k<3;k++){const u=epicOut(epicClamp((since-k*.07)/.6));epicRing(ctx,tx,ty,25+160*u,(25+160*u)*.48,2.5-k*.5,theme.a,.8*(1-u)*fade);}});
      ctx.save();ctx.globalCompositeOperation="lighter";epicGlowAt(ctx,tx,ty,12+25*burst,theme.core,.7*fade);if(since<.2)epicGlowLine(ctx,sx,sy,tx,ty,3*(1-since/.2)+.6,theme.core,.8*fade);ctx.restore();
      if(!e.spawned.countinnow){e.spawned.countinnow=true;epicSpawn(state,tx,ty,24,{kind:"spark",speed:[220,680],angle:Math.atan2(dy,dx),spread:Math.PI*1.7,life:[.25,.65],size:[1.2,2.3],colors:[theme.a,theme.c,theme.core],grav:180,drag:.92});}
     }
    };
  }
  // <<< CHAR_VFX yuria
  // >>> CHAR_VFX sea (tools/char_pipeline/vfx/sea.js sha256 923cb9908825dbbb; installed by vfx_lib.py)
  {
    // CHAR_VFX sea — 세아 (R-06). Her 세아 콰이어 펄스 is a tuning-fork emitter: two parallel prismatic crystal prongs above a round concentric-ring
    // emitter disc. So every shot is a TWIN-PRONG pulse (two separate parallel prongs, the ring disc behind them, violet charm-line rungs between
    // the pair) and every hit is a ring that parts into two halves that never rejoin ("맥이 서로 닿되 뿌리까지 섞이지 않게"). Her ultimate
    // “다섯 맥, 같은 순간” (SPEAR_CORE_PETALS, petalCount 10 = five prong pairs, width 22, length 500 = ring radius 250): five separate pairs
    // appear one after another around the target, wait, then all ten prongs snap in and touch the white-hot core ring on the SAME beat; the
    // pulse that follows is five separate arcs, never one closed ring ("다섯 맥이 하나가 되지 않고 같은 순간만 나눠요").
    // Palette: main #61e5f6 (theme.a, the weapon's cyan crystal), light #e8fbff (theme.core), accent #af76f9 (theme.c, its violet reflections),
    // dark #2b3478 (theme.b, her navy shorts and the weapon grips; the standing-art navy median).
    //
    // Runtime helpers you can call (all draw on ctx; alpha fades are your job):
    //   epicGlowAt(ctx,x,y,r,color,alpha,hot=true)            soft round glow. hot=false keeps the colour (use for green/gold/brass).
    //   epicGlowLine(ctx,x1,y1,x2,y2,thick,color,alpha,hot)   soft glow along a segment.
    //   epicStroke(ctx,[[x,y],...],width,color,alpha)          round-capped polyline.
    //   epicRing(ctx,x,y,rx,ry,width,color,alpha,rot=0,a0=0,a1=2PI)   ellipse outline or arc.
    //   epicPoly(ctx,x,y,radius,sides,rot,width,color,alpha,fillAlpha=0)   regular polygon; fillAlpha is ABSOLUTE (multiply by your fade).
    //   epicRays(ctx,x,y,count,inner,outer,spread,color,alpha,spin,seed)    filled ray burst.
    //   epicSpawn(state,x,y,count,{kind:"spark"|"ember",speed:[a,b],angle,spread,life:[a,b],size:[a,b],colors:[...],grav,drag})
    //   epicClamp(v) 0..1, epicOut(v) ease-out, epicSmooth(v) smoothstep, epicIn(v) ease-in, epicHash(n) 0..1.
    // Rules:
    //   - Prongs, discs, rungs and haze are drawn source-over via solid(). Additive "lighter" is for white/light cores only.
    //   - Every ctx.save() has a matching ctx.restore(). Do not touch document/window/timers/game state.
    //   - Particles only via epicSpawn, once per ultimate guarded by e.spawned.sharedmoment. Sparks and round embers only.
    //   - Hit input v only has x, y and age. Shot direction comes from q; never read an angle from v.

    CHAR_VFX_THEMES.sea={motif:"sharedmoment",core:"#e8fbff",a:"#61e5f6",b:"#2b3478",c:"#af76f9"};

    const solid=(ctx,fn)=>{ctx.save();ctx.globalCompositeOperation="source-over";fn();ctx.restore();};

    // One crystal prong of her emitter, root (x0,y0) to tip (x1,y1): a navy edge, a cyan body and a pale core line.
    const prong=(ctx,x0,y0,x1,y1,w,alpha)=>{if(alpha<=0)return;
      epicStroke(ctx,[[x0,y0],[x1,y1]],w+2.4,"#2b3478",alpha*.85);
      epicStroke(ctx,[[x0,y0],[x1,y1]],w,"#61e5f6",alpha);
      epicStroke(ctx,[[x0+(x1-x0)*.14,y0+(y1-y0)*.14],[x0+(x1-x0)*.9,y0+(y1-y0)*.9]],Math.max(.8,w*.32),"#e8fbff",alpha*.9);};

    // The pointed crystal tip on a prong (a small violet diamond), direction (ux,uy).
    const tipMark=(ctx,x,y,ux,uy,len,w,alpha)=>{if(alpha<=0)return;const nx=-uy,ny=ux;
      epicStroke(ctx,[[x+ux*len,y+uy*len],[x+nx*w,y+ny*w],[x-ux*len*.4,y-uy*len*.4],[x-nx*w,y-ny*w],[x+ux*len,y+uy*len]],Math.max(1.1,w*.42),"#af76f9",alpha);};

    // The concentric emitter disc: navy rim, cyan ring, violet ring.
    const disc=(ctx,x,y,r,alpha)=>{if(alpha<=0)return;
      epicRing(ctx,x,y,r,r,Math.max(1.3,r*.32),"#2b3478",alpha*.85);
      epicRing(ctx,x,y,r*.76,r*.76,Math.max(1,r*.22),"#61e5f6",alpha);
      epicRing(ctx,x,y,r*.4,r*.4,Math.max(.9,r*.16),"#af76f9",alpha);};

    CHAR_VFX_SHOTS["twin-prong-pulse"]={
      trail(ctx,q){
        const dx=q.x-q.px,dy=q.y-q.py,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux,h=q.heavy?1.35:1,gap=3.7*h;
        solid(ctx,()=>{
          epicGlowLine(ctx,q.px-dx*2.6,q.py-dy*2.6,q.x-ux*8*h,q.y-uy*8*h,7*h,"#2b3478",.5,false);                       // the navy wake behind the disc
          epicGlowLine(ctx,q.px-dx*1.8,q.py-dy*1.8,q.x,q.y,3.2*h,"#61e5f6",.5,false);
          for(const s of [-1,1]){                                                                                         // two separate parallel prongs, the roots never join
            const ox=nx*gap*s,oy=ny*gap*s;
            prong(ctx,q.x-ux*8*h+ox,q.y-uy*8*h+oy,q.x+ux*8*h+ox,q.y+uy*8*h+oy,1.9*h,.97);
            tipMark(ctx,q.x+ux*8*h+ox,q.y+uy*8*h+oy,ux,uy,3.4*h,1.5*h,.95);}
          for(let k=0;k<2;k++){const f=(k?-1.5:3.5)*h;                                                                   // violet charm-line rungs joining the pair
            epicStroke(ctx,[[q.x+ux*f+nx*gap,q.y+uy*f+ny*gap],[q.x+ux*f-nx*gap,q.y+uy*f-ny*gap]],1.1*h,"#af76f9",.85);}
          disc(ctx,q.x-ux*9*h,q.y-uy*9*h,4.2*h,1);                                                                       // the emitter disc at the root
        });
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,q.x+ux*6*h,q.y+uy*6*h,3.2*h,"#ffffff",.85);epicGlowLine(ctx,q.px-dx*.8,q.py-dy*.8,q.x,q.y,1.3*h,"#e8fbff",.8);ctx.restore();
      },
      impact(ctx,v){
        const t=Math.min(1,(v.age||0)/.5),p=1-t,u=epicOut(Math.min(1,t*1.5)),snap=epicOut(Math.min(1,t*3));
        ctx.save();ctx.globalCompositeOperation="lighter";
        epicGlowAt(ctx,v.x,v.y,10+14*u,"#e8fbff",.55*p);epicGlowAt(ctx,v.x,v.y,4.5,"#ffffff",.95*p);ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,v.x,v.y,14+12*u,"#61e5f6",.28*p,false);
          const d=3+15*u;                                                                                                // the ring parts into two halves that never rejoin
          for(const s of [-1,1]){const cx=v.x+s*d,r=9+10*u,a0=s>0?-Math.PI/2:Math.PI/2,a1=s>0?Math.PI/2:Math.PI*1.5;
            epicRing(ctx,cx,v.y,r,r*.68,2.6*(1-u*.5)+.4,"#61e5f6",.92*p,0,a0,a1);
            epicRing(ctx,cx,v.y,r*.56,r*.56*.68,1.4,"#af76f9",.85*p,0,a0,a1);
            prong(ctx,cx,v.y+3,cx,v.y-9-12*snap,1.7,.95*p);}                                                             // each half keeps its own prong standing
          for(let i=0;i<5;i++){const a=-Math.PI/2+(i-2)*.55,r=8+20*u;                                                    // crystal chips thrown up and out
            tipMark(ctx,v.x+Math.cos(a)*r,v.y+Math.sin(a)*r*.8,Math.cos(a),Math.sin(a)*.8,3.2,1.3,.9*p);}
          epicRing(ctx,v.x,v.y+3,8+26*u,(8+26*u)*.4,1.5,"#2b3478",.6*(1-u)*p);                                            // the shadow ring on the ground
        });
      }
    };

    // Muzzle: her two crystal prongs flash forward side by side, the concentric disc pulses at the emitter, a cyan haze and a pale core line.
    MUZZLE_STYLES.sea=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{const L=(20+16*epicOut(t))*g,gap=3.4*g;
      solid(ctx,()=>{
        epicGlowAt(ctx,m.x,m.y,(13+8*t)*g,"#61e5f6",.5*p,false);
        for(const s of [-1,1])prong(ctx,m.x+nx*gap*s,m.y+ny*gap*s,m.x+nx*gap*s+c*L,m.y+ny*gap*s+s2*L,1.5*g,.92*p);
        disc(ctx,m.x,m.y,(5+4*t)*g,.9*p);});
      ctx.save();ctx.globalCompositeOperation="lighter";
      epicGlowLine(ctx,m.x,m.y,m.x+c*L*.7,m.y+s2*L*.7,1.3*g,"#e8fbff",.9*p);epicGlowAt(ctx,m.x,m.y,5*g,"#ffffff",p);ctx.restore();
    };

    // ---- ultimate “다섯 맥, 같은 순간”: five prong pairs (petalCount 10, pair width 22, ring length 500 = radius 250) around the target. They appear
    // one after another while the shot charges (five separate pulses), wait at the rim, and at the hit all ten prongs snap in and touch the
    // white-hot core ring on the same beat. The pulse that follows is five separate arcs, never a closed ring. Drawn at the target (the game
    // clips below her muzzle).
    CommonCombatRunner.prototype.drawEpicMotif_sharedmoment=function(ctx,e,m){
      const {theme,launch,since,sx,sy,tx,ty,a,state}=m,dx=tx-sx,dy=ty-sy,D=Math.hypot(dx,dy)||1,ang=Math.atan2(dy,dx);
      const PAIRS=5,R=250,RC=58,LP=86,GAP=11,SQ=.62,PW=3.6,R0=R-LP;                                                        // R0: tip radius while the pairs wait on the rim
      const dirOf=i=>-Math.PI/2+i*Math.PI*2/PAIRS+a*.03;
      const pt=(pa,r,off)=>{const ux=Math.cos(pa),uy=Math.sin(pa);return [tx+ux*r-uy*off,ty+(uy*r+ux*off)*SQ];};
      const pair=(i,r0,alpha)=>{if(alpha<=0)return;const pa=dirOf(i);                                                     // pair i: tips at radius r0, roots LP further out
        for(const s of [-1,1]){const root=pt(pa,r0+LP,GAP*s),tp=pt(pa,r0,GAP*s);
          prong(ctx,root[0],root[1],tp[0],tp[1],PW,alpha);
          const ex=tp[0]-root[0],ey=(tp[1]-root[1]),el=Math.hypot(ex,ey)||1;tipMark(ctx,tp[0],tp[1],ex/el,ey/el,5,2.4,alpha);}
        for(let k=0;k<3;k++){const r=r0+LP*(.22+.28*k),l=pt(pa,r,GAP),rt=pt(pa,r,-GAP);                                    // charm-line rungs between the two prongs
          epicStroke(ctx,[l,rt],1.3,theme.c,alpha*.8);}};
      const lockFade=since<0?1:epicClamp(1-since/.35);
      if(launch>0&&lockFade>0){const q=epicSmooth(launch);
        solid(ctx,()=>{
          for(const s of [-1,1]){for(let i=0;i<12;i++){const f0=i/12,f1=f0+.5/12,reach=epicSmooth(epicClamp(launch*1.3));if(f0>reach)break;   // the twin dashed line to the target
            const ox=-dy/D*5*s,oy=dx/D*5*s;
            epicStroke(ctx,[[sx+ox+dx*f0,sy+oy+dy*f0],[sx+ox+dx*Math.min(f1,reach),sy+oy+dy*Math.min(f1,reach)]],1.8,s>0?theme.a:theme.c,.85*lockFade);}}
          epicRing(ctx,tx,ty,R,R*SQ,1.4,theme.b,.4*q*lockFade);epicRing(ctx,tx,ty,RC,RC*SQ,2.2,theme.a,.6*q*lockFade);          // the rim and the core ring
          for(let i=0;i<PAIRS;i++){const ap=epicSmooth(epicClamp((launch*1.6-i*.24)/.3));pair(i,R0+22*(1-ap),.92*ap*lockFade);}}); // five pulses appear one after another
        ctx.save();ctx.globalCompositeOperation="lighter";
        for(let i=0;i<PAIRS;i++){const w=epicClamp((launch*1.6-i*.24)/.3),pop=Math.sin(Math.PI*w),c0=pt(dirOf(i),R0+22*(1-epicSmooth(w))+LP*.5,0);
          if(pop>0)epicGlowAt(ctx,c0[0],c0[1],8+14*pop,theme.core,.65*pop*lockFade);}
        epicGlowAt(ctx,sx,sy,10+16*launch,theme.core,.8*launch*lockFade);epicGlowAt(ctx,sx,sy,5+6*launch,"#ffffff",.9*launch*lockFade);ctx.restore();}
      if(since>=0){const f=1-epicClamp(since/1.2),snap=epicOut(epicClamp(since/.2)),ru=epicOut(epicClamp((since-.16)/.8)),cf=epicClamp(since/.3);
        ctx.save();ctx.globalCompositeOperation="lighter";
        if(since<.35){const bf=1-since/.35;epicGlowLine(ctx,sx,sy,tx,ty,6*bf+1.4,theme.core,.85*bf);}
        epicGlowAt(ctx,tx,ty,18+30*epicOut(cf),theme.core,.7*f);epicGlowAt(ctx,tx,ty,14,"#ffffff",.95*f);
        if(since>.14&&since<.6){const tf=1-(since-.14)/.46;for(let i=0;i<PAIRS;i++){const c0=pt(dirOf(i),RC+2,0);epicGlowAt(ctx,c0[0],c0[1],10+10*tf,theme.core,.7*tf);}}   // ten tips touch on the same beat
        ctx.restore();
        solid(ctx,()=>{
          epicGlowAt(ctx,tx,ty,50+70*ru,theme.a,.32*f*(1-ru*.6),false);
          epicRing(ctx,tx,ty,R,R*SQ,1.4,theme.b,.35*f*(1-snap*.6));                                                     // the rim they came from
          for(let i=0;i<PAIRS;i++)pair(i,RC+(R0-RC)*(1-snap),.95*f);                                                  // all ten prongs snap in and hold
          epicRing(ctx,tx,ty,RC,RC*SQ,3.4,theme.a,.9*f*snap);epicRing(ctx,tx,ty,RC*.62,RC*.62*SQ,2,theme.c,.85*f*snap);   // the white-hot core ring
          for(let i=0;i<PAIRS;i++){const r=RC+(R-RC+40)*ru,pa=dirOf(i);                                                 // five separate arcs, never one closed ring
            epicRing(ctx,tx,ty,r,r*SQ,5.4*(1-ru)+1.4,i%2?theme.c:theme.a,.95*(1-ru*.75)*f,0,pa-.5,pa+.5);}
          epicRays(ctx,tx,ty,10,16,40+120*ru,.04,theme.c,.5*f,a*.2,57);
        });
        if(!e.spawned.sharedmoment){e.spawned.sharedmoment=true;
          epicSpawn(state,tx,ty,24,{kind:"spark",speed:[280,860],angle:ang,spread:Math.PI*2,life:[.3,.7],size:[1.3,2.8],colors:[theme.core,theme.a,theme.c],grav:230,drag:.9});
          epicSpawn(state,tx,ty-12,12,{kind:"ember",speed:[70,260],life:[.6,1.3],size:[2.5,5.5],colors:[theme.a,theme.c,theme.core],grav:-36,drag:.93});}}
    };
  }
  // <<< CHAR_VFX sea
  // >>> CHAR_VFX haejin (tools/char_pipeline/vfx/haejin.js sha256 11d4b17cd2dbbe20; installed by vfx_lib.py)
  {
    // Haejin R-01: broad slag bolts and three independent foundry blast doors.
    // Copper edges and opaque teal faces retain their colour on the blue stage.
    // Six short pressure slugs cross the gaps after the three doors lock in turn.
    CHAR_VFX_THEMES.haejin={motif:"forgeward",core:"#ffe8cc",a:"#d7a183",b:"#47474a",c:"#6e8183"};
    const metalInk=(ctx,draw)=>{ctx.save();ctx.globalCompositeOperation="source-over";draw();ctx.restore();};
    const plate=(ctx,x,y,ux,uy,w,h,fade)=>{
     const nx=-uy,ny=ux,coords=[[-w,-h*.7],[-w*.45,-h],[w*.55,-h],[w,-h*.65],[w,h*.65],[w*.55,h],[-w*.45,h],[-w,h*.7]];
     ctx.save();ctx.globalAlpha=fade*.86;ctx.beginPath();
     coords.forEach((p,i)=>{const px=x+ux*p[0]+nx*p[1],py=y+uy*p[0]+ny*p[1];if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);});
     ctx.closePath();ctx.fillStyle="#47474a";ctx.fill();ctx.strokeStyle="#d7a183";ctx.lineWidth=2.5;ctx.stroke();ctx.restore();
     for(const side of [-1,1]){
      epicStroke(ctx,[[x+nx*h*.72*side-ux*w*.55,y+ny*h*.72*side-uy*w*.55],[x+nx*h*.72*side+ux*w*.55,y+ny*h*.72*side+uy*w*.55]],2,"#6e8183",fade);
      epicStroke(ctx,[[x+nx*h*.46*side-ux*w*.50,y+ny*h*.46*side-uy*w*.50],[x+nx*h*.46*side+ux*w*.50,y+ny*h*.46*side+uy*w*.50]],1.4,"#d7a183",fade*.72);
     }
     epicStroke(ctx,[[x-nx*h*.25,y-ny*h*.25],[x+nx*h*.25,y+ny*h*.25]],2,"#6e8183",fade);
    };
    const slug=(ctx,x,y,ux,uy,size,fade)=>{
     const nx=-uy,ny=ux;
     epicStroke(ctx,[[x-ux*size*9,y-uy*size*9],[x+ux*size*3,y+uy*size*3]],size*5,"#47474a",fade);
     epicStroke(ctx,[[x-ux*size*8,y-uy*size*8],[x+ux*size*4,y+uy*size*4]],size*2.4,"#d7a183",fade);
     epicStroke(ctx,[[x+nx*size*3-ux*size*3,y+ny*size*3-uy*size*3],[x+nx*size*3+ux*size,y+ny*size*3+uy*size]],size,"#6e8183",fade);
    };
    CHAR_VFX_SHOTS["slag-bolt"]={
     trail(ctx,q){
      const dx=q.x-q.px,dy=q.y-q.py,d=Math.hypot(dx,dy)||1,ux=dx/d,uy=dy/d,s=q.heavy?1.55:1;
      metalInk(ctx,()=>{epicGlowLine(ctx,q.px-dx*.8,q.py-dy*.8,q.x,q.y,4*s,"#6e8183",.42,false);slug(ctx,q.x,q.y,ux,uy,s,.98);
       for(let k=1;k<4;k++){const f=k*.65;epicStroke(ctx,[[q.x-dx*f-uy*3*s,q.y-dy*f+ux*3*s],[q.x-dx*f+uy*3*s,q.y-dy*f-ux*3*s]],1.5*s,"#d7a183",.55-k*.10);}});
      ctx.save();ctx.globalCompositeOperation="lighter";epicGlowAt(ctx,q.x,q.y,2.5*s,"#ffe8cc",.65);ctx.restore();
     },
     impact(ctx,v){
      const t=epicClamp((v.age||0)/.53),fade=1-t,b=epicOut(t);
      metalInk(ctx,()=>{epicRing(ctx,v.x,v.y,8+31*b,5+17*b,2.3,"#6e8183",fade,0,Math.PI*.15,Math.PI*1.85);
       for(let k=0;k<3;k++){const a=-Math.PI*.84+k*Math.PI*.34,r=9+29*b,x=v.x+Math.cos(a)*r,y=v.y+Math.sin(a)*r;
        epicStroke(ctx,[[x-3,y+4],[x+3,y-4]],3-k*.4,"#d7a183",fade);}
       epicStroke(ctx,[[v.x-9-15*b,v.y+5+7*b],[v.x-2,v.y+1],[v.x+9+15*b,v.y+5+7*b]],2,"#47474a",fade);});
      ctx.save();ctx.globalCompositeOperation="lighter";epicGlowAt(ctx,v.x,v.y,5+8*b,"#ffe8cc",.63*fade);ctx.restore();
     }
    };
    MUZZLE_STYLES.haejin=(ctx,m,t,p,g,c,s2,nx,ny,ang)=>{
     const reach=(21+16*epicOut(t))*g;
     metalInk(ctx,()=>{for(let k=0;k<3;k++){const spread=(k-1)*4*g;
      epicStroke(ctx,[[m.x+nx*spread,m.y+ny*spread],[m.x+c*reach+nx*spread*.4,m.y+s2*reach+ny*spread*.4]],(2.5+2*p)*g,k===1?"#d7a183":"#6e8183",.84*p);}
      epicRing(ctx,m.x+c*9*g,m.y+s2*9*g,5*g,8*g,2*g,"#d7a183",p,ang);});
     ctx.save();ctx.globalCompositeOperation="lighter";epicGlowLine(ctx,m.x,m.y,m.x+c*reach*.67,m.y+s2*reach*.67,1.7*g,"#ffe8cc",p);epicGlowAt(ctx,m.x,m.y,4*g,"#ffe8cc",.7*p);ctx.restore();
    };
    CommonCombatRunner.prototype.drawEpicMotif_forgeward=function(ctx,e,m){
     const {theme,launch,since,sx,sy,tx,ty,state}=m,dx=tx-sx,dy=ty-sy,d=Math.hypot(dx,dy)||1,ux=dx/d,uy=dy/d,nx=-uy,ny=ux;
     const release=since<0?1:1-epicClamp(since/.52);
     metalInk(ctx,()=>{
      for(let k=0;k<3;k++){
       const lock=epicSmooth(epicClamp(launch*3-k)),f=lock*release;
       if(f<=0)continue;
       const part=.40+k*.17,x=sx+dx*part,y=sy+dy*part,h=(29+k*9)*lock;
       plate(ctx,x,y,ux,uy,11,h,f);
       for(const side of [-1,1])epicStroke(ctx,[[x+nx*(h+7)*side-ux*8,y+ny*(h+7)*side-uy*8],[x+nx*(h+7)*side+ux*8,y+ny*(h+7)*side+uy*8]],2,theme.c,.8*f);
      }
      if(since>=0){
       const travel=epicOut(epicClamp(since/.23)),fade=1-epicClamp(since/.62);
       for(let k=0;k<3;k++)for(const side of [-1,1]){
        const start=.4+k*.17,at=start+(1-start)*travel,offset=side*(10+k*4)*(1-travel);
        slug(ctx,sx+dx*at+nx*offset,sy+dy*at+ny*offset,ux,uy,1.6-k*.13,fade);
       }
       const burst=epicOut(epicClamp(since/.35)),af=1-epicClamp(since/1.1);
       for(let k=0;k<3;k++){
        const r=26+burst*(50+k*32),aa=-Math.PI*.75+k*Math.PI*.5;
        epicRing(ctx,tx,ty,r,r*.72,3-k*.4,theme.c,af*.85,0,aa-.34,aa+.34);
        epicRing(ctx,tx,ty,r+5,(r+5)*.72,1.6,theme.a,af*.9,0,aa-.34,aa+.34);
       }
      }
     });
     if(since>=0){
      const fade=1-epicClamp(since/.74);
      ctx.save();ctx.globalCompositeOperation="lighter";epicGlowAt(ctx,tx,ty,9+16*epicOut(epicClamp(since/.18)),theme.core,fade*.68);ctx.restore();
      if(!e.spawned.forgeward){e.spawned.forgeward=true;epicSpawn(state,tx,ty,21,{kind:"spark",speed:[170,540],angle:Math.atan2(dy,dx),spread:Math.PI*1.7,life:[.3,.8],size:[1.5,3.1],colors:[theme.a,theme.c,theme.core],grav:280,drag:.91});}
     }
    };
  }
  // <<< CHAR_VFX haejin
  const coreDisposeEpic=CommonCombatRunner.prototype.dispose;
  CommonCombatRunner.prototype.dispose=function(...args){this.__afEpic=null;return coreDisposeEpic.apply(this,args);};
  if(epicEnabled){const epicStyle=document.createElement("style");epicStyle.textContent=`:is(#cutin,#ultimateCutin,.ultimate-cutin).af-epic{border-left-color:var(--af-epic-a,#fff0ac)!important;box-shadow:0 0 34px var(--af-epic-glow,rgba(74,211,255,.3)),inset 0 0 46px var(--af-epic-glow,rgba(74,211,255,.2))!important}:is(#cutin,#ultimateCutin,.ultimate-cutin).af-epic::before{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;background:repeating-linear-gradient(104deg,transparent 0 22px,var(--af-epic-line,rgba(255,255,255,.18)) 22px 24px),linear-gradient(90deg,transparent 35%,var(--af-epic-glow,rgba(74,211,255,.3)));animation:afEpicLines .9s linear both;will-change:opacity}:is(#cutin,#ultimateCutin,.ultimate-cutin).af-epic::after{content:"";position:absolute;top:-10%;bottom:-10%;left:-45%;width:40%;z-index:3;pointer-events:none;background:linear-gradient(100deg,transparent,rgba(255,255,255,.62),transparent);mix-blend-mode:screen;transform:translateX(0) skewX(-18deg);animation:afEpicSweep .62s .06s ease-out both;will-change:transform}@media (orientation:portrait){:is(#cutin,#ultimateCutin,.ultimate-cutin).af-epic{width:56%!important}}@keyframes afEpicSweep{from{transform:translateX(0) skewX(-18deg)}to{transform:translateX(400%) skewX(-18deg)}}@keyframes afEpicLines{0%{opacity:0}25%{opacity:1}100%{opacity:.55}}`;document.head.append(epicStyle);}
  // ===== BATTLE HUD V1 — NIKKE-style re-skin (2026-09-23, Claude Code) =====
  // Re-skins the runtime-owned HUD without changing its DOM contract: angular glass squad cards with the
  // character's accent colour, portrait cut, segmented HP, ammo pips and a burst-gauge ring; icon action
  // buttons with a round BURST button; a segmented boss bar with a damage trail and phase pips; and an aim
  // reticle with an ammo/reload ring for the selected character. ?vfx=classic restores the previous HUD.
  const hudEnabled=epicEnabled;
  const hudAccent=spec=>(EPIC_THEMES[spec?.id]||CHAR_VFX_THEMES[spec?.id])?.a||spec?.palette?.[0]||"#77f5ff";
  const hudAccent2=spec=>(EPIC_THEMES[spec?.id]||CHAR_VFX_THEMES[spec?.id])?.b||spec?.palette?.[2]||"#488cff";
  const hudIcon=path=>`url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='${path}'/></svg>")`;
  const HUD_ICON_COVER=hudIcon("M12 2 4 5v6c0 5.2 3.4 9.4 8 11 4.6-1.6 8-5.8 8-11V5z"),HUD_ICON_RELOAD=hudIcon("M12 4a8 8 0 1 0 7.7 10h-2.2A6 6 0 1 1 12 6c1.6 0 3.1.7 4.2 1.8L13 11h7V4l-2.3 2.3A8 8 0 0 0 12 4z"),HUD_ICON_MOTION=hudIcon("M4 5h16v14H4zm2 2v2h2V7zm0 4v2h2v-2zm0 4v2h2v-2zm10-8v2h2V7zm0 4v2h2v-2zm0 4v2h2v-2z");
  const HUD_S='body[data-af-common-combat-active="v1"]',HUD_P='#af-common-party[data-af-hud="nikke-v1"]',HUD_A='#af-common-actions[data-af-hud="nikke-v1"]';
  const hudStyle=document.createElement("style");hudStyle.id="af-hud-nikke-v1";
  hudStyle.textContent=hudEnabled?`#af-common-party,#af-common-actions,#af-battle-timer,#cutin,#ultimateCutin,.ultimate-cutin,header,aside,#af-party-layout-editor{--af-font:"Bahnschrift","DIN Alternate","Avenir Next Condensed","Roboto Condensed","Arial Narrow","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif}
${HUD_P}{left:2%!important;right:auto!important;width:calc(96% - 104px)!important;transform:none;gap:10px!important;bottom:max(10px,env(safe-area-inset-bottom))!important;align-items:end!important}
${HUD_P} button{--af-c:#77f5ff;--af-c2:#488cff;--af-ult:0;height:96px!important;min-height:0!important;padding:0!important;border:0!important;border-radius:0!important;background:linear-gradient(165deg,rgba(26,38,60,.95) 0%,rgba(10,15,27,.96) 52%,rgba(5,8,15,.97) 100%)!important;clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px));color:#fff!important;overflow:hidden!important;transition:transform .18s ease,filter .2s ease;font-family:var(--af-font)!important;box-shadow:inset 0 0 0 1px rgba(190,225,255,.16)!important;cursor:pointer}
${HUD_P} button::after{content:"";position:absolute;left:0;top:0;right:16px;height:3px;z-index:6;pointer-events:none;background:linear-gradient(90deg,var(--af-c),var(--af-c2) 60%,transparent)}
${HUD_P} button.active{transform:translateY(-9px)}
${HUD_P} button.active{box-shadow:inset 0 0 0 2px var(--af-c),inset 0 14px 18px -12px var(--af-c)!important}
${HUD_P} button.active::after{height:4px;right:0}
${HUD_P} .af-portrait-frame{left:0!important;top:0!important;width:41%!important;height:100%!important;clip-path:polygon(0 0,100% 0,80% 100%,0 100%);background:radial-gradient(90% 80% at 45% 30%,var(--af-c2),transparent 70%),linear-gradient(170deg,#1a2740,#070b14)!important;z-index:1}
${HUD_P} .af-portrait-frame::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 52%,rgba(4,7,14,.88)),linear-gradient(90deg,transparent 70%,rgba(4,7,14,.55));pointer-events:none}
${HUD_P} .af-portrait-frame>img{filter:saturate(1.08) contrast(1.04)}
${HUD_P} .af-slotno{position:absolute;left:0;top:0;z-index:7;padding:3px 7px 3px 5px;background:var(--af-c);color:#061018;font:800 10px/1 var(--af-font);letter-spacing:.04em;clip-path:polygon(0 0,100% 0,calc(100% - 6px) 100%,0 100%)}
${HUD_P} small{position:absolute!important;left:41%;top:10px;right:48px;margin:0!important;font:700 9px/1 var(--af-font)!important;letter-spacing:.06em!important;text-transform:uppercase;color:var(--af-c)!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:3}
${HUD_P} b{position:absolute!important;left:41%;top:24px;right:46px;margin:0!important;font:700 15px/1.1 var(--af-font)!important;letter-spacing:0;color:#fff!important;text-shadow:0 1px 0 #000,0 0 10px rgba(0,0,0,.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:3}
${HUD_P} i[data-status]{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap}
${HUD_P} .af-bars{left:41%!important;right:10px!important;bottom:19px!important;height:12px!important;grid-template-columns:minmax(30px,1fr) 46px!important;gap:8px!important;z-index:3}
${HUD_P} .af-hp-label{display:none!important}
${HUD_P} .af-hp{position:relative;height:9px!important;border:0!important;background:rgba(0,0,0,.55)!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)!important;transform:skewX(-24deg);overflow:hidden}
${HUD_P} .af-hp::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0 calc(10% - 1.5px),rgba(0,0,0,.6) calc(10% - 1.5px) 10%);pointer-events:none}
${HUD_P} .af-hp>u{background:linear-gradient(90deg,#1fe089,#8dffbd 70%,#e9fff3)!important;box-shadow:0 0 8px rgba(80,255,170,.55)}
${HUD_P} button.low-hp .af-hp>u{background:linear-gradient(90deg,#ff2f5f,#ff8a5c)!important;box-shadow:0 0 10px rgba(255,60,100,.7)}
${HUD_P} .af-hp-text{font:700 11px/1 var(--af-font)!important;color:#eafff4!important;letter-spacing:.02em}
${HUD_P} .af-bullets{left:41%!important;right:10px!important;bottom:8px!important;height:5px!important;gap:2px!important;z-index:3;transform:skewX(-24deg)}
${HUD_P} .af-bullets>i{border-radius:0!important;background:var(--af-c)!important;box-shadow:none!important}
${HUD_P} .af-bullets>i.spent{background:rgba(255,255,255,.1)!important;box-shadow:none!important;opacity:1!important}
${HUD_P} .af-burst{position:absolute;right:8px;top:8px;width:36px;height:36px;z-index:7;border-radius:50%;background:radial-gradient(circle,rgba(6,10,20,.95) 0 58%,transparent 60%),conic-gradient(var(--af-c) calc(var(--af-ult)*3.6deg),rgba(255,255,255,.13) 0)}
${HUD_P} .af-burst>em{position:absolute;inset:0;display:grid;place-items:center;font:800 9px/1 var(--af-font);font-style:normal;color:#dfefff;letter-spacing:.02em}
${HUD_P} button[data-af-ult="ready"] .af-burst{background:radial-gradient(circle,rgba(6,10,20,.9) 0 56%,transparent 58%),conic-gradient(var(--af-c),#fff,var(--af-c2),var(--af-c));animation:afHudSpin 1.6s linear infinite;will-change:transform}
${HUD_P} button[data-af-ult="ready"] .af-burst>em{color:#fff;font-size:7.5px;letter-spacing:.06em;animation:afHudSpin 1.6s linear infinite reverse;text-shadow:0 0 6px var(--af-c)}
${HUD_P} button[data-af-ult="ready"] .af-portrait-frame{filter:brightness(1.18)}
${HUD_P} .af-tag{position:absolute;z-index:8;left:0;right:0;top:34%;display:none;padding:4px 0;text-align:center;font:800 13px/1 var(--af-font);letter-spacing:.34em;color:#fff;pointer-events:none}
${HUD_P} button[data-af-state="RELOAD"] .af-tag{display:block;left:0;right:59%;top:auto;bottom:10px;font-size:10px;letter-spacing:.22em;color:#ffd08a;background:repeating-linear-gradient(-45deg,rgba(255,170,60,.22) 0 7px,transparent 7px 14px);animation:afHudBlink .6s steps(2,end) infinite;will-change:opacity}
${HUD_P} button[data-af-state="COVER"] .af-tag{display:block;left:auto;right:50px;top:10px;padding:3px 6px;font-size:8px;letter-spacing:.14em;color:#061018;background:#9fe8ff}
${HUD_P} button[data-af-state="DOWN"],${HUD_P} button[data-af-state="REVIVE"]{filter:grayscale(1) brightness(.62)}
${HUD_P} button:is([data-af-state="DOWN"],[data-af-state="REVIVE"]) .af-tag{display:block;color:#ff6f8f;background:rgba(40,0,12,.72)}
${HUD_P} button[data-character-id="EMPTY"]{opacity:.35}
@keyframes afHudSpin{to{transform:rotate(360deg)}}
@keyframes afHudBlink{50%{opacity:.35}}
${HUD_A}{top:auto!important;left:auto!important;right:2%!important;bottom:max(10px,env(safe-area-inset-bottom))!important;display:grid!important;grid-template-columns:84px;grid-template-areas:"cover" "reload" "motion" "burst";gap:6px!important;justify-items:end;align-items:end!important}
${HUD_A} [data-cover]{grid-area:cover}
${HUD_A} [data-reload]{grid-area:reload}
${HUD_A} [data-motion-factory]{grid-area:motion}
${HUD_A} [data-ultimate]{grid-area:burst;justify-self:center}
${HUD_A} button{position:relative;min-width:0!important;min-height:0!important;width:48px!important;height:40px!important;padding:0!important;border:0!important;border-radius:0!important;background:linear-gradient(180deg,rgba(26,40,64,.94),rgba(8,14,26,.96))!important;clip-path:polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%);color:#e9f6ff!important;font:700 0px/1 var(--af-font)!important;letter-spacing:.05em!important;box-shadow:inset 0 0 0 1px rgba(170,225,255,.28)!important;cursor:pointer}
${HUD_A} button:not([data-ultimate])::after{position:absolute;right:9px;bottom:3px;font:700 9px/1 var(--af-font);color:#9fe8ff;opacity:.8}
${HUD_A} [data-cover]::after{content:"C"}
${HUD_A} [data-reload]::after{content:"R"}
${HUD_A} [data-motion-factory]::after{content:"V"}
${HUD_A} button::before{content:"";position:absolute;left:50%;top:50%;width:17px;height:17px;margin:-8.5px 0 0 -8.5px;background:#9fe8ff;-webkit-mask:var(--af-icon) center/contain no-repeat;mask:var(--af-icon) center/contain no-repeat}
${HUD_A} button[data-cover]{--af-icon:${HUD_ICON_COVER}}
${HUD_A} button[data-reload]{--af-icon:${HUD_ICON_RELOAD}}
${HUD_A} button[data-motion-factory]{--af-icon:${HUD_ICON_MOTION};opacity:.72}
${HUD_A} button.active{background:linear-gradient(180deg,rgba(24,86,108,.95),rgba(8,30,46,.96))!important;box-shadow:inset 0 0 0 1px #9ff4ff!important;color:#fff!important}
${HUD_A} button[data-ultimate]{counter-reset:afult var(--af-ult);width:84px!important;height:84px!important;padding:0!important;border-radius:50%!important;clip-path:none!important;background:radial-gradient(circle at 50% 38%,rgba(46,26,72,.96),rgba(8,6,18,.97) 70%)!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18),0 6px 18px rgba(0,0,0,.45)!important;font-size:0!important;color:transparent!important}
${HUD_A} button[data-ultimate]::before{left:0;right:0;top:50%;width:auto;height:auto;margin:0;transform:translateY(-50%);-webkit-mask:none;mask:none;background:none;content:"BURST\\A" counter(afult) "%";white-space:pre;text-align:center;font:800 13px/1.35 var(--af-font);letter-spacing:.1em;color:var(--af-c)}
${HUD_A} button[data-ultimate]::after{content:"";position:absolute;inset:-5px;border-radius:50%;background:conic-gradient(var(--af-c) calc(var(--af-ult)*3.6deg),rgba(255,255,255,.12) 0);-webkit-mask:radial-gradient(circle,transparent calc(50% - 5px),#000 calc(50% - 4px));mask:radial-gradient(circle,transparent calc(50% - 5px),#000 calc(50% - 4px));pointer-events:none}
${HUD_A} button[data-ultimate].af-ready{color:#fff!important;animation:afHudPulse 1s ease-in-out infinite;will-change:transform}
${HUD_A} button[data-ultimate].af-ready::after{background:conic-gradient(var(--af-c),#fff,var(--af-c));animation:afHudSpin 1.4s linear infinite;will-change:transform}
${HUD_A} button[data-ultimate].af-ready::before{content:"BURST\\AREADY";color:#fff;text-shadow:0 0 10px var(--af-c)}
@keyframes afHudPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
${HUD_S} #af-battle-timer{font:700 21px/1 var(--af-font)!important;padding:7px 22px 6px!important;border:0!important;background:linear-gradient(180deg,rgba(18,30,50,.93),rgba(6,10,20,.95))!important;clip-path:polygon(12px 0,calc(100% - 12px) 0,100% 50%,calc(100% - 12px) 100%,12px 100%,0 50%);letter-spacing:.14em!important;color:#f2fbff!important;text-shadow:0 0 10px rgba(120,220,255,.55);box-shadow:none!important}
${HUD_S} #af-battle-timer:before{font:700 9px/1 var(--af-font)!important;letter-spacing:.2em;color:#8fd8ff!important;margin-right:6px}
${HUD_S} #af-battle-timer.warning{color:#fff1a8!important;text-shadow:0 0 12px rgba(255,190,80,.8)}
${HUD_S} #af-battle-timer.critical{color:#fff!important;text-shadow:0 0 12px rgba(255,70,110,.95)}
${HUD_S} :is(#fireToggle,#fireAuto,#auto,#tacticalAuto,#ultimate,#cutsceneToggle,#ultimateSideToggle){font-family:var(--af-font)!important;letter-spacing:.08em!important;background:linear-gradient(180deg,rgba(24,36,58,.92),rgba(7,12,22,.94))!important;border:0!important;border-radius:0!important;box-shadow:inset 0 0 0 1px rgba(160,222,255,.34)!important;clip-path:polygon(9px 0,100% 0,100% calc(100% - 9px),calc(100% - 9px) 100%,0 100%,0 9px);color:#e8f6ff!important}
${HUD_S} :is(#fireToggle,#fireAuto,#auto,#tacticalAuto,#cutsceneToggle).on{box-shadow:inset 0 0 0 1px #8ff3ff,inset 0 0 16px rgba(80,220,255,.35)!important;color:#fff!important}
${HUD_S} :is(.mission,.operation-title){font-family:var(--af-font)!important;text-shadow:0 2px 0 rgba(0,0,0,.7),0 0 16px rgba(0,0,0,.65)}
${HUD_S} :is(aside.feed,aside.command-feed){background:linear-gradient(100deg,rgba(10,16,30,.93),rgba(10,16,30,.62) 78%,rgba(10,16,30,0))!important;border:0!important;border-left:3px solid #ffb84d!important;border-radius:0!important;box-shadow:none!important;font-family:var(--af-font)!important}
${HUD_S} aside.manual{background:linear-gradient(180deg,rgba(44,12,44,.93),rgba(14,6,22,.95))!important;border:0!important;border-radius:0!important;box-shadow:inset 0 0 0 1px rgba(255,120,200,.5)!important;clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);font-family:var(--af-font)!important}
${HUD_S} #af-party-layout-editor{background:linear-gradient(180deg,rgba(24,36,58,.93),rgba(7,12,22,.95))!important;border:0!important;box-shadow:inset 0 0 0 1px rgba(160,222,255,.34)!important;font-family:var(--af-font)!important;letter-spacing:.06em}
@media (max-height:500px) and (orientation:landscape){
${HUD_P}{left:1%!important;width:calc(98% - 70px)!important;gap:5px!important;bottom:max(4px,env(safe-area-inset-bottom))!important}
${HUD_P} button{height:62px!important;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px))}
${HUD_P} button.active{transform:translateY(-5px)}
${HUD_P} .af-portrait-frame{width:37%!important}
${HUD_P} small{display:none!important}
${HUD_P} b{left:37%;top:9px;right:27px;font-size:10.5px!important}
${HUD_P} .af-bars{left:37%!important;right:6px!important;bottom:13px!important;height:8px!important;grid-template-columns:minmax(20px,1fr) 30px!important;gap:4px!important}
${HUD_P} .af-hp{height:6px!important}
${HUD_P} .af-hp-text{font-size:8px!important}
${HUD_P} .af-bullets{left:37%!important;right:6px!important;bottom:5px!important;height:3px!important;gap:1px!important}
${HUD_P} .af-burst{width:22px;height:22px;right:4px;top:4px}
${HUD_P} .af-burst>em{font-size:6px}
${HUD_P} button[data-af-ult="ready"] .af-burst>em{font-size:0}
${HUD_P} .af-slotno{font-size:8px;padding:2px 5px 2px 3px}
${HUD_P} .af-tag{font-size:8px!important;letter-spacing:.14em!important}
${HUD_P} button[data-af-state="COVER"] .af-tag{right:28px;top:26px}
${HUD_A}{top:auto!important;left:auto!important;right:max(6px,env(safe-area-inset-right))!important;bottom:max(4px,env(safe-area-inset-bottom))!important;width:auto!important;display:grid!important;grid-template-columns:58px;grid-template-areas:"cover" "reload" "motion" "burst";gap:5px!important;justify-items:end;align-items:end!important}
${HUD_A} button:not([data-ultimate])::after{display:none}
${HUD_A} [data-cover]{grid-area:cover}
${HUD_A} [data-reload]{grid-area:reload}
${HUD_A} [data-motion-factory]{grid-area:motion}
${HUD_A} [data-ultimate]{grid-area:burst;align-self:center}
${HUD_A} button:not([data-ultimate]){width:40px!important;min-width:40px!important;height:30px!important;padding:0!important;font-size:0!important}
${HUD_A} button:not([data-ultimate])::before{left:50%;width:15px;height:15px;margin:-7.5px 0 0 -7.5px}
${HUD_A} button[data-ultimate]{width:58px!important;height:58px!important}
${HUD_A} button[data-ultimate]::before{font-size:9.5px}
${HUD_S} #af-battle-timer{font-size:15px!important;padding:5px 16px 4px!important}}
@media (orientation:portrait){
${HUD_P}{left:1%!important;width:98%!important;gap:4px!important;bottom:max(6px,env(safe-area-inset-bottom))!important}
${HUD_P} button{height:86px!important;clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,9px 100%,0 calc(100% - 9px))}
${HUD_P} button.active{transform:translateY(-6px)}
${HUD_P} .af-portrait-frame{width:100%!important;clip-path:none}
${HUD_P} .af-portrait-frame::after{background:linear-gradient(180deg,transparent 35%,rgba(4,7,14,.94) 82%)}
${HUD_P} small,${HUD_P} .af-slotno,${HUD_P} .af-hp-text{display:none!important}
${HUD_P} b{left:5px;right:4px;top:auto;bottom:19px;font-size:10px!important;text-shadow:0 1px 2px #000,0 0 6px #000}
${HUD_P} .af-bars{left:4px!important;right:4px!important;bottom:11px!important;height:6px!important;grid-template-columns:minmax(18px,1fr)!important;gap:0!important}
${HUD_P} .af-hp{height:5px!important}
${HUD_P} .af-bullets{left:4px!important;right:4px!important;bottom:4px!important;height:3px!important;gap:1px!important}
${HUD_P} .af-burst{width:20px;height:20px;right:3px;top:3px}
${HUD_P} .af-burst>em{display:none}
${HUD_P} .af-tag{left:0!important;right:0!important;top:30%!important;bottom:auto!important;font-size:8px!important;letter-spacing:.12em!important}
${HUD_P} button[data-af-state="COVER"] .af-tag{left:3px!important;right:auto!important;top:3px!important}
${HUD_A}{top:auto!important;left:auto!important;right:max(6px,env(safe-area-inset-right))!important;bottom:104px!important;width:auto!important;display:flex!important;flex-direction:row!important;align-items:center!important;gap:6px!important}
${HUD_A} button:not([data-ultimate])::after{display:none}
${HUD_A} button:not([data-ultimate]){width:42px!important;min-width:42px!important;height:36px!important;padding:0!important;font-size:0!important}
${HUD_A} button:not([data-ultimate])::before{left:50%;width:16px;height:16px;margin:-8px 0 0 -8px}
${HUD_A} button[data-ultimate]{width:60px!important;height:60px!important}
${HUD_A} button[data-ultimate]::before{font-size:9.5px}}}`:"";
  if(hudEnabled)document.head.append(hudStyle);
  const coreRenderHudNikke=CommonCombatRunner.prototype.renderHud;
  CommonCombatRunner.prototype.renderHud=function(force=false){
    const before=this.qa?.hudDomRendered||0,result=coreRenderHudNikke.call(this,force);
    if(!hudEnabled||!this.hud||(this.qa?.hudDomRendered||0)===before)return result;
    try{
      if(document.head.lastElementChild!==hudStyle)document.head.append(hudStyle);
      if(this.hud.dataset.afHud!=="nikke-v1")this.hud.dataset.afHud="nikke-v1";let selectedUlt=0,selectedAccent=null;
      this.session.partySpec.slots.forEach(slot=>{
        const button=this.hud.querySelector(`button[data-slot="${slot.slot}"]`);if(!button||!slot.spec)return;
        const member=this.session.party.members[slot.slot],player=this.players[slot.slot],ult=Math.max(0,Math.min(100,Math.round(member.ultimateGauge||0)));
        if(button.dataset.afSkin!==slot.spec.id){button.dataset.afSkin=slot.spec.id;button.style.setProperty("--af-c",hudAccent(slot.spec));button.style.setProperty("--af-c2",hudAccent2(slot.spec));for(const [cls,html,text] of [["af-burst","<em></em>",null],["af-slotno",null,String(slot.slot+1).padStart(2,"0")],["af-tag",null,""]]){if(button.querySelector(`.${cls}`))continue;const node=document.createElement("span");node.className=cls;node.setAttribute("aria-hidden","true");if(html)node.innerHTML=html;else node.textContent=text;button.append(node);}}
        if(button.style.getPropertyValue("--af-ult")!==String(ult))button.style.setProperty("--af-ult",String(ult));
        const burstText=button.querySelector(".af-burst>em"),burstLabel=ult>=100?"BURST":`${ult}%`;if(burstText&&burstText.textContent!==burstLabel)burstText.textContent=burstLabel;
        const reviving=(player?.reviveClock||0)>0,state=member.hp<=0?(reviving?"REVIVE":"DOWN"):(player?.reloadClock||0)>0?"RELOAD":player?.coverRequested?"COVER":"READY";
        const ultState=ult>=100?"ready":"charging";if(button.dataset.afState!==state)button.dataset.afState=state;if(button.dataset.afUlt!==ultState)button.dataset.afUlt=ultState;
        const tag=button.querySelector(".af-tag"),tagText=state==="REVIVE"?`REVIVE ${(player.reviveClock||0).toFixed(1)}s`:state==="READY"?"":state;if(tag&&tag.textContent!==tagText)tag.textContent=tagText;
        if(member.state==="ACTIVE"){selectedUlt=ult;selectedAccent=hudAccent(slot.spec);}
      });
      if(this.actions){if(this.actions.dataset.afHud!=="nikke-v1")this.actions.dataset.afHud="nikke-v1";if(this.actions.style.getPropertyValue("--af-ult")!==String(selectedUlt))this.actions.style.setProperty("--af-ult",String(selectedUlt));if(selectedAccent&&this.actions.style.getPropertyValue("--af-c")!==selectedAccent)this.actions.style.setProperty("--af-c",selectedAccent);const ultButton=this.actions.querySelector("[data-ultimate]");if(ultButton&&ultButton.classList.contains("af-ready")!==(selectedUlt>=100))ultButton.classList.toggle("af-ready",selectedUlt>=100);}
    }catch{}
    return result;
  };
  CommonCombatRunner.prototype.drawBossHudNikke=function(ctx){
    const boss=this.enemies.find(enemy=>enemy.alive!==false&&enemy.bossRuntime);if(!boss)return;
    const ratio=clamp(boss.maxHp?boss.hp/boss.maxHp:0,0,1),now=performance.now(),last=boss.__afHudTrailAt||now,decay=(now-last)/1000*.35;boss.__afHudTrailAt=now;
    const trail=boss.__afHudTrail=Math.max(ratio,Math.min(1,(boss.__afHudTrail??ratio))-(now-(boss.__afHudHitAt||0)>420?decay:0));if(ratio<(boss.__afHudRatio??ratio))boss.__afHudHitAt=now;boss.__afHudRatio=ratio;
    const phases=boss.bossRuntime.config.phases||[],phaseIndex=boss.bossRuntime.phaseIndex||0,phase=String(phases[phaseIndex]?.id||"BOSS").replace(/_/g," "),view=this.hudVisibleRange(),W=Math.min(600,this.width*.46,(view[1]-view[0])*.86),H=14,x=(view[0]+view[1]-W)/2,y=combatUpperSafeY(this)+22,skew=9;
    const shape=(px,w)=>{ctx.beginPath();ctx.moveTo(px+skew,y);ctx.lineTo(px+w,y);ctx.lineTo(px+w-skew,y+H);ctx.lineTo(px,y+H);ctx.closePath();};
    ctx.save();
    ctx.font="700 12px Bahnschrift,'DIN Alternate','Roboto Condensed','Malgun Gothic',ui-monospace";ctx.textBaseline="alphabetic";ctx.lineWidth=3;ctx.strokeStyle="rgba(3,5,12,.85)";
    ctx.textAlign="left";ctx.fillStyle="#ffd1ea";ctx.strokeText(`◆ ${phase}`,x+skew,y-6);ctx.fillText(`◆ ${phase}`,x+skew,y-6);
    ctx.textAlign="right";ctx.fillStyle="#f6f1ff";const hpText=`${Math.ceil(boss.hp)} / ${boss.maxHp}`;ctx.strokeText(hpText,x+W-skew,y-6);ctx.fillText(hpText,x+W-skew,y-6);
    shape(x-3,W+6);ctx.fillStyle="rgba(8,4,16,.9)";ctx.fill();ctx.lineWidth=1.2;ctx.strokeStyle="rgba(255,150,210,.75)";ctx.stroke();
    ctx.save();shape(x,W);ctx.clip();
    if(trail>ratio){ctx.fillStyle="rgba(255,236,246,.85)";ctx.fillRect(x+W*ratio,y,W*(trail-ratio)+skew,H);}
    const fill=ctx.createLinearGradient(x,0,x+W,0);fill.addColorStop(0,"#ff2e7e");fill.addColorStop(.55,"#ff7ac0");fill.addColorStop(1,"#ffd28a");ctx.fillStyle=fill;ctx.fillRect(x,y,W*ratio+skew*(ratio>0?1:0),H);
    ctx.fillStyle="rgba(255,255,255,.35)";ctx.fillRect(x,y,W*ratio+skew,2);
    ctx.fillStyle="rgba(0,0,0,.5)";for(let tick=1;tick<10;tick++)ctx.fillRect(x+W*tick/10,y,1.5,H);
    ctx.restore();
    if(ratio>0){ctx.globalCompositeOperation="lighter";epicGlowAt(ctx,x+W*ratio,y+H/2,26,"#ff7ac0",.7,true);ctx.globalCompositeOperation="source-over";}
    if(phases.length>1){const pipY=y+H+9;for(let pip=0;pip<phases.length;pip++){const px=(view[0]+view[1])/2+(pip-(phases.length-1)/2)*16;ctx.beginPath();ctx.moveTo(px,pipY-4.5);ctx.lineTo(px+4.5,pipY);ctx.lineTo(px,pipY+4.5);ctx.lineTo(px-4.5,pipY);ctx.closePath();ctx.fillStyle=pip<phaseIndex?"rgba(255,255,255,.25)":pip===phaseIndex?"#ff7ac0":"rgba(8,4,16,.9)";ctx.fill();ctx.strokeStyle="rgba(255,170,220,.8)";ctx.lineWidth=1;ctx.stroke();}}
    ctx.restore();
  };
  CommonCombatRunner.prototype.hudVisibleRange=function(){
    const now=performance.now(),cache=this.__afHudView;if(cache&&now-cache.at<500)return cache.range;let range=[0,this.width];
    try{const rect=this.canvas.getBoundingClientRect(),scale=rect.width/this.width;if(scale>0)range=[Math.max(0,-rect.left/scale),Math.min(this.width,(innerWidth-rect.left)/scale)];}catch{}
    if(!(range[1]-range[0]>40))range=[0,this.width];this.__afHudView={at:now,range};return range;
  };
  CommonCombatRunner.prototype.drawAimReticle=function(ctx){
    if(!hudEnabled||!this.running||this.terminalPaused)return;const player=this.selected?.();if(!player||player.member?.hp<=0)return;
    const aim=player.smoothedAim||this.pointer;if(!aim||!Number.isFinite(aim.x)||!Number.isFinite(aim.y))return;
    const accent=hudAccent(player.spec),auto=this.isAutoControlled?.(player),alpha=auto?.6:.95,x=aim.x,y=aim.y,now=performance.now()/1000,ammo=Math.max(0,player.ammo??0),mag=Math.max(1,player.magazineSize||1),reloadClock=player.reloadClock||0;
    if(reloadClock>0){if(!(player.__afReloadTotal>=reloadClock))player.__afReloadTotal=reloadClock;}else player.__afReloadTotal=0;
    ctx.save();ctx.globalCompositeOperation="lighter";epicGlowAt(ctx,x,y,30,accent,.16*alpha,false);ctx.globalAlpha=alpha;ctx.strokeStyle=accent;ctx.lineWidth=1.6;
    ctx.beginPath();ctx.arc(x,y,17,0,Math.PI*2);ctx.stroke();
    const spin=auto?now*.8:0;ctx.beginPath();for(let tick=0;tick<4;tick++){const angle=spin+tick*Math.PI/2;ctx.moveTo(x+Math.cos(angle)*21,y+Math.sin(angle)*21);ctx.lineTo(x+Math.cos(angle)*30,y+Math.sin(angle)*30);}ctx.stroke();
    ctx.fillStyle="#ffffff";ctx.beginPath();ctx.arc(x,y,1.8,0,Math.PI*2);ctx.fill();
    const segments=Math.min(mag,36),gap=segments>1?.07:0,span=(Math.PI*2-gap*segments)/segments,filled=reloadClock>0?0:Math.ceil(ammo/mag*segments);ctx.lineWidth=3.2;
    for(let segment=0;segment<segments;segment++){const start=-Math.PI/2+segment*(span+gap);ctx.strokeStyle=segment<filled?accent:"rgba(255,255,255,.14)";ctx.beginPath();ctx.arc(x,y,37,start,start+span);ctx.stroke();}
    if(reloadClock>0){const progress=1-reloadClock/Math.max(.05,player.__afReloadTotal||reloadClock);ctx.strokeStyle="#ffb45c";ctx.lineWidth=3.4;ctx.beginPath();ctx.arc(x,y,37,-Math.PI/2,-Math.PI/2+Math.PI*2*progress);ctx.stroke();ctx.globalCompositeOperation="source-over";ctx.font="700 10px Bahnschrift,'Roboto Condensed',ui-monospace";ctx.textAlign="center";ctx.fillStyle="#ffcf8a";ctx.fillText("RELOAD",x,y+54);}
    else{ctx.globalCompositeOperation="source-over";ctx.font="700 11px Bahnschrift,'Roboto Condensed',ui-monospace";ctx.textAlign="left";ctx.lineWidth=3;ctx.strokeStyle="rgba(3,5,12,.8)";const label=`${ammo}`;ctx.strokeText(label,x+42,y+4);ctx.fillStyle="#f3fbff";ctx.fillText(label,x+42,y+4);}
    ctx.restore();
  };
  // >>> COMBAT_CAMERA_V3 (2026-09-24, Claude Code; combat_reboot_v1/game_bake_v1/tools/runtime_patches/combat_camera_v3.py)
  // Codex/NIKKE orbit camera: the selected unit is the fixed screen centre; the aim turns the battlefield around it.
  // A world row moves by -yaw x its depth weight: 0 on the squad's ground line (the squad never moves with the aim),
  // 1 at the horizon. The enemy offset is baked into its simulated position, so aim and hits match what is drawn.
  // ?camera=classic keeps the whole-field view.
  // COMBAT_CAMERA_V3_1 (2026-09-25): orbit weight by the four backdrop layers, yaw 190, yaw clamped to the panorama.
  const CAMERA_VIEW=Object.freeze({zoom:1.32,anchorY:.6,focusFollow:10,focusSpeed:1400,yaw:190,yawFollow:18,yawRate:800,aimSpan:.83,horizonY:.5,groundY:.75,strips:12,sourceHeight:960});
  const cameraClassic=(()=>{const off=value=>/(?:[?&])camera=classic(?:&|$)/.test(String(value||""));try{if(off(location.search))return true;}catch{}try{if(off(window.top.location.search))return true;}catch{}return false;})();
  CommonCombatRunner.prototype.cameraState=function(){
    return this.__afCam||(this.__afCam={active:false,ready:false,z:1,x:this.width/2,y0:this.height*CAMERA_VIEW.anchorY,cs:this.width/2,hs:this.width/2,pivot:this.width/2,target:this.width/2,yaw:0,yawTarget:0});
  };
  CommonCombatRunner.prototype.cameraWorldSpan=function(){
    // World x-range of the backdrop at its authored aspect, centred on the battlefield (never narrower than the field).
    const layers=this.backgroundLayers?.()||[],image=layers.length?this.images.get(layers[0].source):null;
    if(!image?.naturalWidth)return[0,this.width];
    const w=Math.max(this.width,this.height*image.naturalWidth/CAMERA_VIEW.sourceHeight);return[this.width/2-w/2,this.width/2+w/2];
  };
  // Orbit depth weight of a world row: 0 on the squad's ground line and nearer, 1 at the horizon and beyond.
  CommonCombatRunner.prototype.cameraDepthWeight=function(y){
    const top=this.height*CAMERA_VIEW.horizonY,ground=this.height*CAMERA_VIEW.groundY;
    // LAYER3/4 = far plate (1); LAYER2_GROUND ramps with a smoothstep; LAYER1_CHARACTER (squad, cover bases) = 0.
    if(!(y<ground))return 0;if(y<=top)return 1;const v=(y-top)/(ground-top);return 1-v*v*(3-2*v);
  };
  CommonCombatRunner.prototype.cameraYawShift=function(y){const c=this.cameraState();return c.active&&c.yaw?-c.yaw*this.cameraDepthWeight(y):0;};
  CommonCombatRunner.prototype.cameraStep=function(dt){
    const c=this.cameraState(),range=this.hudVisibleRange?.()||[0,this.width];
    c.cs=(range[0]+range[1])/2;c.hs=Math.max(40,(range[1]-range[0])/2);c.y0=this.height*CAMERA_VIEW.anchorY;
    c.active=!cameraClassic&&!this.__afPortrait&&this.width>this.height;
    if(!c.active){c.z=1;c.x=c.cs;c.pivot=c.cs;c.target=c.cs;c.yaw=0;c.yawTarget=0;c.ready=false;this.body.dataset.afCombatCamera=cameraClassic?"classic":"portrait";return c;}
    c.z=CAMERA_VIEW.zoom;
    // Pivot = the selected unit's station, always at the screen centre. Switching units glides the camera.
    const player=this.selected?.(),station=player?.__afCamStation??player?.x;
    if(Number.isFinite(station))c.pivot=station;c.target=c.pivot;
    if(!c.ready||!Number.isFinite(c.x)){c.x=c.pivot;c.ready=true;}
    else if(dt>0){const step=(c.pivot-c.x)*(1-Math.exp(-dt*CAMERA_VIEW.focusFollow)),limit=CAMERA_VIEW.focusSpeed*dt;c.x+=clamp(step,-limit,limit);}
    // Orbit yaw from the pointer's side of the screen (manual) or the unit's current target (AUTO).
    let u=0;
    if(player&&!this.isAutoControlled?.(player)&&this.__afPointerScreen)u=(this.__afPointerScreen.x-c.cs)/(c.hs*CAMERA_VIEW.aimSpan);
    else{const aim=player?.smoothedAim;if(aim&&Number.isFinite(aim.x))u=c.z*(aim.x-c.x)/(c.hs*CAMERA_VIEW.aimSpan);}
    c.yawTarget=CAMERA_VIEW.yaw*clamp(u,-1,1);
    // The far plate moves by -yaw; never turn past either end of the panorama.
    const span=this.cameraWorldSpan(),viewLeft=c.x-c.cs/c.z,viewRight=c.x+(this.width-c.cs)/c.z,yawLo=Math.min(0,span[0]-viewLeft),yawHi=Math.max(0,span[1]-viewRight);
    c.yawTarget=clamp(c.yawTarget,yawLo,yawHi);
    if(dt>0){const step=(c.yawTarget-c.yaw)*(1-Math.exp(-dt*CAMERA_VIEW.yawFollow)),limit=CAMERA_VIEW.yawRate*dt;c.yaw+=clamp(step,-limit,limit);}
    c.yaw=clamp(c.yaw,yawLo,yawHi);
    this.body.dataset.afCombatCamera="orbit";
    return c;
  };
  CommonCombatRunner.prototype.cameraToScreen=function(point){const c=this.cameraState();return{x:c.cs+c.z*(point.x-c.x),y:c.y0+c.z*(point.y-c.y0)};};
  CommonCombatRunner.prototype.cameraToWorld=function(point){const c=this.cameraState();return{x:c.x+(point.x-c.cs)/c.z,y:c.y0+(point.y-c.y0)/c.z};};
  CommonCombatRunner.prototype.cameraViewWorld=function(){
    const a=this.cameraToWorld({x:0,y:0}),b=this.cameraToWorld({x:this.width,y:this.height});return{left:a.x,top:a.y,right:b.x,bottom:b.y};
  };
  CommonCombatRunner.prototype.cameraPointer=function(){
    if(!this.__afPointerScreen)this.__afPointerScreen={x:this.pointer.x,y:this.pointer.y};
    const world=this.cameraToWorld(this.__afPointerScreen);this.pointer.x=world.x;this.pointer.y=world.y;
  };
  CommonCombatRunner.prototype.cameraSync=function(dt){try{this.cameraStep(dt);this.cameraPointer();}catch(error){this.qa.cameraErrors=(this.qa.cameraErrors||0)+1;}};
  // Enemy orbit offset, baked into the simulated position. The previous offset is removed only from a field that still
  // holds it (routes/layout may have written a fresh value since), so no other motion code needs to know about it.
  CommonCombatRunner.prototype.cameraEnemyYaw=function(){
    for(const enemy of this.enemies){
      const prev=enemy.__afYaw,offset=this.cameraYawShift(enemy.y);
      if(prev){if(enemy.originX===prev.originX)enemy.originX-=prev.offset;if(enemy.x===prev.x)enemy.x-=prev.offset;}
      enemy.originX+=offset;enemy.x+=offset;enemy.__afYaw={offset,originX:enemy.originX,x:enemy.x};
    }
  };
  CommonCombatRunner.prototype.cameraEnemyYawRecord=function(){
    // After the core step: keep the record current (sway/orbit rewrote x from the offset origin); enemies spawned during
    // the step receive their offset now.
    for(const enemy of this.enemies){
      if(!enemy.__afYaw){const offset=this.cameraYawShift(enemy.y);enemy.originX+=offset;enemy.x+=offset;enemy.__afYaw={offset,originX:enemy.originX,x:enemy.x};}
      else{enemy.__afYaw.originX=enemy.originX;enemy.__afYaw.x=enemy.x;}
    }
  };
  const coreSyncLayoutCamera=CommonCombatRunner.prototype.syncResponsiveLayout;
  CommonCombatRunner.prototype.syncResponsiveLayout=function(...args){
    // The layout places each unit at its station; the camera only remembers the station as the unit's pivot.
    const result=coreSyncLayoutCamera.apply(this,args);
    if(result){for(const player of this.players)if(player)player.__afCamStation=player.x;this.cameraSync(0);}
    return result;
  };
  const coreUpdatePointerCamera=CommonCombatRunner.prototype.updatePointer;
  CommonCombatRunner.prototype.updatePointer=function(event){
    const result=coreUpdatePointerCamera.call(this,event);
    this.__afPointerScreen={x:this.pointer.x,y:this.pointer.y};const world=this.cameraToWorld(this.__afPointerScreen);this.pointer.x=world.x;this.pointer.y=world.y;
    return result;
  };
  const coreUpdateCamera=CommonCombatRunner.prototype.update;
  CommonCombatRunner.prototype.update=function(dt,...args){
    this.cameraSync(dt);try{this.cameraEnemyYaw();}catch(error){this.qa.cameraErrors=(this.qa.cameraErrors||0)+1;}
    const result=coreUpdateCamera.call(this,dt,...args);
    try{this.cameraEnemyYawRecord();}catch(error){this.qa.cameraErrors=(this.qa.cameraErrors||0)+1;}
    return result;
  };
  const coreDrawCamera=CommonCombatRunner.prototype.draw;
  CommonCombatRunner.prototype.draw=function(...args){
    const c=this.cameraState();if(!c.active)return coreDrawCamera.apply(this,args);
    const ctx=this.ctx,view=this.cameraViewWorld(),W=this.width,H=this.height;
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.restore();
    // Fills and clears that span the whole battlefield (ultimate dimming, fallback field) cover the current view instead.
    const widen=(x,y,w,h)=>{if(x<=0&&x+w>=W){const r=Math.max(x+w,view.right+8);x=Math.min(x,view.left-8);w=r-x;}if(y<=0&&y+h>=H){const b=Math.max(y+h,view.bottom+8);y=Math.min(y,view.top-8);h=b-y;}return[x,y,w,h];};
    const fill=ctx.fillRect,clear=ctx.clearRect;
    ctx.fillRect=function(...rect){return fill.apply(this,widen(...rect));};ctx.clearRect=function(...rect){return clear.apply(this,widen(...rect));};
    ctx.save();ctx.setTransform(c.z,0,0,c.z,c.cs-c.z*c.x,c.y0-c.z*c.y0);
    try{return coreDrawCamera.apply(this,args);}finally{ctx.restore();delete ctx.fillRect;delete ctx.clearRect;this.drawCameraIndicators(ctx);}
  };
  const coreDrawBackgroundCamera=CommonCombatRunner.prototype.drawBackground;
  CommonCombatRunner.prototype.drawBackground=function(ctx){
    // The authored 4-layer panorama at its own aspect. Rows turn with the orbit by their depth weight; each strip is
    // sheared linearly between its edge shifts, so neighbouring strips meet without seams.
    if(!this.cameraState().active)return coreDrawBackgroundCamera.call(this,ctx);
    const layers=this.backgroundLayers(),images=layers.map(layer=>this.images.get(layer.source));
    if(!layers.length||!images.every(image=>image?.complete&&image.naturalWidth))return coreDrawBackgroundCamera.call(this,ctx);
    const span=this.cameraWorldSpan(),scaleY=this.height/CAMERA_VIEW.sourceHeight,top=this.height*CAMERA_VIEW.horizonY,ground=this.height*CAMERA_VIEW.groundY;
    const breaks=[top];for(let i=1;i<CAMERA_VIEW.strips;i++)breaks.push(top+(ground-top)*i/CAMERA_VIEW.strips);breaks.push(ground);
    layers.forEach((layer,i)=>{
      const image=images[i],y0=layer.placementY*scaleY,y1=(layer.placementY+240)*scaleY,rowsPerY=(image.naturalHeight||240)/(y1-y0);
      let a=y0;
      for(const b of [...breaks.filter(y=>y>y0&&y<y1),y1]){
        const sa=this.cameraYawShift(a),sb=this.cameraYawShift(b),m=(sb-sa)/(b-a);
        ctx.save();ctx.transform(1,0,m,1,sa-m*a,0);
        ctx.drawImage(image,0,(a-y0)*rowsPerY,image.naturalWidth,(b-a)*rowsPerY,span[0],a,span[1]-span[0],b-a+(b<y1?.6:1));
        ctx.restore();a=b;
      }
    });
  };
  const coreReticleCamera=CommonCombatRunner.prototype.drawAimReticle;
  CommonCombatRunner.prototype.drawAimReticle=function(ctx,...args){
    // Same reticle, unscaled, at the screen point of the aim.
    const c=this.cameraState(),player=this.selected?.(),aim=player?.smoothedAim||this.pointer;
    if(!c.active||!aim||!Number.isFinite(aim.x)||!Number.isFinite(aim.y))return coreReticleCamera.call(this,ctx,...args);
    const screen=this.cameraToScreen(aim);ctx.save();ctx.setTransform(1,0,0,1,screen.x-aim.x,screen.y-aim.y);
    try{return coreReticleCamera.call(this,ctx,...args);}finally{ctx.restore();}
  };
  const coreBossHudCamera=CommonCombatRunner.prototype.drawBossHudNikke;
  CommonCombatRunner.prototype.drawBossHudNikke=function(ctx,...args){
    if(!this.cameraState().active)return coreBossHudCamera.call(this,ctx,...args);
    ctx.save();ctx.setTransform(1,0,0,1,0,0);try{return coreBossHudCamera.call(this,ctx,...args);}finally{ctx.restore();}
  };
  CommonCombatRunner.prototype.drawCameraIndicators=function(ctx){
    // Edge markers for live enemies outside the current view (count + direction), like NIKKE's off-screen arrows.
    const c=this.cameraState();if(!c.active||!this.running||this.terminalPaused)return;
    const left=c.cs-c.hs,right=c.cs+c.hs,sides=[{n:0,y:0,x:left+22,dir:-1},{n:0,y:0,x:right-22,dir:1}];
    for(const enemy of this.enemies){if(enemy.alive===false||!(enemy.hp>0))continue;const screen=this.cameraToScreen(enemy);if(screen.x<left+6){sides[0].n++;sides[0].y+=screen.y;}else if(screen.x>right-6){sides[1].n++;sides[1].y+=screen.y;}}
    const pulse=.72+.28*Math.sin(performance.now()/180);
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    for(const side of sides){if(!side.n)continue;const y=clamp(side.y/side.n,this.height*.2,this.height*.62),x=side.x,d=side.dir;
      ctx.globalAlpha=pulse;ctx.fillStyle="rgba(255,72,110,.92)";ctx.strokeStyle="rgba(20,4,10,.85)";ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(x+d*12,y);ctx.lineTo(x-d*6,y-13);ctx.lineTo(x-d*6,y+13);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.globalAlpha=1;ctx.font="800 12px Bahnschrift,'Roboto Condensed',ui-monospace";ctx.textAlign="center";ctx.lineWidth=3;ctx.strokeText(String(side.n),x-d*16,y+4);ctx.fillStyle="#ffe3ea";ctx.fillText(String(side.n),x-d*16,y+4);}
    ctx.restore();
  };
  // <<< COMBAT_CAMERA_V3
  // >>> ENEMY_ROUTES_V1 (2026-09-24, Claude Code; combat_reboot_v1/game_bake_v1/tools/runtime_patches/enemy_routes_v1.py)
  // Combat Reboot style enemy routes (prologue-stages.mjs): ground units appear far out in a side lane and advance to a
  // near hold point; flyers enter from one side and loop across the field. Route tables are [seconds, x metres, (y), z].
  const ENEMY_ROUTE_GROUND=Object.freeze([
    {points:[[0,-6,26],[3,-5.5,19],[7,-5.6,12],[13,-5.2,7]]},
    {points:[[0,9,26],[4,7.6,22],[8,7.8,14],[14,5,8]],delay:3},
    {points:[[0,-7,27],[4,-5.6,18],[9,-5.5,11],[14,-5.2,7]]},
    {points:[[0,9,26],[4,7.8,21],[9,7.8,13],[15,4.7,7]]},
    {points:[[0,-5,30],[4,-5.4,22],[8,-5.5,15],[14,-5,8]]},
    {points:[[0,-8,28],[5,-7,18],[11,-6,9]],delay:4},
    {points:[[0,-4.9,30],[5,-5.5,21],[10,-5.5,14],[17,-5,7]]}]);
  const ENEMY_ROUTE_AIR=Object.freeze([
    {points:[[0,7,2.1,25],[2,5,2.0,21],[5,1.8,2.5,18],[9,-1,2.4,17],[14,5,2.0,21]],loopFrom:2},
    {points:[[0,8,2.4,28],[3,6,2.5,20],[7,0,2.7,16],[12,-5,2.2,20],[17,6,2.5,20]],loopFrom:3},
    {points:[[0,6,2.6,26],[4,1,2.7,19],[8,-4,2.1,18],[13,1,2.7,19]],loopFrom:4},
    {points:[[0,8,1.8,29],[4,7,2.2,24],[8,3,1.9,17],[13,7,2.2,24]],loopFrom:4},
    {points:[[0,8,2.4,30],[4,4,2.8,22],[8,2,2.6,17],[14,4,2.8,22]],loopFrom:4},
    {points:[[0,8,2.4,29],[4,6,2.8,23],[8,2,2.3,17],[14,6,2.8,23]],loopFrom:4}]);
  const enemyRoutesClassic=(()=>{const off=value=>/(?:[?&])enemies=classic(?:&|$)/.test(String(value||""));try{if(off(location.search))return true;}catch{}try{if(off(window.top.location.search))return true;}catch{}return false;})();
  const enemyRouteSample=(route,seconds)=>{
    // Same as Combat Reboot sampleRoute: smoothstep between waypoints, optional loop back to loopFrom, hold at the end.
    const p=route.points,last=p[p.length-1][0];let t=Math.max(0,seconds);
    if(route.loopFrom!==undefined&&t>last)t=route.loopFrom+(t-route.loopFrom)%(last-route.loopFrom);
    if(t>=last)return p[p.length-1].slice(1);
    let i=1;while(i<p.length&&p[i][0]<t)i++;
    const a=p[i-1],b=p[i],u=Math.min(1,(t-a[0])/(b[0]-a[0])),v=u*u*(3-2*u);return a.slice(1).map((n,j)=>n+(b[j+1]-n)*v);
  };
  // Near factor in the Codex projection (k ~ 1/(z+5)): 0 at z=30, 1 at z=7.
  const enemyRouteNear=(z,nearZ=7)=>(1/(z+5)-1/35)/(1/(nearZ+5)-1/35);
  CommonCombatRunner.prototype.assignEnemyRoute=function(enemy){
    if(!enemy||enemy.bossRuntime||enemyRoutesClassic)return null;
    const band=enemy.renderLayer||enemy.spec?.depthBand||"background1",air=band!=="background1",wave=Math.max(0,this.wave|0);
    const counter=this.__afRouteCounter&&this.__afRouteCounter.wave===wave?this.__afRouteCounter:(this.__afRouteCounter={wave,ground:0,air:0});
    const index=air?counter.air++:counter.ground++,table=air?ENEMY_ROUTE_AIR:ENEMY_ROUTE_GROUND,routeIndex=(index+wave*(air?1:2))%table.length,base=table[routeIndex];
    // Ground lanes alternate left/right; flyers alternate the side they enter from. A second unit in a lane sits further in.
    const natural=Math.sign(base.points[base.points.length-1][1])||1,desired=air?((index+wave)%2===0?1:-1):((index+wave)%2===0?-1:1),rank=Math.floor(index/2);
    // More units than the Codex waves: ground units form rows further back and further in; extra flyers sweep further out.
    enemy.afRoute={kind:air?"air":"ground",band,index:routeIndex,mirror:natural!==desired,side:desired,rank,inset:air?0:rank*2.8,back:air?0:rank*5,shift:air?rank*3.2:0,delay:(base.delay||0)+rank*(air?1.8:2.4),start:enemy.motionTime||0};
    return enemy.afRoute;
  };
  CommonCombatRunner.prototype.enemyRoutePlace=function(enemy){
    const r=enemy?.afRoute,route=r&&(r.kind==="air"?ENEMY_ROUTE_AIR:ENEMY_ROUTE_GROUND)[r.index];if(!route)return false;
    const W=this.width,H=this.height,sample=enemyRouteSample(route,(enemy.motionTime||0)-r.start-r.delay),z=sample[sample.length-1]+(r.back||0);
    const kn=clamp(enemyRouteNear(z),0,1.1),ppm=(25.6+49.1*kn)*(W/1280);
    let xm=sample[0]*(r.mirror?-1:1)+(r.shift||0)*(r.side||1);if(r.inset)xm=Math.sign(xm||1)*Math.max(.8,Math.abs(xm)-r.inset);
    let x=clamp(W/2+xm*ppm,W*.04,W*.96),y,scale;
    if(r.kind==="air"){
      // Flyers stay in their band (background3 above background2); the route height and depth move them a little.
      const ka=clamp(enemyRouteNear(z,16),0,1),lift=(2.4-sample[1])*34*(H/720);
      // Sizes/heights keep the whole flyer below the top HUD strip under the x1.32 camera.
      if(r.band==="background3"){y=H*(.41+.03*ka)+lift-(r.rank%2)*10;scale=.62+.14*ka;}else{y=H*(.455+.03*ka)+lift-(r.rank%2)*12;scale=.72+.16*ka;}
    }else{y=H*(.515+.085*Math.min(1,kn));scale=.66+.34*Math.min(1,kn);}
    enemy.afLandscapeOriginX=x;
    if(this.__afPortrait){const range=this.hudVisibleRange?.()||[0,W],mid=(range[0]+range[1])/2,half=(range[1]-range[0])/2;x=mid+clamp((x-W/2)/(W/2),-1,1)*half*.82;}
    enemy.originX=x;enemy.originY=y;enemy.afDepthScale=scale;enemy.afRouteNear=kn;
    if(!enemy.spec?.movement?.mode){enemy.x=x;enemy.y=y;}
    return true;
  };
  const coreSpawnEnemyRoutes=CommonCombatRunner.prototype.spawnEnemy;
  CommonCombatRunner.prototype.spawnEnemy=function(options={},...rest){
    const enemy=coreSpawnEnemyRoutes.call(this,options,...rest);
    try{if(enemy&&!options?.bossRuntime&&this.assignEnemyRoute(enemy)&&this.enemyRoutePlace(enemy)){enemy.x=enemy.originX;enemy.y=enemy.originY;this.trace("enemy_route",{enemyId:enemy.spec?.id,kind:enemy.afRoute.kind,route:enemy.afRoute.index,mirror:enemy.afRoute.mirror,x:Math.round(enemy.x),y:Math.round(enemy.y)});}}
    catch(error){this.qa.enemyRouteErrors=(this.qa.enemyRouteErrors||0)+1;}
    return enemy;
  };
  const coreUpdateRoutes=CommonCombatRunner.prototype.update;
  CommonCombatRunner.prototype.update=function(dt,...args){
    // Move each route point before the core step; the registry sway/orbit then runs around it (motionTime is the clock,
    // so pauses and hit-stop hold the route too).
    if(this.running)for(const enemy of this.enemies){if(!enemy.afRoute)continue;try{this.enemyRoutePlace(enemy);}catch(error){this.qa.enemyRouteErrors=(this.qa.enemyRouteErrors||0)+1;}}
    return coreUpdateRoutes.call(this,dt,...args);
  };
  // <<< ENEMY_ROUTES_V1
  // >>> COMBAT_REFERENCE_INPUT_V1 (2026-09-25)
  // Combat Reboot's input contract: immediate ready shot for uncharged weapons,
  // held full charge -> shot -> recharge for coil/arc weapons, and held empty
  // magazine -> reload -> recharge. Every shot still commits through fire(),
  // which binds the authored muzzle pose, sound, ammo and projectile.
  const CHARGED_COMBAT_IDS=new Set(["sera","roa","serin","noella"]);
  const SPINUP_COMBAT_IDS=new Set(["tessa","karin","luna"]);
  const CHARGE_REFERENCE={sera:{full:1.1,min:.12},roa:{full:1.1,min:.12},serin:{full:1.25,min:.15},noella:{full:1.25,min:.15}};
  CommonCombatRunner.prototype.triggerProfile=function(player){
    const timing=player?.spec?.combatTiming||{},id=player?.spec?.id;
    const reference=CHARGE_REFERENCE[id],full=Math.max(.12,Number(timing.chargeSeconds)||reference?.full||Number(timing.heavyFireInterval)||.7);
    if(timing.chargeMode==="charge"||CHARGED_COMBAT_IDS.has(id))return {mode:"charge",full,min:Math.min(full,Number(timing.chargeMinSeconds)||reference?.min||.12)};
    if(timing.chargeMode==="spinup"||SPINUP_COMBAT_IDS.has(id))return {mode:"spinup",full:Math.max(.1,Number(timing.spinupSeconds)||.35)};
    return {mode:"instant",full:0};
  };
  CommonCombatRunner.prototype.triggerCancel=function(reason="cancel"){
    const active=this.pointer.down||this.players.some(player=>player&&((player.__afChargeClock||0)>0||(player.__afSpinClock||0)>0||player.__afQueuedCharge!=null||player.pendingFire));
    this.pointer.down=false;
    for(const player of this.players){if(!player)continue;player.__afChargeClock=0;player.__afSpinClock=0;player.__afQueuedCharge=null;player.pendingFire=false;}
    if(active)this.trace("trigger_cancelled",{reason});
  };
  CommonCombatRunner.prototype.triggerPress=function(){
    const player=this.selected();this.pointer.down=true;
    if(!player||!this.running||player.member.hp<=0||player.coverRequested||player.reloadClock>0)return false;
    const profile=this.triggerProfile(player);
    player.__afChargeClock=0;player.__afSpinClock=0;player.__afQueuedCharge=null;
    if(player.ammo<=0){this.startReload(player);return false;}
    if(profile.mode!=="instant")return true;
    const before=this.projectiles.length;
    player.__afImmediatePress=true;
    try{this.fire(player,false);}finally{player.__afImmediatePress=false;}
    return this.projectiles.length>before;
  };
  CommonCombatRunner.prototype.triggerRelease=function(){
    const player=this.selected(),held=this.pointer.down;this.pointer.down=false;
    if(!held||!player)return false;
    const profile=this.triggerProfile(player),clock=player.__afChargeClock||0;
    let committed=false;
    if(profile.mode==="charge"&&clock>=profile.min&&player.reloadClock<=0&&!player.coverRequested&&player.ammo>0&&this.running){
      const charge=clamp(clock/profile.full,0,1);
      if(player.cooldown>0)player.__afQueuedCharge=charge;
      else{
        const before=this.projectiles.length;
        player.__afChargeCommit=charge;
        try{this.fire(player,true);}finally{player.__afChargeCommit=null;}
        committed=this.projectiles.length>before;
      }
    }
    player.__afChargeClock=0;player.__afSpinClock=0;
    return committed;
  };
  CommonCombatRunner.prototype.advanceTrigger=function(player,dt,held){
    if(!player||player.member.hp<=0||player.member.targetable===false)return;
    if(player.__afQueuedCharge!=null&&!held){
      if(player.coverRequested||player.reloadClock>0||!this.running){player.__afQueuedCharge=null;return;}
      if(player.cooldown<=0){
        const before=this.projectiles.length;
        player.__afChargeCommit=player.__afQueuedCharge;
        try{this.fire(player,true);}finally{player.__afChargeCommit=null;}
        if(this.projectiles.length>before)player.__afQueuedCharge=null;
      }
      return;
    }
    if(!held||player.coverRequested||player.reloadClock>0||!this.running){player.__afChargeClock=0;player.__afSpinClock=0;return;}
    if(player.ammo<=0){player.__afChargeClock=0;player.__afSpinClock=0;this.startReload(player);return;}
    const profile=this.triggerProfile(player);
    if(profile.mode==="instant"){
      if(player.cooldown<=0)this.fire(player,false);
      return;
    }
    if(profile.mode==="spinup"){
      player.__afSpinClock=Math.min(profile.full,(player.__afSpinClock||0)+dt);
      if(player.__afSpinClock>=profile.full&&player.cooldown<=0)this.fire(player,false);
      return;
    }
    player.__afChargeClock=Math.min(profile.full,(player.__afChargeClock||0)+dt);
    if(player.__afChargeClock<profile.full||player.cooldown>0)return;
    const before=this.projectiles.length;
    player.__afChargeCommit=1;
    try{this.fire(player,true);}finally{player.__afChargeCommit=null;}
    if(this.projectiles.length>before)player.__afChargeClock=0;
  };
  const coreReferenceReload=CommonCombatRunner.prototype.startReload;
  CommonCombatRunner.prototype.startReload=function(player=this.selected()){
    const started=coreReferenceReload.call(this,player);
    if(started&&player){player.__afChargeClock=0;player.__afSpinClock=0;player.__afQueuedCharge=null;}
    return started;
  };
  const coreReferenceCover=CommonCombatRunner.prototype.toggleCover;
  CommonCombatRunner.prototype.toggleCover=function(){this.triggerCancel("cover");return coreReferenceCover.call(this);};
  const coreReferenceUpdate=CommonCombatRunner.prototype.update;
  CommonCombatRunner.prototype.update=function(dt,...args){
    const selected=this.selected()?.slot??-1;
    if(this.__afLastSelectedSlot!==undefined&&selected!==this.__afLastSelectedSlot)this.triggerCancel("character_switch");
    this.__afLastSelectedSlot=selected;
    if(!this.running||this.lifecyclePauses?.size)this.triggerCancel("pause");
    return coreReferenceUpdate.call(this,dt,...args);
  };
  // <<< COMBAT_REFERENCE_INPUT_V1
  // >>> COMBAT_STAGE_COVER_V1 (2026-09-25)
  // P-01/P-02 positions and forms follow the Combat Reboot prologue-stages.mjs
  // obstruction contract. Later stages use the same solid cabinet/pier grammar.
  // All shapes are drawn in the combat canvas, after the authored background.
  const STAGE_PROP_LAYOUTS=Object.freeze({
    "P-01":[["power-cabinet",-3.4,10,1.7,2.2,"cabinet"],["broken-pier",5.6,16,1.3,3.3,"pier"]],
    "P-02":[["walkway-junction",-3.1,13,1.35,1.8,"cabinet"],["flood-pier",5,20,1.8,3.8,"pier"]],
    "P-04":[["relay-cabinet",-5.4,12,1.7,2.2,"cabinet"],["relay-pier",5.3,18,1.6,3.2,"pier"]],
    "P-06":[["watch-cabinet",-5.1,14,1.6,2.2,"cabinet"],["watch-pier",4.9,19,1.5,3.1,"pier"]],
    "P-07":[["watch-left",-4.8,12,1.55,2.1,"cabinet"],["watch-right",5.3,20,1.6,3.1,"pier"]],
    "P-08":[["collapsed-left",-5.3,13,1.65,2.2,"cabinet"],["collapsed-right",5.1,18,1.65,3.3,"pier"]],
    "P-09":[["relay-left",-4.9,12,1.55,2.2,"cabinet"],["relay-right",5.4,20,1.65,3.2,"pier"]],
    "P-14":[["signal-left",-5.2,15,1.55,2.2,"cabinet"],["signal-right",5.1,19,1.6,3.0,"pier"]]
  });
  const STAGE_PROP_ACCENT={"P-01":"#eab979","P-02":"#72d5d5","P-04":"#efb67a","P-06":"#9ccbe2","P-07":"#9ccbe2","P-08":"#efb67a","P-09":"#efb67a","P-14":"#e79ac6"};
  const stageSegmentRect=(a,b,r)=>{
    let lo=0,hi=1;
    for(const [start,delta,min,max] of [[a.x,b.x-a.x,r.left,r.right],[a.y,b.y-a.y,r.top,r.bottom]]){
      if(Math.abs(delta)<1e-7){if(start<min||start>max)return null;continue;}
      let p=(min-start)/delta,q=(max-start)/delta;if(p>q)[p,q]=[q,p];lo=Math.max(lo,p);hi=Math.min(hi,q);if(lo>hi)return null;
    }
    return lo;
  };
  CommonCombatRunner.prototype.stageProps=function(){
    if(!this.__afStageProps)this.__afStageProps=(STAGE_PROP_LAYOUTS[this.stageId]||STAGE_PROP_LAYOUTS["P-01"]).map(([id,xm,z,w,h,style])=>({id,xm,z,w,h,style,hp:style==="pier"?1600:1200,maxHp:style==="pier"?1600:1200,hits:0}));
    return this.__afStageProps;
  };
  CommonCombatRunner.prototype.stagePropPose=function(prop){
    const near=clamp((1/(prop.z+5)-1/35)/(1/12-1/35),0,1),ppm=(25.6+49.1*near)*(this.width/1280),footY=this.height*(.515+.085*near);
    const x=this.width/2+prop.xm*ppm+this.cameraYawShift(footY),w=Math.max(44,prop.w*ppm),h=Math.max(48,prop.h*(29+13*near)*(this.height/720));
    return{x,y:footY,w,h,near,left:x-w/2,right:x+w/2,top:footY-h,bottom:footY};
  };
  CommonCombatRunner.prototype.resolveStagePropShot=function(shot,friendly){
    if(!shot||shot.age>=shot.life||shot.__afPropResolved)return false;
    const from={x:shot.px,y:shot.py},to={x:shot.x,y:shot.y};if(!Number.isFinite(from.x)||!Number.isFinite(from.y)||!Number.isFinite(to.x)||!Number.isFinite(to.y))return false;
    let nearest=null;
    for(const prop of this.stageProps()){
      if(prop.hp<=0)continue;const pose=this.stagePropPose(prop),t=stageSegmentRect(from,to,pose);
      if(t!==null&&(!nearest||t<nearest.t))nearest={prop,pose,t};
    }
    if(!nearest)return false;
    const {prop,t}=nearest,hit={x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t};
    shot.x=hit.x;shot.y=hit.y;shot.age=shot.life;shot.__afPropResolved=true;
    const damage=friendly?(shot.heavy?55:24):Math.max(1,Number(shot.damage)||8);
    prop.hp=Math.max(0,prop.hp-damage);prop.hits++;
    this.qa.stagePropHits=(this.qa.stagePropHits||0)+1;
    this.trace("obstacle_hit",{obstacleId:prop.id,shotId:shot.shotId||shot.attackId||null,friendly,damage,hp:prop.hp,x:hit.x,y:hit.y});
    if(friendly)this.impacts.push({x:hit.x,y:hit.y,spec:shot.spec,age:0});
    else this.incomingImpacts.push({x:hit.x,y:hit.y,kind:shot.kind,age:0,life:.46});
    if(prop.hp===0){this.qa.stagePropDestroyed=(this.qa.stagePropDestroyed||0)+1;this.trace("obstacle_destroyed",{obstacleId:prop.id,hits:prop.hits});}
    return true;
  };
  const coreStageProjectileHit=CommonCombatRunner.prototype.projectileHitsEnemy;
  CommonCombatRunner.prototype.projectileHitsEnemy=function(shot,enemy){
    if(shot?.age>=shot?.life)return false;
    if(this.resolveStagePropShot(shot,true))return false;
    return coreStageProjectileHit.call(this,shot,enemy);
  };
  const coreStageEnemyHit=CommonCombatRunner.prototype.applyEnemyHit;
  CommonCombatRunner.prototype.applyEnemyHit=function(shot,target){
    if(target?.coverRequested&&target.member?.hp>0){
      const before=target.__afCoverHP??100;
      if(before>0){shot.__afHadCover=true;target.__afCoverHP=Math.max(0,before-Math.max(1,Number(shot.damage)||8));this.qa.coverPanelAbsorptions=(this.qa.coverPanelAbsorptions||0)+1;
        this.trace("cover_panel_hit",{characterId:target.spec.id,attackId:shot.attackId||null,before,after:target.__afCoverHP});
        if(target.__afCoverHP===0)this.trace("cover_panel_broken",{characterId:target.spec.id});}
    }
    return coreStageEnemyHit.call(this,shot,target);
  };
  CommonCombatRunner.prototype.drawStageProp=function(ctx,prop){
    const p=this.stagePropPose(prop),accent=STAGE_PROP_ACCENT[this.stageId]||"#a7ced9",left=p.left,top=p.top,w=p.w,h=p.h;
    ctx.save();ctx.fillStyle="rgba(3,10,16,.45)";ctx.beginPath();ctx.ellipse(p.x,p.y+6,w*.72,8+5*p.near,0,0,Math.PI*2);ctx.fill();
    if(prop.hp<=0){ctx.fillStyle="#1a2b31";ctx.beginPath();ctx.moveTo(left,p.y-7);ctx.lineTo(left+w*.1,p.y-h*.48);ctx.lineTo(left+w*.42,p.y-h*.38);ctx.lineTo(left+w*.68,p.y-h*.57);ctx.lineTo(p.right,p.y-h*.22);ctx.lineTo(p.right,p.y);ctx.closePath();ctx.fill();ctx.strokeStyle=accent;ctx.globalAlpha=.5;ctx.beginPath();ctx.moveTo(left+w*.12,p.y-h*.42);ctx.lineTo(left+w*.57,p.y-h*.2);ctx.stroke();ctx.restore();return;}
    const face=ctx.createLinearGradient(left,top,p.right,p.y);face.addColorStop(0,"#596466");face.addColorStop(.23,"#26383c");face.addColorStop(.72,"#34474a");face.addColorStop(1,"#101e25");
    ctx.fillStyle="#182930";ctx.beginPath();ctx.moveTo(p.right,top+7);ctx.lineTo(p.right+w*.13,top+15);ctx.lineTo(p.right+w*.13,p.y-3);ctx.lineTo(p.right,p.y);ctx.closePath();ctx.fill();
    ctx.fillStyle=face;ctx.strokeStyle="#82979a";ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(left+7,top);ctx.lineTo(p.right-6,top+4);ctx.lineTo(p.right,p.y-3);ctx.lineTo(left,p.y);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.strokeStyle=accent;ctx.lineWidth=3;ctx.globalAlpha=.78;ctx.beginPath();ctx.moveTo(left+9,top+9);ctx.lineTo(p.right-9,top+12);ctx.stroke();ctx.globalAlpha=1;
    if(prop.style==="cabinet"){
      ctx.fillStyle="rgba(6,24,31,.7)";ctx.fillRect(left+w*.13,top+h*.23,w*.72,h*.6);ctx.strokeStyle="#8ca3a1";ctx.lineWidth=1.5;ctx.strokeRect(left+w*.13,top+h*.23,w*.72,h*.6);
      for(let i=0;i<5;i++){ctx.strokeStyle=i===1?accent:"#0b1c23";ctx.lineWidth=i===1?2:3;ctx.beginPath();ctx.moveTo(left+w*.2,top+h*(.32+i*.095));ctx.lineTo(left+w*.68,top+h*(.32+i*.095));ctx.stroke();}
      ctx.fillStyle="#c8d3c8";ctx.fillRect(left+w*.77,top+h*.5,Math.max(2,w*.04),h*.15);
    }else{
      ctx.strokeStyle="#11232a";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(left+w*.13,top+h*.22);ctx.lineTo(left+w*.61,top+h*.69);ctx.lineTo(left+w*.39,p.y-8);ctx.stroke();
      ctx.strokeStyle=accent;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(left+w*.15,top+h*.7);ctx.lineTo(left+w*.84,top+h*.71);ctx.stroke();
    }
    if(prop.hp<prop.maxHp){ctx.strokeStyle="rgba(4,10,15,.85)";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(left+w*.46,top+h*.15);ctx.lineTo(left+w*.55,top+h*.42);ctx.lineTo(left+w*.47,top+h*.57);ctx.stroke();}
    this.qa.stagePropsDrawn=(this.qa.stagePropsDrawn||0)+1;ctx.restore();
  };
  CommonCombatRunner.prototype.drawStageGroundPlane=function(ctx,drawEnemy){
    const objects=[...this.enemies.filter(enemy=>(enemy.renderLayer||enemy.spec.depthBand||"background1")==="background1").map(enemy=>({kind:"enemy",depth:enemy.afRouteNear??.54,value:enemy})),
      ...this.stageProps().map(prop=>({kind:"prop",depth:this.stagePropPose(prop).near,value:prop}))];
    objects.sort((a,b)=>a.depth-b.depth||String(a.value.id).localeCompare(String(b.value.id)));
    for(const row of objects)row.kind==="enemy"?drawEnemy(this,ctx,row.value):this.drawStageProp(ctx,row.value);
  };
  CommonCombatRunner.prototype.drawSquadCover=function(ctx){
    const accent=STAGE_PROP_ACCENT[this.stageId]||"#8ddce2";
    for(const player of this.players){if(!player||player.member.hp<=0)continue;
      const hp=player.__afCoverHP??100,body=playerBodyPx(player),half=body*.59,top=player.y-body*.42,bottom=player.y+8,active=Boolean(player.coverRequested);
      ctx.save();ctx.fillStyle="rgba(0,7,13,.52)";ctx.beginPath();ctx.ellipse(player.x,bottom+3,half*1.15,9,0,0,Math.PI*2);ctx.fill();
      if(hp<=0){ctx.fillStyle="#182a32";ctx.fillRect(player.x-half,bottom-13,half*2,13);ctx.strokeStyle=accent;ctx.beginPath();ctx.moveTo(player.x-half,bottom-13);ctx.lineTo(player.x+half*.25,bottom-18);ctx.stroke();ctx.restore();continue;}
      const left=player.x-half,w=half*2,h=bottom-top,bevel=Math.min(12,w*.075),face=ctx.createLinearGradient(left,top,left+w,bottom);
      face.addColorStop(0,"#526d73");face.addColorStop(.18,"#203843");face.addColorStop(.65,"#152b35");face.addColorStop(1,"#081a25");
      ctx.fillStyle=face;ctx.strokeStyle="#658c94";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(left+bevel,top);ctx.lineTo(left+w-bevel,top);ctx.lineTo(left+w,top+bevel);ctx.lineTo(left+w,bottom-6);ctx.lineTo(left,bottom-6);ctx.lineTo(left,top+bevel);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle="rgba(71,162,179,.13)";ctx.fillRect(left+12,top+13,w-24,Math.min(38,h*.34));
      ctx.strokeStyle=accent;ctx.globalAlpha=active?.92:.58;ctx.lineWidth=active?3:2;ctx.beginPath();ctx.moveTo(left+13,top+8);ctx.lineTo(left+w-13,top+8);ctx.stroke();ctx.globalAlpha=1;
      ctx.fillStyle="#0c1d27";ctx.fillRect(left+9,top+h*.49,w-18,h*.39);ctx.strokeStyle="#63838a";ctx.lineWidth=1;ctx.strokeRect(left+9,top+h*.49,w-18,h*.39);
      ctx.strokeStyle=accent;ctx.globalAlpha=active?.55:.22;for(let i=1;i<4;i++){const x=left+w*i/4;ctx.beginPath();ctx.moveTo(x,top+h*.53);ctx.lineTo(x,top+h*.83);ctx.stroke();}ctx.globalAlpha=1;
      ctx.fillStyle=accent;ctx.fillRect(left+10,bottom-10,(w-20)*hp/100,3);
      if(hp<65){ctx.strokeStyle="rgba(3,7,12,.8)";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(left+w*.57,top+16);ctx.lineTo(left+w*.51,top+h*.48);ctx.lineTo(left+w*.62,top+h*.69);ctx.stroke();}
      this.qa.coverPanelsDrawn=(this.qa.coverPanelsDrawn||0)+1;ctx.restore();
    }
  };
  // >>> COMBAT_ASSET_PROPS_V3 (2026-09-25)
  // kArchive/dogfooter GLBs were weathered and rendered as RGBA in Blender.
  // Model attribution and exact source hashes are in RUN/ASSET_CREDITS.md.
  const COMBAT_PROP_ART=Object.freeze({
    sandbag:{normal:["sandbag-barricade-dark-v2.webp",325,364,840,386],broken:["sandbag-barricade-destroyed-dark-v2.webp",242,323,1003,490]},
    roadblock:{normal:["concrete-roadblock.webp",152,139,463,290],broken:["concrete-roadblock-destroyed.webp",153,141,462,288]},
    crates:{normal:["supply-crates.webp",220,47,329,435],broken:["supply-crates-destroyed.webp",213,49,342,429]}
  });
  const STAGE_ASSET_MODELS=Object.freeze({
    "P-01":["crates","roadblock"],"P-02":["crates","roadblock"],"P-04":["crates","roadblock"],
    "P-06":["crates","roadblock"],"P-07":["crates","roadblock"],"P-08":["crates","roadblock"],
    "P-09":["crates","roadblock"],"P-14":["crates","roadblock"]
  });
  const combatPropImages=new Map();
  const combatPropImage=name=>{
    if(!combatPropImages.has(name)){
      const image=new Image();image.decoding="async";image.src=`../assets/combat_props/${name}`;
      image.onerror=()=>console.error(`Combat prop art failed to load: ${name}`);
      combatPropImages.set(name,image);
    }
    const image=combatPropImages.get(name);return image.complete&&image.naturalWidth?image:null;
  };
  const drawCombatPropArt=(ctx,key,broken,x,y,w,h)=>{
    const art=COMBAT_PROP_ART[key]?.[broken?"broken":"normal"];if(!art)return false;
    const image=combatPropImage(art[0]);if(!image)return false;
    ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
    ctx.filter="saturate(.72) contrast(1.08) brightness(.86)";
    ctx.drawImage(image,art[1],art[2],art[3],art[4],x,y,w,h);ctx.restore();return true;
  };
  const stageAssetKey=(runner,prop)=>{
    const rows=runner.stageProps(),index=rows.indexOf(prop),models=STAGE_ASSET_MODELS[runner.stageId]||STAGE_ASSET_MODELS["P-01"];
    return models[Math.max(0,index)]||"roadblock";
  };
  const codeStagePropPose=CommonCombatRunner.prototype.stagePropPose;
  CommonCombatRunner.prototype.stagePropPose=function(prop){
    const old=codeStagePropPose.call(this,prop),key=stageAssetKey(this,prop),art=COMBAT_PROP_ART[key].normal,
      near=old.near,scale=this.height/720,base=key==="crates"?prop.h*(32+8*near):prop.h*(19+7*near),
      h=clamp(base,key==="crates"?65:52,key==="crates"?116:100)*scale,w=h*art[3]/art[4];
    return{...old,w,h,left:old.x-w/2,right:old.x+w/2,top:old.y-h,bottom:old.y};
  };
  CommonCombatRunner.prototype.drawStageProp=function(ctx,prop){
    const p=this.stagePropPose(prop),key=stageAssetKey(this,prop);
    ctx.save();ctx.fillStyle="rgba(0,5,10,.34)";ctx.beginPath();ctx.ellipse(p.x,p.y+5,p.w*.44,Math.max(5,p.h*.085),0,0,Math.PI*2);ctx.fill();ctx.restore();
    if(drawCombatPropArt(ctx,key,prop.hp<=0,p.left,p.top,p.w,p.h))this.qa.stagePropsDrawn=(this.qa.stagePropsDrawn||0)+1;
  };
  CommonCombatRunner.prototype.drawSquadCover=function(ctx){
    for(const player of this.players){
      if(!player||player.member.hp<=0)continue;
      const body=playerBodyPx(player),key="sandbag",art=COMBAT_PROP_ART.sandbag.normal,
        width=body*1.0,height=width*art[4]/art[3],
        // The barricade sits upstage of the actor, toward the incoming enemies.
        // Its bottom is in front of the torso, not at the feet or HUD edge.
        bottom=player.y-body*.24,left=player.x-width/2,top=bottom-height,hp=player.__afCoverHP??100;
      ctx.save();ctx.fillStyle="rgba(0,5,10,.47)";ctx.beginPath();ctx.ellipse(player.x,bottom+4,width*.45,Math.max(6,body*.065),0,0,Math.PI*2);ctx.fill();ctx.restore();
      if(drawCombatPropArt(ctx,key,hp<=0,left,top,width,height))this.qa.coverPanelsDrawn=(this.qa.coverPanelsDrawn||0)+1;
      if(player.coverRequested&&hp>0){ctx.save();ctx.fillStyle="rgba(85,225,240,.78)";ctx.fillRect(left+width*.12,bottom-3,width*.76*hp/100,2);ctx.restore();}
    }
  };
  // <<< COMBAT_ASSET_PROPS_V3
  const coreStageSave=CommonCombatRunner.prototype.save;
  CommonCombatRunner.prototype.save=function(...args){const result=coreStageSave.apply(this,args);try{const key=`aftersignal:combat:${this.stageId}:v1`,saved=JSON.parse(localStorage.getItem(key)||"null");if(saved){saved.stageProps=this.stageProps().map(prop=>({id:prop.id,hp:prop.hp,hits:prop.hits}));saved.coverPanels=this.players.filter(Boolean).map(player=>({slot:player.slot,hp:player.__afCoverHP??100}));localStorage.setItem(key,JSON.stringify(saved));}}catch{}return result;};
  const coreStageRestore=CommonCombatRunner.prototype.restore;
  CommonCombatRunner.prototype.restore=function(...args){const result=coreStageRestore.apply(this,args);if(!result)return result;try{const saved=JSON.parse(localStorage.getItem(`aftersignal:combat:${this.stageId}:v1`)||"null");if(saved){const props=new Map((saved.stageProps||[]).map(row=>[row.id,row]));for(const prop of this.stageProps()){const row=props.get(prop.id);if(row){prop.hp=clamp(Number(row.hp)||0,0,prop.maxHp);prop.hits=Math.max(0,Number(row.hits)||0);}}for(const row of saved.coverPanels||[]){const player=this.players[row.slot];if(player)player.__afCoverHP=clamp(Number(row.hp)||0,0,100);}}}catch{}return result;};
  // <<< COMBAT_STAGE_COVER_V1
  // >>> COMBAT_COVER_PLACEMENT_V1 (2026-09-25, Claude Code; combat_reboot_v1/game_bake_v1/tools/runtime_patches/combat_cover_placement_v1.py)
  // Squad sandbag cover stands just upstage of each character (toward the enemies) and is drawn behind the sprite.
  const SQUAD_COVER_ART=Object.freeze({
    // [file, sx, sy, sw, sh] = alpha>=8 bounds of the unchanged dark sandbag art, +2px.
    normal:["sandbag-barricade-dark-v2.webp",325,365,840,384],
    broken:["sandbag-barricade-destroyed-dark-v2.webp",242,323,1003,489],
    // The destroyed recolor came out 1.2x larger than its source render; draw it at the intact barricade's width.
    brokenWidth:.986
  });
  const SQUAD_COVER=Object.freeze({width:1.2,lift:.2,shadow:.34});
  const squadFieldProps=(()=>{const on=value=>/(?:[?&])fieldprops=1(?:&|$)/.test(String(value||""));try{if(on(location.search))return true;}catch{}try{if(on(window.top.location.search))return true;}catch{}return false;})();
  const codexStageProps=CommonCombatRunner.prototype.stageProps;
  CommonCombatRunner.prototype.stageProps=function(){
    // Field obstacles among the enemies are off unless ?fieldprops=1 (then Codex's version, unchanged).
    if(!squadFieldProps)return this.__afNoFieldProps||(this.__afNoFieldProps=[]);
    return codexStageProps.call(this);
  };
  CommonCombatRunner.prototype.squadCoverRect=function(player){
    const body=playerBodyPx(player),broken=(player.__afCoverHP??100)<=0,art=SQUAD_COVER_ART[broken?"broken":"normal"],
      base=body*SQUAD_COVER.width,w=broken?base*SQUAD_COVER_ART.brokenWidth:base,h=w*art[4]/art[3],bottom=player.y-body*SQUAD_COVER.lift;
    return {art,broken,body,x:player.x,w,h,left:player.x-w/2,right:player.x+w/2,top:bottom-h,bottom,topIntact:bottom-base*SQUAD_COVER_ART.normal[4]/SQUAD_COVER_ART.normal[3]};
  };
  CommonCombatRunner.prototype.drawSquadCoverBase=function(ctx){
    for(const player of this.players){
      if(!player||player.member.hp<=0)continue;
      const r=this.squadCoverRect(player);
      ctx.save();ctx.fillStyle=`rgba(0,5,10,${SQUAD_COVER.shadow})`;ctx.beginPath();ctx.ellipse(r.x,r.bottom-2,r.w*.5,Math.max(5,r.body*.05),0,0,Math.PI*2);ctx.fill();ctx.restore();
      const image=combatPropImage(r.art[0]);if(!image)continue;
      ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.filter="brightness(.94)";
      ctx.drawImage(image,r.art[1],r.art[2],r.art[3],r.art[4],r.left,r.top,r.w,r.h);ctx.restore();
      this.qa.coverPanelsDrawn=(this.qa.coverPanelsDrawn||0)+1;
    }
  };
  CommonCombatRunner.prototype.drawSquadCover=function(ctx){
    // Late pass: only the cover HP bar, above the barricade, while in cover or once damaged.
    for(const player of this.players){
      if(!player||player.member.hp<=0)continue;
      const hp=player.__afCoverHP??100;if(hp<=0||(!player.coverRequested&&hp>=100))continue;
      const r=this.squadCoverRect(player),w=r.w*.5,left=r.x-w/2,y=r.topIntact-7;
      ctx.save();ctx.fillStyle="rgba(4,10,16,.72)";ctx.fillRect(left-1,y-1,w+2,5);ctx.fillStyle=hp>35?"rgba(96,222,238,.92)":"rgba(255,122,108,.95)";ctx.fillRect(left,y,w*hp/100,3);ctx.restore();
    }
  };
  // <<< COMBAT_COVER_PLACEMENT_V1
  // >>> COMBAT_COVER_HP_BREAK_V1 (2026-09-25, Claude Code; combat_reboot_v1/game_bake_v1/tools/runtime_patches/combat_cover_hp_break_v1.py)
  // Visible cover HP, hit shake, damaged art at <=35 HP, and a destruction sequence at 0 HP after which the cover is gone.
  const COVER_FX=Object.freeze({maxHp:100,damagedAt:35,hitShake:.2,breakSeconds:1.5,cols:5,rows:3,trailDelay:.35,trailRate:70});
  const coverRand=seed=>{const x=Math.sin(seed*127.1+311.7)*43758.5453;return x-Math.floor(x);};
  CommonCombatRunner.prototype.squadCoverRect=function(player){
    const body=playerBodyPx(player),hp=player.__afCoverHP??COVER_FX.maxHp,broken=hp<=COVER_FX.damagedAt,art=SQUAD_COVER_ART[broken?"broken":"normal"],
      base=body*SQUAD_COVER.width,w=broken?base*SQUAD_COVER_ART.brokenWidth:base,h=w*art[4]/art[3],bottom=player.y-body*SQUAD_COVER.lift;
    return {art,broken,body,x:player.x,w,h,left:player.x-w/2,right:player.x+w/2,top:bottom-h,bottom,topIntact:bottom-base*SQUAD_COVER_ART.normal[4]/SQUAD_COVER_ART.normal[3]};
  };
  const coverUpdateCore=CommonCombatRunner.prototype.update;
  CommonCombatRunner.prototype.update=function(dt,...args){
    const result=coverUpdateCore.call(this,dt,...args);
    try{
      const step=Math.max(0,Math.min(.1,Number(dt)||0));this.__afCoverClock=(this.__afCoverClock||0)+step;const now=this.__afCoverClock;
      for(const player of this.players){
        if(!player)continue;const hp=player.__afCoverHP??COVER_FX.maxHp,seen=player.__afCoverSeenHP;
        if(seen===undefined){player.__afCoverTrailHP=hp;}
        else if(hp<seen){
          if(hp<=0&&!player.__afCoverBreak){
            player.__afCoverBreak={t:now,rect:this.squadCoverRect({...player,__afCoverHP:1}),seed:(player.slot||0)*17+1};
            this.camera=Math.max(this.camera||0,3.2);this.playSfx?.("hit_core");
            this.qa.coverBreakEffects=(this.qa.coverBreakEffects||0)+1;this.trace("cover_destroyed",{characterId:player.spec?.id,slot:player.slot});
          }else if(hp>0){player.__afCoverHitAt=now;this.qa.coverHitEffects=(this.qa.coverHitEffects||0)+1;}
        }
        player.__afCoverSeenHP=hp;
        const trail=player.__afCoverTrailHP??hp;
        player.__afCoverTrailHP=trail<=hp?hp:(now-(player.__afCoverHitAt??-9)<COVER_FX.trailDelay?trail:Math.max(hp,trail-COVER_FX.trailRate*step));
      }
    }catch(error){this.qa.coverFxErrors=(this.qa.coverFxErrors||0)+1;}
    return result;
  };
  const coverRestoreCore=CommonCombatRunner.prototype.restore;
  CommonCombatRunner.prototype.restore=function(...args){
    const result=coverRestoreCore.apply(this,args);
    // A restored 0-HP cover is simply absent; do not replay its explosion.
    for(const player of this.players){if(player){delete player.__afCoverSeenHP;delete player.__afCoverBreak;player.__afCoverTrailHP=player.__afCoverHP??COVER_FX.maxHp;}}
    return result;
  };
  // >>> COMBAT_COVER_BREAK_V2 (2026-09-25, Claude Code; combat_reboot_v1/game_bake_v1/tools/runtime_patches/combat_cover_break_v2.py)
  // Sandbags of the damaged art (sandbag-barricade-destroyed-dark-v2.png) in source pixels:
  // [centre x, centre y, width, height, tilt, role]. Role -1/1: a top end bag is thrown off to the left/right, tumbles,
  // lands and flops flat; 0: a torn top bag sags down behind the front row; 2: a front (bottom) bag is shoved and settles.
  const COVER_BAGS=Object.freeze([[425,418,312,178,.05,-1],[640,455,272,188,.12,0],[860,495,232,172,.1,0],[1068,536,306,186,.15,1],
    [385,584,274,170,.06,2],[637,626,250,166,.08,2],[857,668,230,170,.1,2],[1087,704,300,190,.14,2]]);
  const COVER_TEARS=Object.freeze([[655,470,1],[712,548,1],[790,462,2],[872,560,2]]); // torn openings [x, y, bag] that pour sand
  const COVER_SAND=Object.freeze(["#7a705c","#5f5849","#8c806a","#4b463c"]);
  const coverGroundArt=ax=>668+(ax-385)*.185; // ground line under the receding wall, art pixels
  const coverPillow=(ctx,w,h)=>{ctx.beginPath();for(let i=0;i<=40;i++){const a=i/40*Math.PI*2,c=Math.cos(a),s=Math.sin(a),x=w/2*Math.sign(c)*Math.sqrt(Math.abs(c)),y=h/2*Math.sign(s)*Math.sqrt(Math.abs(s));i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();};
  const coverPuff=(ctx,x,y,rx,ry,a,rgb)=>{if(a<=.004||rx<=0)return;ctx.save();ctx.translate(x,y);ctx.scale(1,ry/rx);const g=ctx.createRadialGradient(0,0,0,0,0,rx);g.addColorStop(0,`rgba(${rgb},${a})`);g.addColorStop(.55,`rgba(${rgb},${a*.5})`);g.addColorStop(1,`rgba(${rgb},0)`);ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,rx,0,Math.PI*2);ctx.fill();ctx.restore();};
  let coverPileCanvas=null; // shared scratch layer: the pile fades as one image, so overlapping bags never show seams
  const coverPileLayer=ctx=>{
    const w=ctx.canvas.width,h=ctx.canvas.height;coverPileCanvas??=document.createElement("canvas");
    if(coverPileCanvas.width!==w||coverPileCanvas.height!==h){coverPileCanvas.width=w;coverPileCanvas.height=h;}
    const l=coverPileCanvas.getContext("2d");l.setTransform(1,0,0,1,0,0);l.clearRect(0,0,w,h);l.setTransform(ctx.getTransform());return l;
  };
  const drawCoverBreak=(runner,ctx,player,age)=>{
    const b=player.__afCoverBreak,r=b.rect,art=SQUAD_COVER_ART.broken,image=combatPropImage(art[0]),D=COVER_FX.breakSeconds,
      k=r.w/art[3],X=ax=>r.left+(ax-art[1])*k,Y=ay=>r.top+(ay-art[2])*k,groundAt=wx=>Y(coverGroundArt(art[1]+(wx-r.left)/k)),
      rnd=n=>coverRand(b.seed*13.7+n),jolt=age<.16?Math.sin(age*90)*2.2*(1-age/.16):0,unit=r.body/160,
      fade=(t,from)=>t<from?1:Math.max(0,1-(t-from)/(D-from)),pileAlpha=fade(age,.85);
    const bagAt=(i,t)=>{
      const [ax,ay,aw,ah,tilt,role]=COVER_BAGS[i],q1=rnd(i*1.7),q2=rnd(i*2.3+.4),q3=rnd(i*3.1+.9),q4=rnd(i*4.7+1.3),w=aw*k,h=ah*k,x0=X(ax),y0=Y(ay);
      let x=x0,y=y0,rot=tilt,sx=1,sy=1,land=null;
      if(role===2){
        const side=Math.max(-1,Math.min(1,(ax-735)/350)),e=1-Math.exp(-t*8),s=Math.min(1,t/.9),sag=s*s*(3-2*s);
        x+=side*w*(.04+.04*q1)*e+jolt;sy=1-(.08+.05*q2)*sag;sx=1+.03*sag;rot+=(side*(.03+.05*q2)+(q3-.5)*.12)*e;y+=h*(1-sy)/2+h*(.02+.07*q4)*e;
      }else if(role===0){
        const s=Math.min(1,t/.5),fall=s*s*(3-2*s);
        x+=(q1-.5)*w*.2*fall+jolt*.6;sy=1-.2*fall;sx=1+.06*fall;y+=(-h*.12*Math.sin(Math.min(1,t/.18)*Math.PI))+h*(.55+.15*q3)*fall;rot+=(q4-.5)*.5*fall;
      }else{
        const vx=role*(130+60*q1),vy=-(80+60*q2),spin=role*(2.1+.6*q3),rest=role*(.18+.14*q4),
          at=s=>{const xs=x0+vx*(1-Math.exp(-s*3))/3,rs=tilt+spin*s,ext=(w/2*Math.abs(Math.sin(rs))+h/2*Math.abs(Math.cos(rs)))*.88,yf=y0+vy*s+800*s*s,floor=groundAt(xs)-ext;return [xs,yf,rs,floor];};
        let tl=null;for(let s=0;s<=t;s+=1/120){const p=at(s);if(p[1]>=p[3]){tl=s;break;}}
        if(tl===null){const p=at(t);[x,y,rot]=p;}
        else{
          // Flop: the tumble relaxes to lying almost flat, with a small soft squash on impact.
          const p=at(tl),e=Math.exp(-(t-tl)*9),slide=(1-Math.exp(-(t-tl)*6))/6;
          rot=tilt+rest+(p[2]-tilt-rest)*e;x=p[0]+vx*Math.exp(-tl*3)*slide*.5;
          const ext=(w/2*Math.abs(Math.sin(rot))+h/2*Math.abs(Math.cos(rot)))*.88;y=groundAt(x)-ext;
          const sq=Math.exp(-(t-tl)*12);sy=1-.16*sq;sx=1+.08*sq;y+=h*.08*sq;land=[x,groundAt(x),t-tl];
        }
      }
      return {role,x,y,rot,sx,sy,w,h,ax,ay,tilt,land};
    };
    const drawBag=(l,s)=>{
      const R=Math.hypot(s.w,s.h)*.55/k,sx0=Math.max(0,s.ax-R),sy0=Math.max(0,s.ay-R),sw=Math.min(image.naturalWidth,s.ax+R)-sx0,sh=Math.min(image.naturalHeight,s.ay+R)-sy0;
      l.save();l.translate(s.x,s.y);l.rotate(s.rot);l.scale(s.sx,s.sy);coverPillow(l,s.w*.97,s.h*.97);l.clip();l.rotate(-s.tilt);
      l.drawImage(image,sx0,sy0,sw,sh,(sx0-s.ax)*k,(sy0-s.ay)*k,sw*k,sh*k);l.restore();
    };
    ctx.save();
    ctx.fillStyle=`rgba(0,5,10,${SQUAD_COVER.shadow*fade(age,.3)})`;ctx.beginPath();ctx.ellipse(r.x,r.bottom-2,r.w*(.5+.08*Math.min(1,age*3)),Math.max(5,r.body*.05),0,0,Math.PI*2);ctx.fill();
    const bags=COVER_BAGS.map((_,i)=>bagAt(i,age));
    if(image&&pileAlpha>0){
      const l=coverPileLayer(ctx);l.imageSmoothingEnabled=true;l.imageSmoothingQuality="high";
      // The whole wall for the first 0.08 s fills the seams between the bags; top bags go behind the front row.
      if(age<.08){l.save();l.globalAlpha=1-age/.08;l.drawImage(image,art[1],art[2],art[3],art[4],r.left+jolt,r.top,r.w,r.h);l.restore();}
      for(const s of bags)if(s.role!==2)drawBag(l,s);
      for(const s of bags)if(s.role===2)drawBag(l,s);
      // Torn burlap scraps flutter out of the burst bags.
      for(let j=0;j<6;j++){
        const q=n=>rnd(50+j*5.3+n*1.9),ax=615+270*q(1),ay=395+150*q(2),sz=(38+34*q(3))*k,x0=X(ax),y0=Y(ay),vx=(q(4)-.5)*300,vy=-(170+230*q(5)),
          gy=groundAt(x0+vx*.5)-2,tl=(-vy+Math.sqrt(vy*vy+2200*Math.max(0,gy-y0)))/1100,tt=Math.min(age,tl),x=x0+vx*(1-Math.exp(-tt*1.6))/1.6,y=Math.min(y0+vy*tt+550*tt*tt,gy),
          flip=Math.cos(tt*(7+9*q(8)));
        l.save();l.translate(x,y);l.rotate(q(6)*6.28+(q(7)-.5)*16*tt);l.scale(Math.sign(flip||1)*Math.max(.2,Math.abs(flip)),1);
        l.beginPath();for(let v=0;v<7;v++){const ang=v/7*Math.PI*2+(q(10+v)-.5)*.6,rad=sz/2*(.5+.5*q(20+v));v?l.lineTo(Math.cos(ang)*rad,Math.sin(ang)*rad):l.moveTo(Math.cos(ang)*rad,Math.sin(ang)*rad);}l.closePath();l.clip();
        const src=sz/k*.6;l.drawImage(image,ax-src,ay-src,src*2,src*2,-sz*.6,-sz*.6,sz*1.2,sz*1.2);l.restore();
      }
      ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=pileAlpha;ctx.filter="brightness(.9)";ctx.drawImage(coverPileCanvas,0,0,ctx.canvas.width/(ctx.__afHiresK||1),ctx.canvas.height/(ctx.__afHiresK||1));ctx.restore();
    }
    // Sand: a burst spray from the tears, then streams pouring out of them onto the pile.
    const grain=(x,y,s,c,a)=>{if(a<=.01)return;ctx.globalAlpha=a;ctx.fillStyle=COVER_SAND[c];ctx.beginPath();ctx.arc(x,y,s/2,0,Math.PI*2);ctx.fill();};
    for(let j=0;j<44;j++){
      const q=n=>rnd(200+j*2.7+n*1.3),tear=COVER_TEARS[j%4],x0=X(tear[0]),y0=Y(tear[1]),ang=-Math.PI/2+(q(1)-.5)*2.6,sp=120+260*q(2),vx=Math.cos(ang)*sp,vy=Math.sin(ang)*sp,
        gy=groundAt(x0+vx*.4),tl=(-vy+Math.sqrt(vy*vy+2000*Math.max(0,gy-y0)))/1000,tt=Math.min(age,tl);
      grain(x0+vx*tt,Math.min(y0+vy*tt+500*tt*tt,gy),(1+1.5*q(3))*unit,Math.floor(q(4)*4),fade(age,.7));
    }
    for(let j=0;j<60;j++){
      const q=n=>rnd(400+j*3.1+n*1.7),tear=COVER_TEARS[j%4],birth=Math.floor(j/4)/15*.9+q(1)*.05,s=age-birth;if(s<0)continue;
      const bs=bagAt(tear[2],birth),x0=bs.x+(tear[0]-bs.ax)*k*bs.sx,y0=bs.y+(tear[1]-bs.ay)*k*bs.sy,vx=(q(2)-.5)*50,vy=20+40*q(3),
        gy=groundAt(x0),tl=(-vy+Math.sqrt(vy*vy+1800*Math.max(0,gy-y0)))/900,tt=Math.min(s,tl);
      grain(x0+vx*tt,Math.min(y0+vy*tt+450*tt*tt,gy-1),(.9+1.1*q(4))*unit,Math.floor(q(5)*4),fade(age,.9));
    }
    ctx.globalAlpha=1;
    // Dust: a dark burst cloud, puffs where the thrown bags land, then a low cloud that covers the pile as it goes.
    for(let j=0;j<10;j++){
      const q=n=>rnd(600+j*2.9+n*1.1),grow=1-Math.pow(1-Math.min(1,age/.9),2),x=r.left+r.w*(j+.5)/10+(q(1)-.5)*r.w*.12+(j-4.5)*r.w*.035*grow,
        y=r.bottom-r.h*(.25+.55*q(2))-r.body*.2*age,rad=(r.h*.22+r.h*.28*q(3))*(.5+1.1*grow);
      coverPuff(ctx,x,y,rad,rad*.85,.44*Math.pow(Math.max(0,1-age/.95),1.6),"96,93,88");
    }
    for(const s of bags)if(s.land&&s.land[2]<.6){const u=s.land[2]/.6;coverPuff(ctx,s.land[0],s.land[1]-s.h*.12,s.w*(.4+.5*u),s.w*(.4+.5*u)*.42,.4*(1-u),"92,90,85");}
    for(let j=0;j<8;j++){
      const q=n=>rnd(700+j*3.7+n*1.3),gx=r.left+r.w*(j+.5)/8+(q(1)-.5)*r.w*.1,rx=r.w*(.14+.07*q(2))*(1+age*.8);
      coverPuff(ctx,gx,groundAt(gx)-r.h*(.12+.1*Math.min(1,age)),rx,rx*.5,.46*Math.max(0,Math.min(1,(age-.5)/.4))*fade(age,1.05),"80,79,76");
    }
    if(age<.12){ctx.globalCompositeOperation="lighter";coverPuff(ctx,r.x,r.bottom-r.h*.5,r.w*.32,r.w*.26,.35*(1-age/.12),"255,214,170");}
    ctx.restore();
  };
  // <<< COMBAT_COVER_BREAK_V2
  // PERF_FULLCHECK_20260926: the wall art is dimmed once per crop (brightness(.94)) instead of filtering every draw.
  const dimmedCoverCrops=new Map();
  const dimmedCoverCrop=(image,art)=>{
    const key=art.join("|"),hit=dimmedCoverCrops.get(key);
    if(hit&&hit.image===image)return hit.canvas;
    let canvas=null;
    try{
      const c=typeof document!=="undefined"&&typeof document.createElement==="function"?document.createElement("canvas"):null,g=c?.getContext?.("2d");
      if(g&&"filter" in g){c.width=art[3];c.height=art[4];g.filter="brightness(.94)";g.drawImage(image,art[1],art[2],art[3],art[4],0,0,art[3],art[4]);canvas=c;}
    }catch{canvas=null}
    dimmedCoverCrops.set(key,{image,canvas});return canvas;
  };
  CommonCombatRunner.prototype.drawSquadCoverBase=function(ctx){
    const now=this.__afCoverClock||0;
    for(const player of this.players){
      if(!player||player.member.hp<=0)continue;
      const hp=player.__afCoverHP??COVER_FX.maxHp;
      if(hp<=0){
        const b=player.__afCoverBreak;if(!b)continue;const age=now-b.t;
        if(age<COVER_FX.breakSeconds)drawCoverBreak(this,ctx,player,age);else player.__afCoverGone=true;
        continue;
      }
      const r=this.squadCoverRect(player),hitAge=now-(player.__afCoverHitAt??-9),shake=hitAge<COVER_FX.hitShake?Math.sin(hitAge*95)*3.2*(1-hitAge/COVER_FX.hitShake):0;
      ctx.save();ctx.fillStyle=`rgba(0,5,10,${SQUAD_COVER.shadow})`;ctx.beginPath();ctx.ellipse(r.x,r.bottom-2,r.w*.5,Math.max(5,r.body*.05),0,0,Math.PI*2);ctx.fill();ctx.restore();
      const image=combatPropImage(r.art[0]);if(!image)continue;
      const dimmed=dimmedCoverCrop(image,r.art);
      ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
      if(dimmed)ctx.drawImage(dimmed,0,0,dimmed.width,dimmed.height,r.left+shake,r.top+Math.abs(shake)*.35,r.w,r.h);
      else{ctx.filter="brightness(.94)";ctx.drawImage(image,r.art[1],r.art[2],r.art[3],r.art[4],r.left+shake,r.top+Math.abs(shake)*.35,r.w,r.h);}
      ctx.restore();
      if(hitAge<.4){
        // Small dust puff from the top of the wall.
        const k=hitAge/.4,a=.34*(1-k);ctx.save();
        for(let i=0;i<3;i++){const x=r.x+(i-1)*r.w*.22,y=r.topIntact+r.h*.12-r.body*.12*k,rad=r.h*(.12+.2*k);const g=ctx.createRadialGradient(x,y,0,x,y,rad);g.addColorStop(0,`rgba(110,104,94,${a})`);g.addColorStop(1,"rgba(80,80,80,0)");ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,rad,0,Math.PI*2);ctx.fill();}
        ctx.restore();
      }
      this.qa.coverPanelsDrawn=(this.qa.coverPanelsDrawn||0)+1;
    }
  };
  CommonCombatRunner.prototype.drawSquadCover=function(ctx){
    // Late pass: the cover HP bar on the top edge of every standing wall.
    const now=this.__afCoverClock||0;
    for(const player of this.players){
      if(!player||player.member.hp<=0)continue;
      const hp=clamp(player.__afCoverHP??COVER_FX.maxHp,0,COVER_FX.maxHp);if(hp<=0)continue;
      const r=this.squadCoverRect(player),ratio=hp/COVER_FX.maxHp,trail=clamp(player.__afCoverTrailHP??hp,hp,COVER_FX.maxHp)/COVER_FX.maxHp,
        w=r.w*.56,h=Math.max(3,r.body*.026),left=r.x-w/2,y=r.topIntact-h*.5,active=Boolean(player.coverRequested),hit=now-(player.__afCoverHitAt??-9)<.18;
      ctx.save();ctx.globalAlpha=active||hit?1:.82;
      ctx.fillStyle="rgba(3,9,14,.8)";ctx.fillRect(left-1.5,y-1.5,w+3,h+3);
      ctx.fillStyle="rgba(255,244,226,.9)";ctx.fillRect(left,y,w*trail,h);
      ctx.fillStyle=ratio>.6?"#5fe0ee":ratio>.3?"#f1b54c":"#ff5f5a";ctx.fillRect(left,y,w*ratio,h);
      ctx.fillStyle="rgba(3,9,14,.85)";for(let i=1;i<5;i++)ctx.fillRect(left+w*i/5-.6,y,1.2,h);
      // Small shield mark at the left end.
      const sx=left-h*2.2,sy=y+h/2,sz=h*1.5;ctx.fillStyle=ratio>.6?"#5fe0ee":ratio>.3?"#f1b54c":"#ff5f5a";ctx.strokeStyle="rgba(3,9,14,.9)";ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(sx,sy-sz);ctx.lineTo(sx+sz*.85,sy-sz*.55);ctx.lineTo(sx+sz*.6,sy+sz*.6);ctx.lineTo(sx,sy+sz);ctx.lineTo(sx-sz*.6,sy+sz*.6);ctx.lineTo(sx-sz*.85,sy-sz*.55);ctx.closePath();ctx.fill();ctx.stroke();
      if(active){ctx.strokeStyle="rgba(120,236,248,.75)";ctx.lineWidth=1;ctx.strokeRect(left-2.5,y-2.5,w+5,h+5);}
      ctx.restore();
    }
  };
  // <<< COMBAT_COVER_HP_BREAK_V1
  // >>> COMBAT_FOCUS_VIEW_V1 (2026-09-25, Claude Code; combat_reboot_v1/game_bake_v1/tools/runtime_patches/combat_focus_view_v1.py)
  // NIKKE-style close squad view: the selected unit is large at the bottom centre, the next unit on each side is cut by
  // the screen edge, the rest wait just off-screen inside the field. A clear reticle carries the magazine count.
  // Landscape orbit camera only. ?focus=classic restores the whole-squad view, the ring reticle and the wide cards.
  const FOCUS_VIEW=Object.freeze({scale:1.6,neighbor:.9,far:.45,feet:.985,guideGap:40,guideAlpha:.34,lowAmmo:.2});
  const focusClassic=(()=>{const off=value=>/(?:[?&])focus=classic(?:&|$)/.test(String(value||""));try{if(off(location.search))return true;}catch{}try{if(off(window.top.location.search))return true;}catch{}return false;})();
  const focusActive=runner=>hudEnabled&&!focusClassic&&runner.cameraState?.().active===true;
  const FOCUS_RET=Object.freeze({line:"#ffd84d",lock:"#ff4a5c",reload:"#ffb347",dark:"rgba(3,5,11,.82)",font:"Bahnschrift,'DIN Alternate','Roboto Condensed','Arial Narrow',ui-monospace,sans-serif"});
  CommonCombatRunner.prototype.focusVisibleRows=function(){
    // Visible canvas rows (the fullscreen cover crops top/bottom on screens wider than 16:9).
    const now=performance.now(),cache=this.__afFocusRows;if(cache&&now-cache.at<500)return cache.rows;let rows={top:0,bottom:this.height};
    try{const rect=this.canvas.getBoundingClientRect(),scale=rect.height/this.height;if(scale>0)rows={top:Math.max(0,-rect.top/scale),bottom:Math.min(this.height,(innerHeight-rect.top)/scale)};}catch{}
    if(!(rows.bottom-rows.top>40))rows={top:0,bottom:this.height};this.__afFocusRows={at:now,rows};return rows;
  };
  CommonCombatRunner.prototype.focusSquadLayout=function(){
    const c=this.cameraState(),squad=this.players.filter(player=>player&&Number.isFinite(player.__afCamStation)).sort((a,b)=>a.__afCamStation-b.__afCamStation);
    if(!squad.length)return;
    // Fractional squad index of the camera: the selected unit's index at rest, between two units during a switch glide.
    const stations=squad.map(player=>player.__afCamStation),last=stations.length-1;let at=0;
    if(c.x>=stations[last])at=last;else if(c.x>stations[0])for(let k=0;k<last;k++){if(c.x<=stations[k+1]){at=k+(c.x-stations[k])/Math.max(1e-6,stations[k+1]-stations[k]);break;}}
    const half=c.hs/c.z,near=FOCUS_VIEW.neighbor*half,far=FOCUS_VIEW.far*half,rows=this.focusVisibleRows(),feetScreen=rows.top+(rows.bottom-rows.top)*FOCUS_VIEW.feet,feetY=c.y0+(feetScreen-c.y0)/c.z,scale=PLAYER_PRESENTATION_LANDSCAPE*FOCUS_VIEW.scale;
    squad.forEach((player,k)=>{const d=k-at,a=Math.abs(d),offset=Math.sign(d)*(a<=1?a*near:near+(a-1)*far);player.x=c.x+offset;player.y=feetY;player.presentationScale=scale;});
  };
  const focusCameraStep=CommonCombatRunner.prototype.cameraStep;
  CommonCombatRunner.prototype.cameraStep=function(dt){
    const c=focusCameraStep.call(this,dt),on=focusActive(this);
    try{
      if(on)this.focusSquadLayout();
      const flag=on?"v1":"off";if(this.hud&&this.hud.dataset.afFocus!==flag)this.hud.dataset.afFocus=flag;if(this.actions&&this.actions.dataset.afFocus!==flag)this.actions.dataset.afFocus=flag;
      if(this.body&&this.body.dataset.afFocusView!==flag)this.body.dataset.afFocusView=flag;
    }catch(error){this.qa.focusViewErrors=(this.qa.focusViewErrors||0)+1;}
    return c;
  };
  const focusDamage=CommonCombatRunner.prototype.damage;
  CommonCombatRunner.prototype.damage=function(enemy,amount,spec,owner=null,...rest){
    // Hit mark for the reticle: the selected unit's own hits only.
    if(owner&&owner===this.selected?.())owner.__afFocusHit={at:performance.now(),heavy:amount>=40};
    return focusDamage.call(this,enemy,amount,spec,owner,...rest);
  };
  CommonCombatRunner.prototype.focusAimOnEnemy=function(aim){
    for(const enemy of this.enemies){
      if(enemy.alive===false||!(enemy.hp>0))continue;
      const m=enemyVisualMetrics(this,enemy),rx=Math.max(enemy.radius||0,m.drawWidth*.38),ry=Math.max(enemy.radius||0,m.drawHeight*.43),dx=(aim.x-m.centerX)/rx,dy=(aim.y-m.centerY)/ry;
      if(dx*dx+dy*dy<=1)return true;
    }
    return false;
  };
  const focusReticle=CommonCombatRunner.prototype.drawAimReticle;
  CommonCombatRunner.prototype.drawAimReticle=function(ctx,...args){
    if(!focusActive(this))return focusReticle.call(this,ctx,...args);
    if(!this.running||this.terminalPaused)return;const player=this.selected?.();if(!player||player.member?.hp<=0)return;
    const aim=player.smoothedAim||this.pointer;if(!aim||!Number.isFinite(aim.x)||!Number.isFinite(aim.y))return;
    const now=performance.now(),{x,y}=this.cameraToScreen(aim),view=this.hudVisibleRange(),rows=this.focusVisibleRows(),auto=Boolean(this.isAutoControlled?.(player)),cover=Boolean(player.coverRequested),
      ammo=Math.max(0,Math.round(player.ammo??0)),mag=Math.max(1,player.magazineSize||1),reloadClock=player.reloadClock||0,reloading=reloadClock>0,
      low=!reloading&&ammo<=Math.max(1,Math.ceil(mag*FOCUS_VIEW.lowAmmo)),empty=!reloading&&ammo<=0,lock=!cover&&this.focusAimOnEnemy(aim),blink=Math.sin(now/95)>0;
    if(reloading){if(!(player.__afReloadTotal>=reloadClock))player.__afReloadTotal=reloadClock;}else player.__afReloadTotal=0;
    if(player.__afFocusAmmo!=null&&ammo<player.__afFocusAmmo)player.__afFocusKickAt=now;player.__afFocusAmmo=ammo;
    const kick=Math.exp(-Math.max(0,now-(player.__afFocusKickAt||-1e9))/70),alpha=cover?.45:auto?.72:1,main=lock?FOCUS_RET.lock:FOCUS_RET.line,F=FOCUS_RET.font;
    const stroke=(color,width,path)=>{ctx.lineWidth=width+2.4;ctx.strokeStyle=FOCUS_RET.dark;ctx.beginPath();path();ctx.stroke();ctx.lineWidth=width;ctx.strokeStyle=color;ctx.beginPath();path();ctx.stroke();};
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.lineCap="butt";ctx.lineJoin="miter";
    // Guide lines across the whole view, with a gap at the aim.
    const gap=FOCUS_VIEW.guideGap;ctx.globalAlpha=FOCUS_VIEW.guideAlpha*(auto?.5:1)*(cover?.5:1);ctx.strokeStyle=main;ctx.lineWidth=1;ctx.beginPath();
    ctx.moveTo(view[0],y+.5);ctx.lineTo(x-gap,y+.5);ctx.moveTo(x+gap,y+.5);ctx.lineTo(view[1],y+.5);ctx.moveTo(x+.5,rows.top);ctx.lineTo(x+.5,y-gap);ctx.moveTo(x+.5,y+gap);ctx.lineTo(x+.5,rows.bottom);ctx.stroke();
    ctx.globalAlpha=alpha;
    // Brackets: close in and turn red over an enemy, kick outward on each shot.
    const bx=(lock?21:27)+kick*7,bh=lock?15:17,arm=7;
    stroke(main,2.4,()=>{for(const side of [-1,1]){const ex=x+side*bx;ctx.moveTo(ex-side*arm,y-bh);ctx.lineTo(ex,y-bh);ctx.lineTo(ex,y+bh);ctx.lineTo(ex-side*arm,y+bh);}});
    // Centre cross and dot.
    stroke(main,2,()=>{for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ctx.moveTo(x+dx*5,y+dy*5);ctx.lineTo(x+dx*11,y+dy*11);}});
    ctx.fillStyle="#ffffff";ctx.beginPath();ctx.arc(x,y,1.9,0,Math.PI*2);ctx.fill();
    // Hit mark.
    const hit=player.__afFocusHit,hitAge=hit?now-hit.at:1e9;
    if(hitAge<170){const f=1-hitAge/170,r0=8+4*(1-f),r1=r0+(hit.heavy?10:7);ctx.globalAlpha=alpha*f;stroke(hit.heavy?"#ff6a4d":"#ffffff",2.2,()=>{for(const [dx,dy] of [[1,1],[1,-1],[-1,1],[-1,-1]]){ctx.moveTo(x+dx*r0*.707,y+dy*r0*.707);ctx.lineTo(x+dx*r1*.707,y+dy*r1*.707);}});ctx.globalAlpha=alpha;}
    // Charge / spin-up gauge on the right.
    const profile=this.triggerProfile?.(player),clock=profile?.mode==="charge"?(player.__afChargeClock||0):profile?.mode==="spinup"?(player.__afSpinClock||0):0;
    if(clock>0&&profile.full>0){const ratio=clamp(clock/profile.full,0,1),r=bx+9,a0=-Math.PI*.3,a1=Math.PI*.3,full=ratio>=1;
      ctx.lineWidth=5;ctx.strokeStyle=FOCUS_RET.dark;ctx.beginPath();ctx.arc(x,y,r,a0,a1);ctx.stroke();
      ctx.lineWidth=3;ctx.strokeStyle=full?"#ffffff":main;ctx.beginPath();ctx.arc(x,y,r,a1-(a1-a0)*ratio,a1);ctx.stroke();
      const label=full?"MAX":`${Math.round(ratio*100)}%`;ctx.font=`800 13px ${F}`;ctx.textAlign="left";ctx.textBaseline="middle";ctx.lineWidth=3;ctx.strokeStyle=FOCUS_RET.dark;ctx.strokeText(label,x+r+8,y);ctx.fillStyle=full&&blink?"#ffffff":main;ctx.fillText(label,x+r+8,y);}
    // Magazine box on the left: 3-digit count, /magazine and a round bar; RELOAD with progress while reloading.
    const bw=80,bhgt=32,right=x-bx-12,left=right-bw,top=y-bhgt/2,cut=7,warn=reloading?FOCUS_RET.reload:(low?FOCUS_RET.lock:main);
    ctx.beginPath();ctx.moveTo(left+cut,top);ctx.lineTo(right,top);ctx.lineTo(right,top+bhgt-cut);ctx.lineTo(right-cut,top+bhgt);ctx.lineTo(left,top+bhgt);ctx.lineTo(left,top+cut);ctx.closePath();
    ctx.fillStyle=FOCUS_RET.dark;ctx.fill();ctx.lineWidth=1.6;ctx.strokeStyle=warn;if(!((low||reloading)&&!blink))ctx.stroke();
    const barY=top-6,barW=bw,filled=reloading?1-reloadClock/Math.max(.05,player.__afReloadTotal||reloadClock):ammo/mag;
    ctx.fillStyle=FOCUS_RET.dark;ctx.fillRect(left-1,barY-1,barW+2,5);
    if(!reloading&&mag<=40){const segGap=mag>20?1:2,seg=(barW-segGap*(mag-1))/mag;for(let i=0;i<mag;i++){ctx.fillStyle=i<ammo?warn:"rgba(255,255,255,.16)";ctx.fillRect(left+i*(seg+segGap),barY,Math.max(1,seg),3);}}
    else{ctx.fillStyle="rgba(255,255,255,.16)";ctx.fillRect(left,barY,barW,3);ctx.fillStyle=warn;ctx.fillRect(left,barY,barW*clamp(filled,0,1),3);}
    ctx.textBaseline="middle";
    if(reloading){ctx.font=`800 13px ${F}`;ctx.textAlign="center";ctx.fillStyle=FOCUS_RET.reload;ctx.fillText("RELOAD",left+bw/2,y+1);}
    else{ctx.font=`700 23px ${F}`;ctx.textAlign="left";ctx.fillStyle=low?(empty&&!blink?"#ff9aa4":FOCUS_RET.lock):"#ffffff";ctx.fillText(String(ammo).padStart(3,"0"),left+7,y+1);
      ctx.font=`700 10px ${F}`;ctx.textAlign="right";ctx.fillStyle="rgba(230,240,255,.62)";ctx.fillText(`/${mag}`,right-5,y+7);}
    // State tags under the box.
    const tag=cover?"COVER":auto?"AUTO":empty?"HOLD ▸ RELOAD":"";
    if(tag){ctx.font=`800 9px ${F}`;ctx.textAlign="right";ctx.textBaseline="top";ctx.lineWidth=3;ctx.strokeStyle=FOCUS_RET.dark;ctx.strokeText(tag,right,top+bhgt+4);ctx.fillStyle=cover?"#9fe8ff":empty?FOCUS_RET.lock:"#ffe9a6";ctx.fillText(tag,right,top+bhgt+4);}
    ctx.restore();
  };
  const focusCoverBar=CommonCombatRunner.prototype.drawSquadCover;
  CommonCombatRunner.prototype.drawSquadCover=function(ctx){
    if(!focusActive(this))return focusCoverBar.call(this,ctx);
    // Close view: the wide bar would lie across the large unit's back. Draw a short bar on the end of the wall that
    // faces the screen centre (the left end for the selected unit), so the edge-cut neighbours keep theirs on screen.
    const now=this.__afCoverClock||0,cx=this.cameraState().x;
    for(const player of this.players){
      if(!player||player.member.hp<=0)continue;
      const hp=clamp(player.__afCoverHP??COVER_FX.maxHp,0,COVER_FX.maxHp);if(hp<=0)continue;
      const r=this.squadCoverRect(player),ratio=hp/COVER_FX.maxHp,trail=clamp(player.__afCoverTrailHP??hp,hp,COVER_FX.maxHp)/COVER_FX.maxHp,
        h=clamp(r.body*.016,3,5),w=r.w*.22,toRight=player.x<cx-1,left=toRight?r.right-r.w*.08-w:r.left+r.w*.08,y=r.topIntact-h*.5,
        active=Boolean(player.coverRequested),hit=now-(player.__afCoverHitAt??-9)<.18,color=ratio>.6?"#5fe0ee":ratio>.3?"#f1b54c":"#ff5f5a";
      ctx.save();ctx.globalAlpha=active||hit?1:.86;
      ctx.fillStyle="rgba(3,9,14,.8)";ctx.fillRect(left-1.5,y-1.5,w+3,h+3);
      ctx.fillStyle="rgba(255,244,226,.9)";ctx.fillRect(left,y,w*trail,h);
      ctx.fillStyle=color;ctx.fillRect(left,y,w*ratio,h);
      ctx.fillStyle="rgba(3,9,14,.85)";for(let i=1;i<5;i++)ctx.fillRect(left+w*i/5-.6,y,1.2,h);
      const sx=toRight?left+w+h*2.2:left-h*2.2,sy=y+h/2,sz=h*1.5;ctx.fillStyle=color;ctx.strokeStyle="rgba(3,9,14,.9)";ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(sx,sy-sz);ctx.lineTo(sx+sz*.85,sy-sz*.55);ctx.lineTo(sx+sz*.6,sy+sz*.6);ctx.lineTo(sx,sy+sz);ctx.lineTo(sx-sz*.6,sy+sz*.6);ctx.lineTo(sx-sz*.85,sy-sz*.55);ctx.closePath();ctx.fill();ctx.stroke();
      if(active){ctx.strokeStyle="rgba(120,236,248,.75)";ctx.lineWidth=1;ctx.strokeRect(left-2.5,y-2.5,w+5,h+5);}
      ctx.restore();
    }
  };
  // Compact squad cards at the bottom centre (CSS only; keyed on data-af-focus="v1", set by the camera step).
  const FOCUS_P='#af-common-party[data-af-hud="nikke-v1"][data-af-focus="v1"]';
  const focusStyle=document.createElement("style");focusStyle.id="af-focus-view-v1";
  focusStyle.textContent=`${FOCUS_P}{left:50%!important;right:auto!important;width:min(660px,54vw)!important;transform:translateX(-50%)!important;gap:6px!important}
${FOCUS_P} button{height:112px!important;clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px))}
${FOCUS_P} button.active{transform:translateY(-10px)}
${FOCUS_P} .af-portrait-frame{width:100%!important;clip-path:none}
${FOCUS_P} .af-portrait-frame>img{object-position:50% 16%}
${FOCUS_P} .af-portrait-frame::after{background:linear-gradient(180deg,rgba(4,7,14,.7) 0,transparent 24%,transparent 44%,rgba(4,7,14,.95) 82%)}
${FOCUS_P} small,${FOCUS_P} .af-hp-text{display:none!important}
${FOCUS_P} b{left:7px;right:6px;top:auto;bottom:21px;font-size:12px!important}
${FOCUS_P} .af-bars{left:6px!important;right:6px!important;bottom:13px!important;height:6px!important;grid-template-columns:minmax(18px,1fr)!important;gap:0!important}
${FOCUS_P} .af-hp{height:5px!important}
${FOCUS_P} .af-bullets{left:6px!important;right:6px!important;bottom:5px!important;height:3px!important;gap:1px!important}
${FOCUS_P} .af-burst{width:24px;height:24px;right:4px;top:4px}
${FOCUS_P} .af-burst>em{display:none}
${FOCUS_P} .af-slotno{display:none}
${FOCUS_P} button::before{content:attr(data-af-ammo-key);position:absolute;left:6px;top:6px;z-index:7;padding:2px 5px 2px 4px;font:800 11px/1 var(--af-font);letter-spacing:.02em;color:#fff;background:rgba(3,6,12,.72);box-shadow:inset 2px 0 0 var(--af-c);pointer-events:none}
${FOCUS_P} button.reloading::before{content:"RELOAD";color:#ffcf8a;box-shadow:inset 2px 0 0 #ffb347}
${FOCUS_P} button[data-af-state="COVER"] .af-tag{left:auto!important;right:4px!important;top:32px!important}
${FOCUS_P} button[data-af-state="RELOAD"] .af-tag{display:none}
@media (max-height:500px) and (orientation:landscape){
${FOCUS_P}{width:min(430px,50vw)!important;gap:4px!important}
${FOCUS_P} button{height:74px!important;clip-path:polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,8px 100%,0 calc(100% - 8px))}
${FOCUS_P} button.active{transform:translateY(-6px)}
${FOCUS_P} b{left:4px;right:3px;bottom:15px;font-size:9px!important}
${FOCUS_P} .af-bars{left:4px!important;right:4px!important;bottom:9px!important;height:4px!important}
${FOCUS_P} .af-hp{height:4px!important}
${FOCUS_P} .af-bullets{left:4px!important;right:4px!important;bottom:3px!important;height:2px!important}
${FOCUS_P} .af-burst{width:16px;height:16px;right:3px;top:3px}
${FOCUS_P} button::before{left:3px;top:3px;padding:1px 3px;font-size:8px}
${FOCUS_P} button[data-af-state="COVER"] .af-tag{top:20px!important}}`;
  if(hudEnabled&&!focusClassic)document.head.append(focusStyle);
  // <<< COMBAT_FOCUS_VIEW_V1
  // >>> COMBAT_CUTIN_RIBBON_V1 (2026-09-25, Claude Code; combat_reboot_v1/game_bake_v1/tools/runtime_patches/combat_cutin_ribbon_v1.py)
  // The skill cut-in is a slim translucent ribbon on the lower left instead of a dark card over the battlefield.
  // Battle HUD only. ?cutin=classic (or ?vfx=classic) restores the card.
  const cutinClassic=(()=>{const off=value=>/(?:[?&])cutin=classic(?:&|$)/.test(String(value||""));try{if(off(location.search))return true;}catch{}try{if(off(window.top.location.search))return true;}catch{}return false;})();
  // Headless QA harnesses load the runtime with a minimal document that has no root element: skip there.
  if(hudEnabled&&!cutinClassic&&document.documentElement?.dataset&&document.head){
    document.documentElement.dataset.afCutin="ribbon";
    const R='html[data-af-cutin="ribbon"] :is(#cutin,#ultimateCutin,.ultimate-cutin)';
    const ribbonStyle=document.createElement("style");ribbonStyle.id="af-cutin-ribbon-v1";
    ribbonStyle.textContent=`${R}{inset:auto auto max(19vh,142px) 0!important;width:min(430px,36vw)!important;height:clamp(84px,14vh,118px)!important;min-height:0!important;border:0!important;border-radius:0!important;
background:linear-gradient(90deg,rgba(4,8,18,.74) 0,rgba(4,8,18,.56) 46%,rgba(4,8,18,0) 100%)!important;box-shadow:none!important;
clip-path:polygon(0 0,100% 0,calc(100% - 26px) 100%,0 100%)!important;overflow:hidden!important;pointer-events:none!important}
${R}.show{animation:afCutinRibbon .56s cubic-bezier(.2,.8,.25,1) both!important}
${R}::before,${R}.af-epic::before{content:""!important;position:absolute!important;inset:0!important;z-index:1!important;pointer-events:none!important;animation:none!important;
background:linear-gradient(90deg,var(--af-epic-a,#fff0ac),transparent 72%) top/100% 2px no-repeat,linear-gradient(90deg,var(--af-epic-a,#fff0ac),transparent 60%) bottom/100% 1px no-repeat,
repeating-linear-gradient(104deg,transparent 0 26px,var(--af-epic-line,rgba(255,255,255,.12)) 26px 27px)!important;opacity:.7!important;
-webkit-mask-image:linear-gradient(90deg,#000 40%,transparent);mask-image:linear-gradient(90deg,#000 40%,transparent)}
${R}.af-epic{box-shadow:none!important}
${R} img{left:0!important;top:0!important;bottom:auto!important;width:40%!important;height:270%!important;max-height:none!important;object-fit:cover!important;object-position:50% 0!important;
filter:none!important;transform:none!important;clip-path:none!important;-webkit-mask-image:linear-gradient(90deg,#000 62%,transparent);mask-image:linear-gradient(90deg,#000 62%,transparent)}
${R}[data-af-standing-cutin="false"] img{top:-12%!important;height:230%!important}
${R} div{left:36%!important;right:30px!important;top:50%!important;transform:translateY(-50%)!important;font-size:clamp(9px,.85vw,11px)!important;line-height:1.3!important;text-shadow:0 1px 3px #000,0 0 10px rgba(0,0,0,.8)!important;white-space:nowrap!important}
${R} small{font:800 clamp(8px,.72vw,10px)/1 var(--af-font,ui-monospace)!important;letter-spacing:.18em!important;color:var(--af-epic-a,#ffd77e)!important}
${R} b{margin-top:4px!important;font-size:clamp(17px,1.9vw,25px)!important;line-height:1.1!important;overflow:hidden!important;text-overflow:ellipsis!important}
${R} span{margin-top:4px!important;opacity:.82!important;overflow:hidden!important;text-overflow:ellipsis!important}
@keyframes afCutinRibbon{0%{opacity:0;transform:translateX(-36px)}16%,76%{opacity:1;transform:none}100%{opacity:0;transform:translateX(6px)}}
@media (orientation:landscape) and (max-height:500px){
${R}{bottom:96px!important;width:min(300px,40vw)!important;height:64px!important}
${R} span{display:none!important}
${R} b{font-size:15px!important}}
@media (orientation:portrait){
${R}{bottom:max(19vh,150px)!important;width:82vw!important;height:66px!important}
${R} span{display:none!important}
${R} b{font-size:16px!important}
${R} small{font-size:8px!important}}`;
    document.head.append(ribbonStyle);
  }
  // <<< COMBAT_CUTIN_RIBBON_V1
  // >>> COMBAT_CUTIN_PRELOAD_V1 (2026-09-25, Claude Code; combat_reboot_v1/game_bake_v1/tools/runtime_patches/combat_cutin_preload_v1.py)
  // Decode every squad member's standing cut-in art ahead of time, so a first burst does not show the previous unit's art.
  const cutinPreloadUpdate=CommonCombatRunner.prototype.update;
  CommonCombatRunner.prototype.update=function(dt){
    const result=cutinPreloadUpdate.apply(this,arguments);
    // Headless QA harnesses have no Image constructor: skip there.
    if(typeof Image==="function"){try{
      const preload=this.__afCutinPreload||(this.__afCutinPreload=new Map());
      for(const player of this.players||[]){const src=player?.spec?.ultimateCutin;if(typeof src!=="string"||!src||preload.has(src))continue;
        const img=new Image();img.decoding="async";img.src=src;preload.set(src,img);img.decode?.().catch(()=>{});}
    }catch{}}
    return result;
  };
  // <<< COMBAT_CUTIN_PRELOAD_V1
  // >>> COMBAT_LAST_HIT_V1 (2026-09-26, Claude Code; combat_reboot_v1/game_bake_v1/tools/runtime_patches/combat_last_hit_v1.py)
  // The reward screen shows the standing art of the squad member who landed the winning (last) kill.
  const lastHitDamage=CommonCombatRunner.prototype.damage;
  CommonCombatRunner.prototype.damage=function(enemy,amount,spec,owner){
    const wasAlive=Boolean(enemy)&&enemy.alive!==false;
    const result=lastHitDamage.apply(this,arguments);
    const id=owner?.spec?.id;
    if(typeof id==="string"&&id){this.__afLastDamageById=id;if(wasAlive&&enemy.alive===false)this.__afLastHitId=id;}
    return result;
  };
  const lastHitCommitReward=CommonCombatRunner.prototype.commitReward;
  CommonCombatRunner.prototype.commitReward=function(){
    const committed=lastHitCommitReward.apply(this,arguments);
    if(committed){try{
      const lastHitId=this.__afLastHitId||this.__afLastDamageById||null;
      const record={schemaVersion:1,stageId:this.stageId,transactionId:`${this.stageId}:${this.session?.objective?.progress}`,lastHitId,source:this.__afLastHitId?"final-kill":lastHitId?"last-damage":"none",at:Date.now()};
      if(this.qa)this.qa.lastHit=record;
      globalThis.localStorage?.setItem("aftersignal:last-battle:v1",JSON.stringify(record));
    }catch{}}
    return committed;
  };
  // <<< COMBAT_LAST_HIT_V1
  // >>> COMBAT_HIRES_CANVAS_V1 (2026-10-01, Claude Code; combat_reboot_v1/game_bake_v1/tools/runtime_patches/combat_hires_canvas_v1.py)
  // The battle canvas was a fixed 1280x720 bitmap stretched by CSS (x1.5 on 1920x1080, x2 on 2560x1440, more in the focus view).
  // The game keeps its 1280x720 logical coordinates; the bitmap now follows the canvas' real on-screen size in device pixels.
  const HiRes=(()=>{
    const STEP=.25,MIN_K=1,START_K=1.5,SESSION_KEY="aftersignal:hires-cap:v1",OK_KEY="aftersignal:hires-ok:v1";
    const maxK=(()=>{try{const memory=Number(navigator.deviceMemory||0);return memory>0&&memory<=4?1.5:2}catch{return 2}})();
    const queryValue=(()=>{const find=value=>{const m=/(?:[?&])res=([^&#]*)/.exec(String(value||""));return m?decodeURIComponent(m[1]):null};let v=null;try{v=find(location.search)}catch{}if(v==null){try{v=find(window.top.location.search)}catch{}}return v})();
    const forced=queryValue==null?null:queryValue==="classic"?1:Number(queryValue)>0?Math.max(MIN_K,Math.min(3,Math.round(Number(queryValue)/STEP)*STEP)):null;
    const coarse=()=>{try{return matchMedia("(pointer: coarse)").matches}catch{return true}};
    const sessionNumber=(key,fallback)=>{try{const v=Number(sessionStorage.getItem(key));return v>=MIN_K&&v<=maxK?v:fallback}catch{return fallback}};
    const remember=(key,value)=>{try{sessionStorage.setItem(key,String(value))}catch{}};
    const quantize=raw=>Math.max(MIN_K,Math.round(raw/STEP)*STEP);
    const target=(runner,st)=>{
      if(forced!=null)return forced;
      if(st.coarse)return 1;
      const rect=runner.canvas.getBoundingClientRect(),dpr=Math.max(1,Number(window.devicePixelRatio)||1);
      if(!(rect.width>0))return st.k;
      st.raw=quantize(rect.width*dpr/st.lw);
      return Math.min(st.cap,st.ceil,st.raw);
    };
    const install=runner=>{
      if(runner.__afHires)return runner.__afHires;
      const ctx=runner.ctx,P=typeof CanvasRenderingContext2D==="function"?CanvasRenderingContext2D.prototype:null;
      if(!ctx||!P||typeof P.setTransform!=="function"||!runner.canvas)return null;
      // a runner built later on the same canvas must not take the enlarged bitmap for the logical size
      const logical=runner.canvas.__afLogicalSize||(runner.canvas.__afLogicalSize=[runner.width,runner.height]);runner.width=logical[0];runner.height=logical[1];
      // cap = hard limit (lowered by the governor, kept for the session); ceil = what the screen may use right now: a big screen starts at
      // START_K (or the level this session already proved) and climbs to its own scale only while the frames stay smooth.
      const cap=sessionNumber(SESSION_KEY,maxK),okK=Math.min(cap,Math.max(START_K,sessionNumber(OK_KEY,START_K)));
      const st={k:1,cap,ceil:okK,okK,raw:1,maxK,lw:logical[0],lh:logical[1],mode:forced!=null?"query":"auto",coarse:coarse(),downshifts:0,upshifts:0,climbsFailed:0,good:0,lastTrial:null,probe:null,applied:false,nextCheck:0,set:P.setTransform,win:null};
      const set=st.set;
      // setTransform(1,0,0,1,0,0) used to mean "device pixels" and, with a 1:1 bitmap, "logical pixels"; it keeps meaning the latter.
      ctx.setTransform=function(a,b,c,d,e,f){const k=st.k;if(a&&typeof a==="object")return set.call(this,(a.a??1)*k,(a.b??0)*k,(a.c??0)*k,(a.d??1)*k,(a.e??0)*k,(a.f??0)*k);return set.call(this,a*k,b*k,c*k,d*k,e*k,f*k);};
      ctx.resetTransform=function(){return set.call(this,st.k,0,0,st.k,0,0);};
      // Canvas keeps shadow blur/offset in bitmap pixels (not transformed): scale them with k so glows look as before.
      for(const name of["shadowBlur","shadowOffsetX","shadowOffsetY"]){const d=Object.getOwnPropertyDescriptor(P,name);if(d?.get&&d?.set)Object.defineProperty(ctx,name,{configurable:true,enumerable:true,get(){return d.get.call(this)/st.k},set(v){d.set.call(this,Number(v)*st.k)}});}
      runner.__afHires=st;return st;
    };
    const apply=(runner,st,k)=>{
      const canvas=runner.canvas,ctx=runner.ctx,w=Math.round(st.lw*k),h=Math.round(st.lh*k);
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
      if(st.k!==k){if(runner.__afHiBg){try{runner.__afHiBg.width=runner.__afHiBg.height=1}catch{}runner.__afHiBg=null;}runner.__afUltimateCompositeCanvas=null;st.win=null;st.good=0;}
      st.k=k;st.applied=true;
      st.set.call(ctx,k,0,0,k,0,0);
      try{ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality=k>1?"high":"low"}catch{}
      ctx.__afHiresK=k;
      runner.__afHiresSpriteMul=k>=1.25?512/384:1;
      runner.__afHiresEnemyMul=Math.max(1,k/1.5);
      runner.__afHiresUltSurface=Math.round(512*Math.min(Math.max(k,1),2));
      if(runner.qa)runner.qa.hires={k,logical:[st.lw,st.lh],bitmap:[w,h],cap:st.cap,ceil:st.ceil,mode:st.mode,downshifts:st.downshifts,upshifts:st.upshifts,climbsFailed:st.climbsFailed,coarse:st.coarse};
      try{runner.body.dataset.afHires=String(k)}catch{}
    };
    const prepare=(runner,st)=>{
      const now=performance.now();
      if(!st.applied||now>=st.nextCheck){st.nextCheck=now+400;const k=target(runner,st);if(!st.applied||k!==st.k){apply(runner,st,k);return;}}
      st.set.call(runner.ctx,st.k,0,0,st.k,0,0);
    };
    // Governor. Rolling windows like the touch profile's (PERF FIX 2026-09-23), but the remedy is a lower bitmap scale, not a lower frame
    // rate. Two slow windows lower the cap by one step. A screen bigger than START_K climbs one step after three smooth windows; the climb is
    // on trial for two windows, and one slow window sends it back and locks the level it came from for the session.
    // The trial is NOT a comparison with the windows before it: the scene decides the interval far more than the scale does (measured 2026-10-01:
    // quiet and VFX-heavy 3 s windows of one fight differ by up to 10 ms of mean callback interval, and the 10 ms vs 20 ms p75 of a 100 Hz
    // display flips with them), so a comparison would only measure the scene, and the first version of this trial rejected good climbs at random.
    const judge=(runner,st,now,cost)=>{
      const active=runner.running&&!runner.completed&&!runner.terminalPaused&&!document.hidden;
      let w=st.win;
      if(!active||!w||now-w.last>500){st.win=active?{last:now,windowStart:now+2000,costs:[],gaps:[],slow:w?.slow||0,windows:w?.windows||0}:null;return;}
      const gap=now-w.last;w.last=now;
      if(now<w.windowStart)return;
      if(gap>0)w.gaps.push(gap);if(cost>.5)w.costs.push(cost);
      if(now-w.windowStart<3000||w.gaps.length<30)return;
      const sorted=w.gaps.slice().sort((p,q)=>p-q),costs=w.costs.slice().sort((p,q)=>p-q);
      const gapP75=sorted[Math.floor(sorted.length*.75)],longShare=sorted.filter(g=>g>34).length/sorted.length,medianCost=costs.length?costs[Math.floor(costs.length*.5)]:0;
      const meanGap=sorted.reduce((p,q)=>p+q,0)/sorted.length;
      const slowWindow=gapP75>22||longShare>=.12||medianCost>12;w.windows++;
      const restart=()=>{st.nextCheck=0;st.win=null;};
      const lock=level=>{st.cap=Math.max(MIN_K,Math.min(st.cap,level));st.ceil=Math.min(st.ceil,st.cap);st.okK=Math.min(st.okK,st.cap);remember(SESSION_KEY,st.cap);remember(OK_KEY,st.okK);};
      const record=slow=>{runner.qa.hiresGovernor={windows:w.windows,callbackIntervalP75Ms:+gapP75.toFixed(1),callbackIntervalMeanMs:+meanGap.toFixed(1),longCallbackShare:+longShare.toFixed(3),medianPresentCostMs:+medianCost.toFixed(1),consecutiveSlowWindows:slow,k:st.k,ceil:st.ceil,cap:st.cap,upshifts:st.upshifts,probing:!!st.probe,lastTrial:st.lastTrial};};
      if(st.probe&&st.k===st.probe.to){
        st.lastTrial={k:st.k,window:st.probe.ok+1,callbackIntervalP75Ms:+gapP75.toFixed(1),callbackIntervalMeanMs:+meanGap.toFixed(1),longCallbackShare:+longShare.toFixed(3),medianPresentCostMs:+medianCost.toFixed(1),verdict:slowWindow?"reverted":st.probe.ok+1>=2?"accepted":"holding"};
        record(slowWindow?w.slow+1:0);
        if(slowWindow){const back=st.probe.from;st.probe=null;st.climbsFailed++;lock(back);restart();return;}
        if(++st.probe.ok>=2){st.okK=Math.max(st.okK,st.k);remember(OK_KEY,st.okK);st.probe=null;st.good=0;}
        w.slow=0;w.windowStart=now;w.gaps=[];w.costs=[];return;
      }
      if(st.probe){st.ceil=Math.min(st.ceil,st.probe.from);st.probe=null;}
      w.slow=slowWindow?w.slow+1:0;record(w.slow);
      if(slowWindow){
        st.good=0;
        if(w.slow>=2&&st.k>MIN_K){st.downshifts++;lock(st.k-STEP);restart();return;}
      }else{
        st.good=longShare<.06?st.good+1:0;
        const room=Math.min(st.cap,st.raw||1);
        if(st.good>=3&&st.k>=st.ceil&&st.ceil<room){
          const to=Math.min(room,st.ceil+STEP);
          st.probe={from:st.k,to,ok:0};st.ceil=to;st.upshifts++;st.good=0;restart();return;
        }
      }
      w.windowStart=now;w.gaps=[];w.costs=[];
    };
    return{install,target,apply,prepare,judge,forced,STEP};
  })();
  const coreInstallUiHires=CommonCombatRunner.prototype.installUi;
  CommonCombatRunner.prototype.installUi=function(...args){
    const result=coreInstallUiHires.apply(this,args);
    // Decide the scale before any sprite is processed (loadAssets runs right after installUi in the constructor).
    try{const st=HiRes.install(this);if(st)HiRes.apply(this,st,HiRes.target(this,st));}catch(error){try{this.qa.hiresError=String(error?.message||error)}catch{}}
    return result;
  };
  const coreDrawHires=CommonCombatRunner.prototype.draw;
  CommonCombatRunner.prototype.draw=function(...args){
    const st=this.__afHires;
    if(st){try{HiRes.prepare(this,st)}catch(error){try{this.qa.hiresError=String(error?.message||error)}catch{}}}
    return coreDrawHires.apply(this,args);
  };
  const coreFrameHires=CommonCombatRunner.prototype.frame;
  CommonCombatRunner.prototype.frame=function(now){
    const st=this.__afHires;
    if(!st||st.coarse||HiRes.forced!=null||(st.k<=1&&!(st.raw>1)))return coreFrameHires.call(this,now);
    const started=performance.now(),result=coreFrameHires.call(this,now),cost=performance.now()-started;
    try{HiRes.judge(this,st,now,cost)}catch{}
    return result;
  };
  const coreDrawBackgroundHires=CommonCombatRunner.prototype.drawBackground;
  CommonCombatRunner.prototype.drawBackground=function(ctx){
    const st=this.__afHires;
    if(!st||st.k<=1)return coreDrawBackgroundHires.call(this,ctx);
    // The orbit camera draws the four layers straight from their source images (already device-sharp); only the flat view uses the composite.
    try{if(this.cameraState?.().active)return coreDrawBackgroundHires.call(this,ctx);}catch{}
    const layers=this.backgroundLayers(),ready=layers.length&&layers.every(layer=>{const image=this.images.get(layer.source);return image?.complete&&image.naturalWidth;});
    if(!ready)return coreDrawBackgroundHires.call(this,ctx);
    // First flat frame: let the core build its 1280x720 composite too (runtime QA reports backgroundCompositeReady); the hi-res copy is drawn over it.
    if(!this.backgroundComposite)coreDrawBackgroundHires.call(this,ctx);
    const key=`${st.k}|${layers.map(layer=>`${layer.source}@${layer.placementY}`).join("|")}`;
    if(!this.__afHiBg||this.__afHiBg.__afKey!==key){
      const w=Math.round(this.width*st.k),h=Math.round(this.height*st.k),composite=document.createElement("canvas");composite.width=w;composite.height=h;
      const g=composite.getContext("2d");g.imageSmoothingEnabled=true;g.imageSmoothingQuality="high";
      const scaleY=h/960;
      for(const layer of layers){const image=this.images.get(layer.source),y=layer.placementY*scaleY,nextY=(layer.placementY+240)*scaleY;g.drawImage(image,0,y,w,nextY-y+1);}
      composite.__afKey=key;if(this.__afHiBg){try{this.__afHiBg.width=this.__afHiBg.height=1}catch{}}this.__afHiBg=composite;this.memory.hiresBackgroundBytes=w*h*4;
    }
    ctx.drawImage(this.__afHiBg,0,0,this.width,this.height);
  };
  const coreDisposeHires=CommonCombatRunner.prototype.dispose;
  CommonCombatRunner.prototype.dispose=function(...args){
    const disposed=coreDisposeHires.apply(this,args);
    if(disposed){try{if(this.__afHiBg){this.__afHiBg.width=this.__afHiBg.height=1;this.__afHiBg=null;}this.__afUltimateCompositeCanvas=null;if(this.memory)this.memory.hiresBackgroundBytes=0;}catch{}}
    return disposed;
  };
  // <<< COMBAT_HIRES_CANVAS_V1
  window.AfterSignalCommonCombatRuntime=Object.freeze({version:"1.0.0-candidate",mount:options=>{document.querySelector("#af-orientation-gate")?.remove();const runner=new CommonCombatRunner(options),resize=()=>runner.syncResponsiveLayout(),dispose=()=>runner.dispose("pagehide");currentRunner=runner;resize();runner.start();runner.schedule(resize,0);runner.listen(window,"resize",resize);runner.listen(window,"orientationchange",resize);runner.listen(window,"pagehide",dispose,{once:true});runner.listen(window,"beforeunload",dispose,{once:true});window.__AF_COMMON_COMBAT_RUNNER__=runner;window.__AF_ACTIVE_RUNNER__=runner;return runner;},active:()=>currentRunner,configureParty:(stageId,characterIds)=>{const stage=F.STAGE_REGISTRY.get(stageId);if(!stage)throw new Error(`Unknown stage ${stageId}`);const loadout=new F.PartyLoadout({id:stage.deployment?.partyId||stageId,characterIds,availableCharacterIds:stage.deployment?.availableCharacterIds||stage.deployment?.slots||[]});return F.PartyLoadout.saveForStage(stageId,loadout);},clearParty:(stageId)=>{try{localStorage.removeItem(F.PartyLoadout.storageKey(stageId));}catch{}return true;}});
  addEventListener("load",()=>{if(document.body?.dataset.afCommonCombatRuntime==="v1")window.AfterSignalCommonCombatRuntime.mount();},{once:true});
})();

