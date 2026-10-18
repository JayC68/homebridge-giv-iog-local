'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { solarConfig, selectOvernightTarget, localDate } = require('../lib/solar-aware-overnight');
const { GivHomeModbusPlatform } = require('../index');

const now = new Date('2026-10-17T01:00:00+01:00');
const windowEnd = new Date('2026-10-17T05:30:00+01:00');
const forecast = kwh => ({ date: '2026-10-17', kwh, fetchedAt: '2026-10-16T18:00:00+01:00' });
function select(kwh, options = {}) {
  return selectOvernightTarget({ config: {}, enabled: true, forecasts: { '2026-10-17': forecast(kwh) }, windowEnd, now, fallback: 100, ...options });
}
for (const [kwh, target] of [[0, 100], [9.99, 100], [10, 80], [19.99, 80], [20, 60], [100, 60]]) {
  test(`solar ${kwh} kWh chooses ${target}% including exact thresholds`, () => assert.equal(select(kwh).targetSoc, target));
}
test('solar targets editable and capped by ordinary Charge Target', () => {
  assert.equal(select(30, { fallback: 45 }).targetSoc, 45);
  assert.equal(select(15, { config: { solarAwareMediumTargetSoc: 75 } }).targetSoc, 75);
  assert.equal(select(30, { enabled: false }).targetSoc, 100);
});
for (const config of [{ solarAwareHighForecastKwh: 5 }, { solarAwareHighTargetSoc: 90 }, { solarAwareLowForecastKwh: '10' }, { solarAwareLowTargetSoc: 3 }, { solarAwareLowForecastKwh: NaN }]) {
  test(`invalid solar configuration falls back: ${JSON.stringify(config)}`, () => {
    assert.equal(solarConfig(config).valid, false);
    assert.equal(select(30, { config }).targetSoc, 100);
  });
}
for (const bad of [undefined, { ...forecast(30), date: '2026-10-18' }, forecast(-1), forecast('30'), forecast(NaN), { ...forecast(30), fetchedAt: '2026-10-15T00:00:00Z' }, { ...forecast(30), fetchedAt: '2026-10-18T00:00:00Z' }]) {
  test(`missing/stale/wrong/invalid forecast falls back: ${JSON.stringify(bad)}`, () => assert.equal(select(30, { forecasts: { '2026-10-17': bad } }).targetSoc, 100));
}
test('solar morning date follows window end across midnight and DST', () => {
  assert.equal(localDate(windowEnd), '2026-10-17');
  assert.equal(select(30, { now: new Date('2026-10-16T23:40:00+01:00') }).targetSoc, 60);
  assert.equal(select(30, { windowEnd: new Date('2026-10-18T05:30:00+01:00') }).targetSoc, 100);
  assert.equal(select(30, { forecasts: { '2026-10-25': { date: '2026-10-25', kwh: 30, fetchedAt: '2026-10-24T18:00:00+01:00' } }, now: new Date('2026-10-25T01:30:00Z'), windowEnd: new Date('2026-10-25T05:30:00Z') }).targetSoc, 60);
});

function platform(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'givhome-beta-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = Object.create(GivHomeModbusPlatform.prototype);
  Object.assign(p, {
    name: 'test', inverterSerial: 'CH2344G083', chargeTargetIdentity: 'test:CH2344G083',
    config: { enableEmergencyStopTile: true, enableSolarAwareCheapOvernight: true },
    getStoragePath: () => dir, api: { hap: { uuid: { generate: () => 'test' } } },
    applianceControl: { targetSoc: 100, masterGateSatisfied: true, features: { cheapOvernightCharging: true } },
    log: { info() {}, warn() {}, error() {} }, applianceCommandTimers: new Map(), applianceSnapshots: new Map(), applianceCommandServices: new Map(),
    withManualChargeTransportGate: async (_label, fn) => fn(),
    currentCheapStateForStatusTiles: () => ({}),
    clearCeAcChargeSlotMemory() {}, clearEveningExcessExportMemory() {}, clearOctopusFluxExportMemory() {}, clearOctopusAgileOutgoingMemory() {},
    invalidateCommandTruthSnapshot() {}, setManualChargeHomeKitState() {}
  });
  p.initialiseBetaControls();
  return p;
}
test('forecast and Home preference survive restart and retain morning data after midnight refresh', t => {
  const p = platform(t);
  p.rememberSolarForecast({ date: localDate(new Date()), kwh: 25, fetchedAt: new Date().toISOString() });
  const day = localDate(new Date());
  p.rememberSolarForecast({ date: '2099-01-01', kwh: 12, fetchedAt: new Date().toISOString() });
  p.saveSolarAwareState(false);
  p.initialiseBetaControls(); assert.equal(p.solarAwareEnabled, false); assert.equal(p.solarForecasts[day].kwh,25);
  p.config.predictedSolarLocation = 'changed'; p.initialiseBetaControls(); assert.deepEqual(p.solarForecasts,{});
});
