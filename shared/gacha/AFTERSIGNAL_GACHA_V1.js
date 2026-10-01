/* AFTER SIGNAL — character recruit (모집 / gacha) V1: rules, pure functions and the save-profile adapter (2026-09-26).
   User rules (2026-09-26): a playable character is owned ONLY through recruiting; appearing in the story never grants
   one. SSR 2 % / SR 48 % / R 50 %, uniform inside a rarity. 10-pull: if slots 1-9 are all R, slot 10 is SR or SSR
   (48:2). Half pity: the 100th pull since the last SSR is a guaranteed SSR (any SSR resets it). Mileage: +1 per pull,
   never reset by an SSR; 200 mileage = one SSR of the player's choice. Duplicates follow GDD §9.11: first copy 0★, each
   duplicate +1★ up to 5★, +5 % base ATK/HP/DEF per ★; after 5★ a duplicate becomes 별의 가루 (resources.starDust).
   No pickup banner yet; banners are data (BANNER_DEFS) and the pickup type is reserved (disabled).
   Currency: a banner's own ticket first (ticketKey; reserved names resources.standardRecruitTicket /
   resources.pickupRecruitTicket, not granted yet), then 다이아 (resources.diamonds, common to every banner). Prices come
   from AfterSignalDiamondEconomy.GACHA {pull, pull10}. Pity and mileage are kept per banner TYPE.
   Save data lives in the shared profile (localStorage aftersignal:profile:v3):
     profile.gacha = {schema:1, owned:{id:{stars,copies,firstAt,lastAt}}, banners:{type:{sinceSsr,mileage,pulls}},
                      history:[last 100 pulls, newest first], seq, lastTxn, grants:{firstRecruitV1}, migration:{v1}}
     profile.resources.diamonds / starDust (and the future ticket keys).
   A pull is resolved, paid and saved in ONE localStorage write before any animation plays (refresh-safe).
   Who can fight: prologue battles field the stage's story guest squad (PROLOGUE_GUESTS, not owned; the foundation's
   GACHA_RECRUIT_V1 block keeps the same table) plus owned characters; everything after the prologue uses owned only.
   Repeat operations use the lobby formation (FORMATION_KEY = the foundation PartyLoadout slot of stage P-99).
   Browser: window.AfterSignalGacha. Node (QA): module.exports. */
(function(root){
  "use strict";
  const VERSION="1.0.0";
  const PROFILE_KEY="aftersignal:profile:v3";
  const SCHEMA=1;
  const RARITIES=Object.freeze(["SSR","SR","R"]);
  const RATE_BP=Object.freeze({SSR:200,SR:4800,R:5000});   // per pull, basis points of 10,000 (2 % / 48 % / 50 %)
  const GUARANTEE_BP=Object.freeze({SSR:200,SR:4800});      // 10-pull slot 10 after nine R: SR:SSR = 48:2 (96 % / 4 %)
  const HALF_PITY=100;                                      // pull #100 since the last SSR is a guaranteed SSR
  const MILEAGE=Object.freeze({perPull:1,exchangeCost:200});
  const STAR_MAX=5,STAR_STAT_BONUS=.05;                     // GDD §9.11 finalBaseStat = baseStat x (1 + 0.05 x star)
  const STAR_DUST=Object.freeze({SSR:100,SR:30,R:10});     // provisional: duplicate after 5★ -> 별의 가루
  const HISTORY_MAX=100;
  const DEFAULT_PRICE=Object.freeze({one:200,ten:2000});    // fallback when AfterSignalDiamondEconomy.GACHA is missing
  const FIRST_RECRUIT_FLAG="firstRecruitV1";                // profile.gacha.grants.firstRecruitV1 = {grantedAt, usedAt}
  const FIRST_RECRUIT_COUNT=10;
  // Reserved future banner-specific currencies (not granted or shown yet; user note 2026-09-26).
  const TICKET_KEYS=Object.freeze({standard:"standardRecruitTicket",pickup:"pickupRecruitTicket"});
  const BANNER_DEFS=Object.freeze({
    standard:Object.freeze({id:"standard",type:"standard",enabled:true,title:"상시 모집",subtitle:"RELAY RECRUIT",
      ticketKey:null,reservedTicketKey:TICKET_KEYS.standard,pool:"ALL",featured:Object.freeze(["noella","astra","orin"])}),
    // reserved: a future pickup banner has its own ticket, counters (pity/mileage by type) and rate-up list
    pickup:Object.freeze({id:"pickup",type:"pickup",enabled:false,title:"픽업 모집",subtitle:"PICKUP RECRUIT",
      ticketKey:TICKET_KEYS.pickup,reservedTicketKey:TICKET_KEYS.pickup,pool:"ALL",pickupIds:Object.freeze([]),featured:Object.freeze([])})
  });
  // 별의 가루 교환 (provisional rates, see HISTORY/2026-09-26_GACHA_RECRUIT_V1.md). Grant keys are the shared-profile keys:
  // the shared profile stores 무기 모듈 as resources.weaponModules (the shelter maps it to enhancementShards on load).
  const DUST_EXCHANGE=Object.freeze([
    Object.freeze({id:"dust_skill_manual",name:"스킬 매뉴얼",unit:1,cost:10,grant:Object.freeze({skillManual:1})}),
    Object.freeze({id:"dust_weapon_modules",name:"무기 모듈",unit:2,cost:10,grant:Object.freeze({weaponModules:2})}),
    Object.freeze({id:"dust_battle_data",name:"전투 기록",unit:1000,cost:10,grant:Object.freeze({battleData:1000})}),
    Object.freeze({id:"dust_credits",name:"크레딧",unit:2000,cost:10,grant:Object.freeze({credits:2000})})
  ]);
  // Prologue story guest squad (NOT owned): who each prologue stage lends the player. Cumulative by stage number,
  // mirroring the original stage unlock lists (the MODULAR_BAKE_V1 test additions to P-14 are not guests).
  const PROLOGUE_GUESTS=Object.freeze([["P-01",Object.freeze(["mira"])],["P-06",Object.freeze(["haneul"])],["P-09",Object.freeze(["sera"])],["P-14",Object.freeze(["astra","tessa","naru"])]]);
  const PROLOGUE_LAST=14;

  const int=value=>{const n=Math.floor(Number(value));return Number.isFinite(n)&&n>0?n:0};
  const obj=value=>value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  const isoOf=now=>new Date(typeof now==="function"?now():(now??Date.now())).toISOString();
  const codeNum=spec=>Number(String(spec?.characterId||"").match(/(\d+)/)?.[1]||999);

  /* ---------- pool / rates ---------- */
  // pool = {SSR:[ids], SR:[ids], R:[ids]} from the shelter roster (every roster entry has combat art: the bake tool
  // writes the roster from MODULAR_BAKE_V1). combatIds (optional) further limits it, e.g. to MODULAR_BAKE_V1 keys.
  function buildPool(roster,{combatIds=null}={}){
    const pool={SSR:[],SR:[],R:[]},allowed=Array.isArray(combatIds)?new Set(combatIds):null;
    for(const [id,spec] of Object.entries(obj(roster))){
      if(!RARITIES.includes(spec?.rarity))continue;
      if(allowed&&!allowed.has(id))continue;
      pool[spec.rarity].push(id);
    }
    for(const rarity of RARITIES)pool[rarity].sort((a,b)=>codeNum(roster[a])-codeNum(roster[b])||a.localeCompare(b));
    return pool;
  }
  const poolIds=pool=>RARITIES.flatMap(rarity=>pool?.[rarity]||[]);
  const rarityOf=(pool,id)=>RARITIES.find(rarity=>(pool?.[rarity]||[]).includes(id))||null;
  // 확률 공개: percentages per rarity and per character (base pull, 10-pull guarantee slot, half-pity pull)
  function rateTable(pool){
    const total=GUARANTEE_BP.SSR+GUARANTEE_BP.SR,rows=[];
    for(const rarity of RARITIES){
      const ids=pool?.[rarity]||[],n=ids.length;
      for(const id of ids)rows.push({id,rarity,basePercent:n?RATE_BP[rarity]/100/n:0,guaranteePercent:n&&GUARANTEE_BP[rarity]?GUARANTEE_BP[rarity]/total*100/n:0,pityPercent:rarity==="SSR"&&n?100/n:0});
    }
    return {rarity:{SSR:RATE_BP.SSR/100,SR:RATE_BP.SR/100,R:RATE_BP.R/100},guarantee:{SSR:GUARANTEE_BP.SSR/total*100,SR:GUARANTEE_BP.SR/total*100},halfPity:HALF_PITY,mileageCost:MILEAGE.exchangeCost,rows};
  }

  /* ---------- randomness (crypto.getRandomValues, rejection sampling: no modulo bias) ---------- */
  function cryptoRng(cryptoObject){
    const c=cryptoObject||root.crypto;
    if(!c||typeof c.getRandomValues!=="function")throw new Error("CRYPTO_UNAVAILABLE");
    const buffer=new Uint32Array(256);let index=buffer.length;
    return ()=>{if(index>=buffer.length){c.getRandomValues(buffer);index=0}return buffer[index++]};
  }
  function randInt(rng,n){
    n=Math.floor(n);if(!(n>=1))throw new Error("RANGE");
    const limit=Math.floor(4294967296/n)*n;let x;
    do x=rng()>>>0;while(x>=limit);
    return x%n;
  }
  function drawRarity(rng,table){
    const entries=RARITIES.filter(rarity=>table[rarity]>0).map(rarity=>[rarity,table[rarity]]),total=entries.reduce((sum,[,bp])=>sum+bp,0);
    let roll=randInt(rng,total);
    for(const [rarity,bp] of entries){if(roll<bp)return rarity;roll-=bp}
    return entries[entries.length-1][0];
  }

  /* ---------- counters / pity / mileage (per banner TYPE) ---------- */
  const freshCounters=()=>({sinceSsr:0,mileage:0,pulls:0});
  function countersOf(gacha,type){const c=obj(obj(gacha?.banners)[type]);return {sinceSsr:Math.min(int(c.sinceSsr),HALF_PITY-1),mileage:int(c.mileage),pulls:int(c.pulls)}}
  const pullsToPity=counters=>HALF_PITY-Math.min(int(counters?.sinceSsr),HALF_PITY-1); // 1 = the next pull is a guaranteed SSR
  // Resolve count (1 or 10) pulls. Pure: returns the pulls and the new counters, mutates nothing.
  function resolveBatch({count,pool,counters,rng}){
    if(count!==1&&count!==10)throw new Error("COUNT");
    for(const rarity of RARITIES)if(!(pool?.[rarity]||[]).length)throw new Error("EMPTY_POOL_"+rarity);
    let since=Math.min(int(counters?.sinceSsr),HALF_PITY-1),mileage=int(counters?.mileage),pulls=int(counters?.pulls);
    const out=[];
    for(let slot=1;slot<=count;slot++){
      let rarity,reason="BASE";
      if(since+1>=HALF_PITY){rarity="SSR";reason="PITY"}
      else if(count===10&&slot===10&&out.every(p=>p.rarity==="R")){rarity=drawRarity(rng,GUARANTEE_BP);reason="GUARANTEE"}
      else rarity=drawRarity(rng,RATE_BP);
      const list=pool[rarity],id=list[randInt(rng,list.length)];
      since=rarity==="SSR"?0:since+1;mileage+=MILEAGE.perPull;pulls++;
      out.push({slot,id,rarity,reason});
    }
    return {pulls:out,counters:{sinceSsr:since,mileage,pulls}};
  }

  /* ---------- duplicates / stars / star dust ---------- */
  const clampStars=value=>Math.max(0,Math.min(STAR_MAX,int(value)));
  const statMultiplier=stars=>1+STAR_STAT_BONUS*clampStars(stars);
  // Adds one copy to owned (mutates the map). NEW (0★) -> STAR (+1★ up to 5★) -> DUST (별의 가루 by rarity)
  function acquire(owned,id,rarity,at){
    const entry=owned[id];
    if(!entry){owned[id]={stars:0,copies:1,firstAt:at,lastAt:at};return {outcome:"NEW",stars:0,dust:0}}
    entry.copies=Math.max(1,int(entry.copies))+1;entry.lastAt=at;
    const stars=clampStars(entry.stars);
    if(stars<STAR_MAX){entry.stars=stars+1;return {outcome:"STAR",stars:entry.stars,dust:0}}
    entry.stars=STAR_MAX;return {outcome:"DUST",stars:STAR_MAX,dust:STAR_DUST[rarity]||0};
  }

  /* ---------- banners / prices / cost ---------- */
  function priceOf(economy){const g=obj(economy?.GACHA);return {one:int(g.pull)||DEFAULT_PRICE.one,ten:int(g.pull10)||DEFAULT_PRICE.ten}}
  function resolveBanner(idOrDef,{economy}={}){
    const def=typeof idOrDef==="string"?BANNER_DEFS[idOrDef]:idOrDef;
    if(!def||typeof def!=="object")return null;
    const price=priceOf(economy);
    return {...def,diamondCost:{one:int(def.diamondCost?.one)||price.one,ten:int(def.diamondCost?.ten)||price.ten}};
  }
  // Cost of `count` pulls: the banner's own ticket first (if ticketKey is set and held), 다이아 for the rest.
  // A 10-pull paid fully in diamonds costs diamondCost.ten, a partly ticketed one pays diamondCost.one per remaining pull.
  function resolveCost({banner,count,resources,free=false}){
    const balance=int(resources?.diamonds);
    if(free)return {ok:true,free:true,ticketKey:null,tickets:0,diamonds:0,balance,ticketBalance:0,shortBy:0,reason:null};
    const key=banner?.ticketKey||null,held=key?int(resources?.[key]):0,tickets=Math.min(count,held),rest=count-tickets;
    const cost=banner?.diamondCost||DEFAULT_PRICE,diamonds=rest<=0?0:rest===10&&count===10?int(cost.ten):rest*int(cost.one);
    const ok=diamonds<=balance;
    return {ok,free:false,ticketKey:key,tickets,diamonds,balance,ticketBalance:held,shortBy:ok?0:diamonds-balance,reason:ok?null:"DIAMONDS"};
  }

  /* ---------- guests / ownership ---------- */
  function guestIdsForStage(stageId){
    const m=String(stageId||"").trim().toUpperCase().match(/^P-?(\d+)$/);if(!m)return [];
    const n=Number(m[1]);if(!(n>=1&&n<=PROLOGUE_LAST))return [];
    const out=[];for(const [stage,ids] of PROLOGUE_GUESTS)if(Number(stage.slice(2))<=n)for(const id of ids)if(!out.includes(id))out.push(id);
    return out;
  }
  const ownedIds=profile=>Object.keys(obj(obj(profile?.gacha).owned));
  const isOwned=(profile,id)=>Object.prototype.hasOwnProperty.call(obj(obj(profile?.gacha).owned),id);
  const starsOf=(profile,id)=>isOwned(profile,id)?clampStars(profile.gacha.owned[id].stars):null;
  // true once the save has a recruit block: from then on the crew/party is the owned set (legacy saves keep old rules)
  const hasBlock=profile=>Boolean(profile?.gacha&&typeof profile.gacha==="object"&&!Array.isArray(profile.gacha));
  // prologue finished: the flag, or a recorded P-14 clear (reward.html resets prologueComplete when a prologue stage
  // is replayed, while clears["p-14"] stays)
  const prologueDone=profile=>profile?.progress?.prologueComplete===true||Object.entries(obj(profile?.clears)).some(([key,count])=>/^p-?14$/i.test(key)&&Number(count)>0);
  // characters usable in a stage's party: owned + that stage's story guests (prologue only)
  const usableIds=(profile,stageId)=>[...new Set([...guestIdsForStage(stageId),...ownedIds(profile)])];
  const RANK_ORDER=Object.freeze({SSR:0,SR:1,R:2});
  // roster order: SSR > SR > R, then character code (stable while stars change)
  const ownedInOrder=(profile,{roster}={})=>ownedIds(profile).sort((a,b)=>(RANK_ORDER[roster?.[a]?.rarity]??3)-(RANK_ORDER[roster?.[b]?.rarity]??3)||codeNum(roster?.[a])-codeNum(roster?.[b])||(a<b?-1:a>b?1:0));
  // default auto party for content without a saved loadout: owned, SSR > SR > R, then stars, then code
  function defaultParty(profile,{roster,max=5}={}){
    return ownedIds(profile).sort((a,b)=>(RANK_ORDER[roster?.[a]?.rarity]??3)-(RANK_ORDER[roster?.[b]?.rarity]??3)||(starsOf(profile,b)-starsOf(profile,a))||codeNum(roster?.[a])-codeNum(roster?.[b])).slice(0,max);
  }
  // repeat operations (extra content, combat stage P-99) use the foundation PartyLoadout slot of that stage as the
  // lobby formation ("출격 편성"); only owned characters count, an empty/unusable formation falls back to defaultParty
  const FORMATION_STAGE="P-99",FORMATION_KEY=`aftersignal:party-loadout:${FORMATION_STAGE}:v1`,FORMATION_PARTY_ID="extra_content_party";
  function formationParty(profile,{saved=null,roster,max=5}={}){
    const owned=new Set(ownedIds(profile)),ids=[];
    for(const id of Array.isArray(saved?.characterIds)?saved.characterIds:[])if(typeof id==="string"&&owned.has(id)&&!ids.includes(id)&&ids.length<max)ids.push(id);
    return ids.length?ids:defaultParty(profile,{roster,max});
  }
  function formationSnapshot(ids){
    const out=[];for(const id of Array.isArray(ids)?ids:[])if(typeof id==="string"&&!out.includes(id)&&out.length<5)out.push(id);
    return {schemaVersion:1,id:FORMATION_PARTY_ID,characterIds:Array.from({length:5},(_,slot)=>out[slot]||null)};
  }

  /* ---------- profile block: migration / normalisation ---------- */
  // Missing block: a profile that already finished the prologue (a save from before recruiting existed) keeps every
  // character it had unlocked as owned at 0★ (grandfathered once, recorded in migration.v1). Any other profile starts
  // with nothing owned. Pages that do not load this module may stamp {schema:1,migration:{v1:{mode:"NEW"}}}.
  function ensureGacha(profile,{now,poolIds:known=null}={}){
    if(!profile||typeof profile!=="object")throw new Error("PROFILE_REQUIRED");
    if(!profile.resources||typeof profile.resources!=="object")profile.resources={};
    let g=profile.gacha;
    if(!g||typeof g!=="object"||Array.isArray(g)){
      const at=isoOf(now),legacy=prologueDone(profile);
      const unlocked=new Set([...(Array.isArray(profile.unlockedCharacterIds)?profile.unlockedCharacterIds:[]),...Object.entries(obj(profile.characters)).filter(([,value])=>value?.unlocked===true).map(([id])=>id)]);
      const candidates=Array.isArray(known)?known:[...unlocked];
      const grandfathered=legacy?candidates.filter(id=>unlocked.has(id)):[];
      g={schema:SCHEMA,owned:{},banners:{},history:[],seq:0,lastTxn:null,grants:{},migration:{v1:{at,mode:legacy?"LEGACY_GRANDFATHER":"NEW",grandfathered}}};
      for(const id of grandfathered)g.owned[id]={stars:0,copies:1,firstAt:at,lastAt:at,source:"LEGACY"};
      profile.gacha=g;
    }
    g.schema=SCHEMA;
    g.owned=obj(g.owned);g.banners=obj(g.banners);g.grants=obj(g.grants);g.migration=obj(g.migration);
    g.history=Array.isArray(g.history)?g.history.slice(0,HISTORY_MAX):[];
    g.seq=int(g.seq);if(g.lastTxn===undefined)g.lastTxn=null;
    if(!g.migration.v1)g.migration.v1={at:isoOf(now),mode:"STAMPED",grandfathered:[]};
    for(const [id,entry] of Object.entries(g.owned)){if(!entry||typeof entry!=="object"){delete g.owned[id];continue}entry.stars=clampStars(entry.stars);entry.copies=Math.max(1,int(entry.copies))}
    return g;
  }
  function firstRecruitState(profile){const s=obj(obj(obj(profile?.gacha).grants)[FIRST_RECRUIT_FLAG]);const granted=Boolean(s.grantedAt),used=Boolean(s.usedAt);return {granted,used,available:granted&&!used,grantedAt:s.grantedAt||null,usedAt:s.usedAt||null}}
  // one free 10-pull per profile; idempotent (true only when it granted now)
  function grantFirstRecruit(profile,{now}={}){
    const g=ensureGacha(profile,{now});
    if(obj(g.grants[FIRST_RECRUIT_FLAG]).grantedAt)return false;
    g.grants[FIRST_RECRUIT_FLAG]={grantedAt:isoOf(now),usedAt:null};return true;
  }

  /* ---------- transactions on a profile object (pure: the caller saves) ---------- */
  function pushHistory(g,txn){
    const rows=txn.results.map(r=>({seq:txn.seq,slot:r.slot,at:txn.at,banner:txn.type,id:r.id,rarity:r.rarity,outcome:r.outcome,stars:r.stars,dust:r.dust,reason:r.reason,source:txn.source}));
    g.history=[...rows.reverse(),...g.history].slice(0,HISTORY_MAX);
  }
  function applyPull(profile,{banner,count,free=false,pool,rng,now,requestId=null,poolIds:known=null}={}){
    const g=ensureGacha(profile,{now,poolIds:known});
    if(requestId&&g.lastTxn?.requestId===requestId)return {ok:true,replay:true,txn:g.lastTxn};
    if(!banner||banner.enabled===false)return {ok:false,reason:"BANNER_DISABLED"};
    if(free){if(!firstRecruitState(profile).available)return {ok:false,reason:"FREE_UNAVAILABLE"};count=FIRST_RECRUIT_COUNT}
    if(count!==1&&count!==10)return {ok:false,reason:"COUNT"};
    const cost=resolveCost({banner,count,resources:profile.resources,free});
    if(!cost.ok)return {ok:false,reason:cost.reason,cost};
    let batch;try{batch=resolveBatch({count,pool,counters:countersOf(g,banner.type),rng})}catch(error){return {ok:false,reason:String(error?.message||error)}}
    const at=isoOf(now);
    if(cost.tickets)profile.resources[cost.ticketKey]=int(profile.resources[cost.ticketKey])-cost.tickets;
    if(cost.diamonds)profile.resources.diamonds=int(profile.resources.diamonds)-cost.diamonds;
    let dust=0;
    const results=batch.pulls.map(pull=>{const got=acquire(g.owned,pull.id,pull.rarity,at);dust+=got.dust;return {...pull,...got}});
    if(dust)profile.resources.starDust=int(profile.resources.starDust)+dust;
    g.banners[banner.type]=batch.counters;g.seq+=1;
    const source=free?"FREE_FIRST":cost.tickets&&cost.diamonds?"MIXED":cost.tickets?"TICKET":"DIAMOND";
    const txn={id:`${banner.type}-${g.seq}`,seq:g.seq,requestId,at,kind:"PULL",banner:banner.id,type:banner.type,count,source,cost:{diamonds:cost.diamonds,tickets:cost.tickets,ticketKey:cost.ticketKey},results,dust,counters:{...batch.counters},ack:false};
    if(free)g.grants[FIRST_RECRUIT_FLAG]={...obj(g.grants[FIRST_RECRUIT_FLAG]),usedAt:at};
    g.lastTxn=txn;pushHistory(g,txn);
    return {ok:true,txn};
  }
  // 200 mileage -> one SSR of the player's choice (normal duplicate rule applies). Pity is not touched.
  function applyMileageExchange(profile,{banner,characterId,pool,now,requestId=null,poolIds:known=null}={}){
    const g=ensureGacha(profile,{now,poolIds:known});
    if(requestId&&g.lastTxn?.requestId===requestId)return {ok:true,replay:true,txn:g.lastTxn};
    if(!banner||banner.enabled===false)return {ok:false,reason:"BANNER_DISABLED"};
    if(!(pool?.SSR||[]).includes(characterId))return {ok:false,reason:"NOT_SSR"};
    const counters=countersOf(g,banner.type);
    if(counters.mileage<MILEAGE.exchangeCost)return {ok:false,reason:"MILEAGE",mileage:counters.mileage};
    const at=isoOf(now),got=acquire(g.owned,characterId,"SSR",at);
    if(got.dust)profile.resources.starDust=int(profile.resources.starDust)+got.dust;
    counters.mileage-=MILEAGE.exchangeCost;g.banners[banner.type]=counters;g.seq+=1;
    const txn={id:`${banner.type}-${g.seq}`,seq:g.seq,requestId,at,kind:"MILEAGE",banner:banner.id,type:banner.type,count:1,source:"MILEAGE",cost:{mileage:MILEAGE.exchangeCost,diamonds:0,tickets:0,ticketKey:null},results:[{slot:1,id:characterId,rarity:"SSR",reason:"MILEAGE",...got}],dust:got.dust,counters:{...counters},ack:false};
    g.lastTxn=txn;pushHistory(g,txn);
    return {ok:true,txn};
  }
  function applyDustExchange(profile,{itemId,qty=1,now}={}){
    ensureGacha(profile,{now});
    const item=DUST_EXCHANGE.find(entry=>entry.id===itemId);if(!item)return {ok:false,reason:"ITEM"};
    qty=int(qty);if(!qty)return {ok:false,reason:"QTY"};
    const cost=item.cost*qty,have=int(profile.resources.starDust);
    if(have<cost)return {ok:false,reason:"DUST",cost,have};
    profile.resources.starDust=have-cost;
    const granted={};for(const [key,value] of Object.entries(item.grant)){profile.resources[key]=int(profile.resources[key])+value*qty;granted[key]=value*qty}
    return {ok:true,item:item.id,qty,cost,granted};
  }
  function statusOf(profile,{banner,pool}={}){
    const g=obj(profile?.gacha),counters=countersOf(g,banner?.type),resources=obj(profile?.resources);
    const ticketKey=banner?.ticketKey||null;
    return {
      diamonds:int(resources.diamonds),starDust:int(resources.starDust),ticketKey,tickets:ticketKey?int(resources[ticketKey]):0,
      sinceSsr:counters.sinceSsr,pityIn:pullsToPity(counters),halfPity:HALF_PITY,mileage:counters.mileage,mileageCost:MILEAGE.exchangeCost,canExchange:counters.mileage>=MILEAGE.exchangeCost,pulls:counters.pulls,
      first:firstRecruitState(profile),cost:{one:resolveCost({banner,count:1,resources}),ten:resolveCost({banner,count:10,resources})},
      ownedCount:ownedIds(profile).length,poolCount:poolIds(pool).length,pendingReveal:g.lastTxn&&g.lastTxn.ack===false?g.lastTxn:null
    };
  }

  /* ---------- save adapter: re-read, mutate, compare-and-write once ---------- */
  function createStore(options={}){
    const storage=options.storage||root.localStorage,key=options.key||PROFILE_KEY;
    const now=options.now||(()=>Date.now());
    let rng=options.rng||null;
    const roster=()=>options.roster||root.AfterSignalShelter?.characters||{};
    const economy=()=>options.economy||root.AfterSignalDiamondEconomy||null;
    const pool=()=>buildPool(roster(),{combatIds:options.combatIds||null});
    const banner=id=>resolveBanner(id||"standard",{economy:economy()});
    const parse=raw=>{try{const p=JSON.parse(raw||"null");return p&&typeof p==="object"&&!Array.isArray(p)?p:null}catch{return null}};
    const emit=(name,detail)=>{try{root.dispatchEvent?.(new CustomEvent(name,{detail}))}catch{}};
    function view(){const p=parse(storage.getItem(key));if(!p)return null;ensureGacha(p,{now:now(),poolIds:poolIds(pool())});return p}
    // One write per call. mutate(profile) -> {ok, changed?}; nothing is written when !ok or changed===false.
    function transact(mutate){
      for(let attempt=0;attempt<3;attempt++){
        const raw=storage.getItem(key),profile=parse(raw);
        if(!profile)return {ok:false,reason:"NO_PROFILE"};
        const result=mutate(profile);
        if(!result?.ok||result.changed===false||result.replay)return {...result,profile};
        if(storage.getItem(key)!==raw)continue; // another writer changed the save meanwhile: redo on the fresh copy
        try{storage.setItem(key,JSON.stringify(profile))}catch(error){return {ok:false,reason:"STORAGE",error:String(error?.message||error)}}
        emit("aftersignal:profile",profile);emit("aftersignal:gacha",{txn:result.txn||null,kind:result.kind||null});
        return {...result,profile};
      }
      return {ok:false,reason:"CONFLICT"};
    }
    const rngOf=()=>rng||(rng=cryptoRng(options.crypto));
    return Object.freeze({
      key,pool,banner,view,transact,
      status(bannerId){const p=view();return p?statusOf(p,{banner:banner(bannerId),pool:pool()}):null},
      // lobby entry: persist the block (legacy migration) and, once the prologue is complete, the free first recruit
      ensure({shelterOpen=false}={}){return transact(p=>{const before=JSON.stringify(p.gacha??null);ensureGacha(p,{now:now(),poolIds:poolIds(pool())});let granted=false;if(shelterOpen&&prologueDone(p))granted=grantFirstRecruit(p,{now:now()});return {ok:true,granted,changed:granted||JSON.stringify(p.gacha)!==before}})},
      pull({bannerId="standard",count=1,free=false,requestId=null}={}){return transact(p=>applyPull(p,{banner:banner(bannerId),count,free,pool:pool(),rng:rngOf(),now:now(),requestId,poolIds:poolIds(pool())}))},
      exchangeMileage({bannerId="standard",characterId,requestId=null}={}){return transact(p=>applyMileageExchange(p,{banner:banner(bannerId),characterId,pool:pool(),now:now(),requestId,poolIds:poolIds(pool())}))},
      exchangeDust({itemId,qty=1}={}){return transact(p=>({...applyDustExchange(p,{itemId,qty,now:now()}),kind:"DUST"}))},
      acknowledge(txnId){return transact(p=>{const g=ensureGacha(p,{now:now(),poolIds:poolIds(pool())});if(!g.lastTxn||g.lastTxn.id!==txnId||g.lastTxn.ack)return {ok:true,changed:false};g.lastTxn.ack=true;return {ok:true}})},
      pendingReveal(){const p=view();return p?.gacha?.lastTxn&&p.gacha.lastTxn.ack===false?p.gacha.lastTxn:null},
      history(){return view()?.gacha?.history||[]},
      // lobby formation for repeat operations (a separate key: the profile is not rewritten)
      formation(){const p=view();if(!p)return null;const saved=parse(storage.getItem(FORMATION_KEY));return {saved,party:formationParty(p,{saved,roster:roster()})}},
      saveFormation(ids){
        const p=view();if(!p)return {ok:false,reason:"NO_PROFILE"};
        const owned=new Set(ownedIds(p)),snapshot=formationSnapshot((Array.isArray(ids)?ids:[]).filter(id=>owned.has(id)));
        try{storage.setItem(FORMATION_KEY,JSON.stringify(snapshot))}catch(error){return {ok:false,reason:"STORAGE",error:String(error?.message||error)}}
        emit("aftersignal:formation",snapshot);return {ok:true,snapshot};
      }
    });
  }

  const api=Object.freeze({
    version:VERSION,PROFILE_KEY,SCHEMA,RARITIES,RATE_BP,GUARANTEE_BP,HALF_PITY,MILEAGE,STAR_MAX,STAR_STAT_BONUS,STAR_DUST,HISTORY_MAX,
    DEFAULT_PRICE,FIRST_RECRUIT_FLAG,FIRST_RECRUIT_COUNT,TICKET_KEYS,BANNER_DEFS,DUST_EXCHANGE,PROLOGUE_GUESTS,
    buildPool,poolIds,rarityOf,rateTable,cryptoRng,randInt,drawRarity,freshCounters,countersOf,pullsToPity,resolveBatch,
    clampStars,statMultiplier,acquire,priceOf,resolveBanner,resolveCost,guestIdsForStage,ownedIds,isOwned,starsOf,usableIds,
    hasBlock,prologueDone,ownedInOrder,FORMATION_STAGE,FORMATION_KEY,formationParty,formationSnapshot,
    defaultParty,ensureGacha,firstRecruitState,grantFirstRecruit,applyPull,applyMileageExchange,applyDustExchange,statusOf,createStore
  });
  root.AfterSignalGacha=api;
  if(typeof module==="object"&&module&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
