'use strict';

const { CH_AIO_SLOT_MAP, CE_AC_COUPLED_POLICY, REGISTER_AUTHORITY } = require('./register-authority');

/*
 * GivHome export lifecycle authority.
 *
 * This is executable metadata only. It does not expose HomeKit export tiles,
 * start export, clean export, or write to the inverter. It captures the proven
 * iOS/original-plugin/dewet design rules so the later live export path can be
 * built without guessing.
 */

const STAGE8_EXPORT_LIFECYCLE_POLICY = Object.freeze({
  stage: 'GivHome export lifecycle authority',
  executable: false,
  homeKitExposureAdded: false,
  inverterWritesAdded: false,
  liveExportPathBound: false,
  automaticMutationPath: 'absent',
  purpose: 'Model export schedule write/readback, cleanup, discharge-rate restore and CE/AC-coupled caution before any live HomeKit export tile is exposed.',
  normalDischargeRestoreRule: 'restore only an explicitly captured prestate; do not assume normal discharge resumes automatically',
  ordinaryChAioDischargeRateRegister: 'HR112',
  notOrdinaryChAioDischargeRateRegister: 'HR314'
});

function buildChAioExportLifecyclePlan(options = {}) {
  const slot = Number.isInteger(options.slot) ? options.slot : CH_AIO_SLOT_MAP.export.reserved.manualNow;
  const route = CH_AIO_SLOT_MAP.export.slots[slot];
  if (!route) {
    throw new Error(`unsupported CH/AIO export slot: ${slot}`);
  }
  const [start, end, target] = route;
  const power = CH_AIO_SLOT_MAP.export.power;
  const enable = CH_AIO_SLOT_MAP.export.enable;
  const exportTargetSoc = Number.isFinite(options.exportTargetSoc) ? Math.max(0, Math.min(100, Math.round(options.exportTargetSoc))) : 4;
  const powerPercent = Number.isFinite(options.powerPercent) ? Math.max(0, Math.min(100, Math.round(options.powerPercent))) : 100;

  return Object.freeze({
    stage: STAGE8_EXPORT_LIFECYCLE_POLICY.stage,
    executable: false,
    profile: 'CH/AIO',
    action: 'export',
    route: 'slot8-manual-now-overlay',
    slot,
    namespace: CH_AIO_SLOT_MAP.export.namespace,
    preserveBeforeWrite: Object.freeze([start, end, target, power, enable]),
    writeSequence: Object.freeze([
      Object.freeze({ register: start, valueKind: 'HHMM start', purpose: 'manual export slot start' }),
      Object.freeze({ register: end, valueKind: 'HHMM end', purpose: 'manual export slot end' }),
      Object.freeze({ register: target, value: exportTargetSoc, purpose: 'manual export lower-SOC target' }),
      Object.freeze({ register: power, value: powerPercent, purpose: 'manual export power percent' }),
      Object.freeze({ register: enable, value: 1, purpose: 'enable export namespace only after schedule and power readback' })
    ]),
    cleanupFirst: enable,
    cleanupSequence: Object.freeze([
      Object.freeze({ register: enable, value: 0, purpose: 'disable export namespace before restoring schedule state' }),
      Object.freeze({ register: start, valueFromPrestate: true, purpose: 'restore captured export slot start' }),
      Object.freeze({ register: end, valueFromPrestate: true, purpose: 'restore captured export slot end' }),
      Object.freeze({ register: target, valueFromPrestate: true, purpose: 'restore captured export lower-SOC target' }),
      Object.freeze({ register: power, valueFromPrestate: true, purpose: 'restore captured HR112 export/discharge power percent' }),
      Object.freeze({ register: enable, valueFromPrestate: true, purpose: 'restore captured export-enable state only if it was previously enabled' })
    ]),
    verifyAfterEveryWrite: true,
    restoreNormalDischarge: STAGE8_EXPORT_LIFECYCLE_POLICY.normalDischargeRestoreRule,
    ambiguityResolved: Object.freeze({ HR112: REGISTER_AUTHORITY.HR112.role, HR314: REGISTER_AUTHORITY.HR314.role })
  });
}

function buildCeAcCoupledExportLifecyclePlan() {
  return Object.freeze({
    stage: STAGE8_EXPORT_LIFECYCLE_POLICY.stage,
    executable: false,
    profile: 'CE/AC-coupled',
    action: 'export',
    route: CE_AC_COUPLED_POLICY.route,
    preserveBeforeWrite: CE_AC_COUPLED_POLICY.exportRegisters,
    writeSequence: Object.freeze([
      Object.freeze({ register: 'HR56', valueKind: 'HHMM start', purpose: 'core export start, profile-gated' }),
      Object.freeze({ register: 'HR57', valueKind: 'HHMM end', purpose: 'core export end, profile-gated' }),
      Object.freeze({ register: 'HR112', valueKind: 'captured-or-configured percent', purpose: 'core export/discharge power percent' }),
      Object.freeze({ register: 'HR59', value: 1, purpose: 'enable export/discharge only after readback' })
    ]),
    cleanupFirst: 'HR59',
    cleanupSequence: Object.freeze([
      Object.freeze({ register: 'HR59', value: 0, purpose: 'disable export/discharge before restore' }),
      Object.freeze({ register: 'HR56', valueFromPrestate: true, purpose: 'restore exact core export start' }),
      Object.freeze({ register: 'HR57', valueFromPrestate: true, purpose: 'restore exact core export end' }),
      Object.freeze({ register: 'HR112', valueFromPrestate: true, purpose: 'restore exact export/discharge power percent' }),
      Object.freeze({ register: 'HR59', valueFromPrestate: true, purpose: 'restore captured enable state only if previously enabled' })
    ]),
    verifyAfterEveryWrite: true,
    warning: CE_AC_COUPLED_POLICY.safety,
    noSlot8Generalisation: true
  });
}

function renderExportLifecycleAuthorityLine() {
  return [
    'GivHome export lifecycle authority snapshot:',
    'authoritySnapshotOnly=yes',
    'legacyDryRunExecutable=no',
    'localLiveExportPath=armed-behind-explicit-gates',
    'homeKitExposureManagedBy=integrated-appliance-control',
    'inverterWritesManagedBy=queued-local-command-transport',
    `legacyLiveExportPathBound=${STAGE8_EXPORT_LIFECYCLE_POLICY.liveExportPathBound ? 'yes' : 'no'}`,
    'chAioRoute=HR291,HR292,HR293,HR112,HR59',
    'ceAcRoute=HR56,HR57,HR112,HR59',
    'restoreNormalDischarge=captured-prestate-only',
    'ordinaryDischargeRate=HR112',
    'hr314Use=profile-evidence-not-normal-command',
    'runtimeMeaning=route-authority-not-live-gate-status',
    `automaticMutationPath=${STAGE8_EXPORT_LIFECYCLE_POLICY.automaticMutationPath}`
  ].join(' ');
}

module.exports = {
  STAGE8_EXPORT_LIFECYCLE_POLICY,
  buildChAioExportLifecyclePlan,
  buildCeAcCoupledExportLifecyclePlan,
  renderExportLifecycleAuthorityLine
};
