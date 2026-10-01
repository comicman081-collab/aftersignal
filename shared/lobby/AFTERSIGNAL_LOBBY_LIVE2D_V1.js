/* AFTERSIGNAL_LOBBY_LIVE2D_V1 (2026-10-01) - live-2D "shader puppet" for the shelter / lobby screens.
   The standing illustrations (1024x1536, never modified) are warped in a fragment shader by analytic deformers + a per-character hair mask:
   breathing, weight shift, head roll / yaw parallax, eyelid-slide blink, gaze that follows the pointer, mass-spring hair, tap reaction.
   One offscreen WebGL2 canvas renders every visible figure; each figure is shown by a 2D canvas that sits next to the original <img> and mirrors
   its box, transform and filter, so the page layout, z-order, tap voices (which read the <img>) and animations stay exactly as they were.
   The <img> is only hidden (clip-path) after the first live frame; without WebGL2, with a missing asset or after a lost context the
   page keeps the plain image. Rig data: AFTERSIGNAL_LOBBY_LIVE2D_RIGS_V1.js (generated), masks: assets/lobby_l2d/<id>_m1.png.
   Over file:// (no fetch, no WebGL upload by URL) every figure is loaded from assets/lobby_l2d/embed/<id>.js (data URIs, rigtool/build_embed.py).
   Public API: window.AfterSignalLobbyLive2D. Query flags (read from the page's or the host page's address): ?l2d=off | static | strong | debug, ?manual=1, ?seed=N, ?motion=full. */
(() => {
  'use strict';
  if (window.AfterSignalLobbyLive2D) return;
  const VERSION = '1.0.0';
  const TAU = Math.PI * 2;
  const SELF_SRC = (document.currentScript && document.currentScript.src) || '';
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const wob = (t, a, b, c, ph) => Math.sin(t * a + ph) * .5 + Math.sin(t * b + ph * 1.7 + 1.3) * .3 + Math.sin(t * c + ph * 2.9 + 2.1) * .2;
  const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  // the host shell shows screens in srcdoc iframes (empty location.search), so a flag on the host page's address (index.html?l2d=off) counts too
  const QS = new URLSearchParams(location.search);
  try { if (window.parent && window.parent !== window) new URLSearchParams(window.parent.location.search).forEach((v, k) => { if (!QS.has(k)) QS.set(k, v); }); } catch (e) { /* cross-origin parent: own query only */ }
  const FLAG = QS.get('l2d') || '';
  const MANUAL = QS.get('manual') === '1';
  const TEXW = 1024, TEXH = 1536;
  const KINDS = [
    ['home', '#homeHero'],
    ['detail', '#detailStanding'],
    ['shop', '.shop-host img'],
    ['gacha', 'img.gc-fig-main'],
    ['splash', 'img.gc-splash-img:not(.gc-low)']
  ];
  const MAX_ACTIVE = 3;

  /* ------------------------------------------------------------------ shaders */
  const GLSL_HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';
  const VS = GLSL_HEAD + `
uniform vec4 uXf;uniform vec2 uCss;uniform vec2 uTexSize;out vec2 vSrc;
void main(){vec2 c=vec2(float(gl_VertexID&1),float((gl_VertexID>>1)&1));vec2 src=c*uTexSize;vSrc=src;
  vec2 px=uXf.zw+src*uXf.xy;vec2 n=px/uCss*2.-1.;gl_Position=vec4(n.x,-n.y,0.,1.);}`;
  const FS = GLSL_HEAD + `
in vec2 vSrc;out vec4 o;
uniform sampler2D uTex;uniform sampler2D uMask;
uniform vec2 uTexSize;
uniform float uTime;
uniform vec4 uGeo;       // cx, eye, chin, D (source px)
uniform vec4 uGeo2;      // floorY, R0, R1, s (= D / 74)
uniform vec4 uBody;      // x: sway rotation about the feet, y: waist counter-rotation, z: breath 0..1, w: strand flutter px
uniform vec4 uHead;      // x,y: translation px, z: roll rad, w: yaw parallax px
uniform vec4 uHead2;     // x: pitch parallax px, y,z: gaze px
uniform vec2 uBlink;     // left, right eyelid close 0..1
uniform vec4 uEye[6];    // per eye: [cx,cy,th,hw] [vt,vl,tb,skin] [iris.x,iris.y,irisR,enabled]
uniform vec2 uHairL[5];uniform vec2 uHairR[5];
uniform vec2 uLod;       // x: mip lod (0 = Catmull-Rom), y: debug masks
float hash21(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
float hairMask(vec2 x){return texture(uMask,x/uTexSize).r;}
vec2 chainAt(vec2 n0,vec2 n1,vec2 n2,vec2 n3,vec2 n4,float t){
  float u=clamp(t,0.,1.)*4.;vec2 r=mix(n0,n1,clamp(u,0.,1.));r=mix(r,n2,clamp(u-1.,0.,1.));r=mix(r,n3,clamp(u-2.,0.,1.));return mix(r,n4,clamp(u-3.,0.,1.));}
// forward displacement of the content that sits at source position x
vec2 disp(vec2 x){
  float cx=uGeo.x,eye=uGeo.y,chin=uGeo.z,D=uGeo.w,s=uGeo2.w;
  vec2 d=vec2(0.);
  d+=uBody.x*vec2(-(x.y-uGeo2.x),x.x-cx);                                       // weight shift: tiny rotation about the feet
  float wy=smoothstep(chin+680.,chin+420.,x.y);
  d+=uBody.y*wy*vec2(-(x.y-(chin+540.)),x.x-cx);                                // shoulders counter-rotate
  float B=uBody.z;
  d.y-=B*4.6*s*smoothstep(chin+580.,chin+210.,x.y);                             // chest and shoulders rise
  d.x+=(x.x-cx)*.008*B*smoothstep(chin+600.,chin+360.,x.y)*smoothstep(chin+40.,chin+200.,x.y);
  float wh=(1.-smoothstep(chin+.22*D,chin+1.03*D,x.y))*(1.-smoothstep(1.7*D,2.9*D,abs(x.x-cx))); // head: roll about the neck + sway (staffs, drones and guns beside the head stay put)
  vec2 r=x-vec2(cx,chin+.47*D);float cs=cos(uHead.z),sn=sin(uHead.z);
  d+=wh*(vec2(cs*r.x-sn*r.y,sn*r.x+cs*r.y)-r+uHead.xy);
  float hm=hairMask(x);                                                         // hair: mass-spring chains by distance from the head
  float lev=smoothstep(uGeo2.y,uGeo2.z,length(x-vec2(cx,eye+.15*D)));
  float sd=smoothstep(cx-.5*D,cx+.5*D,x.x);
  vec2 cL=chainAt(uHairL[0],uHairL[1],uHairL[2],uHairL[3],uHairL[4],lev);
  vec2 cR=chainAt(uHairR[0],uHairR[1],uHairR[2],uHairR[3],uHairR[4],lev);
  d+=hm*mix(cL,cR,sd);
  vec2 fl=vec2(vnoise(x*.05+vec2(uTime*.55,0.)),vnoise(x*.05+vec2(9.7,uTime*.5)))-.5;
  d+=fl*uBody.w*hm*lev;                                                         // fine strand flutter, roots stay calm
  return d;
}
// returns the sample position of a lid-sliding eye (same model as the title screen)
vec2 eyeRig(vec2 q,vec2 c,float th,float hw,float vtA,float vlA,float tb,float skinH,float blink,vec2 iris,float irisR,vec2 gaze){
  float cs=cos(th),sn=sin(th);vec2 dq=q-c;vec2 l=vec2(cs*dq.x+sn*dq.y,-sn*dq.x+cs*dq.y);
  float t=l.x/hw;float wu=1.-smoothstep(.95,1.5,abs(t));if(wu<=0.)return q;
  float par=max(0.,1.-t*t);float vt=vtA*par,vl=vlA*par;
  float vt2=vt+blink*(vl-vt-1.1*par);float dl=vt2-vt;float vsk=vt-skinH;
  float v=l.y,vs=v;
  float vb=vt2+tb;float fz=smoothstep(vb-.8,vb+.8,v);
  if(v>vsk&&v<vt2)vs=vsk+(v-vsk)*(vt-vsk)/max(vt2-vsk,1e-3);
  else if(v>=vt2&&v<vb+.8)vs=mix(v-dl,v,fz);
  vec2 lm=vec2(l.x,mix(v,vs,wu));
  float wi=1.-smoothstep(irisR*.8,irisR*1.3,length(lm-iris));
  float gate=smoothstep(0.,2.2,lm.y-vt)*smoothstep(0.,2.2,vl-lm.y);
  lm-=gaze*wi*gate*wu*(1.-blink);
  return c+vec2(cs*lm.x-sn*lm.y,sn*lm.x+cs*lm.y);
}
// Catmull-Rom (9 taps) on mip level uLod.x: sharp like the browser's own image scaling; the level is chosen so the remaining minification stays below 2
vec4 smp(vec2 s){
  float L=uLod.x;vec2 sz=uTexSize/exp2(L);
  vec2 pos=s/uTexSize*sz;vec2 c=floor(pos-.5)+.5;vec2 f=pos-c;
  vec2 w0=f*(-.5+f*(1.-.5*f)),w1=1.+f*f*(-2.5+1.5*f),w2=f*(.5+f*(2.-1.5*f)),w3=f*f*(-.5+.5*f);
  vec2 w12=w1+w2,off=w2/w12;
  vec2 p0=(c-1.)/sz,p3=(c+2.)/sz,p12=(c+off)/sz;
  vec4 r=textureLod(uTex,vec2(p0.x,p0.y),L)*w0.x*w0.y+textureLod(uTex,vec2(p12.x,p0.y),L)*w12.x*w0.y+textureLod(uTex,vec2(p3.x,p0.y),L)*w3.x*w0.y
    +textureLod(uTex,vec2(p0.x,p12.y),L)*w0.x*w12.y+textureLod(uTex,p12,L)*w12.x*w12.y+textureLod(uTex,vec2(p3.x,p12.y),L)*w3.x*w12.y
    +textureLod(uTex,vec2(p0.x,p3.y),L)*w0.x*w3.y+textureLod(uTex,vec2(p12.x,p3.y),L)*w12.x*w3.y+textureLod(uTex,p3,L)*w3.x*w3.y;
  return max(r,0.);
}
void main(){
  vec2 q=vSrc;for(int i=0;i<4;i++)q=vSrc-disp(q);                    // undo the displacement field (fixed point)
  vec2 fr=(q-vec2(uGeo.x,uGeo.y+.19*uGeo.w))/(uGeo.w*vec2(1.,1.27));float prof=max(0.,1.-dot(fr,fr));
  q-=prof*vec2(uHead.w,uHead2.x);                                    // yaw / pitch parallax of the face
  vec2 g=uHead2.yz;
  for(int e=0;e<2;e++){
    vec4 a=uEye[e*3],b=uEye[e*3+1],c=uEye[e*3+2];
    if(c.w>.5)q=eyeRig(q,a.xy,a.z,a.w,b.x,b.y,b.z,b.w,e==0?uBlink.x:uBlink.y,c.xy,c.z,g);
  }
  vec4 t=smp(q);float a=clamp(t.a,0.,1.);
  vec3 rgb=min(t.rgb,vec3(a));
  if(uLod.y>.5){float hm=hairMask(q);rgb=mix(rgb,vec3(1.,.1,.2)*a,hm*.6);}
  o=vec4(rgb,a);
}`;

  /* ------------------------------------------------------------------ GL helpers */
  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('shader: ' + log); }
    return s;
  }
  function makeProgram(gl) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const loc = {};
    for (const n of ['uTex', 'uMask', 'uTexSize', 'uTime', 'uGeo', 'uGeo2', 'uBody', 'uHead', 'uHead2', 'uBlink', 'uEye', 'uHairL', 'uHairR', 'uLod', 'uXf', 'uCss']) loc[n] = gl.getUniformLocation(p, n);
    return {p, loc};
  }
  function texFrom(gl, bitmap, o) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    if (o.mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /* ------------------------------------------------------------------ rigs + assets */
  const RIGDOC = window.AFTERSIGNAL_LOBBY_L2D_RIGS;
  const RIGS = (RIGDOC && RIGDOC.rigs) || {};
  const FILE2ID = {};
  for (const id in RIGS) FILE2ID[RIGS[id].f] = id;
  const baseName = u => { const m = /\/([^/?#]+\.png)(?:[?#].*)?$/i.exec(u || ''); return m ? decodeURIComponent(m[1]) : ''; };
  const assetBase = SELF_SRC ? new URL('../../assets/lobby_l2d/', SELF_SRC).href : '';

  const R = {gl: null, glc: null, prog: null, vao: null, lost: false, gen: 0, tex: new Map(), size: {w: 0, h: 0}};
  const dataToBlob = d => { const m = /^data:([^;]+);base64,(.*)$/.exec(d); const bin = atob(m[2]); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], {type: m[1]}); };
  // file:// pages can neither fetch their pictures nor upload them to WebGL by URL; each figure then comes from a data-URI bundle
  // (assets/lobby_l2d/embed/<id>.js: lossless WebP of the standing art + the mask), loaded on demand and dropped again after the upload
  const isFileUrl = u => new URL(u, document.baseURI).protocol === 'file:';
  const embedStore = () => (window.AFTERSIGNAL_LOBBY_L2D_EMBED = window.AFTERSIGNAL_LOBBY_L2D_EMBED || {});
  const embJobs = new Map();
  function loadEmbed(id) {
    const emb = embedStore();
    if (emb[id + ':art'] && emb[id + ':mask']) return Promise.resolve();
    if (!embJobs.has(id)) {
      embJobs.set(id, new Promise((res, rej) => {
        const s = document.createElement('script');
        s.async = true;
        s.src = assetBase + 'embed/' + id + '.js' + (RIGDOC && RIGDOC.maskTag ? '?v=' + RIGDOC.maskTag : '');
        s.onload = () => { s.remove(); res(); };
        s.onerror = () => { s.remove(); embJobs.delete(id); rej(new Error('embed bundle ' + id)); };
        document.head.appendChild(s);
      }));
    }
    return embJobs.get(id);
  }
  function dropEmbed(id) { const emb = embedStore(); delete emb[id + ':art']; delete emb[id + ':mask']; embJobs.delete(id); }
  async function loadBitmap(url, key, opts) {
    if (isFileUrl(url)) {
      const emb = embedStore();
      if (!emb[key]) await loadEmbed(key.split(':')[0]);
      if (!emb[key]) throw new Error('file protocol');
      return createImageBitmap(dataToBlob(emb[key]), opts);
    }
    const r = await fetch(url); if (!r.ok) throw new Error('http ' + r.status + ' ' + url);
    return createImageBitmap(await r.blob(), opts);
  }
  const texJobs = new Map();
  function ensureTex(id, artUrl) {
    const hit = R.tex.get(id);
    if (hit && hit.gen === R.gen) { hit.used = performance.now(); return Promise.resolve(hit); }
    if (texJobs.has(id + ':' + R.gen)) return texJobs.get(id + ':' + R.gen);
    const gen = R.gen, rig = RIGS[id];
    const job = (async () => {
      const [artB, maskB] = await Promise.all([
        loadBitmap(artUrl, id + ':art', {premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none'}),
        loadBitmap(assetBase + rig.mask + (RIGDOC.maskTag ? '?v=' + RIGDOC.maskTag : ''), id + ':mask', {premultiplyAlpha: 'none', colorSpaceConversion: 'none'})
      ]);
      if (isFileUrl(artUrl)) dropEmbed(id);
      if (gen !== R.gen || !R.gl || R.gl.isContextLost()) { artB.close && artB.close(); maskB.close && maskB.close(); throw new Error('context changed'); }
      const gl = R.gl;
      const rec = {gen, art: texFrom(gl, artB, {mips: true}), mask: texFrom(gl, maskB, {}), used: performance.now(), w: artB.width, h: artB.height};
      artB.close && artB.close(); maskB.close && maskB.close();
      R.tex.set(id, rec);
      // keep the GPU memory bounded: at most 8 resident figures
      if (R.tex.size > 8) {
        let old = null;
        for (const [k, v] of R.tex) if (k !== id && (!old || v.used < old[1].used) && !isBound(k)) old = [k, v];
        if (old) { gl.deleteTexture(old[1].art); gl.deleteTexture(old[1].mask); R.tex.delete(old[0]); }
      }
      return rec;
    })();
    texJobs.set(id + ':' + gen, job);
    job.then(() => texJobs.delete(id + ':' + gen), () => texJobs.delete(id + ':' + gen));
    return job;
  }
  const isBound = id => { for (const tg of TARGETS.values()) if (tg.id === id) return true; return false; };

  /* ------------------------------------------------------------------ puppet simulation (one per visible figure) */
  function makeChain(freqs, zeta, windGain, inertia, k0frac) {
    const n = freqs.length;
    const k = freqs.map(f => (TAU * f) ** 2), c = freqs.map((f, i) => 2 * zeta[i] * TAU * f);
    return {n, k, c, k0: k.map(v => v * k0frac), c0: c.map(v => v * .2), wind: windGain, inertia, x: new Float64Array(n * 2), v: new Float64Array(n * 2)};
  }
  function stepChain(ch, dt, wx, wy, ax, ay) {
    const sub = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / sub, n = ch.n;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < n; i++) {
        for (let a = 0; a < 2; a++) {
          const ix = i * 2 + a, px = i === 0 ? 0 : ch.x[ix - 2], pv = i === 0 ? 0 : ch.v[ix - 2];
          const force = ch.wind[i] * (a === 0 ? wx : wy) - ch.inertia[i] * (a === 0 ? ax : ay);
          ch.v[ix] += (-ch.k[i] * (ch.x[ix] - px) - ch.c[i] * (ch.v[ix] - pv) - ch.k0[i] * ch.x[ix] - ch.c0[i] * ch.v[ix] + force) * h;
        }
      }
      for (let i = 0; i < n * 2; i++) ch.x[i] += ch.v[i] * h;
    }
  }
  function chainUniform(ch, out) { out[0] = 0; out[1] = 0; for (let i = 0; i < ch.n; i++) { out[i * 2 + 2] = ch.x[i * 2]; out[i * 2 + 3] = ch.x[i * 2 + 1]; } return out; }

  function makePuppet(id, seed) {
    const rig = RIGS[id], rng = mulberry(seed >>> 0), rand = (a, b) => a + rng() * (b - a);
    const D = rig.chin - rig.eye;
    const P = {
      id, rig, rng, rand, D, s: D / 74, t: 0, px: 0, py: 0, pTx: 0, pTy: 0,
      breathPhase: rng(), hB: 0,
      gesture: {t0: -99, dur: 2.2, yaw: 0, roll: 0, gx: 0, gy: 0, next: rand(2.5, 5)},
      blink: {next: rand(1.2, 3.2), t: -1, double: false, active: false, b: 0, bR: 0},
      saccade: {next: 1.2, x: 0, y: 0, cx: 0, cy: 0},
      tap: {t0: -99, dir: 1},
      prevHx: 0, prevHvx: 0, prevHy: 0, prevHvy: 0,
      chL: makeChain([2.2, 1.55, 1.15, .85], [.55, .48, .44, .4], [.25, .7, 1.2, 1.7], [.5, .95, 1.35, 1.7], .35),
      chR: makeChain([2.5, 1.8, 1.35, 1.0], [.55, .5, .45, .42], [.3, .8, 1.3, 1.8], [.55, 1.0, 1.4, 1.75], .4),
      hairL: new Float32Array(10), hairR: new Float32Array(10),
      sig: {B: 0, psi1: 0, psi2: 0, headDx: 0, headDy: 0, roll: 0, yaw: 0, pitch: 0, gazeX: 0, gazeY: 0, flutter: 0},
      over: null
    };
    return P;
  }
  const GAIN = FLAG === 'strong' ? 2.4 : 1;
  function stepPuppet(P, dt, ptr, reduced) {
    const t = (P.t += dt), s = P.s, rand = P.rand, rng = P.rng;
    const amp = (reduced ? .25 : 1) * GAIN, ramp = reduced ? .25 : smooth(.15, 1.6, t);
    P.pTx = ptr.x; P.pTy = ptr.y;
    P.px += (P.pTx - P.px) * (1 - Math.exp(-dt * 4.5)); P.py += (P.pTy - P.py) * (1 - Math.exp(-dt * 4.5));
    // breathing: shorter inhale, longer exhale
    P.breathPhase += dt / (4.4 * (1 + .07 * Math.sin(t * .21)));
    const bp = P.breathPhase % 1;
    const B = bp < .4 ? .5 - .5 * Math.cos(Math.PI * bp / .4) : .5 + .5 * Math.cos(Math.PI * (bp - .4) / .6);
    P.hB += (B - P.hB) * (1 - Math.exp(-dt / .35));
    // look gestures every few seconds: a little turn, roll and glance, usually with a blink
    const g = P.gesture;
    if (t > 1.8 && t >= g.next) {
      g.t0 = t; g.dur = rand(1.8, 2.8); g.yaw = rand(-1, 1) * 1.9; g.roll = rand(-1, 1) * .011; g.gx = rand(-1, 1) * 1.5; g.gy = rand(-.5, .5);
      g.next = t + rand(7, 13); if (rng() < .7) P.blink.next = Math.min(P.blink.next, t + rand(.2, .5));
    }
    const gp = clamp((t - g.t0) / g.dur, 0, 1), gs = Math.sin(Math.PI * gp) ** 2 * (gp > 0 && gp < 1 ? 1 : 0);
    // tap reaction: a small startled dip and glance, decaying
    const tp = P.tap, tu = t - tp.t0, tenv = tu >= 0 && tu < 2.6 ? Math.exp(-tu * 2.4) : 0, tsw = tenv * Math.cos(tu * 9);
    // micro saccades keep the eyes alive
    const sc = P.saccade;
    if (t >= sc.next) { sc.x = rand(-.55, .55); sc.y = rand(-.3, .3); sc.next = t + rand(.9, 3.2); }
    sc.cx += (sc.x - sc.cx) * (1 - Math.exp(-dt / .045)); sc.cy += (sc.y - sc.cy) * (1 - Math.exp(-dt / .045));
    // blink
    const bl = P.blink;
    if (!bl.active && t >= bl.next && t > .6) { bl.active = true; bl.t = 0; bl.double = rng() < .18; }
    if (bl.active) {
      bl.t += dt;
      const close = .07, hold = .035, open = .13, u = bl.t;
      const prof = u2 => u2 < 0 ? 0 : u2 < close ? Math.pow(u2 / close, 1.6) : u2 < close + hold ? 1 : u2 < close + hold + open ? 1 - easeOut((u2 - close - hold) / open) : 0;
      bl.b = prof(u); bl.bR = prof(u - .012);
      if (u > close + hold + open + .02) {
        bl.b = 0; bl.bR = 0;
        if (bl.double) { bl.double = false; bl.t = -.09; } else { bl.active = false; bl.next = t + rand(2.4, 5.8); }
      }
    } else { bl.b = 0; bl.bR = 0; }
    // head / body
    const psi1 = ramp * .0064 * amp * (Math.sin(TAU * t / 8.6 + .4) * .75 + Math.sin(TAU * t / 5.3 + 1.7) * .25);
    const psi2 = -.5 * psi1 + ramp * .0016 * amp * Math.sin(TAU * t / 6.7 + 2.) + tenv * .0016 * Math.sin(tu * 7) * tp.dir;
    const headDx = s * (ramp * amp * 2.4 * wob(t, .73, 1.21, 2.3, .6) + P.px * 4.4 * amp + tsw * 1.6 * tp.dir);
    const headDy = s * (ramp * amp * 1.3 * wob(t, .61, 1.1, 1.9, 1.4) + (B - P.hB) * 1.6 + P.py * 2.2 * amp + tenv * 2.4);
    const roll = ramp * amp * .0105 * wob(t, .62, .97, 1.7, .2) + gs * g.roll * ramp + P.px * .016 * amp + tsw * .018 * tp.dir;
    const yaw = s * (ramp * amp * 1.2 * wob(t, .5, .87, 1.4, 2.3) + gs * g.yaw * ramp + P.px * 3.4 * amp);
    const pitch = s * (P.py * 2.2 * amp + gs * g.gy * .8 * ramp);
    const gazeX = s * clamp(P.px * 1.15 + gs * g.gx + sc.cx, -1.9, 1.9) * ramp, gazeY = s * clamp(P.py * .7 + gs * g.gy * .6 + sc.cy, -1., 1.) * ramp;
    const sig = P.sig;
    sig.B = P.hB; sig.psi1 = psi1; sig.psi2 = psi2; sig.headDx = headDx; sig.headDy = headDy; sig.roll = roll; sig.yaw = yaw; sig.pitch = pitch; sig.gazeX = gazeX; sig.gazeY = gazeY;
    sig.flutter = .8 * s * amp * ramp;
    const ov = P.over;
    if (ov) {
      if (ov.noIdle) Object.assign(sig, {B: 0, psi1: 0, psi2: 0, headDx: 0, headDy: 0, roll: 0, yaw: 0, pitch: 0, gazeX: 0, gazeY: 0, flutter: 0});
      for (const k in ov) if (k in sig) sig[k] = ov[k];
      if (ov.blink != null) { bl.b = ov.blink; bl.bR = ov.blink; }
    }
    // hair: inertial pseudo force from the head frame + wind, scaled by the character's hair extent
    const hx = headDx + psi1 * Math.max(300, P.rig.floor - P.rig.eye), hy = headDy;
    const hvx = (hx - P.prevHx) / Math.max(dt, 1e-4), hvy = (hy - P.prevHy) / Math.max(dt, 1e-4);
    const hax = clamp((hvx - P.prevHvx) / Math.max(dt, 1e-4), -900, 900), hay = clamp((hvy - P.prevHvy) / Math.max(dt, 1e-4), -900, 900);
    P.prevHx = hx; P.prevHy = hy; P.prevHvx = hvx; P.prevHvy = hvy;
    const env = .6 + .4 * Math.sin(t * .37 + .9), ha = ov && ov.noIdle ? 0 : P.rig.amp * s;
    const wind = (ph, gain) => 230 * env * wob(t, 1.9, 3.1, 4.7, ph) * gain * ramp * amp * ha + tenv * 260 * tp.dir * gain * ha;
    const windY = ph => 60 * env * wob(t, 1.3, 2.3, 3.7, ph + 1.1) * ramp * amp * ha;
    const first = t < .05 ? 0 : 1;
    stepChain(P.chL, dt, wind(.3, 1), windY(.3), hax * first, hay * first);
    stepChain(P.chR, dt, wind(1.7, .85), windY(1.7), hax * first, hay * first);
    if (ov && ov.hairL) { P.chL.x.set(ov.hairL); P.chL.v.fill(0); }                 // debug: hold a hair pose (node x,y pairs, source px)
    if (ov && ov.hairR) { P.chR.x.set(ov.hairR); P.chR.v.fill(0); }
    chainUniform(P.chL, P.hairL); chainUniform(P.chR, P.hairR);
  }

  /* ------------------------------------------------------------------ renderer */
  function setupGL() {
    const glc = R.glc || (R.glc = document.createElement('canvas'));
    glc.width = glc.width || 8; glc.height = glc.height || 8;
    const gl = glc.getContext('webgl2', {alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false});
    if (!gl) return null;
    R.gl = gl; R.gen++; R.tex = new Map(); R.size = {w: glc.width, h: glc.height};
    R.prog = makeProgram(gl);
    R.vao = gl.createVertexArray();
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    return gl;
  }
  const uni = {
    eye: new Float32Array(24)
  };
  function drawTarget(tg, dt) {
    const gl = R.gl, P = tg.puppet, rig = P.rig, sig = P.sig, rec = tg.rec, pr = R.prog;
    const pw = tg.pw, ph = tg.ph;
    if (pw > R.glc.width || ph > R.glc.height) { R.glc.width = Math.max(pw, R.glc.width); R.glc.height = Math.max(ph, R.glc.height); R.size = {w: R.glc.width, h: R.glc.height}; }
    const GH = R.glc.height;
    gl.useProgram(pr.p);
    gl.viewport(0, GH - ph, pw, ph);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(0, GH - ph, pw, ph);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(R.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, rec.art);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, rec.mask);
    const L = pr.loc, D = P.D;
    gl.uniform1i(L.uTex, 0); gl.uniform1i(L.uMask, 1);
    gl.uniform2f(L.uTexSize, TEXW, TEXH);
    gl.uniform1f(L.uTime, P.t);
    gl.uniform4f(L.uXf, tg.xf[0], tg.xf[1], tg.xf[2], tg.xf[3]);
    gl.uniform2f(L.uCss, tg.cw, tg.ch);
    gl.uniform4f(L.uGeo, rig.cx, rig.eye, rig.chin, D);
    gl.uniform4f(L.uGeo2, Math.min(rig.floor, TEXH - 40), 1.2 * D, rig.r1, P.s);
    gl.uniform4f(L.uBody, sig.psi1, sig.psi2, sig.B, sig.flutter);
    gl.uniform4f(L.uHead, sig.headDx, sig.headDy, sig.roll, sig.yaw);
    gl.uniform4f(L.uHead2, sig.pitch, sig.gazeX, sig.gazeY, 0);
    gl.uniform2f(L.uBlink, P.blink.b, P.blink.bR);
    const E = uni.eye;
    for (let e = 0; e < 2; e++) {
      const r = rig.eyes[e], o = e * 12;
      if (!r) { for (let k = 0; k < 12; k++) E[o + k] = 0; continue; }
      E[o] = r.c[0]; E[o + 1] = r.c[1]; E[o + 2] = r.th; E[o + 3] = r.hw;
      E[o + 4] = r.vt; E[o + 5] = r.vl; E[o + 6] = r.tb; E[o + 7] = r.skin;
      E[o + 8] = r.iris[0]; E[o + 9] = r.iris[1]; E[o + 10] = r.irisR; E[o + 11] = 1;
    }
    gl.uniform4fv(L.uEye, E);
    gl.uniform2fv(L.uHairL, P.hairL); gl.uniform2fv(L.uHairR, P.hairR);
    gl.uniform2f(L.uLod, tg.lod, tg.debugMasks || DEBUG.masks ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const ctx = tg.ctx;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(R.glc, 0, 0, pw, ph, 0, 0, pw, ph);
  }

  /* ------------------------------------------------------------------ targets: one per standing <img> in the lobby */
  const TARGETS = new Map();
  const S = {inited: false, running: false, reduced: false, scale: 1, perf: {dts: [], lockUntil: 0, ok: 0}, time: 0, active: 0, still: FLAG === 'static'};
  const DEBUG = {masks: FLAG === 'debug' || QS.get('masks') === '1'};
  const PTR = {x: 0, y: 0, on: false, at: -99, touch: false};
  let seedCounter = Number(QS.get('seed')) || 1;
  const css = document.createElement('style');
  css.id = 'af-l2d-css';
  css.textContent = 'canvas.af-l2d{position:absolute;display:block;margin:0;padding:0;border:0;pointer-events:none;visibility:hidden;max-width:none;max-height:none}canvas.af-l2d.af-on{visibility:visible}';

  function hideOriginal(tg, on) {
    try { if (on) tg.img.style.setProperty('clip-path', 'inset(100%)', 'important'); else tg.img.style.removeProperty('clip-path'); } catch (e) { /* ignore */ }
    tg.hidden = on;
  }
  function showCanvas(tg, on) { tg.canvas.classList.toggle('af-on', !!on); }
  function makeTarget(img, kind) {
    const tg = {img, kind, canvas: null, ctx: null, id: '', rig: null, puppet: null, rec: null, state: 'idle', src: '', hidden: false, m: {}, pw: 0, ph: 0, cw: 0, ch: 0, xf: [1, 1, 0, 0], lod: 0,
      face: {x: 0, y: 0}, rect: null, failed: 0, loadTok: 0, debugMasks: false};
    const c = document.createElement('canvas'); c.className = 'af-l2d'; c.setAttribute('aria-hidden', 'true');
    tg.canvas = c; tg.ctx = c.getContext('2d', {alpha: true});
    img.parentNode.insertBefore(c, img.nextSibling);
    return tg;
  }
  function destroyTarget(tg) {
    try { hideOriginal(tg, false); if (tg.canvas && tg.canvas.parentNode) tg.canvas.parentNode.removeChild(tg.canvas); } catch (e) { /* ignore */ }
    tg.state = 'dead';
  }
  function bindTarget(tg) {
    const src = tg.img.currentSrc || tg.img.src || '';
    tg.src = src;
    const id = FILE2ID[baseName(src)] || '';
    tg.loadTok++;
    // new figure (or none): show the plain image again until the live one is ready
    if (tg.hidden) hideOriginal(tg, false);
    showCanvas(tg, false);
    tg.rec = null; tg.puppet = null; tg.id = id; tg.rig = id ? RIGS[id] : null;
    if (!id || R.lost || !R.gl) { tg.state = 'none'; return; }
    tg.state = 'loading';
    const tok = tg.loadTok;
    ensureTex(id, src).then(rec => {
      if (tg.state === 'dead' || tok !== tg.loadTok) return;
      tg.rec = rec; tg.puppet = makePuppet(id, (seedCounter++ * 7919 + id.length * 131) >>> 0); tg.state = 'ready'; tg.failed = 0;
    }).catch(err => {
      if (tg.state === 'dead' || tok !== tg.loadTok) return;
      tg.state = 'failed'; tg.failed++;
      if (!bindTarget.warned) { bindTarget.warned = true; console.info('[lobby-live2d] static image kept:', err && err.message ? err.message : err); }
    });
  }
  function setStyle(tg, name, v) { if (tg.m[name] !== v) { tg.m[name] = v; tg.canvas.style[name] = v; } }
  // copy box, transform, opacity and filter of the <img>; compute the content box (object-fit / object-position) and the bitmap size
  function mirror(tg, cs, r) {
    const T = tg.img, w = T.offsetWidth, h = T.offsetHeight;
    setStyle(tg, 'left', T.offsetLeft + 'px'); setStyle(tg, 'top', T.offsetTop + 'px'); setStyle(tg, 'width', w + 'px'); setStyle(tg, 'height', h + 'px');
    setStyle(tg, 'zIndex', cs.zIndex === 'auto' ? '' : cs.zIndex);
    setStyle(tg, 'transform', cs.transform); setStyle(tg, 'translate', cs.translate); setStyle(tg, 'rotate', cs.rotate); setStyle(tg, 'scale', cs.scale);
    setStyle(tg, 'transformOrigin', cs.transformOrigin); setStyle(tg, 'opacity', cs.opacity); setStyle(tg, 'filter', cs.filter);
    setStyle(tg, 'mixBlendMode', cs.mixBlendMode);
    tg.cw = w; tg.ch = h;
    const fit = cs.objectFit;
    let sx = w / TEXW, sy = h / TEXH;
    if (fit === 'contain' || fit === 'scale-down') sx = sy = Math.min(sx, sy);
    else if (fit === 'cover') sx = sy = Math.max(sx, sy);
    else if (fit === 'none') sx = sy = 1;
    const pos = (cs.objectPosition || '50% 50%').split(/\s+/);
    const fr = (v, free) => (v || '50%').endsWith('%') ? parseFloat(v) / 100 * free : parseFloat(v);
    const ox = fr(pos[0], w - TEXW * sx), oy = fr(pos[1], h - TEXH * sy);
    tg.xf = [sx, sy, ox, oy];
    const dpr = Math.min(window.devicePixelRatio || 1, 2), q = S.scale;
    let pw = Math.max(2, Math.round(w * dpr * q)), ph = Math.max(2, Math.round(h * dpr * q));
    const maxPix = 5.5e6, k = Math.sqrt(maxPix / Math.max(1, pw * ph));
    if (k < 1) { pw = Math.round(pw * k); ph = Math.round(ph * k); }
    if (tg.canvas.width !== pw || tg.canvas.height !== ph) { tg.canvas.width = pw; tg.canvas.height = ph; }
    tg.pw = pw; tg.ph = ph;
    // minification: Catmull-Rom on the mip level that leaves a remaining minification below 2 (level 0 when magnifying)
    const srcPerDev = TEXW / Math.max(1, sx * TEXW * (pw / Math.max(1, w)));
    tg.lod = srcPerDev > 1.7 ? Math.min(6, Math.floor(Math.log2(srcPerDev / .85))) : 0;
    // face position in client px (for the pointer gaze)
    const rw = r.width, rh = r.height;
    tg.face.x = r.left + ((ox + tg.rig.cx * sx) / Math.max(1, w)) * rw;
    tg.face.y = r.top + ((oy + tg.rig.eye * sy) / Math.max(1, h)) * rh;
  }

  /* ------------------------------------------------------------------ main loop */
  let raf = 0, lastTs = 0, lastDiscover = -1e9;
  function discover(now) {
    lastDiscover = now;
    const seen = new Set();
    for (const [kind, sel] of KINDS) {
      let list; try { list = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const img of list) {
        if (!(img instanceof HTMLImageElement) || !img.parentNode) continue;
        seen.add(img);
        if (!TARGETS.has(img)) TARGETS.set(img, makeTarget(img, kind));
      }
    }
    for (const [img, tg] of TARGETS) if (!seen.has(img) || !img.isConnected) { destroyTarget(tg); TARGETS.delete(img); }
  }
  function visibleRect(img) {
    const r = img.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return null;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return null;
    return r;
  }
  function pointerFor(tg) {
    // gaze: where the pointer is relative to the figure's face, in half-screen units (a touch screen only reacts to taps)
    if (!PTR.on || PTR.touch) return {x: 0, y: 0};
    const vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight);
    return {x: clamp((PTR.x - tg.face.x) / (vw * .5), -1, 1), y: clamp((PTR.y - tg.face.y) / (vh * .5), -1, 1)};
  }
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!S.running) { lastTs = ts; return; }
    if (document.hidden) { lastTs = ts; return; }
    let dt = lastTs ? (ts - lastTs) / 1000 : 1 / 60; lastTs = ts; dt = clamp(dt, 0, .05);
    tick(dt, ts);
  }
  function tick(dt, ts) {
    S.time += dt;
    const now = ts == null ? S.time * 1000 : ts;
    if (now - lastDiscover > 400) discover(now);
    if (R.lost || !R.gl) return;
    const act = [];
    for (const tg of TARGETS.values()) {
      if (tg.state === 'dead') continue;
      const src = tg.img.currentSrc || tg.img.src || '';
      if (src !== tg.src && tg.img.complete !== false) bindTarget(tg);
      if (tg.state === 'failed' && tg.failed < 3 && now - (tg.retryAt || 0) > 4000) { tg.retryAt = now; bindTarget(tg); }
      if (tg.state !== 'ready') continue;
      const r = visibleRect(tg.img);
      if (!r) { if (tg.canvas.classList.contains('af-on')) showCanvas(tg, false); if (tg.hidden) hideOriginal(tg, false); continue; }
      tg.rect = r; act.push(tg);
    }
    act.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
    S.active = Math.min(act.length, MAX_ACTIVE);
    for (let i = 0; i < act.length; i++) {
      const tg = act[i];
      if (i >= MAX_ACTIVE) { if (tg.hidden) { hideOriginal(tg, false); showCanvas(tg, false); } continue; }
      const cs = getComputedStyle(tg.img);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      mirror(tg, cs, tg.rect);
      if (!S.still) stepPuppet(tg.puppet, dt, pointerFor(tg), S.reduced);
      try { drawTarget(tg, dt); } catch (err) { console.warn('[lobby-live2d] draw failed:', err && err.message); tg.state = 'failed'; tg.failed = 9; hideOriginal(tg, false); showCanvas(tg, false); continue; }
      if (!tg.hidden) { showCanvas(tg, true); hideOriginal(tg, true); }
    }
    adaptScale(dt);
  }
  function adaptScale(dt) {
    if (!S.active) return;
    const pf = S.perf; pf.dts.push(dt);
    if (pf.dts.length < 90) return;
    const a = pf.dts.slice().sort((x, y) => x - y), p75 = a[Math.floor(a.length * .75)]; pf.dts.length = 0;
    const now = S.time;
    if (p75 > .026 && S.scale > .6 && now > pf.lockUntil) { S.scale = Math.max(.6, S.scale * .85); pf.lockUntil = now + 8; pf.ok = 0; }
    else if (p75 < .0185) { pf.ok++; if (pf.ok >= 3 && S.scale < 1 && now > pf.lockUntil) { S.scale = Math.min(1, S.scale * 1.1); pf.ok = 0; pf.lockUntil = now + 8; } }
    else pf.ok = 0;
  }
  function releaseAll() {
    for (const tg of TARGETS.values()) { try { hideOriginal(tg, false); showCanvas(tg, false); } catch (e) { /* ignore */ } tg.rec = null; if (tg.state === 'ready' || tg.state === 'loading') tg.state = 'idle'; }
  }

  /* ------------------------------------------------------------------ input */
  function nudge(x, y) {
    // a tap on a figure: startle + glance, handled by the puppet
    for (const tg of TARGETS.values()) {
      if (tg.state !== 'ready' || !tg.rect) continue;
      const r = tg.rect;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && tg.hidden) {
        const P = tg.puppet; P.tap.t0 = P.t; P.tap.dir = x < tg.face.x ? 1 : -1; P.blink.next = Math.min(P.blink.next, P.t + .05);
      }
    }
  }

  /* ------------------------------------------------------------------ public API */
  function init() {
    if (S.inited) return true;
    if (FLAG === 'off') return false;
    try {
      if (!RIGDOC || !Object.keys(RIGS).length) throw new Error('rig table missing');
      S.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) && QS.get('motion') !== 'full';
      document.head.appendChild(css);
      const gl = setupGL(); if (!gl) throw new Error('webgl2 unavailable');
      R.glc.addEventListener('webglcontextlost', e => { e.preventDefault(); R.lost = true; releaseAll(); });
      R.glc.addEventListener('webglcontextrestored', () => {
        try { setupGL(); R.lost = false; for (const tg of TARGETS.values()) { if (tg.state !== 'dead') { tg.src = ''; tg.state = 'idle'; } } } catch (err) { console.warn('[lobby-live2d] context restore failed:', err && err.message); S.running = false; releaseAll(); }
      });
      addEventListener('pointermove', e => { PTR.x = e.clientX; PTR.y = e.clientY; PTR.on = true; PTR.touch = e.pointerType === 'touch'; PTR.at = performance.now(); }, {passive: true});
      document.addEventListener('pointerleave', () => { PTR.on = false; });
      addEventListener('blur', () => { PTR.on = false; });
      addEventListener('pointerdown', e => { PTR.x = e.clientX; PTR.y = e.clientY; PTR.touch = e.pointerType === 'touch'; nudge(e.clientX, e.clientY); }, {passive: true, capture: true});
      S.inited = true; S.running = true;
      discover(performance.now());
      if (!MANUAL) raf = requestAnimationFrame(frame);
      return true;
    } catch (err) {
      console.info('[lobby-live2d] static images:', err && err.message ? String(err.message).split('\n')[0] : err);
      S.inited = false; S.running = false;
      return false;
    }
  }
  const api = {
    version: VERSION, init, nudge,
    stop() { S.running = false; releaseAll(); },
    resume() { S.running = true; },
    get active() { return S.inited && S.running; },
    debug: {
      state: S, renderer: R, targets: () => Array.from(TARGETS.values()).map(tg => ({kind: tg.kind, id: tg.id, state: tg.state, hidden: tg.hidden, pw: tg.pw, ph: tg.ph, lod: tg.lod, rect: tg.rect && [tg.rect.left, tg.rect.top, tg.rect.width, tg.rect.height], face: [tg.face.x, tg.face.y], sig: tg.puppet && tg.puppet.sig})),
      target: kind => Array.from(TARGETS.values()).find(t => t.kind === kind),
      step(dt, n = 1) { for (let i = 0; i < n; i++) tick(dt, null); },
      still(v) { S.still = !!v; },
      masks(v) { DEBUG.masks = !!v; },
      over(o, kind) { for (const tg of TARGETS.values()) if (!kind || tg.kind === kind) if (tg.puppet) tg.puppet.over = o; },
      pointer(x, y, on = true) { PTR.x = x; PTR.y = y; PTR.on = on; PTR.touch = false; },
      blinkNow(kind) { for (const tg of TARGETS.values()) if (tg.puppet && (!kind || tg.kind === kind)) tg.puppet.blink.next = 0; },
      showOriginal(v) { for (const tg of TARGETS.values()) { hideOriginal(tg, !v && tg.state === 'ready'); showCanvas(tg, !v && tg.state === 'ready'); } },
      sample(kind, n, dt = 1 / 60) { const tg = Array.from(TARGETS.values()).find(t => t.kind === kind && t.puppet); if (!tg) return null; const out = []; for (let i = 0; i < n; i++) { stepPuppet(tg.puppet, dt, pointerFor(tg), S.reduced); const g = tg.puppet.sig; out.push([tg.puppet.t, g.B, g.psi1, g.psi2, g.headDx, g.headDy, g.roll, g.yaw, g.gazeX, g.gazeY, tg.puppet.blink.b, tg.puppet.hairL[8], tg.puppet.hairL[9], tg.puppet.hairR[8]]); } return out; },
      loseContext(restoreAfterMs = 400) { const x = R.gl.getExtension('WEBGL_lose_context'); x.loseContext(); if (restoreAfterMs >= 0) setTimeout(() => x.restoreContext(), restoreAfterMs); },
      glErrors() { const gl = R.gl, e = []; let c; while ((c = gl.getError()) !== gl.NO_ERROR && e.length < 20) e.push(c); return e; },
      discover: () => discover(performance.now())
    }
  };
  window.AfterSignalLobbyLive2D = api;
  const boot = () => { if (init()) { /* running */ } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true}); else boot();
})();
