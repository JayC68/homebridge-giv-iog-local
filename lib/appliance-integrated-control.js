'use strict';

const fs = require('fs');
const path = require('path');
const { classifySerialPrefix } = require('./profile-detector');

const APPLIANCE_CONTROL_ACK = 'ENABLE_GIVHOME_APPLIANCE_CONTROL';
const LEGACY_APPLIANCE_CONTROL_ACK = 'ENABLE_STAGE11_APPLIANCE_CONTROL';
const CE_AC_ACK = 'ENABLE_STAGE11_CE_AC_COUPLED_LIVE_WRITES';

const FEATURE_IDS = Object.freeze({
  CHARGE_TILES: 'chargeTiles',
  EXPORT_TILES: 'exportTiles',
  CHEAP_OVERNIGHT: 'cheapOvernightCharging',
  OCTOPUS: 'octopusSmartWindows',
  EV_PROTECTION: 'homeBatteryProtectionDuringSmartSlots',
  PAUSE_TILES: 'pauseTiles',
  BATTERY_CARE: 'batteryCare',
  EVENING_EXPORT: 'eveningExcessExport',
  OCTOPUS_FLUX_EXPORT: 'octopusFluxExport',
  OCTOPUS_AGILE_OUTGOING_EXPORT: 'octopusAgileOutgoingExport',
  EVE_HISTORY: 'eveHistory',
  CE_AC: 'ceAcCoupledLiveWrites'
});

const COMMAND_KINDS = Object.freeze({
  CHARGE_30: 'charge30',
  CHARGE_60: 'charge60',
  CHARGE_90: 'charge90',
  CHARGE_120: 'charge120',
  EXPORT_30: 'export30',
  EXPORT_60: 'export60',
  EXPORT_90: 'export90',
  EXPORT_120: 'export120',
  EVENING_EXCESS_EXPORT: 'eveningExcessExport',
  OCTOPUS_FLUX_EXPORT: 'octopusFluxExport',
  OCTOPUS_AGILE_OUTGOING_EXPORT: 'octopusAgileOutgoingExport',
  PAUSE_CHARGE: 'pauseCharge',
  PAUSE_DISCHARGE: 'pauseDischarge',
  PAUSE_BOTH: 'pauseBoth'
});

const COMMAND_TILES = Object.freeze([
  Object.freeze({ kind: COMMAND_KINDS.CHARGE_30, family: 'charge', displayName: 'Charge 30m', minutes: 30 }),
  Object.freeze({ kind: COMMAND_KINDS.CHARGE_60, family: 'charge', displayName: 'Charge 60m', minutes: 60 }),
  Object.freeze({ kind: COMMAND_KINDS.CHARGE_90, family: 'charge', displayName: 'Charge 90m', minutes: 90 }),
  Object.freeze({ kind: COMMAND_KINDS.CHARGE_120, family: 'charge', displayName: 'Charge 120m', minutes: 120 }),
  Object.freeze({ kind: COMMAND_KINDS.EXPORT_30, family: 'export', displayName: 'Export 30m', minutes: 30 }),
  Object.freeze({ kind: COMMAND_KINDS.EXPORT_60, family: 'export', displayName: 'Export 60m', minutes: 60 }),
  Object.freeze({ kind: COMMAND_KINDS.EXPORT_90, family: 'export', displayName: 'Export 90m', minutes: 90 }),
  Object.freeze({ kind: COMMAND_KINDS.EXPORT_120, family: 'export', displayName: 'Export 120m', minutes: 120 }),
  Object.freeze({ kind: COMMAND_KINDS.PAUSE_CHARGE, family: 'pause', displayName: 'Pause Charge', pauseMode: 'pauseCharge', pauseValue: 1 }),
  Object.freeze({ kind: COMMAND_KINDS.PAUSE_DISCHARGE, family: 'pause', displayName: 'Pause Discharge', pauseMode: 'pauseDischarge', pauseValue: 2 }),
  Object.freeze({ kind: COMMAND_KINDS.PAUSE_BOTH, family: 'pause', displayName: 'Pause Both', pauseMode: 'pauseBoth', pauseValue: 3 })
]);

const DEFAULTS = Object.freeze({
  targetSoc: 100,
  manualExportTargetSoc: 30,
  manualExportPowerPercent: 30,
  maxBatteryExportPowerKw: 6,
  maxGridExportPowerKw: 6,
  timedExportPowerKw: 6,
  timedExportPowerPercent: 100,
  cheapStart: '23:30',
  cheapEnd: '05:30',
  graceMinutes: 30,
  octopusPollSeconds: 120,
  batteryCapacityKwh: 13.5,
  maxBatteryChargePowerKw: 6,
  batteryCareMode: 'balanced',
  batteryCareMinimumWindowMinutes: 90,
  eveningExportStartTime: '19:30',
  eveningExportReserveSoc: 20,
  eveningExportPowerKw: 5,
  eveningExportPowerPercent: 30,
  eveningExportSlotMinutes: 30,
  eveningExportMarginSoc: 2,
  octopusFluxExportStartTime: '16:00',
  octopusFluxExportEndTime: '19:00',
  octopusFluxReserveSoc: 25,
  octopusFluxEveningReserveKwh: 3,
  octopusFluxSafetyMarginSoc: 4,
  octopusFluxExportPowerKw: 6,
  octopusFluxSlotMinutes: 30,
  octopusFluxMinimumExportKwh: 0.5,
  octopusFluxDaysToRun: Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  octopusFluxRunDaysPreset: 'everyday',
  octopusFluxTariffImportPence: 8,
  octopusFluxTariffExportPence: 22,
  octopusAgileOutgoingProductCode: 'AGILE-OUTGOING-19-05-13',
  octopusAgileOutgoingRegionCode: 'J',
  octopusAgileOutgoingAllowedStartTime: '00:00',
  octopusAgileOutgoingAllowedEndTime: '23:59',
  octopusAgileOutgoingSlotSearchMode: 'anyHighValue',
  octopusAgileOutgoingExecutionStage: 'plannerOnly',
  octopusAgileOutgoingStrategy: 'balanced',
  octopusAgileOutgoingLearningMode: 'observe',
  octopusAgileOutgoingDailyExportMode: 'auto',
  octopusAgileOutgoingRunDaysPreset: 'everyday',
  octopusAgileOutgoingReserveSoc: 35,
  octopusAgileOutgoingEveningReserveKwh: 3,
  octopusAgileOutgoingSafetyMarginSoc: 4,
  octopusAgileOutgoingExportPowerKw: 6,
  octopusAgileOutgoingMinimumExportKwh: 0.5,
  octopusAgileOutgoingMinimumExportPricePence: 16,
  octopusAgileOutgoingReferenceImportPence: 8,
  octopusAgileOutgoingMinimumGrossMarginPence: 5,
  octopusAgileOutgoingDailyExportCapKwh: 9,
  octopusAgileOutgoingDaysToRun: Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  octopusAgileOutgoingDryRun: true,
  octopusAgileOutgoingLiveAcknowledgement: 'ENABLE_AGILE_OUTGOING_LIVE_EXPORT',
  octopusAgileOutgoingMpanAuditDelayHours: 12,
  octopusAgileOutgoingMpanMismatchToleranceKwh: 1,
  eveHistorySampleMinutes: 5,
  iogHomeBatteryProtectionMode: 'charge'
});

function bool(value) {
  return value === true;
}

function intInRange(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function numberInRange(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function stringOrDefault(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}


const DAY_ALIASES = Object.freeze({
  sun: 'sun', sunday: 'sun',
  mon: 'mon', monday: 'mon',
  tue: 'tue', tues: 'tue', tuesday: 'tue',
  wed: 'wed', weds: 'wed', wednesday: 'wed',
  thu: 'thu', thur: 'thu', thurs: 'thu', thursday: 'thu',
  fri: 'fri', friday: 'fri',
  sat: 'sat', saturday: 'sat'
});

function normaliseDayToken(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return DAY_ALIASES[key] || '';
}

function normaliseDaysToRun(value, fallback = DEFAULTS.octopusAgileOutgoingDaysToRun) {
  if (value === undefined || value === null || value === '') return Array.from(fallback);
  const raw = Array.isArray(value) ? value : String(value).split(/[\s,;|]+/);
  const seen = new Set();
  const result = [];
  for (const item of raw) {
    const day = normaliseDayToken(item);
    if (day && !seen.has(day)) {
      seen.add(day);
      result.push(day);
    }
  }
  return result;
}

function normaliseFluxRunDaysPreset(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const aliases = new Map([
    ['everyday', 'everyday'],
    ['all', 'everyday'],
    ['daily', 'everyday'],
    ['weekdays', 'weekdays'],
    ['mondaytofriday', 'weekdays'],
    ['monfri', 'weekdays'],
    ['exceptfri', 'exceptFri'],
    ['nofriday', 'exceptFri'],
    ['exceptfriday', 'exceptFri'],
    ['exceptsat', 'exceptSat'],
    ['nosaturday', 'exceptSat'],
    ['exceptsaturday', 'exceptSat'],
    ['exceptsun', 'exceptSun'],
    ['nosunday', 'exceptSun'],
    ['exceptsunday', 'exceptSun'],
    ['custom', 'custom']
  ]);
  return aliases.get(raw) || DEFAULTS.octopusFluxRunDaysPreset;
}


function normaliseAgileExecutionStage(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases = new Map([
    ['planneronly', 'plannerOnly'],
    ['observe', 'plannerOnly'],
    ['dryrun', 'plannerOnly'],
    ['singleslot', 'singleSlot'],
    ['single', 'singleSlot'],
    ['oneslot', 'singleSlot'],
    ['multislot', 'multiSlot'],
    ['slottrader', 'multiSlot'],
    ['adaptive', 'adaptive']
  ]);
  return aliases.get(raw) || DEFAULTS.octopusAgileOutgoingExecutionStage;
}

function normaliseAgileStrategy(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const aliases = new Map([
    ['balanced', 'balanced'],
    ['maximumreturn', 'maximumReturn'],
    ['maximumvalue', 'maximumReturn'],
    ['maxreturn', 'maximumReturn'],
    ['maxvalue', 'maximumReturn'],
    ['extracautious', 'extraCautious'],
    ['cautious', 'extraCautious']
  ]);
  return aliases.get(raw) || DEFAULTS.octopusAgileOutgoingStrategy;
}

function normaliseAgileLearningMode(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const aliases = new Map([
    ['off', 'off'],
    ['observe', 'observe'],
    ['observeonly', 'observe'],
    ['adaptive', 'adaptive'],
    ['learn', 'adaptive']
  ]);
  return aliases.get(raw) || DEFAULTS.octopusAgileOutgoingLearningMode;
}

function normaliseAgileDailyExportMode(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return raw === 'custom' ? 'custom' : 'auto';
}

function normaliseAgileSlotSearchMode(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const aliases = new Map([
    ['anyhighvalue', 'anyHighValue'],
    ['any', 'anyHighValue'],
    ['allday', 'anyHighValue'],
    ['all', 'anyHighValue'],
    ['daytimeonly', 'daytimeOnly'],
    ['daytime', 'daytimeOnly'],
    ['day', 'daytimeOnly'],
    ['eveningfocus', 'eveningFocus'],
    ['evening', 'eveningFocus'],
    ['customtimewindow', 'customWindow'],
    ['customwindow', 'customWindow'],
    ['custom', 'customWindow']
  ]);
  return aliases.get(raw) || DEFAULTS.octopusAgileOutgoingSlotSearchMode;
}

function normaliseAgileRunDaysPreset(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  const aliases = new Map([
    ['everyday', 'everyday'],
    ['all', 'everyday'],
    ['daily', 'everyday'],
    ['weekdays', 'weekdays'],
    ['mondaytofriday', 'weekdays'],
    ['monfri', 'weekdays'],
    ['exceptfri', 'exceptFri'],
    ['nofriday', 'exceptFri'],
    ['exceptfriday', 'exceptFri'],
    ['exceptsat', 'exceptSat'],
    ['nosaturday', 'exceptSat'],
    ['exceptsaturday', 'exceptSat'],
    ['exceptsun', 'exceptSun'],
    ['nosunday', 'exceptSun'],
    ['exceptsunday', 'exceptSun'],
    ['custom', 'custom']
  ]);
  return aliases.get(raw) || DEFAULTS.octopusAgileOutgoingRunDaysPreset;
}

function agileDaysForPreset(preset, config = {}) {
  const allDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  switch (preset) {
    case 'weekdays': return ['mon', 'tue', 'wed', 'thu', 'fri'];
    case 'exceptFri': return ['mon', 'tue', 'wed', 'thu', 'sat', 'sun'];
    case 'exceptSat': return ['mon', 'tue', 'wed', 'thu', 'fri', 'sun'];
    case 'exceptSun': return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    case 'custom': {
      const pairs = [
        ['mon', 'octopusAgileOutgoingRunMonday'],
        ['tue', 'octopusAgileOutgoingRunTuesday'],
        ['wed', 'octopusAgileOutgoingRunWednesday'],
        ['thu', 'octopusAgileOutgoingRunThursday'],
        ['fri', 'octopusAgileOutgoingRunFriday'],
        ['sat', 'octopusAgileOutgoingRunSaturday'],
        ['sun', 'octopusAgileOutgoingRunSunday']
      ];
      return pairs.filter(([, key]) => config[key] !== false).map(([day]) => day);
    }
    case 'everyday':
    default:
      return allDays;
  }
}

function resolveOctopusAgileOutgoingDaysToRun(config = {}) {
  if (config.octopusAgileOutgoingRunDaysPreset !== undefined && config.octopusAgileOutgoingRunDaysPreset !== null && config.octopusAgileOutgoingRunDaysPreset !== '') {
    return agileDaysForPreset(normaliseAgileRunDaysPreset(config.octopusAgileOutgoingRunDaysPreset), config);
  }
  return normaliseDaysToRun(config.octopusAgileOutgoingDaysToRun, DEFAULTS.octopusAgileOutgoingDaysToRun);
}

function fluxDaysForPreset(preset, config = {}) {
  const allDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  switch (preset) {
    case 'weekdays': return ['mon', 'tue', 'wed', 'thu', 'fri'];
    case 'exceptFri': return ['mon', 'tue', 'wed', 'thu', 'sat', 'sun'];
    case 'exceptSat': return ['mon', 'tue', 'wed', 'thu', 'fri', 'sun'];
    case 'exceptSun': return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    case 'custom': {
      const pairs = [
        ['mon', 'octopusFluxRunMonday'],
        ['tue', 'octopusFluxRunTuesday'],
        ['wed', 'octopusFluxRunWednesday'],
        ['thu', 'octopusFluxRunThursday'],
        ['fri', 'octopusFluxRunFriday'],
        ['sat', 'octopusFluxRunSaturday'],
        ['sun', 'octopusFluxRunSunday']
      ];
      return pairs.filter(([, key]) => config[key] !== false).map(([day]) => day);
    }
    case 'everyday':
    default:
      return allDays;
  }
}

function resolveOctopusFluxDaysToRun(config = {}) {
  if (config.octopusFluxRunDaysPreset !== undefined && config.octopusFluxRunDaysPreset !== null && config.octopusFluxRunDaysPreset !== '') {
    return fluxDaysForPreset(normaliseFluxRunDaysPreset(config.octopusFluxRunDaysPreset), config);
  }
  return normaliseDaysToRun(config.octopusFluxDaysToRun, DEFAULTS.octopusFluxDaysToRun);
}

function gateSatisfied(config = {}) {
  const enabled = bool(config.enableApplianceControl) || bool(config.enableStage11ApplianceControl);
  const acknowledgement = String(config.applianceControlAcknowledgement || config.stage11ApplianceControlAcknowledgement || '').trim();
  return enabled && (acknowledgement === APPLIANCE_CONTROL_ACK || acknowledgement === LEGACY_APPLIANCE_CONTROL_ACK);
}

function ceAcGateSatisfied(config = {}) {
  return bool(config.enableCeAcCoupledLiveWrites) && String(config.ceAcCoupledLiveWriteAcknowledgement || '').trim() === CE_AC_ACK;
}


function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function boolAlias(config, ...keys) {
  for (const key of keys) {
    if (config[key] !== undefined) return bool(config[key]);
  }
  return false;
}

function normaliseIogHomeBatteryProtectionMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  const aliases = new Map([
    ['charge', 'charge'],
    ['chargemode', 'charge'],
    ['forcecharge', 'charge'],
    ['pause-discharge', 'pauseDischarge'],
    ['pausedischarge', 'pauseDischarge'],
    ['pause_discharge', 'pauseDischarge'],
    ['discharge', 'pauseDischarge'],
    ['pause-charge', 'pauseCharge'],
    ['pausecharge', 'pauseCharge'],
    ['pause_charge', 'pauseCharge'],
    ['pause-both', 'pauseBoth'],
    ['pauseboth', 'pauseBoth'],
    ['pause_both', 'pauseBoth'],
    ['both', 'pauseBoth']
  ]);
  return aliases.get(raw) || DEFAULTS.iogHomeBatteryProtectionMode;
}

function iogHomeBatteryProtectionModeLabel(mode) {
  switch (mode) {
    case 'pauseDischarge': return 'Pause Discharge';
    case 'pauseCharge': return 'Pause Charge';
    case 'pauseBoth': return 'Pause Both';
    case 'charge':
    default:
      return 'Charge mode';
  }
}

function iogHomeBatteryProtectionModeRegisterValue(mode) {
  switch (mode) {
    case 'pauseCharge': return 1;
    case 'pauseDischarge': return 2;
    case 'pauseBoth': return 3;
    default: return 0;
  }
}

function buildApplianceControlConfig(config = {}) {
  const master = gateSatisfied(config);
  const ceAcLive = ceAcGateSatisfied(config);
  const rawMode = String(config.batteryCareMode || DEFAULTS.batteryCareMode).toLowerCase();
  const batteryCareMode = ['gentle', 'balanced', 'strong'].includes(rawMode) ? rawMode : DEFAULTS.batteryCareMode;
  const maxBatteryChargePowerKw = numberInRange(config.maxBatteryChargePowerKw, DEFAULTS.maxBatteryChargePowerKw, 0.5, 20);
  const maxBatteryExportPowerKw = numberInRange(firstDefined(config.maxBatteryExportPowerKw, config.maxBatteryDischargePowerKw, config.maxBatteryChargePowerKw), maxBatteryChargePowerKw, 0.5, 20);
  const maxGridExportPowerKw = numberInRange(firstDefined(config.maxGridExportPowerKw, config.gridExportLimitKw, config.exportLimitKw), maxBatteryExportPowerKw, 0.5, 20);
  const legacyManualExportPercent = config.manualExportPowerPercent !== undefined
    ? intInRange(config.manualExportPowerPercent, DEFAULTS.manualExportPowerPercent, 0, 100)
    : undefined;
  const explicitTimedExportKw = firstDefined(config.timedExportPowerKw, config.manualExportPowerKw);
  const defaultTimedExportPowerKw = legacyManualExportPercent !== undefined
    ? Math.max(0.1, (maxBatteryExportPowerKw * legacyManualExportPercent) / 100)
    : maxBatteryExportPowerKw;
  const timedExportPowerKw = numberInRange(explicitTimedExportKw, defaultTimedExportPowerKw, 0.1, 20);
  const timedPercentFromKw = Math.round((Math.min(timedExportPowerKw, maxBatteryExportPowerKw) / Math.max(0.1, maxBatteryExportPowerKw)) * 100);
  const timedExportPowerPercent = intInRange(
    firstDefined(
      config.timedExportPowerPercent,
      explicitTimedExportKw !== undefined ? timedPercentFromKw : config.manualExportPowerPercent,
      timedPercentFromKw
    ),
    DEFAULTS.timedExportPowerPercent,
    1,
    100
  );
  const eveningExportPowerKw = numberInRange(firstDefined(config.eveningExportPowerKw, config.maxExportPowerKw, config.excessExportDischargeKw), DEFAULTS.eveningExportPowerKw || 5, 0.5, 12);
  const eveningExportPowerPercent = intInRange(
    firstDefined(
      config.eveningExportPowerPercent,
      Math.round((Math.min(eveningExportPowerKw, maxBatteryExportPowerKw) / Math.max(0.5, maxBatteryExportPowerKw)) * 100)
    ),
    DEFAULTS.eveningExportPowerPercent,
    1,
    100
  );
  const octopusFluxExportPowerKw = numberInRange(firstDefined(config.octopusFluxExportPowerKw, config.fluxExportPowerKw), Math.min(DEFAULTS.octopusFluxExportPowerKw, maxBatteryExportPowerKw), 0.5, 20);
  const octopusFluxExportPowerPercent = intInRange(
    firstDefined(
      config.octopusFluxExportPowerPercent,
      Math.round((Math.min(octopusFluxExportPowerKw, maxBatteryExportPowerKw) / Math.max(0.5, maxBatteryExportPowerKw)) * 100)
    ),
    100,
    1,
    100
  );
  const octopusAgileOutgoingExportPowerKw = numberInRange(firstDefined(config.octopusAgileOutgoingExportPowerKw, config.agileOutgoingExportPowerKw), Math.min(DEFAULTS.octopusAgileOutgoingExportPowerKw, maxBatteryExportPowerKw), 0.5, 20);
  const octopusAgileOutgoingExportPowerPercent = intInRange(
    firstDefined(
      config.octopusAgileOutgoingExportPowerPercent,
      Math.round((Math.min(octopusAgileOutgoingExportPowerKw, maxBatteryExportPowerKw) / Math.max(0.5, maxBatteryExportPowerKw)) * 100)
    ),
    100,
    1,
    100
  );
  const intelligentOctopusGoConfigured = bool(config.enableOctopusSmartWindows)
    && String(config.octopusApiKey || '').trim().length > 0
    && String(config.octopusAccountNumber || '').trim().length > 0;
  const iogHomeBatteryProtectionMode = normaliseIogHomeBatteryProtectionMode(config.iogHomeBatteryProtectionMode);
  const iogHomeBatteryProtectionModeText = iogHomeBatteryProtectionModeLabel(iogHomeBatteryProtectionMode);
  const iogHomeBatteryProtectionPauseValue = iogHomeBatteryProtectionModeRegisterValue(iogHomeBatteryProtectionMode);
  const octopusFluxRunDaysPreset = normaliseFluxRunDaysPreset(config.octopusFluxRunDaysPreset);
  const octopusAgileOutgoingRunDaysPreset = normaliseAgileRunDaysPreset(config.octopusAgileOutgoingRunDaysPreset);
  const octopusAgileOutgoingSlotSearchMode = normaliseAgileSlotSearchMode(config.octopusAgileOutgoingSlotSearchMode);
  const octopusAgileOutgoingExecutionStage = normaliseAgileExecutionStage(config.octopusAgileOutgoingExecutionStage);
  const octopusAgileOutgoingStrategy = normaliseAgileStrategy(config.octopusAgileOutgoingStrategy);
  const octopusAgileOutgoingLearningMode = normaliseAgileLearningMode(config.octopusAgileOutgoingLearningMode);
  const octopusAgileOutgoingDailyExportMode = normaliseAgileDailyExportMode(config.octopusAgileOutgoingDailyExportMode);
  return Object.freeze({
    stage: 'GivHome evidence IOG pause-mode integrated appliance control',
    masterGateSatisfied: master,
    automaticMutationPath: master ? 'explicit-local-appliance-control-gate' : 'absent',
    features: Object.freeze({
      chargeTiles: master && bool(config.enableTimedChargeTiles),
      exportTiles: master && bool(config.enableTimedExportTiles),
      pauseTiles: master && bool(config.enablePauseTiles),
      cheapOvernightCharging: master && (config.enableCheapOvernightCharging === undefined ? (bool(config.enableBatteryCareCharging) || bool(config.enableEvSmartWindowBatteryProtection)) : bool(config.enableCheapOvernightCharging)),
      intelligentOctopusGoConfigured: master && intelligentOctopusGoConfigured,
      octopusSmartWindows: master && intelligentOctopusGoConfigured,
      homeBatteryProtectionDuringSmartSlots: master && intelligentOctopusGoConfigured && bool(config.enableEvSmartWindowBatteryProtection),
      evBatteryProtection: master && intelligentOctopusGoConfigured && bool(config.enableEvSmartWindowBatteryProtection),
      batteryCare: master && bool(config.enableBatteryCareCharging),
      eveningExcessExport: master && boolAlias(config, 'enableEveningExcessExport', 'enableExcessEnergyExport'),
      octopusFluxExport: master && boolAlias(config, 'enableOctopusFluxExport', 'enableFluxPeakExport'),
      octopusAgileOutgoingExport: master && boolAlias(config, 'enableOctopusAgileOutgoingAutoExport', 'enableAgileOutgoingAutoExport'),
      eveHistory: master && bool(config.enableEveEnergyHistory),
      ceAcCoupledLiveWrites: master && ceAcLive
    }),
    iogHomeBatteryProtectionMode,
    iogHomeBatteryProtectionModeText,
    iogHomeBatteryProtectionPauseValue,
    targetSoc: intInRange(config.targetSoc, DEFAULTS.targetSoc, 1, 100),
    manualExportTargetSoc: intInRange(config.manualExportTargetSoc, DEFAULTS.manualExportTargetSoc, 0, 100),
    manualExportPowerPercent: timedExportPowerPercent,
    maxBatteryExportPowerKw,
    maxGridExportPowerKw,
    timedExportPowerKw,
    timedExportPowerPercent,
    cheapStart: stringOrDefault(config.cheapStart, DEFAULTS.cheapStart),
    cheapEnd: stringOrDefault(config.cheapEnd, DEFAULTS.cheapEnd),
    graceMinutes: intInRange(config.graceMinutes, DEFAULTS.graceMinutes, 0, 30),
    octopusApiKey: String(config.octopusApiKey || '').trim(),
    octopusAccountNumber: String(config.octopusAccountNumber || '').trim(),
    octopusPollSeconds: intInRange(config.octopusPollSeconds, DEFAULTS.octopusPollSeconds, 30, 1800),
    batteryCapacityKwh: numberInRange(config.batteryCapacityKwh, DEFAULTS.batteryCapacityKwh, 1, 80),
    maxBatteryChargePowerKw,
    batteryCareMode,
    batteryCareMinimumWindowMinutes: intInRange(config.batteryCareMinimumWindowMinutes, DEFAULTS.batteryCareMinimumWindowMinutes, 60, 360),
    eveningExportStartTime: stringOrDefault(firstDefined(config.eveningExportStartTime, config.excessExportStartTime, config.excessExportStart), DEFAULTS.eveningExportStartTime),
    eveningExportReserveSoc: intInRange(firstDefined(config.eveningExportReserveSoc, config.excessExportReserveSoc), DEFAULTS.eveningExportReserveSoc, 5, 95),
    eveningExportPowerKw,
    eveningExportPowerPercent,
    eveningExportSlotMinutes: intInRange(firstDefined(config.eveningExportSlotMinutes, config.excessExportSlotMinutes), DEFAULTS.eveningExportSlotMinutes, 15, 60),
    eveningExportMarginSoc: numberInRange(firstDefined(config.eveningExportMarginSoc, config.excessExportMarginSoc), DEFAULTS.eveningExportMarginSoc, 0, 20),
    octopusFluxExportStartTime: stringOrDefault(firstDefined(config.octopusFluxExportStartTime, config.fluxExportStartTime), DEFAULTS.octopusFluxExportStartTime),
    octopusFluxExportEndTime: stringOrDefault(firstDefined(config.octopusFluxExportEndTime, config.fluxExportEndTime), DEFAULTS.octopusFluxExportEndTime),
    octopusFluxReserveSoc: intInRange(firstDefined(config.octopusFluxReserveSoc, config.fluxReserveSoc), DEFAULTS.octopusFluxReserveSoc, 5, 95),
    octopusFluxEveningReserveKwh: numberInRange(firstDefined(config.octopusFluxEveningReserveKwh, config.fluxEveningReserveKwh), DEFAULTS.octopusFluxEveningReserveKwh, 0, 30),
    octopusFluxSafetyMarginSoc: numberInRange(firstDefined(config.octopusFluxSafetyMarginSoc, config.fluxSafetyMarginSoc), DEFAULTS.octopusFluxSafetyMarginSoc, 0, 30),
    octopusFluxExportPowerKw,
    octopusFluxExportPowerPercent,
    octopusFluxSlotMinutes: intInRange(firstDefined(config.octopusFluxSlotMinutes, config.fluxSlotMinutes), DEFAULTS.octopusFluxSlotMinutes, 15, 60),
    octopusFluxMinimumExportKwh: numberInRange(firstDefined(config.octopusFluxMinimumExportKwh, config.fluxMinimumExportKwh), DEFAULTS.octopusFluxMinimumExportKwh, 0.1, 10),
    octopusFluxRunDaysPreset,
    octopusFluxDaysToRun: Object.freeze(resolveOctopusFluxDaysToRun(config)),
    octopusFluxTariffImportPence: numberInRange(firstDefined(config.octopusFluxTariffImportPence, config.fluxImportPence), DEFAULTS.octopusFluxTariffImportPence, 0, 200),
    octopusFluxTariffExportPence: numberInRange(firstDefined(config.octopusFluxTariffExportPence, config.fluxExportPence), DEFAULTS.octopusFluxTariffExportPence, 0, 200),
    octopusAgileOutgoingProductCode: stringOrDefault(config.octopusAgileOutgoingProductCode, DEFAULTS.octopusAgileOutgoingProductCode),
    octopusAgileOutgoingTariffCode: String(config.octopusAgileOutgoingTariffCode || '').trim(),
    octopusAgileOutgoingRegionCode: stringOrDefault(config.octopusAgileOutgoingRegionCode, DEFAULTS.octopusAgileOutgoingRegionCode).toUpperCase(),
    octopusAgileOutgoingAllowedStartTime: stringOrDefault(config.octopusAgileOutgoingAllowedStartTime, DEFAULTS.octopusAgileOutgoingAllowedStartTime),
    octopusAgileOutgoingAllowedEndTime: stringOrDefault(config.octopusAgileOutgoingAllowedEndTime, DEFAULTS.octopusAgileOutgoingAllowedEndTime),
    octopusAgileOutgoingSlotSearchMode,
    octopusAgileOutgoingExecutionStage,
    octopusAgileOutgoingStrategy,
    octopusAgileOutgoingLearningMode,
    octopusAgileOutgoingDailyExportMode,
    octopusAgileOutgoingRunDaysPreset,
    octopusAgileOutgoingReserveSoc: intInRange(config.octopusAgileOutgoingReserveSoc, DEFAULTS.octopusAgileOutgoingReserveSoc, 5, 95),
    octopusAgileOutgoingEveningReserveKwh: numberInRange(config.octopusAgileOutgoingEveningReserveKwh, DEFAULTS.octopusAgileOutgoingEveningReserveKwh, 0, 30),
    octopusAgileOutgoingSafetyMarginSoc: numberInRange(config.octopusAgileOutgoingSafetyMarginSoc, DEFAULTS.octopusAgileOutgoingSafetyMarginSoc, 0, 30),
    octopusAgileOutgoingExportPowerKw,
    octopusAgileOutgoingExportPowerPercent,
    octopusAgileOutgoingMinimumExportKwh: numberInRange(config.octopusAgileOutgoingMinimumExportKwh, DEFAULTS.octopusAgileOutgoingMinimumExportKwh, 0.1, 10),
    octopusAgileOutgoingMinimumExportPricePence: numberInRange(config.octopusAgileOutgoingMinimumExportPricePence, DEFAULTS.octopusAgileOutgoingMinimumExportPricePence, -100, 500),
    octopusAgileOutgoingReferenceImportPence: numberInRange(config.octopusAgileOutgoingReferenceImportPence, DEFAULTS.octopusAgileOutgoingReferenceImportPence, 0, 200),
    octopusAgileOutgoingMinimumGrossMarginPence: numberInRange(config.octopusAgileOutgoingMinimumGrossMarginPence, DEFAULTS.octopusAgileOutgoingMinimumGrossMarginPence, 0, 200),
    octopusAgileOutgoingDailyExportCapKwh: numberInRange(config.octopusAgileOutgoingDailyExportCapKwh, DEFAULTS.octopusAgileOutgoingDailyExportCapKwh, 0.1, 80),
    octopusAgileOutgoingDaysToRun: Object.freeze(resolveOctopusAgileOutgoingDaysToRun(config)),
    octopusAgileOutgoingDryRun: config.octopusAgileOutgoingDryRun === undefined ? DEFAULTS.octopusAgileOutgoingDryRun : bool(config.octopusAgileOutgoingDryRun),
    octopusAgileOutgoingLiveAcknowledgement: String(config.octopusAgileOutgoingLiveAcknowledgement || '').trim(),
    octopusExportMpan: String(config.octopusExportMpan || '').replace(/\s+/g, '').trim(),
    octopusExportMeterSerial: String(config.octopusExportMeterSerial || '').replace(/\s+/g, '').trim(),
    octopusAgileOutgoingEnableMpanAudit: bool(config.octopusAgileOutgoingEnableMpanAudit),
    octopusAgileOutgoingMpanAuditDelayHours: numberInRange(config.octopusAgileOutgoingMpanAuditDelayHours, DEFAULTS.octopusAgileOutgoingMpanAuditDelayHours, 1, 96),
    octopusAgileOutgoingMpanMismatchToleranceKwh: numberInRange(config.octopusAgileOutgoingMpanMismatchToleranceKwh, DEFAULTS.octopusAgileOutgoingMpanMismatchToleranceKwh, 0.1, 10),
    octopusAgileOutgoingSuspendOnMpanMismatch: config.octopusAgileOutgoingSuspendOnMpanMismatch !== false,
    serveOvernightLoadFromBattery: bool(config.serveOvernightLoadFromBattery),
    eveHistorySampleMinutes: intInRange(config.eveHistorySampleMinutes, DEFAULTS.eveHistorySampleMinutes, 1, 60)
  });
}

function parseHmmToMinutes(text) {
  const s = String(text || '').trim();
  const hhmm = /^\d{4}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2, 4)}` : s;
  const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function isInWindowMinutes(nowMinutes, startMinutes, endMinutes) {
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function getClockWindow(now, startText, endText) {
  const startMinutes = parseHmmToMinutes(startText);
  const endMinutes = parseHmmToMinutes(endText);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const active = isInWindowMinutes(nowMinutes, startMinutes, endMinutes);
  if (startMinutes === null || endMinutes === null) return { active: false, start: null, end: null };
  const start = new Date(now);
  const end = new Date(now);
  start.setSeconds(0, 0);
  end.setSeconds(0, 0);
  start.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  end.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
  if (startMinutes > endMinutes) {
    if (nowMinutes >= startMinutes) {
      end.setDate(end.getDate() + 1);
    } else {
      start.setDate(start.getDate() - 1);
    }
  }
  return { active, start, end, startMinutes, endMinutes };
}

function ceilToHalfHour(date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  if (m === 0 || m === 30) return d;
  if (m < 30) {
    d.setMinutes(30, 0, 0);
    return d;
  }
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

function normalizeDispatches(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const start = row.start instanceof Date ? row.start : new Date(row.start || row.startDt);
    const end = row.end instanceof Date ? row.end : new Date(row.end || row.endDt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
    return { start, end };
  }).filter(Boolean).sort((a, b) => a.start - b.start);
}

function protectedDispatchEnd(dispatchEnd, graceMinutes) {
  // Intelligent Octopus Go planned dispatches are already billable/cheap windows.
  // Do not add grace to a normal planned slot end. Grace is only for early
  // termination, when an active dispatch disappears mid half-hour after the EV
  // is unplugged; that separate state is tracked as earlyTerminationGraceUntil.
  return new Date(dispatchEnd);
}

function earlyTerminationGraceEnd(now, graceMinutes) {
  const capMinutes = Math.max(0, Math.min(30, Number(graceMinutes ?? DEFAULTS.graceMinutes)));
  if (capMinutes <= 0) return new Date(now);
  const rounded = ceilToHalfHour(now);
  const max = new Date(now);
  max.setMinutes(max.getMinutes() + capMinutes, 0, 0);
  return new Date(Math.min(rounded.getTime(), max.getTime()));
}

function getMergedCheapState(now, dispatches = [], config = {}, octopusState = {}) {
  const fallback = getClockWindow(now, config.cheapStart || DEFAULTS.cheapStart, config.cheapEnd || DEFAULTS.cheapEnd);
  const graceMinutes = Number.isFinite(Number(config.graceMinutes)) ? Number(config.graceMinutes) : DEFAULTS.graceMinutes;
  const normalisedDispatches = normalizeDispatches(dispatches).map((d) => ({
    start: d.start,
    end: d.end,
    protectedEnd: protectedDispatchEnd(d.end, graceMinutes)
  }));

  const activeRawDispatches = normalisedDispatches.filter((d) => now >= d.start && now < d.end);
  const earlyGraceUntil = octopusState.earlyTerminationGraceUntil instanceof Date
    ? octopusState.earlyTerminationGraceUntil
    : (octopusState.earlyTerminationGraceUntil ? new Date(octopusState.earlyTerminationGraceUntil) : null);
  const earlyGraceActive = activeRawDispatches.length === 0
    && earlyGraceUntil instanceof Date
    && !Number.isNaN(earlyGraceUntil.getTime())
    && now < earlyGraceUntil;

  const activeSmartDispatches = activeRawDispatches;
  const dispatchActive = activeRawDispatches.length > 0;
  const graceActive = earlyGraceActive;
  const smartActive = dispatchActive || graceActive;

  const activeDispatchStart = activeSmartDispatches.length > 0
    ? new Date(Math.min(...activeSmartDispatches.map((d) => d.start.getTime())))
    : (earlyGraceActive && octopusState.earlyTerminationDispatchStart ? new Date(octopusState.earlyTerminationDispatchStart) : null);
  const activeDispatchEnd = activeSmartDispatches.length > 0
    ? new Date(Math.max(...activeSmartDispatches.map((d) => d.end.getTime())))
    : (earlyGraceActive && octopusState.earlyTerminationDispatchEnd ? new Date(octopusState.earlyTerminationDispatchEnd) : null);
  const protectedEnd = activeSmartDispatches.length > 0
    ? new Date(Math.max(...activeSmartDispatches.map((d) => d.protectedEnd.getTime())))
    : (earlyGraceActive ? earlyGraceUntil : null);

  const nextDispatch = normalisedDispatches.find((d) => d.start > now) || null;
  const ends = [fallback.active ? fallback.end : null, protectedEnd].filter((d) => d instanceof Date && !Number.isNaN(d.getTime()));
  const cheapWindowEnd = ends.length > 0 ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null;
  const cheapActive = Boolean(fallback.active || smartActive || graceActive);

  const labels = [];
  if (fallback.active) labels.push('off-peak-hours');
  if (dispatchActive) labels.push('smart-charging');
  if (graceActive) labels.push('early-termination-grace');

  return {
    cheapActive,
    smartActive,
    graceActive,
    fallbackActive: fallback.active,
    dispatchActive,
    dispatchGraceActive: graceActive,
    cheapWindowEnd,
    source: labels.length ? labels.join('+') : 'idle',
    dispatchCount: normalisedDispatches.length,
    dispatches: normalisedDispatches,
    activeDispatchStart,
    activeDispatchEnd,
    protectedEnd,
    nextDispatchStart: nextDispatch ? nextDispatch.start : null,
    nextDispatchEnd: nextDispatch ? nextDispatch.end : null,
    nextProtectedEnd: nextDispatch ? nextDispatch.protectedEnd : null
  };
}

function getBatteryCarePlan({ model, cheapState, config, now = new Date() }) {
  if (!config.features?.batteryCare) return { active: false, reason: 'disabled' };
  if (!cheapState?.fallbackActive || cheapState.smartActive || cheapState.graceActive) return { active: false, reason: 'not-main-overnight-cheap-window' };
  if (!(cheapState.cheapWindowEnd instanceof Date)) return { active: false, reason: 'cheap-window-end-unavailable' };
  const remainingMinutes = Math.max(0, Math.ceil((cheapState.cheapWindowEnd.getTime() - now.getTime()) / 60000));
  if (remainingMinutes < config.batteryCareMinimumWindowMinutes) return { active: false, reason: 'not-enough-time' };
  const soc = Number(model?.socPercent);
  if (!Number.isFinite(soc) || soc >= config.targetSoc) return { active: false, reason: 'soc-at-or-above-target' };
  const remainingHours = Math.max(remainingMinutes / 60, 0.01);
  const socGap = Math.max(0, config.targetSoc - soc);
  const energyNeededKwh = (socGap / 100) * config.batteryCapacityKwh;
  const requiredAverageKw = energyNeededKwh / remainingHours;
  const profile = {
    gentle: { reserve: 18, min: 15, max: 75 },
    balanced: { reserve: 25, min: 20, max: 90 },
    strong: { reserve: 35, min: 25, max: 100 }
  }[config.batteryCareMode] || { reserve: 25, min: 20, max: 90 };
  const rawPercent = (requiredAverageKw / config.maxBatteryChargePowerKw) * 100;
  const chargeRatePercent = Math.max(profile.min, Math.min(profile.max, Math.ceil(rawPercent + profile.reserve)));
  const estimatedChargeKw = (config.maxBatteryChargePowerKw * chargeRatePercent) / 100;
  return {
    active: true,
    remainingMinutes,
    socGap,
    energyNeededKwh,
    requiredAverageKw,
    chargeRatePercent,
    estimatedChargeKw,
    mode: config.batteryCareMode,
    batteryCapacityKwh: config.batteryCapacityKwh,
    maxBatteryChargePowerKw: config.maxBatteryChargePowerKw,
    targetSoc: config.targetSoc,
    minimumOvernightMinutes: config.batteryCareMinimumWindowMinutes
  };
}

function isCeAcCoupledSerial(serial = '') {
  const profile = classifySerialPrefix(serial);
  const normalised = String(serial || '').trim().toUpperCase();
  return profile.family === 'ac'
    || profile.family === 'ac_coupled_candidate'
    || profile.family === 'generic_ac_coupled_candidate'
    || normalised.startsWith('CE');
}

function getCommandTile(kind) {
  return COMMAND_TILES.find((tile) => tile.kind === kind) || null;
}

function renderIntegratedControlLine(appliance) {
  const f = appliance.features || {};
  return [
    'GivHome evidence integrated appliance control:',
    `masterGate=${appliance.masterGateSatisfied ? 'yes' : 'no'}`,
    `chargeTiles=${f.chargeTiles ? 'live-capable' : 'disabled'}`,
    `exportTiles=${f.exportTiles ? 'live-capable' : 'disabled'}`,
    `pauseTiles=${f.pauseTiles ? 'live-capable' : 'disabled'}`,
    `cheapOvernight=${f.cheapOvernightCharging ? 'active-user-configured-fallback-window' : 'disabled'}`,
    `intelligentOctopusGoPolling=${f.octopusSmartWindows ? 'active' : 'disabled-or-not-configured'}`,
    `homeBatteryProtectionDuringIntelligentOctopusGoSlots=${f.homeBatteryProtectionDuringSmartSlots ? 'continuous-enforcement-while-smart-or-protected-grace-active' : 'disabled-or-not-configured'}`,
    `batteryCare=${f.batteryCare ? 'active-main-overnight-only' : 'disabled'}`,
    `eveningExcessExport=${f.eveningExcessExport ? 'armed-by-homekit-switch' : 'disabled'}`,
    `octopusFluxExport=${f.octopusFluxExport ? 'armed-by-homekit-switch-peak-export' : 'disabled'}`,
    `octopusFluxDaysToRun=${Array.isArray(appliance.octopusFluxDaysToRun) ? appliance.octopusFluxDaysToRun.join(',') : 'unset'}`,
    `octopusAgileExport=${f.octopusAgileOutgoingExport ? 'armed-by-homekit-switch-agile-autopilot' : 'disabled'}`,
    `octopusAgileExecutionStage=${appliance.octopusAgileOutgoingExecutionStage || 'unset'}`,
    `octopusAgileSlotSearch=${appliance.octopusAgileOutgoingSlotSearchMode || 'unset'}`,
    `octopusAgileStrategy=${appliance.octopusAgileOutgoingStrategy || 'unset'}`,
    `octopusAgileLearningMode=${appliance.octopusAgileOutgoingLearningMode || 'unset'}`,
    `octopusAgileDailyExportMode=${appliance.octopusAgileOutgoingDailyExportMode || 'unset'}`,
    `octopusAgileDaysToRun=${Array.isArray(appliance.octopusAgileOutgoingDaysToRun) ? appliance.octopusAgileOutgoingDaysToRun.join(',') : 'unset'}`,
    `eveHistory=${f.eveHistory ? 'enabled' : 'disabled'}`,
    `modelProfileGuardrails=${f.ceAcCoupledLiveWrites ? 'ce-ac-engineering-override-enabled' : 'automatic-profile-guarded'}`,
    `exportPowerEnforcement=timed-${appliance.timedExportPowerKw}kW/evening-${appliance.eveningExportPowerKw}kW/flux-${appliance.octopusFluxExportPowerKw}kW/agile-${appliance.octopusAgileOutgoingExportPowerKw}kW/maxBattery-${appliance.maxBatteryExportPowerKw}kW/maxGrid-${appliance.maxGridExportPowerKw}kW`,
    `automaticMutationPath=${appliance.automaticMutationPath}`
  ].join(' ');
}

function safeStorageName(value) {
  return String(value || 'pending').replace(/[^a-z0-9._-]+/gi, '_');
}

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = {
  APPLIANCE_CONTROL_ACK,
  LEGACY_APPLIANCE_CONTROL_ACK,
  CE_AC_ACK,
  FEATURE_IDS,
  COMMAND_KINDS,
  COMMAND_TILES,
  DEFAULTS,
  buildApplianceControlConfig,
  normaliseIogHomeBatteryProtectionMode,
  iogHomeBatteryProtectionModeRegisterValue,
  renderIntegratedControlLine,
  parseHmmToMinutes,
  getClockWindow,
  getMergedCheapState,
  normalizeDispatches,
  ceilToHalfHour,
  protectedDispatchEnd,
  earlyTerminationGraceEnd,
  getBatteryCarePlan,
  isCeAcCoupledSerial,
  getCommandTile,
  safeStorageName,
  loadJson,
  saveJson
};
