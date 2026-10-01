(()=>{
  "use strict";
  const root=globalThis;
  const PROFILE_KEY="aftersignal:profile:v3";
  const SHELTER_PROFILE_KEY="aftersignal:v066:profile";
  const LAUNCH_KEY="aftersignal:extra-combat-launch:v1";
  const HOUR=3600000;
  const RESOURCE_KEYS=Object.freeze(["credits","battleData","coreSignal","weaponModules","skillManual"]);
  const INVENTORY_KEYS=Object.freeze(["weaponBoxes"]);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const finite=value=>Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0;
  // DIAMOND_ECONOMY_V1 (2026-09-26): 다이아 = profile.resources.diamonds; amounts come from window.AfterSignalDiamondEconomy
  // (shared/progression/AFTERSIGNAL_DIAMOND_ECONOMY_V1.js). Pages that load this service without that module fetch it once.
  const DIAMOND_KEY="diamonds";
  const diamondEconomy=()=>root.AfterSignalDiamondEconomy||null;
  const withDiamonds=(reward,amount)=>{const value=finite(amount);return value?{...reward,[DIAMOND_KEY]:finite(reward?.[DIAMOND_KEY])+value}:reward;};
  const DIAMOND_ECONOMY_URL=(()=>{try{const src=root.document?.currentScript?.src;return src?new URL("../progression/AFTERSIGNAL_DIAMOND_ECONOMY_V1.js",src).href:null}catch{return null}})();
  let diamondEconomyLoad=null;
  function ensureDiamondEconomy(){if(root.AfterSignalDiamondEconomy||!DIAMOND_ECONOMY_URL)return Promise.resolve();return diamondEconomyLoad||(diamondEconomyLoad=new Promise(resolve=>{try{const doc=root.document,script=doc.createElement("script"),done=()=>resolve();script.src=DIAMOND_ECONOMY_URL;script.onload=done;script.onerror=done;(doc.head||doc.documentElement).appendChild(script);setTimeout(done,4000);}catch{resolve();}}));}
  const xpNeed=level=>root.AfterSignalRewards?.xpNeed?.(level)??Math.floor(120+45*(level-1)+18*Math.pow(level-1,1.55));
  const safeParse=value=>{try{return JSON.parse(value||"null")}catch{return null}};
  const dispatch=(name,detail)=>{try{root.dispatchEvent?.(new CustomEvent(name,{detail}))}catch{}};
  const baseExtra=()=>({
    schemaVersion:1,
    reset:{timezone:"Asia/Seoul",dailyKey:null,weeklyKey:null,lastResolvedAt:0},
    signalSweep:{dailyKey:null,seed:0,configuration:null,completed:false,rewardClaimed:false,chosenUpgrades:[]},
    relayContracts:{dailyKey:null,weeklyKey:null,missions:[],weeklyMissions:[],claimedMilestones:[]},
    threatInterception:{dailyKey:null,weeklyKey:null,certification:{C:false,B:false,A:false,S:false},dailyAttemptsUsed:0,bestTier:null,weeklyBattleCount:0},
    relaySupply:{lastClaimTimestamp:Date.now(),clockRollbackDetected:false,lastReceipt:null},
    noSignalZone:{weeklyKey:null,seed:0,nodes:[],currentNode:"START",clearedNodes:["START"],claimedNodes:[],completed:false,records:[]},
    relayTower:{highestClearedFloor:0,clearedFloors:[],claimedFloors:[]},
    tacticalSimulation:{weeklyKey:null,seed:0,modifiers:[],bestScore:0,bestRewardTier:null,claimedRewardTiers:[]}
  });
  function normalizeProfile(input){
    const profile=clone(input||{}),fresh=baseExtra();
    profile.version=profile.version||"3.0";
    profile.commander={name:"",level:1,xp:0,...(profile.commander||{})};
    profile.resources={credits:0,battleData:0,coreSignal:0,weaponModules:0,skillManual:0,...(profile.resources||{})};
    profile.inventory={weaponBoxes:0,...(profile.inventory||{})};
    profile.rewardClaims={...(profile.rewardClaims||{})};
    profile.rewardLedger=Array.isArray(profile.rewardLedger)?profile.rewardLedger:[];
    const extra=profile.extraContent||{};
    profile.extraContent={...fresh,...extra,
      reset:{...fresh.reset,...(extra.reset||{})},
      signalSweep:{...fresh.signalSweep,...(extra.signalSweep||{})},
      relayContracts:{...fresh.relayContracts,...(extra.relayContracts||{})},
      threatInterception:{...fresh.threatInterception,...(extra.threatInterception||{}),certification:{...fresh.threatInterception.certification,...(extra.threatInterception?.certification||{})}},
      relaySupply:{...fresh.relaySupply,...(extra.relaySupply||{})},
      noSignalZone:{...fresh.noSignalZone,...(extra.noSignalZone||{})},
      relayTower:{...fresh.relayTower,...(extra.relayTower||{})},
      tacticalSimulation:{...fresh.tacticalSimulation,...(extra.tacticalSimulation||{})}
    };
    return profile;
  }
  function migrateShelterProfile(){
    const shelter=safeParse(root.localStorage?.getItem(SHELTER_PROFILE_KEY));
    if(!shelter)return null;
    const resources=shelter.resources||{},inventory=shelter.inventory||{};
    return normalizeProfile({
      version:"3.0",
      commander:{...(shelter.commander||{})},
      resources:{
        credits:finite(resources.credits),
        battleData:finite(resources.battleData),
        coreSignal:finite(resources.coreSignal),
        weaponModules:finite(resources.weaponModules??resources.enhancementShards),
        skillManual:finite(resources.skillManual),
        ...(finite(resources[DIAMOND_KEY])?{[DIAMOND_KEY]:finite(resources[DIAMOND_KEY])}:{})
      },
      inventory:{weaponBoxes:finite(inventory.weaponBoxes)},
      unlockedCharacterIds:Array.isArray(shelter.unlockedCharacterIds)?shelter.unlockedCharacterIds:["mira"],
      characters:{...(shelter.characters||{})},
      equipmentInventory:Array.isArray(shelter.equipmentInventory)?shelter.equipmentInventory:[],
      progress:{...(shelter.progress||{})},
      migrations:{stageExternalEconomyV1:{source:SHELTER_PROFILE_KEY,migratedAt:Date.now()}}
    });
  }
  function loadProfile(){
    const persisted=safeParse(root.localStorage?.getItem(PROFILE_KEY));
    if(!persisted){
      const migrated=migrateShelterProfile();
      if(migrated){
        if(root.AfterSignalRewards?.save)return normalizeProfile(root.AfterSignalRewards.save(migrated));
        root.localStorage?.setItem(PROFILE_KEY,JSON.stringify(migrated));
        return migrated;
      }
    }
    if(root.AfterSignalRewards?.load)return normalizeProfile(root.AfterSignalRewards.load());
    return normalizeProfile(persisted||{});
  }
  function saveProfile(profile){
    const normalized=normalizeProfile(profile);
    if(root.AfterSignalRewards?.save)return root.AfterSignalRewards.save(normalized);
    root.localStorage?.setItem(PROFILE_KEY,JSON.stringify(normalized));
    dispatch("aftersignal:profile",normalized);
    return normalized;
  }
  function validateReward(reward={}){
    const out={};
    for(const key of [...RESOURCE_KEYS,...INVENTORY_KEYS,"commanderXp",DIAMOND_KEY]){const amount=finite(reward[key]);if(amount)out[key]=amount;}
    return out;
  }
  function applyReward(profile,reward){
    for(const key of finite(reward[DIAMOND_KEY])?[...RESOURCE_KEYS,DIAMOND_KEY]:RESOURCE_KEYS)profile.resources[key]=finite(profile.resources[key])+finite(reward[key]);
    for(const key of INVENTORY_KEYS)profile.inventory[key]=finite(profile.inventory[key])+finite(reward[key]);
    let levels=0;profile.commander.xp=finite(profile.commander.xp)+finite(reward.commanderXp);
    while(profile.commander.xp>=xpNeed(profile.commander.level)){profile.commander.xp-=xpNeed(profile.commander.level);profile.commander.level++;levels++;}
    return levels;
  }
  const RewardService=Object.freeze({
    version:"1.0.0",PROFILE_KEY,allowedResources:RESOURCE_KEYS,allowedInventory:INVENTORY_KEYS,
    load:loadProfile,save:saveProfile,hasClaim:claimId=>Boolean(loadProfile().rewardClaims?.[claimId]),
    transact({sourceType,sourceId,claimId,reward={},mutateProfile=null,metadata={}}={}){
      if(!sourceType||!sourceId||!claimId)throw new Error("REWARD_GRANT_REQUIRES_SOURCE_AND_CLAIM_ID");
      const profile=loadProfile();
      if(profile.rewardClaims[claimId])return{granted:false,duplicate:true,profile,claimId,reward:{}};
      const normalizedReward=validateReward(reward),working=clone(profile);
      if(typeof mutateProfile==="function")mutateProfile(working);
      const levels=applyReward(working,normalizedReward),timestamp=Date.now();
      working.rewardClaims[claimId]=timestamp;
      working.rewardLedger.push({sourceType,sourceId,claimId,reward:normalizedReward,metadata,timestamp});
      const limit=Math.max(32,finite(root.__AF_EXTRA_CONFIG__?.economy?.rewardLedgerLimit)||512);
      if(working.rewardLedger.length>limit)working.rewardLedger.splice(0,working.rewardLedger.length-limit);
      const saved=saveProfile(working),receipt={granted:true,duplicate:false,claimId,reward:normalizedReward,levels,profile:saved};
      dispatch("aftersignal:live-reward-granted",receipt);return receipt;
    }
  });
  const kstDate=timestamp=>new Date(Number(timestamp)+9*HOUR);
  const dailyKey=(timestamp=Date.now())=>kstDate(timestamp).toISOString().slice(0,10);
  function weeklyKey(timestamp=Date.now()){
    const shifted=kstDate(timestamp),date=new Date(Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate()));
    const day=date.getUTCDay()||7;date.setUTCDate(date.getUTCDate()+4-day);
    const yearStart=new Date(Date.UTC(date.getUTCFullYear(),0,1)),week=Math.ceil((((date-yearStart)/86400000)+1)/7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2,"0")}`;
  }
  function hash(text){let value=2166136261;for(const char of String(text)){value^=char.charCodeAt(0);value=Math.imul(value,16777619)}return value>>>0;}
  function random(seed){let value=seed>>>0;return()=>{value+=0x6D2B79F5;let t=value;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
  const sample=(rows,count,rng)=>{const copy=[...rows];for(let i=copy.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy.slice(0,count);};
  function buildSweep(config,key){const seed=hash(`signalSweep:${key}`),rng=random(seed),pools=config.enemyPools,waves=Array.from({length:3},(_,wave)=>sample(pools[Math.floor(rng()*pools.length)],wave===2?4:3,rng)),upgrades=[sample(config.playerUpgrades,3,rng),sample(config.playerUpgrades,3,rng)];return{seed,background:config.backgrounds[Math.floor(rng()*config.backgrounds.length)],waves,modifier:config.enemyModifiers[Math.floor(rng()*config.enemyModifiers.length)],midboss:config.midbosses[Math.floor(rng()*config.midbosses.length)],upgrades,rewardChoices:["battle_data","modules","hybrid"]};}
  function buildZone(config,key){const seed=hash(`noSignalZone:${key}`),rng=random(seed),count=Math.max(6,Math.min(10,6+Math.floor(rng()*5))),types=["START",...Array.from({length:count-3},()=>["COMBAT","ELITE","SUPPLY","RECORD","RISK"][Math.floor(rng()*5)]),"MIDBOSS","FINAL"],nodes=types.map((type,index)=>({id:index===0?"START":`N${index}`,type,index,unlocks:index<2?[`N${index+1}`]:index<count-1?[`N${index+1}`]:[],enemyPool:config.combatEnemyPools[Math.floor(rng()*config.combatEnemyPools.length)]||[],midboss:config.midbosses[Math.floor(rng()*config.midbosses.length)]}));if(nodes[1]&&nodes[3])nodes[1].unlocks=[nodes[2].id,nodes[3].id];return{seed,nodes};}
  const ResetService=Object.freeze({version:"1.0.0",timezone:"Asia/Seoul",dailyKey,weeklyKey,seed:hash,random,
    resolve(profile,configs,timestamp=Date.now()){
      const next=normalizeProfile(profile),day=dailyKey(timestamp),week=weeklyKey(timestamp),extra=next.extraContent;
      if(extra.signalSweep.dailyKey!==day){const configuration=buildSweep(configs.signalSweep,day);extra.signalSweep={...baseExtra().signalSweep,dailyKey:day,seed:configuration.seed,configuration};}
      if(extra.relayContracts.dailyKey!==day){const rng=random(hash(`contracts:${day}`));extra.relayContracts.dailyKey=day;extra.relayContracts.missions=sample(configs.relayContracts.dailyPool,5,rng).map(item=>({...item,progress:0,claimed:false}));extra.relayContracts.claimedMilestones=(extra.relayContracts.claimedMilestones||[]).filter(id=>!id.startsWith("daily:"));}
      if(extra.relayContracts.weeklyKey!==week){extra.relayContracts.weeklyKey=week;extra.relayContracts.weeklyMissions=configs.relayContracts.weekly.map(item=>({...item,progress:0,claimed:false}));extra.relayContracts.claimedMilestones=(extra.relayContracts.claimedMilestones||[]).filter(id=>!id.startsWith("weekly:"));}
      if(extra.threatInterception.weeklyKey!==week){extra.threatInterception={...baseExtra().threatInterception,weeklyKey:week,dailyKey:day};}
      else if(extra.threatInterception.dailyKey!==day){extra.threatInterception.dailyKey=day;extra.threatInterception.dailyAttemptsUsed=0;}
      if(extra.noSignalZone.weeklyKey!==week){const built=buildZone(configs.noSignalZone,week);extra.noSignalZone={...baseExtra().noSignalZone,weeklyKey:week,seed:built.seed,nodes:built.nodes};}
      if(extra.tacticalSimulation.weeklyKey!==week){const seed=hash(`simulation:${week}`),rng=random(seed);extra.tacticalSimulation={...baseExtra().tacticalSimulation,weeklyKey:week,seed,modifiers:sample(configs.tacticalSimulation.modifiers,3,rng)};}
      extra.reset={timezone:"Asia/Seoul",dailyKey:day,weeklyKey:week,lastResolvedAt:timestamp};return next;
    }
  });
  function rewardForTower(floor,economy){const reward={credits:economy.normalCreditsBase+economy.normalCreditsPerFloor*floor,battleData:economy.normalBattleDataBase+economy.normalBattleDataPerFloor*floor};if(floor%5===0)Object.assign(reward,economy.milestone5);if(floor%10===0)Object.assign(reward,economy.milestone10);if(floor%20===0)Object.assign(reward,economy.bossMilestone);return reward;}
  /* GACHA_RECRUIT_V1 (2026-09-26): once the save has a recruit block (profile.gacha), repeat operations field OWNED
     characters only: the lobby formation (foundation PartyLoadout slot of P-99, see AFTERSIGNAL_GACHA_V1.js), else the
     strongest owned five. Saves without a block keep the old story list. Read-only: nothing is written here. */
  function recruitParty(profile){
    const g=profile?.gacha;if(!g||typeof g!=="object"||Array.isArray(g))return null;
    const G=root.AfterSignalGacha,roster=root.AfterSignalShelter?.characters||null;
    if(G?.formationParty){let saved=null;try{saved=JSON.parse(root.localStorage?.getItem(G.FORMATION_KEY)||"null")}catch{}return G.formationParty(profile,{saved,roster,max:5});}
    return Object.keys(g.owned||{}).slice(0,5);
  }
  const rank={C:0,B:1,A:2,S:3};
  const LiveService={
    version:"1.0.0",PROFILE_KEY,LAUNCH_KEY,configs:null,profile:null,
    async initialize(timestamp=Date.now()){
      await ensureDiamondEconomy();
      const configs=await root.AfterSignalExtraContentRegistry.load();root.__AF_EXTRA_CONFIG__=configs;this.configs=configs;
      const before=RewardService.load(),after=ResetService.resolve(before,configs,timestamp);this.profile=JSON.stringify(before.extraContent)===JSON.stringify(after.extraContent)?before:RewardService.save(after);
      dispatch("aftersignal:extra-content-ready",{dailyKey:after.extraContent.reset.dailyKey,weeklyKey:after.extraContent.reset.weeklyKey});return this.profile;
    },
    refresh(){this.profile=RewardService.load();return this.profile;},
    recordEvent(event,amount=1){const configs=this.configs;if(!configs)return false;const profile=RewardService.load(),contracts=profile.extraContent.relayContracts,value=finite(amount);for(const mission of contracts.missions||[])if(mission.event===event)mission.progress=Math.min(mission.target,mission.progress+value);for(const mission of contracts.weeklyMissions||[])if(mission.event===event)mission.progress=event==="simulationScore"?Math.max(mission.progress,value):Math.min(mission.target,mission.progress+value);RewardService.save(profile);this.profile=profile;dispatch("aftersignal:contract-progress",{event,amount:value});return true;},
    claimContract(kind,id){const profile=RewardService.load(),state=profile.extraContent.relayContracts,list=kind==="weekly"?state.weeklyMissions:state.missions,mission=list.find(row=>row.id===id);if(!mission||mission.progress<mission.target)throw new Error("MISSION_NOT_COMPLETE");const key=kind==="weekly"?state.weeklyKey:state.dailyKey,reward=this.configs.economy.contracts[kind==="weekly"?"weeklyMission":"dailyMission"];return RewardService.transact({sourceType:"relayContract",sourceId:id,claimId:`${kind}:${key}:${id}`,reward,mutateProfile:p=>{const row=(kind==="weekly"?p.extraContent.relayContracts.weeklyMissions:p.extraContent.relayContracts.missions).find(item=>item.id===id);row.claimed=true;}});},
    claimContractMilestone(kind,count){const profile=RewardService.load(),state=profile.extraContent.relayContracts,list=kind==="weekly"?state.weeklyMissions:state.missions,completed=list.filter(row=>row.progress>=row.target).length,key=kind==="weekly"?state.weeklyKey:state.dailyKey;if(completed<count)throw new Error("MILESTONE_NOT_READY");const rewardKey=kind==="weekly"?"weeklyComplete":count===2?"dailyMilestone2":"dailyMilestone3";return RewardService.transact({sourceType:"relayContract",sourceId:`${kind}-${count}`,claimId:`${kind}:${key}:milestone:${count}`,reward:kind!=="weekly"&&count===3?withDiamonds(this.configs.economy.contracts[rewardKey],diamondEconomy()?.DAILY_CONTRACTS?.setComplete):this.configs.economy.contracts[rewardKey],mutateProfile:p=>p.extraContent.relayContracts.claimedMilestones.push(`${kind}:${key}:${count}`)});},
    makeLaunch(kind,options={}){const p=RewardService.load(),c=this.configs,party=recruitParty(p)||(p.unlockedCharacterIds||["mira"]).filter(id=>["mira","haneul","sera","astra","tessa","naru"].includes(id)).slice(0,5),launch={version:1,kind,createdAt:Date.now(),returnScreen:"lobby",party:party.length?party:["mira"],options:{...options},battle:null};
      if(kind==="signalSweep"){const cfg=p.extraContent.signalSweep.configuration;launch.battle={title:"신호 소탕전",waves:cfg.waves,midboss:cfg.midboss,background:cfg.background,modifier:cfg.modifier,timeLimitMs:90000,upgradeChoices:cfg.upgrades};}
      if(kind==="interception"){const tier=c.threatInterception.tiers.find(row=>row.id===options.tier)||c.threatInterception.tiers[0];launch.battle={title:`위협체 요격 ${tier.id}`,waves:[[]],bossId:tier.bossId,runtimeHp:tier.runtimeHp,background:"P-07",timeLimitMs:180000};}
      if(kind==="tower"){const floor=finite(options.floor)||1,enemy=c.relayTower.enemyRotation[(floor-1)%c.relayTower.enemyRotation.length];launch.battle={title:`릴레이 타워 ${floor}F`,waves:[[enemy,enemy],[enemy,enemy,enemy],[enemy,enemy,enemy]],background:["P-01","P-02","P-04"][floor%3],timeLimitMs:floor%5===0?180000:90000};}
      if(kind==="zone"){const node=p.extraContent.noSignalZone.nodes.find(row=>row.id===options.nodeId);launch.battle={title:`무신호 구역 ${node?.id||""}`,waves:[node?.enemyPool||["renewal_scavenger"],node?.enemyPool||["renewal_scavenger"]],bossId:node?.type==="MIDBOSS"||node?.type==="FINAL"?node.midboss:null,background:"P-04",timeLimitMs:node?.type==="MIDBOSS"||node?.type==="FINAL"?180000:90000};}
      if(kind==="simulation"){launch.battle={title:"전술 시뮬레이션",waves:[["renewal_aerial","renewal_aerial_guard"],["renewal_plate","renewal_aerial"]],background:"P-02",timeLimitMs:90000,modifiers:p.extraContent.tacticalSimulation.modifiers};}
      root.localStorage.setItem(LAUNCH_KEY,JSON.stringify(launch));return launch;
    },
    launch(kind,options={}){if(recruitParty(RewardService.load())?.length===0){dispatch("aftersignal:recruit-required",{kind});return null;}/* GACHA_RECRUIT_V1: no owned character yet -> the lobby offers 대원 모집 instead */const launch=this.makeLaunch(kind,options);if(root.parent&&root.parent!==root)root.parent.postMessage({type:"aftersignal:navigate",screen:"extraCombat"},"*");else root.location.href="extraCombat.html";return launch;},
    completeCombat(result={}){const launch=safeParse(root.localStorage.getItem(LAUNCH_KEY));if(!launch)throw new Error("EXTRA_COMBAT_LAUNCH_MISSING");const p=RewardService.load(),day=p.extraContent.reset.dailyKey,week=p.extraContent.reset.weeklyKey;
      if(launch.kind==="signalSweep"){const updated=clone(p);updated.extraContent.signalSweep.completed=true;RewardService.save(updated);this.recordEvent("battleWin",1);this.recordEvent("signalSweepClear",1);return{requiresRewardChoice:!updated.extraContent.signalSweep.rewardClaimed,choices:updated.extraContent.signalSweep.configuration.rewardChoices};}
      if(launch.kind==="interception"){const tier=launch.options.tier||"C",count=p.extraContent.threatInterception.dailyAttemptsUsed;if(count>=this.configs.economy.threatInterception.dailyAttempts)throw new Error("DAILY_ATTEMPTS_EXHAUSTED");const gem=diamondEconomy()?.INTERCEPTION,tierMark=`diamond:interceptionTier:${tier}`,tierFirst=Boolean(gem)&&!p.rewardClaims[tierMark],diamonds=gem?finite(gem.perClear)+(tierFirst?finite(gem.tierFirstClear):0):0;const receipt=RewardService.transact({sourceType:"threatInterception",sourceId:tier,claimId:`quickBattle:${tier}:${day}:ACTUAL:${count+1}`,reward:withDiamonds(this.configs.economy.threatInterception.tiers[tier],diamonds),mutateProfile:profile=>{if(tierFirst)profile.rewardClaims[tierMark]=Date.now();const state=profile.extraContent.threatInterception;for(const [id,value] of Object.entries(rank))if(value<=rank[tier])state.certification[id]=true;state.dailyAttemptsUsed++;state.weeklyBattleCount++;if(state.bestTier===null||rank[tier]>rank[state.bestTier])state.bestTier=tier;}});this.recordEvent("battleWin",1);this.recordEvent("bossClear",1);this.recordEvent("interceptionClear",1);return receipt;}
      if(launch.kind==="tower"){const floor=finite(launch.options.floor)||1,first=!p.extraContent.relayTower.clearedFloors.includes(floor),claimId=`firstClear:relayTower:${floor}`;const receipt=first?RewardService.transact({sourceType:"relayTower",sourceId:String(floor),claimId,reward:withDiamonds(rewardForTower(floor,this.configs.economy.relayTower),diamondEconomy()?.towerFloor?.(floor)),mutateProfile:profile=>{const tower=profile.extraContent.relayTower;tower.clearedFloors.push(floor);tower.claimedFloors.push(floor);tower.highestClearedFloor=Math.max(tower.highestClearedFloor,floor);}}):{granted:false,replay:true,reward:{}};this.recordEvent("battleWin",1);return receipt;}
      if(launch.kind==="zone"){const nodeId=launch.options.nodeId,first=!p.extraContent.noSignalZone.claimedNodes.includes(nodeId),node=p.extraContent.noSignalZone.nodes.find(row=>row.id===nodeId),rewardKey=node?.type==="ELITE"?"eliteNode":node?.type==="RISK"?"riskNode":"normalNode",receipt=first?RewardService.transact({sourceType:"noSignalZone",sourceId:nodeId,claimId:`weekly:${week}:zone:${nodeId}`,reward:this.configs.economy.noSignalZone[rewardKey],mutateProfile:profile=>{const zone=profile.extraContent.noSignalZone;if(!zone.clearedNodes.includes(nodeId))zone.clearedNodes.push(nodeId);zone.claimedNodes.push(nodeId);zone.currentNode=nodeId;if(node?.type==="FINAL")zone.completed=true;}}):{granted:false,replay:true,reward:{}};this.recordEvent("battleWin",1);this.recordEvent("zoneNode",1);return receipt;}
      if(launch.kind==="simulation"){const score=finite(result.score)||Math.max(2500,9000-finite(result.elapsedSeconds)*20-finite(result.damageTaken)*5),tiers=this.configs.economy.tacticalSimulation.tiers,achieved=Object.entries(tiers).filter(([,row])=>score>=row.minimumScore).sort((a,b)=>a[1].minimumScore-b[1].minimumScore).at(-1)?.[0]||null,updated=clone(p);updated.extraContent.tacticalSimulation.bestScore=Math.max(updated.extraContent.tacticalSimulation.bestScore,score);updated.extraContent.tacticalSimulation.bestRewardTier=achieved||updated.extraContent.tacticalSimulation.bestRewardTier;RewardService.save(updated);this.recordEvent("simulationScore",score);this.recordEvent("battleWin",1);return{score,achieved};}
      return{granted:false};
    },
    claimSweepReward(choiceId){const p=RewardService.load(),state=p.extraContent.signalSweep;if(!state.completed)throw new Error("SWEEP_NOT_COMPLETE");const reward=this.configs.economy.signalSweep.rewardChoices.find(row=>row.id===choiceId);if(!reward)throw new Error("INVALID_REWARD_CHOICE");return RewardService.transact({sourceType:"signalSweep",sourceId:state.dailyKey,claimId:`signalSweep:${state.dailyKey}:firstClear`,reward:withDiamonds(reward,diamondEconomy()?.SIGNAL_SWEEP?.dailyFirstClear),mutateProfile:profile=>profile.extraContent.signalSweep.rewardClaimed=true});},
    quickBattle(tier,count=1){count=Math.max(1,Math.min(3,finite(count)));const p=RewardService.load(),state=p.extraContent.threatInterception,limit=this.configs.economy.threatInterception.dailyAttempts;if(!state.certification[tier])throw new Error("WEEKLY_CERTIFICATION_REQUIRED");if(state.dailyAttemptsUsed+count>limit)throw new Error("DAILY_ATTEMPTS_EXCEEDED");const base=this.configs.economy.threatInterception.tiers[tier],reward=withDiamonds(Object.fromEntries(Object.entries(base).map(([key,value])=>[key,value*count])),finite(diamondEconomy()?.INTERCEPTION?.perClear)*count),start=state.dailyAttemptsUsed+1,end=state.dailyAttemptsUsed+count,claimId=`quickBattle:${tier}:${state.dailyKey}:${start}-${end}`;const receipt=RewardService.transact({sourceType:"threatInterceptionQuick",sourceId:tier,claimId,reward,mutateProfile:profile=>{profile.extraContent.threatInterception.dailyAttemptsUsed+=count;profile.extraContent.threatInterception.weeklyBattleCount+=count;}});this.recordEvent("interceptionClear",count);return receipt;},
    relaySupplyStatus(timestamp=Date.now()){const p=RewardService.load(),last=Number(p.extraContent.relaySupply.lastClaimTimestamp)||timestamp,elapsed=Math.max(0,timestamp-last),rollback=timestamp<last,hours=Math.min(this.configs.economy.relaySupply.capHours,elapsed/HOUR);return{hours,rollback,capped:hours>=this.configs.economy.relaySupply.capHours,credits:Math.floor(hours*this.configs.economy.relaySupply.creditsPerHour),battleData:Math.floor(hours*this.configs.economy.relaySupply.battleDataPerHour),lastClaimTimestamp:last};},
    claimRelaySupply(timestamp=Date.now()){const status=this.relaySupplyStatus(timestamp),p=RewardService.load(),bucket=Math.max(0,Math.floor(status.lastClaimTimestamp/60000)),claimId=`relaySupply:${bucket}`;if(status.rollback||(!status.credits&&!status.battleData))return{granted:false,reason:status.rollback?"CLOCK_ROLLBACK":"EMPTY",status};return RewardService.transact({sourceType:"relaySupply",sourceId:String(p.extraContent.reset.dailyKey),claimId,reward:{credits:status.credits,battleData:status.battleData},mutateProfile:profile=>{profile.extraContent.relaySupply.lastClaimTimestamp=timestamp;profile.extraContent.relaySupply.clockRollbackDetected=false;profile.extraContent.relaySupply.lastReceipt={credits:status.credits,battleData:status.battleData,timestamp};}});},
    enterZoneNode(nodeId){const p=RewardService.load(),zone=p.extraContent.noSignalZone,node=zone.nodes.find(row=>row.id===nodeId);if(!node)throw new Error("UNKNOWN_ZONE_NODE");const unlocked=zone.clearedNodes.some(id=>(zone.nodes.find(row=>row.id===id)?.unlocks||[]).includes(nodeId));if(nodeId!=="START"&&!unlocked&&!zone.clearedNodes.includes(nodeId))throw new Error("ZONE_NODE_LOCKED");if(["COMBAT","ELITE","RISK","MIDBOSS","FINAL"].includes(node.type))return this.launch("zone",{nodeId});const reward=node.type==="SUPPLY"?this.configs.economy.noSignalZone.normalNode:{};return RewardService.transact({sourceType:"noSignalZone",sourceId:nodeId,claimId:`weekly:${zone.weeklyKey}:zone:${nodeId}`,reward,mutateProfile:profile=>{const current=profile.extraContent.noSignalZone;if(!current.clearedNodes.includes(nodeId))current.clearedNodes.push(nodeId);if(!current.claimedNodes.includes(nodeId))current.claimedNodes.push(nodeId);if(node.type==="RECORD"&&!current.records.includes(nodeId))current.records.push(nodeId);current.currentNode=nodeId;}});},
    claimSimulationTier(tier){const p=RewardService.load(),state=p.extraContent.tacticalSimulation,row=this.configs.economy.tacticalSimulation.tiers[tier];if(!row||state.bestScore<row.minimumScore)throw new Error("SIMULATION_TIER_NOT_REACHED");return RewardService.transact({sourceType:"tacticalSimulation",sourceId:tier,claimId:`scoreTier:tacticalSimulation:${state.weeklyKey}:${tier}`,reward:row,mutateProfile:profile=>profile.extraContent.tacticalSimulation.claimedRewardTiers.push(tier)});}
  };
  root.AfterSignalLiveRewardService=RewardService;
  root.AfterSignalResetService=ResetService;
  root.AfterSignalLiveService=LiveService;
})();
