(()=>{
  "use strict";
  const specs={
    hide:{ids:["hide","hideButton"],label:"HIDE",key:"H",code:"KeyH"},
    auto:{ids:["auto","autoButton"],label:"AUTO",key:"A",code:"KeyA"},
    // Some early story pages use #log for the panel and #logButton for the
    // actual control. The control must always win the ID lookup.
    log:{ids:["logButton","log"],label:"LOG",key:"L",code:"KeyL"},
    skip:{ids:["skip","skipButton"],label:"SKIP",key:"S",code:"KeyS"},
    sound:{ids:["sound","soundButton","bgmButton"],label:"BGM",key:"M",code:"KeyM"}
  };
  const find=spec=>{
    const candidates=spec.ids.map(id=>document.getElementById(id)).filter(Boolean);
    return candidates.find(node=>node.tagName==="BUTTON")||candidates[0];
  };
  const render=(button,action,spec)=>{
    if(!button)return;
    button.dataset.afStoryAction=action;
    button.classList.add("af-story-control");
    button.innerHTML=`<span>${spec.label}</span><kbd aria-hidden="true">${spec.key}</kbd>`;
    button.setAttribute("aria-keyshortcuts",spec.key);
  };
  const normalize=()=>{
    const controls=Object.entries(specs).map(([action,spec])=>[action,spec,find(spec)]).filter(([,spec,node])=>node&&spec.label!=="BGM");
    const nav=controls[0]?.[2]?.closest("nav,.story-head,.controls,.top-actions,.story-controls")||controls[0]?.[2]?.parentElement;
    if(!nav)return false;
    nav.classList.add("af-story-controls");
    controls.forEach(([action,spec,node])=>{if(node.parentElement!==nav)nav.append(node);render(node,action,spec)});
    const sound=find(specs.sound);if(sound){sound.dataset.afStoryAction="sound";sound.classList.add("af-story-control")}
    return true;
  };
  normalize();
  document.addEventListener("keydown",event=>{
    if(event.repeat||event.altKey||event.ctrlKey||event.metaKey)return;
    const target=event.target;if(target?.matches?.("input,textarea,select,[contenteditable=true]"))return;
    const entry=Object.entries(specs).find(([,spec])=>spec.code===event.code);if(!entry)return;
    const button=find(entry[1]);if(!button||button.disabled)return;
    // P-00 already owns a window-level shortcut listener. Stop this event at
    // document so one physical key press cannot toggle the action twice.
    event.preventDefault();event.stopPropagation();button.click();
  });
  window.AfterSignalStoryControls=Object.freeze({version:"1.1",normalize,specs});
})();
