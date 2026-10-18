'use strict';

const fs = require('fs');
const path = require('path');
const { saveState, selectOvernightTarget } = require('./solar-aware-overnight');
const { emergencyProfile, readEmergencySnapshot, executeEmergencyStop, activeSlot, slotEnd } = require('./emergency-stop');

function load(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

module.exports = {
  initialiseBetaControls() {
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
        this.emergencyState = saved;
      }
    } catch (err) {
      this.emergencyState = { identity: this.chargeTargetIdentity, status: 'failed', error: err.message };
      this.log.error('Emergency Stop recovery record cannot be read; commands held until a verified Emergency Stop: %s', err.message);
    }
  },

  emergencyHeld() {
    const state = this.emergencyState;
    if (!state || state.status === 'released') return false;
    if (state.status !== 'verified' || Date.now() < state.untilMs || this.emergencyInFlight) return true;
    // Expiry is durable before ordinary automation may resume.
    const released = { ...state, status: 'released' };
    try { saveState(this.emergencyStateFile, released); this.emergencyState = released; }
    catch (err) { this.log.error('Emergency Stop: could not release saved hold: %s', err.message); return true; }
    this.log.info('Emergency Stop: stopped window ended; normal GivHome automation may resume.');
    return false;
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
      const profile = emergencyProfile(this.inverterSerial);
      profileSupported = profile.profile !== 'ce-ac-coupled' || this.applianceControl.features.ceAcCoupledLiveWrites;
    } catch { /* Unsupported devices retain their existing read-only behaviour. */ }
    for (const [id, name, enabled] of [
      ['solar-aware-overnight', 'Solar-Aware Cheap Overnight', gates && this.config.enableSolarAwareCheapOvernight === true && this.applianceControl.features.cheapOvernightCharging],
      ['emergency-stop', 'Emergency Stop', gates && this.config.enableEmergencyStopTile === true && profileSupported]
    ]) {
      const uuid = this.api.hap.uuid.generate(`homebridge-giv-iog-local:${this.name}:${id}`);
      let accessory = this.accessoryByUUID.get(uuid);
      if (!enabled) {
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
            const publish = () => setImmediate(() => {
              const fault = this.emergencyState?.status === 'failed'
                || (this.emergencyState?.status === 'pending' && !this.emergencyInFlight);
              service.updateCharacteristic(this.Characteristic.On, fault
                ? new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)
                : Boolean(this.emergencyInFlight));
            });
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

  acceptEmergencyStopRequest() {
    if (this.emergencyInFlight) return this.emergencyInFlight;
    if (this.config.enableEmergencyStopTile !== true || !this.applianceControl.masterGateSatisfied) throw new Error('Emergency Stop is not enabled');
    const profile = emergencyProfile(this.inverterSerial);
    if (profile.profile === 'ce-ac-coupled' && !this.applianceControl.features.ceAcCoupledLiveWrites) throw new Error('CE/AC write acknowledgement is required');
    // Pause is optional on older profiles, but cannot be ignored when GivHome uses it.
    if (this.applianceControl.features.pauseTiles || this.applianceSnapshots.has('pause')
      || (this.applianceControl.features.homeBatteryProtectionDuringSmartSlots
        && this.applianceControl.iogHomeBatteryProtectionMode && this.applianceControl.iogHomeBatteryProtectionMode !== 'charge')) profile.pause = true;
    this.emergencyGeneration = (this.emergencyGeneration || 0) + 1;
    const previousRecovery = this.emergencyState;
    const pending = { identity: this.chargeTargetIdentity, status: 'pending', requestedAt: new Date().toISOString(),
      untilMs: previousRecovery?.untilMs || 0, implicated: previousRecovery?.status === 'failed' || previousRecovery?.status === 'pending' ? previousRecovery.implicated || [] : [],
      initialRegisters: previousRecovery?.status === 'failed' || previousRecovery?.status === 'pending' ? previousRecovery.initialRegisters : undefined };
    this.emergencyState = pending;
    // A failed durable save prevents inverter writes and leaves the in-memory hold active.
    saveState(this.emergencyStateFile, pending);
    for (const timer of this.applianceCommandTimers.values()) clearTimeout(timer);
    this.applianceCommandTimers.clear();
    const run = this.withManualChargeTransportGate('GivHome Emergency Stop', async () => {
      const read = this.readHoldingRegisters.bind(this);
      const before = await readEmergencySnapshot(read, profile);
      const capturedAt = new Date();
      const active = profile.slots.filter(s => before[s.family === 'charge' ? 96 : 59] === 1 && activeSlot(before[s.pair[0]], before[s.pair[1]], capturedAt));
      const cheap = this.currentCheapStateForStatusTiles();
      const ends = [pending.untilMs, capturedAt.getTime() + 60000, this.autoChargeProtectedUntilMs, this.activeChargeTarget?.endAtMs,
        ...active.map(s => slotEnd(before[s.pair[1]], capturedAt)),
        ...[this.activeExcessExportSlot, this.activeOctopusFluxExportSlot, this.activeOctopusAgileOutgoingSlot].map(s => s?.end?.getTime()),
        cheap.fallbackActive ? cheap.fallbackWindowEnd?.getTime() : 0,
        cheap.smartActive || cheap.graceActive ? cheap.protectedEnd?.getTime() : 0].filter(Number.isFinite);
      pending.untilMs = Math.max(...ends);
      const priorImplicated = pending.implicated;
      pending.implicated = [...priorImplicated];
      for (const slot of active) if (!pending.implicated.some(s => s.family === slot.family && s.id === slot.id)) {
        pending.implicated.push({ family: slot.family, id: slot.id, times: slot.pair.map(r => before[r]) });
      }
      pending.initialRegisters ||= before;
      saveState(this.emergencyStateFile, pending);
      saveState(`${this.emergencyStateFile}.snapshot`, { identity: this.chargeTargetIdentity, capturedAt: new Date().toISOString(), profile: profile.profile, registers: pending.initialRegisters, latestRegisters: before });
      this.emergencyWriting = true;
      let result;
      try { result = await executeEmergencyStop({ profile, before, read, write: this.writeDirectRegister.bind(this), now: capturedAt, priorImplicated }); }
      finally { this.emergencyWriting = false; }
      // A current GivHome action must not immediately restart what the user stopped.
      result.untilMs = Math.max(result.untilMs, pending.untilMs);
      this.applianceSnapshots.clear();
      this.activeChargeTarget = null;
      this.chargeTargetError = null;
      this.autoChargeActive = false;
      this.autoChargeLabel = '';
      this.autoChargeProtectedUntilMs = 0;
      this.manualChargeOriginalSlot = null;
      this.clearCeAcChargeSlotMemory();
      this.clearEveningExcessExportMemory();
      this.clearOctopusFluxExportMemory();
      this.clearOctopusAgileOutgoingMemory();
      // Existing general cleanup helpers contain storage errors. Recovery must verify deletion.
      for (const getFile of [this.ceAcChargeSlotStatePath, this.eveningExcessExportStatePath, this.octopusFluxExportStatePath]) {
        if (getFile && fs.existsSync(getFile.call(this))) throw new Error('Emergency Stop: stopped ownership memory could not be removed');
      }
      if (this.octopusAgileOutgoingStatePath) {
        const state = load(this.octopusAgileOutgoingStatePath());
        if (state?.activeSlot) throw new Error('Emergency Stop: Agile active ownership memory could not be cleared');
      }
      this.activeExcessExportSlot = this.activeOctopusFluxExportSlot = this.activeOctopusAgileOutgoingSlot = null;
      this.excessEnergyExportActive = this.octopusFluxExportActive = this.octopusAgileOutgoingExportActive = false;
      this.setManualChargeHomeKitState(false);
      for (const [kind] of this.applianceCommandServices) this.setApplianceCommandState(kind, false);
      const verified = { ...pending, status: 'verified', untilMs: result.untilMs, cleared: result.implicated.map(s => `${s.family} ${s.id}`) };
      saveState(this.emergencyStateFile, verified);
      this.emergencyState = verified;
      this.invalidateCommandTruthSnapshot('Emergency Stop verified');
      this.log.warn('Emergency Stop: PASS — forced controls disabled; active slots cleared; Eco verified; GivHome preferences retained; stopped window held until %s. Physical flow awaits fresh telemetry.', new Date(result.untilMs).toISOString());
      return result;
    });
    const completion = run.catch(err => {
      this.emergencyState = { ...pending, status: 'failed', error: err.message };
      try { saveState(this.emergencyStateFile, this.emergencyState); } catch { /* The durable pending record also holds after restart. */ }
      this.log.error('Emergency Stop: FAIL — %s. Commands remain held; investigate the inverter/controller and retry Emergency Stop.', err.message);
      throw err;
    }).finally(() => { this.emergencyInFlight = null; });
    this.emergencyInFlight = completion;
    return completion;
  }
};
