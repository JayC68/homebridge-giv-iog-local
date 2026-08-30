'use strict';

/*
 * GivHome 1.0.0 register authority layer.
 *
 * This is deliberately documentary/executable metadata only.  It does not send
 * Modbus writes and it is not bound to Homebridge runtime mutation paths.
 *
 * Authority classes:
 * - validated: proved by GivHome iOS/live CH-AIO evidence or existing beta runtime.
 * - crossValidated: iOS/original-plugin/dewet22 agree on the semantic direction.
 * - candidate: useful evidence, not a normal command path yet.
 * - profileGuarded: safe only behind a model/profile decision.
 */

const SOURCE = Object.freeze({
  IOS: 'givhome-ios-evidence',
  ORIGINAL_PLUGIN: 'homebridge-giv-iog-local-3.7.5',
  DEWET22: 'dewet22/givenergy-modbus',
  MODBUS_BETA: 'homebridge-givhome-modbus-stage6'
});

const GRID_FLOW_POLICY = Object.freeze({
  register: 'IR30',
  rawName: 'p_grid_out',
  description: 'External grid CT net flow at the meter boundary.',
  positiveMeans: 'export',
  negativeMeans: 'import',
  authority: 'crossValidated',
  sources: Object.freeze([SOURCE.DEWET22, SOURCE.IOS]),
  note: 'dewet22 names IR30 p_grid_out and computes import=max(0,-raw), export=max(0,raw). This matches iOS dashboard snapshots that report separated GridImport/GridExport.'
});

const BATTERY_FLOW_POLICY = Object.freeze({
  register: 'IR52',
  rawName: 'p_battery',
  positiveMeans: 'discharge',
  negativeMeans: 'charge',
  authority: 'crossValidated',
  sources: Object.freeze([SOURCE.DEWET22, SOURCE.IOS]),
  note: 'Negative battery power is charging; positive battery power is discharging.'
});

const PV_POWER_POLICY = Object.freeze({
  registers: Object.freeze(['IR18', 'IR20']),
  rawNames: Object.freeze(['p_pv1', 'p_pv2']),
  formula: 'pvPowerW = IR18 + IR20',
  authority: 'crossValidated',
  sources: Object.freeze([SOURCE.DEWET22, SOURCE.IOS]),
  note: 'dewet22 exposes p_pv1/p_pv2 and computes p_pv as their sum; iOS drilldown uses the same pair.'
});

const REGISTER_AUTHORITY = Object.freeze({
  IR18: Object.freeze({ label: 'PV string 1 power', role: 'telemetry', authority: 'crossValidated', sources: [SOURCE.DEWET22, SOURCE.IOS] }),
  IR20: Object.freeze({ label: 'PV string 2 power', role: 'telemetry', authority: 'crossValidated', sources: [SOURCE.DEWET22, SOURCE.IOS] }),
  IR30: Object.freeze({ label: 'external grid CT net flow', role: 'telemetry', positiveMeans: 'export', negativeMeans: 'import', authority: 'crossValidated', sources: [SOURCE.DEWET22, SOURCE.IOS] }),
  IR42: Object.freeze({ label: 'house load / consumption', role: 'telemetry', authority: 'crossValidated', sources: [SOURCE.DEWET22, SOURCE.IOS] }),
  IR52: Object.freeze({ label: 'battery signed power', role: 'telemetry', positiveMeans: 'discharge', negativeMeans: 'charge', authority: 'crossValidated', sources: [SOURCE.DEWET22, SOURCE.IOS] }),
  IR59: Object.freeze({ label: 'battery SOC', role: 'telemetry', authority: 'crossValidated', sources: [SOURCE.DEWET22, SOURCE.IOS] }),

  HR56: Object.freeze({ label: 'export/discharge slot 1 start', role: 'core-export-window', authority: 'validated', sources: [SOURCE.IOS, SOURCE.DEWET22] }),
  HR57: Object.freeze({ label: 'export/discharge slot 1 end', role: 'core-export-window', authority: 'validated', sources: [SOURCE.IOS, SOURCE.DEWET22] }),
  HR59: Object.freeze({ label: 'enable export/discharge namespace', role: 'export-enable', authority: 'validated', sources: [SOURCE.IOS, SOURCE.DEWET22] }),
  HR94: Object.freeze({ label: 'charge slot 1 start', role: 'core-charge-window', authority: 'validated', sources: [SOURCE.IOS, SOURCE.DEWET22] }),
  HR95: Object.freeze({ label: 'charge slot 1 end', role: 'core-charge-window', authority: 'validated', sources: [SOURCE.IOS, SOURCE.DEWET22] }),
  HR96: Object.freeze({ label: 'enable charge namespace', role: 'charge-enable', authority: 'validated', sources: [SOURCE.IOS, SOURCE.DEWET22] }),
  HR111: Object.freeze({ label: 'battery charge command power percent', role: 'charge-power', authority: 'validated', sources: [SOURCE.IOS, SOURCE.DEWET22] }),
  HR112: Object.freeze({ label: 'battery export/discharge command power percent', role: 'export-power', authority: 'validated', sources: [SOURCE.IOS, SOURCE.DEWET22] }),
  HR116: Object.freeze({ label: 'charge target SOC', role: 'charge-target', authority: 'validated', sources: [SOURCE.IOS, SOURCE.DEWET22] }),

  HR261: Object.freeze({ label: 'CH/AIO Manual Now charge slot 8 start', role: 'slot8-charge-overlay', authority: 'validated', sources: [SOURCE.IOS] }),
  HR262: Object.freeze({ label: 'CH/AIO Manual Now charge slot 8 end', role: 'slot8-charge-overlay', authority: 'validated', sources: [SOURCE.IOS] }),
  HR263: Object.freeze({ label: 'CH/AIO Manual Now charge slot 8 target SOC', role: 'slot8-charge-overlay', authority: 'validated', sources: [SOURCE.IOS] }),
  HR291: Object.freeze({ label: 'CH/AIO Manual Now export slot 8 start', role: 'slot8-export-overlay', authority: 'validated', sources: [SOURCE.IOS] }),
  HR292: Object.freeze({ label: 'CH/AIO Manual Now export slot 8 end', role: 'slot8-export-overlay', authority: 'validated', sources: [SOURCE.IOS] }),
  HR293: Object.freeze({ label: 'CH/AIO Manual Now export slot 8 lower-SOC target', role: 'slot8-export-overlay', authority: 'validated', sources: [SOURCE.IOS] }),

  HR313: Object.freeze({ label: 'inverter/profile charge power limit evidence', role: 'profile-evidence', authority: 'candidate', sources: [SOURCE.IOS, SOURCE.DEWET22], warning: 'Do not use as ordinary CH/AIO command power. Ordinary charge command power remains HR111 unless profile-specific validation proves otherwise.' }),
  HR314: Object.freeze({ label: 'inverter/profile discharge power limit evidence', role: 'profile-evidence', authority: 'candidate', sources: [SOURCE.IOS, SOURCE.DEWET22], warning: 'Do not use as ordinary CH/AIO export command power. Ordinary export command power remains HR112 unless profile-specific validation proves otherwise.' })
});

const CH_AIO_SLOT_MAP = Object.freeze({
  charge: Object.freeze({
    namespace: 'HR242-HR269',
    enable: 'HR96',
    power: 'HR111',
    slots: Object.freeze({
      1: Object.freeze(['HR94', 'HR95', 'HR116']),
      2: Object.freeze(['HR31', 'HR32', 'HR245']),
      3: Object.freeze(['HR246', 'HR247', 'HR248']),
      4: Object.freeze(['HR249', 'HR250', 'HR251']),
      5: Object.freeze(['HR252', 'HR253', 'HR254']),
      6: Object.freeze(['HR255', 'HR256', 'HR257']),
      7: Object.freeze(['HR258', 'HR259', 'HR260']),
      8: Object.freeze(['HR261', 'HR262', 'HR263']),
      9: Object.freeze(['HR264', 'HR265', 'HR266']),
      10: Object.freeze(['HR267', 'HR268', 'HR269'])
    }),
    reserved: Object.freeze({ userSchedules: [4, 5, 6, 7], manualNow: 8, cheapOvernight: [9, 10] })
  }),
  export: Object.freeze({
    namespace: 'HR272-HR299',
    enable: 'HR59',
    power: 'HR112',
    slots: Object.freeze({
      1: Object.freeze(['HR56', 'HR57', 'HR272']),
      2: Object.freeze(['HR44', 'HR45', 'HR275']),
      3: Object.freeze(['HR276', 'HR277', 'HR278']),
      4: Object.freeze(['HR279', 'HR280', 'HR281']),
      5: Object.freeze(['HR282', 'HR283', 'HR284']),
      6: Object.freeze(['HR285', 'HR286', 'HR287']),
      7: Object.freeze(['HR288', 'HR289', 'HR290']),
      8: Object.freeze(['HR291', 'HR292', 'HR293']),
      9: Object.freeze(['HR294', 'HR295', 'HR296']),
      10: Object.freeze(['HR297', 'HR298', 'HR299'])
    }),
    reserved: Object.freeze({ userSchedules: [4, 5, 6, 7], manualNow: 8 })
  })
});

const CE_AC_COUPLED_POLICY = Object.freeze({
  profileIds: Object.freeze(['ce3kWACCoupled', 'acCoupledCoreFallback']),
  route: 'core-window-preserve-restore',
  chargeRegisters: Object.freeze(['HR94', 'HR95', 'HR96', 'HR111', 'HR116']),
  exportRegisters: Object.freeze(['HR56', 'HR57', 'HR59', 'HR112']),
  safety: 'Do not copy the CH/AIO slot-8 overlay path to CE/AC-coupled systems. Snapshot exact core prestate, mutate only owned registers, then restore exact prestate.'
});

function splitGridPower(rawPowerW) {
  if (!Number.isFinite(rawPowerW)) {
    return { gridRawPowerW: null, gridImportPowerW: null, gridExportPowerW: null };
  }
  return {
    gridRawPowerW: rawPowerW,
    gridImportPowerW: Math.max(0, -rawPowerW),
    gridExportPowerW: Math.max(0, rawPowerW)
  };
}

function splitBatteryPower(rawPowerW) {
  if (!Number.isFinite(rawPowerW)) {
    return { batteryRawPowerW: null, batteryChargePowerW: null, batteryDischargePowerW: null };
  }
  return {
    batteryRawPowerW: rawPowerW,
    batteryChargePowerW: Math.max(0, -rawPowerW),
    batteryDischargePowerW: Math.max(0, rawPowerW)
  };
}

function getRegisterAuthority(register) {
  return REGISTER_AUTHORITY[String(register).toUpperCase()] || null;
}

function getChAioManualNowRoute(kind) {
  if (kind === 'charge') {
    return {
      profile: 'CH/AIO validated',
      mode: 'slot8-overlay',
      start: 'HR261',
      end: 'HR262',
      target: 'HR263',
      power: 'HR111',
      enable: 'HR96',
      cancel: 'HR96=0 only if prestate owned it as off; otherwise restore exact prestate'
    };
  }
  if (kind === 'export') {
    return {
      profile: 'CH/AIO validated',
      mode: 'slot8-overlay',
      start: 'HR291',
      end: 'HR292',
      target: 'HR293',
      power: 'HR112',
      enable: 'HR59',
      cancel: 'HR59=0 only if prestate owned it as off; otherwise restore exact prestate'
    };
  }
  return null;
}

module.exports = {
  SOURCE,
  GRID_FLOW_POLICY,
  BATTERY_FLOW_POLICY,
  PV_POWER_POLICY,
  REGISTER_AUTHORITY,
  CH_AIO_SLOT_MAP,
  CE_AC_COUPLED_POLICY,
  splitGridPower,
  splitBatteryPower,
  getRegisterAuthority,
  getChAioManualNowRoute
};
