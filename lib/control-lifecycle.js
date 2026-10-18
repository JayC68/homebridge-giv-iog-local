'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { saveState } = require('./solar-aware-overnight');
const { getClockWindow } = require('./appliance-integrated-control');
const { controlProfile, readWords, readNamespace, readDeviceTime, inWindow, endOfWindow, pauseActive, sameValues, changedFutureRequiresEnable } = require('./control-state');

class SupersededControl extends Error {}
const numeric = state => Object.fromEntries(Object.entries(state).map(([k, v]) => [k.startsWith('HR') ? k.slice(2) : k, v]).filter(([k, v]) => /^\d+$/.test(k) && Number.isInteger(v)));
const hr = state => Object.fromEntries(Object.entries(state).map(([k, v]) => [`HR${k}`, v]));
const familyEnable = family => family === 'charge' ? 96 : 59;

module.exports = {
  initialiseControlLifecycle() {
    if (!this.inverterSerial) return;
    try { this.controlProfile = controlProfile(this.inverterSerial); }
    catch { this.controlProfile = null; return; }
    if (this.applianceControl.features.pauseTiles || this.applianceControl.features.homeBatteryProtectionDuringSmartSlots
      && this.applianceControl.iogHomeBatteryProtectionMode && this.applianceControl.iogHomeBatteryProtectionMode !== 'charge') this.controlProfile.pause = true;
    this.controlLedgerFile = path.join(this.getStoragePath(), `givhome-controls-${this.api.hap.uuid.generate(this.inverterSerial)}.json`);
    this.controlLedger = { version: 1, serial: this.inverterSerial, owners: {}, stopped: [], deferred: [] };
    try {
      if (fs.existsSync(this.controlLedgerFile)) {
        if (fs.statSync(this.controlLedgerFile).size > 524288) throw new Error('Control journal exceeds its size limit');
        const saved = JSON.parse(fs.readFileSync(this.controlLedgerFile, 'utf8'));
        if (saved.version !== 1 || saved.serial !== this.inverterSerial || !saved.owners || !Array.isArray(saved.stopped)
          || saved.stopped.length > 256 || !Array.isArray(saved.deferred) || saved.deferred.length > 64
          || Object.keys(saved.owners).some(k => !['charge', 'export', 'pause'].includes(k))) throw new Error('Invalid control ownership journal');
        if (saved.owners.pause || saved.deferred.some(item => item.family === 'pause')) this.controlProfile.pause = true;
        const wordMap = value => value && typeof value === 'object' && !Array.isArray(value)
          && Object.keys(value).length <= 128 && Object.entries(value).every(([r, v]) => /^\d+$/.test(r) && Number.isInteger(v) && v >= 0 && v <= 65535);
        const safeText = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
        for (const [family, owner] of Object.entries(saved.owners)) {
          if (!safeText(owner.id) || owner.family !== family || !safeText(owner.source) || !wordMap(owner.before) || !wordMap(owner.expected)
            || !owner.snapshot || !['starting', 'active', 'cleanup'].includes(owner.phase)
            || owner.endAtMs != null && !Number.isFinite(owner.endAtMs)) throw new Error('Invalid saved action');
        }
        for (const item of saved.deferred) {
          const slot = this.controlProfile.slots.find(s => s.family === item.family && s.id === item.slotId);
          const pair = item.family === 'pause' && this.controlProfile.pause ? [318] : slot?.pair;
          if (!safeText(item.id) || !Number.isFinite(item.dueAtMs) || !Array.isArray(item.pair) || !pair
            || item.pair.length !== pair.length || item.pair.some((r, i) => r !== pair[i])
            || !Array.isArray(item.times) || item.times.length !== pair.length
            || item.times.some(v => !Number.isInteger(v) || v < 0 || (item.family === 'pause' ? v > 3 : v > 2359 || v % 100 > 59))) throw new Error('Invalid recurring schedule journal');
        }
        if (saved.stopped.some(s => !safeText(s.source) || !safeText(s.key) || !Number.isFinite(s.untilMs))) throw new Error('Invalid cancellation journal');
        this.controlLedger = saved;
        for (const [family, owner] of Object.entries(saved.owners)) {
          this.applianceSnapshots.set(family, { ...owner.snapshot, source: owner.source, controlActionId: owner.id });
        }
      }
      this.controlLoadFault = null; this.controlStorageFault = null;
    } catch (err) { this.controlLoadFault = err; this.controlStorageFault = err; this.log.error('GivHome control recovery needs verified local state: %s', err.message); }
  },

  saveControlLedger() {
    if (this.controlLoadFault) throw new Error('Control journal could not be read; preserve and recover its evidence before writes');
    if (!this.controlLedgerFile) return;
    try { saveState(this.controlLedgerFile, this.controlLedger); this.controlStorageFault = null; }
    catch (err) { this.controlStorageFault = err; throw err; }
  },

  currentControlOwner(family) { return this.controlLedger?.owners?.[family] || null; },

  controlOccurrence(source, now = new Date(), end, key) {
    const cheap = this.currentCheapStateForStatusTiles();
    if (key) return { source, key, untilMs: end?.getTime() || now.getTime() + 86400000 };
    if (source === 'Cheap Overnight') return { source, key: `${this.applianceControl.cheapStart}:${cheap.fallbackWindowEnd?.toISOString()}`, untilMs: cheap.fallbackWindowEnd?.getTime() || end?.getTime() };
    if (source.startsWith('Intelligent Octopus Go')) return { source: 'IOG', key: cheap.activeDispatchStart?.toISOString() || this.octopusState?.earlyTerminationDispatchStart?.toISOString(), untilMs: cheap.protectedEnd?.getTime() || end?.getTime() };
    if (source === 'Octopus Flux Export') return { source, key: this.octopusFluxPeakKey(now), untilMs: getClockWindow(now, this.applianceControl.octopusFluxExportStartTime, this.applianceControl.octopusFluxExportEndTime).end?.getTime() };
    if (source === 'Evening Excess Export') return { source, key: 'current-run', untilMs: end?.getTime() || now.getTime() };
    if (source === 'Octopus Agile Export') return { source, key: key || `${Math.floor(now.getTime() / 1800000)}`, untilMs: end?.getTime() || now.getTime() + 1800000 };
    return null;
  },

  occurrenceStopped(source, now = new Date(), end, key) {
    const occurrence = this.controlOccurrence(source, now, end, key);
    if (!occurrence) return false;
    return (this.controlLedger?.stopped || []).some(s => s.source === occurrence.source && s.key === occurrence.key
      && now.getTime() < (s.source === 'IOG' ? Math.max(s.untilMs, occurrence.untilMs || 0) : s.untilMs));
  },

  allowStoppedOccurrence(source) {
    if (!this.controlLedger || this.emergencyHeld()) return;
    this.controlLedger.stopped = this.controlLedger.stopped.filter(s => s.source !== source);
    this.saveControlLedger();
  },

  rememberStoppedOccurrence(occurrence) {
    if (!occurrence || !occurrence.key || !Number.isFinite(occurrence.untilMs)) return;
    this.controlLedger.stopped = this.controlLedger.stopped.filter(s => Date.now() < s.untilMs + 86400000 && !(s.source === occurrence.source && s.key === occurrence.key));
    if (this.controlLedger.stopped.length >= 256) throw new Error('Control cancellation journal is full; preserve evidence before continuing');
    this.controlLedger.stopped.push({ ...occurrence, capturedAt: new Date().toISOString() });
    this.saveControlLedger();
  },

  async beginControlAction(family, snapshot, expected, { source, kind, end, occurrenceKey } = {}) {
    if (!this.controlLedger) this.initialiseControlLifecycle();
    if (this.controlStorageFault) throw new Error('Control journal unavailable; no writes sent');
    if (this.controlProfile?.kind === 'ce-ac-coupled' && !this.applianceControl.features.ceAcCoupledLiveWrites) throw new Error('CE/AC write acknowledgement is required');
    const deviceNow = await readDeviceTime(this.readHoldingRegisters.bind(this));
    const before = await readNamespace(this.readHoldingRegisters.bind(this), this.controlProfile, family, 'Action ownership preflight');
    const previous = this.currentControlOwner(family);
    if (previous && (previous.phase !== 'active' || previous.source !== source || !sameValues(before, previous.expected))) throw new Error('Previous control owner must be reconciled before handover');
    if (!previous && family !== 'pause' && this.controlProfile.slots.some(s => s.family === family && before[s.enable] === 1 && inWindow(before[s.pair[0]], before[s.pair[1]], deviceNow))) throw new Error('Another physical action is running; no action acquired and no cleanup writes sent');
    const given = numeric(snapshot);
    if (!sameValues(before, Object.fromEntries(Object.entries(given).filter(([r]) => r in before)))) throw new Error('Control settings changed during acquisition; no writes sent');
    const owner = { id: previous?.id || randomUUID(), attempt: randomUUID(), family, source, kind,
      slotId: family === 'charge' ? 1 : family === 'export' ? (this.controlProfile.route === 'ch-aio' ? 8 : 1) : 0,
      phase: 'starting', capturedAt: new Date().toISOString(), endAtMs: end?.getTime(),
      before: previous?.before || before, snapshot: previous?.snapshot || snapshot,
      transitionFrom: { ...before, ...(family === 'pause' ? {} : { [familyEnable(family)]: 0 }) },
      expected: numeric(expected), occurrence: this.controlOccurrence(source || '', new Date(), end, occurrenceKey) };
    this.controlLedger.owners[family] = owner;
    this.saveControlLedger();
    this.applianceSnapshots.set(family, { ...owner.snapshot, source: owner.source, controlActionId: owner.id });
    return owner;
  },

  finishControlActionStart(family) {
    const owner = this.currentControlOwner(family);
    if (owner) { owner.phase = 'active'; this.saveControlLedger(); }
  },

  ownedChargeTargetState(state) {
    const owner = this.currentControlOwner('charge'), current = numeric(state);
    if (!owner) return false;
    return Object.entries(owner.expected).every(([r, v]) => current[r] === v
      || owner.phase === 'starting' && [20, 116].includes(Number(r)) && current[r] === owner.transitionFrom?.[r]);
  },

  async updateOwnedChargeTarget(expected) {
    const owner = this.currentControlOwner('charge');
    if (!owner) throw new Error('Charge Target has no durable control owner');
    owner.transitionFrom = { ...owner.expected }; owner.expected = { ...owner.expected, ...numeric(expected) }; owner.phase = 'starting'; this.saveControlLedger();
  },

  // Persist before each write, then reconcile both possible outcomes on retry.
  // No uncertain payload is blindly resent and no different observed value is overwritten.
  async runControlPlan(plan, label, save) {
    const allowed = new Set([20, 27, 59, 96, 111, 112, 116, ...(this.controlProfile.pause ? [318] : []), ...(this.controlProfile.route === 'ch-aio' ? [293] : []), ...this.controlProfile.slots.flatMap(s => s.pair)]);
    const timeRegisters = new Set(this.controlProfile.slots.flatMap(s => s.pair));
    const validValue = (r, v) => Number.isInteger(v) && v >= 0 && v <= 65535
      && (!timeRegisters.has(r) || v <= 2359 && v % 100 < 60)
      && (![20, 27, 59, 96].includes(r) || v <= 1)
      && (![111, 112, 116, 293].includes(r) || v <= 100) && (r !== 318 || v <= 3);
    if (!Array.isArray(plan.writes) || plan.writes.length > 128 || !plan.working
      || Object.entries(plan.working).some(([r, v]) => !allowed.has(Number(r)) || !validValue(Number(r), v))
      || plan.writes.some(w => !Array.isArray(w) || w.length !== 2 || !allowed.has(w[0]) || !(w[0] in plan.working) || !validValue(w[0], w[1]))
      || plan.index != null && (!Number.isInteger(plan.index) || plan.index < 0 || plan.index > plan.writes.length)) throw new Error('Invalid saved control plan; no writes permitted');
    plan.index ||= 0;
    while (plan.index < plan.writes.length) {
      const [register, value] = plan.writes[plan.index];
      const current = await readWords(this.readHoldingRegisters.bind(this), Object.keys(plan.working).map(Number), `${label} ownership`);
      const expected = { ...plan.working };
      if (plan.attempt === plan.index && current[register] === value) expected[register] = value;
      if (!sameValues(current, expected)) {
        const registers = Object.keys(expected).filter(r => current[r] !== expected[r]).map(r => `HR${r}`).join(',');
        const message = `${label}: ${registers} changed; later settings preserved and no speculative restore`;
        if (plan.index === 0 && plan.attempt == null) throw new SupersededControl(message);
        throw new Error(message);
      }
      if (current[register] !== value) {
        plan.attempt = plan.index; save();
        await this.writeDirectRegister(register, value, `${label} HR${register}`);
        const verified = await readWords(this.readHoldingRegisters.bind(this), [register], `${label} write verification`);
        if (verified[register] !== value) throw new Error(`${label}: HR${register} write readback mismatch; recovery retained`);
      }
      plan.working[register] = value; plan.index++; plan.attempt = null; save();
    }
  },

  async cleanupOwnedControl(family, reason, expectedOwnerId, userRequested = false) {
    const owner = this.currentControlOwner(family);
    if (!owner || expectedOwnerId && owner.id !== expectedOwnerId) {
      this.log.info('GivHome %s cleanup: no matching action; inverter settings preserved.', family); return { noOwner: true };
    }
    const profile = this.controlProfile;
    let before = await readNamespace(this.readHoldingRegisters.bind(this), profile, family, 'Cleanup preflight');
    if (!owner.plan) {
      const eligible = owner.phase === 'starting'
        ? Object.entries(owner.expected).every(([r, v]) => before[r] === v || before[r] === owner.before[r] || before[r] === owner.transitionFrom?.[r])
        : sameValues(before, owner.expected);
      if (!eligible) { this.retireControlOwner(family, owner.id, 'superseded'); return { superseded: true }; }
      const restore = owner.before, writes = [];
      const registers = family === 'charge' ? [94, 95, 111, 20, 116] : family === 'pause' ? [318]
        : profile.route === 'ch-aio' ? [291, 292, 293, 112] : [56, 57, 112];
      const enable = family === 'pause' ? null : familyEnable(family);
      if (enable) writes.push([enable, 0]);
      for (const r of registers) writes.push([r, family === 'pause' && userRequested ? 0 : family === 'export' && profile.route === 'ch-aio' && [291, 292].includes(r) ? 0 : restore[r]]);
      const prospective = { ...before, ...Object.fromEntries(writes) };
      if (enable) {
        const excluded = family === 'charge' ? [1] : [profile.route === 'ch-aio' ? 8 : 1];
        const remaining = changedFutureRequiresEnable(profile, family, restore, prospective, excluded);
        const originalWindow = excluded[0] === 8 ? [291, 292] : family === 'charge' ? [94, 95] : [56, 57];
        const originalNeedsEnable = restore[enable] === 1 && (originalWindow.some(r => restore[r] !== 0)
          || this.controlLedger.deferred.some(item => item.family === family));
        writes.push([enable, remaining || originalNeedsEnable ? 1 : 0]);
      }
      owner.phase = 'cleanup';
      owner.plan = { writes, index: 0, working: Object.fromEntries([...new Set(writes.map(w => w[0]))].map(r => [r, before[r]])) };
      if (userRequested) this.rememberStoppedOccurrence(owner.occurrence);
      this.saveControlLedger();
    }
    try { await this.runControlPlan(owner.plan, `GivHome ${family} cleanup`, () => this.saveControlLedger()); }
    catch (err) { if (err instanceof SupersededControl) { this.retireControlOwner(family, owner.id, 'superseded'); return { superseded: true }; } throw err; }
    const after = await readNamespace(this.readHoldingRegisters.bind(this), profile, family, 'Cleanup verification');
    if (!sameValues(after, owner.plan.working)) throw new Error('Cleanup final readback did not match; recovery retained');
    this.retireControlOwner(family, owner.id, 'verified');
    this.log.info('GivHome %s cleanup verified: reason=%s future schedules reconciled=yes', family, reason);
    return { verified: true };
  },

  retireControlOwner(family, id, outcome) {
    const owner = this.currentControlOwner(family);
    if (!owner || owner.id !== id) return;
    delete this.controlLedger.owners[family]; this.saveControlLedger();
    if (this.applianceSnapshots.get(family)?.controlActionId === id) this.applianceSnapshots.delete(family);
    for (const [kind, token] of this.controlTimerOwners || []) if (token === id) {
      clearTimeout(this.applianceCommandTimers.get(kind)); this.applianceCommandTimers.delete(kind); this.controlTimerOwners.delete(kind);
    }
    if (family === 'pause') this.manualPauseIntent = 0;
    if (family === 'charge') {
      this.activeChargeTarget = null; this.chargeTargetError = null; this.autoChargeActive = false; this.autoChargeLabel = ''; this.autoChargeProtectedUntilMs = 0;
      this.manualChargeOriginalSlot = null; this.clearCeAcChargeSlotMemory();
    } else if (family === 'pause' && this.autoChargeLabel === 'Intelligent Octopus Go Home Battery Protection Pause') {
      this.autoChargeActive = false; this.autoChargeLabel = ''; this.autoChargeProtectedUntilMs = 0;
    } else if (family === 'export') {
      if (owner.source === 'Evening Excess Export') { this.clearEveningExcessExportMemory(); this.activeExcessExportSlot = null; this.excessEnergyExportActive = false; }
      if (owner.source === 'Octopus Flux Export') this.clearOctopusFluxExportMemory();
      if (owner.source === 'Octopus Agile Export') this.clearOctopusAgileOutgoingMemory();
    }
    this.log.info('GivHome control action retired: family=%s outcome=%s', family, outcome);
  },

  async reconcileLegacyControlMemories() {
    if (this.currentControlOwner('export') || this.legacyControlMemoriesReconciled) return;
    const memories = [['activeExcessExportSlot', 'clearEveningExcessExportMemory'],
      ['activeOctopusFluxExportSlot', 'clearOctopusFluxExportMemory'], ['activeOctopusAgileOutgoingSlot', 'clearOctopusAgileOutgoingMemory']];
    if (!memories.some(([key]) => this[key])) { this.legacyControlMemoriesReconciled = true; return; }
    // Pre-journal metadata cannot prove ownership. Preserve the original file as
    // migration evidence, then retire only its logical claim; never cancel it.
    const observed = await readNamespace(this.readHoldingRegisters.bind(this), this.controlProfile, 'export', 'Legacy export observation');
    this.controlLedger.legacyExportEvidence = { capturedAt: new Date().toISOString(), observed,
      memories: Object.fromEntries(memories.filter(([key]) => this[key]).map(([key]) => [key, this[key]])) };
    this.saveControlLedger();
    for (const [key, clear] of memories) if (this[key]) { this[clear](); this[key] = null; }
    this.excessEnergyExportActive = false; this.octopusFluxExportActive = false; this.octopusAgileOutgoingExportActive = false;
    this.legacyControlMemoriesReconciled = true;
    this.log.info('GivHome older export metadata reconciled: physical controls preserved; fresh ownership is required for new actions.');
  },

  async recoverControlLifecycle() {
    if (!this.controlLedger || this.controlRecoveryInFlight || this.commandIntentPending || this.commandTransportInFlight || this.emergencyHeld()) return;
    if (this.controlRetryAtMs && Date.now() < this.controlRetryAtMs) return;
    this.controlRecoveryInFlight = true;
    try {
      if (this.controlStorageFault) this.saveControlLedger();
      for (const owner of Object.values(this.controlLedger.owners)) {
        if (owner.phase !== 'active' || owner.endAtMs && Date.now() >= owner.endAtMs) {
          await this.withManualChargeTransportGate('GivHome control recovery cleanup', () => this.cleanupOwnedControl(owner.family, 'saved action recovery', owner.id));
        }
      }
      await this.reconcileLegacyControlMemories();
      await this.restoreDeferredControlWindows();
      this.controlRetryAtMs = 0;
    } catch (err) { this.controlRetryAtMs = Date.now() + 10000; this.log.warn('GivHome control recovery will retry: %s', err.message); }
    finally { this.controlRecoveryInFlight = false; }
  },

  async restoreDeferredControlWindows() {
    for (const item of [...this.controlLedger.deferred]) {
      if (Date.now() < item.dueAtMs) continue;
      await this.withManualChargeTransportGate('GivHome recurring schedule reconciliation', async () => {
        const deviceNow = await readDeviceTime(this.readHoldingRegisters.bind(this));
        if (deviceNow.getTime() < item.dueAtMs) return;
        if (this.currentControlOwner(item.family)?.slotId === item.slotId) return;
        const before = await readWords(this.readHoldingRegisters.bind(this), item.pair, 'Recurring schedule readback');
        // A different controller or new GivHome action now owns this pair.
        if (!item.plan && item.pair.some(r => before[r] !== 0)) {
          this.controlLedger.deferred = this.controlLedger.deferred.filter(s => s.id !== item.id); this.saveControlLedger();
          this.log.info('GivHome recurring schedule reconciliation: newer slot settings preserved.'); return;
        }
        if (!item.plan) { item.plan = { writes: item.pair.map((r, i) => [r, item.times[i]]), working: before, index: 0 }; this.saveControlLedger(); }
        await this.runControlPlan(item.plan, 'GivHome recurring schedule restore', () => this.saveControlLedger());
        this.controlLedger.deferred = this.controlLedger.deferred.filter(s => s.id !== item.id); this.saveControlLedger();
        this.log.info('GivHome recurring schedule restored for its next occurrence.');
      });
    }
  }
};
module.exports.SupersededControl = SupersededControl;
module.exports.numeric = numeric;
module.exports.hr = hr;
