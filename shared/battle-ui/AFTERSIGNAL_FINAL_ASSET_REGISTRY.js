/* AFTER SIGNAL V0.66 final active combat asset registry.
 * PNG-only by production decision: candidate/runtime GIF assets are forbidden. */
(() => {
  'use strict';
  const base = '../assets/final_2p5d_v066';
  // Combat enemies are a separately traceable copy of SOURCE/Mobs/renewal.
  // Do not fold this back into the legacy final_2p5d package.
  // Renewal is deliberately flattened to concrete asset IDs.  This keeps the
  // production manifest traceable and lets the standalone builder replace every
  // reference with an inline asset, rather than concatenating a relative root.
  const renewal = Object.freeze({
    EN_P_01: Object.freeze({ IDLE_FRONT: '../assets/enemies_renewal_v066/enemies/prologue/EN-P-01/IDLE_FRONT.webp', MOVE_LEFT: '../assets/enemies_renewal_v066/enemies/prologue/EN-P-01/MOVE_LEFT.webp', MOVE_RIGHT: '../assets/enemies_renewal_v066/enemies/prologue/EN-P-01/MOVE_RIGHT.webp' }),
    EN_P_02: Object.freeze({ IDLE_FRONT: '../assets/enemies_renewal_v066/enemies/prologue/EN-P-02/IDLE_FRONT.webp', MOVE_LEFT: '../assets/enemies_renewal_v066/enemies/prologue/EN-P-02/MOVE_LEFT.webp', MOVE_RIGHT: '../assets/enemies_renewal_v066/enemies/prologue/EN-P-02/MOVE_RIGHT.webp', MOVE_UP: '../assets/enemies_renewal_v066/enemies/prologue/EN-P-02/MOVE_UP.webp', MOVE_DOWN: '../assets/enemies_renewal_v066/enemies/prologue/EN-P-02/MOVE_DOWN.webp' }),
    EN_P_03: Object.freeze({ IDLE_FRONT: '../assets/enemies_renewal_v066/enemies/prologue/EN-P-03/IDLE_FRONT.webp', MOVE_LEFT: '../assets/enemies_renewal_v066/enemies/prologue/EN-P-03/MOVE_LEFT.webp', MOVE_RIGHT: '../assets/enemies_renewal_v066/enemies/prologue/EN-P-03/MOVE_RIGHT.webp' }),
    EN_P_04: Object.freeze({ IDLE_FRONT: '../assets/enemies_renewal_v066/enemies/prologue/EN-P-04/IDLE_FRONT.webp', AIM_LEFT: '../assets/enemies_renewal_v066/enemies/prologue/EN-P-04/AIM_LEFT.webp', AIM_RIGHT: '../assets/enemies_renewal_v066/enemies/prologue/EN-P-04/AIM_RIGHT.webp' }),
    EN_MB_P_01: Object.freeze({ IDLE_FRONT: '../assets/enemies_renewal_v066/bosses/prologue/EN-MB-P-01/IDLE_FRONT.webp', MOVE_LEFT: '../assets/enemies_renewal_v066/bosses/prologue/EN-MB-P-01/MOVE_LEFT.webp', MOVE_RIGHT: '../assets/enemies_renewal_v066/bosses/prologue/EN-MB-P-01/MOVE_RIGHT.webp', MOVE_UP: '../assets/enemies_renewal_v066/bosses/prologue/EN-MB-P-01/MOVE_UP.webp', MOVE_DOWN: '../assets/enemies_renewal_v066/bosses/prologue/EN-MB-P-01/MOVE_DOWN.webp' })
  });
  const player = (id) => Object.freeze({
    STAND_IDLE: `${base}/characters/${id}/STAND_IDLE.png`,
    STAND_AIM_LEFT: `${base}/characters/${id}/STAND_AIM_LEFT.png`,
    STAND_AIM_UP_LEFT: `${base}/characters/${id}/STAND_AIM_UP_LEFT.png`,
    STAND_FIRE: `${base}/characters/${id}/STAND_FIRE.png`,
    STAND_AIM_UP_RIGHT: `${base}/characters/${id}/STAND_AIM_UP_RIGHT.png`,
    STAND_AIM_RIGHT: `${base}/characters/${id}/STAND_AIM_RIGHT.png`,
    COVER_SIT: `${base}/characters/${id}/COVER_SIT.png`,
    COVER_RELOAD: `${base}/characters/${id}/COVER_RELOAD.png`
  });
  const background = (stage) => Object.freeze({
    BG_UPPER: `${base}/backgrounds/${stage}/BG_UPPER.png`,
    BG_MIDDLE: `${base}/backgrounds/${stage}/BG_MIDDLE.png`,
    BG_LOWER: `${base}/backgrounds/${stage}/BG_LOWER.png`
  });
  const sera = Object.freeze({
    STAND_IDLE: `${base}/characters/sera/frames/sera_cover.webp`,
    STAND_AIM_LEFT: `${base}/characters/sera/frames/sera_aim_9.png`,
    STAND_AIM_UP_LEFT: `${base}/characters/sera/frames/sera_aim_10.png`,
    STAND_FIRE: `${base}/characters/sera/frames/sera_aim_1.png`,
    STAND_AIM_UP_RIGHT: `${base}/characters/sera/frames/sera_aim_2.png`,
    STAND_AIM_RIGHT: `${base}/characters/sera/frames/sera_aim_3.png`,
    COVER_SIT: `${base}/characters/sera/frames/sera_cover.webp`,
    COVER_RELOAD: `${base}/characters/sera/frames/sera_cover_mid.png`
  });
  const miraCombat = Object.freeze({
    STAND_IDLE: `${base}/characters/mira/seated_freeaim_v24/cover.png`,
    STAND_AIM_LEFT: `${base}/characters/mira/seated_freeaim_v24/aim_far_left.png`,
    STAND_AIM_UP_LEFT: `${base}/characters/mira/seated_freeaim_v24/aim_left_high.png`,
    STAND_FIRE: `${base}/characters/mira/seated_freeaim_v24/aim_up.png`,
    STAND_AIM_UP_RIGHT: `${base}/characters/mira/seated_freeaim_v24/aim_right_mid.png`,
    STAND_AIM_RIGHT: `${base}/characters/mira/seated_freeaim_v24/aim_far_right.png`,
    COVER_SIT: `${base}/characters/mira/seated_freeaim_v24/cover.png`,
    COVER_RELOAD: `${base}/characters/mira/seated_freeaim_v24/cover.png`
  });
  const haneulCombat = Object.freeze({
    STAND_IDLE: `${base}/characters/haneul/seated_freeaim_v066/cover.png`,
    STAND_AIM_LEFT: `${base}/characters/haneul/seated_freeaim_v066/aim_left.png`,
    STAND_AIM_UP_LEFT: `${base}/characters/haneul/seated_freeaim_v066/aim_left_mid.png`,
    STAND_FIRE: `${base}/characters/haneul/seated_freeaim_v066/aim_center.png`,
    STAND_AIM_UP_RIGHT: `${base}/characters/haneul/seated_freeaim_v066/aim_right_mid.png`,
    STAND_AIM_RIGHT: `${base}/characters/haneul/seated_freeaim_v066/aim_right.png`,
    COVER_SIT: `${base}/characters/haneul/seated_freeaim_v066/cover.png`,
    COVER_RELOAD: `${base}/characters/haneul/seated_freeaim_v066/cover_mid.png`
  });
  const registry = Object.freeze({
    schemaVersion: '1.2', projectVersion: '0.66', assetGeneration: '2.5D++', animationMode: 'PNG_STATE_INTERPOLATION', gifPolicy: 'FORBIDDEN',
    players: Object.freeze({ PLAYER_MIRA_VOSS: miraCombat, PLAYER_HANEUL_7: haneulCombat, PLAYER_SSR07_SERA_FLINT: sera }),
    portraits: Object.freeze({
      PLAYER_MIRA_VOSS: `${base}/portraits/MIRA_HUD_2026_09_23.webp`,
      PLAYER_HANEUL_7: `${base}/portraits/HANEUL_HUD_2026_09_30.webp`,
      PLAYER_SSR07_SERA_FLINT: `${base}/characters/sera/SERA_FLINT_EXPOSURE_STAND.png`
    }),
    enemies: Object.freeze({
      'EN-P-01': renewal.EN_P_01,
      'EN-P-02': renewal.EN_P_02,
      'EN-P-03': renewal.EN_P_03,
      'EN-P-04': renewal.EN_P_04
    }),
    bosses: Object.freeze({
      'EN-MB-P-01': renewal.EN_MB_P_01
    }),
    projectiles: Object.freeze({
      PLAYER_MIRA_VOSS: Object.freeze({ weaponId: 'WPN-SSR-01-R0_RELAY_CARBINE', projectileId: 'RELAY_ARC', frames: Object.freeze(Array.from({length:8},(_,index)=>`${base}/projectiles/mira/RELAY_ARC_${String(index).padStart(2,'0')}.png`)) }),
      PLAYER_HANEUL_7: Object.freeze({ weaponId: 'WPN-SSR-02-HUSH_SEEKER', projectileId: 'PURIFICATION_FLECHETTE', frames: Object.freeze([`${base}/projectiles/haneul/PURIFICATION_FLECHETTE.png`]) }),
      PLAYER_SSR07_SERA_FLINT: Object.freeze({ weaponId: 'WPN-SSR07-MANUAL_IGNITER', projectileId: 'SERA_ANALOG_FLARE', renderer: 'CONTINUOUS_RIBBON_WHITE_HOT_SPEAR', collisionScale: 0.74, frames: Object.freeze([]) })
    }),
    backgrounds: Object.freeze(Object.fromEntries(['p01','p02','p04','p06','p07','p08'].map((stage) => [stage, background(stage)]))),
    stageEnemyMap: Object.freeze({
      p01: Object.freeze({ null: 'EN-P-01', drone: 'EN-P-02' }), p02: Object.freeze({ scout: 'EN-P-01', mite: 'EN-P-02', plate: 'EN-P-02', jammer: 'EN-P-04' }),
      p04: Object.freeze({ echo: 'EN-P-03', mimic: 'EN-P-02' }), p06: Object.freeze({ A: 'EN-P-02', B: 'EN-P-01' }),
      p07: Object.freeze({ A: 'EN-P-02', B: 'EN-P-01', warden: 'EN-MB-P-01' }), p08: Object.freeze({ A: 'EN-P-02', B: 'EN-P-02' })
    }),
    combatData: Object.freeze({
      PLAYER_MIRA_VOSS: Object.freeze({ weapon: 'R-0 릴레이 카빈', fireIntervalSec: 0.82, magazine: 8, baseDamage: 168, reloadSec: 1.56, skills: ['교정 핑','보호 채널'], ultimate: '고요한 지평선' }),
      PLAYER_HANEUL_7: Object.freeze({ weapon: '하늘-7 허시 시커', fireIntervalSec: 0.18, magazine: 20, baseDamage: 62, reloadSec: 1.34, skills: ['오염 분리','보호 채널'], ultimate: '제로 컨테미네이션' }),
      PLAYER_SSR07_SERA_FLINT: Object.freeze({ weapon: 'SSR07 수동 점화기', fireIntervalSec: 0.38, magazine: 12, baseDamage: 19, reloadSec: 1.48, skills: ['아날로그 점화','플레어 파열'], ultimate: '아날로그 플레어' }),
      'EN-P-01': Object.freeze({ basic: '금속 돌진', skill1: '신호 수신 오염', cooldownSec: 9, layer: 'GROUND' }),
      'EN-P-02': Object.freeze({ basic: '접근 저격', skill1: '접근 불꽃 부채꼴', cooldownSec: 2.8, layer: 'AIR_MID/AIR_HIGH' }),
      'EN-P-03': Object.freeze({ basic: '코어 압축', skill1: '명령 압축', cooldownSec: 11, layer: 'GROUND' }),
      'EN-P-04': Object.freeze({ basic: '추적 포격', skill1: '생체 직선 빔', cooldownSec: 10, telegraphSec: 1.7, layer: 'GROUND' }),
      'EN-MB-P-01': Object.freeze({ basic: '경고 펄스', skill1: '무신호 방패', skill2: '세 번째 경고선', ultimate: '신호 삭제 원형', ultimateHpRatio: 0.30, ultimateOnce: true, layer: 'AIR_MID/AIR_HIGH' })
    }),
    progressionContract: Object.freeze({
      activeScope: 'PROLOGUE', baselineMidbossClearSeconds: 133, futureChapters: 'DATA_DRIVEN',
      difficultyAxes: Object.freeze(['enemy_hp','enemy_attack','wave_density','mechanic_complexity','recommended_power']),
      rewardAxes: Object.freeze(['stage_clear','elite_bonus','midboss_bonus','chapter_boss_bonus']),
      rule: '전투 데이터에 따라 난이도와 보상을 함께 상승시키며 전역 고정 배수만으로 조정하지 않는다.'
    })
  });
  window.AFTERSIGNAL_FINAL_ASSET_REGISTRY = registry;
})();
