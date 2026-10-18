'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { GivHomeModbusPlatform } = require('../index');
const { buildApplianceControlConfig } = require('../lib/appliance-integrated-control');

function fixture(t, { serial = 'CH2344G083', now = '2026-10-18T08:30:00+01:00', state = {}, config = {}, storage, clockOffset = 0 } = {}) {
  if (now) t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
  const directory = storage || fs.mkdtempSync(path.join(os.tmpdir(), 'givhome-controls-'));
  if (!storage) t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const registers = {}; for (let r = 0; r <= 320; r++) registers[r] = 0;
  Object.assign(registers, { 27: 1, 111: 100, 112: 100, 116: 100, 242: 80, 293: 4 }, state);
  const writes = [], reads = [], logs = [];
  const options = { enableEmergencyStopTile: true, enableApplianceControl: true, applianceControlAcknowledgement: 'ENABLE_GIVHOME_APPLIANCE_CONTROL',
    enableCheapOvernightCharging: true, enableChargeTiles: true, enableExportTiles: true, enablePauseTiles: true, ...config };
  function platform() {
    const p = Object.create(GivHomeModbusPlatform.prototype);
    const ac = buildApplianceControlConfig(options);
    Object.assign(p, { name: 'control-test', inverterSerial: serial, inverterHost: 'no-network.invalid', config: options,
      chargeTargetIdentity: `control-test:${serial}`, configuredChargeTarget: 100, getStoragePath: () => directory,
      api: { hap: { uuid: { generate: s => crypto.createHash('sha256').update(s).digest('hex') } } },
      applianceControl: { ...ac, masterGateSatisfied: true, features: { ...ac.features, chargeTiles: true, exportTiles: true, pauseTiles: true, ceAcCoupledLiveWrites: true } },
      health: { state: 'online' }, latestModel: { socPercent: 40, batteryDischargePowerW: 0, loadPowerW: 500, pvPowerW: 0 }, octopusState: { dispatches: [] },
      log: Object.fromEntries(['info', 'warn', 'error', 'debug'].map(k => [k, (...args) => logs.push(args)])),
      applianceSnapshots: new Map(), applianceCommandTimers: new Map(), applianceCommandServices: new Map(), applianceCommandTruthCache: new Map(),
      manualChargeCommandDurationMinutes: 30, manualChargeSupervisorStatus: { graceMinutes: 10, liveRepairEnabled: true },
      commandTransportSequence: 0, commandQueueDepth: 0, commandPollHoldUntilMs: 0, commandQueueTail: Promise.resolve(),
      withManualChargeTransportGate: async (_label, fn) => fn(), enterQueuedCommandTransportGate: async (_label, fn) => fn(),
      setManualChargeHomeKitState() {}, setApplianceCommandState() {}, setPauseTileStatesFromPrestate() {}, invalidateCommandTruthSnapshot() {},
      readHoldingRegisters: async (r, n, label) => {
        reads.push({ r, n, label });
        const d = new Date(Date.now() + clockOffset);
        const clock = { 35: d.getFullYear() - 2000, 36: d.getMonth() + 1, 37: d.getDate(), 38: d.getHours(), 39: d.getMinutes(), 40: d.getSeconds() };
        return Array.from({ length: n }, (_, i) => clock[r + i] ?? registers[r + i]);
      },
      writeDirectRegister: async (r, v, label) => { if (!Number.isInteger(v)) throw new Error(`invalid write ${r}=${v}`); writes.push([r, v, label]); registers[r] = v; },
      clearCeAcChargeSlotMemory() { this.ceAcChargeSlotMemory = null; }, persistCeAcChargeSlotSnapshot(snapshot) { this.ceAcChargeSlotMemory = { snapshot }; },
      clearEveningExcessExportMemory() {}, clearOctopusFluxExportMemory() { this.activeOctopusFluxExportSlot = null; this.octopusFluxExportActive = false; },
      clearOctopusAgileOutgoingMemory() { this.activeOctopusAgileOutgoingSlot = null; this.octopusAgileOutgoingExportActive = false; },
      logBatteryCarePlan() {}, logCheapOvernightPlan() {},
      ceAcChargeSlotStatePath: undefined, eveningExcessExportStatePath: undefined, octopusFluxExportStatePath: undefined, octopusAgileOutgoingStatePath: undefined
    });
    p.initialiseBetaControls();
    t.after(() => { for (const timer of p.applianceCommandTimers.values()) clearTimeout(timer); if (p.chargeTargetTimer) clearTimeout(p.chargeTargetTimer); });
    return p;
  }
  const p = platform();
  return { p, registers, writes, reads, logs, directory, restart: platform };
}
module.exports = { fixture };
