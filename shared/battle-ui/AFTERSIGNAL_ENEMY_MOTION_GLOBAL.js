(()=>{
  "use strict";
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v)};
  function draw(ctx,image,geometry={},motion={}){
    if(!image)return;
    const sx=geometry.sx??0,sy=geometry.sy??0,sw=geometry.sw??image.naturalWidth??image.width,sh=geometry.sh??image.naturalHeight??image.height;
    const dw=geometry.dw??sw,dh=geometry.dh??sh,type=motion.archetype||"human";
    const time=Number(motion.time)||0,seed=Number(motion.phase)||0,vx=Number(motion.vx)||0,vy=Number(motion.vy)||0;
    const attack=smooth(Number(motion.attack)||0),alpha=motion.alpha==null?1:Number(motion.alpha);
    const speed=clamp(Math.hypot(vx,vy)/150,0,1),cycle=time*(type==="beast"?5.2:type==="drone"?3.4:2.35)+seed;
    const breathe=Math.sin(cycle)*(type==="boss"?.004:type==="human"?.006:.008);
    const travelLean=clamp(vx/1100,-.025,.025),attackLean=Math.sin(attack*Math.PI)*(type==="beast"?.035:.022);
    const hover=type==="drone"?Math.sin(cycle*.72)*2.2:0;
    ctx.save();ctx.globalAlpha*=alpha;ctx.translate(0,hover+clamp(vy/110,-1.6,1.6));
    function layer(y0,y1,{dx=0,dy=0,rot=0,sxScale=1,syScale=1,pivot=.5}={}){
      const top=-dh/2+dh*y0,bottom=-dh/2+dh*y1,py=-dh/2+dh*(y0+(y1-y0)*pivot);
      ctx.save();ctx.beginPath();ctx.rect(-dw/2-3,top-3,dw+6,bottom-top+6);ctx.clip();
      ctx.translate(dx,py+dy);ctx.rotate(rot);ctx.scale(sxScale,syScale);ctx.translate(-dx,-py);
      ctx.drawImage(image,sx,sy,sw,sh,-dw/2,-dh/2,dw,dh);ctx.restore();
    }
    if(type==="human"){
      const step=Math.sin(cycle*1.55)*speed;
      layer(0,.36,{dx:travelLean*dh*.3,dy:-breathe*dh*.2,rot:-travelLean*.34-attackLean*.18,sxScale:1+breathe,syScale:1-breathe*.35,pivot:.76});
      layer(.30,.73,{dx:travelLean*dh*.18,rot:travelLean+attackLean,sxScale:1+breathe*.45,syScale:1-breathe*.22,pivot:.62});
      layer(.67,1,{dx:step*2.2,rot:-travelLean*.42-step*.005,syScale:1+Math.abs(step)*.002,pivot:.14});
    }else if(type==="beast"){
      const gait=Math.sin(cycle*1.8)*speed,reach=Math.sin(attack*Math.PI);
      layer(0,.48,{dx:reach*3.4,dy:-Math.abs(gait)*1.1,rot:-travelLean*.5-attackLean,sxScale:1+breathe,syScale:1-breathe*.4,pivot:.72});
      layer(.39,.78,{rot:travelLean+attackLean*.55,sxScale:1+breathe*.55,syScale:1-breathe*.25,pivot:.52});
      layer(.69,1,{dx:gait*3.2,dy:Math.abs(gait)*1.2,rot:-travelLean*.35-gait*.007,pivot:.1});
    }else if(type==="drone"){
      const fin=Math.sin(cycle)*.018+travelLean;
      layer(0,.39,{dy:-breathe*dh,rot:-fin*.42,sxScale:1+breathe*.8,syScale:1-breathe*.25,pivot:.9});
      layer(.30,.75,{rot:travelLean+attackLean*.65,sxScale:1+breathe*.35,syScale:1-breathe*.2,pivot:.5});
      layer(.66,1,{dy:Math.sin(cycle*1.3)*1.1,rot:fin*.35,pivot:.08});
    }else{
      const pulse=Math.sin(cycle*.72),release=Math.sin(attack*Math.PI);
      layer(0,.35,{dy:-pulse*.7,rot:-travelLean*.26-release*.009,sxScale:1+breathe,syScale:1-breathe*.3,pivot:.8});
      layer(.29,.72,{dx:release*2.5,rot:travelLean+release*.015,sxScale:1+breathe*.55+release*.012,syScale:1-breathe*.25,pivot:.56});
      layer(.65,1,{dx:-release*1.1,dy:Math.sin(cycle*.6)*.5,rot:-travelLean*.4,pivot:.12});
    }
    ctx.restore();
  }
  window.AfterSignalEnemyRig=Object.freeze({version:"1.3",draw});
})();
