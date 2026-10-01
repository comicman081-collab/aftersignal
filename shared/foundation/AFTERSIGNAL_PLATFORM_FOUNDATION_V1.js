/* Mobile-first platform adapters. Desktop shares these contracts through injected adapters. */
(() => {
  "use strict";
  const listeners=new Set(),profiles=Object.freeze(["LOW","MID","HIGH"]);
  const adapters={account:null,cloudSave:null,remoteConfig:null,telemetry:null,content:null};
  const state={visibility:document.visibilityState,online:navigator.onLine,profile:"HIGH",safeArea:true};
  const qaEnabled=(()=>{if(window.__AFTERSIGNAL_QA_EMBEDDED__===true)return true;const hasQa=value=>/(?:[?&])qa=1(?:&|$)/.test(String(value||""));try{return hasQa(parent.location.href)}catch{try{return hasQa(location.href)}catch{return false}}})();
  const emit=(type,payload={})=>{const event={type,payload,state:{...state}};for(const fn of listeners)try{fn(event)}catch(error){console.error("AfterSignalPlatform listener failed",error)}return event};
  document.addEventListener("visibilitychange",()=>{state.visibility=document.visibilityState;emit(state.visibility==="hidden"?"background":"resume")});
  addEventListener("online",()=>{state.online=true;emit("reconnect")});
  addEventListener("offline",()=>{state.online=false;emit("network-loss")});
  const safeArea=()=>({top:"env(safe-area-inset-top, 0px)",right:"env(safe-area-inset-right, 0px)",bottom:"env(safe-area-inset-bottom, 0px)",left:"env(safe-area-inset-left, 0px)"});
  const input={
    pointer(event,rect){const width=Math.max(1,rect.width),height=Math.max(1,rect.height);return{x:(event.clientX-rect.left)/width,y:(event.clientY-rect.top)/height,kind:event.pointerType||"mouse",pressure:Number(event.pressure)||0}},
    bind(target,fn){
      const handlers={
        pointerdown:event=>fn("start",input.pointer(event,target.getBoundingClientRect()),event),
        pointermove:event=>fn("move",input.pointer(event,target.getBoundingClientRect()),event),
        pointerup:event=>fn("end",input.pointer(event,target.getBoundingClientRect()),event),
        pointercancel:event=>fn("cancel",input.pointer(event,target.getBoundingClientRect()),event)
      };
      for(const [type,handler] of Object.entries(handlers))target.addEventListener(type,handler,{passive:true});
      return()=>{for(const [type,handler] of Object.entries(handlers))target.removeEventListener(type,handler)};
    }
  };
  const localKey="aftersignal:profile:v4";
  const local={
    get(key=localKey){try{const value=localStorage.getItem(key);return value===null?null:JSON.parse(value)}catch{return null}},
    set(value,key=localKey){localStorage.setItem(key,JSON.stringify(value));emit("local-save",{key});return value},
    remove(key=localKey){localStorage.removeItem(key);emit("local-save-removed",{key});return true}
  };
  const configure=(name,adapter)=>{if(adapter!==null&&typeof adapter!=="object"&&typeof adapter!=="function")throw new TypeError(`Invalid ${name} adapter`);adapters[name]=adapter;emit("adapter-configured",{name,active:Boolean(adapter)});return adapter};
  const platform={
    clientVersion:"0.66",contentVersion:"foundation-v1-candidate",saveSchemaVersion:1,safeArea,input,
    performance:{profiles,get:()=>state.profile,set(profile){if(!profiles.includes(profile))throw new RangeError(`Unknown performance profile: ${profile}`);state.profile=profile;emit("performance-profile",{profile});return profile}},
    account:{configure:adapter=>configure("account",adapter),getId:async()=>adapters.account?.getId?adapters.account.getId():null},
    save:{localKey,local,configureCloud:adapter=>configure("cloudSave",adapter),saveCloud:async(slot,value)=>{if(!adapters.cloudSave?.save)throw new Error("Cloud save adapter is not configured");const result=await adapters.cloudSave.save(slot,value);emit("cloud-save",{slot});return result},loadCloud:async slot=>{if(!adapters.cloudSave?.load)throw new Error("Cloud save adapter is not configured");return adapters.cloudSave.load(slot)}},
    remoteConfig:{configure:adapter=>configure("remoteConfig",adapter),get:async(key,fallback=null)=>adapters.remoteConfig?.get?adapters.remoteConfig.get(key,fallback):fallback,refresh:async()=>{const value=adapters.remoteConfig?.refresh?await adapters.remoteConfig.refresh():null;emit("remote-config-refresh",{available:Boolean(adapters.remoteConfig)});return value}},
    telemetry:{configure:adapter=>configure("telemetry",adapter),track:async(name,data={})=>{const event=emit("telemetry",{name,data});if(adapters.telemetry?.track)await adapters.telemetry.track(name,data);return event}},
    network:{isOnline:()=>state.online},
    debug:Object.freeze({enabled:qaEnabled,simulate(type){if(!qaEnabled)throw new Error("Platform lifecycle simulation is QA-only");if(type==="background")state.visibility="hidden";if(type==="resume")state.visibility="visible";if(type==="network-loss")state.online=false;if(type==="reconnect")state.online=true;return emit(type,{simulated:true})}}),
    content:{manifestVersion:"v1",configure:adapter=>configure("content",adapter),checkForPatch:async()=>adapters.content?.checkForPatch?adapters.content.checkForPatch():null,applyPatch:async patch=>{if(!adapters.content?.applyPatch)throw new Error("Content patch adapter is not configured");const result=await adapters.content.applyPatch(patch);emit("content-patch-applied",{id:patch?.id||null});return result},rollback:async target=>{if(!adapters.content?.rollback)throw new Error("Content rollback adapter is not configured");const result=await adapters.content.rollback(target);emit("content-rollback",{target});return result}},
    on(fn){if(typeof fn!=="function")throw new TypeError("Platform listener must be a function");listeners.add(fn);return()=>listeners.delete(fn)}
  };
  window.AfterSignalPlatform=Object.freeze(platform);
})();
