'use strict';

const { CH_AIO_SLOT_MAP, CE_AC_COUPLED_POLICY } = require('./register-authority');

/*
 * GivHome 1.0.0 command-parity groundwork.
 *
 * This module is executable metadata only.  It models how the original
 * homebridge-giv-iog-local timed HomeKit tiles map onto direct Modbus routes,
 * but it is not bound to HomeKit and it does not send writes.
 */

const ORIGINAL_MANUAL_TILES = Object.freeze({
  forceCharge30: Object.freeze({ family: 'forceCharge', action: 'charge', minutes: 30, displayName: 'Charge 30m' }),
  forceCharge: Object.freeze({ family: 'forceCharge', action: 'charge', minutes: 60, displayName: 'Charge 60m', legacyContinuityKind: true }),
  forceCharge90: Object.freeze({ family: 'forceCharge', action: 'charge', minutes: 90, displayName: 'Charge 90m' }),
  forceCharge120: Object.freeze({ family: 'forceCharge', action: 'charge', minutes: 120, displayName: 'Charge 120m' }),
  forceExport30: Object.freeze({ family: 'forceExport', action: 'export', minutes: 30, displayName: 'Export 30m' }),
  forceExport: Object.freeze({ family: 'forceExport', action: 'export', minutes: 60, displayName: 'Export 60m', legacyContinuityKind: true }),
  forceExport90: Object.freeze({ family: 'forceExport', action: 'export', minutes: 90, displayName: 'Export 90m' }),
  forceExport120: Object.freeze({ family: 'forceExport', action: 'export', minutes: 120, displayName: 'Export 120m' })
});

const STAGE7_COMMAND_PARITY_POLICY = Object.freeze({
  stage: 'GivHome 1.0.0 command-parity groundwork',
  executable: false,
  homeKitExposureAdded: false,
  inverterWritesAdded: false,
  purpose: 'Map original timed Charge/Export tile semantics to the direct-Modbus register authority layer before any new live tile exposure.',
  runtimeSafety: 'No new HomeKit Set handler, automation path, Octopus path, export path, or Evening Excess Export mutation is bound by this module.'
});

function getOriginalManualTile(kind) {
  return ORIGINAL_MANUAL_TILES[kind] || null;
}

function listOriginalManualTiles() {
  return Object.entries(ORIGINAL_MANUAL_TILES).map(([kind, meta]) => Object.freeze({ kind, ...meta }));
}

function assertHmm(hhmm, label) {
  const text = String(hhmm || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    throw new Error(`${label} must be HH:MM`);
  }
  return text;
}

function getChAioTimedTileRoute(action) {
  if (action === 'charge') {
    const map = CH_AIO_SLOT_MAP.charge;
    const [start, end, target] = map.slots[map.reserved.manualNow];
    return Object.freeze({
      profile: 'CH/AIO',
      action,
      route: 'slot8-manual-now-overlay',
      slot: map.reserved.manualNow,
      namespace: map.namespace,
      start,
      end,
      target,
      power: map.power,
      enable: map.enable,
      cleanupFirst: map.enable,
      restore: 'restore exact captured prestate, not assumed defaults'
    });
  }

  if (action === 'export') {
    const map = CH_AIO_SLOT_MAP.export;
    const [start, end, target] = map.slots[map.reserved.manualNow];
    return Object.freeze({
      profile: 'CH/AIO',
      action,
      route: 'slot8-manual-now-overlay',
      slot: map.reserved.manualNow,
      namespace: map.namespace,
      start,
      end,
      target,
      power: map.power,
      enable: map.enable,
      cleanupFirst: map.enable,
      restore: 'restore exact captured prestate, not assumed defaults'
    });
  }

  return null;
}

function getCeAcCoupledTimedTileRoute(action) {
  if (!['charge', 'export'].includes(action)) {
    return null;
  }
  const registers = action === 'charge' ? CE_AC_COUPLED_POLICY.chargeRegisters : CE_AC_COUPLED_POLICY.exportRegisters;
  return Object.freeze({
    profile: 'CE/AC-coupled',
    action,
    route: CE_AC_COUPLED_POLICY.route,
    registers,
    cleanupFirst: action === 'charge' ? 'HR96' : 'HR59',
    restore: 'snapshot exact core-window prestate and reinstate after temporary use',
    warning: CE_AC_COUPLED_POLICY.safety
  });
}

function buildChAioTimedTileDryRunPlan(kind, startHmm, endHmm, options = {}) {
  const tile = getOriginalManualTile(kind);
  if (!tile) {
    throw new Error(`unknown original manual tile kind: ${kind}`);
  }

  const start = assertHmm(startHmm, 'startHmm');
  const end = assertHmm(endHmm, 'endHmm');
  const route = getChAioTimedTileRoute(tile.action);
  const powerPercent = Number.isFinite(options.powerPercent) ? Math.max(0, Math.min(100, Math.round(options.powerPercent))) : 100;
  const targetSoc = Number.isFinite(options.targetSoc) ? Math.max(1, Math.min(100, Math.round(options.targetSoc))) : 100;
  const exportTargetSoc = Number.isFinite(options.exportTargetSoc) ? Math.max(0, Math.min(100, Math.round(options.exportTargetSoc))) : 4;

  const writes = tile.action === 'charge'
    ? [
      { register: route.start, value: start, purpose: 'manual charge slot 8 start' },
      { register: route.end, value: end, purpose: 'manual charge slot 8 end' },
      { register: route.target, value: targetSoc, purpose: 'manual charge target SOC' },
      { register: route.power, value: powerPercent, purpose: 'manual charge power percent' },
      { register: route.enable, value: 1, purpose: 'enable charge namespace after schedule/power readback' }
    ]
    : [
      { register: route.start, value: start, purpose: 'manual export slot 8 start' },
      { register: route.end, value: end, purpose: 'manual export slot 8 end' },
      { register: route.target, value: exportTargetSoc, purpose: 'manual export lower-SOC target' },
      { register: route.power, value: powerPercent, purpose: 'manual export power percent' },
      { register: route.enable, value: 1, purpose: 'enable export namespace after schedule/power readback' }
    ];

  return Object.freeze({
    stage: STAGE7_COMMAND_PARITY_POLICY.stage,
    executable: false,
    homeKitExposureAdded: false,
    inverterWritesAdded: false,
    kind,
    family: tile.family,
    action: tile.action,
    minutes: tile.minutes,
    displayName: tile.displayName,
    route,
    preserveBeforeWrite: true,
    verifyAfterEveryWrite: true,
    cleanupFirst: route.cleanupFirst,
    restorePolicy: route.restore,
    writes: Object.freeze(writes.map(Object.freeze))
  });
}

module.exports = {
  STAGE7_COMMAND_PARITY_POLICY,
  ORIGINAL_MANUAL_TILES,
  getOriginalManualTile,
  listOriginalManualTiles,
  getChAioTimedTileRoute,
  getCeAcCoupledTimedTileRoute,
  buildChAioTimedTileDryRunPlan
};
