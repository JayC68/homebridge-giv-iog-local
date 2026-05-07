'use strict';

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');

const PLUGIN_NAME = 'homebridge-giv-iog-local';
const PLATFORM_NAME = 'GivEnergy Local + Intelligent Octopus Go';
const BUILD_VERSION = '3.4.2-beta-1';

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

    this.platformName = this.config.name || 'GivHome';

    this.mqttUrl = this.config.mqttUrl || 'mqtt://127.0.0.1:1883';
    this.mqttUsername = this.config.mqttUsername || '';
    this.mqttPassword = this.config.mqttPassword || '';
    this.mqttRootTopic = (this.config.mqttRootTopic || 'GivEnergy').replace(/\/+$/, '');
    this.givTcpRestUrl = (this.config.givTcpRestUrl || 'http://127.0.0.1:6345').replace(/\/+$/, '');
    this.inverterSerial = (this.config.inverterSerial || '').trim();
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

    this.maxPvKw = Number.isFinite(this.config.maxPvKw)
      ? this.config.maxPvKw
      : 2.88;

    this.manualSmartWindows = this.parseSmartWindows(this.config.smartWindowsJson || '[]');

    this.forceChargeMinutes = Number.isFinite(this.config.forceChargeMinutes) ? this.config.forceChargeMinutes : 60;
    this.forceExportMinutes = Number.isFinite(this.config.forceExportMinutes) ? this.config.forceExportMinutes : 60;
    this.slotToleranceMinutes = Number.isFinite(this.config.slotToleranceMinutes) ? this.config.slotToleranceMinutes : 10;

    this.manualDurations = {
      forceCharge: [30, 60, 90, 120],
      forceExport: [30, 60, 90, 120],
    };

    // Activity thresholds are split by sensor to reduce Home app notification noise from normal battery breathing.
    // Charge_Power includes solar charging, so the default stays low enough for UK winter PV.
    this.chargeActiveThresholdW = Number.isFinite(this.config.chargeActiveThresholdW) ? this.config.chargeActiveThresholdW : 1000;
    this.solarChargeActiveThresholdW = Number.isFinite(this.config.solarChargeActiveThresholdW) ? this.config.solarChargeActiveThresholdW : 250;
    this.dischargeActiveThresholdW = Number.isFinite(this.config.dischargeActiveThresholdW) ? this.config.dischargeActiveThresholdW : 250;
    this.importActiveThresholdW = Number.isFinite(this.config.importActiveThresholdW) ? this.config.importActiveThresholdW : 250;
    this.exportActiveThresholdW = Number.isFinite(this.config.exportActiveThresholdW) ? this.config.exportActiveThresholdW : 1000;

    // Legacy fallback for users upgrading with only the old single threshold set.
    this.powerActiveThreshold = Number.isFinite(this.config.powerActiveThreshold) ? this.config.powerActiveThreshold : 20;

    this.staleSeconds = Number.isFinite(this.config.staleSeconds) ? this.config.staleSeconds : 180;

    this.updateCheckEnabled = this.config.updateCheckEnabled !== false;
    this.updatePollHours = Number.isFinite(this.config.updatePollHours) ? this.config.updatePollHours : 24;
    this.updateCheckUrl = this.config.updateCheckUrl || 'https://registry.npmjs.org/homebridge-giv-iog-local/latest';

    this.accessories = new Map();
    this.client = null;

    this.state = {
      paths: new Map(),
      leaves: new Map(),
      updatedAt: 0,
    };

    this.commandStates = {};

    this.commandTimers = new Map();
    this.manualSessionFile = path.join(process.env.HOMEBRIDGE_STORAGE_PATH || '/var/lib/homebridge', '.givhome-manual-sessions.json');
    this.manualSessions = this.loadManualSessions();
    this.restoreManualSessionTimers();

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

    this.updateStatus = {
      checking: false,
      updateAvailable: false,
      latestVersion: null,
      lastCheckedMs: 0,
      lastError: null,
    };

    this.lastAutomationSignature = '';
    this.lastStatusSignature = '';

    this.sensorKinds = [
      'cheapRate',
      'gracePeriod',
      'smartWindow',
      'charging',
      'discharging',
      'importing',
      'exporting',
      'online',
      'updateAvailable',
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
    ];

    this.api.on('didFinishLaunching', () => {
      if (this.activeSerial) {
        this.ensureAccessories();
      }

      this.startLoops();
      this.connectMqtt();
      this.maybePollOctopus(true).catch((err) => {
        this.log.warn(`Initial Octopus poll failed: ${err.message}`);
      });

      this.maybeCheckForUpdates(true).catch((err) => {
        this.log.warn(`Initial update check failed: ${err.message}`);
      });
    });
  }

  configureAccessory(accessory) {
    if (accessory?.context?.kind) {
      this.accessories.set(accessory.context.kind, accessory);
    }
  }

  startLoops() {
    setInterval(() => {
      this.refreshAccessories();
      this.applyAutomation();
    }, 30_000);

    setInterval(() => {
      this.maybePollOctopus(false).catch((err) => {
        this.log.warn(`Octopus poll error: ${err.message}`);
      });
    }, 30_000);

    setInterval(() => {
      this.maybeCheckForUpdates(false).catch((err) => {
        this.log.warn(`Update check error: ${err.message}`);
      });
    }, 60 * 60 * 1000);
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
      'solarPower',
      ...this.sensorKinds,
      ...this.switchKinds,
    ]);
  }

  getManualSwitchMeta(kind) {
    if (kind === 'forceCharge') {
      return { family: 'forceCharge', slotKind: 'charge', minutes: 60, displayAction: 'Force Charge' };
    }

    if (kind === 'forceExport') {
      return { family: 'forceExport', slotKind: 'discharge', minutes: 60, displayAction: 'Force Export' };
    }

    let match = kind.match(/^forceCharge(30|90|120)$/);
    if (match) {
      return { family: 'forceCharge', slotKind: 'charge', minutes: Number(match[1]), displayAction: 'Force Charge' };
    }

    match = kind.match(/^forceExport(30|90|120)$/);
    if (match) {
      return { family: 'forceExport', slotKind: 'discharge', minutes: Number(match[1]), displayAction: 'Force Export' };
    }

    return null;
  }

  ensureAccessories() {
    const serial = this.activeSerial || this.inverterSerial || 'pending';

    this.ensureAccessory('batterySoc', `${this.platformName} Battery SOC`, this.Categories.WINDOW_COVERING);
    this.ensureAccessory('solarPower', `${this.platformName} Solar Power`, this.Categories.LIGHTBULB);

    this.ensureAccessory('cheapRate', `${this.platformName} Cheap Rate`, this.Categories.SENSOR);
    this.ensureAccessory('gracePeriod', `${this.platformName} Grace Period`, this.Categories.SENSOR);
    this.ensureAccessory('smartWindow', `${this.platformName} Smart Window`, this.Categories.SENSOR);
    this.ensureAccessory('charging', `${this.platformName} Charging`, this.Categories.SENSOR);
    this.ensureAccessory('discharging', `${this.platformName} Discharging`, this.Categories.SENSOR);
    this.ensureAccessory('importing', `${this.platformName} Importing`, this.Categories.SENSOR);
    this.ensureAccessory('exporting', `${this.platformName} Exporting`, this.Categories.SENSOR);
    this.ensureAccessory('online', `${this.platformName} Online`, this.Categories.SENSOR);
    this.ensureAccessory('updateAvailable', `${this.platformName} Update Available`, this.Categories.SENSOR);

    this.ensureAccessory('forceCharge', 'Charge 60m', this.Categories.SWITCH);
    this.ensureAccessory('forceCharge30', 'Charge 30m', this.Categories.SWITCH);
    this.ensureAccessory('forceCharge90', 'Charge 90m', this.Categories.SWITCH);
    this.ensureAccessory('forceCharge120', 'Charge 120m', this.Categories.SWITCH);

    this.ensureAccessory('forceExport', 'Export 60m', this.Categories.SWITCH);
    this.ensureAccessory('forceExport30', 'Export 30m', this.Categories.SWITCH);
    this.ensureAccessory('forceExport90', 'Export 90m', this.Categories.SWITCH);
    this.ensureAccessory('forceExport120', 'Export 120m', this.Categories.SWITCH);

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

    accessory.displayName = displayName;
    accessory.context.kind = kind;
    accessory.context.serial = serial;

    this.configureAccessoryServices(accessory, kind, displayName);

    this.accessories.set(kind, accessory);

    if (isNew) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  configureAccessoryServices(accessory, kind, displayName) {
    const info = accessory.getService(this.Service.AccessoryInformation)
      || accessory.addService(this.Service.AccessoryInformation);

    info.setCharacteristic(this.Characteristic.Manufacturer, 'JayC68 / OpenAI')
      .setCharacteristic(this.Characteristic.Model, 'GivTCP MQTT + Octopus')
      .setCharacteristic(this.Characteristic.SerialNumber, this.activeSerial || this.inverterSerial || 'pending')
      .setCharacteristic(this.Characteristic.FirmwareRevision, BUILD_VERSION);

    if (kind === 'batterySoc') {
      const legacy = accessory.getServiceById(this.Service.WindowCovering, 'batterySoc');
      if (legacy) {
        accessory.removeService(legacy);
      }

      const service = accessory.getServiceById(this.Service.Lightbulb, 'batterySoc')
        || accessory.addService(this.Service.Lightbulb, displayName, 'batterySoc');

      service.getCharacteristic(this.Characteristic.On)
        .onGet(() => true)
        .onSet(async () => {});

      service.getCharacteristic(this.Characteristic.Brightness)
        .onGet(() => this.getBatteryBrightness())
        .onSet(async () => {});

      return;
    }

    if (kind === 'solarPower') {
      const service = accessory.getServiceById(this.Service.Lightbulb, 'solarPower')
        || accessory.addService(this.Service.Lightbulb, displayName, 'solarPower');

      service.getCharacteristic(this.Characteristic.On)
        .onGet(() => this.getSolarBrightness() > 0)
        .onSet(async () => {});

      service.getCharacteristic(this.Characteristic.Brightness)
        .onGet(() => this.getSolarBrightness())
        .onSet(async () => {});

      return;
    }

    if (this.sensorKinds.includes(kind)) {
      const service = accessory.getServiceById(this.Service.OccupancySensor, kind)
        || accessory.addService(this.Service.OccupancySensor, displayName, kind);
      service.setCharacteristic(this.Characteristic.Name, displayName);
      return;
    }

    if (this.switchKinds.includes(kind)) {
      const service = accessory.getServiceById(this.Service.Switch, kind)
        || accessory.addService(this.Service.Switch, displayName, kind);
      service.setCharacteristic(this.Characteristic.Name, displayName);

      service.getCharacteristic(this.Characteristic.On)
        .onGet(() => this.getSwitchState(kind))
        .onSet(async (value) => {
          await this.handleSwitchSet(kind, Boolean(value));
        });
    }
  }

  async handleSwitchSet(kind, value) {
    const meta = this.getManualSwitchMeta(kind);
    if (!meta) {
      return;
    }

    if (value) {
      const start = new Date();
      const end = new Date(Date.now() + (meta.minutes * 60000));
      const label = `Manual ${meta.displayAction} ${meta.minutes}m`;
      this.clearSiblingManualIntents(kind, meta.family);
      this.setManualSession(kind, meta, start, end);
      this.enqueueManualSequence(label, this.buildTimedSlotSteps(label, meta.slotKind, start, end, meta.slotKind === 'charge' ? this.targetSoc : null));
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

  loadManualSessions() {
    try {
      if (!fs.existsSync(this.manualSessionFile)) {
        return {};
      }

      const parsed = JSON.parse(fs.readFileSync(this.manualSessionFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }

      const now = Date.now();
      const active = {};
      for (const [kind, session] of Object.entries(parsed)) {
        if (!session || typeof session !== 'object') {
          continue;
        }
        if (!Number.isFinite(session.expiresAtMs) || session.expiresAtMs <= now) {
          continue;
        }
        active[kind] = session;
      }
      return active;
    } catch (err) {
      this.log.warn(`Manual session state could not be loaded: ${err.message}`);
      return {};
    }
  }

  saveManualSessions() {
    try {
      fs.writeFileSync(this.manualSessionFile, JSON.stringify(this.manualSessions, null, 2));
    } catch (err) {
      this.log.warn(`Manual session state could not be saved: ${err.message}`);
    }
  }

  restoreManualSessionTimers() {
    for (const [kind, session] of Object.entries(this.manualSessions)) {
      this.scheduleManualSessionExpiry(kind, session.expiresAtMs);
    }
  }

  scheduleManualSessionExpiry(kind, expiresAtMs) {
    if (this.commandTimers.has(kind)) {
      clearTimeout(this.commandTimers.get(kind));
      this.commandTimers.delete(kind);
    }

    const delayMs = Math.max(1, Number(expiresAtMs) - Date.now());
    const timer = setTimeout(() => {
      if (this.manualSessions[kind] && this.manualSessions[kind].expiresAtMs <= Date.now()) {
        delete this.manualSessions[kind];
        this.saveManualSessions();
        this.log.info(`Manual ${kind} session expired`);
        this.refreshAccessories();
      }
      this.commandTimers.delete(kind);
    }, delayMs);
    this.commandTimers.set(kind, timer);
  }

  setManualSession(kind, meta, start, end) {
    const session = {
      kind,
      family: meta.family,
      slotKind: meta.slotKind,
      minutes: meta.minutes,
      startedAtMs: start.getTime(),
      expiresAtMs: end.getTime(),
    };

    this.manualSessions[kind] = session;
    this.saveManualSessions();
    this.scheduleManualSessionExpiry(kind, session.expiresAtMs);
    this.log.info(`Manual ${kind} session active until ${end.toISOString()}`);
  }

  getActiveManualSession(kind) {
    const session = this.manualSessions[kind];
    if (!session) {
      return null;
    }

    if (!Number.isFinite(session.expiresAtMs) || session.expiresAtMs <= Date.now()) {
      delete this.manualSessions[kind];
      this.saveManualSessions();
      if (this.commandTimers.has(kind)) {
        clearTimeout(this.commandTimers.get(kind));
        this.commandTimers.delete(kind);
      }
      return null;
    }

    return session;
  }

  clearManualSession(kind) {
    if (this.manualSessions[kind]) {
      delete this.manualSessions[kind];
      this.saveManualSessions();
    }
    if (this.commandTimers.has(kind)) {
      clearTimeout(this.commandTimers.get(kind));
      this.commandTimers.delete(kind);
    }
  }

  clearManualSessionsForFamily(family, exceptKind = null) {
    let changed = false;
    for (const [kind, session] of Object.entries(this.manualSessions)) {
      if (session?.family !== family || kind === exceptKind) {
        continue;
      }
      delete this.manualSessions[kind];
      changed = true;
      if (this.commandTimers.has(kind)) {
        clearTimeout(this.commandTimers.get(kind));
        this.commandTimers.delete(kind);
      }
    }
    if (changed) {
      this.saveManualSessions();
    }
  }

  clearSiblingManualIntents(activeKind, family) {
    this.clearManualSessionsForFamily(family, activeKind);
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
    }
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

  getSwitchState(kind) {
    const meta = this.getManualSwitchMeta(kind);
    if (!meta) {
      return false;
    }

    if (this.getActiveManualSession(kind)) {
      return true;
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

    this.log.info(`REST control -> ${path} = ${JSON.stringify(body)} :: ${text}`);
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
      return [
        { restPath: '/enableChargeSchedule', restBody: { state: 'enable' }, note: `${prefix} -> REST enableChargeSchedule enable` },
        { restPath: '/setChargeSlot', restBody: body, note: `${prefix} -> REST setChargeSlot 1 ${start}-${finish}` },
      ];
    }

    if (kind === 'discharge') {
      return [
        { restPath: '/enableDischargeSchedule', restBody: { state: 'enable' }, note: `${prefix} -> REST enableDischargeSchedule enable` },
        { restPath: '/setDischargeSlot', restBody: { slot: '1', start, finish }, note: `${prefix} -> REST setDischargeSlot 1 ${start}-${finish}` },
      ];
    }

    return [];
  }

  buildNeutralizeSlotSteps(prefix, kind) {
    if (kind === 'charge') {
      return [
        { restPath: '/enableChargeSchedule', restBody: { state: 'disable' }, note: `${prefix} -> REST enableChargeSchedule disable` },
        { restPath: '/setChargeSlot', restBody: { slot: '1', start: '00:00', finish: '00:00' }, note: `${prefix} -> REST setChargeSlot 1 00:00-00:00` },
      ];
    }

    if (kind === 'discharge') {
      return [
        { restPath: '/enableDischargeSchedule', restBody: { state: 'disable' }, note: `${prefix} -> REST enableDischargeSchedule disable` },
        { restPath: '/setDischargeSlot', restBody: { slot: '1', start: '00:00', finish: '00:00' }, note: `${prefix} -> REST setDischargeSlot 1 00:00-00:00` },
      ];
    }

    return [];
  }

  async runRestStepQueue(label, steps) {
    this.log.info(`${label} -> queued ${steps.length} step(s)`);
    for (let i = 0; i < steps.length; i += 1) {
      await this.postRestControl(steps[i].restPath, steps[i].restBody, `${label} step ${i + 1}/${steps.length}: ${steps[i].note}`);
      await new Promise((resolve) => setTimeout(resolve, 2200));
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

    const label = family === 'forceCharge' ? 'Force Charge' : 'Force Export';

    this.clearManualSessionsForFamily(family);

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
    }

    this.enqueueManualSequence(`Manual ${label} Cleanup`, this.buildNeutralizeSlotSteps(`Manual ${label} Cleanup (${reason})`, slotKind));
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
    const pvPower = this.getNumber(['Power/Power/PV_Power'], 'PV_Power') || 0;
    const maxPvW = Math.max(100, this.maxPvKw * 1000);
    return this.clamp(Math.round((pvPower / maxPvW) * 100), 0, 100);
  }


  async maybeCheckForUpdates(force) {
    if (!this.updateCheckEnabled) {
      return;
    }

    if (this.updateStatus.checking) {
      return;
    }

    const now = Date.now();
    const intervalMs = Math.max(1, this.updatePollHours) * 60 * 60 * 1000;
    if (!force && (now - this.updateStatus.lastCheckedMs) < intervalMs) {
      return;
    }

    this.updateStatus.checking = true;

    try {
      const response = await fetch(this.updateCheckUrl, {
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Update check failed (${response.status})`);
      }

      const data = await response.json();
      const latest = String(data.version || '').trim();
      if (!latest) {
        throw new Error('Update check response did not include a version');
      }

      const available = this.isVersionGreater(latest, BUILD_VERSION);
      const changed = available !== this.updateStatus.updateAvailable || latest !== this.updateStatus.latestVersion;

      this.updateStatus.latestVersion = latest;
      this.updateStatus.updateAvailable = available;
      this.updateStatus.lastCheckedMs = now;
      this.updateStatus.lastError = null;

      if (changed) {
        if (available) {
          this.log.warn(`GivHome update available: ${BUILD_VERSION} -> ${latest}`);
        } else {
          this.log.info(`GivHome update check ok: running ${BUILD_VERSION}, latest ${latest}`);
        }
        this.refreshAccessories();
      }
    } catch (err) {
      this.updateStatus.lastCheckedMs = now;
      this.updateStatus.lastError = err.message;
      this.log.warn(`GivHome update check failed: ${err.message}`);
    } finally {
      this.updateStatus.checking = false;
    }
  }

  parseVersion(version) {
    const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?/);
    if (!match) {
      return null;
    }

    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      pre: match[4] || '',
    };
  }

  comparePrerelease(a, b) {
    if (!a && !b) {
      return 0;
    }
    if (!a) {
      return 1;
    }
    if (!b) {
      return -1;
    }

    const aParts = a.split('.').join('-').split('-');
    const bParts = b.split('.').join('-').split('-');
    const len = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < len; i += 1) {
      const av = aParts[i];
      const bv = bParts[i];
      if (av === undefined) {
        return -1;
      }
      if (bv === undefined) {
        return 1;
      }

      const an = Number(av);
      const bn = Number(bv);
      const bothNumeric = !Number.isNaN(an) && !Number.isNaN(bn);
      if (bothNumeric && an !== bn) {
        return an > bn ? 1 : -1;
      }
      if (!bothNumeric && av !== bv) {
        return av > bv ? 1 : -1;
      }
    }

    return 0;
  }

  isVersionGreater(candidate, current) {
    const a = this.parseVersion(candidate);
    const b = this.parseVersion(current);
    if (!a || !b) {
      return false;
    }

    for (const key of ['major', 'minor', 'patch']) {
      if (a[key] !== b[key]) {
        return a[key] > b[key];
      }
    }

    return this.comparePrerelease(a.pre, b.pre) > 0;
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


  getChargingActiveThresholdW(chargePower, importPower, pvPower, cheapState = {}) {
    // Charge_Power can represent both intentional grid charging and solar-to-battery charging.
    // Use a higher threshold for grid/cheap-slot charging to suppress Home notification noise,
    // but keep solar charging responsive for low UK winter PV generation.
    const intentionalGridCharge = Boolean(
      cheapState.cheapActive
      || cheapState.smartActive
      || cheapState.graceActive
      || importPower >= this.importActiveThresholdW
    );

    if (intentionalGridCharge) {
      return this.chargeActiveThresholdW;
    }

    if (pvPower >= this.solarChargeActiveThresholdW) {
      return this.solarChargeActiveThresholdW;
    }

    return this.solarChargeActiveThresholdW;
  }

  getSnapshot() {
    const soc = this.getNumber(['Power/Power/SOC'], 'SOC');
    const pvPower = this.getNumber(['Power/Power/PV_Power'], 'PV_Power') || 0;
    const importPower = this.getNumber(['Power/Power/Import_Power'], 'Import_Power') || 0;
    const exportPower = this.getNumber(['Power/Power/Export_Power'], 'Export_Power') || 0;
    const chargePower = this.getNumber(['Power/Power/Charge_Power'], 'Charge_Power') || 0;
    const dischargePower = this.getNumber(['Power/Power/Discharge_Power'], 'Discharge_Power') || 0;

    const statusText = this.getText(['Stats/status'], 'status');
    const ageSeconds = this.state.updatedAt > 0
      ? ((Date.now() - this.state.updatedAt) / 1000)
      : Number.POSITIVE_INFINITY;
    const online = (statusText ? statusText.toLowerCase() === 'online' : true) && ageSeconds <= this.staleSeconds;

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
      cheapActive: cheap.cheapActive,
      graceActive: cheap.graceActive,
      smartActive: cheap.smartActive,
      cheapWindowEnd: cheap.cheapWindowEnd,
      cheapSource: cheap.source,
      charging: chargePower > this.getChargingActiveThresholdW(chargePower, importPower, pvPower, cheap),
      discharging: dischargePower > this.dischargeActiveThresholdW,
      importing: importPower > this.importActiveThresholdW,
      exporting: exportPower > this.exportActiveThresholdW,
      updateAvailable: this.updateStatus.updateAvailable,
    };
  }

  refreshAccessories() {
    if (!this.activeSerial && !this.inverterSerial) {
      return;
    }

    const snap = this.getSnapshot();

    this.updateBatterySocAccessory(snap);
    this.updateSolarAccessory(snap);

    this.updateBinaryAccessory('cheapRate', snap.cheapActive);
    this.updateBinaryAccessory('gracePeriod', snap.graceActive);
    this.updateBinaryAccessory('smartWindow', snap.smartActive);
    this.updateBinaryAccessory('charging', snap.charging);
    this.updateBinaryAccessory('discharging', snap.discharging);
    this.updateBinaryAccessory('importing', snap.importing);
    this.updateBinaryAccessory('exporting', snap.exporting);
    this.updateBinaryAccessory('online', snap.online);
    this.updateBinaryAccessory('updateAvailable', snap.updateAvailable);

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

  updateBinaryAccessory(kind, active) {
    const accessory = this.accessories.get(kind);
    if (!accessory) {
      return;
    }

    const service = accessory.getServiceById(this.Service.OccupancySensor, kind);
    if (!service) {
      return;
    }

    service.updateCharacteristic(
      this.Characteristic.OccupancyDetected,
      active
        ? this.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : this.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    );
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

  applyAutomation() {
    if (!this.client || !this.client.connected || !this.activeSerial) {
      return;
    }

    if (this.isManualOverrideActive()) {
      return;
    }

    const snap = this.getSnapshot();

    let desired = {
      mode: 'eco',
      chargePct: 100,
      forceMinutes: 0,
      smooth: false,
    };

    if (snap.online && snap.cheapActive && Number.isFinite(snap.soc) && snap.soc < this.targetSoc && snap.cheapWindowEnd) {
      const remainingMinutes = Math.max(1, Math.ceil((snap.cheapWindowEnd.getTime() - Date.now()) / 60000));

      let chargePct = 100;
      let smooth = false;

      desired = {
        mode: 'charge',
        chargePct,
        forceMinutes: remainingMinutes,
        smooth,
      };
    }

    const bucketedMinutes = desired.forceMinutes > 0 ? Math.ceil(desired.forceMinutes / 5) * 5 : 0;
    const signature = JSON.stringify({
      mode: desired.mode,
      chargePct: desired.chargePct,
      forceMinutes: bucketedMinutes,
      smooth: desired.smooth,
    });

    if (signature === this.lastAutomationSignature) {
      return;
    }

    this.lastAutomationSignature = signature;

    if (desired.mode === 'charge') {
      const end = new Date(Date.now() + (Math.max(1, bucketedMinutes) * 60000));
      this.enqueueAutomationSequence('Automation CHARGE', this.buildTimedSlotSteps('Automation CHARGE', 'charge', new Date(), end, this.targetSoc));
      this.log.info(`Automation -> CHARGE | pct=${desired.chargePct} | mins=${bucketedMinutes} | smooth=${desired.smooth}`);
    } else {
      this.enqueueAutomationSequence('Automation ECO', this.buildNeutralizeSlotSteps('Automation ECO', 'charge'));
      this.log.info('Automation -> ECO');
    }
  }
}
