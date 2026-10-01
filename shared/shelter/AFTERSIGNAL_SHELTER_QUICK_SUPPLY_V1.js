/* AFTER SIGNAL — shelter 빠른 보급 (quick supply) + 다이아 starter grant: pure rules, no DOM and no storage (2026-09-26).
   The shelter runtime (AFTERSIGNAL_SHELTER_RUNTIME_V2.js, block QUICK_SUPPLY_V1) re-reads the profile, calls apply()
   and saves once. Numbers come from shared/progression/AFTERSIGNAL_DIAMOND_ECONOMY_V1.js.
   - A use grants floor(hourlyRate x 2) relay supply P straight into idleRelay.relaySupply, like a normal idle claim
     at full efficiency. idleRelay.lastAccrualAt / pendingSupply (the normal accumulation) are never touched and the
     72 h cap does not apply.
   - Day state: profile.idleRelay.quickSupply = {dailyKey, used, lastAt}; a different dailyKey means 0 used today.
   - Currency: profile.resources.diamonds. Starter grant flag: profile.grants.diamondStarterV1 (shared profile).
   Browser: window.AfterSignalQuickSupply. Node (QA): module.exports, pass {economy} in the options. */
(function(root){
  "use strict";
  const int=value=>Math.max(0,Math.floor(Number(value)||0));
  const economyOf=options=>(options&&options.economy)||root.AfterSignalDiamondEconomy;
  function rules(options){const q=economyOf(options)?.QUICK_SUPPLY;if(!q||typeof q.cost!=="function")throw new Error("DIAMOND_ECONOMY_MISSING");return q}
  function state(profile,day){const s=profile&&profile.idleRelay&&profile.idleRelay.quickSupply;return s&&s.dailyKey===day?{dailyKey:day,used:int(s.used)}:{dailyKey:day,used:0}}
  function status(profile,options={}){
    const q=rules(options),day=options.day,s=state(profile,day),max=int(q.maxPerDay),left=Math.max(0,max-s.used);
    const next=left>0?s.used+1:null,cost=next?q.cost(next):null,diamonds=int(profile&&profile.resources&&profile.resources.diamonds);
    const rate=int(options.rate),grant=Math.floor(rate*Number(q.hours||0));
    const reason=left<=0?"LIMIT":grant<=0?"NO_RATE":diamonds<cost?"DIAMONDS":null;
    return {day,used:s.used,left,max,next,cost,free:cost===0,diamonds,rate,hours:q.hours,grant,available:!reason,reason};
  }
  function apply(profile,options={}){
    const before=status(profile,options);
    if(!before.available)return {ok:false,reason:before.reason,status:before};
    if(options.expectedCost!==undefined&&options.expectedCost!==null&&Number(options.expectedCost)!==before.cost)return {ok:false,reason:"COST_CHANGED",status:before};
    profile.resources.diamonds=before.diamonds-before.cost;
    profile.idleRelay.relaySupply=int(profile.idleRelay.relaySupply)+before.grant;
    profile.idleRelay.quickSupply={dailyKey:before.day,used:before.used+1,lastAt:new Date(options.now??Date.now()).toISOString()};
    return {ok:true,granted:before.grant,cost:before.cost,use:before.next,status:status(profile,options)};
  }
  // one-time starter grant on the shared profile; returns true only when it granted now
  function grantStarter(profile,options={}){
    const economy=economyOf(options),flag=economy?.STARTER_GRANT_FLAG||"diamondStarterV1",amount=int(economy?.STARTER_GRANT);
    if(!profile||typeof profile!=="object"||!amount)return false;
    profile.grants=profile.grants&&typeof profile.grants==="object"?profile.grants:{};
    if(profile.grants[flag])return false;
    profile.resources=profile.resources&&typeof profile.resources==="object"?profile.resources:{};
    profile.resources.diamonds=int(profile.resources.diamonds)+amount;
    profile.grants[flag]=new Date(options.now??Date.now()).toISOString();
    return true;
  }
  const api=Object.freeze({version:"1.0.0",state,status,apply,grantStarter});
  root.AfterSignalQuickSupply=api;
  if(typeof module==="object"&&module&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
