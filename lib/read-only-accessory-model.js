'use strict';

const { ACTIVE_POWER_THRESHOLD_W, GRID_ACTIVE_POWER_THRESHOLD_W } = require('./evidence-led-constants');
const { splitGridPower, splitBatteryPower } = require('./register-authority');

/*
 * GivHome 1.0.0:
 * - HomeKit read-only energy states use the original plugin's Lightbulb model.
 * - No OccupancySensor status tiles: Apple Home renders those as occupancy/security states.
 * - Cheap Rate is available with the user-configured Cheap Overnight feature.
 * - Intelligent Octopus Go Smart Window and Grace Period tiles are exposed only when
 *   Intelligent Octopus Go is configured with API key + account number.
 */
const ACCESSORY_IDS = Object.freeze({
  BATTERY_LEVEL: 'batterySoc',
  TELEMETRY_STATUS: 'telemetryStatus',
  SOLAR_POWER: 'solarPower',
  BATTERY_CHARGING: 'charging',
  GRID_IMPORT: 'importing',
  GRID_EXPORT: 'exporting',
  BATTERY_DISCHARGING: 'discharging',
  ONLINE: 'online',
  CHEAP_RATE: 'cheapRate',
  SMART_WINDOW: 'smartWindow',
  GRACE_PERIOD: 'gracePeriod'
});

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function boolFromThreshold(value, threshold = ACTIVE_POWER_THRESHOLD_W) {
  return Number.isFinite(value) && value >= threshold;
}

function deriveTelemetryModel(decoded, now = new Date()) {
  const gridSignedPowerW = numberOrNull(decoded.gridSignedPowerW);
  const batterySignedPowerW = numberOrNull(decoded.batterySignedPowerW);
  const pvPowerW = numberOrNull(decoded.pvPowerW);

  const { gridImportPowerW, gridExportPowerW, gridRawPowerW } = splitGridPower(gridSignedPowerW);
  const { batteryChargePowerW, batteryDischargePowerW, batteryRawPowerW } = splitBatteryPower(batterySignedPowerW);

  return {
    source: decoded.source || 'IR0-60',
    lastUpdatedISO: now.toISOString(),
    socPercent: decoded.socPercent,
    pvPowerW,
    gridSignedPowerW,
    gridRawPowerW,
    gridImportPowerW,
    gridExportPowerW,
    loadPowerW: numberOrNull(decoded.loadPowerW),
    batterySignedPowerW,
    batteryRawPowerW,
    batteryChargePowerW,
    batteryDischargePowerW,
    inverterTemperatureC: numberOrNull(decoded.inverterTemperatureC),
    batteryTemperatureC: numberOrNull(decoded.batteryTemperatureC),
    telemetryOnline: true,
    active: {
      solar: boolFromThreshold(pvPowerW),
      gridImport: boolFromThreshold(gridImportPowerW, GRID_ACTIVE_POWER_THRESHOLD_W),
      gridExport: boolFromThreshold(gridExportPowerW, GRID_ACTIVE_POWER_THRESHOLD_W),
      batteryCharging: boolFromThreshold(batteryChargePowerW),
      batteryDischarging: boolFromThreshold(batteryDischargePowerW),
      online: true
    },
    counters: decoded.counters || {}
  };
}

function accessoryDefinitions(_name, options = {}) {
  const includeCheapRate = Boolean(options.includeCheapRate);
  const includeIntelligentOctopusGoTiles = Boolean(options.includeIntelligentOctopusGoTiles);
  const definitions = [
    {
      id: ACCESSORY_IDS.BATTERY_LEVEL,
      displayName: 'Battery Level',
      service: 'Lightbulb',
      subtype: 'batterySoc',
      category: 'LIGHTBULB',
      brightnessKind: 'batterySoc',
      alwaysOn: true
    },
    {
      id: ACCESSORY_IDS.TELEMETRY_STATUS,
      displayName: 'Telemetry',
      service: 'Lightbulb',
      subtype: 'telemetryStatus',
      category: 'LIGHTBULB',
      brightnessKind: 'telemetryStatus'
    },
    {
      id: ACCESSORY_IDS.SOLAR_POWER,
      displayName: 'Solar Generating',
      service: 'Lightbulb',
      subtype: 'solarPower',
      category: 'LIGHTBULB',
      brightnessKind: 'solarPower',
      powerField: 'pvPowerW'
    },
    {
      id: ACCESSORY_IDS.BATTERY_CHARGING,
      displayName: 'Battery Charging',
      service: 'Lightbulb',
      subtype: 'charging',
      category: 'LIGHTBULB',
      stateKind: 'batteryCharging',
      powerField: 'batteryChargePowerW'
    },
    {
      id: ACCESSORY_IDS.GRID_IMPORT,
      displayName: 'Grid Import',
      service: 'Lightbulb',
      subtype: 'importing',
      category: 'LIGHTBULB',
      stateKind: 'gridImport',
      powerField: 'gridImportPowerW'
    },
    {
      id: ACCESSORY_IDS.GRID_EXPORT,
      displayName: 'Grid Export',
      service: 'Lightbulb',
      subtype: 'exporting',
      category: 'LIGHTBULB',
      stateKind: 'gridExport',
      powerField: 'gridExportPowerW'
    },
    {
      id: ACCESSORY_IDS.BATTERY_DISCHARGING,
      displayName: 'Battery Discharging',
      service: 'Lightbulb',
      subtype: 'discharging',
      category: 'LIGHTBULB',
      stateKind: 'batteryDischarging',
      powerField: 'batteryDischargePowerW'
    },
    {
      id: ACCESSORY_IDS.ONLINE,
      displayName: 'Online',
      service: 'Lightbulb',
      subtype: 'online',
      category: 'LIGHTBULB',
      stateKind: 'online'
    }
  ];

  if (includeCheapRate) {
    definitions.push({
      id: ACCESSORY_IDS.CHEAP_RATE,
      displayName: 'Cheap Rate',
      service: 'Lightbulb',
      subtype: 'cheapRate',
      category: 'LIGHTBULB',
      stateKind: 'cheapRate'
    });
  }

  if (includeIntelligentOctopusGoTiles) {
    definitions.push({
      id: ACCESSORY_IDS.SMART_WINDOW,
      displayName: 'Smart Window',
      service: 'Lightbulb',
      subtype: 'smartWindow',
      category: 'LIGHTBULB',
      stateKind: 'smartWindow'
    });
    definitions.push({
      id: ACCESSORY_IDS.GRACE_PERIOD,
      displayName: 'Grace Period',
      service: 'Lightbulb',
      subtype: 'gracePeriod',
      category: 'LIGHTBULB',
      stateKind: 'gracePeriod'
    });
  }

  return definitions;
}

function batteryLevelState(model) {
  const soc = model.socPercent;
  return Number.isFinite(soc) ? clamp(Math.round(soc), 1, 99) : 1;
}

function solarBrightnessEvidence(model, maxPvKw) {
  const pv = model.pvPowerW;
  const active = Boolean(model.active && model.active.solar);
  const maxPvW = Number.isFinite(maxPvKw) && maxPvKw > 0 ? maxPvKw * 1000 : null;

  if (!Number.isFinite(pv)) {
    return {
      brightness: 1,
      source: 'pvUnavailable',
      pvPowerW: null,
      maxPvKw: Number.isFinite(maxPvKw) ? maxPvKw : null,
      maxPvConfigured: Boolean(maxPvW),
      active
    };
  }

  if (maxPvW) {
    const rawPercent = Math.round((Math.max(0, pv) / maxPvW) * 100);
    return {
      brightness: active ? clamp(rawPercent, 1, 99) : 1,
      source: 'scaled',
      pvPowerW: pv,
      maxPvKw,
      maxPvConfigured: true,
      rawPercent,
      active
    };
  }

  return {
    brightness: active ? 1 : 1,
    source: active ? 'maxPvMissingActiveHeldAtOne' : 'maxPvMissingInactiveHeldAtOne',
    pvPowerW: pv,
    maxPvKw: null,
    maxPvConfigured: false,
    rawPercent: null,
    active
  };
}

function solarBrightnessState(model, maxPvKw) {
  return solarBrightnessEvidence(model, maxPvKw).brightness;
}

function telemetryBrightnessState(health) {
  if (!health || health.state === 'online') return 100;
  if (health.state === 'retrying') return 50;
  return 1;
}

module.exports = {
  ACCESSORY_IDS,
  accessoryDefinitions,
  batteryLevelState,
  deriveTelemetryModel,
  solarBrightnessEvidence,
  solarBrightnessState,
  telemetryBrightnessState
};
