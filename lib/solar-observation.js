'use strict';

const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { ObservationStore, LIMITS, finite } = require('./solar-observation-store');
const VERSION = 1;
const POWERS = ['loadPowerW', 'pvPowerW', 'gridImportPowerW', 'gridExportPowerW', 'batteryChargePowerW', 'batteryDischargePowerW'];
const round = n => Math.round(n * 1e8) / 1e8;
const boundedCount = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000;
const inc = (object, key, n = 1) => { object[key] = Math.min(1000000000, (object[key] || 0) + n); };
function emptyModel(fingerprints) {
  return { version: VERSION, fingerprints, automaticControl: false, qualified: false,
    state: 'Learning; provisional observations only', profiles: {}, charge: Array.from({ length: 10 }, () => ({ seconds: 0, kwh: 0, maxW: 0 })),
    counts: { minutes: 0, observedSeconds: 0, invalid: 0, gaps: 0, dropped: 0, storageFaults: 0, forecasts: 0 },
    firstAt: null, lastAt: null, solar: { correctionsQualified: false, reason: 'Output constraints and complete forecast trajectories are not qualified in this foundation.' } };
}

function validSaved(saved) {
  if (!saved || saved.version !== VERSION || saved.automaticControl !== false || saved.qualified !== false
    || !saved.fingerprints || !saved.profiles || !saved.counts || Object.keys(saved.profiles).length > 96
    || !Array.isArray(saved.charge) || saved.charge.length !== 10
    || (saved.firstAt !== null && !finite(saved.firstAt)) || (saved.lastAt !== null && !finite(saved.lastAt))) return false;
  for (const [key, p] of Object.entries(saved.profiles)) {
    if (!/^(weekday|weekend)-([0-3]\d|4[0-7])$/.test(key) || !p || ![p.seconds, p.loadKwh, p.pvKwh, p.maxLoadW].every(finite)
      || p.seconds < 0 || p.seconds > 365 * 86400 || p.loadKwh < 0 || p.loadKwh > 1000000
      || p.pvKwh < 0 || p.pvKwh > 1000000 || p.maxLoadW < 0 || p.maxLoadW > 100000) return false;
  }
  if (!saved.charge.every(p => p && [p.seconds, p.kwh, p.maxW].every(finite)
    && p.seconds >= 0 && p.seconds <= 365 * 86400 && p.kwh >= 0 && p.kwh <= 1000000 && p.maxW >= 0 && p.maxW <= 100000)) return false;
  return ['minutes', 'observedSeconds', 'invalid', 'gaps', 'dropped', 'storageFaults', 'forecasts'].every(k => boundedCount(saved.counts[k]));
}

class SolarObservation {
  constructor({ directory, fingerprints, pollSeconds = 30, now = Date.now,
    monotonic = () => performance.now(), log = { info() {}, warn() {} }, storeOptions = {} }) {
    this.now = now; this.monotonic = monotonic; this.log = log; this.fingerprints = fingerprints;
    this.maxGapMs = Math.min(180000, Math.max(60000, pollSeconds * 2500));
    this.model = emptyModel(fingerprints); this.previous = null; this.minute = null; this.aggregate = null;
    this.started = false; this.stopping = false; this.timer = null; this.epoch = 0; this.lastWarning = -Infinity;
    this.store = new ObservationStore({ ...storeOptions, directory, now,
      onFault: () => { inc(this.model.counts, 'storageFaults'); this.breakChain('storage-fault'); this.warn(); },
      onLoss: count => { inc(this.model.counts, 'dropped', count); this.breakChain('dropped'); } });
  }

  // One bounded store for this singular platform. Renaming/replacing a device cannot accumulate orphan stores.
  static directory(storagePath) { return path.join(storagePath, 'givhome-solar-observation'); }

  warn() {
    if (this.now() - this.lastWarning < 3600000) return;
    this.lastWarning = this.now();
    try { this.log.warn('[Solar Observation] local learning is degraded; normal GivHome controls continue. Check local storage and observation status.'); } catch {}
  }

  start(resetKey = '') {
    if (!this.startPromise) this.startPromise = this.begin(resetKey);
    return this.startPromise;
  }

  async begin(resetKey) {
    const saved = await this.store.init(resetKey);
    if (!this.store.ready || this.stopping) {
      if (this.store.ready) await this.store.close();
      return false;
    }
    if (validSaved(saved)) {
      // Copy only validated model fields. Stored objects never become executable configuration.
      const recent = finite(saved.lastAt) && this.now() >= saved.lastAt && this.now() - saved.lastAt < 28 * 86400000;
      if (recent && saved.fingerprints.load === this.fingerprints.load) this.model.profiles = saved.profiles;
      if (recent && saved.fingerprints.charge === this.fingerprints.charge) this.model.charge = saved.charge;
      const startupCounts = this.model.counts;
      this.model.counts = { ...saved.counts };
      for (const [key, count] of Object.entries(startupCounts)) inc(this.model.counts, key, count);
      this.model.firstAt = saved.firstAt; this.model.lastAt = recent ? saved.lastAt : null;
      inc(this.model.counts, 'gaps');
    } else if (saved) { inc(this.model.counts, 'invalid'); this.warn(); }
    this.started = true;
    this.timer = setInterval(() => this.checkpoint().catch(() => this.warn()), LIMITS.flushMs);
    this.timer.unref?.();
    try { this.log.info('[Solar Observation] enabled: local, provisional learning only; no automatic charging and no data sent to the developer.'); } catch {}
    await this.checkpoint();
    return true;
  }

  breakChain(reason = 'gap') {
    this.previous = null; this.epoch = (this.epoch + 1) % 1000000000;
    if (this.minute) this.minute.incomplete = true;
    if (this.aggregate) this.aggregate.incomplete = true;
    if (reason !== 'dropped' && reason !== 'storage-fault') inc(this.model.counts, 'gaps');
  }

  controlChanged() { if (this.started) this.breakChain('control-change'); }

  observe(model, context = {}) {
    if (!this.started || this.stopping) return false;
    try { return this.capture(model, context); }
    catch { inc(this.model.counts, 'invalid'); this.breakChain('invalid'); this.warn(); return false; }
  }

  capture(model, context) {
    const at = this.now(); const mono = this.monotonic(); const stamped = Date.parse(model?.lastUpdatedISO);
    if (!model || model.telemetryOnline !== true || !finite(at) || !finite(mono) || !Number.isFinite(stamped)
      || Math.abs(at - stamped) > 10000 || !finite(model.socPercent) || model.socPercent < 0 || model.socPercent > 100
      || !POWERS.every(k => finite(model[k]) && model[k] >= 0 && model[k] <= 100000)) {
      inc(this.model.counts, 'invalid'); this.breakChain('invalid'); return false;
    }
    // Fixed booleans and a bounded epoch only; no raw labels, serials, API keys or configuration.
    const flags = (context.iog ? 1 : 0) | (context.ownedCharge ? 2 : 0) | (context.export ? 4 : 0)
      | (context.emergency ? 8 : 0) | (context.command ? 16 : 0) | (context.smart ? 32 : 0);
    const sample = { at, mono, soc: model.socPercent, values: POWERS.map(k => model[k]), flags, epoch: this.epoch };
    const prev = this.previous;
    this.previous = sample;
    if (!prev) return true;
    const dt = at - prev.at; const elapsed = mono - prev.mono;
    if (dt <= 0 || elapsed <= 0 || dt > this.maxGapMs || Math.abs(dt - elapsed) > 2000
      || prev.epoch !== sample.epoch || flags !== prev.flags) {
      this.breakChain('gap'); sample.epoch = this.epoch; this.previous = sample; return true;
    }
    // At most four minute segments at the fixed maximum gap. Trapezoidal integration is time weighted.
    for (let left = prev.at; left < at;) {
      if (this.epoch !== sample.epoch) return false;
      const start = Math.floor(left / 60000) * 60000; const right = Math.min(at, start + 60000);
      if (this.minute?.start !== start) { this.finishMinute(); this.minute = this.newMinute(start, flags); }
      const bucket = this.minute;
      const a = (left - prev.at) / dt; const b = (right - prev.at) / dt;
      for (let i = 0; i < POWERS.length; i++) {
        const v1 = prev.values[i] + (sample.values[i] - prev.values[i]) * a;
        const v2 = prev.values[i] + (sample.values[i] - prev.values[i]) * b;
        bucket.kwh[i] += (v1 + v2) / 2 * (right - left) / 3600000000;
      }
      bucket.seconds += (right - left) / 1000;
      bucket.endAt = right;
      bucket.maxLoadW = Math.max(bucket.maxLoadW, ...[prev.values[0], sample.values[0]]);
      bucket.maxChargeW = Math.max(bucket.maxChargeW, prev.values[4], sample.values[4]);
      bucket.minSoc = Math.min(bucket.minSoc, prev.soc, sample.soc); bucket.maxSoc = Math.max(bucket.maxSoc, prev.soc, sample.soc);
      if (bucket.flags !== flags) bucket.incomplete = true;
      left = right;
      if (right === start + 60000) this.finishMinute();
    }
    return true;
  }

  newMinute(start, flags) { return { v: VERSION, kind: 'minute', start,
    localOffsetMinutes: -new Date(start).getTimezoneOffset(), seconds: 0, kwh: Array(6).fill(0),
    minSoc: 100, maxSoc: 0, maxLoadW: 0, maxChargeW: 0, flags, incomplete: false,
    evSeparated: false, solarUnconstrained: false, fingerprints: this.fingerprints }; }

  finishMinute() {
    const m = this.minute; this.minute = null;
    if (!m || m.seconds <= 0) return;
    m.seconds = round(m.seconds); m.kwh = m.kwh.map(round);
    const accepted = this.store.enqueue('minute', m);
    if (!accepted) m.incomplete = true;
    inc(this.model.counts, 'minutes'); inc(this.model.counts, 'observedSeconds', Math.floor(m.seconds));
    this.model.firstAt ??= m.start; this.model.lastAt = m.endAt;
    const half = Math.floor(m.start / 1800000) * 1800000;
    if (this.aggregate?.start !== half) { this.finishAggregate(); this.aggregate = { v: VERSION, kind: 'aggregate', start: half,
      seconds: 0, kwh: Array(6).fill(0), incomplete: false, flags: 0, fingerprints: this.fingerprints }; }
    this.aggregate.seconds += m.seconds; this.aggregate.flags |= m.flags;
    this.aggregate.incomplete ||= m.incomplete;
    for (let i = 0; i < 6; i++) this.aggregate.kwh[i] += m.kwh[i];
    // All profiles are provisional site load, including any EV. No household/EV subtraction or confidence score.
    if (!accepted || m.incomplete || m.seconds < 59.99 || (m.flags & (4 | 8 | 16))) return;
    const date = new Date(m.start); const key = `${[0, 6].includes(date.getDay()) ? 'weekend' : 'weekday'}-${String(date.getHours() * 2 + Math.floor(date.getMinutes() / 30)).padStart(2, '0')}`;
    const p = this.model.profiles[key] || { seconds: 0, loadKwh: 0, pvKwh: 0, maxLoadW: 0 };
    // Cap effective history at 28 days per time bucket by exponential decay, preserving change adaptation.
    const decay = Math.max(0, 1 - m.seconds / (28 * 1800));
    p.seconds = round(p.seconds * decay + m.seconds); p.loadKwh = round(p.loadKwh * decay + m.kwh[0]);
    p.pvKwh = round(p.pvKwh * decay + m.kwh[1]); p.maxLoadW = Math.max(p.maxLoadW * decay, m.maxLoadW);
    this.model.profiles[key] = p;
    // Observe ordinary charge response only. These are observations, never proof of capacity or a safe power setting.
    if ((m.flags & 2) && !(m.flags & (4 | 8 | 16)) && m.minSoc >= 0 && Math.floor(m.minSoc / 10) === Math.floor(m.maxSoc / 10)) {
      const bin = this.model.charge[Math.min(9, Math.floor(m.minSoc / 10))];
      bin.seconds = round(bin.seconds * decay + m.seconds); bin.kwh = round(bin.kwh * decay + m.kwh[4]);
      bin.maxW = Math.max(bin.maxW * decay, m.maxChargeW);
    }
  }

  finishAggregate() {
    const a = this.aggregate; this.aggregate = null;
    if (!a || a.seconds <= 0) return;
    a.seconds = round(a.seconds); a.kwh = a.kwh.map(round); a.incomplete ||= a.seconds < 1799.99;
    this.store.enqueue('aggregate', a);
  }

  forecast(record) {
    if (!this.started || this.stopping) return false;
    // The forecast adapter supplies a bounded, whitelisted record. Revisions append; never overwrite an earlier issue.
    if (!record || record.v !== VERSION || record.kind !== 'forecast' || !finite(record.issuedAt)
      || Math.abs(this.now() - record.issuedAt) > 60000 || !Array.isArray(record.arrays) || record.arrays.length > 8) return false;
    const arrays = [];
    for (const array of record.arrays) {
      if (!array || !Array.isArray(array.intervals) || array.intervals.length > 72) return false;
      const intervals = [];
      for (const interval of array.intervals) {
        if (!interval || (interval.kwh !== null && (!finite(interval.kwh) || interval.kwh < 0 || interval.kwh > 1000))
          || (interval.endUtc !== null && !finite(interval.endUtc)) || (interval.startUtc !== null && !finite(interval.startUtc))
          || (interval.endLocal !== null && (typeof interval.endLocal !== 'string' || interval.endLocal.length > 19))) return false;
        intervals.push({ endLocal: interval.endLocal, startUtc: interval.startUtc, endUtc: interval.endUtc, kwh: interval.kwh });
      }
      arrays.push({ intervals, timezone: typeof array.timezone === 'string' && array.timezone.length <= 64 ? array.timezone : null,
        invalid: boundedCount(array.invalid) ? array.invalid : intervals.length, truncated: array.truncated === true,
        receivedAt: finite(array.receivedAt) ? array.receivedAt : record.issuedAt, qualified: false });
    }
    const accepted = this.store.enqueue('forecast', { v: VERSION, kind: 'forecast', issuedAt: record.issuedAt,
      issueTimeBasis: 'local receipt; provider model issue time unavailable',
      date: typeof record.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(record.date) ? record.date : null,
      kwh: finite(record.kwh) && record.kwh >= 0 && record.kwh <= 10000 ? record.kwh : null,
      complete: record.complete === true, arrays, qualified: false, fingerprint: this.fingerprints.solar });
    if (accepted) inc(this.model.counts, 'forecasts');
    return accepted;
  }

  snapshot() {
    // Copy before the first filesystem await; telemetry may update the live model while a flush is in progress.
    return JSON.parse(JSON.stringify({ ...this.model, updatedAt: this.now(),
      status: { ...this.store.status(), automaticControl: false, qualified: false,
        reason: 'Foundation only: EV attribution, solar constraints, uncertainty and automatic planning remain unqualified.' } }));
  }

  async checkpoint() { return this.store.flush(this.snapshot()); }

  async stop() {
    this.stopping = true; if (this.timer) clearInterval(this.timer); this.timer = null;
    if (!this.started) return;
    this.finishMinute(); this.finishAggregate(); this.previous = null;
    await this.store.close(this.snapshot()); this.started = false;
  }
}

module.exports = { SolarObservation, VERSION, POWERS, emptyModel, validSaved };
