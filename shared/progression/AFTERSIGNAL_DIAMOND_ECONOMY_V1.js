/* AFTER SIGNAL — diamond (다이아) economy constants, shared by every page (created 2026-09-26, shelter quick supply).
   The currency is stored as resources.diamonds in the shared profile (localStorage aftersignal:profile:v3); older
   profiles read it as 0. Other features ADD their own values to this same object (sources, prices); never replace it.
   Values here are provisional economy numbers the user can change.
   Browser: window.AfterSignalDiamondEconomy. Node (QA): module.exports. */
(function(root){
  "use strict";
  const economy=root.AfterSignalDiamondEconomy||{};
  economy.version=economy.version||"1.0.0";
  economy.RESOURCE_KEY="diamonds";                 // profile.resources.diamonds
  economy.STARTER_GRANT=1000;                      // one time per profile
  economy.STARTER_GRANT_FLAG="diamondStarterV1";   // profile.grants.diamondStarterV1 = ISO time of the grant
  // 빠른 보급 (shelter idle popup): 2 hours of idle relay supply at the current hourly rate, 8 uses per day.
  // n-th use of the day (1..8) costs: free, 50, 100, 150, 200, 250, 300, 350 (1,400 per day in total).
  economy.QUICK_SUPPLY={
    maxPerDay:8,
    hours:2,
    cost(n){n=Number(n);if(!Number.isInteger(n)||n<1||n>8)return null;return n===1?0:50*(n-1)}
  };
  // >>> DIAMOND_SOURCES_V1 (2026-09-26, reward screen + live service): gacha price and earn sources. Provisional values
  // the user can tune here; every page reads them from this object (see HISTORY/2026-09-26_DIAMOND_ECONOMY_V1.md).
  // Gacha price. No gacha screen exists yet; a future gacha must read these.
  economy.GACHA={pull:200,pull10:2000};
  // Story stages: FIRST clear only (profile.clears[stage] was 0 before the claim), so replays pay nothing.
  // Classes come from the stage registries (Foundation / Stage Flow stageType + boss entity rank):
  // P-07 무신호 감시자 and P-14 미라의 목소리를 가진 것 are MIDBOSS stages; no chapter-boss (BOSS) stage exists yet.
  // P-03 and P-05 are story-only (no battle, no reward screen); P-10..P-13 do not exist.
  economy.STAGE_FIRST_CLEAR={normal:30,midboss:150,chapterBoss:300};
  economy.STAGE_CLASS={p01:"normal",p02:"normal",p04:"normal",p06:"normal",p07:"midboss",p08:"normal",p09:"normal",p14:"midboss"};
  economy.STAGE_CLASS_DEFAULT="normal";   // a later combat stage missing from STAGE_CLASS still pays the normal amount
  economy.stageKey=stage=>String(stage||"").trim().toLowerCase().replace("-","");
  economy.stageClass=stage=>economy.STAGE_CLASS[economy.stageKey(stage)]||economy.STAGE_CLASS_DEFAULT;
  economy.stageFirstClear=stage=>economy.stageKey(stage)?Math.max(0,Math.floor(Number(economy.STAGE_FIRST_CLEAR[economy.stageClass(stage)])||0)):0;
  // 위협체 요격: every clear inside the existing daily attempt cap (real battle or quick battle, 3 per day), plus a
  // one-time bonus the first time each tier (C/B/A/S) is beaten in a real battle.
  economy.INTERCEPTION={perClear:50,tierFirstClear:100};
  // 릴레이 타워: first clear of each floor, plus a bonus on every 5th floor (5, 10, 15, 20 ...). Replays pay nothing.
  economy.TOWER={perFloorFirstClear:30,milestoneEvery:5,milestoneBonus:100};
  economy.towerFloor=floor=>{floor=Math.floor(Number(floor));if(!(floor>0))return 0;const t=economy.TOWER;return t.perFloorFirstClear+(t.milestoneEvery>0&&floor%t.milestoneEvery===0?t.milestoneBonus:0)};
  // 릴레이 의뢰: completing the day's set (3 of the 5 daily contracts) pays once per day (the 3-complete milestone).
  economy.DAILY_CONTRACTS={setComplete:100};
  // 신호 소탕전: the once-per-day first-completion reward.
  economy.SIGNAL_SWEEP={dailyFirstClear:20};
  // <<< DIAMOND_SOURCES_V1
  // >>> CAMPAIGN_CH01_05_V1 (2026-09-27): main-story chapters. Stage keys follow stageKey ("CH01-07" -> "ch0107").
  // Each chapter has two midbosses (07, 14) and one chapter boss (20); the other stages use the normal default.
  for(let chapter=1;chapter<=5;chapter+=1){const id="ch"+String(chapter).padStart(2,"0");economy.STAGE_CLASS[id+"07"]="midboss";economy.STAGE_CLASS[id+"14"]="midboss";economy.STAGE_CLASS[id+"20"]="chapterBoss";}
  // <<< CAMPAIGN_CH01_05_V1
  // >>> CAMPAIGN_CH06_15_V1 (2026-09-28): chapters 06-15 have 10 stages - midbosses 04 and 07, chapter boss 10.
  for(let chapter=6;chapter<=15;chapter+=1){const id="ch"+String(chapter).padStart(2,"0");economy.STAGE_CLASS[id+"04"]="midboss";economy.STAGE_CLASS[id+"07"]="midboss";economy.STAGE_CLASS[id+"10"]="chapterBoss";}
  // <<< CAMPAIGN_CH06_15_V1
  root.AfterSignalDiamondEconomy=economy;
  if(typeof module==="object"&&module&&module.exports)module.exports=economy;
})(typeof window!=="undefined"?window:globalThis);
