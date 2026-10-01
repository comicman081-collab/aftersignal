/* PNG-only 2.5D++ presentation bridge for every active V0.66 combat page. */
(() => {
  'use strict';
  const registry = window.AFTERSIGNAL_FINAL_ASSET_REGISTRY;
  if (!registry) throw new Error('AFTERSIGNAL_FINAL_ASSET_REGISTRY must load first');
  const images = new Map();
  const loadImage = (src) => {
    if (images.has(src)) return images.get(src);
    const promise = new Promise((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = src; });
    images.set(src, promise);
    return promise;
  };
  const stages = Object.keys(registry.backgrounds);
  const backgroundReady = Promise.all(stages.flatMap((stage) => Object.values(registry.backgrounds[stage]).map(loadImage)));
  function normalizeStage(stage) { return String(stage || '').toLowerCase().replace(/^p-?/, 'p'); }
  function coverSlice(ctx, image, dx, dy, dw, dh) {
    if (!image) return false;
    const sw = image.naturalWidth || image.width, sh = image.naturalHeight || image.height;
    const scale = Math.max(dw / sw, dh / sh), cropW = dw / scale, cropH = dh / scale;
    const sx = (sw - cropW) * 0.5, sy = (sh - cropH) * 0.5;
    ctx.drawImage(image, sx, sy, cropW, cropH, dx, dy, dw, dh);
    return true;
  }
  function drawBackground(ctx, stageId, width = 1280, height = 720) {
    const stage = normalizeStage(stageId);
    const set = registry.backgrounds[stage];
    if (!set) return false;
    const entries = [['BG_UPPER', 0], ['BG_MIDDLE', 1], ['BG_LOWER', 2]];
    let drawn = 0;
    for (const [slot, index] of entries) {
      const cached = images.get(set[slot]);
      if (!cached) { loadImage(set[slot]); continue; }
      cached.then((image) => { if (!image) return; });
      const image = cached.__resolvedImage;
      if (image) { coverSlice(ctx, image, 0, height * index / 3, width, height / 3 + 1); drawn += 1; }
    }
    return drawn === 3;
  }
  // Cache resolution without requiring battle pages to await another promise.
  for (const stage of stages) for (const src of Object.values(registry.backgrounds[stage])) {
    const promise = loadImage(src); promise.then((image) => { promise.__resolvedImage = image; });
  }
  function aimState(angle) {
    if (angle < -2.55) return 'STAND_AIM_LEFT';
    if (angle < -1.85) return 'STAND_AIM_UP_LEFT';
    if (angle < -1.27) return 'STAND_FIRE';
    if (angle < -0.58) return 'STAND_AIM_UP_RIGHT';
    return 'STAND_AIM_RIGHT';
  }
  function playerState({ reloading = false, covered = false, firing = false, angle = -Math.PI / 2 } = {}) {
    if (reloading) return 'COVER_RELOAD';
    if (covered) return 'COVER_SIT';
    if (firing) return 'STAND_FIRE';
    return aimState(angle);
  }
  const diagnostics = { frames: 0, alignmentFailures: 0, transitions: [], last: null };
  function recordFrame(detail = {}) {
    const root = document.documentElement;
    root.dataset.afAssetRegistry = 'FINAL_2P5D_V066';
    root.dataset.afGifPolicy = 'FORBIDDEN';
    root.dataset.afPlayerLayer = 'GROUND';
    if (detail.playerState) root.dataset.afPlayerState = detail.playerState;
    if (detail.muzzleAngle != null) root.dataset.afMuzzleAngle = Number(detail.muzzleAngle).toFixed(4);
    if (detail.projectileAngle != null) root.dataset.afProjectileAngle = Number(detail.projectileAngle).toFixed(4);
    diagnostics.frames += 1;
    if (detail.muzzleAngle != null && detail.projectileAngle != null && Math.abs(Number(detail.muzzleAngle) - Number(detail.projectileAngle)) > 1e-6) diagnostics.alignmentFailures += 1;
    const next = { time: performance.now(), ...detail };
    if (!diagnostics.last || (next.playerState && next.playerState !== diagnostics.last.playerState)) {
      diagnostics.transitions.push(next);
      if (diagnostics.transitions.length > 240) diagnostics.transitions.shift();
    }
    diagnostics.last = next;
  }
  document.documentElement.dataset.afAssetRegistry = 'FINAL_2P5D_V066';
  document.documentElement.dataset.afGifPolicy = 'FORBIDDEN';
  const orientationStyle = document.createElement('style');
  orientationStyle.textContent = `#afPortraitOrientationGuard{display:none}@media (max-width:700px) and (orientation:portrait){#afPortraitOrientationGuard{position:fixed;z-index:99999;inset:0;display:grid;place-items:center;padding:28px;background:radial-gradient(circle at 50% 42%,#0b2530,#02070b 68%);color:#eaffff;text-align:center;font:800 18px/1.55 "Noto Sans KR",sans-serif;letter-spacing:-.02em}#afPortraitOrientationGuard small{display:block;margin-top:10px;color:#7edee8;font:700 11px/1.5 ui-monospace,monospace;letter-spacing:.08em}}`;
  document.head.append(orientationStyle);
  const installOrientationGuard = () => {
    if (document.getElementById('afPortraitOrientationGuard')) return;
    const guard = document.createElement('div');
    guard.id = 'afPortraitOrientationGuard';
    guard.innerHTML = '<div>가로 화면으로 회전해 주세요<small>터치 조준·사격은 가로 화면에서 지원됩니다</small></div>';
    document.body.append(guard);
  };
  if (document.body) installOrientationGuard(); else addEventListener('DOMContentLoaded', installOrientationGuard, { once: true });
  window.__AFTERSIGNAL_2P5D_DIAGNOSTICS__ = diagnostics;
  window.AfterSignal2P5D = Object.freeze({ version: '1.1', registry, backgroundReady, drawBackground, playerState, aimState, recordFrame });
})();
