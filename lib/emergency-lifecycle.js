'use strict';

const { randomUUID } = require('crypto');
const { saveState } = require('./solar-aware-overnight');
const { readNamespace, readDeviceTime, inWindow, endOfWindow, pauseActive, sameValues, changedFutureRequiresEnable } = require('./control-state');

module.exports = {
  emergencyHeld() {
    const s = this.emergencyState;
    if (!s || s.status === 'released') return false;
    if (s.version === 2 && s.status === 'verified') return false;
    if (s.status === 'pending' && s.phase === 'detecting' && this.emergencyInFlight) return false;
    // Old verified records need fresh reconciliation, not a wait to their old end.
    return true;
  },

  async recoverEmergencyStopIfNeeded() {
    const s = this.emergencyState;
    if (!s || s.status === 'released' || s.version === 2 && s.status === 'verified' || this.emergencyInFlight) return;
    const wait = (this.emergencyRetryAtMs || 0) - Date.now();
    if (wait > 0 && wait <= 60000) return;
    if (!Number.isFinite(Date.parse(s.requestedAt))) {
      this.log.error('Emergency Stop: saved request time is unavailable; a fresh deliberate Emergency Stop is needed.'); return;
    }
    try { await this.acceptEmergencyStopRequest({ recovery: true }); }
    catch { /* Persistent state and bounded backoff are recorded by the request. */ }
  },

  acceptEmergencyStopRequest({ recovery = false } = {}) {
    if (this.emergencyInFlight) return this.emergencyInFlight;
    if ((!recovery && this.config.enableEmergencyStopTile !== true) || !this.applianceControl.masterGateSatisfied) throw new Error('Emergency Stop is not enabled');
    if (!this.controlProfile) throw new Error('Emergency Stop has no supported profile');
    if (this.controlProfile.kind === 'ce-ac-coupled' && !this.applianceControl.features.ceAcCoupledLiveWrites) throw new Error('CE/AC write acknowledgement is required');
    if (this.controlStorageFault) this.saveControlLedger();
    const old = this.emergencyState;
    if (!recovery && old && ['failed', 'pending'].includes(old.status) && (old.transaction || old.version !== 2)) return this.acceptEmergencyStopRequest({ recovery: true });
    if (recovery && (!old || old.identity !== this.chargeTargetIdentity)) throw new Error('No matching Emergency Stop recovery request');
    // A fresh press is deliberate new intent. A retry keeps the original plan.
    const pending = recovery ? { ...old, status: 'pending', phase: 'recovery', retryAttempt: Math.min(1000000, (old.retryAttempt || 0) + 1) }
      : { version: 2, id: randomUUID(), identity: this.chargeTargetIdentity, status: 'pending', phase: this.emergencyHeld() ? 'recovery' : 'detecting', requestedAt: new Date().toISOString(), retryAttempt: 0 };
    this.emergencyState = pending;
    saveState(this.emergencyStateFile, pending);
    this.publishEmergencyStopHomeKitState();
    const run = this.withManualChargeTransportGate('GivHome Emergency Stop', async () => {
      const read = this.readHoldingRegisters.bind(this), profile = this.controlProfile;
      const now = await readDeviceTime(read);
      const before = await readNamespace(read, profile, null, 'Emergency Stop preflight');
      const persist = () => { saveState(this.emergencyStateFile, pending); this.emergencyState = pending; };
      if (!pending.transaction) {
        let slots = profile.slots.filter(s => before[s.enable] === 1 && inWindow(before[s.pair[0]], before[s.pair[1]], now));
        let original = before;
        if (recovery && old.version !== 2) {
          original = old.initialRegisters || before;
          const requested = new Date(old.requestedAt);
          const prior = old.implicated || [];
          slots = profile.slots.filter(s => prior.some(p => p.family === s.family && p.id === s.id)
            || original[s.enable] === 1 && inWindow(original[s.pair[0]], original[s.pair[1]], requested));
          if (slots.some(s => s.pair.some(r => before[r] !== 0 && before[r] !== original[r]))) throw new Error('Legacy stopped slot changed; newer settings preserved');
          if (!slots.length && profile.slots.some(s => before[s.enable] === 1 && inWindow(before[s.pair[0]], before[s.pair[1]], now))) throw new Error('Legacy recovery cannot identify this later action; it will not cancel it');
        }
        if (recovery && old.version === 2 && slots.some(s => !inWindow(before[s.pair[0]], before[s.pair[1]], new Date(old.requestedAt)) || endOfWindow(before[s.pair[1]], new Date(old.requestedAt)) <= now.getTime() || now - new Date(old.requestedAt) >= 86400000)) throw new Error('A later action is running; recovery will not cancel it');
        const paused = pauseActive(before, profile, now);
        if (!slots.length && !paused && before[27] === 1) {
          pending.version = 2; pending.status = 'released'; pending.phase = 'complete'; pending.outcome = 'nothing-running'; pending.untilMs = 0; persist();
          this.emergencyRetryAtMs = 0;
          this.log.info('Emergency Stop: nothing running — no changes made; scheduled actions remain available.');
          return { idle: true, before, after: before, implicated: [], untilMs: 0 };
        }
        const ownerIds = [], occurrences = [], deferred = [];
        const writes = [], families = new Set(slots.map(s => s.family));
        for (const family of families) if (before[family === 'charge' ? 96 : 59] !== 0) writes.push([family === 'charge' ? 96 : 59, 0]);
        for (const slot of slots) {
          const times = slot.pair.map(r => original[r]);
          const owner = this.currentControlOwner(slot.family);
          const matches = owner && sameValues(before, owner.expected) && owner.slotId === slot.id;
          if (matches) { ownerIds.push([slot.family, owner.id]); if (owner.occurrence) occurrences.push(owner.occurrence); }
          for (const r of slot.pair) writes.push([r, 0]);
          const dueAtMs = endOfWindow(times[1], new Date(pending.requestedAt));
          // Slot 8 is the documented one-off route. Owned overlays restore their
          // captured prior schedule, not the just-cancelled temporary window.
          const restoreTimes = matches ? slot.pair.map(r => slot.family === 'export' && profile.route === 'ch-aio' && slot.id === 8 ? 0 : owner.before[r]) : times;
          if (matches || slot.id !== 8) {
            const restoreAtMs = restoreTimes[0] === restoreTimes[1] ? 0
              : inWindow(restoreTimes[0], restoreTimes[1], now) ? endOfWindow(restoreTimes[1], now) : now.getTime();
            if (restoreAtMs <= now.getTime()) slot.pair.forEach((r, i) => writes.push([r, restoreTimes[i]]));
            else deferred.push({ id: randomUUID(), family: slot.family, slotId: slot.id, pair: slot.pair, times: restoreTimes, dueAtMs: Math.max(dueAtMs, restoreAtMs) });
          }
        }
        if (before[27] !== 1) writes.push([27, 1]);
        if (paused) {
          writes.push([318, 0]);
          const owner = this.currentControlOwner('pause');
          if (owner && sameValues(before, owner.expected)) { ownerIds.push(['pause', owner.id]); if (owner.occurrence) occurrences.push(owner.occurrence); }
          if (profile.pauseTimes && before[319] !== before[320]) deferred.push({ id: randomUUID(), family: 'pause', slotId: 0, pair: [318], times: [before[318]], dueAtMs: endOfWindow(before[320], now) });
        }
        // When an external charge was stopped, prevent only the currently eligible
        // charging occurrence from immediately adopting the vacated charge route.
        if (families.has('charge') && !ownerIds.some(([f]) => f === 'charge')) {
          const cheap = this.currentCheapStateForStatusTiles();
          if (cheap.fallbackActive) occurrences.push(this.controlOccurrence('Cheap Overnight', now, cheap.fallbackWindowEnd));
          else if (cheap.smartActive) occurrences.push(this.controlOccurrence('Intelligent Octopus Go Home Battery Protection', now, cheap.protectedEnd));
        }
        for (const [family, id] of ownerIds) {
          const owner = this.currentControlOwner(family);
          if (owner?.id === id) for (const r of family === 'charge' ? [20, 111, 116] : family === 'export' ? [112, ...(profile.route === 'ch-aio' ? [293] : [])] : []) writes.push([r, owner.before[r]]);
        }
        for (const family of families) {
          const enable = family === 'charge' ? 96 : 59;
          const owner = this.currentControlOwner(family);
          const owned = owner && ownerIds.some(([f, id]) => f === family && id === owner.id);
          const final = { ...before, ...Object.fromEntries(writes) };
          const restoredEnable = owned ? owner.before[enable] === 1 || changedFutureRequiresEnable(profile, family, owner.before, final, [owner.slotId]) : original[enable] === 1;
          writes.push([enable, restoredEnable ? 1 : 0]);
        }
        pending.version = 2; pending.phase = 'stopping'; pending.initialRegisters ||= original;
        pending.implicated = slots.map(s => ({ family: s.family, id: s.id, times: s.pair.map(r => original[r]) }));
        pending.transaction = { writes, index: 0, working: Object.fromEntries([...new Set([27, ...(profile.pause ? [318] : []), ...writes.map(w => w[0])])].map(r => [r, before[r]])), ownerIds, occurrences: occurrences.filter(Boolean), deferred };
        if (this.controlLedger.deferred.length + deferred.length > 64) throw new Error('Recurring schedule journal is full; no writes sent');
        persist();
        for (const occurrence of pending.transaction.occurrences) this.rememberStoppedOccurrence(occurrence);
        this.emergencyGeneration = (this.emergencyGeneration || 0) + 1;
      }
      this.emergencyWriting = true;
      try { await this.runControlPlan(pending.transaction, 'Emergency Stop', persist); }
      finally { this.emergencyWriting = false; }
      const after = await readNamespace(read, profile, null, 'Emergency Stop final verification');
      if (!sameValues(after, pending.transaction.working)) throw new Error('Emergency Stop final verification changed; recovery will retry');
      for (const item of pending.transaction.deferred) if (!this.controlLedger.deferred.some(d => d.id === item.id)) this.controlLedger.deferred.push(item);
      this.saveControlLedger();
      for (const [family, id] of pending.transaction.ownerIds) this.retireControlOwner(family, id, 'Emergency Stop verified');
      pending.status = 'verified'; pending.phase = 'complete'; pending.untilMs = 0; pending.cleared = (pending.implicated || []).map(s => `${s.family} ${s.id}`); persist();
      this.emergencyRetryAtMs = 0; this.invalidateCommandTruthSnapshot('Emergency Stop verified');
      this.log.warn('Emergency Stop: verified — current action retired; Eco normal; future schedules reconciled. New actions are available. Physical flow awaits fresh telemetry.');
      return { before: pending.initialRegisters, after, implicated: pending.implicated || [], untilMs: 0 };
    });
    const completion = run.catch(err => {
      const delay = Math.min(60000, 5000 * 2 ** Math.min(pending.retryAttempt || 0, 4));
      this.emergencyRetryAtMs = Date.now() + delay;
      this.emergencyState = { ...pending, status: 'failed', error: err.message };
      try { saveState(this.emergencyStateFile, this.emergencyState); } catch { /* Durable pending evidence still prevents unverified recovery. */ }
      this.log.error('Emergency Stop: verification incomplete — %s. Communication recovery will retry; no stop success is assumed.', err.message);
      throw err;
    }).finally(() => { this.emergencyInFlight = null; this.publishEmergencyStopHomeKitState(); });
    this.emergencyInFlight = completion;
    return completion;
  }
};
