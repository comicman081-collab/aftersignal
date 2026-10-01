/* AFTERSIGNAL_TITLE_LIVE2D_V1 (2026-10-01) - title screen scene.
   One WebGL2 canvas: cinematic background (beam, vortex, fog, wet-road shimmer, window flicker, god rays, bloom) behind a
   "shader puppet" live-2D hero. The hero is the unmodified Mira standing illustration warped in a fragment shader by analytic
   deformers + soft region masks (no Live2D SDK, no extra art): breathing, weight shift, head roll / yaw parallax, eyelid-slide
   blink, gaze, and physically simulated hair (mass-spring chains driven by wind + head inertia).
   Authoring notes: docs in HISTORY/2026-10-01_TITLE_LIVE2D_V1.md. Public API: window.AfterSignalTitleLive2D.
   Everything is optional: if WebGL2 or an asset is missing, init() resolves false and the page keeps its static layout. */
(() => {
  'use strict';
  if (window.AfterSignalTitleLive2D) return;
  const VERSION = '1.0.0';
  const TAU = Math.PI * 2;
  const SELF_SRC = (document.currentScript && document.currentScript.src) || '';
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeInOut = t => { t = clamp(t, 0, 1); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const wob = (t, a, b, c, ph) => Math.sin(t * a + ph) * .5 + Math.sin(t * b + ph * 1.7 + 1.3) * .3 + Math.sin(t * c + ph * 2.9 + 2.1) * .2;
  let rng = Math.random;
  const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rand = (a, b) => a + rng() * (b - a);

  /* ------------------------------------------------------------------ shaders */
  const GLSL_HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';
  const GLSL_COMMON = `
const float TAU=6.28318530718;
float hash11(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}
float hash21(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*vnoise(p);p=p*2.03+vec2(17.1,9.2);a*=.5;}return v;}
vec3 s2l(vec3 c){return pow(max(c,vec3(0.)),vec3(2.2));}
float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
`;
  const VS_FULL = GLSL_HEAD + `
out vec2 vUv;out vec2 vTex;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vTex=p;vUv=vec2(p.x,1.-p.y);gl_Position=vec4(p*2.-1.,0.,1.);}`;

  /* ---- background: painted plate + animated light / weather ---- */
  const FS_BG = GLSL_HEAD + GLSL_COMMON + `
in vec2 vUv;out vec4 o;
uniform sampler2D uBg;
uniform float uTime,uBeat,uIgnite,uFlash,uFade;
uniform vec4 uView;      // xy: visible fraction of the plate, zw: view centre (plate uv)
uniform vec2 uPar;       // parallax (plate uv per unit depth)
uniform vec2 uBeam;      // beam x, crown y (plate uv)
float depthAt(vec2 b){
  vec2 q=(b-vec2(.69,.53))*vec2(1.,.72);float d=smoothstep(.05,.62,length(q));
  d=max(d,smoothstep(.62,1.,b.y)*.9);
  float far=smoothstep(.58,.30,b.y)*(1.-smoothstep(.20,.42,abs(b.x-.69)));
  return d*(1.-.8*far);
}
void main(){
  vec2 b=(vUv-.5)*uView.xy+uView.zw;
  b+=uPar*(depthAt(b)-.35);
  // cloud vortex: a slow breathing swirl on a ring around the beam top (the beam itself stays straight)
  vec2 cV=vec2(uBeam.x,.105);vec2 sv=(b-cV)*vec2(1.5,1.);float sr=length(sv);
  float sw=smoothstep(.06,.13,sr)*smoothstep(.42,.16,sr);
  float ang=(sin(uTime*.11)*.035+sin(uTime*.047+1.3)*.025)*sw;
  float ca=cos(ang),sa=sin(ang);sv=mat2(ca,-sa,sa,ca)*sv;b=cV+sv/vec2(1.5,1.);
  // wet road: bright reflections shimmer
  float roadW=smoothstep(.66,.74,b.y);
  float refl=smoothstep(.10,.45,luma(texture(uBg,b).rgb)*3.);
  b.x+=(vnoise(vec2(b.x*90.,b.y*38.-uTime*.6))-.5)*.0016*roadW*refl*(.5+.5*uBeat);
  b.y+=(vnoise(vec2(b.x*50.+uTime*.4,b.y*120.))-.5)*.0007*roadW*refl;
  vec3 raw=texture(uBg,b).rgb;vec3 soft=textureLod(uBg,b,2.5).rgb;
  vec3 c=max(raw+(raw-soft)*.32,vec3(0.));
  // small lights (windows, fires, lamps) twinkle independently
  float lb=luma(textureLod(uBg,b,3.).rgb);
  float lights=smoothstep(.012,.09,luma(c)-lb);
  vec2 cell=floor(b*vec2(220.,147.));float hs=hash21(cell);
  float fl=.72+.28*sin(uTime*(1.5+hs*5.)+hs*60.)*(.6+.4*sin(uTime*.7+hs*13.));
  c*=mix(1.,fl,lights*step(.35,hs+.25));
  // lightning brightens the cloud plate only (the beam and its crown flare are added afterwards, so a flash never whites them out)
  c*=1.+uFlash*(.35+1.1*smoothstep(.5,.15,b.y));
  // beam, travelling packets, crown flare
  float dx=(b.x-uBeam.x)*1.5;float bw=.0034*(1.+.5*uBeat);
  float above=smoothstep(uBeam.y+.012,uBeam.y-.03,b.y);
  float beam=exp(-pow(dx/bw,2.))*above;
  float beamSoft=exp(-pow(dx/(bw*7.),2.))*smoothstep(uBeam.y+.02,uBeam.y-.2,b.y);
  float pk=0.;for(int k=0;k<3;k++){float fr=fract(uTime*.26+float(k)/3.);float py=uBeam.y-.025-fr*(uBeam.y+.02);pk+=exp(-pow((b.y-py)/.011,2.))*exp(-pow(dx/(bw*2.6),2.))*smoothstep(.0,.2,fr)*(1.-smoothstep(.78,1.,fr));}
  vec3 cy=vec3(.35,1.,1.);
  c+=cy*(beam*1.5+beamSoft*.28+pk*1.6*above)*(.55+.45*uBeat)*uIgnite;
  vec2 cr=vec2(dx,b.y-uBeam.y);float cd=length(cr);
  float crown=exp(-cd*cd/.0016)*1.0+exp(-cd*cd/.012)*.26;
  float streak=exp(-pow(cr.y/.0034,2.))*exp(-abs(cr.x)/.2)*.55;
  c+=vec3(.5,1.,1.)*(crown+streak)*(.6+.4*uBeat)*uIgnite;
  float rs=exp(-pow(dx/(.012+.03*max(b.y-.66,0.)),2.))*smoothstep(.66,.80,b.y)*smoothstep(1.02,.85,b.y);
  float rsh=.65+.35*vnoise(vec2(b.y*70.-uTime*1.5,b.x*20.));
  c+=vec3(.2,.7,.85)*rs*rsh*(.3+.5*uBeat)*uIgnite;
  // drifting haze
  vec2 fp=vec2(b.x*2.6-uTime*.012,b.y*5.);
  float fg=fbm(fp+vec2(fbm(fp*1.7+uTime*.03),0.)*1.5);
  float band=exp(-pow((b.y-.66)/.12,2.))*.9+smoothstep(.82,1.,b.y)*.5;
  c+=vec3(.06,.07,.16)*fg*band*.9;
  // moon halo through the clouds
  vec2 mp=(b-vec2(.56,.152))*vec2(1.5,1.);
  c+=vec3(.5,.6,.9)*exp(-dot(mp,mp)/.0035)*.2*(.6+.4*fbm(b*vec2(5.,3.5)+vec2(uTime*.02,0.)));
  // distant lightning in the cloud ceiling
  float skyW=smoothstep(.5,.15,b.y);
  c+=vec3(.25,.35,.7)*uFlash*skyW*fbm(b*vec2(6.,4.)+3.1);
  o=vec4(c*uFade,1.);
}`;

  /* ---- hud rings / halo behind the hero (additive) ---- */
  const FS_RINGS = GLSL_HEAD + GLSL_COMMON + `
in vec2 vUv;out vec4 o;
uniform vec2 uCss,uCenter;uniform float uUnit,uTime,uBeat,uHud,uBurst;uniform vec3 uPing;
float ln(float r,float R,float px,float aa){float w=px/uUnit;return 1.-smoothstep(w*.5,w*.5+aa,abs(r-R));}
void main(){
  vec2 d=vUv*uCss-uCenter;float r=length(d)/uUnit;float an=atan(d.y,d.x);float aa=fwidth(r)*1.1;
  vec3 cy=vec3(.30,.90,1.),vi=vec3(.55,.40,1.);
  float a=0.;vec3 col=vec3(0.);
  // outer ring with four bright arcs
  float arcs=smoothstep(.80,.93,cos(4.*(an-uTime*.05)));
  float rA=ln(r,.45,1.4,aa)*(.28+.9*arcs);a+=rA;col+=cy*rA;
  // dashed ring
  float dsh=step(.5,fract((an+uTime*.035)*60./TAU));
  float rB=ln(r,.385,1.2,aa)*dsh*.34;a+=rB;col+=cy*rB;
  // inner thin ring + three markers
  float mk=smoothstep(.985,.999,cos(3.*(an+uTime*.08)));
  float rC=(ln(r,.305,1.1,aa)*.16+ln(r,.305,5.,aa)*mk*.8);a+=rC;col+=mix(cy,vi,.35)*rC;
  // tick marks
  float tk=smoothstep(.55,.62,abs(fract(an*120./TAU+.5)-.5)*2.);float tr=smoothstep(.412,.414,r)*smoothstep(.428,.426,r);
  float rT=(1.-tk)*tr*.4;a+=rT;col+=cy*rT;
  // soft halo
  float halo=exp(-pow((r-.22)/.30,2.))*.20*(.6+.4*uBeat);col+=mix(vi,cy,smoothstep(.0,.5,r))*halo;
  // pings emitted on the heartbeat
  for(int i=0;i<3;i++){float age=uPing[i];if(age<0.)continue;
    float R=.12+age*.21;float al=exp(-age*1.25)*smoothstep(0.,.12,age);
    float pr=ln(r,R,2.2,aa)*al*.8+exp(-pow((r-R)/.02,2.))*al*.5;col+=cy*pr;a+=pr;}
  // burst (start button)
  if(uBurst>0.){float R=.1+uBurst*.9;float al=(1.-uBurst);float br=exp(-pow((r-R)/.03,2.))*al*1.6;col+=vec3(.6,1.,1.)*br;}
  o=vec4(col*uHud,1.);
}`;

  /* ---- hero: shader puppet ---- */
  const VS_HERO = GLSL_HEAD + `
uniform vec4 uXf;uniform vec2 uCss;uniform vec4 uRect;out vec2 vSrc;
void main(){vec2 c=vec2(float(gl_VertexID&1),float((gl_VertexID>>1)&1));vec2 src=mix(uRect.xy,uRect.zw,c);vSrc=src;
  vec2 px=uXf.yz+src*uXf.x;vec2 n=px/uCss*2.-1.;gl_Position=vec4(n.x,-n.y,0.,1.);}`;
  const FS_HERO = GLSL_HEAD + GLSL_COMMON + `
in vec2 vSrc;out vec4 o;
uniform sampler2D uTex;uniform sampler2D uMask;
uniform float uTime;
uniform vec4 uBody;      // x: sway rotation about the feet, y: waist counter-rotation, z: breath 0..1
uniform vec4 uHead;      // x,y: translation (px), z: roll (rad), w: yaw parallax (px)
uniform vec4 uHead2;     // x: pitch parallax (px), y,z: gaze (px), w: strand flutter (px)
uniform vec2 uBlink;     // left, right eyelid close 0..1
uniform vec2 uHairL[6];uniform vec2 uHairR[4];uniform vec2 uBang[3];
uniform vec4 uFx;        // x: heartbeat, y: reveal 0..1, z: rim strength, w: emissive gain
uniform vec4 uFx2;       // x: opacity, y: debug masks, z: minify lod, w: start glow
uniform vec2 uRimDir;
const vec2 TEX=vec2(1024.,1536.);const vec2 NECK=vec2(505.,255.);
vec3 mHair(vec2 x){return texture(uMask,vec2(x.x*(1./1024.),x.y*(1./3072.))).rgb;}
float mFace(vec2 x){return texture(uMask,vec2(x.x*(1./1024.),.5+x.y*(1./3072.))).r;}
vec2 chainL(float y){const float Y[6]=float[6](70.,190.,320.,460.,600.,760.);vec2 r=uHairL[0];
  for(int i=1;i<6;i++)r=mix(r,uHairL[i],smoothstep(Y[i-1],Y[i],y));return r;}
vec2 chainR(float y){const float Y[4]=float[4](70.,150.,230.,290.);vec2 r=uHairR[0];
  for(int i=1;i<4;i++)r=mix(r,uHairR[i],smoothstep(Y[i-1],Y[i],y));return r;}
vec2 chainB(float y){const float Y[3]=float[3](60.,110.,150.);vec2 r=uBang[0];
  for(int i=1;i<3;i++)r=mix(r,uBang[i],smoothstep(Y[i-1],Y[i],y));return r;}
// forward displacement of the content that sits at source position x
vec2 disp(vec2 x){
  vec2 d=vec2(0.);
  d+=uBody.x*vec2(-(x.y-1250.),x.x-510.);                       // weight shift: tiny rotation about the feet
  d+=uBody.y*smoothstep(900.,640.,x.y)*vec2(-(x.y-760.),x.x-510.); // shoulders counter-rotate
  float B=uBody.z;
  d.y-=B*3.0*smoothstep(800.,430.,x.y);                           // chest and shoulders rise
  d.x+=(x.x-510.)*.005*B*smoothstep(820.,580.,x.y)*smoothstep(260.,420.,x.y);
  float wh=1.-smoothstep(236.,296.,x.y);                          // head: roll about the neck + sway
  vec2 r=x-NECK;float cs=cos(uHead.z),sn=sin(uHead.z);
  d+=wh*(vec2(cs*r.x-sn*r.y,sn*r.x+cs*r.y)-r+uHead.xy);
  vec3 mh=mHair(x);float ws=max(1.,mh.r+mh.g+mh.b);
  d+=(mh.r*chainL(x.y)+mh.g*chainR(x.y)+mh.b*chainB(x.y))/ws;     // hair: mass-spring chains
  float hv=clamp(mh.r+mh.g+mh.b,0.,1.);
  vec2 fl=vec2(vnoise(x*.05+vec2(uTime*.55,0.)),vnoise(x*.05+vec2(9.7,uTime*.5)))-.5;
  d+=fl*uHead2.w*hv*smoothstep(110.,420.,x.y);                    // fine strand flutter, roots stay calm
  return d;
}
// returns the sample position; qa/wa = alternative position and its weight for the 1.6 px feather under the lash band
vec2 eyeRig(vec2 q,vec2 c,float th,float hw,float vtA,float vlA,float tb,float skinH,float blink,vec2 iris,float irisR,vec2 gaze,inout vec2 qa,inout float wa){
  float cs=cos(th),sn=sin(th);vec2 dq=q-c;vec2 l=vec2(cs*dq.x+sn*dq.y,-sn*dq.x+cs*dq.y);
  float t=l.x/hw;float wu=1.-smoothstep(.95,1.5,abs(t));if(wu<=0.)return q;
  float par=max(0.,1.-t*t);float vt=vtA*par,vl=vlA*par;
  float vt2=vt+blink*(vl-vt-1.1*par);float dl=vt2-vt;float vsk=vt-skinH;
  float v=l.y,vs=v;
  float vb=vt2+tb;float fz=smoothstep(vb-.8,vb+.8,v);                 // 0 inside the band, 1 below it
  if(v>vsk&&v<vt2)vs=vsk+(v-vsk)*(vt-vsk)/max(vt2-vsk,1e-3);       // lid skin stretches down over the eye
  else if(v>=vt2&&v<vb+.8)vs=mix(v-dl,v,fz);                       // lash band slides as one piece (feathered into the eye below)
  vec2 lm=vec2(l.x,mix(v,vs,wu));
  float wi=1.-smoothstep(irisR*.8,irisR*1.3,length(lm-iris));      // iris slides inside the opening
  float gate=smoothstep(0.,2.2,lm.y-vt)*smoothstep(0.,2.2,vl-lm.y);
  lm-=gaze*wi*gate*wu*(1.-blink);
  return c+vec2(cs*lm.x-sn*lm.y,sn*lm.x+cs*lm.y);
}
vec4 smp(vec2 s){
  vec2 uv=s/TEX;
  if(uFx2.z>.01)return textureLod(uTex,uv,uFx2.z);
  vec2 pos=uv*TEX;vec2 c=floor(pos-.5)+.5;vec2 f=pos-c;
  vec2 w0=f*(-.5+f*(1.-.5*f)),w1=1.+f*f*(-2.5+1.5*f),w2=f*(.5+f*(2.-1.5*f)),w3=f*f*(-.5+.5*f);
  vec2 w12=w1+w2,off=w2/w12;
  vec2 p0=(c-1.)/TEX,p3=(c+2.)/TEX,p12=(c+off)/TEX;
  vec4 r=texture(uTex,vec2(p0.x,p0.y))*w0.x*w0.y+texture(uTex,vec2(p12.x,p0.y))*w12.x*w0.y+texture(uTex,vec2(p3.x,p0.y))*w3.x*w0.y
    +texture(uTex,vec2(p0.x,p12.y))*w0.x*w12.y+texture(uTex,p12)*w12.x*w12.y+texture(uTex,vec2(p3.x,p12.y))*w3.x*w12.y
    +texture(uTex,vec2(p0.x,p3.y))*w0.x*w3.y+texture(uTex,vec2(p12.x,p3.y))*w12.x*w3.y+texture(uTex,p3)*w3.x*w3.y;
  return max(r,0.);
}
void main(){
  vec2 q=vSrc;for(int i=0;i<4;i++)q=vSrc-disp(q);                  // undo the displacement field (fixed point)
  float mf=mFace(q);vec2 fr=(q-vec2(520.,160.))/vec2(74.,94.);float prof=max(0.,1.-dot(fr,fr));
  q-=mf*prof*vec2(uHead.w,uHead2.x);                              // yaw / pitch parallax of the features
  vec2 g=uHead2.yz;
  vec2 qa=q;float wa=0.;
  q=eyeRig(q,vec2(490.,139.5),.1815,17.8,-6.4,5.,2.8,7.,uBlink.x,vec2(.5,-.6),8.5,g,qa,wa);
  q=eyeRig(q,vec2(545.6,152.45),.0663,14.4,-4.9,5.6,2.5,6.,uBlink.y,vec2(-4.3,-.4),7.5,g,qa,wa);
  vec4 t=smp(q);float a=t.a;
  vec3 col=a>.002?clamp(t.rgb/a,0.,1.):vec3(0.);
  vec3 lin=s2l(col)*vec3(.94,.98,1.04);
  // cyan light strips breathe with the heartbeat (emissive, picked up by the bloom)
  float cyk=smoothstep(.18,.5,col.b-col.r)*smoothstep(.20,.55,col.g-col.r)*smoothstep(.35,.65,col.b);
  lin+=vec3(.2,1.,1.)*cyk*(.45+1.9*uFx.x)*uFx.w;
  // rim light from the relay beam (right/back) and a violet fill from the city (left)
  float a1=texture(uTex,(q+uRimDir*4.)/TEX).a,a2=texture(uTex,(q+uRimDir*9.)/TEX).a;
  float rim=clamp((a-a1)*1.5+(a-a2)*.6,0.,1.)*a;
  vec2 rd2=vec2(-uRimDir.x,uRimDir.y*.4);float b1=texture(uTex,(q+rd2*5.)/TEX).a;float rim2=clamp((a-b1)*1.4,0.,1.)*a;
  lin+=vec3(.25,.85,1.)*rim*uFx.z*(.7+.6*uFx.x)+vec3(.45,.3,.9)*rim2*uFx.z*.35;
  // entry: a cyan scan line wipes the hero in from the feet up
  float ry=uFx.y;float lineY=mix(1580.,-40.,ry);float wb=(vnoise(vec2(q.x*.03,uTime*1.2))-.5)*26.;
  float vis=smoothstep(lineY+wb-12.,lineY+wb+12.,vSrc.y);
  float edge=exp(-pow((vSrc.y-(lineY+wb))/15.,2.))*(1.-smoothstep(.92,1.,ry));
  lin+=vec3(.3,1.,1.)*edge*2.2*step(.01,a);
  lin+=vec3(.4,1.,1.)*uFx2.w*a*.25;
  float fa=a*vis*uFx2.x;
  if(uFx2.y>.5){vec3 mh=mHair(q);lin=mix(lin,vec3(mh.r,mh.g,mh.b)*.8+vec3(mFace(q),mFace(q),0.)*.6,.55);}
  o=vec4(lin*fa,fa);
}`;

  /* ---- particles: embers, dust, signal motes (vertex-animated) ---- */
  const VS_PART = GLSL_HEAD + `
in vec4 aA;in vec4 aB;
uniform float uTime,uLayer,uPx,uAmt;uniform vec2 uCss,uPar;
out vec3 vCol;out float vAl;out float vSoft;
void main(){
  float z=aA.z,kind=aA.w;bool nearL=z>=.55;
  if(nearL!=(uLayer>.5)){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=0.;vCol=vec3(0.);vAl=0.;vSoft=0.;return;}
  float tm=uTime*aB.x;
  float rise=kind<.5?.040:(kind<1.5?.010:.026);float side=kind<.5?-.020:(kind<1.5?-.006:-.012);
  vec2 p;p.y=fract(aA.y-tm*rise);
  p.x=fract(aA.x+tm*side+.012*sin(tm*1.7+aB.y*6.283)+.006*sin(tm*3.1+aB.y*11.));
  float edge=smoothstep(0.,.08,p.y)*smoothstep(1.,.92,p.y);
  vec2 px=p*uCss+uPar*(z-.4);
  gl_Position=vec4(px/uCss*2.-1.,0.,1.);gl_Position.y*=-1.;
  float tw=.65+.35*sin(uTime*(2.+aB.y*5.)+aB.y*40.);
  gl_PointSize=max(1.,aB.z*(.6+.9*z)*(kind<.5?1.:.85)*uPx*uCss.y/1080.);
  vec3 c=kind<.5?vec3(1.,.50,.20)*3.2:(kind<1.5?vec3(.55,.75,1.)*.55:vec3(.4,1.,1.)*1.5);
  vCol=c;vAl=edge*tw*(.35+.65*z)*uAmt*step(aB.w,uAmt+.0001);vSoft=z;
}`;
  const FS_PART = GLSL_HEAD + `
in vec3 vCol;in float vAl;in float vSoft;out vec4 o;
void main(){vec2 d=gl_PointCoord-.5;float r=length(d)*2.;float a=smoothstep(1.,mix(.15,.0,vSoft),r);o=vec4(vCol*a*vAl,a*vAl);}`;

  /* ---- ground mist in front of the hero ---- */
  const FS_MIST = GLSL_HEAD + GLSL_COMMON + `
in vec2 vUv;out vec4 o;uniform float uTime,uAmt;
void main(){float y=vUv.y;float g=smoothstep(.60,1.,y);
  float n=fbm(vec2(vUv.x*3.-uTime*.02,y*4.+uTime*.012));
  float a=clamp(g*(.62+.38*n),0.,1.)*uAmt;vec3 col=vec3(.010,.018,.040)+vec3(.02,.05,.09)*n*g;
  o=vec4(col*a,a);}`;

  /* ---- logo (premultiplied webp, glitch + shine + pulse line) ---- */
  const VS_QUAD = GLSL_HEAD + `
uniform vec4 uRect;uniform vec2 uCss;out vec2 vL;
void main(){vec2 c=vec2(float(gl_VertexID&1),float((gl_VertexID>>1)&1));vL=c;vec2 px=mix(uRect.xy,uRect.zw,c);vec2 n=px/uCss*2.-1.;gl_Position=vec4(n.x,-n.y,0.,1.);}`;
  const FS_LOGO = GLSL_HEAD + GLSL_COMMON + `
in vec2 vL;out vec4 o;uniform sampler2D uLogo;
uniform float uTime,uBeat,uAppear,uGlitch,uShine,uPulseX,uGain;
vec4 lg(vec2 uv){return texture(uLogo,uv);}
void main(){
  vec2 uv=vL;
  float sl=floor(uv.y*26.+floor(uTime*20.)*3.7);float hs=hash11(sl);
  float on=step(1.-.4*uGlitch,hs)*uGlitch;
  uv.x+=(hash11(sl+9.1)-.5)*.07*on;
  float sp=.004*uGlitch*(.4+on);
  vec4 cr=lg(uv+vec2(sp,0.)),cg=lg(uv),cb=lg(uv-vec2(sp,0.));
  float a=max(cr.a,max(cg.a,cb.a));
  vec3 pm=vec3(cr.r,cg.g,cb.b);
  vec3 col=a>.002?clamp(pm/a,0.,1.):vec3(0.);
  vec3 lin=s2l(col);
  float lineK=smoothstep(.28,.6,col.b-col.r)*smoothstep(.15,.5,col.g-col.r)*smoothstep(.45,.75,col.b);
  float win=exp(-pow((uv.x-uPulseX)/.05,2.));
  lin+=vec3(.25,1.,1.)*lineK*(win*3.2+.45*uBeat)*uGain;
  float metal=smoothstep(.45,.8,luma(lin)*1.6)*(1.-smoothstep(.0,.35,col.b-col.r));
  float s=uv.x*.8+uv.y*.3-uShine*1.7+.45;lin+=vec3(1.,1.,1.)*exp(-pow(s/.055,2.))*metal*.9;
  float ap=uAppear*(1.-.5*on);
  o=vec4(lin*a*ap,a*ap);}`;

  /* ---- post ---- */
  const FS_BRIGHT = GLSL_HEAD + `
in vec2 vTex;out vec4 o;uniform sampler2D uTex;uniform vec2 uTexel;uniform float uThresh,uKnee;
vec3 pre(vec3 c){float br=max(c.r,max(c.g,c.b));float s=clamp(br-uThresh+uKnee,0.,2.*uKnee);s=s*s/(4.*uKnee+1e-4);return c*(max(s,br-uThresh)/max(br,1e-4));}
vec3 T(vec2 off){return pre(texture(uTex,vTex+off*uTexel).rgb);}
void main(){
  vec3 a=T(vec2(-2,-2)),b=T(vec2(0,-2)),c=T(vec2(2,-2)),d=T(vec2(-2,0)),e=T(vec2(0,0)),f=T(vec2(2,0)),g=T(vec2(-2,2)),h=T(vec2(0,2)),i=T(vec2(2,2));
  vec3 j=T(vec2(-1,-1)),k=T(vec2(1,-1)),l=T(vec2(-1,1)),m=T(vec2(1,1));
  vec3 r=e*.125+(a+c+g+i)*.03125+(b+d+f+h)*.0625+(j+k+l+m)*.125;
  o=vec4(min(r,vec3(60.)),1.);}`;
  const FS_DOWN = GLSL_HEAD + `
in vec2 vTex;out vec4 o;uniform sampler2D uTex;uniform vec2 uTexel;
void main(){
  vec3 a=texture(uTex,vTex+uTexel*vec2(-2,-2)).rgb,b=texture(uTex,vTex+uTexel*vec2(0,-2)).rgb,c=texture(uTex,vTex+uTexel*vec2(2,-2)).rgb;
  vec3 d=texture(uTex,vTex+uTexel*vec2(-2,0)).rgb,e=texture(uTex,vTex).rgb,f=texture(uTex,vTex+uTexel*vec2(2,0)).rgb;
  vec3 g=texture(uTex,vTex+uTexel*vec2(-2,2)).rgb,h=texture(uTex,vTex+uTexel*vec2(0,2)).rgb,i=texture(uTex,vTex+uTexel*vec2(2,2)).rgb;
  vec3 j=texture(uTex,vTex+uTexel*vec2(-1,-1)).rgb,k=texture(uTex,vTex+uTexel*vec2(1,-1)).rgb,l=texture(uTex,vTex+uTexel*vec2(-1,1)).rgb,m=texture(uTex,vTex+uTexel*vec2(1,1)).rgb;
  o=vec4(e*.125+(a+c+g+i)*.03125+(b+d+f+h)*.0625+(j+k+l+m)*.125,1.);}`;
  const FS_UP = GLSL_HEAD + `
in vec2 vTex;out vec4 o;uniform sampler2D uLow,uHigh;uniform vec2 uTexel;uniform float uMix;
void main(){
  vec3 s=texture(uLow,vTex+uTexel*vec2(-1,-1)).rgb+2.*texture(uLow,vTex+uTexel*vec2(0,-1)).rgb+texture(uLow,vTex+uTexel*vec2(1,-1)).rgb
   +2.*texture(uLow,vTex+uTexel*vec2(-1,0)).rgb+4.*texture(uLow,vTex).rgb+2.*texture(uLow,vTex+uTexel*vec2(1,0)).rgb
   +texture(uLow,vTex+uTexel*vec2(-1,1)).rgb+2.*texture(uLow,vTex+uTexel*vec2(0,1)).rgb+texture(uLow,vTex+uTexel*vec2(1,1)).rgb;
  o=vec4(texture(uHigh,vTex).rgb+s*(1./16.)*uMix,1.);}`;
  const FS_RAYS = GLSL_HEAD + GLSL_COMMON + `
in vec2 vTex;in vec2 vUv;out vec4 o;uniform sampler2D uTex;uniform vec2 uLight;uniform float uTime,uAmt;
void main(){
  vec2 dir=uLight-vTex;float dist=length(dir);vec2 st=dir/32.*.92;vec3 acc=vec3(0.);float dec=1.;vec2 uv=vTex;
  for(int i=0;i<32;i++){uv+=st;acc+=texture(uTex,uv).rgb*dec;dec*=.955;}
  float an=atan(dir.y,dir.x);
  float shaft=.55+.45*vnoise(vec2(an*17.+uTime*.12,uTime*.05));
  o=vec4(acc*(1./32.)*shaft*uAmt*smoothstep(.0,.25,dist),1.);}`;
  const FS_COMP = GLSL_HEAD + GLSL_COMMON + `
in vec2 vUv;in vec2 vTex;out vec4 o;
uniform sampler2D uScene,uBloom,uRays;uniform float uTime,uBloomK,uRaysK,uVig,uGrain,uCa,uWhite,uFade;
vec3 soft(vec3 c){return mix(c,.8+.2*tanh((c-.8)/.2),step(.8,c));}
void main(){
  vec2 cc=vUv-.5;float r2=dot(cc*vec2(1.,.6),cc*vec2(1.,.6));vec2 off=cc*uCa*r2*2.;
  vec3 s=vec3(texture(uScene,vTex+vec2(off.x,-off.y)).r,texture(uScene,vTex).g,texture(uScene,vTex-vec2(off.x,-off.y)).b);
  vec3 c=s+texture(uBloom,vTex).rgb*uBloomK+texture(uRays,vTex).rgb*uRaysK;
  float l=luma(c);c=mix(vec3(l),c,1.07);
  c*=mix(1.,smoothstep(1.05,.30,length(cc*vec2(1.,.82)*1.2)),uVig);
  c=mix(c,vec3(.55,.95,1.),uWhite);
  c*=uFade;
  c=soft(c);c=pow(max(c,0.),vec3(1./2.2));
  float n=hash21(gl_FragCoord.xy+fract(uTime*7.3)*vec2(113.,71.))-.5;
  float n2=hash21(gl_FragCoord.xy*1.37+fract(uTime*3.1)*vec2(37.,91.))-.5;
  c+=(n+n2)*(uGrain+1.4/255.);
  o=vec4(c,1.);}`;

  /* ------------------------------------------------------------------ GL helpers */
  // extensions have to be asked for again after a context restore
  function enableExt(gl) {
    const ext = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    gl.__hdr = !!ext;
    gl.getExtension('OES_texture_float_linear');
  }
  function makeGL(canvas) {
    const gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false});
    if (!gl) return null;
    enableExt(gl);
    return gl;
  }
  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('shader: ' + log + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n').slice(0, 6000)); }
    return s;
  }
  function program(gl, vs, fs, bind) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    if (bind) for (const k in bind) gl.bindAttribLocation(p, bind[k], k);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const cache = new Map();
    const loc = n => { if (!cache.has(n)) cache.set(n, gl.getUniformLocation(p, n)); return cache.get(n); };
    const set = (n, v, v1, v2, v3) => {
      const l = loc(n); if (l == null) return;
      if (typeof v === 'number') { if (v1 === undefined) gl.uniform1f(l, v); else if (v2 === undefined) gl.uniform2f(l, v, v1); else if (v3 === undefined) gl.uniform3f(l, v, v1, v2); else gl.uniform4f(l, v, v1, v2, v3); }
      else if (v.length === 2 && !(v instanceof Float32Array && v.length > 4)) gl.uniform2fv(l, v);
      else if (v.length === 3) gl.uniform3fv(l, v);
      else if (v.length === 4) gl.uniform4fv(l, v);
      else gl.uniform2fv(l, v);   // vec2 arrays
    };
    const seti = (n, v) => { const l = loc(n); if (l != null) gl.uniform1i(l, v); };
    return {p, set, seti, use: () => gl.useProgram(p), loc};
  }
  function texFrom(gl, bitmap, o) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, o.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    if (o.mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, o.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, o.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    return t;
  }
  function target(gl, w, h, hdr) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return {t, f, w, h};
  }
  const killTarget = (gl, r) => { if (!r) return; gl.deleteTexture(r.t); gl.deleteFramebuffer(r.f); };

  /* ------------------------------------------------------------------ assets (http first, embedded data URIs for file://) */
  let embeddedPromise = null;
  function embeddedAssets() {
    if (window.AFTERSIGNAL_TITLE_LIVE2D_ASSETS) return Promise.resolve(window.AFTERSIGNAL_TITLE_LIVE2D_ASSETS);
    if (embeddedPromise) return embeddedPromise;
    embeddedPromise = new Promise(resolve => {
      if (!SELF_SRC) return resolve(null);
      const s = document.createElement('script');
      s.src = SELF_SRC.replace(/AFTERSIGNAL_TITLE_LIVE2D_V1\.js/, 'AFTERSIGNAL_TITLE_LIVE2D_V1_ASSETS.js');
      s.onload = () => resolve(window.AFTERSIGNAL_TITLE_LIVE2D_ASSETS || null); s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
    return embeddedPromise;
  }
  const dataToBlob = d => { const m = /^data:([^;]+);base64,(.*)$/.exec(d); const bin = atob(m[2]); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], {type: m[1]}); };
  async function loadBitmap(key, url, opts) {
    try {
      // file:// pages cannot fetch or upload their own textures to WebGL: go straight to the embedded copy (no console noise)
      if (new URL(url, document.baseURI).protocol === 'file:') throw new Error('file protocol');
      const r = await fetch(url); if (!r.ok) throw new Error('http ' + r.status);
      return await createImageBitmap(await r.blob(), opts);
    } catch (err) {
      const emb = await embeddedAssets();
      if (emb && emb[key]) return createImageBitmap(dataToBlob(emb[key]), opts);
      throw err;
    }
  }

  /* ------------------------------------------------------------------ simulation state */
  const PLATE = {w: 1536, h: 1024, beamX: .682, crownY: .212};
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

  const S = {
    inited: false, running: false, manual: false, reduced: false,
    time: 0, tl: -1, activeAt: null, startT: -1, startedAction: false,
    px: 0, py: 0, pTx: 0, pTy: 0, pointerSeen: false,
    breathPhase: 0, hB: 0,
    gesture: {t0: -99, dur: 2.2, yaw: 0, roll: 0, gx: 0, gy: 0, next: 6},
    blink: {next: 2.2, t: -1, double: false, active: false, b: 0, bR: 0},
    saccade: {next: 1.2, x: 0, y: 0, cx: 0, cy: 0},
    flash: {next: 11, t0: -99},
    glitch: {next: 9.5, t0: -99}, glitchBurst: 0, beatCss: -1, hostAt: 0,
    prevHx: 0, prevHvx: 0, prevHy: 0, prevHvy: 0,
    sig: {},
    layout: null, size: {w: 0, h: 0}, scale: 1, perf: {dts: [], lastCheck: 0, lockUntil: 0, ok: 0},
    debug: {masks: false, still: false, over: null}
  };
  const HAIR = {
    L: makeChain([2.2, 1.7, 1.35, 1.05, .8], [.55, .5, .45, .42, .4], [.2, .5, .9, 1.3, 1.7], [.4, .8, 1.1, 1.4, 1.7], .35),
    R: makeChain([2.6, 2.1, 1.7], [.55, .5, .45], [.7, 1.9, 3.4], [1., 1.7, 2.4], .35),
    B: makeChain([3., 2.4], [.6, .55], [1.6, 4.5], [.8, 1.6], .4)
  };
  const hairL = new Float32Array(12), hairR = new Float32Array(8), hairB = new Float32Array(6);

  function updateSim(dt) {
    const t = S.time, red = S.reduced;
    const amp = red ? .25 : 1;
    const ramp = (red ? .25 : smooth(.6, 2.4, S.tl)) ;
    S.px += (S.pTx - S.px) * (1 - Math.exp(-dt * 4.5)); S.py += (S.pTy - S.py) * (1 - Math.exp(-dt * 4.5));
    // breathing: shorter inhale, longer exhale
    S.breathPhase += dt / (4.4 * (1 + .07 * Math.sin(t * .21)));
    const bp = S.breathPhase % 1;
    const B = bp < .4 ? .5 - .5 * Math.cos(Math.PI * bp / .4) : .5 + .5 * Math.cos(Math.PI * (bp - .4) / .6);
    S.hB += (B - S.hB) * (1 - Math.exp(-dt / .35));
    // look gestures every few seconds: a little turn, roll and glance, usually with a blink
    const g = S.gesture;
    if (S.tl > 1.8 && t >= g.next) {
      g.t0 = t; g.dur = rand(1.8, 2.8); g.yaw = rand(-1, 1) * 1.9; g.roll = rand(-1, 1) * .011; g.gx = rand(-1, 1) * 1.5; g.gy = rand(-.5, .5);
      g.next = t + rand(7, 13); if (rng() < .7) S.blink.next = Math.min(S.blink.next, t + rand(.2, .5));
    }
    const gp = clamp((t - g.t0) / g.dur, 0, 1), gs = Math.sin(Math.PI * gp) ** 2 * (gp > 0 && gp < 1 ? 1 : 0);
    // micro saccades keep the eyes alive
    const sc = S.saccade;
    if (t >= sc.next) { sc.x = rand(-.55, .55); sc.y = rand(-.3, .3); sc.next = t + rand(.9, 3.2); }
    sc.cx += (sc.x - sc.cx) * (1 - Math.exp(-dt / .045)); sc.cy += (sc.y - sc.cy) * (1 - Math.exp(-dt / .045));
    // blink
    const bl = S.blink;
    if (!bl.active && t >= bl.next && S.tl > 1.2) { bl.active = true; bl.t = 0; bl.double = rng() < .18; }
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
    const psi1 = ramp * .0046 * amp * (Math.sin(TAU * t / 8.6 + .4) * .75 + Math.sin(TAU * t / 5.3 + 1.7) * .25);
    const psi2 = -.5 * psi1 + ramp * .0012 * amp * Math.sin(TAU * t / 6.7 + 2.);
    const headDx = ramp * amp * 1.7 * wob(t, .73, 1.21, 2.3, .6) + S.px * 3.2 * amp;
    const headDy = ramp * amp * .9 * wob(t, .61, 1.1, 1.9, 1.4) + (B - S.hB) * 1.6 + S.py * 1.6 * amp;
    const roll = ramp * amp * .0075 * wob(t, .62, .97, 1.7, .2) + gs * g.roll * ramp + S.px * .012 * amp;
    const yaw = ramp * amp * .9 * wob(t, .5, .87, 1.4, 2.3) + gs * g.yaw * ramp + S.px * 2.4 * amp;
    const pitch = S.py * 1.6 * amp + gs * g.gy * .8 * ramp;
    const gazeX = clamp(S.px * 1.15 + gs * g.gx + sc.cx, -1.9, 1.9) * ramp, gazeY = clamp(S.py * .7 + gs * g.gy * .6 + sc.cy, -1., 1.) * ramp;
    S.sig = {B, psi1, psi2, headDx, headDy, roll, yaw, pitch, gazeX, gazeY};
    const ov = S.debug.over;
    if (ov) { for (const k in ov) if (k in S.sig) S.sig[k] = ov[k]; if (ov.blink != null) { bl.b = ov.blink; bl.bR = ov.blink; } if (ov.noIdle) { Object.assign(S.sig, {psi1: 0, psi2: 0, headDx: 0, headDy: 0, roll: 0, yaw: 0, pitch: 0, gazeX: 0, gazeY: 0}); } }
    // hair: inertial pseudo force from the head frame + wind
    const hx = headDx + psi1 * 1100, hy = headDy;
    const hvx = (hx - S.prevHx) / Math.max(dt, 1e-4), hvy = (hy - S.prevHy) / Math.max(dt, 1e-4);
    const hax = clamp((hvx - S.prevHvx) / Math.max(dt, 1e-4), -900, 900), hay = clamp((hvy - S.prevHvy) / Math.max(dt, 1e-4), -900, 900);
    S.prevHx = hx; S.prevHy = hy; S.prevHvx = hvx; S.prevHvy = hvy;
    const env = .6 + .4 * Math.sin(t * .37 + .9);
    const wind = (ph, gain) => (230 * env * wob(t, 1.9, 3.1, 4.7, ph) - 42) * gain * ramp * amp;
    const windY = ph => 60 * env * wob(t, 1.3, 2.3, 3.7, ph + 1.1) * ramp * amp;
    const first = S.tl < .05 ? 0 : 1;
    stepChain(HAIR.L, dt, wind(.3, 1), windY(.3), hax * first, hay * first);
    stepChain(HAIR.R, dt, wind(1.7, .8), windY(1.7), hax * first, hay * first);
    stepChain(HAIR.B, dt, wind(2.9, .6), windY(2.9), hax * first, hay * first);
    chainUniform(HAIR.L, hairL); chainUniform(HAIR.R, hairR); chainUniform(HAIR.B, hairB);
    // signal heartbeat: a lub-dub every 2.6 s, shared by the logo line, the hero lights, the beam and the rings
    const P = 2.6, x = (t % P) / P;
    const beat = clamp(Math.exp(-Math.pow((x - .06) / .022, 2)) + .6 * Math.exp(-Math.pow((x - .15) / .028, 2)), 0, 1);
    S.beat = lerp(.12, 1, beat) * (S.tl > 0 ? 1 : .5);
    S.pings = [((t % P) - .06 * P), ((t % P) - .06 * P) + P, -1];
    for (let i = 0; i < 2; i++) if (S.pings[i] > 2.6) S.pings[i] = -1;
    // lightning: a rare soft flash in the cloud ceiling
    if (!red && S.tl > 2 && t >= S.flash.next) { S.flash.t0 = t; S.flash.next = t + rand(10, 19); }
    if (!red && S.tl > 4 && t >= S.glitch.next) { S.glitch.t0 = t; S.glitch.next = t + rand(8, 15); }
    const ga = t - S.glitch.t0;
    S.glitchBurst = (!red && ga >= 0 && ga < .2) ? (1 - ga / .2) * .35 : 0;
    const ft = t - S.flash.t0;
    S.flashV = red ? 0 : (ft > 0 && ft < 1.4) ? (Math.exp(-ft * 6.5) * .8 + (ft > .17 ? Math.exp(-(ft - .17) * 7) * .55 : 0)) : 0;
  }

  /* ------------------------------------------------------------------ layout */
  function computeLayout(w, h) {
    const aspect = w / h;
    let hero;
    if (aspect >= 1.15) {
      const sc = h * .965 / 1002, fx = clamp(.42 + .1 * aspect, .54, .665);
      hero = {S: sc, ox: w * fx - 520 * sc, oy: h * .04 - 8 * sc};
    } else {
      const sc = Math.min(w * 1.02 / 640, h * .78 / 1002);
      hero = {S: sc, ox: w * .5 - 560 * sc, oy: h * .21 - 8 * sc};
    }
    const zoomBase = 1.045;
    const k = 1 / (Math.max(w / PLATE.w, h / PLATE.h) * zoomBase);
    const vw = w * k / PLATE.w, vh = h * k / PLATE.h;
    const cx = clamp(aspect >= 1.15 ? .5 : .56, vw / 2, 1 - vw / 2), cy = clamp(.47, vh / 2, 1 - vh / 2);
    return {hero, bg: {vw, vh, cx, cy}, aspect};
  }

  /* ------------------------------------------------------------------ renderer */
  const R = {gl: null, progs: {}, tex: {}, fbo: {}, vao: null, partVao: null, partCount: 0, canvas: null, stage: null, logoSlot: null, lost: false, assets: null, onFail: null, gen: 0};

  function buildPrograms(gl) {
    const P = R.progs;
    P.bg = program(gl, VS_FULL, FS_BG); P.rings = program(gl, VS_FULL, FS_RINGS); P.mist = program(gl, VS_FULL, FS_MIST);
    P.hero = program(gl, VS_HERO, FS_HERO);
    P.part = program(gl, VS_PART, FS_PART, {aA: 0, aB: 1});
    P.logo = program(gl, VS_QUAD, FS_LOGO);
    P.bright = program(gl, VS_FULL, FS_BRIGHT); P.down = program(gl, VS_FULL, FS_DOWN); P.up = program(gl, VS_FULL, FS_UP);
    P.rays = program(gl, VS_FULL, FS_RAYS); P.comp = program(gl, VS_FULL, FS_COMP);
  }
  function buildParticles(gl) {
    const N = 760, data = new Float32Array(N * 8);
    for (let i = 0; i < N; i++) {
      const r = rng(); const kind = r < .34 ? 0 : r < .80 ? 1 : 2;
      const z = rng();
      const o = i * 8;
      data[o] = rng(); data[o + 1] = rng(); data[o + 2] = z; data[o + 3] = kind;
      data[o + 4] = .55 + rng() * .9;                      // speed multiplier
      data[o + 5] = rng();                                  // phase
      data[o + 6] = kind === 0 ? 2.2 + rng() * 2.6 : kind === 1 ? 1.4 + rng() * 2.4 : 2.4 + rng() * 2.2;   // size
      data[o + 7] = i / N;                                          // density rank (quality scaling)
    }
    R.partVao = gl.createVertexArray(); gl.bindVertexArray(R.partVao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    R.partCount = N; gl.bindVertexArray(null);
  }
  // every GL object is made from the assets here: init() and a restored context run the same code
  async function setupGL(gl, A) {
    const [bgB, logoB, heroB, maskB] = await Promise.all([
      loadBitmap('bg', A.bg, {premultiplyAlpha: 'none', colorSpaceConversion: 'none'}),
      loadBitmap('logo', A.logo, {premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none'}),
      loadBitmap('hero', A.hero, {premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none'}),
      loadBitmap('masks', A.masks, {premultiplyAlpha: 'none', colorSpaceConversion: 'none'})
    ]);
    buildPrograms(gl);
    R.vao = gl.createVertexArray(); buildParticles(gl);
    R.tex.bg = texFrom(gl, bgB, {srgb: true, mips: true}); R.tex.logo = texFrom(gl, logoB, {mips: true});
    R.tex.hero = texFrom(gl, heroB, {mips: true}); R.tex.mask = texFrom(gl, maskB, {});
    [bgB, logoB, heroB, maskB].forEach(b => b.close && b.close());
  }
  function allocTargets(gl, w, h) {
    const F = R.fbo; for (const k in F) { if (Array.isArray(F[k])) F[k].forEach(r => killTarget(gl, r)); else killTarget(gl, F[k]); }
    const hdr = gl.__hdr;
    F.scene = target(gl, w, h, hdr);
    F.down = []; F.up = [];
    let bw = w, bh = h;
    for (let i = 0; i < 5; i++) { bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1); F.down.push(target(gl, bw, bh, hdr)); }
    for (let i = 0; i < 4; i++) { const d = F.down[i]; F.up.push(target(gl, d.w, d.h, hdr)); }
    F.rays = target(gl, Math.max(2, w >> 2), Math.max(2, h >> 2), hdr);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function resize(force) {
    const gl = R.gl; if (!gl) return;
    const rect = R.canvas.getBoundingClientRect();
    const cw = Math.max(1, Math.round(rect.width)), ch = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxW = Math.max(2, Math.round(cw * dpr * S.scale)), pxH = Math.max(2, Math.round(ch * dpr * S.scale));
    if (!force && R.canvas.width === pxW && R.canvas.height === pxH && S.size.w === cw && S.size.h === ch) return;
    R.canvas.width = pxW; R.canvas.height = pxH; S.size = {w: cw, h: ch}; S.layout = computeLayout(cw, ch);
    allocTargets(gl, pxW, pxH);
  }

  function bindFull(gl) { gl.bindVertexArray(R.vao); }
  function drawFull(gl) { gl.drawArrays(gl.TRIANGLES, 0, 3); }
  function useTex(gl, unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }

  function logoRect() {
    const slot = R.logoSlot; if (!slot) return null;
    const a = slot.getBoundingClientRect(), c = R.canvas.getBoundingClientRect();
    return [a.left - c.left, a.top - c.top, a.right - c.left, a.bottom - c.top];
  }

  function render() {
    const gl = R.gl; if (!gl || R.lost) return;
    const F = R.fbo, P = R.progs, L = S.layout, sig = S.sig;
    if (!L || !F.scene) return;
    const {w: cw, h: ch} = S.size, W = R.canvas.width, H = R.canvas.height;
    const tl = S.tl, t = S.time;
    // camera: entry push + start push, pointer parallax
    const push = 1 + .07 * (1 - easeOut(tl / 4.2)) + (S.startT >= 0 ? .09 * easeInOut((t - S.startT) / .5) : 0);
    const fade = tl < 0 ? .38 : lerp(.38, 1, smooth(0., .9, tl));
    const ignite = tl < 0 ? .25 : lerp(.25, 1, smooth(.25, 1.5, tl));
    const parX = S.reduced ? 0 : S.px, parY = S.reduced ? 0 : S.py;
    // ---------------- scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.scene.f); gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    // background
    const bg = L.bg, vw = bg.vw / push, vh = bg.vh / push;
    P.bg.use(); bindFull(gl); useTex(gl, 0, R.tex.bg); P.bg.seti('uBg', 0);
    P.bg.set('uTime', t); P.bg.set('uBeat', S.beat || .3); P.bg.set('uIgnite', ignite); P.bg.set('uFlash', S.flashV || 0); P.bg.set('uFade', fade);
    P.bg.set('uView', vw, vh, bg.cx + parX * .004 * 0, bg.cy);
    P.bg.set('uPar', -parX * .0105, -parY * .006); P.bg.set('uBeam', PLATE.beamX, PLATE.crownY);
    drawFull(gl);
    // hud rings
    const hero = L.hero, hs = hero.S * push;
    const cxs = cw / 2, cys = ch * .55;
    const hox = cxs + (hero.ox - cxs) * push - parX * 10 * hs + (1 - easeOut((tl - .5) / 1.6)) * 36 * (tl < 0 ? 1 : 1);
    const hoy = cys + (hero.oy - cys) * push - parY * 5 * hs + (1 - easeOut((tl - .5) / 1.6)) * 22;
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    P.rings.use(); bindFull(gl);
    const hud = tl < 0 ? 0 : smooth(.4, 1.6, tl) * (S.reduced ? .6 : 1);
    P.rings.set('uCss', cw, ch); P.rings.set('uCenter', hox + 560 * hs, hoy + 470 * hs); P.rings.set('uUnit', 1000 * hs);
    P.rings.set('uTime', t); P.rings.set('uBeat', S.beat || .3); P.rings.set('uHud', hud);
    P.rings.set('uBurst', S.startT >= 0 ? clamp((t - S.startT) / .55, 0, .999) : 0);
    P.rings.set('uPing', (S.pings || [-1, -1, -1]).map(v => v)); drawFull(gl);
    // far particles
    drawParticles(gl, 0, cw, ch, W, parX, parY);
    // hero
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    P.hero.use(); gl.bindVertexArray(R.vao);
    useTex(gl, 0, R.tex.hero); useTex(gl, 1, R.tex.mask); P.hero.seti('uTex', 0); P.hero.seti('uMask', 1);
    P.hero.set('uXf', hs, hox, hoy, 0); P.hero.set('uCss', cw, ch); P.hero.set('uRect', -140, -140, 1164, 1676);
    P.hero.set('uTime', t);
    P.hero.set('uBody', sig.psi1, sig.psi2, sig.B, 0);
    P.hero.set('uHead', sig.headDx, sig.headDy, sig.roll, sig.yaw);
    P.hero.set('uHead2', sig.pitch, sig.gazeX, sig.gazeY, S.reduced ? .2 : 1.1);
    P.hero.set('uBlink', S.blink.b, S.blink.bR);
    P.hero.set('uHairL', hairL); P.hero.set('uHairR', hairR); P.hero.set('uBang', hairB);
    const reveal = tl < 0 ? 0 : easeInOut((tl - .55) / 1.35);
    P.hero.set('uFx', S.beat || .3, reveal, .85, 1.0);
    const minify = hs < 1 ? Math.log2(1 / hs) : 0;
    P.hero.set('uFx2', 1, S.debug.masks ? 1 : 0, minify, S.startT >= 0 ? easeInOut((t - S.startT) / .5) : 0);
    P.hero.set('uRimDir', .86, -.2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // near particles
    gl.blendFunc(gl.ONE, gl.ONE);
    drawParticles(gl, 1, cw, ch, W, parX, parY);
    // mist
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    P.mist.use(); bindFull(gl); P.mist.set('uTime', t); P.mist.set('uAmt', tl < 0 ? .5 : 1); drawFull(gl);
    // logo
    const lr = logoRect();
    if (lr && R.tex.logo && tl >= 1.2) {
      const lt = tl - 1.45;
      const appear = lt < 0 ? 0 : smooth(0, .3, lt) * (lt < .45 ? (.55 + .45 * (Math.sin(lt * 90) > -.2 ? 1 : 0)) : 1);
      const glitch = S.reduced ? 0 : lt < 0 ? 0 : lt < .5 ? 1 - lt / .5 : (S.glitchBurst > 0 ? S.glitchBurst : 0);
      const shine = clamp((tl - 2.45) / 1.15, 0, 1.5);
      const pulseX = ((t * .38) % 1.9) - .45;
      P.logo.use(); gl.bindVertexArray(R.vao); useTex(gl, 0, R.tex.logo); P.logo.seti('uLogo', 0);
      P.logo.set('uRect', lr[0], lr[1], lr[2], lr[3]); P.logo.set('uCss', cw, ch);
      P.logo.set('uTime', t); P.logo.set('uBeat', S.beat || .3); P.logo.set('uAppear', appear); P.logo.set('uGlitch', glitch);
      P.logo.set('uShine', shine); P.logo.set('uPulseX', pulseX); P.logo.set('uGain', 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND);
    // ---------------- bloom
    bindFull(gl);
    P.bright.use(); gl.bindFramebuffer(gl.FRAMEBUFFER, F.down[0].f); gl.viewport(0, 0, F.down[0].w, F.down[0].h);
    useTex(gl, 0, F.scene.t); P.bright.seti('uTex', 0); P.bright.set('uTexel', 1 / W, 1 / H); P.bright.set('uThresh', 1.0); P.bright.set('uKnee', .35); drawFull(gl);
    P.down.use();
    for (let i = 1; i < 5; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, F.down[i].f); gl.viewport(0, 0, F.down[i].w, F.down[i].h);
      useTex(gl, 0, F.down[i - 1].t); P.down.seti('uTex', 0); P.down.set('uTexel', 1 / F.down[i - 1].w, 1 / F.down[i - 1].h); drawFull(gl);
    }
    P.up.use();
    for (let i = 3; i >= 0; i--) {
      const low = i === 3 ? F.down[4] : F.up[i + 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, F.up[i].f); gl.viewport(0, 0, F.up[i].w, F.up[i].h);
      useTex(gl, 0, low.t); useTex(gl, 1, F.down[i].t); P.up.seti('uLow', 0); P.up.seti('uHigh', 1);
      P.up.set('uTexel', 1 / low.w, 1 / low.h); P.up.set('uMix', .78); drawFull(gl);
    }
    // god rays from the beam crown
    const crown = bgToScreen(L, PLATE.beamX, PLATE.crownY, vw, vh, parX, parY);
    P.rays.use(); gl.bindFramebuffer(gl.FRAMEBUFFER, F.rays.f); gl.viewport(0, 0, F.rays.w, F.rays.h);
    useTex(gl, 0, F.down[1].t); P.rays.seti('uTex', 0); P.rays.set('uLight', crown[0], 1 - crown[1]); P.rays.set('uTime', t); P.rays.set('uAmt', (.5 + .5 * (S.beat || .3)) * ignite); drawFull(gl);
    // composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    P.comp.use();
    useTex(gl, 0, F.scene.t); useTex(gl, 1, F.up[0].t); useTex(gl, 2, F.rays.t);
    P.comp.seti('uScene', 0); P.comp.seti('uBloom', 1); P.comp.seti('uRays', 2);
    P.comp.set('uTime', t); P.comp.set('uBloomK', .66); P.comp.set('uRaysK', .30); P.comp.set('uVig', .85); P.comp.set('uGrain', .012);
    P.comp.set('uCa', S.reduced ? 0 : .0016);
    P.comp.set('uWhite', S.startT >= 0 ? .55 * easeInOut((t - S.startT) / .5) : 0); P.comp.set('uFade', 1);
    drawFull(gl);
  }
  function bgToScreen(L, bx, by, vw, vh, parX, parY) {
    // inverse of the plate mapping for a far point (depth ~ .1): screen uv, y down
    const par = [-parX * .0105 * (.1 - .35), -parY * .006 * (.1 - .35)];
    return [((bx - par[0]) - L.bg.cx) / vw + .5, ((by - par[1]) - L.bg.cy) / vh + .5];
  }
  function drawParticles(gl, layer, cw, ch, W, parX, parY) {
    const p = R.progs.part; p.use(); gl.bindVertexArray(R.partVao);
    p.set('uTime', S.time); p.set('uLayer', layer); p.set('uPx', W / cw); p.set('uCss', cw, ch);
    p.set('uPar', -parX * 26, -parY * 14); p.set('uAmt', S.tl < 0 ? .25 : smooth(.3, 2.2, S.tl) * (S.reduced ? .35 : 1));
    gl.drawArrays(gl.POINTS, 0, R.partCount);
  }

  /* ------------------------------------------------------------------ loop */
  let raf = 0, lastTs = 0;
  function hostShowsTitle() {
    try {
      if (window.parent === window) return true;
      const f = window.parent.__AFTERSIGNAL_ACTIVE_SCREEN__;
      return typeof f !== 'function' || f() === 'title';
    } catch (e) { return true; }
  }
  function retire() {
    S.running = false; if (raf) cancelAnimationFrame(raf); raf = 0;
    // keep the last frame on screen while the host crossfades to the next screen; free the GPU memory afterwards
    setTimeout(() => { try { const x = R.gl && R.gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { /* ignore */ } }, 6000);
  }
  function giveUp(why) {
    console.warn('[title-live2d] ' + why + ': static layout');
    S.running = false; if (raf) cancelAnimationFrame(raf); raf = 0;
    try { if (R.stage) R.stage.classList.remove('gl-on'); } catch (e) { /* ignore */ }
    try { if (R.onFail) R.onFail(); } catch (e) { /* ignore */ }
  }
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (ts - S.hostAt > 500) { S.hostAt = ts; if (!hostShowsTitle()) { retire(); return; } }
    if (!S.running || R.lost || document.hidden) { lastTs = ts; return; }
    let dt = lastTs ? (ts - lastTs) / 1000 : 1 / 60; lastTs = ts; dt = clamp(dt, 0, .05);
    if (!S.debug.still) tick(dt);
    adaptScale(dt);
  }
  function tick(dt) {
    S.time += dt;
    if (S.activeAt !== null) S.tl = S.time - S.activeAt; else S.tl = -1;
    updateSim(dt);
    resize(false);
    render();
    const bq = Math.round((S.beat || 0) * 40) / 40;
    if (bq !== S.beatCss && R.stage) { S.beatCss = bq; R.stage.style.setProperty('--beat', bq.toFixed(3)); }
  }
  function adaptScale(dt) {
    const pf = S.perf; pf.dts.push(dt);
    if (pf.dts.length < 90) return;
    const a = pf.dts.slice().sort((x, y) => x - y), p75 = a[Math.floor(a.length * .75)]; pf.dts.length = 0;
    const now = S.time;
    if (p75 > .026 && S.scale > .6 && now > pf.lockUntil) { S.scale = Math.max(.6, S.scale * .85); pf.lockUntil = now + 8; pf.ok = 0; resize(true); }
    else if (p75 < .0185) { pf.ok++; if (pf.ok >= 3 && S.scale < 1 && now > pf.lockUntil) { S.scale = Math.min(1, S.scale * 1.1); pf.ok = 0; pf.lockUntil = now + 8; resize(true); } }
    else pf.ok = 0;
  }

  /* ------------------------------------------------------------------ gate: wait until the host audio gate / intro movie are gone */
  function watchHost(onActive) {
    let done = false;
    const fire = () => { if (!done) { done = true; onActive(); } };
    try {
      if (window.parent === window) return fire();
      const pd = window.parent.document, gate = pd.getElementById('audioGate'), intro = pd.getElementById('afIntro');
      if (!gate) return fire();
      const ok = () => gate.classList.contains('off') && !pd.body.classList.contains('af-intro-playing') && (!intro || intro.classList.contains('off'));
      if (ok()) return fire();
      const mo = new MutationObserver(() => { if (ok()) { mo.disconnect(); clearInterval(iv); fire(); } });
      [gate, intro, pd.body].forEach(n => n && mo.observe(n, {attributes: true, attributeFilter: ['class']}));
      const iv = setInterval(() => { if (ok()) { mo.disconnect(); clearInterval(iv); fire(); } }, 400);
    } catch (e) { fire(); }
  }

  /* ------------------------------------------------------------------ public API */
  async function init(opts) {
    if (S.inited) return true;
    try {
      const canvas = opts.canvas; R.canvas = canvas; R.stage = opts.stage || canvas.parentElement; R.logoSlot = opts.logoSlot || null;
      const gl = makeGL(canvas); if (!gl) throw new Error('webgl2 unavailable');
      R.gl = gl;
      S.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const q = new URLSearchParams(location.search);
      if (q.get('motion') === 'full') S.reduced = false;
      S.manual = q.get('manual') === '1'; S.debug.masks = q.get('masks') === '1';
      if (S.manual || q.get('seed')) rng = mulberry(Number(q.get('seed')) || 1);
      S.breathPhase = rng();
      R.assets = opts.assets; R.onFail = typeof opts.onFail === 'function' ? opts.onFail : null;
      await setupGL(gl, R.assets);
      canvas.addEventListener('webglcontextlost', e => {
        e.preventDefault(); R.lost = true;
        // the browser normally restores a lost context within moments; if it does not, the page gets its static layout back
        setTimeout(() => { if (R.lost && S.running) giveUp('context not restored'); }, 5000);
      });
      canvas.addEventListener('webglcontextrestored', async () => {
        if (!S.running) return;   // retired or stopped while the context was gone: nothing to bring back
        const gen = ++R.gen;
        try {
          enableExt(R.gl); R.progs = {}; R.tex = {}; R.fbo = {};
          await setupGL(R.gl, R.assets);
          if (gen !== R.gen || R.gl.isContextLost()) return;   // lost again while rebuilding: the next restore starts over
          S.size = {w: 0, h: 0}; resize(true); R.lost = false;
        } catch (err) {
          if (R.gl.isContextLost()) return;
          giveUp('context restore failed: ' + (err && err.message ? String(err.message).split('\n')[0] : err));
        }
      });
      window.addEventListener('pointermove', e => {
        const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
        S.pTx = clamp((e.clientX / w - .5) * 2, -1, 1); S.pTy = clamp((e.clientY / h - .5) * 2, -1, 1); S.pointerSeen = true;
      }, {passive: true});
      document.addEventListener('pointerleave', () => { S.pTx = 0; S.pTy = 0; });
      new ResizeObserver(() => resize(false)).observe(canvas);
      S.scale = 1; S.size = {w: 0, h: 0}; resize(true);
      S.inited = true; S.running = true;
      R.stage.classList.add('gl-on');
      if (S.manual) { S.activeAt = 0; S.time = 0; } else watchHost(() => { S.activeAt = S.time; S.tl = 0; if (opts.onActive) opts.onActive(); });
      if (!S.manual) raf = requestAnimationFrame(frame);
      // draw one dim frame right away so the scene is visible behind the audio gate
      tick(1 / 60);
      return true;
    } catch (err) {
      console.warn('[title-live2d] fallback to the static layout:', err && err.message ? err.message.split('\n')[0] : err);
      try { if (R.stage) R.stage.classList.remove('gl-on'); } catch (e2) { /* ignore */ }
      S.inited = false; S.running = false;
      return false;
    }
  }
  function triggerStart() { if (S.startT < 0) S.startT = S.time; }
  const api = {
    version: VERSION, init, triggerStart,
    stop() { S.running = false; if (raf) cancelAnimationFrame(raf); },
    get active() { return S.inited && S.running; },
    debug: {
      state: S, sim: () => S.sig,
      step(dt, n = 1) { for (let i = 0; i < n; i++) tick(dt); },
      setActive() { S.activeAt = S.time; },
      seek(tl) { S.activeAt = S.time - tl; },
      still(v) { S.debug.still = !!v; },
      masks(v) { S.debug.masks = !!v; },
      over(o) { S.debug.over = o; },
      pointer(x, y) { S.pTx = x; S.pTy = y; },
      blinkNow() { S.blink.next = 0; },
      sample(n, dt = 1 / 60) { const out = []; for (let i = 0; i < n; i++) { S.time += dt; S.tl = S.activeAt !== null ? S.time - S.activeAt : -1; updateSim(dt); out.push([S.tl, S.sig.B, S.sig.psi1, S.sig.psi2, S.sig.headDx, S.sig.headDy, S.sig.roll, S.sig.yaw, S.sig.gazeX, S.sig.gazeY, S.blink.b, hairL[10], hairL[11], hairL[4], hairR[6], hairB[4]]); } return out; },
      loseContext(restoreAfterMs = 400) { const x = R.gl.getExtension('WEBGL_lose_context'); x.loseContext(); if (restoreAfterMs >= 0) setTimeout(() => x.restoreContext(), restoreAfterMs); },
      glErrors() { const gl = R.gl, e = []; let c; while ((c = gl.getError()) !== gl.NO_ERROR && e.length < 20) e.push(c); return e; },
      render
    }
  };
  window.AfterSignalTitleLive2D = api;
})();
