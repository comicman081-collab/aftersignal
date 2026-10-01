(()=>{
  "use strict";
  const F=window.AfterSignalFoundation,R=window.AfterSignalRewards;
  if(!F||!R)throw new Error("Stage progression requires Foundation and Rewards");
  const stageOrder=stageId=>Number(F.STAGE_REGISTRY.get(stageId)?.stageOrder||0);
  const knownUnlocks=stage=>[...(stage?.unlocks||[])].filter(id=>F.CHARACTER_REGISTRY.has(id));
  const ensureStageEntitlements=stageId=>{
    const stage=F.STAGE_REGISTRY.get(stageId);if(!stage)throw new Error(`Unknown StageSpec ${stageId}`);
    const profile=R.load(),unlocks=knownUnlocks(stage),current=String(profile.progress?.currentPrologueStage||""),shouldAdvance=stageOrder(stageId)>stageOrder(current);
    if(unlocks.length)R.unlockCharacters(unlocks);
    const updated=R.load();
    if(shouldAdvance){updated.progress={...(updated.progress||{}),currentPrologueStage:stage.stageId};return R.save(updated);}
    return updated;
  };
  const mountStoryStage=()=>{const stageId=document.body?.dataset?.afStoryStage;if(!stageId)return null;return ensureStageEntitlements(stageId);};
  window.AfterSignalStageProgress=Object.freeze({version:"1.0",ensureStageEntitlements,mountStoryStage});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{try{mountStoryStage()}catch(error){console.error(error)}},{once:true});else try{mountStoryStage()}catch(error){console.error(error)}
})();
