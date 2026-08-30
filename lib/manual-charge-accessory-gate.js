'use strict';

const {
  buildManualChargeStartPlan,
  buildManualChargeCancelPlan
} = require('./manual-charge-command-core');

const MANUAL_CHARGE_ACCESSORY_GATE_STAGE = 'givhome-1.0.0-actual-accessory-binding';
const MANUAL_CHARGE_ACCESSORY_CONFIG_ENABLE_KEY = 'enableManualChargeCommandAccessory';
const MANUAL_CHARGE_ACCESSORY_CONFIG_ACK_KEY = 'manualChargeCommandAccessoryAcknowledgement';
const MANUAL_CHARGE_ACCESSORY_REQUIRED_ACK = 'ENABLE_STAGE5_MANUAL_CHARGE_COMMAND_ACCESSORY';
const MANUAL_CHARGE_LIVE_WRITE_CONFIG_ENABLE_KEY = 'enableManualChargeHomeKitLiveWrites';
const MANUAL_CHARGE_LIVE_WRITE_CONFIG_ACK_KEY = 'manualChargeHomeKitLiveWriteAcknowledgement';
const MANUAL_CHARGE_LIVE_WRITE_REQUIRED_ACK = 'ENABLE_STAGE5_MANUAL_CHARGE_HOMEKIT_LIVE_WRITES';

const DEFAULT_MANUAL_CHARGE_ACCESSORY_GATE_POLICY = Object.freeze({
  stage: MANUAL_CHARGE_ACCESSORY_GATE_STAGE,
  defaultEnabled: false,
  homeKitExposureDefault: 'locked',
  commandTilesDefault: 'disabled',
  automaticMutationPath: 'absent',
  commandCoreAvailable: true,
  homeKitSetHandlerBound: false,
  liveWritesFromHomeKit: false,
  requiresExplicitConfigEnable: true,
  requiresExactAcknowledgement: true,
  enableConfigKey: MANUAL_CHARGE_ACCESSORY_CONFIG_ENABLE_KEY,
  acknowledgementConfigKey: MANUAL_CHARGE_ACCESSORY_CONFIG_ACK_KEY,
  requiredAcknowledgement: MANUAL_CHARGE_ACCESSORY_REQUIRED_ACK,
  liveWriteDefaultEnabled: false,
  liveWriteEnableConfigKey: MANUAL_CHARGE_LIVE_WRITE_CONFIG_ENABLE_KEY,
  liveWriteAcknowledgementConfigKey: MANUAL_CHARGE_LIVE_WRITE_CONFIG_ACK_KEY,
  liveWriteRequiredAcknowledgement: MANUAL_CHARGE_LIVE_WRITE_REQUIRED_ACK
});

function buildManualChargeAccessoryGateStatus(config = {}) {
  const requested = config[MANUAL_CHARGE_ACCESSORY_CONFIG_ENABLE_KEY] === true;
  const acknowledgement = String(config[MANUAL_CHARGE_ACCESSORY_CONFIG_ACK_KEY] || '');
  const acknowledgementAccepted = acknowledgement === MANUAL_CHARGE_ACCESSORY_REQUIRED_ACK;
  const enabled = requested && acknowledgementAccepted;

  const liveWriteRequested = config[MANUAL_CHARGE_LIVE_WRITE_CONFIG_ENABLE_KEY] === true;
  const liveWriteAcknowledgement = String(config[MANUAL_CHARGE_LIVE_WRITE_CONFIG_ACK_KEY] || '');
  const liveWriteAcknowledgementAccepted = liveWriteAcknowledgement === MANUAL_CHARGE_LIVE_WRITE_REQUIRED_ACK;
  const liveWriteGateSatisfied = enabled && liveWriteRequested && liveWriteAcknowledgementAccepted;

  const homeKitExposure = enabled
    ? (liveWriteGateSatisfied ? 'manual-charge-command-accessory-live' : 'manual-charge-command-accessory-present')
    : 'locked';

  const commandTiles = enabled
    ? (liveWriteGateSatisfied ? 'manual-charge-command-accessory-live-writes-enabled' : 'manual-charge-command-accessory-shell')
    : 'disabled';

  return {
    stage: MANUAL_CHARGE_ACCESSORY_GATE_STAGE,
    defaultEnabled: false,
    requested,
    acknowledgementAccepted,
    enabled,
    homeKitExposure,
    commandTiles,
    automaticMutationPath: 'absent',
    commandCoreAvailable: true,
    accessoryShapeAvailable: enabled,
    homeKitSetHandlerBound: liveWriteGateSatisfied,
    liveWritesFromHomeKit: liveWriteGateSatisfied,
    liveWriteDefaultEnabled: false,
    liveWriteRequested,
    liveWriteAcknowledgementAccepted,
    liveWriteGateSatisfied,
    candidateLiveWritesFromHomeKit: liveWriteGateSatisfied,
    safeByDefault: !requested && !enabled && !liveWriteGateSatisfied,
    enableConfigKey: MANUAL_CHARGE_ACCESSORY_CONFIG_ENABLE_KEY,
    acknowledgementConfigKey: MANUAL_CHARGE_ACCESSORY_CONFIG_ACK_KEY,
    requiredAcknowledgement: MANUAL_CHARGE_ACCESSORY_REQUIRED_ACK,
    liveWriteEnableConfigKey: MANUAL_CHARGE_LIVE_WRITE_CONFIG_ENABLE_KEY,
    liveWriteAcknowledgementConfigKey: MANUAL_CHARGE_LIVE_WRITE_CONFIG_ACK_KEY,
    liveWriteRequiredAcknowledgement: MANUAL_CHARGE_LIVE_WRITE_REQUIRED_ACK
  };
}

function buildManualChargeAccessoryExposureDryRun(config = {}) {
  const status = buildManualChargeAccessoryGateStatus(config);
  return {
    stage: MANUAL_CHARGE_ACCESSORY_GATE_STAGE,
    gate: status,
    serviceShapeWouldExpose: status.enabled,
    accessoryDisplayName: 'Manual Charge',
    serviceType: 'Switch',
    characteristic: 'On',
    initialValue: false,
    onSetHandlerWouldBind: false,
    liveWriteHandlerWouldBind: false,
    liveWritesFromHomeKit: false,
    candidateLiveWriteGateSatisfied: status.liveWriteGateSatisfied,
    homeKitExposure: status.homeKitExposure,
    commandTiles: status.commandTiles,
    automaticMutationPath: 'absent',
    commandCoreAvailable: true,
    dryRunOnly: true
  };
}

function buildManualChargeHomeKitSetHandlerDryRun(config = {}, options = {}) {
  const status = buildManualChargeAccessoryGateStatus(config);
  const startPlan = buildManualChargeStartPlan({
    startHmm: Number.isInteger(options.startHmm) ? options.startHmm : 1200,
    endHmm: Number.isInteger(options.endHmm) ? options.endHmm : 1201,
    powerPercent: Number.isInteger(options.powerPercent) ? options.powerPercent : 100,
    targetSoc: Number.isInteger(options.targetSoc) ? options.targetSoc : 100
  });
  const cancelPlan = buildManualChargeCancelPlan({
    originalStart: Number.isInteger(options.originalStart) ? options.originalStart : 0,
    originalEnd: Number.isInteger(options.originalEnd) ? options.originalEnd : 0,
    restoreSlot: options.restoreSlot !== false
  });

  const handlerWouldBind = status.enabled && status.liveWriteGateSatisfied;

  return {
    stage: MANUAL_CHARGE_ACCESSORY_GATE_STAGE,
    gate: status,
    serviceShapeWouldExpose: status.enabled,
    accessoryDisplayName: 'Manual Charge',
    serviceType: 'Switch',
    characteristic: 'On',
    initialValue: false,
    homeKitSetHandlerWouldBind: handlerWouldBind,
    liveWriteHandlerWouldBind: handlerWouldBind,
    liveWriteGateSatisfied: status.liveWriteGateSatisfied,
    candidateLiveWritesFromHomeKit: handlerWouldBind,
    liveWritesFromHomeKit: false,
    dryRunOnly: true,
    liveWriteExecuted: false,
    onTrueWouldCall: startPlan.kind,
    onFalseWouldCall: cancelPlan.kind,
    onTrueStartPlanRegisters: startPlan.writes.map((write) => write.label),
    onFalseCancelPlanRegisters: cancelPlan.writes.map((write) => write.label),
    restoreFirst: cancelPlan.writes[0] && cancelPlan.writes[0].label,
    startPlan,
    cancelPlan,
    homeKitExposure: status.homeKitExposure,
    commandTiles: status.commandTiles,
    automaticMutationPath: 'absent',
    commandCoreAvailable: true
  };
}


function buildManualChargeActualHomeKitBindingPlan(config = {}, options = {}) {
  const status = buildManualChargeAccessoryGateStatus(config);
  const startPlan = buildManualChargeStartPlan({
    startHmm: Number.isInteger(options.startHmm) ? options.startHmm : 1200,
    endHmm: Number.isInteger(options.endHmm) ? options.endHmm : 1201,
    powerPercent: Number.isInteger(options.powerPercent) ? options.powerPercent : 100,
    targetSoc: Number.isInteger(options.targetSoc) ? options.targetSoc : 100
  });
  const cancelPlan = buildManualChargeCancelPlan({
    originalStart: Number.isInteger(options.originalStart) ? options.originalStart : 0,
    originalEnd: Number.isInteger(options.originalEnd) ? options.originalEnd : 0,
    restoreSlot: options.restoreSlot !== false
  });

  return {
    stage: MANUAL_CHARGE_ACCESSORY_GATE_STAGE,
    gate: status,
    serviceShapeShouldExpose: status.enabled,
    accessoryDisplayName: 'Manual Charge',
    serviceType: 'Switch',
    characteristic: 'On',
    initialValue: false,
    homeKitSetHandlerShouldBind: status.liveWriteGateSatisfied,
    liveWriteHandlerShouldBind: status.liveWriteGateSatisfied,
    liveWriteGateSatisfied: status.liveWriteGateSatisfied,
    liveWritesFromHomeKit: status.liveWritesFromHomeKit,
    actualBindingImplemented: true,
    defaultOff: status.safeByDefault,
    liveWriteExecuted: false,
    onTrueCalls: startPlan.kind,
    onFalseCalls: cancelPlan.kind,
    onTrueStartPlanRegisters: startPlan.writes.map((write) => write.label),
    onFalseCancelPlanRegisters: cancelPlan.writes.map((write) => write.label),
    restoreFirst: cancelPlan.writes[0] && cancelPlan.writes[0].label,
    startPlan,
    cancelPlan,
    homeKitExposure: status.homeKitExposure,
    commandTiles: status.commandTiles,
    automaticMutationPath: 'absent',
    commandCoreAvailable: true
  };
}

function renderManualChargeAccessoryGateLine(status) {
  return [
    'GivHome manual charge accessory gate:',
    `defaultEnabled=${status.defaultEnabled ? 'yes' : 'no'}`,
    `requested=${status.requested ? 'yes' : 'no'}`,
    `acknowledgementAccepted=${status.acknowledgementAccepted ? 'yes' : 'no'}`,
    `enabled=${status.enabled ? 'yes' : 'no'}`,
    `homeKitExposure=${status.homeKitExposure}`,
    `commandTiles=${status.commandTiles}`,
    `homeKitSetHandlerBound=${status.homeKitSetHandlerBound ? 'yes' : 'no'}`,
    `liveWriteRequested=${status.liveWriteRequested ? 'yes' : 'no'}`,
    `liveWriteAcknowledgementAccepted=${status.liveWriteAcknowledgementAccepted ? 'yes' : 'no'}`,
    `liveWriteGateSatisfied=${status.liveWriteGateSatisfied ? 'yes' : 'no'}`,
    `candidateLiveWritesFromHomeKit=${status.candidateLiveWritesFromHomeKit ? 'yes' : 'no'}`,
    `liveWritesFromHomeKit=${status.liveWritesFromHomeKit ? 'yes' : 'no'}`,
    `automaticMutationPath=${status.automaticMutationPath}`
  ].join(' ');
}

function renderManualChargeAccessoryExposureDryRunLine(dryRun) {
  return [
    'GivHome manual charge accessory exposure dry-run:',
    `serviceShapeWouldExpose=${dryRun.serviceShapeWouldExpose ? 'yes' : 'no'}`,
    `accessoryDisplayName=${dryRun.accessoryDisplayName.replace(/\s+/g, '_')}`,
    `serviceType=${dryRun.serviceType}`,
    `characteristic=${dryRun.characteristic}`,
    `initialValue=${dryRun.initialValue ? 'true' : 'false'}`,
    `onSetHandlerWouldBind=${dryRun.onSetHandlerWouldBind ? 'yes' : 'no'}`,
    `liveWriteHandlerWouldBind=${dryRun.liveWriteHandlerWouldBind ? 'yes' : 'no'}`,
    `candidateLiveWriteGateSatisfied=${dryRun.candidateLiveWriteGateSatisfied ? 'yes' : 'no'}`,
    `liveWritesFromHomeKit=${dryRun.liveWritesFromHomeKit ? 'yes' : 'no'}`,
    `homeKitExposure=${dryRun.homeKitExposure}`,
    `commandTiles=${dryRun.commandTiles}`,
    `automaticMutationPath=${dryRun.automaticMutationPath}`,
    `dryRunOnly=${dryRun.dryRunOnly ? 'yes' : 'no'}`
  ].join(' ');
}

function renderManualChargeHomeKitSetHandlerDryRunLine(dryRun) {
  return [
    'GivHome manual charge HomeKit set-handler dry-run:',
    `serviceShapeWouldExpose=${dryRun.serviceShapeWouldExpose ? 'yes' : 'no'}`,
    `homeKitSetHandlerWouldBind=${dryRun.homeKitSetHandlerWouldBind ? 'yes' : 'no'}`,
    `liveWriteHandlerWouldBind=${dryRun.liveWriteHandlerWouldBind ? 'yes' : 'no'}`,
    `liveWriteGateSatisfied=${dryRun.liveWriteGateSatisfied ? 'yes' : 'no'}`,
    `candidateLiveWritesFromHomeKit=${dryRun.candidateLiveWritesFromHomeKit ? 'yes' : 'no'}`,
    `liveWritesFromHomeKit=${dryRun.liveWritesFromHomeKit ? 'yes' : 'no'}`,
    `dryRunOnly=${dryRun.dryRunOnly ? 'yes' : 'no'}`,
    `liveWriteExecuted=${dryRun.liveWriteExecuted ? 'yes' : 'no'}`,
    `onTrueWouldCall=${dryRun.onTrueWouldCall}`,
    `onFalseWouldCall=${dryRun.onFalseWouldCall}`,
    `onTrueStartPlanRegisters=${dryRun.onTrueStartPlanRegisters.join(',')}`,
    `onFalseCancelPlanRegisters=${dryRun.onFalseCancelPlanRegisters.join(',')}`,
    `restoreFirst=${dryRun.restoreFirst}`,
    `automaticMutationPath=${dryRun.automaticMutationPath}`
  ].join(' ');
}


function renderManualChargeActualHomeKitBindingPlanLine(plan) {
  return [
    'GivHome manual charge actual HomeKit binding plan:',
    `serviceShapeShouldExpose=${plan.serviceShapeShouldExpose ? 'yes' : 'no'}`,
    `accessoryDisplayName=${plan.accessoryDisplayName.replace(/\s+/g, '_')}`,
    `serviceType=${plan.serviceType}`,
    `characteristic=${plan.characteristic}`,
    `homeKitSetHandlerShouldBind=${plan.homeKitSetHandlerShouldBind ? 'yes' : 'no'}`,
    `liveWriteHandlerShouldBind=${plan.liveWriteHandlerShouldBind ? 'yes' : 'no'}`,
    `liveWriteGateSatisfied=${plan.liveWriteGateSatisfied ? 'yes' : 'no'}`,
    `liveWritesFromHomeKit=${plan.liveWritesFromHomeKit ? 'yes' : 'no'}`,
    `actualBindingImplemented=${plan.actualBindingImplemented ? 'yes' : 'no'}`,
    `liveWriteExecuted=${plan.liveWriteExecuted ? 'yes' : 'no'}`,
    `onTrueCalls=${plan.onTrueCalls}`,
    `onFalseCalls=${plan.onFalseCalls}`,
    `onTrueStartPlanRegisters=${plan.onTrueStartPlanRegisters.join(',')}`,
    `onFalseCancelPlanRegisters=${plan.onFalseCancelPlanRegisters.join(',')}`,
    `restoreFirst=${plan.restoreFirst}`,
    `homeKitExposure=${plan.homeKitExposure}`,
    `commandTiles=${plan.commandTiles}`,
    `automaticMutationPath=${plan.automaticMutationPath}`
  ].join(' ');
}

module.exports = {
  MANUAL_CHARGE_ACCESSORY_GATE_STAGE,
  MANUAL_CHARGE_ACCESSORY_CONFIG_ENABLE_KEY,
  MANUAL_CHARGE_ACCESSORY_CONFIG_ACK_KEY,
  MANUAL_CHARGE_ACCESSORY_REQUIRED_ACK,
  MANUAL_CHARGE_LIVE_WRITE_CONFIG_ENABLE_KEY,
  MANUAL_CHARGE_LIVE_WRITE_CONFIG_ACK_KEY,
  MANUAL_CHARGE_LIVE_WRITE_REQUIRED_ACK,
  DEFAULT_MANUAL_CHARGE_ACCESSORY_GATE_POLICY,
  buildManualChargeAccessoryGateStatus,
  buildManualChargeAccessoryExposureDryRun,
  buildManualChargeHomeKitSetHandlerDryRun,
  buildManualChargeActualHomeKitBindingPlan,
  renderManualChargeAccessoryGateLine,
  renderManualChargeAccessoryExposureDryRunLine,
  renderManualChargeHomeKitSetHandlerDryRunLine,
  renderManualChargeActualHomeKitBindingPlanLine
};
