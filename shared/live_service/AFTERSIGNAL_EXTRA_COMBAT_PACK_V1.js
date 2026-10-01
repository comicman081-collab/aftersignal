(()=>{
  "use strict";
  const F=window.AfterSignalFoundation;
  let launch=null;try{launch=JSON.parse(localStorage.getItem("aftersignal:extra-combat-launch:v1")||"null")}catch{}
  if(!launch?.battle)throw new Error("EXTRA_COMBAT_LAUNCH_MISSING");
  const sourceBattle=id=>F.BATTLE_REGISTRY.get(id);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const sourceBoss=launch.battle.bossId==="renewal_mira_voice_echo"?sourceBattle("p14combat")?.boss:sourceBattle("p07combat")?.boss;
  const boss=launch.battle.bossId&&sourceBoss?{...clone(sourceBoss),id:launch.battle.bossId,spawnWithWave:Math.max(0,(launch.battle.waves?.length||1)-1),runtimeMaxHp:Number(launch.battle.runtimeHp)||sourceBoss.runtimeMaxHp}:null;
  const waves=(launch.battle.waves||[["renewal_scavenger"]]).map((enemyIds,index)=>({
    enemyIds:[...(enemyIds||[])].filter(id=>id&&id!==boss?.id),
    enemyRuntime:(enemyIds||[]).filter(id=>id&&id!==boss?.id).map((id,slot)=>({runtimeMaxHp:launch.battle.modifier==="enemy_hp_20"?120:100,displayMaxHp:(index+1)*2200+slot*600}))
  }));
  const requiredKills=waves.reduce((sum,wave)=>sum+wave.enemyIds.length,0)+(boss?1:0);
  F.registerPack({
    id:`extra-content.${launch.kind}.v1`,kind:F.PACK_KINDS.StagePack,version:"1.0.0",
    stages:[{stageId:"P-99",chapterId:"EXTRA_CONTENT",stageOrder:9900,stageType:boss?F.StageType.MIDBOSS:F.StageType.SPECIAL,storyBefore:null,battleId:"extra-content-battle",storyAfter:null,background:`extra-${launch.battle.background||"P-04"}`,reward:{id:"extra_content_runtime_signal_only"},unlocks:[],deployment:{partyId:"extra_content_party",slots:launch.party||["mira"],availableCharacterIds:launch.party||["mira"],enemyIds:[...new Set(waves.flatMap(wave=>wave.enemyIds).concat(boss?.id||[]))],playerBaseline:614},nextStage:null,checkpoint:"extra_content_entry"}],
    battles:[{id:"extra-content-battle",objective:{type:boss?"DEFEAT_BOSS":"DEFEAT_ENCOUNTER",targetId:boss?.id||`${launch.kind}_waves`,surviveMs:null,requiredKills:Math.max(1,requiredKills)},waves,boss,environment:{layerProfile:"mixed",playerBaseline:614,spawnZones:["background1","background2","background3"]},rules:{allowSwitch:true,allowUltimate:!launch.battle.modifiers?.includes("ultimate_disabled"),allowRevive:true,autoTarget:true,timeLimitMs:Number(launch.battle.timeLimitMs)||90000,timeLimitProfile:boss?"BOSS":"NORMAL",enemyDamageScale:.18,enemyPressureBudget:3,reviveChargesPerMember:1}}]
  });
  window.__AF_EXTRA_COMBAT_LAUNCH__=launch;
})();
