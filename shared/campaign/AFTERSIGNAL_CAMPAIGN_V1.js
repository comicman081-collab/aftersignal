/* AFTER SIGNAL CAMPAIGN V1 (2026-09-27, Claude Code) — CH01-05 main story after the prologue.
   Progress lives in profile:v3 `campaign` (written by the reward page); the prologue fields
   (progress.currentPrologueStage / prologueComplete) are never touched, so the lobby route stays open.
   Flow per stage: chapterStory(intro) -> chapterCombat -> reward -> chapterStory(outro, when the scenario has one) -> campaign map.
   Record: HISTORY/2026-09-27_CAMPAIGN_CH01_05_V1.md
   CAMPAIGN_CH06_15_V1 (2026-09-28): the CH01-05 data (window.AfterSignalCampaignData) is merged with the extension
   chunks in window.AfterSignalCampaignDataExt (AFTERSIGNAL_CAMPAIGN_DATA_CH06_15.js, 10 stages per chapter).
   A chapter's boss stage is its CHAPTER_BOSS stage (CHnn-20 in CH01-05, CHnn-10 from CH06), and a chapter's first
   stage opens when the previous chapter's boss is cleared. Record: HISTORY/2026-09-28_CAMPAIGN_CH06_11_V1.md */
(()=>{
  "use strict";
  const BASE=window.AfterSignalCampaignData;
  if(!BASE)throw new Error("CAMPAIGN_DATA_MISSING");
  // Extension chunks add chapters the base does not have; base chapters, stages, enemies and actors are never replaced.
  const D=(()=>{
    const ext=(Array.isArray(window.AfterSignalCampaignDataExt)?window.AfterSignalCampaignDataExt:[]).filter(chunk=>chunk&&Array.isArray(chunk.chapters));
    if(!ext.length)return BASE;
    const chapters=[...BASE.chapters],stages=[...BASE.stages],enemies=[...BASE.enemies],actors={...BASE.actors},bgmTracks={...BASE.bgmTracks};
    const chapterIds=new Set(chapters.map(chapter=>chapter.id)),enemyIds=new Set(enemies.map(enemy=>enemy.id));
    for(const chunk of ext){
      const added=new Set(chunk.chapters.filter(chapter=>!chapterIds.has(chapter.id)).map(chapter=>chapter.id));
      chunk.chapters.forEach(chapter=>{if(added.has(chapter.id)){chapters.push(chapter);chapterIds.add(chapter.id);}});
      chunk.stages.forEach(stage=>{if(added.has(stage.chapter))stages.push(stage);});
      (chunk.enemies||[]).forEach(enemy=>{if(!enemyIds.has(enemy.id)){enemies.push(enemy);enemyIds.add(enemy.id);}});
      Object.entries(chunk.actors||{}).forEach(([key,actor])=>{/* CAMPAIGN_CH06_15_V1 (2026-09-29): a base actor without art takes the extension standing art */if(!(key in actors)||(!actors[key].src&&actor.src))actors[key]=actor;});
      Object.entries(chunk.bgmTracks||{}).forEach(([key,track])=>{if(!(key in bgmTracks))bgmTracks[key]=track;});
    }
    const chapterNo=new Map(chapters.map(chapter=>[chapter.id,chapter.no]));
    chapters.sort((a,b)=>a.no-b.no);stages.sort((a,b)=>(chapterNo.get(a.chapter)-chapterNo.get(b.chapter))||(a.no-b.no));
    return Object.freeze({...BASE,chapters,stages,enemies,actors,bgmTracks,extensions:ext.map(chunk=>chunk.range||chunk.version||"")});
  })();
  const LAUNCH_KEY="aftersignal:campaign-launch:v1",PROFILE_KEY="aftersignal:profile:v3",FORMATION_KEY="aftersignal:party-loadout:P-99:v1";
  // Guest squad when the player owns nobody yet (gacha-only ownership; same squad as the P-14 story guests). Claude's decision.
  const GUEST_SQUAD=Object.freeze(["mira","haneul","sera","tessa","naru"]);
  const stages=D.stages,order=stages.map(stage=>stage.id),byId=new Map(stages.map(stage=>[stage.id,stage])),chapters=new Map(D.chapters.map(chapter=>[chapter.id,chapter]));
  const enemies=new Map(D.enemies.map(enemy=>[enemy.id,enemy]));
  const readJson=(key,fallback=null)=>{try{const value=JSON.parse(localStorage.getItem(key)||"null");return value??fallback}catch{return fallback}};
  const profile=()=>readJson(PROFILE_KEY,{})||{};
  const prologueDone=(p=profile())=>p?.progress?.prologueComplete===true||Number(p?.clears?.p14)>0;
  const cleared=(p=profile())=>(p?.campaign&&typeof p.campaign==="object"&&p.campaign.cleared)||{};
  const isCleared=(id,p=profile())=>Number(cleared(p)[id])>0;
  // A chapter's boss stage: its CHAPTER_BOSS stage, else its last stage (CH01-05: CHnn-20, CH06+: CHnn-10).
  const chapterStages=chapterId=>stages.filter(stage=>stage.chapter===chapterId);
  const bossStageOf=chapterId=>{const list=chapterStages(chapterId);return(list.find(stage=>stage.type==="CHAPTER_BOSS")||list[list.length-1]||{}).id||null;};
  // The first stage of a chapter opens when the previous chapter's boss is cleared; inside a chapter the previous stage.
  const isUnlocked=(id,p=profile())=>{if(!prologueDone(p))return false;const index=order.indexOf(id);if(index<0)return false;if(index===0||isCleared(id,p))return true;const prev=byId.get(order[index-1]),stage=byId.get(id);return prev.chapter===stage.chapter?isCleared(prev.id,p):isCleared(bossStageOf(prev.chapter),p);};
  const frontier=(p=profile())=>{if(!prologueDone(p))return null;return order.find(id=>!isCleared(id,p))||null;};
  const nextStageId=id=>order[order.indexOf(id)+1]||null;
  // Chapter bosses beaten; the lobby's idle supply rate reads this (shelter patch campaign_ch01_05_v1).
  const chapterBossesCleared=(p=profile())=>D.chapters.filter(chapter=>isCleared(bossStageOf(chapter.id),p)).length;
  const stageKey=id=>String(id||"").toLowerCase().replace("-","");
  const stageByKey=key=>stages.find(stage=>stageKey(stage.id)===String(key||"").toLowerCase())||null;
  const chapterOf=id=>chapters.get(byId.get(id)?.chapter)||null;
  const background=id=>{const stage=byId.get(id),chapter=chapterOf(id);return stage&&chapter?chapter.backgrounds[stage.bg]:null;};
  const readLaunch=()=>{const launch=readJson(LAUNCH_KEY);return launch&&byId.has(launch.stageId)?launch:null;};
  const writeLaunch=record=>{const launch={version:1,...record,at:Date.now()};localStorage.setItem(LAUNCH_KEY,JSON.stringify(launch));return launch;};
  const navigate=screen=>{if(window.parent&&window.parent!==window)window.parent.postMessage({type:"aftersignal:navigate",screen},"*");else location.href=`${screen}.html`;return screen;};
  // The shell only accepts messages from the frame it has already swapped in (on the frame's load event), so a cue
  // posted while the page is still loading would be dropped: wait for load. Repeating the playing cue does not restart it
  // (shell guard AF_BGM_SAME_TRACK_V1).
  const bgm=cue=>{if(!(window.parent&&window.parent!==window))return;const send=()=>setTimeout(()=>window.parent.postMessage({type:"aftersignal:bgm",cue},"*"),80);if(document.readyState==="complete")send();else addEventListener("load",send,{once:true});};
  const launch=(stageId,phase="intro")=>{
    if(!byId.has(stageId))throw new Error(`UNKNOWN_CAMPAIGN_STAGE:${stageId}`);
    if(!isUnlocked(stageId))return null;
    // Each sortie starts fresh: the common runner would otherwise resume an old mid-battle snapshot of this stage.
    if(phase==="combat"){try{localStorage.removeItem(`aftersignal:combat:${stageId}:v1`)}catch{}}
    writeLaunch({stageId,phase});
    return navigate(phase==="combat"?"chapterCombat":phase==="map"?"campaign":"chapterStory");
  };
  const resolveParty=(p=profile())=>{
    const known=id=>!window.AfterSignalFoundation||window.AfterSignalFoundation.CHARACTER_REGISTRY?.has?.(id)!==false;
    const owned=Object.keys(p?.gacha?.owned||{}).filter(known),saved=readJson(FORMATION_KEY),G=window.AfterSignalGacha;
    let ids=[];
    if(G?.formationParty){try{ids=G.formationParty(p,{saved,roster:window.AfterSignalShelter?.characters||null,max:5})||[]}catch{ids=[]}}
    else for(const id of Array.isArray(saved?.characterIds)?saved.characterIds:[])if(id&&owned.includes(id)&&!ids.includes(id)&&ids.length<5)ids.push(id);
    if(!ids.length)ids=owned.slice(0,5);
    ids=ids.filter(known);
    return ids.length?{ids,source:"formation"}:{ids:GUEST_SQUAD.filter(known),source:"guest"};
  };
  const clone=value=>JSON.parse(JSON.stringify(value));
  // Registers the one launched stage (enemies + StageSpec + BattleSpec) in the Foundation registry and exposes its
  // four-layer background to the common runner (runtime patch combat_campaign_v1).
  const registerStage=(stageId,partyIds)=>{
    const F=window.AfterSignalFoundation,stage=byId.get(stageId),chapter=chapterOf(stageId);
    if(!F||!stage||!chapter)throw new Error(`CAMPAIGN_STAGE_UNAVAILABLE:${stageId}`);
    const battle=stage.battle,enemyIds=[...new Set([...battle.waves.flatMap(wave=>wave.enemyIds),...(battle.boss?[battle.boss.id]:[])])];
    const enemySpecs=enemyIds.map(id=>{const e=enemies.get(id);return{id:e.id,asset:e.asset,motionAssets:e.motionAssets,depthBand:e.depthBand,movement:e.movement,...(e.attack?{attack:e.attack}:{}),facing:"front",displayName:e.name};});
    const boss=battle.boss?clone(battle.boss):null,isBoss=stage.type!=="NORMAL";
    F.registerPack({
      id:`campaign.${stageId}.v1`,kind:F.PACK_KINDS.StagePack,version:"1.0.0",enemies:enemySpecs,
      stages:[{stageId,chapterId:stage.chapter,stageOrder:1000+order.indexOf(stageId),stageType:stage.type==="NORMAL"?F.StageType.STORY_COMBAT:stage.type==="MIDBOSS"?F.StageType.MIDBOSS:F.StageType.BOSS,storyBefore:"chapterStory",battleId:`campaign-${stageId}`,storyAfter:stage.hasOutro?"chapterStory":null,background:`campaign-${chapter.backgrounds[stage.bg].id}`,reward:{id:`${stageKey(stageId)}_campaign`},unlocks:[],deployment:{partyId:"campaign_party",slots:partyIds,availableCharacterIds:partyIds,enemyIds,playerBaseline:614},nextStage:nextStageId(stageId),checkpoint:`${stageKey(stageId)}_before_combat`}],
      battles:[{id:`campaign-${stageId}`,objective:clone(battle.objective),waves:clone(battle.waves),boss,environment:{layerProfile:"mixed",playerBaseline:614,spawnZones:["background1","background2"]},rules:{allowSwitch:true,allowUltimate:true,allowRevive:true,autoTarget:true,timeLimitMs:battle.timeLimitMs,timeLimitProfile:isBoss?"CAMPAIGN_BOSS":"CAMPAIGN_STANDARD",enemyDamageScale:battle.enemyDamageScale,enemyPressureBudget:2,reviveChargesPerMember:isBoss?2:1,reviveDelaySeconds:2.4,reviveHpRatio:.55,difficultyProfile:`CAMPAIGN_${stage.chapter}`}}]
    });
    window.__AF_STAGE_BACKGROUND_LAYERS__={...(window.__AF_STAGE_BACKGROUND_LAYERS__||{}),[stageId]:chapter.backgrounds[stage.bg]};
    return stage;
  };
  // Reward spec for the reward page (pending.stage is the lower-case key, e.g. "ch0107"). A replay (stage already
  // cleared before this claim) pays 30% of gold/EXP/battle data and no core signal/modules; diamonds stay first-clear only.
  const rewardFor=(key,p=profile())=>{const stage=stageByKey(key);if(!stage)return null;const base={...stage.reward,next:stage.hasOutro?"chapterStory":"campaign",campaign:true};if(!isCleared(stage.id,p))return base;return{...base,replay:true,credits:Math.round(base.credits*.3/10)*10,commanderXp:Math.round(base.commanderXp*.3),battleData:Math.round(base.battleData*.3/10)*10,coreSignal:0,weaponModules:0};};
  window.AfterSignalCampaign=Object.freeze({version:"1.1.0",LAUNCH_KEY,GUEST_SQUAD,data:D,stages,order,byId,chapters,enemies,profile,prologueDone,cleared,isCleared,isUnlocked,frontier,nextStageId,chapterStages,bossStageOf,chapterBossesCleared,stageKey,stageByKey,chapterOf,background,readLaunch,writeLaunch,navigate,bgm,launch,resolveParty,registerStage,rewardFor});
})();
