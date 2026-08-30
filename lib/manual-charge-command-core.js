'use strict';

const MANUAL_CHARGE_COMMAND_CORE_STAGE = 'givhome-1.0.0-feature-gated-command-core';
const MANUAL_CHARGE_COMMAND_CORE_ENV_ACK = 'STAGE5_MANUAL_CHARGE_COMMAND_CORE_FEATURE_GATE';

const MANUAL_CHARGE_REGISTERS = Object.freeze({
  start: 94,
  end: 95,
  enable: 96,
  powerPercent: 111,
  targetSoc: 116
});

const DEFAULT_MANUAL_CHARGE_COMMAND_CORE_POLICY = Object.freeze({
  stage: MANUAL_CHARGE_COMMAND_CORE_STAGE,
  featureGateDefaultEnabled: false,
  homeKitExposure: 'locked',
  automaticMutationPath: 'absent',
  commandTiles: 'disabled',
  requiresExplicitAcknowledgement: true,
  restoreOrder: Object.freeze(['HR96', 'HR94', 'HR95']),
  preserveRegisters: Object.freeze(['HR111', 'HR116']),
  startRegisters: Object.freeze(['HR94', 'HR95', 'HR96']),
  cancelRegisters: Object.freeze(['HR96', 'HR94', 'HR95'])
});

function validHmm(value) {
  return Number.isInteger(value) && value >= 0 && value <= 2359 && (value % 100) <= 59;
}

function validPercent(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

function buildManualChargeCommandCoreStatus(options = {}) {
  const featureGateEnabled = options.featureGateEnabled === true;
  return {
    stage: MANUAL_CHARGE_COMMAND_CORE_STAGE,
    featureGateEnabled,
    featureGateDefaultEnabled: DEFAULT_MANUAL_CHARGE_COMMAND_CORE_POLICY.featureGateDefaultEnabled,
    homeKitExposure: DEFAULT_MANUAL_CHARGE_COMMAND_CORE_POLICY.homeKitExposure,
    automaticMutationPath: DEFAULT_MANUAL_CHARGE_COMMAND_CORE_POLICY.automaticMutationPath,
    commandTiles: DEFAULT_MANUAL_CHARGE_COMMAND_CORE_POLICY.commandTiles,
    canWriteFromHomeKit: false,
    cliHarnessOnly: true,
    requiresExplicitAcknowledgement: true,
    acknowledgementEnv: MANUAL_CHARGE_COMMAND_CORE_ENV_ACK
  };
}

function assertManualChargeCommandCoreFeatureGate(options = {}) {
  const explicitAck = options.explicitAck === 'YES' || options.explicitAck === true;
  const featureGateEnabled = options.featureGateEnabled === true;
  if (!featureGateEnabled || !explicitAck) {
    throw new Error(`${MANUAL_CHARGE_COMMAND_CORE_ENV_ACK}=YES and featureGateEnabled=true are required for the GivHome CLI command-core harness`);
  }
  return true;
}

function buildManualChargeStartPlan(options = {}) {
  const startHmm = options.startHmm;
  const endHmm = options.endHmm;
  const powerPercent = options.powerPercent;
  const targetSoc = options.targetSoc;

  if (!validHmm(startHmm)) throw new Error(`manual charge start must be valid HHMM: ${startHmm}`);
  if (!validHmm(endHmm)) throw new Error(`manual charge end must be valid HHMM: ${endHmm}`);
  if (startHmm === endHmm) throw new Error('manual charge start and end must not be identical');
  if (!validPercent(powerPercent)) throw new Error(`manual charge power must be 0-100 percent: ${powerPercent}`);
  if (!validPercent(targetSoc)) throw new Error(`manual charge target SOC must be 0-100 percent: ${targetSoc}`);

  return {
    kind: 'manual-charge-start',
    stage: MANUAL_CHARGE_COMMAND_CORE_STAGE,
    featureGateRequired: true,
    homeKitExposure: 'locked',
    automaticMutationPath: 'absent',
    writes: [
      { register: MANUAL_CHARGE_REGISTERS.powerPercent, label: 'HR111', value: powerPercent, preserveAfter: false },
      { register: MANUAL_CHARGE_REGISTERS.targetSoc, label: 'HR116', value: targetSoc, preserveAfter: false },
      { register: MANUAL_CHARGE_REGISTERS.start, label: 'HR94', value: startHmm, preserveAfter: false },
      { register: MANUAL_CHARGE_REGISTERS.end, label: 'HR95', value: endHmm, preserveAfter: false },
      { register: MANUAL_CHARGE_REGISTERS.enable, label: 'HR96', value: 1, preserveAfter: false }
    ],
    restoreFirst: 'HR96'
  };
}

function buildManualChargeCancelPlan(options = {}) {
  const originalStart = options.originalStart;
  const originalEnd = options.originalEnd;
  const restoreSlot = options.restoreSlot !== false;

  if (restoreSlot && !validHmm(originalStart)) throw new Error(`original manual charge start must be valid HHMM: ${originalStart}`);
  if (restoreSlot && !validHmm(originalEnd)) throw new Error(`original manual charge end must be valid HHMM: ${originalEnd}`);

  const writes = [
    { register: MANUAL_CHARGE_REGISTERS.enable, label: 'HR96', value: 0, restoreFirst: true }
  ];
  if (restoreSlot) {
    writes.push({ register: MANUAL_CHARGE_REGISTERS.start, label: 'HR94', value: originalStart });
    writes.push({ register: MANUAL_CHARGE_REGISTERS.end, label: 'HR95', value: originalEnd });
  }

  return {
    kind: 'manual-charge-cancel',
    stage: MANUAL_CHARGE_COMMAND_CORE_STAGE,
    featureGateRequired: true,
    homeKitExposure: 'locked',
    automaticMutationPath: 'absent',
    writes
  };
}

module.exports = {
  MANUAL_CHARGE_COMMAND_CORE_STAGE,
  MANUAL_CHARGE_COMMAND_CORE_ENV_ACK,
  MANUAL_CHARGE_REGISTERS,
  DEFAULT_MANUAL_CHARGE_COMMAND_CORE_POLICY,
  buildManualChargeCommandCoreStatus,
  assertManualChargeCommandCoreFeatureGate,
  buildManualChargeStartPlan,
  buildManualChargeCancelPlan
};
