/* AFTER SIGNAL ENEMY LIVE2D V1 (Claude Code, 2026-09-28)
   Live2D-style enemy animation for the canvas-2D combat runtime (HISTORY/2026-09-28_ENEMY_LIVE2D_CH06_11_V1.md).
   User request 2026-09-28: regular mobs get a light Live2D from their FRONT; mid-bosses and chapter bosses are
   rigged from painted parts. Rigs come from AFTERSIGNAL_ENEMY_RIG_DATA_V1.js (window.AfterSignalEnemyRigData),
   keyed by the enemy spec asset path. Enemies without a rig keep the runtime's plain drawImage.

   Two rig kinds:
   - "mesh": the FRONT is drawn in horizontal strips (a 1-D deformer mesh): breathing (chest bulge + vertical
     scale about the feet), sway (top shifts, feet planted for ground units), step bounce while moving, bob/tilt
     for aerial units, wind-up (attackTelegraph), strike lunge toward the camera, hit squash/recoil, phase break.
   - "parts": a base layer plus painted part layers in FRONT pixel coordinates; each part has a pivot, a parent and
     a role preset (arm, wing, leg, head, ring, core, tail, pendulum, ribs, sway ...). The body transform is shared
     by all parts; clips are driven by combat state (idle / move / attack wind-up + strike / hit / break).
   Coordinates: FRONT natural pixels. The runtime may replace the FRONT by a cropped <=512px sprite; the crop it
   used is recorded on the sprite by runtime_patches/combat_enemy_live2d_v1.py (__afCrop).
   CH01-05 (2026-09-28, HISTORY/2026-09-28_ENEMY_LIVE2D_CH01_05_V1.md): their specs carry painted MOVE_* frames. A mesh rig
   animates whatever frame is shown (same canvas as the FRONT); a parts rig always draws over the FRONT's box (bottom-centre
   anchored, same size) because its layers are cut from the FRONT, and the walk comes from its leg/body clips.
   ?enemyl2d=off disables the renderer for A/B checks. */
(()=>{"use strict";
  const RIGS=()=>window.AfterSignalEnemyRigData||{};
  const query=(()=>{try{return new URLSearchParams((window.top===window.self?window.location:window.top.location).search);}catch{return new URLSearchParams(window.location.search);}})();
  const OFF=query.get("enemyl2d")==="off";
  const TAU=Math.PI*2,DEG=Math.PI/180;
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;
  const easeOut=k=>1-(1-k)*(1-k);
  const hash=str=>{let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return ((h>>>0)%6283)/1000;};

  // ------------------------------------------------------------------ images
  const layerImages=new Map();
  const loadLayer=src=>{let e=layerImages.get(src);if(!e){const im=new Image();e={im,ok:false,bad:false};im.decoding="async";im.onload=()=>{e.ok=true;};im.onerror=()=>{e.bad=true;};im.src=src;layerImages.set(src,e);}return e;};
  const folderOf=asset=>String(asset||"").replace(/[^/]*$/,"");
  const rigFor=enemy=>{const asset=enemy?.spec?.asset;if(!asset)return null;const rig=RIGS()[asset];if(!rig)return null;
    if(!rig.__prepared){rig.__prepared=true;const base=folderOf(asset);(rig.layers||[]).forEach(L=>{L.__src=/^(\.\.\/|\/|[a-z]+:)/i.test(L.src)?L.src:base+L.src;});
      const byId=new Map((rig.layers||[]).map(L=>[L.id,L]));(rig.layers||[]).forEach(L=>{L.__parent=L.parent?byId.get(L.parent)||null:null;});
      rig.__order=(rig.layers||[]).slice().sort((a,b)=>(a.z||0)-(b.z||0));
      // world matrices are solved parents-first (a parent may sit behind or in front of its child)
      const topo=[],seen=new Set(),visit=(L,d)=>{if(seen.has(L.id)||d>8)return;if(L.__parent)visit(L.__parent,d+1);seen.add(L.id);topo.push(L);};
      (rig.layers||[]).forEach(L=>visit(L,0));rig.__topo=topo;}
    return rig;};
  const layersReady=rig=>{let ready=true;for(const L of rig.__order){const e=loadLayer(L.__src);if(e.bad)return "bad";if(!e.ok)ready=false;}return ready;};

  // ------------------------------------------------------------------ combat state -> animation state
  const stateOf=enemy=>{
    let s=enemy.__afL2D;
    if(!s){s=enemy.__afL2D={t:0,last:null,x:enemy.x,y:enemy.y,vx:0,vy:0,prevTel:0,strike:0,hitK:0,hp:enemy.hp,brk:0,phase:enemy.bossRuntime?.phaseIndex??0,seed:hash(String(enemy.id??enemy.spec?.id??"e"))};}
    const mt=enemy.motionTime||0;let dt=s.last==null?0:mt-s.last;if(!(dt>0)||dt>.25)dt=dt>.25?.016:0;s.last=mt;s.t+=dt;
    if(dt>0){const k=Math.min(1,dt*6);s.vx+=((enemy.x-s.x)/dt-s.vx)*k;s.vy+=((enemy.y-s.y)/dt-s.vy)*k;}
    s.x=enemy.x;s.y=enemy.y;
    const tel=enemy.attackTelegraph||0,total=Math.max(.01,enemy.telegraphTotal||tel||.3);
    s.wind=tel>0?clamp(1-tel/total,0,1):0;
    if(s.prevTel>0&&tel<=0)s.strike=1;s.prevTel=tel;
    s.strike=Math.max(0,s.strike-dt/.42);
    if(Number.isFinite(enemy.hp)&&enemy.hp<s.hp-1e-6)s.hitK=1;s.hp=enemy.hp;
    s.hitK=Math.max(0,s.hitK-dt/.26);
    const ph=enemy.bossRuntime?.phaseIndex??0;if(ph!==s.phase){s.phase=ph;s.brk=1;}
    s.brk=Math.max(0,s.brk-dt/.9);
    s.move=clamp(s.vx/70,-1,1);s.moveAbs=Math.min(1,Math.hypot(s.vx,s.vy)/60);
    return s;
  };

  // ------------------------------------------------------------------ body motion (shared by mesh and parts)
  // Returns the body's affine transform in FRONT coordinates plus the per-row bulge used by the strip mesh.
  const bodyMotion=(rig,s)=>{
    const air=rig.mode==="air",A=rig.amp??1,t=s.t,ph=s.seed;
    const br=Math.sin(t*TAU/(rig.breathPeriod||2.7)+ph),sw=Math.sin(t*TAU/(rig.swayPeriod||3.6)+ph*1.7);
    const [fx,fy]=rig.feet||[rig.W/2,rig.H],[cx,cy]=rig.center||[rig.W/2,rig.H/2],H=rig.bodyH||rig.H*.8;
    let sx=1,sy=1,rot=0,tx=0,ty=0,shear=0;
    if(air){ty+=-H*.03*A*Math.sin(t*TAU/(rig.bobPeriod||2.3)+ph);rot+=(.03*A*sw+s.move*.08);sx*=1+.012*A*br;sy*=1-.008*A*br;}
    else{sy*=1+.011*A*br;sx*=1-.004*A*br;shear+=.014*A*sw+s.move*.045;
      if(s.moveAbs>.05){const st=Math.abs(Math.sin(t*TAU/(rig.stepPeriod||.95)+ph));ty-=H*.016*s.moveAbs*st;sy*=1-.012*s.moveAbs*(1-st);}}
    // attack: wind-up rises and gathers, the strike lunges toward the camera
    sy*=1+.028*s.wind;sx*=1-.012*s.wind;ty-=H*.012*s.wind;
    const lunge=easeOut(s.strike)*(s.strike>0?1:0);sx*=1+.045*lunge;sy*=1+.045*lunge;ty+=H*.018*lunge;
    // hit: squash and a short recoil shake; phase break: a stronger shake
    const hk=s.hitK;sx*=1+.045*hk;sy*=1-.045*hk;ty-=H*.012*hk;tx+=Math.sin(t*83)*H*.012*hk;
    tx+=Math.sin(t*61)*H*.018*s.brk;rot+=Math.sin(t*47)*.02*s.brk;
    const px=air?cx:fx,py=air?cy:fy;
    // M = T(p+t) * R(rot) * Shear * S * T(-p); shear moves rows by -shear*(y-py) (top shifts, feet stay)
    const c=Math.cos(rot),n=Math.sin(rot);
    const a0=sx,b0=0,c0=-shear*sy,d0=sy; // S then shear: x'=sx*x - shear*sy*y
    const a=c*a0-n*b0,b=n*a0+c*b0,cc=c*c0-n*d0,d=n*c0+c*d0;
    const e=px+tx-(a*px+cc*py),f=py+ty-(b*px+d*py);
    return {m:[a,b,cc,d,e,f],br,A};
  };
  const mul=(m,n)=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
  const pivotXf=(px,py,r,sc,tx,ty)=>{const c=Math.cos(r)*sc,n=Math.sin(r)*sc;return [c,n,-n,c,px+tx-(c*px-n*py),py+ty-(n*px+c*py)];};

  // ------------------------------------------------------------------ part role presets (clips)
  const roleMotion=(L,s)=>{
    const t=s.t,ph=s.seed+(L.phase||0),A=L.amp??1,side=L.side||0,sd=side||1,wind=s.wind,strike=easeOut(s.strike)*(s.strike>0?1:0),hk=s.hitK,brk=s.brk;
    let r=0,x=0,y=0,sc=1;const h=L.h||100;
    switch(L.role){
      case "arm":case "hand":case "weapon":
        r=-sd*2.4*DEG*A*Math.sin(t*1.25+ph)-sd*15*DEG*A*wind+sd*20*DEG*A*strike+sd*7*DEG*hk-sd*9*DEG*brk;break;
      case "shield": // a held shield braces: it rises on the wind-up, pushes toward the camera on the strike
        r=-sd*1*DEG*A*Math.sin(t*1.1+ph)-sd*4*DEG*A*wind+sd*5*DEG*A*strike+sd*3*DEG*hk*Math.sin(t*40);y=-h*.035*wind+h*.02*strike;sc=1+.035*strike+.02*wind;break;
      case "wing":
        r=-sd*5.5*DEG*A*Math.sin(t*2.1+ph)-sd*13*DEG*A*wind+sd*9*DEG*A*strike+sd*6*DEG*hk-sd*12*DEG*brk;break;
      case "leg":
        r=(side<0?1:-1)*4.5*DEG*A*Math.sin(t*TAU/.95+ph)*s.moveAbs+sd*2*DEG*hk;break;
      case "head":
        r=1.6*DEG*A*Math.sin(t*.9+ph)+Math.sin(t*37)*5*DEG*hk;y=-h*.035*wind+h*.03*strike;break;
      case "ring":case "halo":case "crown":
        y=h*.05*A*Math.sin(t*1.35+ph)-h*.08*wind;r=3*DEG*A*Math.sin(t*.6+ph)+6*DEG*brk*Math.sin(t*20);break;
      case "core":case "star":case "heart":
        sc=1+.03*A*Math.sin(t*3.1+ph)+.07*wind+.05*hk;break;
      case "tail":
        r=7*DEG*A*Math.sin(t*1.8+ph)-sd*10*DEG*wind+sd*14*DEG*strike;break;
      case "pendulum":
        r=4.5*DEG*A*Math.sin(t*1.15+ph)+sd*7*DEG*hk-sd*6*DEG*wind;break;
      case "ribs":
        r=sd*2.4*DEG*A*(.5+.5*Math.sin(t*2.3+ph))+sd*6*DEG*wind-sd*3*DEG*strike;break;
      case "jitter":
        r=1.4*DEG*A*Math.sin(t*9+ph)+3*DEG*hk*Math.sin(t*50);break;
      case "sway":
        r=1.3*DEG*A*Math.sin(t*.8+ph)+sd*2*DEG*brk*Math.sin(t*18);y=h*.01*A*Math.sin(t*1.1+ph);break;
      case "float":
        y=h*.045*A*Math.sin(t*1.6+ph);r=2.2*DEG*A*Math.sin(t*.95+ph);break;
      default:break;
    }
    return pivotXf(L.px??(L.x+L.w/2),L.py??(L.y+L.h/2),r,sc,x,y);
  };

  // ------------------------------------------------------------------ drawing
  const drawStrips=(ctx,src,sL,sT,sW,sH,m,rig,br,A,x,y,w,h)=>{
    // draw FRONT-space rect (x,y,w,h) from src rect (sL,sT,sW,sH) under matrix m, in N strips with a chest bulge
    ctx.save();ctx.transform(m[0],m[1],m[2],m[3],m[4],m[5]);
    const N=rig.strips||14,chest=rig.chest??.4,bulge=(rig.mode==="air"?.006:.012)*A*br,feetY=(rig.feet||[0,y+h])[1],cxm=x+w/2;
    for(let i=0;i<N;i++){
      const y0=y+h*i/N,y1=y+h*(i+1)/N,yn=(i+.5)/N,q=(yn-chest)/.22,k=1+bulge*Math.exp(-q*q),ww=w*k,ov=i<N-1?h/N*.08:0;
      ctx.drawImage(src,sL,sT+sH*i/N,sW,sH/N+(i<N-1?sH/N*.08:0),cxm-ww/2,y0,ww,(y1-y0)+ov);
    }
    ctx.restore();
  };
  const cropOf=(image,rect,rig)=>{
    if(image.__afCrop)return image.__afCrop;                       // prepared sprite: crop in FRONT pixels
    const nw=image.naturalWidth||image.width;if(rig&&nw&&Math.abs(nw-rig.W)>2){const k=nw/rig.W;return {left:rect.left/k,top:rect.top/k,width:rect.width/k,height:rect.height/k};}
    return rect;
  };
  const draw=(runner,ctx,enemy,image,rect,dx,dy,dw,dh)=>{
    if(OFF)return false;
    const rig=rigFor(enemy);if(!rig||!image||!rect)return false;
    let crop=cropOf(image,rect,rig);if(!crop?.width)return false;
    const ready=rig.kind==="parts"&&rig.__order?.length?layersReady(rig):false;
    if(ready==="bad")rig.kind="mesh";
    if(ready===true){
      // Parts layers are cut from the FRONT. When the runtime shows a painted MOVE_* frame instead (CH01-05 specs
      // carry motionAssets), draw the parts over the FRONT's own box: same size, bottom-centre anchored, and the
      // walk comes from the rig's leg/body clips (HISTORY/2026-09-28_ENEMY_LIVE2D_CH01_05_V1.md).
      const front=runner?.images?.get?.(enemy.spec.asset);
      if(image===front){if(image.__afCrop)rig.__frontCrop=image.__afCrop;}
      else{
        const fb=rig.fbox||[0,0,rig.W,rig.H],fc=rig.__frontCrop||{left:Math.max(0,fb[0]-2),top:Math.max(0,fb[1]-2),width:fb[2]-fb[0]+4,height:fb[3]-fb[1]+4};
        const size=Math.max(dw,dh),a=fc.width/fc.height,w2=a>=1?size:size*a,h2=a>=1?size/a:size;
        dx=dx+dw/2-w2/2;dy=dy+dh-h2;dw=w2;dh=h2;crop=fc;
      }
    }
    const s=stateOf(enemy),{m:body,br,A}=bodyMotion(rig,s),k=dw/crop.width;
    ctx.save();
    // FRONT space -> destination
    ctx.transform(k,0,0,dh/crop.height,dx-crop.left*k,dy-crop.top*(dh/crop.height));
    let drewParts=false;
    if(rig.kind==="parts"&&rig.__order?.length){
      if(ready===true){
        const world=new Map();
        for(const L of rig.__topo){
          const parent=L.__parent?world.get(L.__parent.id)||body:body;
          world.set(L.id,L.role==="body"?body:mul(parent,roleMotion(L,s)));
        }
        for(const L of rig.__order){
          const M=world.get(L.id)||body;
          const img=layerImages.get(L.__src).im;
          if(L.mesh)drawStrips(ctx,img,0,0,img.naturalWidth,img.naturalHeight,M,rig,br,A,L.x,L.y,L.w,L.h);
          else{ctx.save();ctx.transform(M[0],M[1],M[2],M[3],M[4],M[5]);ctx.drawImage(img,L.x,L.y,L.w,L.h);ctx.restore();}
        }
        drewParts=true;
      }
    }
    if(!drewParts){
      // mesh rig, or a parts rig whose layers are still decoding: animate the FRONT itself
      const sw=image.width||image.naturalWidth,sh=image.height||image.naturalHeight,iL=image.__afCrop?0:rect.left,iT=image.__afCrop?0:rect.top,iW=image.__afCrop?sw:rect.width,iH=image.__afCrop?sh:rect.height;
      drawStrips(ctx,image,iL,iT,iW,iH,body,rig,br,A,crop.left,crop.top,crop.width,crop.height);
    }
    ctx.restore();
    runner&&runner.qa&&(runner.qa.enemyLive2DFrames=(runner.qa.enemyLive2DFrames||0)+1,drewParts&&(runner.qa.enemyLive2DPartFrames=(runner.qa.enemyLive2DPartFrames||0)+1));
    return true;
  };
  window.AfterSignalEnemyLive2D={version:"ENEMY_LIVE2D_V1",draw,stateOf,rigFor,_bodyMotion:bodyMotion,_roleMotion:roleMotion};
})();
