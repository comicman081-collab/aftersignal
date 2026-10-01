/* AFTER SIGNAL V0.66 — additive 3-layer runtime.
 * The compatibility bridge preserves existing aim, muzzle, projectile, cover
 * and hit-zone code while sourcing entity placement from the V1 registry. */
(() => {
  'use strict';
  const registry = window.AFTERSIGNAL_ENTITY_LAYER_REGISTRY_V1;
  if (!registry) throw new Error('AFTERSIGNAL_ENTITY_LAYER_REGISTRY_V1 must load before AFTERSIGNAL_3LAYER_RUNTIME_V1');

  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)));
  const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  let spawnSerial = 0;
  const layer = (id) => registry.layers[id];
  const airMin = () => layer('AIR_HIGH').y_band.min;
  const airMax = () => layer('AIR_MID').y_band.max;
  const allowedAirMin = (id) => layer(id).allowed_y_band?.min ?? layer(id).y_band.min;
  const allowedAirMax = (id) => layer(id).allowed_y_band?.max ?? layer(id).y_band.max;
  const groundMin = () => layer('GROUND').y_band.min;
  const groundMax = () => layer('GROUND').y_band.max;
  const groundSpawnMin = () => layer('GROUND').spawn_y_band.min;
  const groundSpawnMax = () => layer('GROUND').spawn_y_band.max;
  const isGround = (definition) => definition?.allowed_layers?.length === 1 && definition.allowed_layers[0] === 'GROUND';
  const isAir = (definition) => definition?.allowed_layers?.includes('AIR_MID') || definition?.allowed_layers?.includes('AIR_HIGH');
  const isPlayerStation = (definition) => definition?.entity_class === 'PLAYER'
    && definition?.allowed_layers?.length === 1
    && definition.allowed_layers[0] === 'PLAYER_FOREGROUND';
  const playerStation = () => registry.combat_space.player_station;

  function normalizeStage(stageId) {
    return String(stageId || '').toLowerCase().replace(/^p-?/, 'p');
  }

  function resolveEntityId(stageId, reference) {
    const key = String(reference || '');
    if (registry.entities[key]) return key;
    return registry.stage_aliases?.[normalizeStage(stageId)]?.[key] || null;
  }

  function definition(stageId, reference) {
    const entityId = resolveEntityId(stageId, reference);
    return entityId ? registry.entities[entityId] : null;
  }

  function initialBand(definition) {
    return definition?.default_layer || definition?.spawn_layer || 'GROUND';
  }

  // Legacy battle pages use several historical Y coordinate ranges.  Capture
  // the first authored ground position once and project it into the GROUND
  // spawn band; subsequent frame updates may move only horizontally.  This
  // makes a ground jump a real body-space offset without promoting the mob
  // into an air layer.
  function projectGroundBaseline(value) {
    const raw = numberOr(value, (groundSpawnMin() + groundSpawnMax()) / 2);
    if (raw >= groundMin() && raw <= groundMax()) return clamp(raw, groundMin(), groundMax());
    const normalized = clamp((raw - airMin()) / Math.max(1, airMax() - airMin()), 0, 1);
    return groundSpawnMin() + normalized * (groundSpawnMax() - groundSpawnMin());
  }

  function attach(stageId, reference, entity = {}) {
    const stage = normalizeStage(stageId);
    const entityId = resolveEntityId(stage, reference);
    const entry = entityId ? registry.entities[entityId] : null;
    if (!entry) throw new Error(`No V1 layer registry entity for ${stage}:${reference}`);
    const serial = ++spawnSerial;
    entity.layer_stage_id = stage;
    entity.entity_id = entityId;
    entity.entity_class = entry.entity_class;
    entity.morphology = entry.morphology;
    entity.mob_type = entry.mob_type;
    entity.movement_type = entry.movement_type;
    entity.allowed_layers = [...entry.allowed_layers];
    entity.default_layer = entry.default_layer;
    entity.spawn_layer = entry.spawn_layer;
    entity.attack_layer = entry.attack_layer;
    entity.asset_set = entry.asset_set;
    entity.boss_rank = entry.boss_rank;
    entity.active_layer = initialBand(entry);
    entity.render_order = layer(entity.active_layer).render_order;
    entity.layer_spawn_serial = serial;
    entity.layer_transition = null;
    entity.elevation_z = numberOr(entity.elevation_z, 0);
    if (isPlayerStation(entry)) {
      // PLAYER_FOREGROUND is intentionally not an enemy depth band.  A player
      // remains in this fixed station while their muzzle may target all three
      // forward enemy bands.  This avoids treating a character as a GROUND mob
      // and prevents any spawn/movement overlap with the battlefield.
      const station = playerStation();
      const xBand = station.x_band || { min: station.single_x, max: station.single_x };
      entity.x = clamp(numberOr(entity.x, station.single_x), xBand.min, xBand.max);
      entity.baseY = numberOr(entity.baseY, station.baseline_y);
      entity.y = entity.baseY;
      entity.render_y = entity.y;
      entity.elevation_z = 0;
      entity.active_layer = 'PLAYER_FOREGROUND';
      entity.render_order = layer('PLAYER_FOREGROUND').render_order;
    } else if (isGround(entry)) {
      const hasAuthoredGroundY = [entity.baseY, entity.by, entity.y].some((value) => Number.isFinite(Number(value)));
      if (hasAuthoredGroundY) {
        entity.ground_baseline_y = projectGroundBaseline(numberOr(entity.baseY, numberOr(entity.by, entity.y)));
      }
      entity.baseY = numberOr(entity.ground_baseline_y, (groundSpawnMin() + groundSpawnMax()) / 2);
      entity.elevation_z = clamp(entity.elevation_z, 0, 96);
      entity.y = entity.baseY - entity.elevation_z;
      entity.render_y = entity.y;
    } else {
      const candidateY = clamp(numberOr(entity.y, (airMin() + airMax()) / 2), airMin(), airMax());
      entity.y = candidateY;
      refreshAirLayer(entity, candidateY);
      entity.baseY = entity.y;
      entity.render_y = entity.y;
    }
    return entity;
  }

  function attachPlayer(reference, entity = {}) {
    return attach('player', reference, entity);
  }

  function refreshAirLayer(entity, candidateY = entity.y) {
    const transition = registry.air_transition;
    const before = entity.active_layer === 'AIR_HIGH' ? 'AIR_HIGH' : 'AIR_MID';
    const after = before === 'AIR_HIGH'
      ? (candidateY >= transition.from_air_high_to_air_mid_when_y_gte ? 'AIR_MID' : 'AIR_HIGH')
      : (candidateY <= transition.from_air_mid_to_air_high_when_y_lte ? 'AIR_HIGH' : 'AIR_MID');
    if (after !== before) entity.layer_transition = { from: before, to: after, elapsed: 0, duration: transition.interpolation_seconds };
    entity.active_layer = after;
    entity.y = clamp(candidateY, allowedAirMin(after), allowedAirMax(after));
    entity.render_order = layer(after).render_order;
  }

  function startGroundJump(entity, { height = 72, duration = 0.62 } = {}) {
    if (!entity || entity.active_layer !== 'GROUND') return false;
    entity.jump_state = {
      elapsed: 0,
      duration: Math.max(0.08, Number(duration) || 0.62),
      height: clamp(height, 0, 96),
      base_y: numberOr(entity.baseY, numberOr(entity.y, groundMax()))
    };
    return true;
  }

  function step(entity, dt = 0) {
    if (!entity?.entity_id) return entity;
    const entry = registry.entities[entity.entity_id];
    if (!entry) return entity;
    const elapsed = Math.max(0, Number(dt) || 0);
    if (isPlayerStation(entry)) {
      const station = playerStation();
      const xBand = station.x_band || { min: station.single_x, max: station.single_x };
      entity.x = clamp(numberOr(entity.x, station.single_x), xBand.min, xBand.max);
      entity.baseY = numberOr(entity.baseY, station.baseline_y);
      entity.y = entity.baseY;
      entity.render_y = entity.y;
      entity.elevation_z = 0;
      entity.active_layer = 'PLAYER_FOREGROUND';
      entity.render_order = layer('PLAYER_FOREGROUND').render_order;
    } else if (isGround(entry)) {
      // Capture the old page's authored vertical placement once. Ground mobs
      // then retain that baseline while their existing X movement remains intact.
      const motionY = entity.motion && Number.isFinite(Number(entity.motion.y)) ? Number(entity.motion.y) : null;
      const rawBase = motionY ?? numberOr(entity.by, numberOr(entity.baseY, numberOr(entity.y, groundMax())));
      if (!Number.isFinite(Number(entity.ground_baseline_y))) entity.ground_baseline_y = projectGroundBaseline(rawBase);
      entity.baseY = clamp(entity.ground_baseline_y, groundMin(), groundMax());
      const jump = entity.jump_state;
      if (jump) {
        jump.elapsed = Math.min(jump.duration, jump.elapsed + elapsed);
        const progress = clamp(jump.elapsed / jump.duration, 0, 1);
        entity.elevation_z = Math.sin(progress * Math.PI) * jump.height;
        if (progress >= 1) {
          entity.elevation_z = 0;
          entity.jump_state = null;
        }
      } else {
        entity.elevation_z = clamp(numberOr(entity.elevation_z, 0), 0, 96);
      }
      entity.active_layer = 'GROUND';
      entity.render_order = layer('GROUND').render_order;
      entity.y = entity.baseY - entity.elevation_z;
      entity.render_y = entity.y;
      entity.by = entity.baseY;
    } else if (isAir(entry)) {
      entity.elevation_z = 0;
      const candidateY = clamp(numberOr(entity.y, numberOr(entity.by, (airMin() + airMax()) / 2)), airMin(), airMax());
      refreshAirLayer(entity, candidateY);
      entity.baseY = entity.y;
      entity.render_y = entity.y;
      if (entity.layer_transition) {
        entity.layer_transition.elapsed = Math.min(entity.layer_transition.duration, entity.layer_transition.elapsed + elapsed);
        if (entity.layer_transition.elapsed >= entity.layer_transition.duration) entity.layer_transition = null;
      }
    }
    return entity;
  }

  function targetPoint(entity) {
    return { x: numberOr(entity?.x, 0), y: numberOr(entity?.render_y, numberOr(entity?.y, 0)) };
  }

  function hitboxCenter(entity) {
    return targetPoint(entity);
  }

  function hitEffectPoint(entity) {
    return targetPoint(entity);
  }

  function attackPoint(entity) {
    return targetPoint(entity);
  }

  function shadowPoint(entity) {
    return { x: numberOr(entity?.x, 0), y: entity?.active_layer === 'GROUND' ? numberOr(entity?.baseY, numberOr(entity?.y, 0)) : numberOr(entity?.render_y, numberOr(entity?.y, 0)) };
  }

  // A jumping ground body changes hit/target coordinates, but retains its
  // baseline depth so the relative front/back ordering of ground units cannot
  // flip during the jump arc.
  function depthY(entity) {
    return entity?.active_layer === 'GROUND'
      ? numberOr(entity?.baseY, numberOr(entity?.render_y, numberOr(entity?.y, 0)))
      : numberOr(entity?.render_y, numberOr(entity?.y, 0));
  }

  function stableSortKey(entity) {
    return [
      numberOr(entity?.render_order, 50),
      depthY(entity),
      numberOr(entity?.local_render_order, 0),
      numberOr(entity?.layer_spawn_serial, 0)
    ];
  }

  function compare(left, right) {
    const a = stableSortKey(left);
    const b = stableSortKey(right);
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
    return 0;
  }

  function backgroundStack(stageId) {
    return {
      stage_id: normalizeStage(stageId),
      slots: registry.render_pipeline.filter((entry) => entry.id.startsWith('BACKGROUND_')),
      fallback: 'SOURCE_SINGLE_IMAGE_UNTIL_LUNA_DELIVERS_BACKGROUND_LAYER_ASSETS'
    };
  }

  const api = Object.freeze({
    version: '1.0', registry, resolveEntityId, definition, attach, attachPlayer, step, startGroundJump,
    targetPoint, hitboxCenter, hitEffectPoint, attackPoint, shadowPoint, depthY, stableSortKey, compare, backgroundStack,
    layerOrder: (id) => layer(id)?.render_order ?? 50, clamp
  });
  window.AfterSignal3LayerRuntime = api;
  // V0.66 pages call this established surface. It now delegates to the V1 registry.
  window.AfterSignalCombatLayers = Object.freeze({
    version: '1.0-compat', registry, profile: definition, attach, clamp: step, step, startJump: startGroundJump,
    clearJump: (entity) => { if (entity) { entity.jump_state = null; entity.elevation_z = 0; } return step(entity, 0); },
    anchorPoint: (entity, kind = 'target') => kind === 'shadow' || kind === 'ground' ? shadowPoint(entity) : targetPoint(entity),
    order: (entity) => numberOr(entity?.render_order, 50), compare, sortKey: stableSortKey, clampValue: clamp
  });
})();
