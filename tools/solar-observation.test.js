'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const io = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { SolarObservation, POWERS, emptyModel, validSaved } = require('../lib/solar-observation');
const { ObservationStore, LIMITS } = require('../lib/solar-observation-store');
const { localUtcResolver, captureArrayForecast } = require('../lib/solar-observation-forecast');
const { PredictedSolarController, shadingMultiplier } = require('../lib/predicted-solar');
const { GivHomeModbusPlatform } = require('../index');
const fingerprints = { load: 'load', solar: 'solar', charge: 'charge' };
const base = Date.parse('2026-10-17T00:00:00Z');
const log = { info() {}, warn() {}, error() {} };
async function harness(t, options = {}) {
  const directory = await io.mkdtemp(path.join(os.tmpdir(), 'givhome-observation-test-'));
  let at = base; let mono = 0;
  const observer = new SolarObservation({ directory, fingerprints, now: () => at, monotonic: () => mono, log, ...options });
  t.after(async () => { await observer.stop(); await io.rm(directory, { recursive: true, force: true }); });
  await observer.start();
  function sample(advance = 30000, changes = {}, context = {}) {
    at += advance; mono += advance;
    const model = { telemetryOnline: true, lastUpdatedISO: new Date(at).toISOString(), socPercent: 50,
      ...Object.fromEntries(POWERS.map(k => [k, 0])), loadPowerW: 1000, pvPowerW: 2000, ...changes };
    return observer.observe(model, context);
  }
  return { observer, directory, sample, setClock: (wall, monotonic) => { at = wall; mono = monotonic; }, now: () => at };
}
async function records(directory, kind = 'minute') {
  const files = (await io.readdir(directory)).filter(n => n.startsWith(kind + '-') && n.endsWith('.ndjson')).sort();
  return (await Promise.all(files.map(n => io.readFile(path.join(directory, n), 'utf8')))).flatMap(s => s.trim().split('\n').filter(Boolean).map(s => JSON.parse(s)));
}

test('analytical constant power: one kWh load, two kWh PV in one hour', async t => {
  const h = await harness(t); h.sample(0);
  for (let i = 0; i < 120; i++) h.sample();
  await h.observer.checkpoint(); const rows = await records(h.directory);
  assert.equal(rows.length, 60);
  assert.ok(Math.abs(rows.reduce((s, r) => s + r.kwh[0], 0) - 1) < 1e-6);
  assert.ok(Math.abs(rows.reduce((s, r) => s + r.kwh[1], 0) - 2) < 1e-6);
  assert.equal(h.observer.model.counts.observedSeconds, 3600);
  assert.equal(h.observer.model.qualified, false); assert.equal(h.observer.model.automaticControl, false);
});

test('linear ramp uses trapezoids and splits minute boundaries', async t => {
  const h = await harness(t); h.sample(0, { loadPowerW: 0 });
  h.sample(45000, { loadPowerW: 1500 }); h.sample(45000, { loadPowerW: 3000 });
  await h.observer.stop(); const rows = await records(h.directory);
  assert.ok(Math.abs(rows.reduce((s, r) => s + r.kwh[0], 0) - 0.0375) < 1e-7);
  assert.equal(rows[0].seconds, 60); assert.equal(rows[1].seconds, 30);
});

for (const value of [null, undefined, '1000', NaN, Infinity, -1, 100001]) {
  test(`invalid power ${String(value)} creates a gap, never a zero`, async t => {
    const h = await harness(t); h.sample(0); assert.equal(h.sample(30000, { loadPowerW: value }), false);
    h.sample(); h.sample(); await h.observer.stop();
    assert.equal(h.observer.model.counts.invalid, 1);
    assert.equal((await records(h.directory)).reduce((s, r) => s + r.seconds, 0), 30);
    assert.equal(Object.keys(h.observer.model.profiles).length, 0);
  });
}

test('missing polls and long gaps are not filled with old power', async t => {
  const h = await harness(t); h.sample(0); h.sample(3600000); h.sample(); await h.observer.stop();
  assert.equal((await records(h.directory)).reduce((s, r) => s + r.seconds, 0), 30);
});
test('clock jump, duplicate and reordered samples cannot fabricate energy', async t => {
  const h = await harness(t); h.sample(0); h.sample(0); h.sample(-30000);
  h.setClock(base + 3600000, 0); h.sample(0); h.sample(); await h.observer.stop();
  assert.equal((await records(h.directory)).reduce((s, r) => s + r.seconds, 0), 30);
  assert.ok(h.observer.model.counts.gaps >= 3);
});
test('control changes, even a burst between polls, invalidate the training interval', async t => {
  const h = await harness(t); h.sample(0); h.sample(); h.observer.controlChanged(); h.observer.controlChanged();
  h.sample(); h.sample(); h.sample(); await h.observer.stop();
  const rows = await records(h.directory); assert.ok(rows.some(r => r.incomplete));
  assert.equal(Object.values(h.observer.model.profiles).reduce((s, p) => s + p.seconds, 0), 60);
});
test('IOG, export, emergency and command context is labelled with EV separation unproved', async t => {
  const h = await harness(t); const context = { iog: true, smart: true, export: true, emergency: true, command: true };
  h.sample(0, {}, context); h.sample(30000, {}, context); h.sample(30000, {}, context);
  await h.observer.stop(); const [row] = await records(h.directory);
  assert.equal(row.flags, 61); assert.equal(row.evSeparated, false); assert.equal(row.solarUnconstrained, false);
  assert.ok(h.observer.model.charge.every(b => b.seconds === 0));
});
test('ordinary authorised charge response remains provisional and separated from capacity claims', async t => {
  const h = await harness(t); const context = { ownedCharge: true };
  h.sample(0, { batteryChargePowerW: 3000 }, context);
  h.sample(30000, { batteryChargePowerW: 3000 }, context); h.sample(30000, { batteryChargePowerW: 3000 }, context);
  assert.ok(Math.abs(h.observer.model.charge[5].kwh - 0.05) < 1e-7);
  assert.equal(h.observer.model.qualified, false);
});
test('DST autumn intervals have distinct UTC keys and observed seconds', async t => {
  const h = await harness(t); h.setClock(Date.parse('2026-10-25T00:00:00Z'), 0); h.sample(0);
  for (let i = 0; i < 240; i++) h.sample();
  await h.observer.checkpoint(); const rows = await records(h.directory);
  assert.equal(new Set(rows.map(r => r.start)).size, 120); assert.equal(rows.length, 120);
  assert.equal(rows.reduce((s, r) => s + r.seconds, 0), 7200);
  assert.equal(new Set(rows.map(r => r.localOffsetMinutes)).size, 2);
});
test('forecast timezone resolver rejects missing and ambiguous DST times', () => {
  const spring = localUtcResolver('Europe/London', '2026-03-29');
  assert.equal(spring('2026-03-29T01:00'), null);
  assert.equal(spring('2026-03-29T02:00'), Date.parse('2026-03-29T01:00Z'));
  const autumn = localUtcResolver('Europe/London', '2026-10-25');
  assert.equal(autumn('2026-10-25T01:00'), null);
  assert.equal(autumn('2026-10-25T02:00'), Date.parse('2026-10-25T02:00Z'));
  assert.equal(autumn('2026-02-31T02:00'), null);
});
test('forecast capture does not turn missing irradiance into zero or accept unbounded responses', () => {
  const data = { timezone: 'Europe/London', hourly: { time: Array(10000).fill('2026-10-17T12:00'), global_tilted_irradiance: [null, 500] } };
  const result = captureArrayForecast({ data, array: { capacityKw: 4 }, targetDate: '2026-10-17', performanceRatio: .8, shadingMultiplier });
  assert.equal(result.intervals.length, 72); assert.equal(result.truncated, true);
  assert.equal(result.intervals[0].kwh, null); assert.equal(result.intervals[1].kwh, 1.6);
  assert.equal(result.intervals[1].endUtc - result.intervals[1].startUtc, 3600000);
  assert.equal(result.qualified, false);
});
test('issued forecast revisions append immutably without location or panel names', async t => {
  const h = await harness(t);
  const record = { v: 1, kind: 'forecast', issuedAt: h.now(), date: '2026-10-18', kwh: 10, arrays: [] };
  assert.equal(h.observer.forecast(record), true); record.kwh = 20; h.observer.forecast(record);
  await h.observer.checkpoint(); const rows = await records(h.directory, 'forecast');
  assert.deepEqual(rows.map(r => r.kwh), [10, 20]);
  assert.ok(rows.every(r => !('location' in r)));
});
test('compatible model resumes, material setup changes invalidate affected summaries only', async t => {
  const h = await harness(t); h.sample(0); h.sample(); h.sample(); await h.observer.stop();
  const resumed = new SolarObservation({ directory: h.directory, fingerprints, now: () => h.now(), log });
  await resumed.start(); assert.ok(Object.keys(resumed.model.profiles).length > 0); await resumed.stop();
  const twice = new SolarObservation({ directory: h.directory, fingerprints, now: () => h.now(), log });
  await twice.start(); assert.ok(Object.keys(twice.model.profiles).length > 0); await twice.stop();
  const changed = new SolarObservation({ directory: h.directory, fingerprints: { ...fingerprints, load: 'new-timezone' }, now: () => h.now(), log });
  await changed.start(); assert.equal(Object.keys(changed.model.profiles).length, 0); await changed.stop();
});
test('stale or future-dated model cannot resume as recent learning', async t => {
  const h = await harness(t); h.sample(0); h.sample(); h.sample(); await h.observer.stop();
  const old = new SolarObservation({ directory: h.directory, fingerprints, now: () => h.now() + 29 * 86400000, log });
  await old.start(); assert.equal(Object.keys(old.model.profiles).length, 0); await old.stop();
});
test('corrupt current snapshot recovers previous, corrupt/truncated raw pages are never replayed as qualified data', async t => {
  const h = await harness(t); h.sample(0); h.sample(); h.sample(); await h.observer.checkpoint(); await h.observer.stop();
  await io.writeFile(path.join(h.directory, 'model.json'), '{partial');
  await io.writeFile(path.join(h.directory, `minute-${base}-abcdef123456.ndjson`), '{partial');
  const resumed = new SolarObservation({ directory: h.directory, fingerprints, now: () => h.now(), log });
  assert.equal(await resumed.start(), true); assert.equal(resumed.model.qualified, false); await resumed.stop();
  assert.ok(resumed.model.counts.storageFaults > 0);
});
test('saved model validation rejects oversized dimensions, negative evidence and qualification claims', () => {
  const model = emptyModel(fingerprints); assert.equal(validSaved(model), true);
  assert.equal(validSaved({ ...model, qualified: true }), false);
  assert.equal(validSaved({ ...model, charge: Array(10000).fill(0) }), false);
  assert.equal(validSaved({ ...model, profiles: { 'weekday-01': { seconds: -1, loadKwh: 0, pvKwh: 0, maxLoadW: 0 } } }), false);
});
test('reset key is applied once; reset touches only its own store', async t => {
  const h = await harness(t); h.sample(0); h.sample(); h.sample(); await h.observer.stop();
  const before = await records(h.directory); assert.ok(before.length);
  const reset = new SolarObservation({ directory: h.directory, fingerprints, now: () => h.now(), log });
  await reset.start('reset-1'); assert.equal((await records(h.directory)).length, 0); await reset.stop();
  const marker = path.join(h.directory, `minute-${base}-abcdef123456.ndjson`); await io.writeFile(marker, '{}\n');
  const again = new SolarObservation({ directory: h.directory, fingerprints, now: () => h.now(), log });
  await again.start('reset-1'); assert.ok(fs.existsSync(marker)); await again.stop();
});
test('oversized files and symlinks suspend observation and preserve foreign data', async t => {
  const h = await harness(t); await h.observer.stop();
  const foreign = path.join(h.directory, 'foreign'); await io.writeFile(foreign, 'keep');
  const store = new ObservationStore({ directory: h.directory });
  await store.init(); assert.equal(store.ready, false); assert.equal(await io.readFile(foreign, 'utf8'), 'keep');
  await io.unlink(foreign);
  const outside = h.directory + '-outside'; await io.writeFile(outside, 'keep'); t.after(() => io.rm(outside, { force: true }));
  await io.symlink(outside, path.join(h.directory, 'model.tmp'));
  const symlink = new ObservationStore({ directory: h.directory }); await symlink.init(); assert.equal(symlink.ready, false);
  assert.equal(await io.readFile(outside, 'utf8'), 'keep');
});
test('queue overflow is bounded and marks learning incomplete', async t => {
  const h = await harness(t, { storeOptions: { limits: { queueBytes: 256, queueRecords: 1 } } });
  h.sample(0); for (let i = 0; i < 10; i++) h.sample();
  assert.ok(h.observer.store.queueBytes <= 256); assert.ok(h.observer.model.counts.dropped > 0);
  assert.equal(Object.keys(h.observer.model.profiles).length, 0);
});
test('slow storage never grows the queue without a bound', async t => {
  const h = await harness(t); let release; const stalled = new Promise(r => { release = r; });
  const open = h.observer.store.io.open;
  h.observer.store.io = { ...io, open: async (...args) => { await stalled; return open(...args); } };
  for (let i = 0; i < 1000; i++) h.observer.store.enqueue('minute', { n: i, text: 'x'.repeat(900) });
  assert.ok(h.observer.store.queueBytes <= LIMITS.queueBytes); assert.ok(h.observer.store.queue.length <= LIMITS.queueRecords);
  assert.ok(h.observer.store.dropped > 0); release(); await h.observer.checkpoint();
});
test('disk-full faults back off, bound files/queue and cannot call controls', async t => {
  const h = await harness(t); let calls = 0;
  h.observer.store.io = { ...io, open: async () => { calls++; const error = new Error('full'); error.code = 'ENOSPC'; throw error; } };
  h.sample(0); h.sample(); h.sample(); assert.equal(await h.observer.checkpoint(), false);
  const prior = calls; await h.observer.checkpoint(); assert.equal(calls, prior);
  assert.equal(h.observer.store.queueBytes, 0); assert.ok(h.observer.store.faults > 0);
  assert.equal(h.observer.model.qualified, false);
});
test('retention and small hard quota account temporary and previous model files', async t => {
  const h = await harness(t, { storeOptions: { limits: { diskBytes: 8000, files: 12 } } });
  for (let day = 0; day < 10; day++) {
    h.setClock(base + day * 86400000, day * 86400000);
    for (let i = 0; i < 8; i++) h.observer.store.enqueue('minute', { day, i, x: 'x'.repeat(500) });
    await h.observer.checkpoint();
    const names = await io.readdir(h.directory); const stats = await Promise.all(names.map(n => io.stat(path.join(h.directory, n))));
    assert.ok(stats.reduce((s, x) => s + x.size, 0) <= 8000); assert.ok(names.length <= 12);
  }
  assert.ok((await records(h.directory)).every(r => r.day >= 2));
});
test('observer graph has only local built-ins, and runs with network functions trapped', async t => {
  const allowed = new Set(['node:fs', 'node:path', 'node:crypto', 'node:perf_hooks']);
  for (const file of ['solar-observation.js', 'solar-observation-store.js', 'solar-observation-forecast.js']) {
    const source = await io.readFile(path.join(__dirname, '..', 'lib', file), 'utf8');
    for (const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) assert.ok(allowed.has(match[1]) || match[1] === './solar-observation-store', match[1]);
    assert.doesNotMatch(source, /\bfetch\s*\(|https?:\/\//);
  }
  const original = global.fetch; global.fetch = () => { throw new Error('unexpected network'); };
  for (const [module, method] of [['node:net', 'connect'], ['node:tls', 'connect'], ['node:http', 'request'], ['node:https', 'request']]) {
    t.mock.method(require(module), method, () => { throw new Error('unexpected network'); });
  }
  try { const h = await harness(t); h.sample(0); h.sample(); h.sample(); await h.observer.checkpoint(); }
  finally { global.fetch = original; }
});
test('observation failures cannot change successful telemetry or block queued controls', async () => {
  const p = Object.create(GivHomeModbusPlatform.prototype);
  Object.assign(p, { health: { consecutiveFailures: 0, totalPolls: 0 }, beta9PerfNowMs: () => 0,
    updateAccessories: () => ({ attempts: 0 }), log, observeSolarTelemetry() { throw new Error('broken observer'); },
    observeSolarControlChange() { throw new Error('broken observer'); }, commandTransportSequence: 0,
    commandQueueDepth: 0, commandPollHoldUntilMs: 0, enterQueuedCommandTransportGate: async (_label, fn) => fn() });
  p.handlePollSuccess({ response: {}, model: {}, durationMs: 1 }); assert.equal(p.health.state, 'online');
  assert.equal(await p.withManualChargeTransportGate('simulated command', async () => 'ran'), 'ran');
});
test('forecast whitelist removes identifying extras and rejects unbounded dimensions', async t => {
  const h = await harness(t); const record = { v: 1, kind: 'forecast', issuedAt: h.now(), arrays: [],
    apiKey: 'must-not-persist', location: 'must-not-persist' };
  assert.equal(h.observer.forecast(record), true);
  assert.equal(h.observer.forecast({ ...record, arrays: Array(9).fill({ intervals: [] }) }), false);
  assert.equal(h.observer.forecast({ ...record, arrays: [{ intervals: Array(10000).fill(null) }] }), false);
  await h.observer.checkpoint(); assert.doesNotMatch(JSON.stringify(await records(h.directory, 'forecast')), /must-not-persist|apiKey|location/);
});
test('interrupted reset and checkpoint temporary files recover without growing an archive', async t => {
  const h = await harness(t); await h.observer.stop();
  await io.writeFile(path.join(h.directory, 'reset.json'), JSON.stringify({ key: 'interrupted', pending: true }));
  await io.writeFile(path.join(h.directory, 'model.tmp'), '{partial');
  const resumed = new SolarObservation({ directory: h.directory, fingerprints, now: () => h.now(), log });
  assert.equal(await resumed.start(), true); await resumed.stop();
  assert.equal(fs.existsSync(path.join(h.directory, 'model.tmp')), false);
  assert.equal(JSON.parse(await io.readFile(path.join(h.directory, 'reset.json'), 'utf8')).pending, false);
  assert.ok((await io.readdir(h.directory)).length <= 3);
});
test('partial page write failure cleans up and backoff prevents a retry storm', async t => {
  const h = await harness(t); const original = h.observer.store.io.open;
  h.observer.store.io = { ...io, open: async (...args) => {
    const file = await original(...args);
    if (String(args[0]).endsWith('.ndjson')) return { close: () => file.close(), writeFile: async () => { await file.writeFile('{partial'); throw new Error('killed write'); } };
    return file;
  } };
  h.sample(0); h.sample(); h.sample(); assert.equal(await h.observer.checkpoint(), false);
  assert.equal((await records(h.directory)).length, 0); assert.ok(h.observer.store.retryAt > h.now());
});
test('forecast observation adds no service requests and preserves the published result', async t => {
  const directory = await io.mkdtemp(path.join(os.tmpdir(), 'givhome-forecast-test-')); t.after(() => io.rm(directory, { recursive: true, force: true }));
  const config = { enablePredictedSolar: true, predictedSolarLocation: 'test', predictedSolarArrays: [{ capacityKw: 4 }] };
  const requests = [[], []]; const outputs = []; let observation;
  for (let enabled = 0; enabled <= 1; enabled++) {
    const controller = new PredictedSolarController({ config, log, storagePath: directory, onUpdate: r => outputs.push(r),
      onObservationForecast: enabled ? r => { observation = r; } : undefined,
      fetchImpl: async url => { requests[enabled].push(url); return { ok: true, json: async () => ({ timezone: 'Europe/London', hourly: {
        time: ['2026-10-17T12:00', '2026-10-18T12:00'], global_tilted_irradiance: [500, 600] } }) }; } });
    controller.location = { latitude: 50, longitude: -5 };
    await controller.refresh();
  }
  assert.deepEqual(requests[0], requests[1]); assert.equal(outputs[0].kwh, outputs[1].kwh);
  assert.equal(observation.qualified, false); assert.ok(!('location' in observation));
});
test('disabled platform creates no observer, timer, listener, files or network work', () => {
  const p = Object.create(GivHomeModbusPlatform.prototype); p.config = { enableSolarObservation: false }; p.api = { on() { assert.fail('listener'); } };
  p.getStoragePath = () => assert.fail('storage'); p.startSolarObservation(); assert.equal(p.solarObservation, undefined);
});
test('renaming/replacing a device cannot create unbounded stores; duplicate local producer is isolated', async t => {
  assert.equal(SolarObservation.directory('/tmp/site', 'first'), SolarObservation.directory('/tmp/site', 'renamed'));
  const h = await harness(t);
  const duplicate = new SolarObservation({ directory: h.directory, fingerprints, now: () => h.now(), log });
  assert.equal(await duplicate.start(), false); await duplicate.stop();
  assert.equal(h.observer.store.ready, true); h.sample(0); h.sample(); h.sample();
  assert.equal(await h.observer.checkpoint(), true);
});
test('repeated start has one timer and shutdown during recovery releases the local store', async t => {
  const h = await harness(t); const timer = h.observer.timer;
  assert.equal(await h.observer.start(), true); assert.equal(h.observer.timer, timer);
  await h.observer.stop();
  const interrupted = new SolarObservation({ directory: h.directory, fingerprints, now: () => h.now(), log });
  const starting = interrupted.start(); await interrupted.stop();
  assert.equal(await starting, false); assert.equal(interrupted.store.ready, false);
  const resumed = new SolarObservation({ directory: h.directory, fingerprints, now: () => h.now(), log });
  assert.equal(await resumed.start(), true); await resumed.stop();
});
test('unverified responder never reaches observation callback', async () => {
  const { DirectLocalReadOnlyClient } = require('../lib/direct-modbus-client');
  const original = DirectLocalReadOnlyClient.prototype.readInputRegisters;
  let failures = 0;
  DirectLocalReadOnlyClient.prototype.readInputRegisters = async () => ({ inverterSerial: 'CHdifferent', values: Array(61).fill(0) });
  try {
    const p = Object.create(GivHomeModbusPlatform.prototype);
    Object.assign(p, { inverterSerial: 'CHexpected', commandPollHoldUntilMs: 0, handlePollFailure() { failures++; },
      handlePollSuccess() { assert.fail('unverified sample'); }, observeSolarTelemetry() { assert.fail('unverified observation'); } });
    await p.pollOnce(); assert.equal(failures, 1);
  } finally { DirectLocalReadOnlyClient.prototype.readInputRegisters = original; }
});

test('owner-approved beta publication is explicit and does not claim hardware qualification', () => {
  const { publicationDecision } = require('./verify-observation-qualification');
  const input = { pkg: { version: '4.0.3-beta.9' }, runtimeSha256: 'reviewed',
    schema: { schema: { properties: { enableSolarObservation: { default: true }, enableEmergencyStopTile: { default: true } } } },
    foundation: { automaticControl: false, qualified: false },
    record: { version: '4.0.3-beta.9', runtimeSha256: 'reviewed', status: 'pending',
      networkIsolationPassed: true, faultAndRetentionPassed: true, evidence: 'local validation',
      betaPublication: { version: '4.0.3-beta.9', authorizedBy: 'project owner', authorizedOn: '2026-10-20', observationDefaultEnabled: true, emergencyStopDefaultEnabled: true,
        channel: 'beta', optIn: true, piSoakRequiredBeforeBetaPublication: false } } };
  assert.equal(publicationDecision(input).allowed, false);
  assert.deepEqual(publicationDecision(input, true), { allowed: true, hardwareQualified: false });
});

test('beta approval cannot authorise another version, changed runtime, unapproved defaults or automatic control', () => {
  const { publicationDecision } = require('./verify-observation-qualification');
  const input = { pkg: { version: '4.0.3-beta.9' }, runtimeSha256: 'reviewed',
    schema: { schema: { properties: { enableSolarObservation: { default: true }, enableEmergencyStopTile: { default: true } } } },
    foundation: { automaticControl: false, qualified: false },
    record: { version: '4.0.3-beta.9', runtimeSha256: 'reviewed', status: 'pending',
      networkIsolationPassed: true, faultAndRetentionPassed: true, evidence: 'local validation',
      betaPublication: { version: '4.0.3-beta.9', authorizedBy: 'project owner', authorizedOn: '2026-10-20', observationDefaultEnabled: true, emergencyStopDefaultEnabled: true,
        channel: 'beta', optIn: true, piSoakRequiredBeforeBetaPublication: false } } };
  for (const change of [
    x => { x.runtimeSha256 = 'different'; },
    x => { x.pkg.version = x.record.version = x.record.betaPublication.version = '4.0.3'; },
    x => { x.pkg.version = x.record.version = x.record.betaPublication.version = '4.0.3-beta.10'; },
    x => { x.schema.schema.properties.enableSolarObservation.default = false; },
    x => { x.schema.schema.properties.enableEmergencyStopTile.default = false; },
    x => { delete x.record.betaPublication.observationDefaultEnabled; },
    x => { delete x.record.betaPublication.emergencyStopDefaultEnabled; },
    x => { x.foundation.automaticControl = true; },
    x => { x.record.networkIsolationPassed = false; },
    x => { x.record.status = 'failed'; },
    x => { delete x.record.betaPublication; }
  ]) {
    const changed = structuredClone(input); change(changed);
    assert.equal(publicationDecision(changed, true).allowed, false);
  }
});

test('full qualification still needs matching measured budgets without beta approval', () => {
  const { publicationDecision } = require('./verify-observation-qualification');
  const pi = { hardware: 'synthetic test fixture', paired: true, hours: 72, noGrowingRetainedHeap: true,
    controlsResponsive: true, addedHeapMiB: 2, addedRssMiB: 8, addedOneCoreCpuPercent: .2,
    addedLoopP95Ms: 1, addedLoopP99Ms: 2 };
  const input = { pkg: { version: '4.0.3' }, runtimeSha256: 'reviewed', record: { version: '4.0.3',
    runtimeSha256: 'reviewed', status: 'passed', networkIsolationPassed: true, faultAndRetentionPassed: true,
    evidence: 'synthetic test fixture', minimumPi: pi, busierPi: pi } };
  assert.deepEqual(publicationDecision(input), { allowed: true, hardwareQualified: true });
  input.record.minimumPi = { ...pi, addedRssMiB: 17 };
  assert.equal(publicationDecision(input).allowed, false);
});

test('omitted local-learning setting starts one bounded observer; explicit false preserves an existing store', async t => {
  const directory = await io.mkdtemp(path.join(os.tmpdir(), 'givhome-default-learning-'));
  const listeners = [];
  const p = Object.create(GivHomeModbusPlatform.prototype);
  Object.assign(p, { config: {}, chargeTargetIdentity: 'default-learning-test', pollIntervalSeconds: 30,
    applianceControl: { batteryCapacityKwh: 13.5, maxBatteryChargePowerKw: 6 }, log,
    getStoragePath: () => directory, api: { on: (event, callback) => listeners.push([event, callback]) } });
  t.after(async () => { await p.solarObservation?.stop(); await io.rm(directory, { recursive: true, force: true }); });
  p.startSolarObservation(); await p.solarObservationStart;
  assert.equal(p.solarObservation.store.ready, true);
  assert.equal(p.solarObservation.model.automaticControl, false);
  const first = p.solarObservation; p.startSolarObservation();
  assert.equal(p.solarObservation, first); assert.equal(listeners.length, 1);
  await first.checkpoint(); await first.stop();
  const saved = await io.readFile(path.join(directory, 'givhome-solar-observation/model.json'));
  const disabled = Object.create(GivHomeModbusPlatform.prototype);
  Object.assign(disabled, { config: { enableSolarObservation: false },
    getStoragePath() { assert.fail('disabled learning must not touch storage'); },
    api: { on() { assert.fail('disabled learning must not add a listener'); } } });
  disabled.startSolarObservation(); assert.equal(disabled.solarObservation, undefined);
  assert.deepEqual(await io.readFile(path.join(directory, 'givhome-solar-observation/model.json')), saved);
});
