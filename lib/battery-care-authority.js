'use strict';

/*
 * GivHome Battery Care authority.
 *
 * This is executable metadata and pure planning logic only. It makes no
 * inverter writes, exposes no HomeKit controls, and does not bind automatic
 * charging. It captures the original homebridge-giv-iog-local Battery Care
 * behaviour so the direct-Modbus appliance can later port it without guessing.
 */

const BATTERY_CARE_POLICY = Object.freeze({
  stage: 'GivHome Battery Care authority',
  executable: false,
  homeKitExposureAdded: false,
  inverterWritesAdded: false,
  chargeRateWritesAdded: false,
  automaticMutationPath: 'absent',
  sourceModel: 'homebridge-giv-iog-local@3.7.5 Battery Care Charging / Smooth Charging line',
  scope: 'main-overnight-cheap-window-only',
  excludedWindows: Object.freeze(['Intelligent Octopus Go extra dispatch windows', 'grace periods', 'manual smart windows', 'manual timed Charge/Export tiles', 'short windows']),
  requiredInputs: Object.freeze(['soc', 'targetSoc', 'batteryCapacityKwh', 'maxBatteryChargePowerKw', 'remainingMinutes', 'careMode']),
  ordinaryChargeRateRegister: 'HR111',
  notOrdinaryChAioChargeRateRegister: 'HR313',
  noWritesUntilStageGate: 'HR111 charge-rate writes may bind only behind explicit local-control gates and Battery Care scope checks.'
});

const BATTERY_CARE_PROFILES = Object.freeze({
  gentle: Object.freeze({ reservePercent: 18, minimumRatePercent: 15, maximumRatePercent: 75 }),
  balanced: Object.freeze({ reservePercent: 25, minimumRatePercent: 20, maximumRatePercent: 90 }),
  strong: Object.freeze({ reservePercent: 35, minimumRatePercent: 25, maximumRatePercent: 100 })
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normaliseCareMode(mode) {
  const value = String(mode || 'balanced').toLowerCase();
  return Object.prototype.hasOwnProperty.call(BATTERY_CARE_PROFILES, value) ? value : 'balanced';
}

function isMainOvernightCheapWindow(cheapState = {}, options = {}) {
  if (!cheapState || cheapState.cheapActive !== true || !(cheapState.cheapWindowEnd instanceof Date)) {
    return false;
  }

  const source = String(cheapState.source || '');
  if (cheapState.graceActive || cheapState.smartActive || /smart-charging|grace-period|manual-smart-window/i.test(source)) {
    return false;
  }

  if (options.requireOffPeakSource === false) {
    return true;
  }

  return source === '' || /off-peak-hours|fallback|overnight/i.test(source);
}

function shouldUseBatteryCare(snapshot = {}, cheapState = {}, options = {}) {
  if (options.enabled !== true) return false;
  if (!isMainOvernightCheapWindow(cheapState, options)) return false;
  if (!Number.isFinite(options.maxBatteryChargePowerKw) || options.maxBatteryChargePowerKw <= 0) return false;
  if (!Number.isFinite(options.batteryCapacityKwh) || options.batteryCapacityKwh <= 0) return false;

  const minimumMinutes = Number.isFinite(options.minimumRemainingMinutes)
    ? clamp(Math.round(options.minimumRemainingMinutes), 60, 360)
    : 90;
  const remainingMinutes = Number.isFinite(options.remainingMinutes)
    ? Math.round(options.remainingMinutes)
    : Math.ceil((cheapState.cheapWindowEnd.getTime() - Date.now()) / 60000);
  if (!Number.isFinite(remainingMinutes) || remainingMinutes < minimumMinutes) return false;

  const soc = Number(snapshot.soc ?? snapshot.socPercent);
  const targetSoc = Number.isFinite(options.targetSoc) ? clamp(Math.round(options.targetSoc), 1, 100) : 100;
  if (!Number.isFinite(soc) || soc >= targetSoc) return false;

  if (snapshot.online === false || snapshot.safeForAutomation === false) return false;

  return true;
}

function buildBatteryCareChargePlan(snapshot = {}, cheapState = {}, options = {}) {
  const careMode = normaliseCareMode(options.careMode);
  const profile = BATTERY_CARE_PROFILES[careMode];
  const targetSoc = Number.isFinite(options.targetSoc) ? clamp(Math.round(options.targetSoc), 1, 100) : 100;
  const soc = Number(snapshot.soc ?? snapshot.socPercent);
  const batteryCapacityKwh = Number(options.batteryCapacityKwh);
  const maxBatteryChargePowerKw = Number(options.maxBatteryChargePowerKw);
  const remainingMinutes = Number.isFinite(options.remainingMinutes)
    ? Math.max(1, Math.round(options.remainingMinutes))
    : (cheapState.cheapWindowEnd instanceof Date ? Math.max(1, Math.ceil((cheapState.cheapWindowEnd.getTime() - Date.now()) / 60000)) : null);

  const eligible = shouldUseBatteryCare(snapshot, cheapState, options);
  if (!eligible) {
    return Object.freeze({
      stage: BATTERY_CARE_POLICY.stage,
      executable: false,
      inverterWritesAdded: false,
      chargeRateWritesAdded: false,
      automaticMutationPath: 'absent',
      mode: 'standard-charge-or-idle',
      eligible: false,
      reason: 'Battery Care conditions are not all satisfied; standard charging remains the future fallback for this window.',
      scope: BATTERY_CARE_POLICY.scope,
      careMode,
      futureChargeRateRegister: BATTERY_CARE_POLICY.ordinaryChargeRateRegister
    });
  }

  const socGap = clamp(targetSoc - soc, 0, 100);
  const energyNeededKwh = (socGap / 100) * batteryCapacityKwh;
  const remainingHours = remainingMinutes / 60;
  const requiredAverageKw = remainingHours > 0 ? energyNeededKwh / remainingHours : maxBatteryChargePowerKw;
  const rawRatePercent = (requiredAverageKw / maxBatteryChargePowerKw) * 100;
  const chargeRatePercent = clamp(
    Math.ceil(rawRatePercent + profile.reservePercent),
    profile.minimumRatePercent,
    profile.maximumRatePercent
  );
  const estimatedKw = (maxBatteryChargePowerKw * chargeRatePercent) / 100;

  return Object.freeze({
    stage: BATTERY_CARE_POLICY.stage,
    executable: false,
    inverterWritesAdded: false,
    chargeRateWritesAdded: false,
    automaticMutationPath: 'absent',
    mode: 'battery-care-overnight-charge-rate-plan',
    eligible: true,
    scope: BATTERY_CARE_POLICY.scope,
    careMode,
    soc,
    targetSoc,
    socGap,
    batteryCapacityKwh,
    maxBatteryChargePowerKw,
    remainingMinutes,
    energyNeededKwh,
    requiredAverageKw,
    chargeRatePercent,
    estimatedKw,
    futureChargeRateRegister: BATTERY_CARE_POLICY.ordinaryChargeRateRegister,
    warning: 'Plan only. Beta 41 does not write HR111, enable HR96, expose Battery Care controls, or bind automatic charging.'
  });
}

function renderBatteryCareAuthorityLine() {
  return [
    'GivHome Battery Care authority snapshot:',
    'authoritySnapshotOnly=yes',
    'legacyDryRunExecutable=no',
    'homeKitExposureManagedBy=integrated-appliance-control',
    'chargeRateWritesManagedBy=local-battery-care-runtime-engine',
    'inverterWritesManagedBy=queued-local-command-transport',
    'scope=main-overnight-cheap-window-only',
    'extraDispatches=standard-charge-not-battery-care',
    'gracePeriods=standard-charge-not-battery-care',
    'ordinaryChargeRate=HR111',
    'hr313Use=profile-evidence-not-normal-command',
    'runtimeMeaning=rate-plan-authority-not-live-gate-status',
    `automaticMutationPath=${BATTERY_CARE_POLICY.automaticMutationPath}`
  ].join(' ');
}

module.exports = {
  BATTERY_CARE_POLICY,
  BATTERY_CARE_PROFILES,
  normaliseCareMode,
  isMainOvernightCheapWindow,
  shouldUseBatteryCare,
  buildBatteryCareChargePlan,
  renderBatteryCareAuthorityLine
};
