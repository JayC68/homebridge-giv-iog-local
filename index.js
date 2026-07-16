'use strict';

const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

let fakeGatoHistoryModule = null;
try {
  fakeGatoHistoryModule = require('fakegato-history');
} catch {
  fakeGatoHistoryModule = null;
}

const PLUGIN_NAME = 'homebridge-giv-iog-local';
const PLATFORM_NAME = 'GivEnergy Local + Intelligent Octopus Go';
const BUILD_VERSION = '3.7.5';

module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, GivTcpMqttPlatform);
};

class GivTcpMqttPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;

    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.Categories = this.api.hap.Categories;
    this.uuid = this.api.hap.uuid;

    this.EveEnergyCharacteristic = this.createEveEnergyCharacteristics();
    this.FakeGatoHistoryService = null;
    this._warnedMissingFakeGato = false;
    if (fakeGatoHistoryModule) {
      try {
        this.FakeGatoHistoryService = fakeGatoHistoryModule(this.api);
      } catch (err) {
        try {
          this.FakeGatoHistoryService = fakeGatoHistoryModule;
        } catch {
          this.log.warn(`Eve history support could not initialise: ${err.message}`);
        }
      }
    }

    this.platformName = this.config.name || 'GivHome';

    this.mqttUrl = this.config.mqttUrl || 'mqtt://127.0.0.1:1884';
    this.mqttUsername = this.config.mqttUsername || '';
    this.mqttPassword = this.config.mqttPassword || '';
    this.mqttRootTopic = (this.config.mqttRootTopic || 'GivEnergy').replace(/\/+$/, '');
    this.givTcpRestUrl = (this.config.givTcpRestUrl || 'http://127.0.0.1:6345').replace(/\/+$/, '');
    this.inverterSerial = (this.config.inverterSerial || '').trim();
    this.inverterIp = (this.config.inverterIp || '').trim();
    this.activeSerial = this.inverterSerial || null;

    this.octopusApiKey = (this.config.octopusApiKey || '').trim();
    this.octopusAccountNumber = (this.config.octopusAccountNumber || '').trim();
    this.octopusPollSeconds = Number.isFinite(this.config.octopusPollSeconds)
      ? this.config.octopusPollSeconds
      : 120;

    this.cheapStart = this.config.cheapStart || '23:30';
    this.cheapEnd = this.config.cheapEnd || '05:30';
    this.graceMinutes = Number.isFinite(this.config.graceMinutes) ? this.config.graceMinutes : 30;
    this.targetSoc = Number.isFinite(this.config.targetSoc) ? this.config.targetSoc : 100;

    this.smoothChargingEnabled = Boolean(this.config.smoothChargingEnabled);
    this.maxBatteryChargePowerKw = Number.isFinite(this.config.maxBatteryChargePowerKw) && this.config.maxBatteryChargePowerKw > 0
      ? this.config.maxBatteryChargePowerKw
      : null;
    this.smoothChargingMode = ['gentle', 'balanced', 'strong'].includes(String(this.config.smoothChargingMode || '').toLowerCase())
      ? String(this.config.smoothChargingMode).toLowerCase()
      : 'balanced';
    this.smoothChargingWindowMinimumMinutes = Number.isFinite(this.config.smoothChargingWindowMinimumMinutes)
      ? this.clamp(Math.round(this.config.smoothChargingWindowMinimumMinutes), 60, 360)
      : 90;
    this.smoothChargingUpdateIntervalMinutes = 15;
    this.smoothChargeTimers = [];
    this.lastSmoothChargePlanSignature = '';
    this.lastSmoothChargeClearSignature = '';
    this.lastSmoothChargeRatePercent = null;

    this.maxPvKw = Number.isFinite(this.config.maxPvKw) && this.config.maxPvKw > 0
      ? this.config.maxPvKw
      : null;
    this.hasSolarPv = Number.isFinite(this.maxPvKw) && this.maxPvKw > 0;

    // Preserve existing HomeKit names. Recommended names are applied only to newly created accessories.

    this.manualSmartWindows = this.parseSmartWindows(this.config.smartWindowsJson || '[]');

    this.slotToleranceMinutes = Number.isFinite(this.config.slotToleranceMinutes) ? this.config.slotToleranceMinutes : 5;

    this.manualDurations = {
      forceCharge: [30, 60, 90, 120],
      forceExport: [30, 60, 90, 120],
    };

    const legacyPowerActiveThreshold = Number.isFinite(this.config.powerActiveThreshold) ? this.config.powerActiveThreshold : null;
    this.chargePowerActiveThreshold = Number.isFinite(this.config.chargePowerActiveThreshold)
      ? this.config.chargePowerActiveThreshold
      : (legacyPowerActiveThreshold ?? 100);
    this.dischargePowerActiveThreshold = Number.isFinite(this.config.dischargePowerActiveThreshold)
      ? this.config.dischargePowerActiveThreshold
      : (legacyPowerActiveThreshold ?? 100);
    this.importPowerActiveThreshold = Number.isFinite(this.config.importPowerActiveThreshold)
      ? this.config.importPowerActiveThreshold
      : (legacyPowerActiveThreshold ?? 50);
    this.exportPowerActiveThreshold = Number.isFinite(this.config.exportPowerActiveThreshold)
      ? this.config.exportPowerActiveThreshold
      : (legacyPowerActiveThreshold ?? 50);
    this.staleSeconds = Number.isFinite(this.config.staleSeconds) ? this.config.staleSeconds : 180;

    // Passive telemetry freshness guard. This does not poll the inverter and does not add Modbus traffic.
    // It only watches the freshness timestamp already published by GivTCP/MQTT.
    this.enableTelemetryFreshnessGuard = this.config.enableTelemetryFreshnessGuard !== false;
    this.telemetryFreshSeconds = Number.isFinite(this.config.telemetryFreshSeconds)
      ? this.clamp(Math.round(this.config.telemetryFreshSeconds), 30, 3600)
      : 180;
    this.telemetryOfflineSeconds = Number.isFinite(this.config.telemetryOfflineSeconds)
      ? this.clamp(Math.round(this.config.telemetryOfflineSeconds), this.telemetryFreshSeconds + 30, 7200)
      : 600;
    this.lastTelemetryFreshnessSignature = '';
    this.lastTelemetryFreshnessStateSignature = '';
    this.lastTelemetryAutomationBlockSignature = '';
    this.lastEveEnergyHistorySkipSignature = '';

    // Optional host-side GivTCP self-recovery. Disabled by default because restarting a
    // Docker container requires an explicitly installed, narrowly-scoped sudo rule.
    // Recovery never writes to the inverter and automation remains blocked until fresh
    // Stats.Last_Updated_Time telemetry has been observed after the restart.
    this.enableGivTcpSelfRecovery = Boolean(this.config.enableGivTcpSelfRecovery);
    this.givTcpRecoveryStaleSeconds = Number.isFinite(this.config.givTcpRecoveryStaleSeconds)
      ? this.clamp(Math.round(this.config.givTcpRecoveryStaleSeconds), 600, 86400)
      : 900;
    this.givTcpRecoveryCooldownSeconds = Number.isFinite(this.config.givTcpRecoveryCooldownSeconds)
      ? this.clamp(Math.round(this.config.givTcpRecoveryCooldownSeconds), 1800, 86400)
      : 21600;
    this.givTcpRecoveryCommand = String(this.config.givTcpRecoveryCommand || '/usr/local/sbin/givhome-restart-givtcp').trim();
    this.givTcpRecoveryInProgress = false;
    this.givTcpRecoveryAwaitingFreshTelemetry = false;
    this.givTcpRecoveryStartedAtMs = 0;
    this.givTcpRecoveryLastAttemptMs = 0;
    this.givTcpRecoveryLastSourceTimestampMs = null;
    this.givTcpRecoveryLastLogSignature = '';

    // Gentle post-write verification for timed Charge/Export lifecycle transitions.
    // This reads GivTCP's existing REST cache only after command writes; it does not poll the inverter.
    this.enableWriteVerification = this.config.enableWriteVerification !== false;
    this.writeVerificationDelaySeconds = Number.isFinite(this.config.writeVerificationDelaySeconds)
      ? this.clamp(Math.round(this.config.writeVerificationDelaySeconds), 2, 60)
      : 8;
    // Start verification is deliberately patient: users trigger Charge/Export because they need energy or space.
    // Cleanup verification remains stricter because persistent schedules are dangerous.
    this.writeVerificationStartRetries = Number.isFinite(this.config.writeVerificationStartRetries)
      ? this.clamp(Math.round(this.config.writeVerificationStartRetries), 1, 12)
      : 10;
    this.writeVerificationClearRetries = Number.isFinite(this.config.writeVerificationClearRetries)
      ? this.clamp(Math.round(this.config.writeVerificationClearRetries), 1, 6)
      : (Number.isFinite(this.config.writeVerificationRetries) ? this.clamp(Math.round(this.config.writeVerificationRetries), 1, 6) : 3);
    this.writeVerificationRetries = this.writeVerificationClearRetries;

    // CE / AC-coupled systems have a single user-owned core charge schedule.
    // When GivHome temporarily uses charge slot 1 for Octopus/manual charging,
    // it reads and remembers the existing slot before writing, then reinstates it afterwards.
    this.ceChargeSlotMemory = null;
    this.lastCeChargeSlotLogSignature = '';

    this.enableEveEnergyHistory = Boolean(this.config.enableEveEnergyHistory);

    this.enableExcessEnergyExport = Boolean(this.config.enableExcessEnergyExport);
    this.eveningExcessExportArmed = this.enableExcessEnergyExport;
    this.excessExportBatteryCapacityKwh = Number.isFinite(this.config.batteryCapacityKwh) && this.config.batteryCapacityKwh > 0
      ? this.config.batteryCapacityKwh
      : null;
    this.excessExportStart = this.config.excessExportStartTime || this.config.excessExportStart || '19:30';
    this.excessExportReserveSoc = Number.isFinite(this.config.excessExportReserveSoc)
      ? this.clamp(this.config.excessExportReserveSoc, 5, 95)
      : 20;
    this.excessExportDischargeKw = Number.isFinite(this.config.maxExportPowerKw) && this.config.maxExportPowerKw > 0
      ? this.config.maxExportPowerKw
      : (Number.isFinite(this.config.excessExportDischargeKw) && this.config.excessExportDischargeKw > 0 ? this.config.excessExportDischargeKw : 5);
    this.normalDischargePowerW = Number.isFinite(this.config.normalDischargePowerW) && this.config.normalDischargePowerW > 0
      ? this.clamp(Math.round(this.config.normalDischargePowerW), 1, 12000)
      : 0;
    this.excessExportSlotMinutes = Number.isFinite(this.config.excessExportSlotMinutes)
      ? this.clamp(Math.round(this.config.excessExportSlotMinutes), 15, 60)
      : 30;
    this.excessExportTriggerMarginSoc = Number.isFinite(this.config.excessExportMarginSoc)
      ? this.clamp(this.config.excessExportMarginSoc, 0, 20)
      : (Number.isFinite(this.config.excessExportTriggerMarginSoc) ? this.clamp(this.config.excessExportTriggerMarginSoc, 0, 20) : 2);
    this.serveOvernightLoadFromBattery = Boolean(this.config.serveOvernightLoadFromBattery);
    this.excessEnergyExportActive = false;
    this.activeExcessExportSlot = null;
    this.lastExcessExportDecisionSignature = '';
    this.lastExcessExportDecisionLogMs = 0;

    this.eveEnergyHistoryServices = new Map();
    this.lastEveEnergyHistoryEntryMs = 0;
    this.eveEnergyHistorySampleMinutes = 5;
    // Five years of five-minute Eve Energy history samples. Long-term seasonal comparison is core to this feature.
    this.eveEnergyHistorySize = 12 * 24 * 365 * 5;
    this.eveEnergyRuntimeTotalsKwh = new Map();
    this.eveEnergyRuntimeTotalUpdatedMs = 0;

    this.accessories = new Map();
    this.client = null;

    this.state = {
      paths: new Map(),
      leaves: new Map(),
      updatedAt: 0,
    };

    this.commandStates = {};

    this.commandTimers = new Map();
    this.manualCleanupTimers = new Map();
    this.smoothChargeTimers = this.smoothChargeTimers || [];
    this.manualQueue = Promise.resolve();
    this.automationQueue = Promise.resolve();

    this.octopus = {
      token: null,
      tokenRetrievedAt: 0,
      lastPollMs: 0,
      lastPollOk: false,
      lastError: null,
      dispatches: [],
      polling: false,
      lastDispatchEnd: null,
      lastCheapUntil: null,
    };

    this.lastAutomationSignature = '';
    this.lastStatusSignature = '';

    if (this.enableExcessEnergyExport) {
      if (this.excessExportBatteryCapacityKwh) {
        this.log.info(`Evening Excess Export enabled | strategy=evening-sell-off | start=${this.excessExportStart} | cheapStart=${this.cheapStart} | reserve=${this.excessExportReserveSoc}% | battery=${this.excessExportBatteryCapacityKwh}kWh | discharge=${this.excessExportDischargeKw}kW | slot=${this.excessExportSlotMinutes}m | serveOvernightLoadFromBattery=${this.serveOvernightLoadFromBattery}`);
      } else {
        this.log.warn('Evening Excess Export configured but Battery Size Used for Planning is missing or invalid; automation will stay idle.');
      }
    } else {
      this.log.info('Evening Excess Export disabled');
    }

    this.coreObservationKinds = [
      'smartWindow',
      'charging',
      'importing',
      'exporting',
    ];

    this.advancedTelemetryKinds = [
      'cheapRate',
      'gracePeriod',
      'discharging',
      'online',
    ];

    this.exposeAdvancedTelemetry = Boolean(this.config.exposeAdvancedTelemetry);
    this.observationKinds = [
      ...this.coreObservationKinds,
      ...(this.exposeAdvancedTelemetry ? this.advancedTelemetryKinds : []),
    ];

    this.eveEnergyHistoryKinds = [
      'solarEnergyHistory',
      'gridImportEnergyHistory',
      'gridExportEnergyHistory',
    ];

    this.switchKinds = [
      'forceCharge',
      'forceCharge30',
      'forceCharge90',
      'forceCharge120',
      'forceExport',
      'forceExport30',
      'forceExport90',
      'forceExport120',
      'eveningExcessExport',
    ];

    this.loadEveEnergyRuntimeTotals();

    this.api.on('didFinishLaunching', () => {
      this.validateSetupConfig();
      if (this.activeSerial) {
        this.ensureAccessories();
      }

      this.startLoops();
      this.connectMqtt();
      this.maybePollOctopus(true).catch((err) => {
        this.log.warn(`Initial Octopus poll failed: ${err.message}`);
      });
    });
  }


  createEveEnergyCharacteristics() {
    const Characteristic = this.Characteristic;
    const inherited = require('util').inherits;

    const Consumption = function () {
      Characteristic.call(this, 'Consumption', 'E863F10D-079E-48FF-8F27-9C2605A29F52');
      this.setProps({
        format: Characteristic.Formats.FLOAT,
        unit: 'W',
        minValue: 0,
        perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    inherited(Consumption, Characteristic);
    Consumption.UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52';

    const TotalConsumption = function () {
      Characteristic.call(this, 'Total Consumption', 'E863F10C-079E-48FF-8F27-9C2605A29F52');
      this.setProps({
        format: Characteristic.Formats.FLOAT,
        unit: 'kWh',
        minValue: 0,
        perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    inherited(TotalConsumption, Characteristic);
    TotalConsumption.UUID = 'E863F10C-079E-48FF-8F27-9C2605A29F52';

    const Voltage = function () {
      Characteristic.call(this, 'Voltage', 'E863F10A-079E-48FF-8F27-9C2605A29F52');
      this.setProps({
        format: Characteristic.Formats.FLOAT,
        unit: 'V',
        minValue: 0,
        perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    inherited(Voltage, Characteristic);
    Voltage.UUID = 'E863F10A-079E-48FF-8F27-9C2605A29F52';

    const Current = function () {
      Characteristic.call(this, 'Current', 'E863F126-079E-48FF-8F27-9C2605A29F52');
      this.setProps({
        format: Characteristic.Formats.FLOAT,
        unit: 'A',
        minValue: 0,
        perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    inherited(Current, Characteristic);
    Current.UUID = 'E863F126-079E-48FF-8F27-9C2605A29F52';

    const ResetTotal = function () {
      Characteristic.call(this, 'Reset Total', 'E863F112-079E-48FF-8F27-9C2605A29F52');
      this.setProps({
        format: Characteristic.Formats.UINT32,
        minValue: 0,
        perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    };
    inherited(ResetTotal, Characteristic);
    ResetTotal.UUID = 'E863F112-079E-48FF-8F27-9C2605A29F52';

    return { Consumption, TotalConsumption, Voltage, Current, ResetTotal };
  }

  validateSetupConfig() {
    const warnings = [];

    if (!this.inverterSerial) {
      warnings.push('Battery Serial Number is missing. Add it in GivHome settings.');
    } else if (!/^([A-Z]{2}\d{4}[A-Z]\d{3}|[A-Z0-9]{6,20})$/.test(this.inverterSerial)) {
      warnings.push(`Battery Serial Number "${this.inverterSerial}" does not look like a normal GivEnergy serial. Check the value from Settings → Local Monitoring → Scan for your inverter.`);
    }

    if (!this.inverterIp) {
      warnings.push('Inverter IP Address is missing. Existing upgraded systems may continue if GivTCP is already configured, but golden-image/new appliance setup requires it.');
    } else if (!/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(this.inverterIp)) {
      warnings.push(`Inverter IP Address "${this.inverterIp}" is not a valid IPv4 address.`);
    }

    for (const [key, value] of [['cheapStart', this.cheapStart], ['cheapEnd', this.cheapEnd]]) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''))) {
        warnings.push(`${key} should be in HH:MM 24-hour format, for example 23:30.`);
      }
    }

    if (this.mqttUrl === 'mqtt://127.0.0.1:1883') {
      warnings.push('MQTT URL is set to 127.0.0.1:1883. The standard GivHome appliance image normally uses mqtt://127.0.0.1:1884.');
    }

    if (this.smoothChargingEnabled && !this.maxBatteryChargePowerKw) {
      warnings.push('Smooth Charging is enabled but Maximum Battery Charge Power (kW) is missing or invalid. Smooth Charging will stay disabled until this is set.');
    }

    for (const warning of warnings) {
      this.log.warn(`Setup warning: ${warning}`);
    }
  }

  configureAccessory(accessory) {
    if (accessory?.context?.kind) {
      this.accessories.set(accessory.context.kind, accessory);
    }
  }

  startLoops() {
    setInterval(() => {
      this.refreshAccessories();
      this.maybeRecoverStaleGivTcp().catch((err) => {
        this.log.warn(`[Telemetry Recovery] unexpected recovery error: ${err.message}`);
      });
      this.applyAutomation();
    }, 30_000);

    setInterval(() => {
      this.recordEveEnergyHistory();
    }, Math.max(1, this.eveEnergyHistorySampleMinutes) * 60_000);

    setTimeout(() => {
      this.recordEveEnergyHistory(true);
    }, 20_000);

    setInterval(() => {
      this.maybePollOctopus(false).catch((err) => {
        this.log.warn(`Octopus poll error: ${err.message}`);
      });
    }, 30_000);
  }

  connectMqtt() {
    const options = {
      username: this.mqttUsername || undefined,
      password: this.mqttPassword || undefined,
      reconnectPeriod: 5_000,
      clientId: `homebridge-giv-iog-local-${Math.random().toString(16).slice(2, 10)}`,
    };

    this.client = mqtt.connect(this.mqttUrl, options);

    this.client.on('connect', () => {
      this.log.info(`Connected to MQTT broker at ${this.mqttUrl}`);
      this.client.subscribe(`${this.mqttRootTopic}/#`, (err) => {
        if (err) {
          this.log.error(`MQTT subscribe failed: ${err.message}`);
        }
      });
    });

    this.client.on('message', (topic, payload) => {
      this.handleMqttMessage(topic, payload);
    });

    this.client.on('error', (err) => {
      this.log.error(`MQTT error: ${err.message}`);
    });

    this.client.on('reconnect', () => {
      this.log.warn('MQTT reconnecting…');
    });

    this.client.on('close', () => {
      this.log.warn('MQTT connection closed');
    });
  }

  handleMqttMessage(topic, payloadBuffer) {
    if (!topic.startsWith(`${this.mqttRootTopic}/`)) {
      return;
    }

    const relative = topic.slice(this.mqttRootTopic.length + 1);
    if (relative.startsWith('control/')) {
      return;
    }

    const parts = relative.split('/');
    const serial = parts.shift();
    if (!serial) {
      return;
    }

    if (this.inverterSerial && serial !== this.inverterSerial) {
      return;
    }

    if (!this.activeSerial) {
      this.activeSerial = serial;
      this.log.info(`Discovered inverter serial ${serial}`);
      this.ensureAccessories();
    }

    if (serial !== this.activeSerial) {
      return;
    }

    const path = parts.join('/');
    const value = this.parsePayload(payloadBuffer.toString().trim());
    this.setState(path, value);

    this.refreshAccessories();
    this.applyAutomation();
  }

  parsePayload(text) {
    if (text === '') {
      return '';
    }

    if (text === 'true') {
      return true;
    }

    if (text === 'false') {
      return false;
    }

    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    const numeric = Number(text);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }

    return text;
  }

  setState(path, value) {
    this.state.paths.set(path, value);

    const leaf = path.split('/').pop();
    if (!this.state.leaves.has(leaf) || this.isPreferredLeafPath(path)) {
      this.state.leaves.set(leaf, value);
    }

    this.state.updatedAt = Date.now();
  }

  isPreferredLeafPath(path) {
    return !path.startsWith('Battery_Details/')
      && !path.startsWith('raw/');
  }

  parseSmartWindows(jsonText) {
    try {
      const parsed = JSON.parse(jsonText || '[]');
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((entry) => ({ start: entry.start, end: entry.end }))
        .filter((entry) => entry.start && entry.end);
    } catch (err) {
      this.log.warn(`Invalid smartWindowsJson, using []: ${err.message}`);
      return [];
    }
  }

  desiredKinds() {
    return new Set([
      'batterySoc',
      'telemetryStatus',
      ...(this.hasSolarPv ? ['solarPower'] : []),
      ...this.coreObservationKinds,
      ...(this.exposeAdvancedTelemetry ? this.advancedTelemetryKinds : []),
      ...(this.enableEveEnergyHistory ? this.getDesiredEveEnergyHistoryKinds() : []),
      ...this.switchKinds,
    ]);
  }

  getDesiredEveEnergyHistoryKinds() {
    return [
      ...(this.hasSolarPv ? ['solarEnergyHistory'] : []),
      'gridImportEnergyHistory',
      'gridExportEnergyHistory',
    ];
  }

  getEveEnergyHistoryMeta(kind) {
    const meta = {
      solarEnergyHistory: {
        displayName: 'Eve Solar History',
        legacyDisplayNames: [`${this.platformName} Solar Generated`],
        valueKey: 'pvPower',
        description: 'Eve solar history',
      },
      gridImportEnergyHistory: {
        displayName: 'Eve Import History',
        legacyDisplayNames: [`${this.platformName} Grid Import History`],
        valueKey: 'importPower',
        description: 'Eve import history',
      },
      gridExportEnergyHistory: {
        displayName: 'Eve Export History',
        legacyDisplayNames: [`${this.platformName} Grid Export History`],
        valueKey: 'exportPower',
        description: 'Eve export history',
      },
    };

    return meta[kind] || null;
  }

  getManualSwitchMeta(kind) {
    if (kind === 'forceCharge') {
      return { family: 'forceCharge', slotKind: 'charge', minutes: 60, displayAction: 'Charge' };
    }

    if (kind === 'forceExport') {
      return { family: 'forceExport', slotKind: 'discharge', minutes: 60, displayAction: 'Export' };
    }

    let match = kind.match(/^forceCharge(30|90|120)$/);
    if (match) {
      return { family: 'forceCharge', slotKind: 'charge', minutes: Number(match[1]), displayAction: 'Charge' };
    }

    match = kind.match(/^forceExport(30|90|120)$/);
    if (match) {
      return { family: 'forceExport', slotKind: 'discharge', minutes: Number(match[1]), displayAction: 'Export' };
    }

    return null;
  }

  ensureAccessories() {
    const serial = this.activeSerial || this.inverterSerial || 'pending';

    this.ensureAccessory('batterySoc', `${this.platformName} Battery Level`, this.Categories.WINDOW_COVERING);
    this.ensureAccessory('telemetryStatus', `${this.platformName} Telemetry`, this.Categories.LIGHTBULB);
    if (this.hasSolarPv) {
      this.ensureAccessory('solarPower', `${this.platformName} Solar Generating`, this.Categories.LIGHTBULB);
    }

    this.ensureAccessory('smartWindow', `${this.platformName} Smart Window`, this.Categories.LIGHTBULB);
    this.ensureAccessory('charging', `${this.platformName} Battery Charging`, this.Categories.LIGHTBULB);
    this.ensureAccessory('importing', `${this.platformName} Grid Import`, this.Categories.LIGHTBULB);
    this.ensureAccessory('exporting', `${this.platformName} Grid Export`, this.Categories.LIGHTBULB);

    if (this.exposeAdvancedTelemetry) {
      this.ensureAccessory('cheapRate', `${this.platformName} Cheap Rate`, this.Categories.LIGHTBULB);
      this.ensureAccessory('gracePeriod', `${this.platformName} Grace Period`, this.Categories.LIGHTBULB);
      this.ensureAccessory('discharging', `${this.platformName} Battery Discharging`, this.Categories.LIGHTBULB);
      this.ensureAccessory('online', `${this.platformName} Online`, this.Categories.LIGHTBULB);
    }

    if (this.enableEveEnergyHistory) {
      for (const kind of this.getDesiredEveEnergyHistoryKinds()) {
        const meta = this.getEveEnergyHistoryMeta(kind);
        if (meta) {
          this.ensureAccessory(kind, meta.displayName, this.Categories.OUTLET || this.Categories.SWITCH);
        }
      }
    }

    this.ensureAccessory('forceCharge', 'Charge 60m', this.Categories.SWITCH);
    this.ensureAccessory('forceCharge30', 'Charge 30m', this.Categories.SWITCH);
    this.ensureAccessory('forceCharge90', 'Charge 90m', this.Categories.SWITCH);
    this.ensureAccessory('forceCharge120', 'Charge 120m', this.Categories.SWITCH);

    this.ensureAccessory('forceExport', 'Export 60m', this.Categories.SWITCH);
    this.ensureAccessory('forceExport30', 'Export 30m', this.Categories.SWITCH);
    this.ensureAccessory('forceExport90', 'Export 90m', this.Categories.SWITCH);
    this.ensureAccessory('forceExport120', 'Export 120m', this.Categories.SWITCH);

    this.ensureAccessory('eveningExcessExport', `${this.platformName} Evening Excess Export`, this.Categories.SWITCH);

    this.cleanupStaleAccessories(serial);

    this.log.info(`Accessories ready for ${serial}`);
  }

  cleanupStaleAccessories(serial) {
    const keep = this.desiredKinds();
    const stale = [];

    for (const [kind, accessory] of this.accessories.entries()) {
      if (accessory?.context?.serial !== serial) {
        continue;
      }
      if (!keep.has(kind)) {
        stale.push(accessory);
        this.accessories.delete(kind);
      }
    }

    if (stale.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      this.log.info(`Removed ${stale.length} stale accessory cache entries`);
    }
  }

  ensureAccessory(kind, displayName, category) {
    const serial = this.activeSerial || this.inverterSerial || 'pending';
    const uuid = this.uuid.generate(`${PLUGIN_NAME}:${serial}:${kind}`);

    let accessory = this.accessories.get(kind);
    let isNew = false;

    if (!accessory) {
      accessory = new this.api.platformAccessory(displayName, uuid, category);
      accessory.context.kind = kind;
      accessory.context.serial = serial;
      isNew = true;
    }

    const shouldApplyName = isNew;
    if (shouldApplyName) {
      accessory.displayName = displayName;
    }
    accessory.context.kind = kind;
    accessory.context.serial = serial;

    this.configureAccessoryServices(accessory, kind, displayName, shouldApplyName);

    this.accessories.set(kind, accessory);

    if (isNew) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  configureAccessoryServices(accessory, kind, displayName, shouldApplyName = false) {
    const info = accessory.getService(this.Service.AccessoryInformation)
      || accessory.addService(this.Service.AccessoryInformation);

    const baseSerial = this.activeSerial || this.inverterSerial || 'pending';
    const accessorySerial = this.eveEnergyHistoryKinds.includes(kind)
      ? `${baseSerial}-${kind}`
      : baseSerial;

    info.setCharacteristic(this.Characteristic.Manufacturer, 'JayC68 Vibed')
      .setCharacteristic(this.Characteristic.Model, 'GivTCP MQTT + Octopus')
      .setCharacteristic(this.Characteristic.SerialNumber, accessorySerial)
      .setCharacteristic(this.Characteristic.FirmwareRevision, BUILD_VERSION);

    if (kind === 'batterySoc') {
      const legacy = accessory.getServiceById(this.Service.WindowCovering, 'batterySoc');
      if (legacy) {
        accessory.removeService(legacy);
      }

      const service = accessory.getServiceById(this.Service.Lightbulb, 'batterySoc')
        || accessory.addService(this.Service.Lightbulb, displayName, 'batterySoc');
      if (shouldApplyName) {
        service.setCharacteristic(this.Characteristic.Name, displayName);
      }

      service.getCharacteristic(this.Characteristic.On)
        .onGet(() => true)
        .onSet(async () => {});

      service.getCharacteristic(this.Characteristic.Brightness)
        .onGet(() => this.getBatteryBrightness())
        .onSet(async () => {});

      return;
    }

    if (kind === 'telemetryStatus') {
      const service = accessory.getServiceById(this.Service.Lightbulb, 'telemetryStatus')
        || accessory.addService(this.Service.Lightbulb, displayName, 'telemetryStatus');
      if (shouldApplyName) {
        service.setCharacteristic(this.Characteristic.Name, displayName);
      }

      service.getCharacteristic(this.Characteristic.On)
        .onGet(() => this.getTelemetryStatus().safeForAutomation)
        .onSet(async () => {});

      service.getCharacteristic(this.Characteristic.Brightness)
        .onGet(() => this.getTelemetryStatusBrightness())
        .onSet(async () => {});

      return;
    }

    if (kind === 'solarPower') {
      const service = accessory.getServiceById(this.Service.Lightbulb, 'solarPower')
        || accessory.addService(this.Service.Lightbulb, displayName, 'solarPower');
      if (shouldApplyName) {
        service.setCharacteristic(this.Characteristic.Name, displayName);
      }

      service.getCharacteristic(this.Characteristic.On)
        .onGet(() => this.getSolarBrightness() > 0)
        .onSet(async () => {});

      service.getCharacteristic(this.Characteristic.Brightness)
        .onGet(() => this.getSolarBrightness())
        .onSet(async () => {});

      return;
    }

    if (this.observationKinds.includes(kind)) {
      const legacyOccupancy = accessory.getServiceById(this.Service.OccupancySensor, kind);
      if (legacyOccupancy) {
        accessory.removeService(legacyOccupancy);
      }

      const service = accessory.getServiceById(this.Service.Lightbulb, kind)
        || accessory.addService(this.Service.Lightbulb, displayName, kind);
      if (shouldApplyName) {
        service.setCharacteristic(this.Characteristic.Name, displayName);
      }

      service.getCharacteristic(this.Characteristic.On)
        .onGet(() => this.getObservationState(kind))
        .onSet(async () => {});

      return;
    }

    if (this.eveEnergyHistoryKinds.includes(kind)) {
      this.configureEveEnergyHistoryAccessory(accessory, kind, displayName, shouldApplyName);
      return;
    }

    if (this.switchKinds.includes(kind)) {
      const service = accessory.getServiceById(this.Service.Switch, kind)
        || accessory.addService(this.Service.Switch, displayName, kind);
      if (shouldApplyName) {
        service.setCharacteristic(this.Characteristic.Name, displayName);
      }

      service.getCharacteristic(this.Characteristic.On)
        .onGet(() => this.getSwitchState(kind))
        .onSet(async (value) => {
          await this.handleSwitchSet(kind, Boolean(value));
        });
    }
  }

  getStoragePath() {
    try {
      if (this.api?.user && typeof this.api.user.storagePath === 'function') {
        return this.api.user.storagePath();
      }
    } catch {
      // Fall through to process.cwd().
    }
    return process.cwd();
  }

  getEveEnergyTotalsStatePath() {
    const serial = String(this.activeSerial || this.inverterSerial || 'pending').replace(/[^a-z0-9._-]+/gi, '_');
    return path.join(this.getStoragePath(), `givhome_${serial}_eve_energy_totals.json`);
  }

  loadEveEnergyRuntimeTotals() {
    if (!this.enableEveEnergyHistory) {
      return;
    }

    const loaded = {};
    const statePath = this.getEveEnergyTotalsStatePath();

    try {
      if (fs.existsSync(statePath)) {
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        const totals = parsed?.totals && typeof parsed.totals === 'object' ? parsed.totals : {};
        for (const [kind, value] of Object.entries(totals)) {
          const numeric = Number(value);
          if (Number.isFinite(numeric) && numeric >= 0) {
            loaded[kind] = numeric;
          }
        }
      }
    } catch (err) {
      this.log.warn(`[EveHistory] could not load cumulative totals state: ${err.message}`);
    }

    const recovered = this.recoverEveEnergyTotalsFromFakegatoStorage();
    const kinds = new Set([...Object.keys(loaded), ...Object.keys(recovered), ...this.getDesiredEveEnergyHistoryKinds()]);

    for (const kind of kinds) {
      const best = Math.max(Number(loaded[kind] || 0), Number(recovered[kind] || 0));
      if (Number.isFinite(best) && best > 0) {
        this.eveEnergyRuntimeTotalsKwh.set(kind, best);
      }
    }

    if (this.eveEnergyRuntimeTotalsKwh.size > 0) {
      const summary = [...this.eveEnergyRuntimeTotalsKwh.entries()]
        .map(([kind, value]) => `${kind}=${Number(value).toFixed(3)}kWh`)
        .join(' | ');
      this.log.info(`[EveHistory] restored cumulative totals ${summary}`);
      this.persistEveEnergyRuntimeTotals();
    }
  }

  recoverEveEnergyTotalsFromFakegatoStorage() {
    const totals = {};
    const storagePath = this.getStoragePath();

    let files = [];
    try {
      files = fs.readdirSync(storagePath);
    } catch {
      return totals;
    }

    for (const kind of this.getDesiredEveEnergyHistoryKinds()) {
      const meta = this.getEveEnergyHistoryMeta(kind);
      if (!meta?.displayName) {
        continue;
      }

      const displayNames = [meta.displayName, ...(meta.legacyDisplayNames || [])];
      const candidates = files.filter((file) => displayNames.some((name) => file.includes(name)) && file.endsWith('_persist.json'));
      for (const file of candidates) {
        const candidatePath = path.join(storagePath, file);
        try {
          const parsed = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
          const history = Array.isArray(parsed?.history) ? parsed.history : [];
          for (const entry of history) {
            if (!entry || typeof entry !== 'object') {
              continue;
            }
            const numeric = Number(entry.totalConsumption);
            if (Number.isFinite(numeric) && numeric >= 0) {
              totals[kind] = Math.max(totals[kind] || 0, numeric);
            }
          }
        } catch {
          // Ignore malformed or partially-written fakegato files; fakegato owns them.
        }
      }
    }

    return totals;
  }

  persistEveEnergyRuntimeTotals() {
    if (!this.enableEveEnergyHistory) {
      return;
    }

    const totals = {};
    for (const [kind, value] of this.eveEnergyRuntimeTotalsKwh.entries()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric >= 0) {
        totals[kind] = Number(numeric.toFixed(6));
      }
    }

    try {
      fs.writeFileSync(this.getEveEnergyTotalsStatePath(), JSON.stringify({
        version: BUILD_VERSION,
        updatedAt: new Date().toISOString(),
        totals,
      }, null, 2));
    } catch (err) {
      this.log.warn(`[EveHistory] could not persist cumulative totals state: ${err.message}`);
    }
  }

  configureEveEnergyHistoryAccessory(accessory, kind, displayName, shouldApplyName = false) {
    const meta = this.getEveEnergyHistoryMeta(kind);
    if (!meta) {
      return;
    }

    const service = accessory.getServiceById(this.Service.Outlet, kind)
      || accessory.addService(this.Service.Outlet, displayName, kind);
    if (shouldApplyName) {
      service.setCharacteristic(this.Characteristic.Name, displayName);
    }

    this.prepareEveEnergyOutletService(service);

    // Eve History accessories are data collectors, not live controls.
    // Keep their HomeKit outlet state inactive while still publishing Eve Energy measurements/history.
    service.getCharacteristic(this.Characteristic.On)
      .onGet(() => false)
      .onSet(async () => {});

    service.getCharacteristic(this.Characteristic.OutletInUse)
      .onGet(() => false);

    this.ensureEveEnergyCharacteristics(service, kind);
    this.seedEveEnergyCharacteristics(service, kind);
    this.setupEveEnergyHistoryService(accessory, kind);
  }

  prepareEveEnergyOutletService(service) {
    if (!service || !this.EveEnergyCharacteristic) {
      return;
    }

    const { Consumption, TotalConsumption, Voltage, Current } = this.EveEnergyCharacteristic;
    for (const CharacteristicClass of [Consumption, TotalConsumption, Voltage, Current]) {
      if (!CharacteristicClass) {
        continue;
      }
      try {
        service.addOptionalCharacteristic(CharacteristicClass);
      } catch {
        // Already optional or not supported by this Homebridge/HAP version.
      }
    }
  }

  seedEveEnergyCharacteristics(service, kind) {
    if (!service || !this.EveEnergyCharacteristic) {
      return;
    }

    const { Consumption, TotalConsumption, Voltage, Current } = this.EveEnergyCharacteristic;
    const power = this.getEveEnergyHistoryPower(kind);
    const totalKwh = this.eveEnergyRuntimeTotalsKwh.get(kind) || 0;

    service.setCharacteristic(Consumption, Math.max(0, Number(power.toFixed ? power.toFixed(1) : power)));
    service.setCharacteristic(TotalConsumption, Math.max(0, Number(totalKwh.toFixed(3))));
    service.setCharacteristic(Voltage, Number((this.getGridVoltage() || 230).toFixed(1)));
    service.setCharacteristic(Current, this.getEveEnergyHistoryCurrent(kind));
  }

  ensureEveEnergyCharacteristics(service, kind) {
    if (!this.EveEnergyCharacteristic) {
      return;
    }

    const { Consumption, TotalConsumption, Voltage, Current } = this.EveEnergyCharacteristic;

    this.prepareEveEnergyOutletService(service);

    this.getOrAddCharacteristic(service, Consumption)
      .onGet(() => this.getEveEnergyHistoryPower(kind));
    this.getOrAddCharacteristic(service, TotalConsumption)
      .onGet(() => Math.max(0, Number((this.eveEnergyRuntimeTotalsKwh.get(kind) || 0).toFixed(3))));
    this.getOrAddCharacteristic(service, Voltage)
      .onGet(() => Number((this.getGridVoltage() || 230).toFixed(1)));
    this.getOrAddCharacteristic(service, Current)
      .onGet(() => this.getEveEnergyHistoryCurrent(kind));
  }

  getEveEnergyResetTimestamp() {
    // Eve uses seconds since 1 Jan 2001 for its totalizer reset characteristic.
    const eveEpochMs = Date.UTC(2001, 0, 1, 0, 0, 0);
    return Math.max(0, Math.floor((Date.now() - eveEpochMs) / 1000));
  }

  handleEveEnergyReset(kind, value) {
    // Intentionally inert in 3b.11: Eve may write/read the reset characteristic during
    // accessory initialisation, which previously zeroed long-term totals on startup.
    const numeric = Number(value);
    this.log.debug?.(`[EveHistory] ignored reset-total write for ${kind}${Number.isFinite(numeric) ? ` at Eve timestamp ${numeric}` : ''}`);
  }

  getOrAddCharacteristic(service, CharacteristicClass) {
    return service.getCharacteristic(CharacteristicClass) || service.addCharacteristic(CharacteristicClass);
  }

  getGridVoltage() {
    return this.getNumber([
      'Power/Power/Grid_Voltage',
      'Power/Power/Grid_Voltage_L1',
      'Power/Power/Voltage',
      'Stats/Grid_Voltage',
      'Grid/Grid_Voltage',
    ], 'Grid_Voltage');
  }

  getEveEnergyHistoryCurrent(kind) {
    const voltage = this.getGridVoltage() || 230;
    if (!Number.isFinite(voltage) || voltage <= 0) {
      return 0;
    }
    return Number((this.getEveEnergyHistoryPower(kind) / voltage).toFixed(2));
  }

  setupEveEnergyHistoryService(accessory, kind) {
    if (!this.enableEveEnergyHistory || !this.FakeGatoHistoryService) {
      if (this.enableEveEnergyHistory && !this.FakeGatoHistoryService && !this._warnedMissingFakeGato) {
        this._warnedMissingFakeGato = true;
        this.log.warn('Eve Energy history is enabled, but fakegato-history is not available. Install dependencies and restart Homebridge.');
      }
      return null;
    }

    if (this.eveEnergyHistoryServices.has(kind)) {
      return this.eveEnergyHistoryServices.get(kind);
    }

    const fakeGatoLog = this.createFilteredFakeGatoLogger();
    accessory.log = fakeGatoLog;
    const service = accessory.getServiceById(this.Service.Outlet, kind);
    if (service) {
      this.prepareEveEnergyOutletService(service);
      this.seedEveEnergyCharacteristics(service, kind);
    }

    const history = new this.FakeGatoHistoryService('energy', accessory, {
      size: this.eveEnergyHistorySize,
      storage: 'fs',
      disableRepeatLastData: false,
      log: fakeGatoLog,
    });
    if (!history) {
      this.log.error(`[EveHistory] failed to create history service for ${kind}`);
      return null;
    }
    this.eveEnergyHistoryServices.set(kind, history);
    this.log.info(`Eve Energy history enabled for ${accessory.displayName || kind}`);
    return history;
  }

  createFilteredFakeGatoLogger() {
    if (this.filteredFakeGatoLogger) {
      return this.filteredFakeGatoLogger;
    }

    const shouldSuppress = (args) => {
      const first = args && args.length ? String(args[0]) : '';
      return /\*\*\s*Fakegato-history\s+read data from/i.test(first);
    };

    const wrap = (level) => (...args) => {
      if (shouldSuppress(args)) {
        return;
      }
      const target = typeof this.log[level] === 'function' ? this.log[level] : this.log.info;
      return target.apply(this.log, args);
    };

    this.filteredFakeGatoLogger = {
      info: wrap('info'),
      warn: wrap('warn'),
      error: wrap('error'),
      debug: wrap('debug'),
      log: wrap('info'),
    };

    return this.filteredFakeGatoLogger;
  }

  getEveEnergyHistoryPower(kind, snap = null) {
    const meta = this.getEveEnergyHistoryMeta(kind);
    if (!meta) {
      return 0;
    }

    const source = snap || this.getSnapshot();
    const value = Number(source[meta.valueKey] || 0);
    if (!Number.isFinite(value) || value < 0) {
      return 0;
    }
    return Math.round(value);
  }

  updateEveEnergyHistoryAccessories(snap) {
    if (!this.enableEveEnergyHistory) {
      return;
    }

    for (const kind of this.getDesiredEveEnergyHistoryKinds()) {
      const accessory = this.accessories.get(kind);
      if (!accessory) {
        continue;
      }

      const service = accessory.getServiceById(this.Service.Outlet, kind);
      if (!service) {
        continue;
      }

      const power = this.getEveEnergyHistoryPower(kind, snap);
      // Suppress active-state flicker for Eve History accessories. Graphs still receive real values below.
      service.updateCharacteristic(this.Characteristic.On, false);
      service.updateCharacteristic(this.Characteristic.OutletInUse, false);
      if (this.EveEnergyCharacteristic) {
        const { Consumption, TotalConsumption, Voltage, Current } = this.EveEnergyCharacteristic;
        service.updateCharacteristic(Consumption, Math.max(0, Number(power.toFixed ? power.toFixed(1) : power)));
        service.updateCharacteristic(TotalConsumption, Math.max(0, Number((this.eveEnergyRuntimeTotalsKwh.get(kind) || 0).toFixed(3))));
        service.updateCharacteristic(Voltage, Number((this.getGridVoltage() || 230).toFixed(1)));
        service.updateCharacteristic(Current, this.getEveEnergyHistoryCurrent(kind));
      }
    }
  }

  recordEveEnergyHistory(force = false) {
    if (!this.enableEveEnergyHistory) {
      return;
    }

    if (!this.FakeGatoHistoryService) {
      if (!this._warnedMissingFakeGato) {
        this._warnedMissingFakeGato = true;
        this.log.warn('Eve Energy history is enabled, but fakegato-history is not available. Install dependencies and restart Homebridge.');
      }
      return;
    }

    const now = Date.now();
    const minimumMs = Math.max(1, this.eveEnergyHistorySampleMinutes) * 60 * 1000;
    if (!force && now - this.lastEveEnergyHistoryEntryMs < minimumMs) {
      return;
    }

    const telemetryStatus = this.getTelemetryStatus();
    this.updateTelemetryFreshnessLog(telemetryStatus);
    if (!telemetryStatus.safeForAutomation) {
      const age = Number.isFinite(telemetryStatus.ageSeconds) ? Math.round(telemetryStatus.ageSeconds) : 'unknown';
      const ageBucket = age === 'unknown' ? 'unknown' : Math.floor(Number(age) / Math.max(60, Math.max(1, this.eveEnergyHistorySampleMinutes) * 60));
      const signature = `${telemetryStatus.state}|${telemetryStatus.source}|${ageBucket}`;
      if (signature !== this.lastEveEnergyHistorySkipSignature) {
        this.lastEveEnergyHistorySkipSignature = signature;
        this.log.warn(`[EveHistory] skipped: stale telemetry | state=${telemetryStatus.state} | age=${age}s | source=${telemetryStatus.source}`);
      }
      return;
    }
    this.lastEveEnergyHistorySkipSignature = '';

    const snap = this.getSnapshot();
    const time = Math.round(now / 1000);
    const elapsedHours = this.eveEnergyRuntimeTotalUpdatedMs > 0
      ? Math.max(0, (now - this.eveEnergyRuntimeTotalUpdatedMs) / 3_600_000)
      : 0;
    const recorded = [];

    for (const kind of this.getDesiredEveEnergyHistoryKinds()) {
      const accessory = this.accessories.get(kind);
      if (!accessory) {
        this.log.debug?.(`[EveHistory] ${kind} accessory not available yet`);
        continue;
      }

      const history = this.setupEveEnergyHistoryService(accessory, kind);
      if (!history) {
        continue;
      }

      const power = this.getEveEnergyHistoryPower(kind, snap);
      const previousTotal = Math.max(0, Number(this.eveEnergyRuntimeTotalsKwh.get(kind) || 0));
      if (elapsedHours > 0) {
        const increment = Math.max(0, power * elapsedHours / 1000);
        this.eveEnergyRuntimeTotalsKwh.set(kind, previousTotal + increment);
      } else if (!this.eveEnergyRuntimeTotalsKwh.has(kind)) {
        this.eveEnergyRuntimeTotalsKwh.set(kind, previousTotal);
      }

      const service = accessory.getServiceById(this.Service.Outlet, kind);
      if (service) {
        this.seedEveEnergyCharacteristics(service, kind);
      }

      const totalKwh = Math.max(0, Number((this.eveEnergyRuntimeTotalsKwh.get(kind) || 0).toFixed(3)));
      const entry = { time, power, totalConsumption: totalKwh };
      try {
        history.addEntry(entry);
        recorded.push(`${this.getEveEnergyHistoryMeta(kind)?.description || kind}=${power}W total=${totalKwh}kWh`);
      } catch (err) {
        this.log.warn(`[EveHistory] failed to add history entry for ${kind}: ${err.message}`);
      }
    }

    this.eveEnergyRuntimeTotalUpdatedMs = now;

    if (recorded.length > 0) {
      this.persistEveEnergyRuntimeTotals();
      this.lastEveEnergyHistoryEntryMs = now;
      this.log.info(`[EveHistory] recorded ${recorded.join(' | ')}`);
    } else {
      this.log.warn('[EveHistory] no entries recorded; check Eve history accessories and GivTCP telemetry');
    }
  }

  async handleSwitchSet(kind, value) {
    if (kind === 'eveningExcessExport') {
      this.setEveningExcessExportArmed(Boolean(value));
      this.refreshAccessories();
      return;
    }

    const meta = this.getManualSwitchMeta(kind);
    if (!meta) {
      return;
    }

    if (value) {
      if (!this.isTelemetrySafeForAutomation(`manual ${meta.displayAction.toLowerCase()} ${meta.minutes}m`)) {
        this.setCommandState(kind, false);
        this.refreshAccessories();
        return;
      }

      const start = new Date();
      const end = new Date(Date.now() + (meta.minutes * 60000));
      const label = `Manual ${meta.displayAction} ${meta.minutes}m`;
      this.enqueueManualSequence(label, this.buildTimedSlotSteps(label, meta.slotKind, start, end, meta.slotKind === 'charge' ? this.targetSoc : null));
      this.setCommandState(kind, true, 2);
      this.scheduleTimedManualCleanup(kind, meta);
      this.clearSiblingManualIntents(kind, meta.family);
    } else {
      this.cleanupTimedManualAction(meta.family, 'manual off');
    }

    this.refreshAccessories();
  }

  setCommandState(kind, value, autoOffMinutes = 0, expireHandler = null) {
    this.commandStates[kind] = value;

    if (this.commandTimers.has(kind)) {
      clearTimeout(this.commandTimers.get(kind));
      this.commandTimers.delete(kind);
    }

    if (value && autoOffMinutes > 0) {
      const timeoutMs = Math.max(1, autoOffMinutes) * 60 * 1000;
      const timer = setTimeout(() => {
        if (typeof expireHandler === 'function') {
          expireHandler();
          return;
        }
        this.commandStates[kind] = false;
        this.refreshAccessories();
      }, timeoutMs);
      this.commandTimers.set(kind, timer);
    }
  }

  clearSiblingManualIntents(activeKind, family) {
    for (const kind of this.switchKinds) {
      const meta = this.getManualSwitchMeta(kind);
      if (!meta || meta.family !== family || kind === activeKind) {
        continue;
      }
      this.commandStates[kind] = false;
      if (this.commandTimers.has(kind)) {
        clearTimeout(this.commandTimers.get(kind));
        this.commandTimers.delete(kind);
      }
      if (this.manualCleanupTimers.has(kind)) {
        clearTimeout(this.manualCleanupTimers.get(kind));
        this.manualCleanupTimers.delete(kind);
      }
    }
  }

  scheduleTimedManualCleanup(kind, meta) {
    if (!meta?.family || !meta?.slotKind || !Number.isFinite(meta.minutes) || meta.minutes <= 0) {
      return;
    }

    if (this.manualCleanupTimers.has(kind)) {
      clearTimeout(this.manualCleanupTimers.get(kind));
      this.manualCleanupTimers.delete(kind);
    }

    const timeoutMs = Math.max(1, meta.minutes) * 60 * 1000 + 5000;
    const timer = setTimeout(() => {
      this.manualCleanupTimers.delete(kind);
      this.cleanupTimedManualAction(meta.family, `timed ${meta.minutes}m ended`);
    }, timeoutMs);
    this.manualCleanupTimers.set(kind, timer);
  }

  normalizeSwitchText(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  isEnabledValue(value) {
    const text = this.normalizeSwitchText(value);
    return value === true || value === 1 || text === '1' || text === 'true' || text === 'enabled' || text === 'enable' || text === 'on';
  }

  firstKnownText(paths, leaves = []) {
    for (const path of paths) {
      const value = this.getText([path]);
      if (value !== undefined && value !== '') {
        return value;
      }
    }

    for (const leaf of leaves) {
      const value = this.getText([], leaf);
      if (value !== undefined && value !== '') {
        return value;
      }
    }

    return undefined;
  }

  getScheduleValue(slotKind, valueKind) {
    const isCharge = slotKind === 'charge';
    const prefix = isCharge ? 'Charge' : 'Discharge';
    const lower = isCharge ? 'charge' : 'discharge';
    const snake = isCharge ? 'charge' : 'discharge';

    if (valueKind === 'enabled') {
      return this.firstKnownText([
        `Control/Enable_${prefix}_Schedule`,
        `Timeslots/Enable_${prefix}_Schedule`,
        `Control/${prefix}_Schedule`,
        `Control/${prefix}/Schedule`,
        `Control/${prefix}_Schedule_Enable`,
        `Control/${prefix}/Schedule_Enable`,
        `Control/${lower}_schedule`,
        `Control/${lower}/schedule`,
        `Control/${snake}_schedule`,
        `Battery_Details/${prefix}_Schedule`,
        `Battery_Details/${prefix}/Schedule`,
      ], [
        `${prefix}_Schedule`,
        `${prefix}_Schedule_Enable`,
        `${lower}_schedule`,
        `${snake}_schedule`,
      ]);
    }

    const suffix = valueKind === 'start' ? 'Start' : 'End';
    const restSuffix = valueKind === 'start' ? 'start' : 'finish';
    return this.firstKnownText([
      `Timeslots/${prefix}_${valueKind}_time_slot_1`,
      `Control/${prefix}_Slot_1_${suffix}`,
      `Control/${prefix}/Slot_1_${suffix}`,
      `Control/${prefix}_Slot_1/${suffix}`,
      `Control/${prefix}/Slot_1/${suffix}`,
      `Control/${prefix}_Slot_1_${restSuffix}`,
      `Control/${prefix}/Slot_1/${restSuffix}`,
      `Control/${lower}_slot_1_${valueKind}`,
      `Control/${lower}/slot_1/${valueKind}`,
      `Battery_Details/${prefix}_Slot_1_${suffix}`,
      `Battery_Details/${prefix}/Slot_1_${suffix}`,
    ], [
      `${prefix}_${valueKind}_time_slot_1`,
      `${prefix}_Slot_1_${suffix}`,
      `${prefix}_Slot_1_${restSuffix}`,
      `${lower}_slot_1_${valueKind}`,
    ]);
  }

  parseSlotClock(value) {
    const minutes = this.parseTimeToMinutes(value);
    if (minutes === null) {
      return null;
    }
    return minutes;
  }

  getSlotWindowForToday(startText, endText, now = new Date()) {
    const startMinutes = this.parseSlotClock(startText);
    const endMinutes = this.parseSlotClock(endText);
    if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
      return null;
    }

    const nowMinutes = (now.getHours() * 60) + now.getMinutes();
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

    return { start, end, startMinutes, endMinutes };
  }

  getLiveSlotState(slotKind) {
    const enabled = this.isEnabledValue(this.getScheduleValue(slotKind, 'enabled'));
    const startText = this.getScheduleValue(slotKind, 'start');
    const endText = this.getScheduleValue(slotKind, 'end');
    const window = this.getSlotWindowForToday(startText, endText);

    if (!enabled || !window) {
      return { active: false, enabled, start: null, end: null, durationMinutes: 0 };
    }

    const now = Date.now();
    const toleranceMs = Math.max(0, this.slotToleranceMinutes) * 60000;
    const active = now >= (window.start.getTime() - toleranceMs) && now <= (window.end.getTime() + toleranceMs);
    const durationMinutes = Math.round((window.end.getTime() - window.start.getTime()) / 60000);

    return {
      active,
      enabled,
      start: window.start,
      end: window.end,
      durationMinutes,
    };
  }

  durationMatches(actualMinutes, expectedMinutes) {
    return Math.abs(Number(actualMinutes) - Number(expectedMinutes)) <= Math.max(0, this.slotToleranceMinutes);
  }

  setEveningExcessExportArmed(value) {
    if (value && !this.enableExcessEnergyExport) {
      this.eveningExcessExportArmed = false;
      this.log.warn('[Evening Excess Export] cannot arm from Apple Home: enable and configure Evening Excess Export in Homebridge UI first');
      return;
    }

    if (value && !this.excessExportBatteryCapacityKwh) {
      this.eveningExcessExportArmed = false;
      this.log.warn('[Evening Excess Export] cannot arm: Battery Size Used for Planning is missing or invalid');
      return;
    }

    const wasActive = this.excessEnergyExportActive || this.activeExcessExportSlot;
    this.eveningExcessExportArmed = Boolean(value);
    if (!this.eveningExcessExportArmed) {
      this.excessEnergyExportActive = false;
      this.activeExcessExportSlot = null;
      if (wasActive) {
        this.enqueueAutomationSequence('Evening Excess Export Disarm', this.buildNeutralizeSlotSteps('Evening Excess Export Disarm', 'discharge', { verifyCleared: true }));
      }
    }
    this.log.info(`[Evening Excess Export] ${this.eveningExcessExportArmed ? 'armed' : 'disarmed'} from Apple Home`);
  }

  getSwitchState(kind) {
    if (kind === 'eveningExcessExport') {
      return Boolean(this.enableExcessEnergyExport && this.eveningExcessExportArmed);
    }

    const meta = this.getManualSwitchMeta(kind);
    if (!meta) {
      return false;
    }

    if (this.commandStates[kind]) {
      return true;
    }

    const slot = this.getLiveSlotState(meta.slotKind);
    return Boolean(slot.active && this.durationMatches(slot.durationMinutes, meta.minutes));
  }

  isManualFamilyActive(family) {
    for (const kind of this.switchKinds) {
      const meta = this.getManualSwitchMeta(kind);
      if (meta?.family === family && this.getSwitchState(kind)) {
        return true;
      }
    }
    return false;
  }

  publishControl(topicLeaf, payload) {
    const serial = this.activeSerial || this.inverterSerial;
    if (!serial) {
      this.log.warn(`Cannot publish ${topicLeaf}: inverter serial not known yet`);
      return;
    }

    if (!this.client || !this.client.connected) {
      this.log.warn(`Cannot publish ${topicLeaf}: MQTT not connected`);
      return;
    }

    const topic = `${this.mqttRootTopic}/control/${serial}/${topicLeaf}`;
    this.client.publish(topic, payload);
    this.log.info(`MQTT control -> ${topic} = ${payload}`);
  }

  async postRestControl(path, body, note = '') {
    const url = `${this.givTcpRestUrl}${path.startsWith('/') ? path : `/${path}`}`;
    if (note) {
      this.log.info(note);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`REST ${path} failed (${response.status}): ${text}`);
    }

    const anomaly = this.detectGivTcpCommandAnomaly(path, body, text);
    if (anomaly?.hardFailure) {
      throw new Error(`GivTCP command failure: ${anomaly.message} | response=${text}`);
    }
    if (anomaly?.message) {
      this.log.warn(`GivTCP response anomaly: ${anomaly.message}; continuing to write verification | response=${text}`);
    }

    this.log.info(`REST control -> ${path} = ${JSON.stringify(body)} :: ${text}`);
    return text;
  }

  detectGivTcpCommandAnomaly(path, body, text) {
    const lowerPath = String(path || '').toLowerCase();
    const lowerText = String(text || '').toLowerCase();

    if (/attributeerror|traceback|exception|\bfailed\b|error/.test(lowerText)) {
      return { hardFailure: true, message: 'GivTCP reported an internal write failure' };
    }

    if (lowerPath.includes('enablechargeschedule') || lowerPath.includes('enabledischargeschedule')) {
      const requested = String(body?.state || '').trim().toLowerCase();
      if (requested === 'enable' && /schedule to disable/.test(lowerText)) {
        return { hardFailure: false, message: 'requested schedule enable but GivTCP response says disable' };
      }
      if (requested === 'disable' && /schedule to enable/.test(lowerText)) {
        return { hardFailure: false, message: 'requested schedule disable but GivTCP response says enable' };
      }
    }

    if (lowerPath.includes('setchargeslot') || lowerPath.includes('setdischargeslot')) {
      const requestedStart = this.normalizeReadbackTime(body?.start);
      const requestedFinish = this.normalizeReadbackTime(body?.finish);
      const requestedIsClear = requestedStart === '00:00' && requestedFinish === '00:00';
      if (!requestedIsClear && /00:00\s*-\s*00:00/.test(lowerText)) {
        return { hardFailure: false, message: `requested slot ${requestedStart}-${requestedFinish} but GivTCP response says 00:00-00:00` };
      }
    }

    return null;
  }


  async getRestJson(path) {
    const url = `${this.givTcpRestUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const response = await fetch(url, { method: 'GET' });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`REST ${path} failed (${response.status}): ${text}`);
    }

    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`REST ${path} returned non-JSON: ${err.message}`);
    }
  }

  async readGivTcpCacheForVerification() {
    let lastError = null;
    for (const path of ['/readData', '/getCache']) {
      try {
        const data = await this.getRestJson(path);
        if (data && typeof data === 'object' && !data.Result) {
          return { path, data };
        }
        lastError = new Error(`${path} returned ${JSON.stringify(data).slice(0, 120)}`);
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error('No GivTCP cache endpoint returned data');
  }

  getNestedValue(obj, pathParts) {
    let current = obj;
    for (const part of pathParts) {
      if (!current || typeof current !== 'object' || !(part in current)) {
        return undefined;
      }
      current = current[part];
    }
    return current;
  }

  firstNestedValue(obj, candidatePaths) {
    for (const candidate of candidatePaths) {
      const value = this.getNestedValue(obj, candidate);
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }
    return undefined;
  }

  normalizeReadbackTime(value) {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    if (typeof value === 'object') {
      return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const n = Math.max(0, Math.round(value));
      const hours = Math.floor(n / 100);
      const minutes = n % 100;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    const text = String(value).trim();
    const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (match) {
      return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
    }

    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
      return this.normalizeReadbackTime(numeric);
    }

    return text;
  }

  isClearedReadbackTime(value) {
    const normalised = this.normalizeReadbackTime(value);
    return normalised === '00:00';
  }

  findFirstNestedKey(obj, wanted) {
    if (!obj || typeof obj !== 'object') {
      return undefined;
    }

    if (Object.prototype.hasOwnProperty.call(obj, wanted)) {
      return obj[wanted];
    }

    for (const value of Object.values(obj)) {
      const found = this.findFirstNestedKey(value, wanted);
      if (found !== undefined) {
        return found;
      }
    }

    return undefined;
  }

  normalizeReadbackSwitchState(value) {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    if (typeof value === 'object') {
      if (value.name !== undefined) {
        return this.normalizeReadbackSwitchState(value.name);
      }
      if (value.value !== undefined) {
        return this.normalizeReadbackSwitchState(value.value);
      }
      return null;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value !== 0;
    }

    const text = String(value).trim().toLowerCase();
    if (['enable', 'enabled', 'on', 'true', '1', 'active'].includes(text)) {
      return true;
    }
    if (['disable', 'disabled', 'off', 'false', '0', 'inactive', 'normal'].includes(text)) {
      return false;
    }

    return null;
  }

  getTimedScheduleReadback(data, kind) {
    const isCharge = kind === 'charge';
    const publicKey = isCharge ? 'Enable_Charge_Schedule' : 'Enable_Discharge_Schedule';
    const rawKey = isCharge ? 'enable_charge_schedule' : 'enable_discharge_schedule';
    const rawLegacyKey = isCharge ? 'enable_charge' : 'enable_discharge';

    const value = this.firstNestedValue(data, [
      ['decoded', 'Timeslots', publicKey],
      ['decoded', 'Invertor', publicKey],
      ['Power', 'Power', publicKey],
      ['Stats', publicKey],
      ['raw', 'invertor', rawKey],
      ['raw', 'invertor', rawLegacyKey],
    ]) ?? this.findFirstNestedKey(data, publicKey);

    return this.normalizeReadbackSwitchState(value);
  }

  getSlotReadback(data, kind, slotNumber) {
    const isCharge = kind === 'charge';
    const prefix = isCharge ? 'Charge' : 'Discharge';
    const rawPrefix = isCharge ? 'charge' : 'discharge';
    const startKey = `${prefix}_start_time_slot_${slotNumber}`;
    const endKey = `${prefix}_end_time_slot_${slotNumber}`;
    const rawSlot = this.getNestedValue(data, ['raw', 'invertor', `${rawPrefix}_slot_${slotNumber}`]);

    const start = rawSlot && typeof rawSlot === 'object' && rawSlot.start !== undefined
      ? rawSlot.start
      : this.firstNestedValue(data, [
        ['decoded', 'Timeslots', startKey],
        ['decoded', 'Invertor', startKey],
        ['Power', 'Power', startKey],
        ['raw', 'invertor', `${rawPrefix}_slot_${slotNumber}_start`],
      ]) ?? this.findFirstNestedKey(data, startKey);

    const end = rawSlot && typeof rawSlot === 'object' && rawSlot.end !== undefined
      ? rawSlot.end
      : this.firstNestedValue(data, [
        ['decoded', 'Timeslots', endKey],
        ['decoded', 'Invertor', endKey],
        ['Power', 'Power', endKey],
        ['raw', 'invertor', `${rawPrefix}_slot_${slotNumber}_end`],
      ]) ?? this.findFirstNestedKey(data, endKey);

    const startText = this.normalizeReadbackTime(start);
    const endText = this.normalizeReadbackTime(end);
    const hasSlotEvidence = startText !== null && endText !== null;
    const cleared = hasSlotEvidence && this.isClearedReadbackTime(start) && this.isClearedReadbackTime(end);
    const active = hasSlotEvidence && !cleared;

    return {
      slot: slotNumber,
      hasSlotEvidence,
      cleared,
      active,
      start: startText ?? 'unknown',
      end: endText ?? 'unknown',
    };
  }

  getTimedActionReadback(data, kind) {
    const scheduleEnabled = this.getTimedScheduleReadback(data, kind);
    const slots = [];

    for (let slot = 1; slot <= 10; slot += 1) {
      slots.push(this.getSlotReadback(data, kind, slot));
    }

    const slotsWithEvidence = slots.filter((slot) => slot.hasSlotEvidence);
    const activeSlots = slotsWithEvidence.filter((slot) => slot.active);
    const unclearedSlots = slotsWithEvidence.filter((slot) => !slot.cleared);
    const slot1 = slots.find((slot) => slot.slot === 1);
    const allObservedSlotsCleared = slotsWithEvidence.length > 0 && unclearedSlots.length === 0;

    // Cleanup safety is governed by the enable flag. Stored slot times are configuration, not active behaviour.
    // If the schedule is disabled, treat cleanup as safe even when inactive slot times remain visible.
    // If the enable flag is unknown, retain the older stricter slot-clear behaviour.
    const scheduleDisabled = scheduleEnabled === false;
    const storedInactiveSlots = scheduleDisabled ? unclearedSlots : [];
    const cleared = scheduleDisabled || (allObservedSlotsCleared && scheduleEnabled !== true);
    const active = Boolean(slot1?.active) && scheduleEnabled !== false;

    return {
      scheduleEnabled,
      slots,
      slotsWithEvidence,
      activeSlots,
      unclearedSlots,
      storedInactiveSlots,
      slot1,
      active,
      cleared,
    };
  }

  formatSlotList(slots) {
    if (!Array.isArray(slots) || slots.length === 0) {
      return 'none';
    }

    return slots.map((slot) => `${slot.slot}:${slot.start}-${slot.end}`).join(', ');
  }

  isCeAcCoupledSystem() {
    const serial = String(this.activeSerial || this.inverterSerial || '').trim().toUpperCase();
    if (serial.startsWith('CE')) {
      return true;
    }

    const isAcCoupled = this.getText(['raw/invertor/is_ac_coupled'], 'is_ac_coupled');
    return this.isEnabledValue(isAcCoupled);
  }

  getCeChargeSlotMemoryPath() {
    const serial = String(this.activeSerial || this.inverterSerial || 'pending').replace(/[^a-z0-9._-]+/gi, '_');
    return path.join(this.getStoragePath(), `givhome_${serial}_ce_charge_slot_memory.json`);
  }

  loadCeChargeSlotMemory() {
    if (this.ceChargeSlotMemory) {
      return this.ceChargeSlotMemory;
    }

    try {
      const memoryPath = this.getCeChargeSlotMemoryPath();
      if (!fs.existsSync(memoryPath)) {
        return null;
      }
      const parsed = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
      if (parsed?.active && parsed?.slot1?.start && parsed?.slot1?.end) {
        this.ceChargeSlotMemory = parsed;
        return parsed;
      }
    } catch (err) {
      this.log.warn(`[CE Charge Slot] could not load remembered schedule: ${err.message}`);
    }

    return null;
  }

  persistCeChargeSlotMemory(memory) {
    try {
      const memoryPath = this.getCeChargeSlotMemoryPath();
      if (!memory) {
        if (fs.existsSync(memoryPath)) {
          fs.unlinkSync(memoryPath);
        }
        this.ceChargeSlotMemory = null;
        return;
      }

      this.ceChargeSlotMemory = memory;
      fs.writeFileSync(memoryPath, JSON.stringify(memory, null, 2));
    } catch (err) {
      this.log.warn(`[CE Charge Slot] could not persist remembered schedule: ${err.message}`);
    }
  }

  getChargeTargetSocReadback(data) {
    const value = this.firstNestedValue(data, [
      ['raw', 'invertor', 'charge_target_soc'],
      ['raw', 'invertor', 'charge_soc'],
      ['raw', 'invertor', 'charge_soc_stop_1'],
      ['decoded', 'Timeslots', 'Charge_Target_SOC'],
      ['decoded', 'Invertor', 'Charge_Target_SOC'],
      ['Power', 'Power', 'Charge_Target_SOC'],
    ])
      ?? this.findFirstNestedKey(data, 'charge_target_soc')
      ?? this.findFirstNestedKey(data, 'Charge_Target_SOC')
      ?? this.findFirstNestedKey(data, 'charge_soc');

    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 100) {
      return Math.round(numeric);
    }
    return null;
  }

  async readCeChargeSlot1State(label) {
    const { path: sourcePath, data } = await this.readGivTcpCacheForVerification();
    const slot1 = this.getSlotReadback(data, 'charge', 1);
    const enabled = this.getTimedScheduleReadback(data, 'charge');
    const chargeToPercent = this.getChargeTargetSocReadback(data);

    if (!slot1?.hasSlotEvidence) {
      throw new Error(`charge slot 1 was not visible in ${sourcePath}`);
    }

    const state = {
      sourcePath,
      enabled: enabled === null ? false : Boolean(enabled),
      slot1: { start: slot1.start, end: slot1.end },
      chargeToPercent,
    };

    this.log.info(`[CE Charge Slot] ${label}: read slot 1 ${state.slot1.start}-${state.slot1.end} | enabled=${state.enabled} | target=${chargeToPercent ?? 'unknown'} | source=${sourcePath}`);
    return state;
  }

  async rememberCeChargeSlotBeforeWrite(label) {
    if (!this.isCeAcCoupledSystem()) {
      return;
    }

    const telemetry = this.getTelemetryStatus();
    if (!telemetry.safeForAutomation || !telemetry.hasSourceTimestamp) {
      const age = Number.isFinite(telemetry.ageSeconds) ? Math.round(telemetry.ageSeconds) : 'unknown';
      throw new Error(`CE charge slot pre-state is not trustworthy | state=${telemetry.state} | age=${age}s | source=${telemetry.source}`);
    }

    const existing = this.loadCeChargeSlotMemory();
    if (existing?.active) {
      this.log.info(`[CE Charge Slot] ${label}: existing remembered slot retained ${existing.slot1.start}-${existing.slot1.end} | enabled=${Boolean(existing.enabled)}`);
      return;
    }

    const previous = await this.readCeChargeSlot1State(label);
    const memory = {
      version: BUILD_VERSION,
      active: true,
      rememberedAt: new Date().toISOString(),
      label,
      enabled: previous.enabled,
      slot1: previous.slot1,
      chargeToPercent: previous.chargeToPercent,
      sourcePath: previous.sourcePath,
    };

    this.persistCeChargeSlotMemory(memory);
    this.log.info(`[CE Charge Slot] remembered user schedule before temporary charge: slot 1 ${memory.slot1.start}-${memory.slot1.end} | enabled=${memory.enabled} | target=${memory.chargeToPercent ?? 'unknown'}`);
  }

  buildCeChargeReinstateSteps(prefix, options = {}) {
    if (!this.isCeAcCoupledSystem()) {
      return this.buildNeutralizeSlotSteps(prefix, 'charge', options);
    }

    const memory = this.loadCeChargeSlotMemory();
    if (!memory?.active) {
      return [
        { customAction: 'ceChargeNoop', note: `${prefix} -> CE idle: no remembered charge slot to reinstate` },
      ];
    }

    const target = Number.isFinite(Number(memory.chargeToPercent))
      ? this.clamp(Math.round(Number(memory.chargeToPercent)), 1, 100)
      : this.targetSoc;

    return [
      { restPath: '/enableChargeSchedule', restBody: { state: 'disable' }, note: `${prefix} -> CE clean: REST enableChargeSchedule disable`, continueOnError: true },
      { restPath: '/setChargeSlot', restBody: { slot: '1', start: memory.slot1.start, finish: memory.slot1.end, chargeToPercent: String(target) }, note: `${prefix} -> CE reinstate charge slot 1 ${memory.slot1.start}-${memory.slot1.end}`, continueOnError: false },
      { restPath: '/enableChargeSchedule', restBody: { state: memory.enabled ? 'enable' : 'disable' }, note: `${prefix} -> CE reinstate charge schedule ${memory.enabled ? 'enable' : 'disable'}`, continueOnError: false, verifyCeChargeReinstate: true },
    ];
  }

  async verifyCeChargeSlotReinstated(label) {
    const memory = this.loadCeChargeSlotMemory();
    if (!memory?.active) {
      return true;
    }

    const delayMs = Math.max(2, this.writeVerificationDelaySeconds) * 1000;
    const retries = Math.max(1, this.writeVerificationClearRetries);

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        const current = await this.readCeChargeSlot1State(`${label} verify reinstated attempt ${attempt}/${retries}`);
        const restored = current.slot1.start === memory.slot1.start
          && current.slot1.end === memory.slot1.end
          && current.enabled === Boolean(memory.enabled);

        if (restored) {
          this.log.info(`[CE Charge Slot] ${label}: reinstated slot 1 ${current.slot1.start}-${current.slot1.end} | enabled=${current.enabled}`);
          this.persistCeChargeSlotMemory(null);
          return true;
        }

        this.log.warn(`[CE Charge Slot] ${label}: not reinstated yet | expected=${memory.slot1.start}-${memory.slot1.end} enabled=${memory.enabled} | actual=${current.slot1.start}-${current.slot1.end} enabled=${current.enabled} | attempt=${attempt}/${retries}`);
      } catch (err) {
        this.log.warn(`[CE Charge Slot] ${label}: reinstate readback failed | attempt=${attempt}/${retries}: ${err.message}`);
      }
    }

    this.log.warn(`[CE Charge Slot] ${label}: remembered schedule may still require manual inspection`);
    return false;
  }

  async verifyTimedActionState(label, kind, expectedState, options = {}) {
    if (!this.enableWriteVerification) {
      this.log.info(`[WriteVerify] ${label} skipped: write verification disabled`);
      return false;
    }

    const delayMs = Math.max(2, this.writeVerificationDelaySeconds) * 1000;
    const defaultRetries = expectedState === 'active'
      ? this.writeVerificationStartRetries
      : this.writeVerificationClearRetries;
    const retries = Math.max(1, options.retries ?? defaultRetries);

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        const { path: sourcePath, data } = await this.readGivTcpCacheForVerification();
        const result = this.getTimedActionReadback(data, kind);
        const scheduleText = result.scheduleEnabled === null ? 'unknown' : result.scheduleEnabled ? 'enabled' : 'disabled';

        if (expectedState === 'active' && result.active) {
          this.log.info(`[WriteVerify] ${label} active | ${kind} slot 1 ${result.slot1.start}-${result.slot1.end} | schedule=${scheduleText} | source=${sourcePath}`);
          return true;
        }

        if (expectedState === 'cleared' && result.cleared) {
          if (result.storedInactiveSlots?.length > 0) {
            this.log.info(`[WriteVerify] ${label} cleared | ${kind} schedule=disabled | stored inactive slots ${this.formatSlotList(result.storedInactiveSlots)} | source=${sourcePath}`);
          } else {
            this.log.info(`[WriteVerify] ${label} cleared | ${kind} slots clear | schedule=${scheduleText} | source=${sourcePath}`);
          }
          return true;
        }

        const detail = expectedState === 'active'
          ? `${kind} slot 1 ${result.slot1?.start ?? 'unknown'}-${result.slot1?.end ?? 'unknown'}`
          : `${kind} uncleared slots ${this.formatSlotList(result.unclearedSlots)}`;
        const message = `[WriteVerify] ${label} not ${expectedState} | ${detail} | schedule=${scheduleText} | attempt=${attempt}/${retries} | source=${sourcePath}`;
        if (attempt < retries) {
          this.log.info(message);
        } else {
          this.log.warn(message);
        }
      } catch (err) {
        const message = `[WriteVerify] ${label} readback failed | expected=${expectedState} | attempt=${attempt}/${retries}: ${err.message}`;
        if (attempt < retries) {
          this.log.info(message);
        } else {
          this.log.warn(message);
        }
      }
    }

    return false;
  }

  async verifyTimedActionActive(label, kind) {
    return this.verifyTimedActionState(label, kind, 'active', { retries: this.writeVerificationStartRetries });
  }

  async verifyTimedActionCleared(label, kind) {
    return this.verifyTimedActionState(label, kind, 'cleared', { retries: this.writeVerificationClearRetries });
  }

  resetManualTimedActionStateForKind(kind) {
    const family = kind === 'charge' ? 'forceCharge' : kind === 'discharge' ? 'forceExport' : null;
    if (!family) {
      return;
    }

    for (const switchKind of this.switchKinds) {
      const meta = this.getManualSwitchMeta(switchKind);
      if (meta?.family !== family) {
        continue;
      }

      this.commandStates[switchKind] = false;
      if (this.commandTimers.has(switchKind)) {
        clearTimeout(this.commandTimers.get(switchKind));
        this.commandTimers.delete(switchKind);
      }

      const accessory = this.accessories.get(switchKind);
      const service = accessory?.getService(this.Service.Switch);
      service?.updateCharacteristic(this.Characteristic.On, false);
    }
  }

  async runFailedStartCleanup(label, kind) {
    const cleanupLabel = `${label} Failed Start Cleanup`;
    this.log.warn(`[WriteVerify] ${label} start verification failed; issuing fail-safe ${kind} cleanup`);

    this.resetManualTimedActionStateForKind(kind);
    if (kind === 'discharge' && String(label).includes('Evening Excess Export')) {
      this.excessEnergyExportActive = false;
      this.activeExcessExportSlot = null;
      this.log.warn('[WriteVerify] cleared Evening Excess Export memory state after failed export start');
    }

    const steps = this.buildNeutralizeSlotSteps(cleanupLabel, kind, { verifyCleared: true });
    await this.runRestStepQueue(cleanupLabel, steps);
  }

  formatSlotTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  buildTimedSlotSteps(prefix, kind, startDate, endDate, chargeToPercent = null) {
    const start = this.formatSlotTime(startDate);
    const finish = this.formatSlotTime(endDate);

    if (kind === 'charge') {
      const body = { slot: '1', start, finish, chargeToPercent: String(Math.max(1, Math.min(100, Math.round(chargeToPercent ?? this.targetSoc)))) };
      const steps = [];
      if (this.isCeAcCoupledSystem()) {
        steps.push({ customAction: 'rememberCeChargeSlot', note: `${prefix} -> CE read and remember charge slot 1 before temporary write` });
      }
      steps.push(
        { restPath: '/enableChargeSchedule', restBody: { state: 'enable' }, note: `${prefix} -> REST enableChargeSchedule enable`, ...(this.isCeAcCoupledSystem() ? { failCleanupKind: 'charge' } : {}) },
        { restPath: '/setChargeSlot', restBody: body, note: `${prefix} -> REST setChargeSlot 1 ${start}-${finish}`, verifyActiveKind: 'charge', ...(this.isCeAcCoupledSystem() ? { failCleanupKind: 'charge' } : {}) },
      );
      return steps;
    }

    if (kind === 'discharge') {
      return [
        { restPath: '/enableDischargeSchedule', restBody: { state: 'enable' }, note: `${prefix} -> REST enableDischargeSchedule enable` },
        { restPath: '/setDischargeSlot', restBody: { slot: '1', start, finish }, note: `${prefix} -> REST setDischargeSlot 1 ${start}-${finish}`, verifyActiveKind: 'discharge' },
      ];
    }

    return [];
  }


  buildChargeRateStep(prefix, ratePercent) {
    const clamped = this.clamp(Math.round(Number(ratePercent) || 100), 0, 100);
    return {
      restPath: '/setChargeRate',
      restBody: { chargeRate: String(clamped) },
      note: `${prefix} -> REST setChargeRate ${clamped}%`,
    };
  }

  buildDischargeRateStep(prefix, dischargeKw) {
    const requestedKw = Number(dischargeKw);
    const watts = this.clamp(Math.round((Number.isFinite(requestedKw) && requestedKw > 0 ? requestedKw : this.excessExportDischargeKw) * 1000), 1, 12000);
    return {
      restPath: '/setDischargeRate',
      restBody: { dischargeRate: String(watts) },
      note: `${prefix} -> REST setDischargeRate ${watts}W`,
    };
  }

  buildRestoreDischargeRateStep(prefix) {
    if (!Number.isFinite(this.normalDischargePowerW) || this.normalDischargePowerW <= 0) {
      return null;
    }

    const watts = this.clamp(Math.round(this.normalDischargePowerW), 1, 12000);
    return {
      restPath: '/setDischargeRate',
      restBody: { dischargeRate: String(watts) },
      note: `${prefix} -> REST setDischargeRate restore ${watts}W`,
    };
  }

  estimateChargeRateKw(ratePercent) {
    if (!this.maxBatteryChargePowerKw) {
      return null;
    }
    return (this.maxBatteryChargePowerKw * this.clamp(Number(ratePercent) || 0, 0, 100)) / 100;
  }

  clearSmoothChargeTimers(reason = '') {
    if (!Array.isArray(this.smoothChargeTimers)) {
      this.smoothChargeTimers = [];
      return;
    }

    for (const timer of this.smoothChargeTimers) {
      clearTimeout(timer);
    }
    this.smoothChargeTimers = [];
    this.lastSmoothChargePlanSignature = '';

    // Smooth Charging is parked/disabled by default. Do not emit legacy Smooth logs while inactive.
    if (!this.smoothChargingEnabled || !reason) {
      this.lastSmoothChargeClearSignature = '';
      return;
    }

    const signature = String(reason);
    if (signature !== this.lastSmoothChargeClearSignature) {
      this.lastSmoothChargeClearSignature = signature;
      this.log.debug?.(`[Smooth Charging] cleared timers: ${reason}`);
    }
  }

  getSmoothChargingProfile() {
    const profiles = {
      gentle: { reservePercent: 18, minimumRatePercent: 15, maximumRatePercent: 75 },
      balanced: { reservePercent: 25, minimumRatePercent: 20, maximumRatePercent: 90 },
      strong: { reservePercent: 35, minimumRatePercent: 25, maximumRatePercent: 100 },
    };
    return profiles[this.smoothChargingMode] || profiles.balanced;
  }

  isMainOvernightCheapWindow(snap, now = new Date()) {
    if (!snap?.cheapActive || !snap?.cheapWindowEnd) {
      return false;
    }

    const fallback = this.getClockWindow(now, this.cheapStart, this.cheapEnd);
    if (!fallback.active) {
      return false;
    }

    const source = String(snap.cheapSource || '');
    if (source && !source.includes('off-peak-hours')) {
      return false;
    }

    // Stay deliberately narrow for this beta: Smooth Charging is only for the
    // configured overnight cheap block. Extra IOG dispatches, grace periods and
    // manual smart windows use standard charging until the battery-care model is proven.
    return true;
  }

  shouldUseSmoothCharging(snap, remainingMinutes, now = new Date()) {
    if (!this.smoothChargingEnabled) {
      return false;
    }

    if (!this.maxBatteryChargePowerKw) {
      return false;
    }

    if (!this.excessExportBatteryCapacityKwh) {
      return false;
    }

    if (!this.isMainOvernightCheapWindow(snap, now)) {
      return false;
    }

    if (!Number.isFinite(remainingMinutes) || remainingMinutes < this.smoothChargingWindowMinimumMinutes) {
      return false;
    }

    if (!Number.isFinite(snap?.soc) || snap.soc >= this.targetSoc) {
      return false;
    }

    return true;
  }

  buildSmoothChargePlan(snap, now, endDate) {
    const remainingMinutes = Math.max(1, Math.ceil((endDate.getTime() - now.getTime()) / 60000));
    const remainingHours = remainingMinutes / 60;
    const batteryCapacityKwh = this.excessExportBatteryCapacityKwh;
    const socGap = this.clamp(this.targetSoc - snap.soc, 0, 100);
    const energyNeededKwh = (socGap / 100) * batteryCapacityKwh;
    const requiredAverageKw = remainingHours > 0 ? energyNeededKwh / remainingHours : this.maxBatteryChargePowerKw;
    const profile = this.getSmoothChargingProfile();
    const rawRatePercent = (requiredAverageKw / this.maxBatteryChargePowerKw) * 100;
    const requestedRatePercent = this.clamp(
      Math.ceil(rawRatePercent + profile.reservePercent),
      profile.minimumRatePercent,
      profile.maximumRatePercent,
    );
    const estimatedKw = this.estimateChargeRateKw(requestedRatePercent);

    return {
      mode: 'smooth-night-cheap-slot',
      remainingMinutes,
      batteryCapacityKwh,
      maxBatteryChargePowerKw: this.maxBatteryChargePowerKw,
      soc: snap.soc,
      targetSoc: this.targetSoc,
      socGap,
      energyNeededKwh,
      requiredAverageKw,
      chargeRate: requestedRatePercent,
      estimatedKw,
      careMode: this.smoothChargingMode,
      nextRecheckMinutes: this.smoothChargingUpdateIntervalMinutes,
    };
  }

  buildNeutralizeSlotSteps(prefix, kind, options = {}) {
    if (kind === 'charge') {
      if (this.isCeAcCoupledSystem()) {
        return this.buildCeChargeReinstateSteps(prefix, options);
      }

      return [
        { restPath: '/enableChargeSchedule', restBody: { state: 'disable' }, note: `${prefix} -> REST enableChargeSchedule disable`, continueOnError: true },
        { restPath: '/setChargeSlot', restBody: { slot: '1', start: '00:00', finish: '00:00' }, note: `${prefix} -> REST setChargeSlot 1 00:00-00:00`, continueOnError: true },
        { restPath: '/enableChargeSchedule', restBody: { state: 'disable' }, note: `${prefix} -> REST enableChargeSchedule disable final`, continueOnError: true, verifyClearedKind: options.verifyCleared ? 'charge' : null },
      ];
    }

    if (kind === 'discharge') {
      const steps = [
        { restPath: '/enableDischargeSchedule', restBody: { state: 'disable' }, note: `${prefix} -> REST enableDischargeSchedule disable`, continueOnError: true },
        { restPath: '/setDischargeSlot', restBody: { slot: '1', start: '00:00', finish: '00:00' }, note: `${prefix} -> REST setDischargeSlot 1 00:00-00:00`, continueOnError: true },
        { restPath: '/enableDischargeSchedule', restBody: { state: 'disable' }, note: `${prefix} -> REST enableDischargeSchedule disable final`, continueOnError: true, verifyClearedKind: options.verifyCleared ? 'discharge' : null },
      ];

      const restoreStep = this.buildRestoreDischargeRateStep(prefix);
      if (restoreStep) {
        steps.push(restoreStep);
      }

      return steps;
    }

    return [];
  }

  async runRestStepQueue(label, steps) {
    this.log.info(`${label} -> queued ${steps.length} step(s)`);
    let verifyActiveKind = null;
    let verifyClearedKind = null;
    let verifyCeChargeReinstate = false;
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      try {
        if (step.customAction === 'rememberCeChargeSlot') {
          this.log.info(`${label} step ${i + 1}/${steps.length}: ${step.note}`);
          await this.rememberCeChargeSlotBeforeWrite(label);
        } else if (step.customAction === 'ceChargeNoop') {
          const signature = `${label}|${step.note}`;
          if (signature !== this.lastCeChargeSlotLogSignature) {
            this.lastCeChargeSlotLogSignature = signature;
            this.log.info(`${label} step ${i + 1}/${steps.length}: ${step.note}`);
          }
        } else {
          await this.postRestControl(step.restPath, step.restBody, `${label} step ${i + 1}/${steps.length}: ${step.note}`);
        }
      } catch (err) {
        if (!step.continueOnError) {
          if (step.failCleanupKind) {
            this.log.warn(`${label} step ${i + 1}/${steps.length}: ${step.note} failed; issuing fail-safe ${step.failCleanupKind} cleanup: ${err.message}`);
            try {
              await this.runFailedStartCleanup(label, step.failCleanupKind);
            } catch (cleanupErr) {
              this.log.warn(`${label} fail-safe cleanup also failed: ${cleanupErr.message}`);
            }
          }
          throw err;
        }
        this.log.warn(`${label} step ${i + 1}/${steps.length}: ${step.note} failed; continuing cleanup: ${err.message}`);
      }
      if (step.verifyActiveKind) {
        verifyActiveKind = step.verifyActiveKind;
      }
      if (step.verifyClearedKind) {
        verifyClearedKind = step.verifyClearedKind;
      }
      if (step.verifyCeChargeReinstate) {
        verifyCeChargeReinstate = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 2200));
    }

    if (verifyActiveKind) {
      const activeVerified = await this.verifyTimedActionActive(label, verifyActiveKind);
      if (!activeVerified) {
        await this.runFailedStartCleanup(label, verifyActiveKind);
      }
    }

    if (verifyClearedKind) {
      await this.verifyTimedActionCleared(label, verifyClearedKind);
    }

    if (verifyCeChargeReinstate) {
      await this.verifyCeChargeSlotReinstated(label);
    }
  }

  enqueueManualSequence(label, steps) {
    this.manualQueue = this.manualQueue.then(() => this.runRestStepQueue(label, steps)).catch((err) => {
      this.log.warn(`${label} -> queue error: ${err.message}`);
    });
    return this.manualQueue;
  }

  enqueueAutomationSequence(label, steps) {
    this.automationQueue = this.automationQueue.then(() => this.runRestStepQueue(label, steps)).catch((err) => {
      this.log.warn(`${label} -> queue error: ${err.message}`);
    });
    return this.automationQueue;
  }

  cleanupTimedManualAction(kindOrFamily, reason) {
    const family = kindOrFamily.startsWith('forceCharge') ? 'forceCharge' : kindOrFamily.startsWith('forceExport') ? 'forceExport' : null;
    const slotKind = family === 'forceCharge' ? 'charge' : family === 'forceExport' ? 'discharge' : null;
    if (!slotKind) {
      return;
    }

    const label = family === 'forceCharge' ? 'Charge' : 'Export';

    for (const kind of this.switchKinds) {
      const meta = this.getManualSwitchMeta(kind);
      if (meta?.family !== family) {
        continue;
      }
      this.commandStates[kind] = false;
      if (this.commandTimers.has(kind)) {
        clearTimeout(this.commandTimers.get(kind));
        this.commandTimers.delete(kind);
      }
      if (this.manualCleanupTimers.has(kind)) {
        clearTimeout(this.manualCleanupTimers.get(kind));
        this.manualCleanupTimers.delete(kind);
      }
    }

    this.enqueueManualSequence(`Manual ${label} Cleanup`, this.buildNeutralizeSlotSteps(`Manual ${label} Cleanup (${reason})`, slotKind, { verifyCleared: true }));
    this.refreshAccessories();
  }

  parseTimeToMinutes(value) {
    const text = String(value || '').trim();
    const hhmm = /^\d{4}$/.test(text) ? `${text.slice(0, 2)}:${text.slice(2, 4)}` : text;
    const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return null;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }

    return (hours * 60) + minutes;
  }

  isInWindow(nowMinutes, startMinutes, endMinutes) {
    if (startMinutes === null || endMinutes === null) {
      return false;
    }

    if (startMinutes === endMinutes) {
      return false;
    }

    if (startMinutes < endMinutes) {
      return nowMinutes >= startMinutes && nowMinutes < endMinutes;
    }

    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }

  getClockWindow(now, startText, endText) {
    const startMinutes = this.parseTimeToMinutes(startText);
    const endMinutes = this.parseTimeToMinutes(endText);
    const nowMinutes = (now.getHours() * 60) + now.getMinutes();

    const active = this.isInWindow(nowMinutes, startMinutes, endMinutes);

    const start = new Date(now);
    const end = new Date(now);
    start.setSeconds(0, 0);
    end.setSeconds(0, 0);

    const startHour = Math.floor(startMinutes / 60);
    const startMinute = startMinutes % 60;
    const endHour = Math.floor(endMinutes / 60);
    const endMinute = endMinutes % 60;

    if (startMinutes < endMinutes) {
      start.setHours(startHour, startMinute, 0, 0);
      end.setHours(endHour, endMinute, 0, 0);
    } else {
      if (nowMinutes >= startMinutes) {
        start.setHours(startHour, startMinute, 0, 0);
        end.setDate(end.getDate() + 1);
        end.setHours(endHour, endMinute, 0, 0);
      } else {
        start.setDate(start.getDate() - 1);
        start.setHours(startHour, startMinute, 0, 0);
        end.setHours(endHour, endMinute, 0, 0);
      }
    }

    return { start, end, active };
  }

  ceilToHalfHour(date) {
    const d = new Date(date);
    d.setSeconds(0, 0);

    const minutes = d.getMinutes();
    if (minutes === 0 || minutes === 30) {
      return d;
    }

    if (minutes < 30) {
      d.setMinutes(30, 0, 0);
      return d;
    }

    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d;
  }

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  getNumber(paths, leaf) {
    for (const path of paths) {
      if (this.state.paths.has(path)) {
        const n = Number(this.state.paths.get(path));
        if (!Number.isNaN(n)) {
          return n;
        }
      }
    }

    if (leaf && this.state.leaves.has(leaf)) {
      const n = Number(this.state.leaves.get(leaf));
      if (!Number.isNaN(n)) {
        return n;
      }
    }

    return undefined;
  }

  getText(paths, leaf) {
    for (const path of paths) {
      if (this.state.paths.has(path)) {
        return String(this.state.paths.get(path));
      }
    }

    if (leaf && this.state.leaves.has(leaf)) {
      return String(this.state.leaves.get(leaf));
    }

    return undefined;
  }

  getBatteryBrightness() {
    const soc = this.getNumber(['Power/Power/SOC'], 'SOC');
    return Math.round(this.clamp(Number.isFinite(soc) ? soc : 1, 1, 99));
  }

  getSolarBrightness() {
    if (!this.hasSolarPv) {
      return 0;
    }
    const pvPower = this.getNumber(['Power/Power/PV_Power'], 'PV_Power') || 0;
    const maxPvW = Math.max(100, this.maxPvKw * 1000);
    return this.clamp(Math.round((pvPower / maxPvW) * 100), 0, 100);
  }

  async maybePollOctopus(force) {
    if (!this.octopusApiKey || !this.octopusAccountNumber) {
      return;
    }

    if (this.octopus.polling) {
      return;
    }

    const now = Date.now();
    if (!force && (now - this.octopus.lastPollMs) < (this.octopusPollSeconds * 1000)) {
      return;
    }

    this.octopus.polling = true;

    try {
      const token = await this.getKrakenToken();
      if (!token) {
        throw new Error('No Octopus token available');
      }

      const dispatches = await this.getPlannedDispatches(token);
      this.octopus.dispatches = dispatches;
      this.octopus.lastPollOk = true;
      this.octopus.lastError = null;
      this.octopus.lastPollMs = now;

      this.refreshAccessories();
      this.applyAutomation();
    } catch (err) {
      this.octopus.lastPollOk = false;
      this.octopus.lastError = err.message;
      this.octopus.lastPollMs = now;
      this.octopus.token = null;
      this.log.warn(`Octopus poll failed: ${err.message}`);
    } finally {
      this.octopus.polling = false;
    }
  }

  async getKrakenToken() {
    if (this.octopus.token && (Date.now() - this.octopus.tokenRetrievedAt) < 55 * 60 * 1000) {
      return this.octopus.token;
    }

    const response = await fetch('https://api.octopus.energy/v1/graphql/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `mutation obtainKrakenToken($input: ObtainJSONWebTokenInput!) {
          obtainKrakenToken(input: $input) { token }
        }`,
        variables: {
          input: {
            APIKey: this.octopusApiKey,
          },
        },
      }),
    });

    const body = await response.json();

    if (!response.ok) {
      throw new Error(`Token request HTTP ${response.status}`);
    }

    const token = body?.data?.obtainKrakenToken?.token;
    if (!token) {
      throw new Error('Token response missing token field');
    }

    this.octopus.token = token;
    this.octopus.tokenRetrievedAt = Date.now();

    return token;
  }

  async getPlannedDispatches(token) {
    const response = await fetch('https://api.octopus.energy/v1/graphql/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify({
        query: `query getPlannedDispatches($accountNumber: String!) {
          plannedDispatches(accountNumber: $accountNumber) { startDt endDt }
        }`,
        variables: {
          accountNumber: this.octopusAccountNumber,
        },
      }),
    });

    const body = await response.json();

    if (!response.ok) {
      throw new Error(`Dispatch query HTTP ${response.status}`);
    }

    if (body?.errors?.length) {
      throw new Error(body.errors[0]?.message || 'Dispatch GraphQL error');
    }

    const rows = Array.isArray(body?.data?.plannedDispatches) ? body.data.plannedDispatches : [];

    return rows
      .map((row) => {
        const start = new Date(row.startDt);
        const end = new Date(row.endDt);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
          return null;
        }
        return { start, end };
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start);
  }

  getOctopusCheapState(now) {
    const dispatches = this.octopus.dispatches || [];
    const activeDispatches = dispatches.filter((d) => now >= d.start && now <= d.end);
    const dispatchActive = activeDispatches.length > 0;

    if (dispatchActive) {
      const latestEnd = new Date(Math.max(...activeDispatches.map((d) => d.end.getTime())));
      this.octopus.lastDispatchEnd = latestEnd;

      let cheapUntil = latestEnd;
      const rounded = this.ceilToHalfHour(latestEnd);
      const diffMinutes = Math.round((rounded.getTime() - latestEnd.getTime()) / 60000);

      if (diffMinutes > 0 && diffMinutes <= this.graceMinutes) {
        cheapUntil = rounded;
      }

      this.octopus.lastCheapUntil = cheapUntil;

      return {
        cheapActive: true,
        graceActive: false,
        smartActive: !this.isWithinFallbackWindow(now),
        cheapWindowEnd: cheapUntil,
        source: 'smart-charging',
      };
    }

    if (this.octopus.lastCheapUntil && now < this.octopus.lastCheapUntil) {
      return {
        cheapActive: true,
        graceActive: true,
        smartActive: !this.isWithinFallbackWindow(now),
        cheapWindowEnd: this.octopus.lastCheapUntil,
        source: 'grace-period',
      };
    }

    return {
      cheapActive: false,
      graceActive: false,
      smartActive: false,
      cheapWindowEnd: null,
      source: 'smart-charging',
    };
  }

  isWithinFallbackWindow(now) {
    const window = this.getClockWindow(now, this.cheapStart, this.cheapEnd);
    return window.active;
  }

  getFallbackCheapState(now) {
    const standard = this.getClockWindow(now, this.cheapStart, this.cheapEnd);
    if (standard.active) {
      return {
        cheapActive: true,
        graceActive: false,
        smartActive: false,
        cheapWindowEnd: standard.end,
        source: 'off-peak-hours',
      };
    }

    for (const entry of this.manualSmartWindows) {
      const window = this.getClockWindow(now, entry.start, entry.end);
      if (window.active) {
        return {
          cheapActive: true,
          graceActive: false,
          smartActive: true,
          cheapWindowEnd: window.end,
          source: 'smart-charging',
        };
      }
    }

    return {
      cheapActive: false,
      graceActive: false,
      smartActive: false,
      cheapWindowEnd: null,
      source: 'idle',
    };
  }

  mergeCheapStates(primary, secondary) {
    const cheapActive = Boolean(primary?.cheapActive || secondary?.cheapActive);
    const graceActive = Boolean(primary?.graceActive || secondary?.graceActive);
    const smartActive = Boolean(primary?.smartActive || secondary?.smartActive);

    let cheapWindowEnd = null;
    const ends = [primary?.cheapWindowEnd, secondary?.cheapWindowEnd]
      .filter((value) => value instanceof Date && !Number.isNaN(value.getTime()));
    if (ends.length > 0) {
      cheapWindowEnd = new Date(Math.max(...ends.map((value) => value.getTime())));
    }

    const labels = [];
    if (secondary?.cheapActive && !secondary?.smartActive) {
      labels.push('off-peak-hours');
    }
    if (primary?.smartActive) {
      labels.push(primary.graceActive ? 'grace-period' : 'smart-charging');
    } else if (primary?.graceActive) {
      labels.push('grace-period');
    } else if (primary?.cheapActive) {
      labels.push('smart-charging');
    } else if (secondary?.smartActive) {
      labels.push('smart-charging');
    }

    return {
      cheapActive,
      graceActive,
      smartActive,
      cheapWindowEnd,
      source: labels.length > 0 ? labels.join('+') : 'idle',
    };
  }

  getCheapState(now) {
    const fallback = this.getFallbackCheapState(now);
    const hasOctopusConfig = Boolean(this.octopusApiKey && this.octopusAccountNumber);

    if (hasOctopusConfig && this.octopus.lastPollOk) {
      const octopus = this.getOctopusCheapState(now);
      return this.mergeCheapStates(octopus, fallback);
    }

    return {
      ...fallback,
      source: fallback.cheapActive
        ? (fallback.smartActive ? 'smart-charging' : 'off-peak-hours')
        : 'idle',
    };
  }

  getTelemetrySourceTimestampMs() {
    const candidates = [
      this.getText(['Stats/Last_Updated_Time'], 'Last_Updated_Time'),
      this.getText(['Stats/LastUpdatedTime'], 'LastUpdatedTime'),
      this.getText(['Stats/Last_Update_Time'], 'Last_Update_Time'),
      this.getText(['Stats/last_updated_time'], 'last_updated_time'),
      this.getText(['Last_Updated_Time'], 'Last_Updated_Time'),
    ];

    for (const value of candidates) {
      if (value === undefined || value === null || value === '') {
        continue;
      }

      if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 10_000_000_000 ? value : value * 1000;
      }

      const text = String(value).trim();
      const numeric = Number(text);
      if (Number.isFinite(numeric)) {
        return numeric > 10_000_000_000 ? numeric : numeric * 1000;
      }

      const parsed = Date.parse(text);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  getTelemetryStatus() {
    const now = Date.now();
    const sourceTimestampMs = this.getTelemetrySourceTimestampMs();
    const mqttAgeSeconds = this.state.updatedAt > 0
      ? Math.max(0, (now - this.state.updatedAt) / 1000)
      : Number.POSITIVE_INFINITY;

    let sourceAgeSeconds = null;
    let source = 'mqtt-receive-time';

    if (sourceTimestampMs !== null && Number.isFinite(sourceTimestampMs)) {
      sourceAgeSeconds = Math.max(0, (now - sourceTimestampMs) / 1000);
      source = 'Stats.Last_Updated_Time';
    }

    // Compatibility fallback: if an older GivTCP build does not publish Last_Updated_Time,
    // do not break otherwise working installs. This fallback cannot detect a stale GivTCP cache,
    // but it preserves behaviour until the proper freshness metric appears.
    const ageSeconds = sourceAgeSeconds ?? mqttAgeSeconds;

    let state = 'offline';
    if (ageSeconds < this.telemetryFreshSeconds) {
      state = 'fresh';
    } else if (ageSeconds < this.telemetryOfflineSeconds) {
      state = 'stale';
    }

    const safeForAutomation = !this.enableTelemetryFreshnessGuard || state === 'fresh';

    return {
      state,
      ageSeconds,
      source,
      hasSourceTimestamp: sourceTimestampMs !== null,
      sourceTimestampMs,
      mqttAgeSeconds,
      safeForAutomation,
    };
  }

  logTelemetryRecovery(message, level = 'info', signature = message) {
    if (signature === this.givTcpRecoveryLastLogSignature) {
      return;
    }
    this.givTcpRecoveryLastLogSignature = signature;
    const writer = level === 'warn' ? this.log.warn.bind(this.log) : this.log.info.bind(this.log);
    writer(`[Telemetry Recovery] ${message}`);
  }

  runGivTcpRecoveryCommand() {
    return new Promise((resolve, reject) => {
      execFile('/usr/bin/sudo', ['-n', this.givTcpRecoveryCommand], { timeout: 120_000, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || error.message).trim();
          reject(new Error(detail || error.message));
          return;
        }
        resolve(String(stdout || '').trim());
      });
    });
  }

  async maybeRecoverStaleGivTcp() {
    if (!this.enableGivTcpSelfRecovery || this.givTcpRecoveryInProgress) {
      return;
    }

    const status = this.getTelemetryStatus();
    const now = Date.now();

    if (this.givTcpRecoveryAwaitingFreshTelemetry) {
      const advanced = status.state === 'fresh'
        && status.hasSourceTimestamp
        && Number.isFinite(status.sourceTimestampMs)
        && (!Number.isFinite(this.givTcpRecoveryLastSourceTimestampMs)
          || status.sourceTimestampMs > this.givTcpRecoveryLastSourceTimestampMs);

      if (advanced) {
        this.givTcpRecoveryAwaitingFreshTelemetry = false;
        this.givTcpRecoveryLastLogSignature = '';
        this.log.info(`[Telemetry Recovery] recovered automatically | source=Stats.Last_Updated_Time | age=${Math.round(status.ageSeconds)}s`);
        return;
      }

      const waitSeconds = Math.max(0, Math.round((now - this.givTcpRecoveryStartedAtMs) / 1000));
      if (waitSeconds >= 300) {
        this.givTcpRecoveryAwaitingFreshTelemetry = false;
        this.log.warn('[Telemetry Recovery] telemetry is still stale five minutes after restart; no further restart will be attempted until cooldown expires');
      }
      return;
    }

    if (status.state !== 'offline'
      || !status.hasSourceTimestamp
      || !Number.isFinite(status.ageSeconds)
      || status.ageSeconds < this.givTcpRecoveryStaleSeconds) {
      return;
    }

    const cooldownMs = this.givTcpRecoveryCooldownSeconds * 1000;
    if (this.givTcpRecoveryLastAttemptMs > 0 && (now - this.givTcpRecoveryLastAttemptMs) < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - (now - this.givTcpRecoveryLastAttemptMs)) / 1000);
      this.logTelemetryRecovery(
        `restart suppressed by cooldown | remaining=${remaining}s | telemetry age=${Math.round(status.ageSeconds)}s`,
        'warn',
        `cooldown|${Math.floor(remaining / 300)}`,
      );
      return;
    }

    // Automation is already blocked by the same freshness state. The helper only restarts
    // GivTCP; it must not call inverter-control REST endpoints or mutate schedules.
    this.givTcpRecoveryInProgress = true;
    this.givTcpRecoveryLastAttemptMs = now;
    this.givTcpRecoveryStartedAtMs = now;
    this.givTcpRecoveryLastSourceTimestampMs = status.sourceTimestampMs;
    this.givTcpRecoveryLastLogSignature = '';
    this.log.warn(`[Telemetry Recovery] sustained stale telemetry detected | age=${Math.round(status.ageSeconds)}s | restarting GivTCP once | command=${this.givTcpRecoveryCommand}`);

    try {
      const output = await this.runGivTcpRecoveryCommand();
      this.givTcpRecoveryAwaitingFreshTelemetry = true;
      this.log.info(`[Telemetry Recovery] restart command completed${output ? ` | ${output}` : ''}; waiting for fresh Last_Updated_Time`);
    } catch (err) {
      this.givTcpRecoveryAwaitingFreshTelemetry = false;
      this.log.warn(`[Telemetry Recovery] restart command failed safely: ${err.message}`);
    } finally {
      this.givTcpRecoveryInProgress = false;
    }
  }

  getTelemetryStatusBrightness() {
    const status = this.getTelemetryStatus();
    if (status.state === 'fresh') {
      return 100;
    }
    if (status.state === 'stale') {
      return 50;
    }
    return 1;
  }

  updateTelemetryFreshnessLog(status = this.getTelemetryStatus()) {
    const age = Number.isFinite(status.ageSeconds) ? Math.round(status.ageSeconds) : 'unknown';

    // Log state changes only. This avoids adding log noise while still making stale/fresh transitions explicit.
    const stateSignature = `${status.state}|${status.source}|${status.hasSourceTimestamp}`;
    if (stateSignature !== this.lastTelemetryFreshnessStateSignature) {
      this.lastTelemetryFreshnessStateSignature = stateSignature;
      this.lastTelemetryFreshnessSignature = stateSignature;
      const label = status.state === 'fresh' ? 'FRESH' : status.state === 'stale' ? 'STALE' : 'OFFLINE';
      const metric = status.hasSourceTimestamp ? 'Last_Updated_Time' : 'MQTT receive time fallback';
      const guard = this.enableTelemetryFreshnessGuard ? 'guard=enabled' : 'guard=disabled';
      this.log.info(`[Telemetry] ${label} | age=${age}s | source=${metric} | ${guard}`);
    }
  }

  isTelemetrySafeForAutomation(reason = 'automation') {
    const status = this.getTelemetryStatus();
    this.updateTelemetryFreshnessLog(status);

    if (status.safeForAutomation) {
      this.lastTelemetryAutomationBlockSignature = '';
      return true;
    }

    const age = Number.isFinite(status.ageSeconds) ? Math.round(status.ageSeconds) : 'unknown';
    const signature = `${reason}|${status.state}|${age === 'unknown' ? 'unknown' : Math.floor(Number(age) / 30)}`;
    if (signature !== this.lastTelemetryAutomationBlockSignature) {
      this.lastTelemetryAutomationBlockSignature = signature;
      this.log.warn(`[Telemetry] Automation blocked: ${reason} | state=${status.state} | age=${age}s | source=${status.source}`);
    }

    return false;
  }

  getSnapshot() {
    const soc = this.getNumber(['Power/Power/SOC'], 'SOC');
    const pvPower = this.getNumber(['Power/Power/PV_Power'], 'PV_Power') || 0;
    const importPower = this.getNumber(['Power/Power/Import_Power'], 'Import_Power') || 0;
    const exportPower = this.getNumber(['Power/Power/Export_Power'], 'Export_Power') || 0;
    const chargePower = this.getNumber(['Power/Power/Charge_Power'], 'Charge_Power') || 0;
    const dischargePower = this.getNumber(['Power/Power/Discharge_Power'], 'Discharge_Power') || 0;

    const statusText = this.getText(['Stats/status'], 'status');
    const mqttAgeSeconds = this.state.updatedAt > 0
      ? ((Date.now() - this.state.updatedAt) / 1000)
      : Number.POSITIVE_INFINITY;
    const telemetry = this.getTelemetryStatus();
    const online = (statusText ? statusText.toLowerCase() === 'online' : true)
      && mqttAgeSeconds <= this.staleSeconds
      && telemetry.state !== 'offline';

    const now = new Date();
    const cheap = this.getCheapState(now);

    return {
      soc: soc === undefined ? undefined : this.clamp(soc, 0, 100),
      batteryBrightness: this.getBatteryBrightness(),
      pvPower,
      solarBrightness: this.getSolarBrightness(),
      importPower,
      exportPower,
      chargePower,
      dischargePower,
      online,
      telemetry,
      cheapActive: cheap.cheapActive,
      graceActive: cheap.graceActive,
      smartActive: cheap.smartActive,
      cheapWindowEnd: cheap.cheapWindowEnd,
      cheapSource: cheap.source,
      charging: this.chargePowerActiveThreshold > 0 && chargePower > this.chargePowerActiveThreshold,
      discharging: this.dischargePowerActiveThreshold > 0 && dischargePower > this.dischargePowerActiveThreshold,
      importing: this.importPowerActiveThreshold > 0 && importPower > this.importPowerActiveThreshold,
      exporting: this.exportPowerActiveThreshold > 0 && exportPower > this.exportPowerActiveThreshold,
    };
  }

  refreshAccessories() {
    if (!this.activeSerial && !this.inverterSerial) {
      return;
    }

    const snap = this.getSnapshot();

    this.updateBatterySocAccessory(snap);
    this.updateTelemetryStatusAccessory(snap);
    this.updateSolarAccessory(snap);

    this.updateBinaryAccessory('cheapRate', snap.cheapActive);
    this.updateBinaryAccessory('gracePeriod', snap.graceActive);
    this.updateBinaryAccessory('smartWindow', snap.smartActive);
    this.updateBinaryAccessory('charging', snap.charging);
    this.updateBinaryAccessory('discharging', snap.discharging);
    this.updateBinaryAccessory('importing', snap.importing);
    this.updateBinaryAccessory('exporting', snap.exporting);
    this.updateBinaryAccessory('online', snap.online);

    this.updateEveEnergyHistoryAccessories(snap);
    this.updateSwitchAccessories();

    const signature = [
      snap.cheapActive,
      snap.graceActive,
      snap.smartActive,
      snap.cheapSource,
      snap.cheapWindowEnd ? snap.cheapWindowEnd.toISOString() : 'none',
    ].join('|');

    if (signature !== this.lastStatusSignature) {
      this.lastStatusSignature = signature;
      this.log.info(
        `Octopus state -> cheap=${snap.cheapActive} grace=${snap.graceActive} smart=${snap.smartActive} source=${snap.cheapSource}`,
      );
    }
  }

  updateBatterySocAccessory(snap) {
    const accessory = this.accessories.get('batterySoc');
    if (!accessory) {
      return;
    }

    const service = accessory.getServiceById(this.Service.Lightbulb, 'batterySoc');
    if (!service) {
      return;
    }

    service.updateCharacteristic(this.Characteristic.On, true);
    service.updateCharacteristic(this.Characteristic.Brightness, snap.batteryBrightness);
  }

  updateTelemetryStatusAccessory(snap) {
    const accessory = this.accessories.get('telemetryStatus');
    if (!accessory) {
      return;
    }

    const service = accessory.getServiceById(this.Service.Lightbulb, 'telemetryStatus');
    if (!service) {
      return;
    }

    const status = snap?.telemetry || this.getTelemetryStatus();
    service.updateCharacteristic(this.Characteristic.On, status.safeForAutomation);
    service.updateCharacteristic(this.Characteristic.Brightness, this.getTelemetryStatusBrightness());
    this.updateTelemetryFreshnessLog(status);
  }

  updateSolarAccessory(snap) {
    const accessory = this.accessories.get('solarPower');
    if (!accessory) {
      return;
    }

    const service = accessory.getServiceById(this.Service.Lightbulb, 'solarPower');
    if (!service) {
      return;
    }

    service.updateCharacteristic(this.Characteristic.On, snap.solarBrightness > 0);
    service.updateCharacteristic(this.Characteristic.Brightness, snap.solarBrightness);
  }

  getObservationState(kind) {
    const snap = this.getSnapshot();

    const states = {
      cheapRate: snap.cheapActive,
      gracePeriod: snap.graceActive,
      smartWindow: snap.smartActive,
      charging: snap.charging,
      discharging: snap.discharging,
      importing: snap.importing,
      exporting: snap.exporting,
      online: snap.online,
    };

    return Boolean(states[kind]);
  }

  updateBinaryAccessory(kind, active) {
    const accessory = this.accessories.get(kind);
    if (!accessory) {
      return;
    }

    const service = accessory.getServiceById(this.Service.Lightbulb, kind);
    if (!service) {
      return;
    }

    service.updateCharacteristic(this.Characteristic.On, Boolean(active));
  }

  updateSwitchAccessories() {
    for (const kind of this.switchKinds) {
      const accessory = this.accessories.get(kind);
      if (!accessory) {
        continue;
      }

      const service = accessory.getServiceById(this.Service.Switch, kind);
      if (!service) {
        continue;
      }

      service.updateCharacteristic(this.Characteristic.On, this.getSwitchState(kind));
    }
  }

  isManualOverrideActive() {
    return this.isManualFamilyActive('forceCharge') || this.isManualFamilyActive('forceExport');
  }

  getNextClockTime(timeText, now = new Date()) {
    const minutes = this.parseTimeToMinutes(timeText);
    if (minutes === null) {
      return null;
    }

    const d = new Date(now);
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    if (d <= now) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  }

  getSameDayClockTime(timeText, now = new Date()) {
    const minutes = this.parseTimeToMinutes(timeText);
    if (minutes === null) {
      return null;
    }

    const d = new Date(now);
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return d;
  }

  logExcessExportDecision(message, force = false) {
    const now = Date.now();
    if (!force && message === this.lastExcessExportDecisionSignature && (now - this.lastExcessExportDecisionLogMs) < 10 * 60 * 1000) {
      return;
    }

    this.lastExcessExportDecisionSignature = message;
    this.lastExcessExportDecisionLogMs = now;
    this.log.info(`[Evening Excess Export] ${message}`);
  }

  evaluateExcessEnergyExport(snap, now = new Date()) {
    if (!this.enableExcessEnergyExport) {
      return null;
    }

    if (!this.eveningExcessExportArmed) {
      this.logExcessExportDecision('idle: Evening Excess Export switch is off');
      return null;
    }

    if (!this.excessExportBatteryCapacityKwh) {
      this.logExcessExportDecision('idle: Battery Capacity is missing or invalid');
      return null;
    }

    if (!snap.online) {
      this.logExcessExportDecision('idle: inverter telemetry is offline/stale');
      return null;
    }

    if (!Number.isFinite(snap.soc)) {
      this.logExcessExportDecision('idle: SOC unavailable');
      return null;
    }

    if (snap.cheapActive || snap.smartActive || snap.graceActive) {
      this.logExcessExportDecision(`idle: protected Octopus window active cheap=${snap.cheapActive} smart=${snap.smartActive} grace=${snap.graceActive}`);
      return null;
    }

    if (snap.charging || snap.chargePower > this.chargePowerActiveThreshold) {
      this.logExcessExportDecision(`idle: battery is currently charging (${Math.round(snap.chargePower)}W)`);
      return null;
    }

    const cheapStart = this.getNextClockTime(this.cheapStart, now);
    const eveningStart = this.getSameDayClockTime(this.excessExportStart, now);
    if (!cheapStart || !eveningStart) {
      this.logExcessExportDecision('idle: invalid Evening Excess Export time configuration');
      return null;
    }

    // If cheapStart rolled to tomorrow but the evening start has not happened today yet, use today's cheapStart.
    const todayCheapStart = this.getSameDayClockTime(this.cheapStart, now);
    const effectiveCheapStart = todayCheapStart && todayCheapStart > now ? todayCheapStart : cheapStart;

    if (now < eveningStart || now >= effectiveCheapStart) {
      this.logExcessExportDecision(`idle: outside evening sell-off window ${this.excessExportStart}-${this.cheapStart}`);
      return null;
    }

    const minutesUntilCheap = Math.max(0, Math.floor((effectiveCheapStart.getTime() - now.getTime()) / 60000));
    if (minutesUntilCheap < 5) {
      this.logExcessExportDecision('idle: too close to cheap window start');
      return null;
    }

    const slotMinutes = Math.min(this.excessExportSlotMinutes, minutesUntilCheap);

    const liveDischargeSlot = this.getLiveSlotState('discharge');
    if (liveDischargeSlot?.active
      && liveDischargeSlot.start instanceof Date
      && liveDischargeSlot.end instanceof Date
      && now >= liveDischargeSlot.start
      && now < liveDischargeSlot.end
      && liveDischargeSlot.end <= effectiveCheapStart) {
      return {
        mode: 'evening_excess_export',
        start: liveDischargeSlot.start,
        end: liveDischargeSlot.end,
        forceMinutes: Math.max(1, Math.round((liveDischargeSlot.end.getTime() - liveDischargeSlot.start.getTime()) / 60000)),
        activeSlotReused: true,
        recoveredFromInverter: true,
        minutesUntilCheap,
      };
    }

    if (this.activeExcessExportSlot
      && this.activeExcessExportSlot.start instanceof Date
      && this.activeExcessExportSlot.end instanceof Date
      && now >= this.activeExcessExportSlot.start
      && now < this.activeExcessExportSlot.end
      && this.activeExcessExportSlot.end <= effectiveCheapStart) {
      return {
        ...this.activeExcessExportSlot,
        mode: 'evening_excess_export',
        activeSlotReused: true,
        recoveredFromInverter: false,
        minutesUntilCheap,
      };
    }

    const kwhPerSlot = this.excessExportDischargeKw * (this.excessExportSlotMinutes / 60);
    const socDropPerSlot = (kwhPerSlot / this.excessExportBatteryCapacityKwh) * 100;
    const slotsRemaining = Math.max(1, Math.ceil(minutesUntilCheap / this.excessExportSlotMinutes));
    const minSocTarget = this.excessExportReserveSoc + ((slotsRemaining - 1) * socDropPerSlot);
    const triggerSoc = minSocTarget + this.excessExportTriggerMarginSoc;

    if (minSocTarget >= 100) {
      this.logExcessExportDecision(`idle: ladder reserve above 100% this early in window target=${minSocTarget.toFixed(1)}% minsUntilCheap=${minutesUntilCheap}`);
      return null;
    }

    if (snap.soc <= triggerSoc) {
      this.logExcessExportDecision(`idle: SOC ${snap.soc.toFixed(1)}% <= trigger ${triggerSoc.toFixed(1)}% (reserve ladder ${minSocTarget.toFixed(1)}%)`);
      return null;
    }

    const start = new Date(now);
    start.setSeconds(0, 0);
    const end = new Date(start.getTime() + (slotMinutes * 60000));
    if (end > effectiveCheapStart) {
      end.setTime(effectiveCheapStart.getTime());
    }

    return {
      mode: 'evening_excess_export',
      start,
      end,
      forceMinutes: slotMinutes,
      minSocTarget,
      triggerSoc,
      socDropPerSlot,
      slotsRemaining,
      minutesUntilCheap,
    };
  }

  applyAutomation() {
    if (!this.client || !this.client.connected || !this.activeSerial) {
      return;
    }

    if (this.isManualOverrideActive()) {
      this.clearSmoothChargeTimers('manual override active');
      return;
    }

    const snap = this.getSnapshot();

    if (!this.isTelemetrySafeForAutomation('automatic control')) {
      this.clearSmoothChargeTimers('telemetry not fresh');
      return;
    }

    let desired = {
      mode: 'eco',
      chargePct: 100,
      forceMinutes: 0,
      smooth: false,
      smoothPlan: null,
    };

    if (snap.online && snap.cheapActive && Number.isFinite(snap.soc) && snap.soc < this.targetSoc && snap.cheapWindowEnd) {
      const now = new Date();
      const remainingMinutes = Math.max(1, Math.ceil((snap.cheapWindowEnd.getTime() - now.getTime()) / 60000));
      const smooth = this.shouldUseSmoothCharging(snap, remainingMinutes, now);
      const smoothPlan = smooth ? this.buildSmoothChargePlan(snap, now, snap.cheapWindowEnd) : null;
      const initialRate = smoothPlan?.chargeRate ?? 100;

      desired = {
        mode: 'charge',
        chargePct: smooth ? initialRate : 100,
        forceMinutes: remainingMinutes,
        smooth,
        smoothPlan,
      };
    } else {
      const excessExport = this.evaluateExcessEnergyExport(snap);
      if (excessExport) {
        desired = {
          mode: 'evening_excess_export',
          chargePct: 100,
          forceMinutes: excessExport.forceMinutes,
          smooth: false,
          smoothPlan: null,
          excessExport,
        };
      }
    }

    const bucketedMinutes = desired.forceMinutes > 0 ? Math.ceil(desired.forceMinutes / 5) * 5 : 0;
    const signature = JSON.stringify({
      mode: desired.mode,
      chargePct: desired.chargePct,
      forceMinutes: bucketedMinutes,
      smooth: desired.smooth,
      smoothRate: desired.smoothPlan ? desired.smoothPlan.chargeRate : null,
      smoothMode: desired.smoothPlan ? desired.smoothPlan.careMode : null,
      smoothEnergyNeededKwh: desired.smoothPlan ? Number(desired.smoothPlan.energyNeededKwh.toFixed(2)) : null,
      maxBatteryChargePowerKw: desired.smoothPlan ? desired.smoothPlan.maxBatteryChargePowerKw : null,
      cheapWindowEnd: snap.cheapWindowEnd ? snap.cheapWindowEnd.toISOString() : null,
      smoothBucket: desired.smoothPlan ? Math.floor(Date.now() / (this.smoothChargingUpdateIntervalMinutes * 60 * 1000)) : null,
      excessStart: desired.excessExport ? this.formatSlotTime(desired.excessExport.start) : null,
      excessEnd: desired.excessExport ? this.formatSlotTime(desired.excessExport.end) : null,
      excessReserve: desired.excessExport ? Math.round(desired.excessExport.minSocTarget) : null,
    });

    if (signature === this.lastAutomationSignature) {
      return;
    }

    this.lastAutomationSignature = signature;

    if (desired.mode === 'charge') {
      const end = new Date(Date.now() + (Math.max(1, bucketedMinutes) * 60000));
      const steps = [];
      if (this.excessEnergyExportActive) {
        steps.push(...this.buildNeutralizeSlotSteps('Automation CHARGE', 'discharge', { verifyCleared: true }));
        this.excessEnergyExportActive = false;
        this.activeExcessExportSlot = null;
      }
      if (desired.smooth) {
        steps.push(this.buildChargeRateStep('Automation CHARGE', desired.chargePct));
      }
      steps.push(...this.buildTimedSlotSteps('Automation CHARGE', 'charge', new Date(), end, this.targetSoc));
      this.enqueueAutomationSequence('Automation CHARGE', steps);

      if (desired.smooth && desired.smoothPlan) {
        this.clearSmoothChargeTimers('smooth adaptive recheck');
        this.lastSmoothChargeRatePercent = desired.smoothPlan.chargeRate;
        const kwText = Number.isFinite(desired.smoothPlan.estimatedKw) ? ` ≈ ${desired.smoothPlan.estimatedKw.toFixed(2)}kW` : '';
        this.log.info(`Automation -> CHARGE | pct=${desired.smoothPlan.chargeRate}${kwText} | mins=${bucketedMinutes} | smooth=true | mode=${desired.smoothPlan.careMode} | energyNeeded=${desired.smoothPlan.energyNeededKwh.toFixed(2)}kWh | avgNeeded=${desired.smoothPlan.requiredAverageKw.toFixed(2)}kW | max=${desired.smoothPlan.maxBatteryChargePowerKw}kW | scope=overnight-cheap-slot`);
      } else {
        this.clearSmoothChargeTimers('standard charge');
        this.log.info(`Automation -> CHARGE | mins=${bucketedMinutes} | smooth=false | chargeRate=untouched`);
      }
      return;
    }

    if (desired.mode === 'evening_excess_export') {
      this.clearSmoothChargeTimers('evening excess export');
      const info = desired.excessExport;
      this.excessEnergyExportActive = true;

      if (info.activeSlotReused) {
        this.activeExcessExportSlot = { ...info, start: new Date(info.start), end: new Date(info.end) };
        const source = info.recoveredFromInverter ? 'inverter truth' : 'memory';
        this.log.info(`Automation -> EVENING_EXCESS_EXPORT | active slot retained ${this.formatSlotTime(info.start)}-${this.formatSlotTime(info.end)} | source=${source} | soc=${snap.soc.toFixed(1)}% | minsUntilCheap=${info.minutesUntilCheap}`);
        return;
      }

      const steps = [
        this.buildDischargeRateStep('Automation Evening Excess Export', this.excessExportDischargeKw),
        ...this.buildTimedSlotSteps('Automation Evening Excess Export', 'discharge', info.start, info.end),
      ];
      this.activeExcessExportSlot = { ...info, start: new Date(info.start), end: new Date(info.end) };
      this.enqueueAutomationSequence('Automation Evening Excess Export', steps);
      const dischargeWatts = Math.round(this.excessExportDischargeKw * 1000);
      this.log.info(`Automation -> EVENING_EXCESS_EXPORT | ${this.formatSlotTime(info.start)}-${this.formatSlotTime(info.end)} | dischargeRate=${dischargeWatts}W | soc=${snap.soc.toFixed(1)}% | ladder=${info.minSocTarget.toFixed(1)}% | trigger=${info.triggerSoc.toFixed(1)}% | slotsRemaining=${info.slotsRemaining} | minsUntilCheap=${info.minutesUntilCheap}`);
      return;
    }

    this.clearSmoothChargeTimers('eco');
    const steps = this.excessEnergyExportActive
      ? this.buildNeutralizeSlotSteps('Automation ECO', 'discharge', { verifyCleared: true })
      : this.buildNeutralizeSlotSteps('Automation ECO', 'charge', { verifyCleared: true });
    this.excessEnergyExportActive = false;
    this.activeExcessExportSlot = null;
    this.enqueueAutomationSequence('Automation ECO', steps);
    this.log.info('Automation -> ECO');
  }
}
