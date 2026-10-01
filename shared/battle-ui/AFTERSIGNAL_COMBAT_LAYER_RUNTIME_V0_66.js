/* AFTER SIGNAL V0.66 combat layer runtime. Additive adapter: it clamps positions and
 * preserves the existing targeting, muzzle and projectile math. */
(() => {
  const registry = window.AFTERSIGNAL_COMBAT_LAYER_REGISTRY || null;
  const fallback = {
    layers: { GROUND:{render_order:10,y_min:300,y_max:430}, MID:{render_order:20,y_min:200,y_max:299}, AIR:{render_order:30,y_min:90,y_max:199} },
    pages: {}
  };
  const data = registry || fallback;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const transition = data.transition || { mid_to_air_y: 194, air_to_mid_y: 205, duration: 0.18 };
  const layerBand = (allowed) => {
    const list = (allowed && allowed.length ? allowed : ['GROUND']).map(String);
    const bands = list.map((key) => data.layers[key] || fallback.layers[key]).filter(Boolean);
    return { min: Math.min(...bands.map((b) => b.y_min)), max: Math.max(...bands.map((b) => b.y_max)) };
  };
  let serial = 0;
  const profile = (page, type) => (data.pages?.[page]?.[type]) || { spawn_layer:'GROUND', default_layer:'GROUND', allowed_layers:['GROUND'], movement_range:{x:0,y:0}, render_order:10 };
  const anchorPoint = (enemy, kind = 'target') => {
    if (!enemy) return { x: 0, y: 0 };
    const x = Number(enemy.x || 0);
    const renderY = Number(enemy.render_y ?? enemy.y ?? 0);
    if (kind === 'ground' || kind === 'shadow') return { x, y: Number(enemy.baseY ?? enemy.by ?? renderY) };
    return { x, y: renderY };
  };
  const attach = (page, type, enemy = {}) => {
    const p = profile(page, type);
    enemy.page_id = page;
    enemy.enemy_type = type;
    enemy.spawn_layer = enemy.spawn_layer || p.spawn_layer;
    enemy.active_layer = enemy.active_layer || p.default_layer || p.spawn_layer;
    enemy.allowed_layers = Array.isArray(enemy.allowed_layers) ? enemy.allowed_layers.slice() : p.allowed_layers.slice();
    enemy.movement_range = enemy.movement_range || { ...p.movement_range };
    enemy.render_order = enemy.render_order || p.render_order;
    enemy.spawn_serial = ++serial;
    enemy.entity_id = enemy.entity_id || enemy.id || `${page}:${type}:${enemy.spawn_serial}`;
    enemy.render_group = enemy.render_group || p.render_group || 'enemy';
    enemy.local_render_order = Number(enemy.local_render_order || p.local_render_order || 0);
    enemy.layer_transition = null;
    enemy.jump = enemy.jump ?? !!p.jump;
    return clampEnemy(enemy);
  };
  const clampEnemy = (enemy) => {
    if (!enemy) return enemy;
    const band = layerBand(enemy.allowed_layers);
    const groundOnly = enemy.allowed_layers?.length === 1 && enemy.allowed_layers[0] === 'GROUND';
    const baseY = groundOnly
      ? (Number.isFinite(enemy.motion?.y) ? enemy.motion.y : (Number.isFinite(enemy.by) ? enemy.by : (Number.isFinite(enemy.baseY) ? enemy.baseY : enemy.y)))
      : (Number.isFinite(enemy.baseY) ? enemy.baseY : (Number.isFinite(enemy.by) ? enemy.by : enemy.y));
    enemy.baseY = groundOnly ? clamp(baseY, data.layers.GROUND.y_min, data.layers.GROUND.y_max) : baseY;
    enemy.elevation_z = clamp(Number(enemy.elevation_z || 0), 0, groundOnly ? 90 : 0);
    const y = Number.isFinite(enemy.y) ? enemy.y : enemy.baseY;
    enemy.y = groundOnly ? enemy.baseY - enemy.elevation_z : clamp(y, band.min, band.max);
    if (Number.isFinite(enemy.by)) enemy.by = groundOnly ? enemy.baseY : clamp(enemy.by, band.min, band.max);
    if (Number.isFinite(enemy.baseY) && !groundOnly) enemy.baseY = clamp(enemy.baseY, band.min, band.max);
    enemy.render_y = enemy.y;
    if (enemy.allowed_layers?.length === 1 && enemy.allowed_layers[0] === 'GROUND') {
      enemy.active_layer = 'GROUND';
      if (Number.isFinite(enemy.motion?.y)) enemy.motion.y = enemy.baseY;
    } else if (enemy.allowed_layers?.includes('AIR')) {
      const currentLayer = enemy.active_layer === 'AIR' ? 'AIR' : 'MID';
      const targetLayer = currentLayer === 'AIR'
        ? (enemy.y >= transition.air_to_mid_y ? 'MID' : 'AIR')
        : (enemy.y <= transition.mid_to_air_y ? 'AIR' : 'MID');
      if (targetLayer !== currentLayer) {
        enemy.layer_transition = { from: currentLayer, to: targetLayer, elapsed: 0, duration: Number(transition.duration || 0.18) };
        enemy.active_layer = targetLayer;
      }
      enemy.render_order = data.layers[enemy.active_layer]?.render_order || enemy.render_order;
    }
    if (enemy.motion && groundOnly) enemy.motion.y = enemy.baseY;
    return enemy;
  };
  const startJump = (enemy, options = {}) => {
    if (!enemy || !enemy.jump) return enemy;
    const height = clamp(Number(options.height ?? enemy.jump_height ?? 90), 0, 90);
    const duration = Math.max(0.08, Number(options.duration ?? enemy.jump_duration ?? 0.8));
    enemy.active_layer = 'GROUND';
    enemy.jump_height = height;
    enemy.jump_duration = duration;
    enemy.jump_elapsed = 0;
    enemy.jump_base_y = Number.isFinite(enemy.baseY) ? enemy.baseY : (Number.isFinite(enemy.by) ? enemy.by : enemy.y);
    enemy.elevation_z = 0;
    return clampEnemy(enemy);
  };
  const clearJump = (enemy) => {
    if (!enemy) return enemy;
    enemy.jump_elapsed = 0;
    enemy.elevation_z = 0;
    if (Number.isFinite(enemy.jump_base_y)) enemy.baseY = enemy.jump_base_y;
    return clampEnemy(enemy);
  };
  const step = (enemy, dt = 0) => {
    if (!enemy) return enemy;
    if (enemy.jump && Number(enemy.jump_duration) > 0 && Number(enemy.jump_elapsed) < Number(enemy.jump_duration)) {
      enemy.jump_elapsed += Math.max(0, Number(dt) || 0);
      const progress = clamp(enemy.jump_elapsed / enemy.jump_duration, 0, 1);
      enemy.elevation_z = Math.sin(progress * Math.PI) * Number(enemy.jump_height || 90);
      enemy.active_layer = 'GROUND';
      if (progress >= 1) {
        enemy.elevation_z = 0;
        enemy.jump_elapsed = enemy.jump_duration;
      }
    }
    if (enemy.layer_transition) {
      enemy.layer_transition.elapsed = Math.min(enemy.layer_transition.duration, enemy.layer_transition.elapsed + Math.max(0, Number(dt) || 0));
      enemy.layer_transition.progress = clamp(enemy.layer_transition.elapsed / Math.max(0.001, enemy.layer_transition.duration), 0, 1);
      if (enemy.layer_transition.progress >= 1) enemy.layer_transition = null;
    }
    return clampEnemy(enemy);
  };
  const order = (enemy) => Number(enemy?.render_order || data.layers?.[enemy?.active_layer]?.render_order || 10);
  const sortKey = (enemy) => [order(enemy), Number(enemy?.render_y ?? enemy?.y ?? 0), Number(enemy?.local_render_order || 0), Number(enemy?.spawn_serial || 0)];
  const compare = (left, right) => {
    const a = sortKey(left), b = sortKey(right);
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };
  window.AfterSignalCombatLayers = Object.freeze({ version:'0.66', registry:data, profile, attach, clamp:clampEnemy, startJump, clearJump, step, anchorPoint, order, compare, sortKey, clampValue:clamp });
})();
