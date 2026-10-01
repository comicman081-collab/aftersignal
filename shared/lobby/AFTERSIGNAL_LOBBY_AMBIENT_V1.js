/* AFTERSIGNAL_LOBBY_AMBIENT_V1 (2026-10-01) - drifting dust motes in the air of the relay shelter, behind the UI and the living figures.
   One 2D canvas between the backdrop shade and the screens (z-index 1, pointer-events none, screen blend): ~60 soft motes (a few large bokeh) at several depths that
   rise slowly, sway on a slow wind, twinkle, and shift a little against the pointer. No assets, no layout changes; off with ?amb=off or ?l2d=off (on the page's or the host page's address),
   still under prefers-reduced-motion (unless ?motion=full), paused while the tab is hidden or the recruit overlay covers the shelter.
   Public API: window.AfterSignalLobbyAmbient {start, stop, count}. */
(() => {
  'use strict';
  if (window.AfterSignalLobbyAmbient) return;
  const QS = new URLSearchParams(location.search);
  try { if (window.parent && window.parent !== window) new URLSearchParams(window.parent.location.search).forEach((v, k) => { if (!QS.has(k)) QS.set(k, v); }); } catch (e) { /* cross-origin parent: own query only */ }
  if (QS.get('amb') === 'off' || QS.get('l2d') === 'off') return;
  const app = document.querySelector('.app');
  const shade = app && app.querySelector('.shade');
  if (!app || !shade) return;
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) && QS.get('motion') !== 'full';
  const cv = document.createElement('canvas');
  cv.className = 'af-amb';
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;mix-blend-mode:screen;opacity:0;transition:opacity 1.6s ease';
  shade.after(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); return; }

  const rnd = (() => { let a = 20261001; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
  const sprite = (r, g, b) => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(.18, `rgba(${r},${g},${b},.62)`); gr.addColorStop(.5, `rgba(${r},${g},${b},.14)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return c;
  };
  const SPR = [sprite(196, 238, 248), sprite(255, 214, 160)];

  let W = 0, H = 0, S = 1, motes = [], raf = 0, last = 0, t = 0, run = false;
  const P = {x: .5, y: .5, tx: .5, ty: .5};
  const make = () => {
    const n = Math.round(Math.max(28, Math.min(64, W * H / 36000)));
    motes = [];
    for (let i = 0; i < n; i++) {
      const z = .22 + .78 * Math.pow(rnd(), 1.5), bokeh = rnd() < .1;
      motes.push({x: rnd(), y: rnd(), z, r: bokeh ? 7 + 4 * rnd() : 1.3 + 3 * z, vy: (bokeh ? .004 : .0055 + .0125 * z), ph: rnd() * 6.283, tw: .5 + rnd() * 1.1, warm: rnd() < .22 ? 1 : 0, a: bokeh ? .05 + .05 * rnd() : .2 + .45 * z});
    }
  };
  const size = () => {
    const r = cv.getBoundingClientRect();
    S = Math.min(devicePixelRatio || 1, 1.25);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    cv.width = Math.round(W * S); cv.height = Math.round(H * S);
    make();
  };
  const covered = () => { const g = document.querySelector('.gc-root'); return !!g && !g.hidden; };
  function draw() {
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const m of motes) {
      const px = (m.x + Math.sin(t * .045 + m.ph) * .012 * m.z) * W - (P.x - .5) * 30 * m.z;
      const py = (((m.y - t * m.vy) % 1 + 1) % 1) * H - (P.y - .5) * 18 * m.z;
      const tw = .55 + .45 * Math.sin(t * m.tw + m.ph * 3.1);
      const edge = Math.min(1, Math.min(py, H - py) / (H * .08));
      const s = m.r * 5;
      ctx.globalAlpha = m.a * tw * Math.max(0, edge);
      ctx.drawImage(SPR[m.warm], px - s / 2, py - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }
  function frame(now) {
    raf = 0;
    if (!run) return;
    const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
    if (!document.hidden && !covered()) {
      t += dt;
      P.x += (P.tx - P.x) * Math.min(1, dt * 2.2); P.y += (P.ty - P.y) * Math.min(1, dt * 2.2);
      draw();
      if (cv.style.opacity !== '1') cv.style.opacity = '1';
    }
    raf = requestAnimationFrame(frame);
  }
  const api = {
    start() { if (run) return; run = true; last = 0; if (!raf) raf = requestAnimationFrame(frame); },
    stop() { run = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    get count() { return motes.length; }
  };
  addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; P.tx = e.clientX / Math.max(1, innerWidth); P.ty = e.clientY / Math.max(1, innerHeight); }, {passive: true});
  addEventListener('resize', size);
  size();
  window.AfterSignalLobbyAmbient = api;
  if (reduced) { draw(); cv.style.opacity = '1'; } else api.start();
})();
