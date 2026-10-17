'use strict';

// Offline, accelerated retention test. It does not measure real-time Pi resource usage.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { SolarObservation } = require('../lib/solar-observation');
const { LIMITS, POLICIES } = require('../lib/solar-observation-store');

async function main() {
  const requested = process.argv.find(a => a.startsWith('--days='));
  const days = requested ? Number(requested.slice(7)) : 200;
  assert.ok(Number.isInteger(days) && days >= 1 && days <= 400);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'givhome-observation-stress-'));
  let at = Date.parse('2025-01-01T00:00:00Z'); let mono = 0;
  const fingerprints = { load: 'stress-load', charge: 'stress-charge', solar: 'stress-solar' };
  let observer; let captured = 0; let maximumDisk = 0; let maximumQueue = 0; let maximumFiles = 0;
  let expectedLoad = 0; let retainedHeapMax = 0; let captureMaxMs = 0;
  const captureHistogram = Array(8).fill(0); const thresholds = [.05, .1, .25, .5, 1, 2, 5, Infinity];
  const resourceSamples = [];
  const delay = monitorEventLoopDelay({ resolution: 10 });
  global.gc?.(); const before = process.memoryUsage(); const cpu = process.cpuUsage(); const begun = performance.now();
  delay.enable();
  const create = () => new SolarObservation({ directory, fingerprints, now: () => at, monotonic: () => mono });
  try {
    observer = create(); assert.equal(await observer.start(), true);
    function sample() {
      const hours = (at % 86400000) / 3600000;
      const loadPowerW = 1500; const pvPowerW = Math.max(0, Math.sin((hours - 6) / 12 * Math.PI) * 5000);
      const charging = hours < 5;
      const model = { lastUpdatedISO: new Date(at).toISOString(), telemetryOnline: true, socPercent: 50,
        loadPowerW, pvPowerW, gridImportPowerW: 1000, gridExportPowerW: 0,
        batteryChargePowerW: charging ? 3000 : 0, batteryDischargePowerW: charging ? 0 : 500 };
      const start = performance.now(); observer.observe(model, { ownedCharge: charging });
      const duration = performance.now() - start; captureMaxMs = Math.max(captureMaxMs, duration);
      captureHistogram[thresholds.findIndex(t => duration <= t)]++; captured++;
      maximumQueue = Math.max(maximumQueue, observer.store.queueBytes);
      assert.ok(observer.store.queueBytes <= LIMITS.queueBytes);
    }
    sample();
    for (let day = 0; day < days; day++) {
      for (let hour = 0; hour < 24; hour++) {
        for (let tick = 0; tick < 120; tick++) { at += 30000; mono += 30000; sample(); }
        expectedLoad += 1.5;
        if (hour % 6 === 0) {
          const intervals = Array.from({ length: 48 }, (_, i) => ({ startUtc: at + i * 3600000,
            endUtc: at + (i + 1) * 3600000, kwh: .12345678, endLocal: '2025-01-01T12:00' }));
          observer.forecast({ v: 1, kind: 'forecast', issuedAt: at, arrays: [{ intervals }, { intervals }], qualified: false });
        }
        await observer.checkpoint();
      }
      const names = await fs.readdir(directory); let actualBytes = 0;
      const categories = { minute: 0, aggregate: 0, forecast: 0 };
      for (const name of names) {
        const size = (await fs.stat(path.join(directory, name))).size; actualBytes += size;
        const match = /^(minute|aggregate|forecast)-(\d+)-/.exec(name);
        if (match) {
          categories[match[1]] += size;
          assert.ok(at - Number(match[2]) <= POLICIES[match[1]].age);
        }
      }
      assert.equal(actualBytes, observer.store.bytes);
      assert.ok(actualBytes <= LIMITS.diskBytes); assert.ok(names.length <= LIMITS.files);
      for (const [kind, bytes] of Object.entries(categories)) assert.ok(bytes <= POLICIES[kind].bytes);
      maximumDisk = Math.max(maximumDisk, actualBytes); maximumFiles = Math.max(maximumFiles, names.length);
      global.gc?.(); retainedHeapMax = Math.max(retainedHeapMax, process.memoryUsage().heapUsed - before.heapUsed);
      assert.ok(Object.keys(observer.model.profiles).length <= 96);
      if ([1, 7, 28, 100, days].includes(day + 1)) resourceSamples.push({ simulatedDay: day + 1, ...process.memoryUsage() });
      if (day % 17 === 16) {
        await observer.stop(); observer = create(); assert.equal(await observer.start(), true); sample();
      }
    }
    await observer.stop();
    assert.equal(observer.model.qualified, false); assert.equal(observer.model.automaticControl, false);
    assert.equal(observer.store.dropped, 0); assert.equal(observer.store.faults, 0);
    assert.ok(Buffer.byteLength(JSON.stringify(observer.model)) <= LIMITS.modelBytes);
    const elapsedMs = performance.now() - begun; const used = process.cpuUsage(cpu); delay.disable(); global.gc?.();
    console.log(JSON.stringify({ result: 'PASS', simulatedDays: days, captured, expectedAnalyticalLoadKwh: expectedLoad,
      note: 'Constant-power accuracy is asserted by the analytical unit test; retention intentionally expires raw evidence.',
      maximumDiskBytes: maximumDisk, maximumFiles, maximumQueuedBytes: maximumQueue,
      modelBytes: Buffer.byteLength(JSON.stringify(observer.model)), retainedHeapMaxDeltaBytes: retainedHeapMax,
      retainedHeapFinalDeltaBytes: process.memoryUsage().heapUsed - before.heapUsed, before, resourceSamples,
      rssFinalDeltaBytes: process.memoryUsage().rss - before.rss, captureMaxMs, captureHistogram, captureThresholdsMs: thresholds.map(n => Number.isFinite(n) ? n : 'over5'),
      elapsedMs, cpuUserMs: used.user / 1000, cpuSystemMs: used.system / 1000,
      acceleratedEventLoopP95Ms: delay.percentile(95) / 1e6, acceleratedEventLoopP99Ms: delay.percentile(99) / 1e6,
      physicalPiSoak: 'NOT RUN', host: `${process.platform}/${process.arch}`, node: process.version,
      interpretation: 'Accelerated host stress, including test assertions, filesystem inventory and forced GC; not representative Pi CPU/RSS/latency or a 72-hour soak.' }, null, 2));
  } finally { delay.disable(); await observer?.stop(); await fs.rm(directory, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
