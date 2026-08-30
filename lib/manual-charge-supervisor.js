'use strict';

const MANUAL_CHARGE_SUPERVISOR_STAGE = 'givhome-1.0.0-always-on-manual-charge-supervisor';
const MANUAL_CHARGE_FAILSAFE_CONFIG_ENABLE_KEY = 'manualChargeExpiredSlotFailsafeGate';
const MANUAL_CHARGE_FAILSAFE_CONFIG_ACK_KEY = 'manualChargeExpiredSlotFailsafeAcknowledgement';
const MANUAL_CHARGE_FAILSAFE_REQUIRED_ACK = 'ENABLE_STAGE5_MANUAL_CHARGE_EXPIRED_SLOT_FAILSAFE';

const DEFAULT_SUPERVISOR_POLICY = Object.freeze({
  stage: MANUAL_CHARGE_SUPERVISOR_STAGE,
  monitorDefaultEnabled: true,
  liveRepairDefaultEnabled: false,
  pollSeconds: 90,
  graceMinutes: 10,
  repairOrder: Object.freeze(['HR96'])
});

function validHmm(value) {
  return Number.isInteger(value) && value >= 0 && value <= 2359 && (value % 100) <= 59;
}

function hmmToMinutes(hmm) {
  return Math.floor(hmm / 100) * 60 + (hmm % 100);
}

function minutesToHmm(minutes) {
  const clamped = ((minutes % 1440) + 1440) % 1440;
  return Math.floor(clamped / 60) * 100 + (clamped % 60);
}

function normaliseSupervisorPollSeconds(value) {
  const numeric = Number.isInteger(value) ? value : DEFAULT_SUPERVISOR_POLICY.pollSeconds;
  return Math.max(45, Math.min(900, numeric));
}

function normaliseSupervisorGraceMinutes(value) {
  const numeric = Number.isInteger(value) ? value : DEFAULT_SUPERVISOR_POLICY.graceMinutes;
  return Math.max(0, Math.min(120, numeric));
}

function buildManualChargeSupervisorStatus(config = {}) {
  const liveRepairRequested = config[MANUAL_CHARGE_FAILSAFE_CONFIG_ENABLE_KEY] === true;
  const acknowledgement = String(config[MANUAL_CHARGE_FAILSAFE_CONFIG_ACK_KEY] || '');
  const acknowledgementAccepted = acknowledgement === MANUAL_CHARGE_FAILSAFE_REQUIRED_ACK;
  const liveRepairEnabled = liveRepairRequested && acknowledgementAccepted;

  return {
    stage: MANUAL_CHARGE_SUPERVISOR_STAGE,
    monitorEnabled: true,
    monitorDefaultEnabled: true,
    liveRepairDefaultEnabled: false,
    liveRepairRequested,
    liveRepairAcknowledgementAccepted: acknowledgementAccepted,
    liveRepairEnabled,
    automaticMutationPath: liveRepairEnabled ? 'explicit-expired-manual-charge-failsafe' : 'absent',
    liveRepairConfigKey: MANUAL_CHARGE_FAILSAFE_CONFIG_ENABLE_KEY,
    liveRepairAcknowledgementConfigKey: MANUAL_CHARGE_FAILSAFE_CONFIG_ACK_KEY,
    liveRepairRequiredAcknowledgement: MANUAL_CHARGE_FAILSAFE_REQUIRED_ACK,
    pollSeconds: normaliseSupervisorPollSeconds(config.manualChargeExpiredSlotFailsafePollSeconds),
    graceMinutes: normaliseSupervisorGraceMinutes(config.manualChargeExpiredSlotFailsafeGraceMinutes),
    repairOrder: DEFAULT_SUPERVISOR_POLICY.repairOrder.slice()
  };
}

function evaluateManualChargeExpiredSlot(registers = {}, options = {}) {
  const nowHmm = Number.isInteger(options.nowHmm) ? options.nowHmm : currentHmm();
  const graceMinutes = normaliseSupervisorGraceMinutes(options.graceMinutes);
  const hr94 = registers.HR94;
  const hr95 = registers.HR95;
  const hr96 = registers.HR96;

  const result = {
    stage: MANUAL_CHARGE_SUPERVISOR_STAGE,
    HR94: hr94,
    HR95: hr95,
    HR96: hr96,
    nowHmm,
    graceMinutes,
    enabled: hr96 === 1,
    validStart: validHmm(hr94),
    validEnd: validHmm(hr95),
    expired: false,
    withinActiveWindow: false,
    stopRequired: false,
    reason: 'not-enabled'
  };

  if (hr96 !== 1) {
    return result;
  }

  if (!validHmm(hr94) || !validHmm(hr95) || hr94 === hr95) {
    result.reason = 'enabled-but-invalid-window';
    return result;
  }

  const nowMin = hmmToMinutes(nowHmm);
  const startMin = hmmToMinutes(hr94);
  const endMin = hmmToMinutes(hr95);

  if (startMin < endMin) {
    result.withinActiveWindow = nowMin >= startMin && nowMin <= endMin;
    result.expired = nowMin > endMin + graceMinutes;
  } else {
    // Cross-midnight: expired only after the post-midnight end+grace, and before the next start.
    result.withinActiveWindow = nowMin >= startMin || nowMin <= endMin;
    result.expired = nowMin > endMin + graceMinutes && nowMin < startMin;
  }

  if (result.expired) {
    result.stopRequired = true;
    result.reason = 'enabled-window-expired-after-grace';
  } else if (result.withinActiveWindow) {
    result.reason = 'enabled-window-active';
  } else {
    result.reason = 'enabled-window-not-yet-expired-after-grace';
  }

  return result;
}

function currentHmm(date = new Date()) {
  return date.getHours() * 100 + date.getMinutes();
}

function renderManualChargeSupervisorStatusLine(status) {
  return [
    'GivHome manual charge always-on supervisor:',
    `monitorEnabled=${status.monitorEnabled ? 'yes' : 'no'}`,
    `pollSeconds=${status.pollSeconds}`,
    `graceMinutes=${status.graceMinutes}`,
    `liveRepairRequested=${status.liveRepairRequested ? 'yes' : 'no'}`,
    `liveRepairAcknowledgementAccepted=${status.liveRepairAcknowledgementAccepted ? 'yes' : 'no'}`,
    `liveRepairEnabled=${status.liveRepairEnabled ? 'yes' : 'no'}`,
    `automaticMutationPath=${status.automaticMutationPath}`
  ].join(' ');
}

function renderManualChargeSupervisorEvaluationLine(evaluation) {
  return [
    'GivHome manual charge supervisor evaluation:',
    `HR94=${evaluation.HR94}`,
    `HR95=${evaluation.HR95}`,
    `HR96=${evaluation.HR96}`,
    `nowHmm=${evaluation.nowHmm}`,
    `graceMinutes=${evaluation.graceMinutes}`,
    `enabled=${evaluation.enabled ? 'yes' : 'no'}`,
    `withinActiveWindow=${evaluation.withinActiveWindow ? 'yes' : 'no'}`,
    `expired=${evaluation.expired ? 'yes' : 'no'}`,
    `stopRequired=${evaluation.stopRequired ? 'yes' : 'no'}`,
    `reason=${evaluation.reason}`
  ].join(' ');
}

module.exports = {
  MANUAL_CHARGE_SUPERVISOR_STAGE,
  MANUAL_CHARGE_FAILSAFE_CONFIG_ENABLE_KEY,
  MANUAL_CHARGE_FAILSAFE_CONFIG_ACK_KEY,
  MANUAL_CHARGE_FAILSAFE_REQUIRED_ACK,
  DEFAULT_SUPERVISOR_POLICY,
  buildManualChargeSupervisorStatus,
  evaluateManualChargeExpiredSlot,
  currentHmm,
  minutesToHmm,
  normaliseSupervisorPollSeconds,
  normaliseSupervisorGraceMinutes,
  renderManualChargeSupervisorStatusLine,
  renderManualChargeSupervisorEvaluationLine
};
