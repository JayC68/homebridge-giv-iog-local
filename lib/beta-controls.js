'use strict';

const fs = require('fs');
const path = require('path');
const { saveState, selectOvernightTarget } = require('./solar-aware-overnight');
const { controlProfile } = require('./control-state');

function load(file) {
  try { if (fs.statSync(file).size > 524288) throw new Error('Saved state exceeds its size limit'); return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

module.exports = {
  initialiseBetaControls() {
    this.initialiseControlLifecycle();
    this.emergencyGeneration = 0;
    this.emergencyStateFile = path.join(this.getStoragePath(), `givhome-emergency-${this.api.hap.uuid.generate(this.chargeTargetIdentity)}.json`);
    this.solarStateFile = path.join(this.getStoragePath(), `givhome-solar-aware-${this.api.hap.uuid.generate(this.chargeTargetIdentity)}.json`);
    this.solarForecastIdentity = JSON.stringify([this.config.predictedSolarLocation, this.config.predictedSolarCountryCode, this.config.predictedSolarArrays]);
    this.solarAwareEnabled = this.config.enableSolarAwareCheapOvernight === true;
    this.solarForecasts = {};
    try {
      const saved = load(this.solarStateFile);
      if (saved?.identity === this.chargeTargetIdentity && saved.forecastIdentity === this.solarForecastIdentity) {
        this.solarAwareEnabled = this.solarAwareEnabled && saved.enabled === true;
        this.solarForecasts = saved.forecasts || {};
      }
    } catch (err) { this.log.warn('Solar-Aware Cheap Overnight: saved forecast unavailable; normal Charge Target will be used: %s', err.message); }
    try {
      const saved = load(this.emergencyStateFile);
      if (saved) {
        if (saved.identity !== this.chargeTargetIdentity || !['pending', 'failed', 'verified', 'released'].includes(saved.status)
          || (saved.status === 'verified' && !Number.isFinite(saved.untilMs))) throw new Error('invalid recovery record');
        if (saved.transaction) {
          const plan = saved.transaction;
          if (!Array.isArray(plan.ownerIds) || plan.ownerIds.length > 3 || plan.ownerIds.some(p => !Array.isArray(p) || !['charge', 'export', 'pause'].includes(p[0]) || typeof p[1] !== 'string')
            || !Array.isArray(plan.occurrences) || plan.occurrences.length > 8 || !Array.isArray(plan.deferred) || plan.deferred.length > 64) throw new Error('invalid stop transaction');
        }
        if (this.controlProfile && (Number.isInteger(saved.initialRegisters?.[318]) || Number.isInteger(saved.transaction?.working?.[318]))) this.controlProfile.pause = true;
        this.emergencyState = saved;
      }
    } catch (err) {
      this.emergencyState = { identity: this.chargeTargetIdentity, status: 'failed', error: err.message };
      this.log.error('Emergency Stop recovery record cannot be read; commands held until a verified Emergency Stop: %s', err.message);
    }
  },

  publishEmergencyStopHomeKitState() {
    const service = this.emergencyStopService;
    if (!service) return;
    setImmediate(() => {
      if (service !== this.emergencyStopService) return;
      const fault = this.emergencyState?.status === 'failed'
        || (this.emergencyState?.status === 'pending' && !this.emergencyInFlight);
      service.updateCharacteristic(this.Characteristic.On, fault
        ? new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
        : Boolean(this.emergencyInFlight));
    });
  },

  effectiveOvernightTarget(cheapState, now = new Date()) {
    if (!this.solarAwareEnabled || !this.applianceControl.features.cheapOvernightCharging) return this.applianceControl.targetSoc;
    const state = cheapState || this.currentCheapStateForStatusTiles();
    const decision = selectOvernightTarget({ config: this.config, enabled: true, forecasts: this.solarForecasts,
      windowEnd: state.fallbackWindowEnd, now, fallback: this.applianceControl.targetSoc });
    const signature = JSON.stringify(decision);
    if (signature !== this.lastSolarAwareDecision) {
      this.lastSolarAwareDecision = signature;
      this.log.info('Solar-Aware Cheap Overnight: target=%s%% reason=%s forecast=%s kWh date=%s', decision.targetSoc, decision.reason, decision.forecastKwh ?? 'unavailable', decision.date || 'unavailable');
    }
    return decision.targetSoc;
  },

  overnightTargetReconciliationEnabled() {
    return this.chargeTargetTileEnabled() || (this.config?.enableSolarAwareCheapOvernight === true && this.applianceControl.masterGateSatisfied);
  },

  saveSolarAwareState(enabled = this.solarAwareEnabled, forecasts = this.solarForecasts) {
    saveState(this.solarStateFile, { identity: this.chargeTargetIdentity, forecastIdentity: this.solarForecastIdentity, enabled, forecasts });
  },

  rememberSolarForecast(result) {
    if (this.config.enableSolarAwareCheapOvernight !== true) return;
    const forecasts = { ...this.solarForecasts, [result.date]: { date: result.date, kwh: result.kwh, fetchedAt: result.fetchedAt } };
    for (const key of Object.keys(forecasts)) if (Date.now() - Date.parse(forecasts[key].fetchedAt) > 24 * 3600000) delete forecasts[key];
    // Keep the forecast for the coming morning when the provider moves to tomorrow after midnight.
    this.solarForecasts = forecasts;
    try { this.saveSolarAwareState(); } catch (err) { this.log.warn('Solar-Aware forecast retained in memory; save failed: %s', err.message); }
  },

  ensureBetaControlAccessories() {
    const gates = this.applianceControl.masterGateSatisfied;
    let profileSupported = false;
    try {
      const profile = controlProfile(this.inverterSerial);
      profileSupported = profile.kind !== 'ce-ac-coupled' || this.applianceControl.features.ceAcCoupledLiveWrites;
    } catch { /* Unsupported devices retain their existing read-only behaviour. */ }
    for (const [id, name, enabled] of [
      ['solar-aware-overnight', 'Solar-Aware Cheap Overnight', gates && this.config.enableSolarAwareCheapOvernight === true && this.applianceControl.features.cheapOvernightCharging],
      ['emergency-stop', 'Emergency Stop', gates && this.config.enableEmergencyStopTile !== false && profileSupported]
    ]) {
      const uuid = this.api.hap.uuid.generate(`homebridge-giv-iog-local:${this.name}:${id}`);
      let accessory = this.accessoryByUUID.get(uuid);
      if (!enabled) {
        if (id === 'emergency-stop') this.emergencyStopService = null;
        if (accessory) {
          this.api.unregisterPlatformAccessories('homebridge-giv-iog-local', 'GivHomeModbus', [accessory]);
          this.accessoryByUUID.delete(uuid);
          this.accessories = this.accessories.filter(a => a.UUID !== uuid);
        }
        continue;
      }
      const created = !accessory;
      if (!accessory) {
        accessory = new this.api.platformAccessory(name, uuid);
        this.accessoryByUUID.set(uuid, accessory);
        this.accessories.push(accessory);
      }
      accessory.context.definitionId = id;
      accessory.displayName = name;
      const service = accessory.getService(this.Service.Switch) || accessory.addService(this.Service.Switch, name, id);
      if (id === 'emergency-stop') this.emergencyStopService = service;
      service.setCharacteristic(this.Characteristic.Name, name);
      service.getCharacteristic(this.Characteristic.On).onGet(() => {
        if (id === 'solar-aware-overnight') return this.solarAwareEnabled;
        if (this.emergencyState?.status === 'failed' || (this.emergencyState?.status === 'pending' && !this.emergencyInFlight)) throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        return Boolean(this.emergencyInFlight);
      }).onSet(async value => {
        try {
          if (id === 'solar-aware-overnight') {
            this.saveSolarAwareState(Boolean(value));
            this.solarAwareEnabled = Boolean(value);
            service.updateCharacteristic(this.Characteristic.On, this.solarAwareEnabled);
            await this.reconcileActiveChargeTarget();
          } else {
            // HomeKit acknowledges durable acceptance, not completed inverter verification.
            // Keep the switch readable as On while work runs; only a real failure is a fault.
            const publish = () => this.publishEmergencyStopHomeKitState();
            if (value) {
              const completion = this.acceptEmergencyStopRequest();
              // Both outcomes are consumed; failure stays durable and remains visible to Home.
              completion.then(publish, publish);
            } else publish(); // Off cannot cancel a running stop or clear a saved failure.
          }
        } catch (err) {
          this.log.error('%s failed: %s', name, err.message);
          throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
      });
      service.updateCharacteristic(this.Characteristic.On, id === 'solar-aware-overnight' && this.solarAwareEnabled);
      const info = accessory.getService(this.Service.AccessoryInformation);
      if (info) info.setCharacteristic(this.Characteristic.Manufacturer, 'Kernowek Consulting').setCharacteristic(this.Characteristic.Model, name).setCharacteristic(this.Characteristic.FirmwareRevision, require('../package.json').version);
      if (created) this.api.registerPlatformAccessories('homebridge-giv-iog-local', 'GivHomeModbus', [accessory]);
      else this.api.updatePlatformAccessories?.([accessory]);
    }
  },

  async requestEmergencyStop() {
    return this.acceptEmergencyStopRequest();
  },

};
