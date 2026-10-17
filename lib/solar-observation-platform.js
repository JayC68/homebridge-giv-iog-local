'use strict';

const { SolarObservation } = require('./solar-observation');
const { hash } = require('./solar-observation-store');
const { normaliseConfig } = require('./predicted-solar');

module.exports = {
  startSolarObservation() {
    if (this.config.enableSolarObservation !== true || this.solarObservation) return;
    try {
      const solar = normaliseConfig(this.config);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const fingerprints = {
        load: hash(JSON.stringify([this.chargeTargetIdentity, timezone])),
        solar: hash(JSON.stringify([solar.location, solar.countryCode, solar.arrays, solar.performanceRatio])),
        charge: hash(JSON.stringify([this.chargeTargetIdentity, this.applianceControl.batteryCapacityKwh, this.applianceControl.maxBatteryChargePowerKw]))
      };
      const observer = new SolarObservation({ directory: SolarObservation.directory(this.getStoragePath(), this.chargeTargetIdentity),
        fingerprints, pollSeconds: this.pollIntervalSeconds, log: this.log });
      this.solarObservation = observer;
      // Neither startup nor recovery holds the launch/poll/command path.
      this.solarObservationStart = observer.start(typeof this.config.solarObservationResetKey === 'string'
        ? this.config.solarObservationResetKey.slice(0, 64) : '').catch(() => observer.warn());
      this.api.on('shutdown', () => {
        this.solarObservationStopping = true;
        Promise.resolve(this.solarObservationStart).then(() => observer.stop()).catch(() => observer.warn());
      });
    } catch {
      this.log.warn('[Solar Observation] could not start local observation; normal GivHome controls continue.');
    }
  },

  observeSolarTelemetry(model) {
    if (!this.solarObservation || this.solarObservationStopping) return;
    try {
      const cheap = this.currentCheapStateForStatusTiles();
      this.solarObservation.observe(model, {
        iog: this.isIntelligentOctopusGoConfigured(), smart: Boolean(cheap.smartActive || cheap.graceActive),
        ownedCharge: Boolean(this.activeChargeTarget),
        export: Boolean(this.activeExcessExportSlot || this.activeOctopusFluxExportSlot || this.octopusAgileOutgoingState?.activeSlot),
        emergency: Boolean(this.emergencyState && this.emergencyState.status !== 'released'),
        command: Boolean(this.commandIntentPending || this.commandTransportInFlight)
      });
    } catch { this.solarObservation.breakChain('context-unavailable'); }
  },

  observeSolarControlChange() {
    try { this.solarObservation?.controlChanged(); } catch { /* Never affect an authorised command. */ }
  }
};
