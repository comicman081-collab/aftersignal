/* AFTER SIGNAL game settings V1 (2026-09-29).
   The title screen's "게임 설정" button (and any [data-af-settings-open] button) opens this panel.
   Character voice language (user 2026-09-29: "음성 생성은 한국어, 일본어 모두 한다. 시나리오 텍스트 출력은 한국어가
   기본이다. 다만 기본 음성 출력만 일본어고, 설정에서 한국어로 변경할 수 있는거다."):
   - the choice is stored in localStorage aftersignal:voice-lang ("ja" | "ko"); no stored value = Japanese;
   - the voice scripts (lobby tap, sortie, story/campaign) read the key each time a line starts, so a change applies to
     the next line without reloading; captions and scenario text stay Korean whatever the voice.
   "미리 듣기" plays Mira's self-introduction (story screen P-03, "…미라 보스입니다" / 「…ミラ・ヴォスです」) in the chosen
   language, else her first lobby line - the first file that actually loads, so the preview also works while a voice set
   is not installed yet (2026-09-29: the Korean lobby files did not exist yet and the preview stayed silent). It plays
   through the host voice channel (index.html) or, on a standalone page, a local Audio element. */
(()=>{
  "use strict";
  if(window.AfterSignalGameSettings)return;
  const LANG_KEY="aftersignal:voice-lang",DEFAULT_LANG="ja";
  const LANGS=Object.freeze([
    {id:"ja",label:"일본어",native:"日本語",note:"기본"},
    {id:"ko",label:"한국어",native:"한국어",note:""}
  ]);
  const SAMPLES={ja:["../assets/voice/story_ja/p03_01.mp3","../assets/voice/lobby/ja/mira_1.mp3"],
                 ko:["../assets/voice/story/p03_01.mp3","../assets/voice/lobby/ko/mira_1.mp3"]};
  const embedded=window.parent!==window;
  const store={get(key){try{return localStorage.getItem(key)}catch{return null}},set(key,value){try{localStorage.setItem(key,value)}catch{}}};
  const voiceLang=()=>{const want=store.get(LANG_KEY);return LANGS.some(item=>item.id===want)?want:DEFAULT_LANG};

  const style=document.createElement("style");
  style.id="afGameSettingsStyle";
  style.textContent=`.af-settings{position:fixed;z-index:60;inset:0;display:grid;place-items:center;padding:16px;background:rgba(1,4,9,.72);opacity:0;visibility:hidden;transition:opacity .18s ease,visibility .18s step-end}
.af-settings.open{opacity:1;visibility:visible;transition:opacity .18s ease}
.af-settings[hidden]{display:none}
.af-settings-card{position:relative;box-sizing:border-box;width:min(440px,100%);max-height:calc(100% - 8px);overflow:auto;padding:22px 22px 20px;border:1px solid rgba(123,237,255,.42);border-radius:10px;background:linear-gradient(160deg,rgba(10,22,36,.97),rgba(4,9,16,.97));box-shadow:0 0 0 3px rgba(2,8,14,.8),0 18px 48px rgba(0,0,0,.6),0 0 42px rgba(70,195,255,.12);color:#eaf8ff;font:700 15px/1.5 CombatKR,"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif;transform:translateY(8px);transition:transform .18s ease}
.af-settings.open .af-settings-card{transform:none}
.af-settings-card h2{margin:0 0 18px;font:900 21px/1.2 CombatKR,"Noto Sans KR",sans-serif;letter-spacing:.08em}
.af-settings-card h2 small{display:block;margin:0 0 6px;color:#86edf8;font:700 11px/1 RelayDisplay,sans-serif;letter-spacing:.3em}
.af-settings-card h3{margin:0 0 9px;color:#bfe9f4;font:800 14px/1.3 CombatKR,"Noto Sans KR",sans-serif;letter-spacing:.04em}
.af-settings-langs{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.af-settings-lang{position:relative;min-height:62px;border:1px solid rgba(160,220,235,.3);border-radius:8px;background:rgba(14,30,46,.8);color:#d7e8ef;font:800 16px/1.2 CombatKR,"Noto Sans KR","Noto Sans JP","Yu Gothic UI",sans-serif;cursor:pointer;transition:border-color .15s,background .15s,color .15s}
.af-settings-lang small{display:block;margin-top:4px;color:#8fb2bf;font:700 12px/1 "Noto Sans JP","Yu Gothic UI","Noto Sans KR",sans-serif;letter-spacing:.06em}
.af-settings-lang em{display:inline-block;margin:0 0 0 6px;vertical-align:2px;padding:2px 6px;border-radius:3px;background:rgba(123,237,255,.14);color:#9ff2fb;font:800 10px/1.2 CombatKR,"Noto Sans KR",sans-serif;font-style:normal}
.af-settings-lang[aria-checked="true"]{border-color:#ffd48d;background:linear-gradient(105deg,rgba(96,53,20,.92),rgba(160,98,44,.9));color:#fff8e7;box-shadow:inset 0 1px rgba(255,247,210,.45)}
.af-settings-lang[aria-checked="true"] small{color:#ffe5b4}
.af-settings-lang:hover,.af-settings-lang:focus-visible{border-color:#9ff2fb;outline:none}
.af-settings-note{margin:10px 0 0;color:#98b4bf;font:600 13px/1.55 "Noto Sans KR","Malgun Gothic",sans-serif;word-break:keep-all}
.af-settings-row{display:flex;gap:10px;margin-top:18px}
.af-settings-row button{flex:1;min-height:42px;border:1px solid rgba(123,237,255,.45);border-radius:6px;background:rgba(10,26,40,.9);color:#dff7ff;font:800 14px/1 CombatKR,"Noto Sans KR",sans-serif;letter-spacing:.06em;cursor:pointer}
.af-settings-row button:hover,.af-settings-row button:focus-visible{border-color:#9ff2fb;color:#fff;outline:none}
.af-settings-row .af-settings-close{border-color:rgba(255,212,141,.7);color:#ffe9c0}
.af-settings-status{min-height:1.4em;margin:10px 0 0;color:#ffc98a;font:600 12px/1.4 "Noto Sans KR","Malgun Gothic",sans-serif}
@media (prefers-reduced-motion:reduce){.af-settings,.af-settings-card{transition:none}}`;
  (document.head||document.documentElement).append(style);

  let panel=null,opener=null,local=null;
  function build(){
    panel=document.createElement("div");
    panel.className="af-settings";
    panel.dataset.afGameSettings="v1";
    panel.setAttribute("role","dialog");
    panel.setAttribute("aria-modal","true");
    panel.setAttribute("aria-labelledby","afSettingsTitle");
    panel.hidden=true;
    panel.innerHTML=`<div class="af-settings-card">
  <h2 id="afSettingsTitle"><small>SETTINGS</small>게임 설정</h2>
  <h3 id="afSettingsVoiceLang">캐릭터 음성 언어</h3>
  <div class="af-settings-langs" role="radiogroup" aria-labelledby="afSettingsVoiceLang">${LANGS.map(item=>
    `<button class="af-settings-lang" type="button" role="radio" data-voice-lang="${item.id}" aria-checked="false">${item.label}${item.note?`<em>${item.note}</em>`:""}<small>${item.native}</small></button>`).join("")}</div>
  <p class="af-settings-note">대사와 자막은 한국어로 표시되고, 음성만 선택한 언어로 재생됩니다.</p>
  <div class="af-settings-row"><button class="af-settings-sample" type="button">▶ 미리 듣기</button><button class="af-settings-close" type="button">닫기</button></div>
  <p class="af-settings-status" aria-live="polite"></p>
</div>`;
    panel.addEventListener("click",event=>{
      const pick=event.target.closest?.("[data-voice-lang]");
      if(pick){setVoiceLang(pick.dataset.voiceLang);sample();return}
      if(event.target.closest?.(".af-settings-sample"))return sample();
      if(event.target===panel||event.target.closest?.(".af-settings-close"))close();
    });
    panel.addEventListener("keydown",event=>{
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();return}
      const radios=[...panel.querySelectorAll("[data-voice-lang]")],at=radios.indexOf(document.activeElement);
      if(at<0||!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))return;
      event.preventDefault();
      const next=radios[(at+(event.key==="ArrowLeft"||event.key==="ArrowUp"?-1:1)+radios.length)%radios.length];
      setVoiceLang(next.dataset.voiceLang);next.focus();
    });
    document.body.append(panel);
  }
  function render(){
    if(!panel)return;
    const lang=voiceLang();
    for(const radio of panel.querySelectorAll("[data-voice-lang]")){
      const on=radio.dataset.voiceLang===lang;
      radio.setAttribute("aria-checked",String(on));radio.tabIndex=on?0:-1;
    }
  }
  function setVoiceLang(lang){
    if(!LANGS.some(item=>item.id===lang))return voiceLang();
    store.set(LANG_KEY,lang);render();
    try{window.dispatchEvent(new CustomEvent("aftersignal:voice-lang",{detail:{lang}}))}catch{}
    return lang;
  }
  // resolves to a loaded Audio element, or null when the file is missing / cannot be decoded
  const probe=src=>new Promise(resolve=>{
    const audio=new Audio();let timer=0;
    const done=ok=>{audio.onloadedmetadata=audio.onerror=null;clearTimeout(timer);resolve(ok?audio:null)};
    timer=setTimeout(()=>done(false),4000);
    audio.onloadedmetadata=()=>done(true);audio.onerror=()=>done(false);
    audio.preload="auto";audio.src=src;
  });
  let sampleToken=0;
  async function sample(){
    const token=++sampleToken,lang=voiceLang(),status=panel?.querySelector(".af-settings-status");
    if(status)status.textContent="";
    if(!embedded&&local){local.pause();local=null}
    for(const rel of SAMPLES[lang]){
      const src=new URL(rel,document.baseURI).href,audio=await probe(src);
      if(token!==sampleToken)return null;   // a later click took over
      if(!audio)continue;
      if(embedded){try{window.parent.postMessage({type:"aftersignal:voice",src,screen:"settings"},"*")}catch{}}
      else if(store.get("aftersignal:voice-muted")!=="1"){local=audio;audio.volume=.92;audio.play().catch(()=>{})}
      return src;
    }
    if(status)status.textContent="이 언어의 미리 듣기 음성을 아직 찾지 못했습니다.";
    return null;
  }
  function open(from){
    if(!document.body)return;
    if(!panel)build();
    opener=from||document.activeElement;
    render();panel.hidden=false;void panel.offsetWidth;panel.classList.add("open");
    panel.querySelector('[aria-checked="true"]')?.focus();
  }
  function close(){
    if(!panel||panel.hidden)return;
    panel.classList.remove("open");panel.hidden=true;
    sampleToken++;
    if(local){local.pause();local=null}
    if(embedded){try{window.parent.postMessage({type:"aftersignal:voice-stop"},"*")}catch{}}
    try{opener?.focus?.()}catch{}
    opener=null;
  }
  document.addEventListener("click",event=>{
    const button=event.target.closest?.("button.settings,[data-af-settings-open]");
    if(button&&!panel?.contains(button)){event.preventDefault();open(button)}
  });

  window.AfterSignalGameSettings=Object.freeze({
    version:"1.0",langKey:LANG_KEY,defaultLang:DEFAULT_LANG,languages:LANGS.map(item=>item.id),
    voiceLang,setVoiceLang,open,close,isOpen:()=>Boolean(panel&&!panel.hidden),sample
  });
})();
