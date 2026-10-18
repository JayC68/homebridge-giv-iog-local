'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { solarConfig, selectOvernightTarget, localDate } = require('../lib/solar-aware-overnight');
const { emergencyProfile, readEmergencySnapshot, executeEmergencyStop, activeSlot } = require('../lib/emergency-stop');
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

function registers(serial = 'CH2344G083', overrides = {}) {
  const profile = emergencyProfile(serial);
  const state = { 27: 0, 59: 1, 96: 1, 318: 0, 111: 50, 112: 30, 116: 80, 110: 20, 242: 80 };
  for (const slot of profile.slots) for (const r of slot.pair) state[r] = 0;
  Object.assign(state, { 94: 2330, 95: 530, 56: 30, 57: 200 }, overrides);
  const writes = []; const reads = [];
  return { profile, state, writes, reads,
    read: async (r, count) => { reads.push(r); assert.ok(count>=1&&count<=3); return Array.from({length:count},(_,i)=>state[r+i]); },
    write: async (r, value) => { writes.push([r, value]); state[r] = value; }
  };
}
async function stop(f, options = {}) {
  const before = await readEmergencySnapshot(f.read, f.profile);
  return executeEmergencyStop({ ...f, before, now, ...options });
}
for (const serial of ['CH2344G083', 'CE2225G298', 'ED2151G182']) {
  test(`${serial} cancels both first, clears only active schedules, verifies Eco and preserves limits`, async () => {
    const f = registers(serial, { 31: 800, 32: 900 });
    const result = await stop(f);
    assert.deepEqual(f.writes.slice(0, 2), [[96, 0], [59, 0]]);
    for (const r of [94, 95, 56, 57, 96, 59]) assert.equal(f.state[r], 0);
    assert.equal(f.state[27], 1);
    assert.equal(f.state[31], 800); assert.equal(f.state[32], 900);
    for (const r of [111, 112, 116, 110, 242]) assert.equal(f.writes.some(w => w[0] === r), false);
    assert.equal(result.untilMs, windowEnd.getTime());
    if (serial.startsWith('CH')) assert.ok(f.reads.includes(318));
    else assert.equal(f.reads.some(r => r >= 242), false);
  });
}
test('CH active validated slot 8 clears times but preserves target and future slots', async () => {
  const f = registers('CH2344G083', { 291: 30, 292: 200, 293: 25, 264: 2300, 265: 2330 });
  await stop(f);
  assert.equal(f.state[291], 0); assert.equal(f.state[292], 0); assert.equal(f.state[293], 25);
  assert.equal(f.state[264], 2300); assert.equal(f.state[265], 2330);
});

test('Emergency Stop reads only required registers with bounded adjacent-word batches', async () => {
  for(const serial of ['CH2344G083','CE2225G298']) {
    const f=registers(serial), requested=[];
    await readEmergencySnapshot(async(r,n)=>{requested.push(...Array.from({length:n},(_,i)=>r+i));return f.read(r,n);},f.profile);
    const expected=[27,59,96,...f.profile.slots.flatMap(s=>s.pair),...(f.profile.pause?[318]:[])];
    assert.deepEqual(requested,[...new Set(expected)].sort((a,b)=>a-b));
    assert.equal(f.reads.length,serial.startsWith('CH')?23:6);
  }
});
test('unsupported active clear path disables forced controls but fails held without speculative writes', async () => {
  const f = registers('CH2344G083', { 249: 30, 250: 200 });
  await assert.rejects(stop(f), /no validated clear path/);
  assert.equal(f.state[96], 0); assert.equal(f.state[59], 0); assert.equal(f.state[27], 1);
  assert.equal(f.state[249], 30); assert.equal(f.writes.some(w => w[0] === 249), false);
});
test('disabled schedule namespace preserves even currently timed slots', async () => {
  const f = registers('CH2344G083', { 96: 0, 59: 0 });
  await stop(f); assert.equal(f.state[94], 2330); assert.equal(f.state[56], 30);
});
test('pause is restored only on supported CH profile without changing pause schedule', async () => {
  const f = registers('CH2344G083', { 318: 3, 319: 30, 320: 200 });
  await stop(f); assert.equal(f.state[318], 0); assert.equal(f.state[319], 30); assert.equal(f.state[320], 200);
});
for (const overrides of [{ 27: undefined }, { 59: 2 }, { 94: 2360 }, { 291: undefined }, { 318: 7 }, { 94: 130, 95: 130 }]) {
  test(`invalid or missing required readback prevents every write: ${JSON.stringify(overrides)}`, async () => {
    const f = registers('CH2344G083', overrides); await assert.rejects(stop(f)); assert.deepEqual(f.writes, []);
  });
}
test('a lost disable does not prevent attempting the other disable or allow slot edits', async () => {
  const f = registers(); const write = f.write;
  f.write = async (r, v) => { if (r === 96) { f.writes.push([r,v]); throw new Error('timeout'); } await write(r,v); };
  await assert.rejects(stop(f), /cancellation uncertain/);
  assert.deepEqual(f.writes, [[96,0],[59,0]]); assert.equal(f.state[94], 2330);
});
test('external re-enable after acknowledgement prevents clearing and claims no success', async () => {
  const f = registers(); const write = f.write;
  f.write = async (r,v) => { await write(r,v); if (r === 59) f.state[96] = 1; };
  await assert.rejects(stop(f), /re-enabled/); assert.equal(f.state[94], 2330);
});
test('external schedule change after cancellation is not erased', async () => {
  const f = registers(); const write = f.write;
  f.write = async (r,v) => { await write(r,v); if (r === 59) f.state[94] = 2300; };
  await assert.rejects(stop(f), /schedule changed/); assert.equal(f.state[94], 2300);
});
test('lying Eco write acknowledgement fails final full readback', async () => {
  const f = registers(); const write = f.write;
  f.write = async (r,v) => { if (r !== 27) await write(r,v); };
  await assert.rejects(stop(f), /HR27 readback mismatch/);
});
test('unrelated schedule modification during clearing is detected', async () => {
  const f = registers('CH2344G083', { 264: 2300, 265: 2330 }); const write = f.write;
  f.write = async (r,v) => { await write(r,v); if (r === 27) f.state[264] = 2200; };
  await assert.rejects(stop(f), /HR264 schedule readback mismatch/);
});
test('active slot semantics include midnight, exact boundaries and disabled empty slots', () => {
  assert.equal(activeSlot(2330,530,now),true);
  assert.equal(activeSlot(100,200,now),true);
  assert.equal(activeSlot(30,100,now),false);
  assert.equal(activeSlot(0,0,now),false);
  assert.throws(() => emergencyProfile('GW00000000'), /unsupported/);
  assert.throws(() => emergencyProfile('WT00000000'), /unsupported/);
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
test('successful stop clears ownership, persists hold and coalesces repeated activation', async t => {
  const p = platform(t); const f = registers();
  p.readHoldingRegisters = f.read; p.writeDirectRegister = f.write;
  const a = p.requestEmergencyStop(); const b = p.requestEmergencyStop();
  await Promise.all([a,b]); assert.equal(f.writes.filter(w => w[0] === 96).length,1);
  assert.equal(p.emergencyState.status,'verified'); assert.equal(p.emergencyHeld(),true);
  p.initialiseBetaControls(); assert.equal(p.emergencyHeld(),true);
});
test('failure persists across restart and disabling tile cannot lift hold', async t => {
  const p = platform(t); p.readHoldingRegisters = async () => { throw new Error('read unavailable'); };
  p.writeDirectRegister = async () => assert.fail('no write allowed');
  await assert.rejects(p.requestEmergencyStop(), /unavailable/);
  p.config.enableEmergencyStopTile = false; p.initialiseBetaControls(); assert.equal(p.emergencyHeld(),true);
  assert.equal(p.emergencyState.status,'failed');
});
test('corrupt recovery state fails closed and durable-save failure sends no writes', async t => {
  const p = platform(t); fs.writeFileSync(p.emergencyStateFile, '{broken'); p.initialiseBetaControls(); assert.equal(p.emergencyHeld(),true);
  p.emergencyStateFile = path.join(p.getStoragePath(),'missing','state');
  p.readHoldingRegisters = async () => assert.fail('no reads needed');
  await assert.rejects(p.requestEmergencyStop()); assert.equal(p.emergencyHeld(),true);
});
test('verified hold expires durably, failed hold never expires', t => {
  const p = platform(t);
  p.emergencyState = { identity:p.chargeTargetIdentity,status:'verified',untilMs:Date.now()-1 };
  assert.equal(p.emergencyHeld(),false); p.initialiseBetaControls(); assert.equal(p.emergencyHeld(),false);
  p.emergencyState={status:'failed',untilMs:0}; assert.equal(p.emergencyHeld(),true);
});
test('both production write paths refuse a recovery hold before any network access', async t => {
  const p = platform(t); p.emergencyState={status:'failed'};
  await assert.rejects(p.writeManualChargeRegister(96,1,'start'), /held/);
  await assert.rejects(p.writeDirectRegister(96,1,'start'), /held/);
  await assert.rejects(p.writeDirectRegister(96,1,'Emergency Stop fake'), /held/);
  await p.applyApplianceAutomation(); // No model or transport required while held.
});
test('queued intents from before Emergency Stop are cancelled even after hold release', async t => {
  const p=platform(t); let release; p.commandQueueTail=new Promise(resolve=>{release=resolve;});
  Object.assign(p,{ commandTransportSequence:0,commandQueueDepth:0,commandPollHoldUntilMs:0,
    enterQueuedCommandTransportGate:async (_l,fn)=>fn() });
  const queued=GivHomeModbusPlatform.prototype.withManualChargeTransportGate.call(p,'old command',async()=>assert.fail('cancelled command ran'));
  p.emergencyGeneration++; p.emergencyState={status:'released'}; release();
  await assert.rejects(queued,/cancelled/);
});

test('partial clear failure retains implicated slots and hold end across restart and retry', async t => {
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  const p=platform(t); const f=registers(); p.readHoldingRegisters=f.read;
  p.writeDirectRegister=async(r,v)=>{if(r===95)throw new Error('clear timed out');await f.write(r,v);};
  await assert.rejects(p.requestEmergencyStop(),/incomplete/);
  assert.equal(f.state[96],0); assert.equal(f.state[59],0); assert.equal(f.state[27],1);
  assert.equal(f.state[94],0); assert.equal(f.state[95],530);
  assert.equal(p.emergencyState.untilMs,windowEnd.getTime());
  p.initialiseBetaControls(); p.writeDirectRegister=f.write;
  await p.requestEmergencyStop(); assert.equal(f.state[95],0);
  assert.equal(p.emergencyState.untilMs,windowEnd.getTime()); assert.equal(p.emergencyHeld(),true);
});

test('unsupported implicated slot cannot escape the failed hold by retrying with controls already off', async t => {
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  const p=platform(t); const f=registers('CH2344G083',{249:30,250:200});
  p.readHoldingRegisters=f.read; p.writeDirectRegister=f.write;
  await assert.rejects(p.requestEmergencyStop(),/no validated clear path/);
  p.initialiseBetaControls();
  await assert.rejects(p.requestEmergencyStop(),/no validated clear path/);
  assert.equal(p.emergencyHeld(),true); assert.equal(f.state[249],30);
});

test('failed-stop retry refuses a changed implicated schedule and keeps the durable hold', async t => {
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  const p=platform(t); const f=registers(); p.readHoldingRegisters=f.read;
  p.writeDirectRegister=async(r,v)=>{if(r===95)throw new Error('partial');await f.write(r,v);};
  await assert.rejects(p.requestEmergencyStop());
  f.state[95]=600; p.writeDirectRegister=f.write; const count=f.writes.length;
  await assert.rejects(p.requestEmergencyStop(),/previously implicated schedule changed/);
  assert.equal(f.writes.length,count); assert.equal(p.emergencyHeld(),true);
});

test('stale saved ownership that cannot be removed fails reconciliation and keeps hold', async t => {
  const p=platform(t); const f=registers();p.readHoldingRegisters=f.read;p.writeDirectRegister=f.write;
  const stale=path.join(p.getStoragePath(),'stale');fs.writeFileSync(stale,'{}');p.ceAcChargeSlotStatePath=()=>stale;
  await assert.rejects(p.requestEmergencyStop(),/ownership memory/);assert.equal(p.emergencyHeld(),true);
});

function failFinalReadOnce(p, f) {
  let coreReads=0;
  p.readHoldingRegisters=async(r,n)=>{
    if(r===27 && ++coreReads===3) throw new Error('wireless receive timed out');
    return f.read(r,n);
  };
  p.writeDirectRegister=f.write;
}
function advanceRetry(t,p) { t.mock.timers.setTime(p.emergencyRetryAtMs+1); }

test('automatic recovery proves a lost final read without repeating successful writes or extending the stop', async t => {
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  const p=platform(t), f=registers(); failFinalReadOnce(p,f);
  await assert.rejects(p.requestEmergencyStop(),/HR27.*wireless/);
  const deadline=p.emergencyState.untilMs, writes=f.writes.length;
  p.readHoldingRegisters=f.read;
  await p.recoverEmergencyStopIfNeeded(); assert.equal(p.emergencyState.status,'failed');
  advanceRetry(t,p); await p.recoverEmergencyStopIfNeeded();
  assert.equal(p.emergencyState.status,'verified');
  assert.equal(f.writes.length,writes);
  assert.equal(p.emergencyState.untilMs,deadline);
  t.mock.timers.setTime(deadline+1); assert.equal(p.emergencyHeld(),false);
});

test('automatic recovery after a lost disable acknowledgement clears only saved original slots', async t => {
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  const p=platform(t), f=registers('CH2344G083',{31:800,32:900});
  p.readHoldingRegisters=f.read;
  p.writeDirectRegister=async(r,v)=>{await f.write(r,v);if(r===96)throw new Error('lost acknowledgement');};
  await assert.rejects(p.requestEmergencyStop(),/uncertain/);
  const count=f.writes.length; p.writeDirectRegister=f.write;
  advanceRetry(t,p); await p.recoverEmergencyStopIfNeeded();
  assert.equal(p.emergencyState.status,'verified');
  assert.equal(f.state[94],0); assert.equal(f.state[95],0);
  assert.equal(f.state[31],800); assert.equal(f.state[32],900);
  assert.equal(f.writes.slice(count).some(([r])=>r===96||r===59),false);
});

test('automatic recovery repairs a partial clear without rewriting already cleared registers', async t => {
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  const p=platform(t), f=registers(); p.readHoldingRegisters=f.read;
  p.writeDirectRegister=async(r,v)=>{if(r===95)throw new Error('wireless loss');await f.write(r,v);};
  await assert.rejects(p.requestEmergencyStop());
  const count=f.writes.length; p.writeDirectRegister=f.write;
  advanceRetry(t,p); await p.recoverEmergencyStopIfNeeded();
  assert.equal(p.emergencyState.status,'verified'); assert.equal(f.state[95],0);
  assert.equal(f.writes.slice(count).some(([r])=>r===94),false);
});

test('wireless outage recovery backs off, stays single-flight, and resumes a lost initial snapshot', async t => {
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  const p=platform(t), f=registers(); let reads=0;
  p.readHoldingRegisters=async()=>{reads++;throw new Error('offline');}; p.writeDirectRegister=f.write;
  await assert.rejects(p.requestEmergencyStop());
  let previousDelay=0;
  for(let i=0;i<6;i++) {
    const delay=p.emergencyRetryAtMs-Date.now();
    assert.ok(delay>=previousDelay && delay<=60000); previousDelay=delay;
    const before=reads; await p.recoverEmergencyStopIfNeeded(); assert.equal(reads,before);
    advanceRetry(t,p);
    await Promise.all([p.recoverEmergencyStopIfNeeded(),p.recoverEmergencyStopIfNeeded()]);
    assert.equal(reads,before+1); assert.equal(f.writes.length,0);
  }
  p.readHoldingRegisters=f.read; advanceRetry(t,p); await p.recoverEmergencyStopIfNeeded();
  assert.equal(p.emergencyState.status,'verified');
  assert.equal(p.emergencyState.requestedAt,now.toISOString());
  assert.equal(p.emergencyState.untilMs,windowEnd.getTime());
});

test('failed recovery survives restart and continues even when the optional tile is hidden', async t => {
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  const p=platform(t), f=registers(); failFinalReadOnce(p,f);
  await assert.rejects(p.requestEmergencyStop());
  p.config.enableEmergencyStopTile=false; p.initialiseBetaControls();
  p.readHoldingRegisters=f.read; advanceRetry(t,p); await p.recoverEmergencyStopIfNeeded();
  assert.equal(p.emergencyState.status,'verified');
});

test('recovery leaves a later active schedule running once the original cleared slots are proved', async t => {
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  const p=platform(t), f=registers(); failFinalReadOnce(p,f);
  await assert.rejects(p.requestEmergencyStop()); const count=f.writes.length;
  t.mock.timers.setTime(new Date('2026-10-17T06:10:00+01:00').getTime());
  Object.assign(f.state,{96:1,31:600,32:700}); p.readHoldingRegisters=f.read;
  await p.recoverEmergencyStopIfNeeded();
  assert.equal(p.emergencyState.status,'verified'); assert.equal(p.emergencyHeld(),false);
  assert.equal(f.writes.length,count); assert.equal(f.state[96],1); assert.equal(f.state[31],600);
});

test('recovery refuses changed original slot evidence and retries without overwriting it', async t => {
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  const p=platform(t), f=registers(); p.readHoldingRegisters=f.read;
  p.writeDirectRegister=async(r,v)=>{if(r===95)throw new Error('partial');await f.write(r,v);};
  await assert.rejects(p.requestEmergencyStop());
  f.state[95]=600; p.writeDirectRegister=f.write; const count=f.writes.length;
  advanceRetry(t,p); await p.recoverEmergencyStopIfNeeded();
  assert.equal(p.emergencyState.status,'failed'); assert.match(p.emergencyState.error,/changed/);
  assert.equal(f.writes.length,count); assert.ok(p.emergencyRetryAtMs>Date.now());
});

test('recovery migrates a legacy failed record using its original snapshot', async t => {
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  const p=platform(t), f=registers(); const initial={...f.state};
  Object.assign(f.state,{96:0,59:0,27:1});
  p.emergencyState={identity:p.chargeTargetIdentity,status:'failed',requestedAt:now.toISOString(),untilMs:windowEnd.getTime(),implicated:[],initialRegisters:initial};
  p.readHoldingRegisters=f.read; p.writeDirectRegister=f.write;
  await p.recoverEmergencyStopIfNeeded();
  assert.equal(p.emergencyState.status,'verified'); assert.equal(f.state[94],0); assert.equal(f.state[56],0);
});

test('a lost initial snapshot cannot turn a later scheduled action into a new stop target', async t => {
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  const p=platform(t), f=registers();
  p.readHoldingRegisters=async()=>{throw new Error('offline before first snapshot');}; p.writeDirectRegister=f.write;
  await assert.rejects(p.requestEmergencyStop());
  t.mock.timers.setTime(new Date('2026-10-17T06:10:00+01:00').getTime());
  Object.assign(f.state,{96:1,59:0,27:1,31:600,32:700}); p.readHoldingRegisters=f.read;
  await p.recoverEmergencyStopIfNeeded();
  assert.equal(p.emergencyState.status,'failed'); assert.match(p.emergencyState.error,/later action/);
  assert.equal(f.writes.length,0); assert.equal(f.state[96],1);
});

test('recovery never mutates after appliance-control acknowledgement is withdrawn', async t => {
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  const p=platform(t), f=registers(); failFinalReadOnce(p,f);
  await assert.rejects(p.requestEmergencyStop()); const count=f.writes.length;
  p.applianceControl.masterGateSatisfied=false; p.readHoldingRegisters=async()=>assert.fail('permission gate precedes transport');
  advanceRetry(t,p); await p.recoverEmergencyStopIfNeeded();
  assert.equal(p.emergencyState.status,'failed'); assert.equal(f.writes.length,count);
});

test('late recovery unblocks the next Cheap Overnight window in the same automation tick', async t => {
  const evening=new Date('2026-10-17T20:52:00+01:00');
  t.mock.timers.enable({apis:['Date'],now:evening.getTime()});
  const p=platform(t), f=registers('CH2344G083',{94:1537,95:1737,59:0,261:2051,262:2251});
  failFinalReadOnce(p,f); await assert.rejects(p.requestEmergencyStop());
  const originalDeadline=p.emergencyState.untilMs; p.readHoldingRegisters=f.read;
  t.mock.timers.setTime(new Date('2026-10-17T23:30:01+01:00').getTime());
  const queued=[];
  Object.assign(p,{health:{state:'online'},latestModel:{socPercent:4},octopusState:{dispatches:[]},
    reconcileActiveChargeTarget:async()=>{},logBatteryCarePlan(){},logCheapOvernightPlan(){},autoChargeActive:false,
    withManualChargeTransportGate:async(label,fn)=>{queued.push(label);if(label==='GivHome Emergency Stop')return fn();throw new Error('OFFLINE_CHARGE_QUEUE_REACHED');}});
  Object.assign(p.applianceControl,{cheapStart:'23:30',cheapEnd:'05:30'});
  await assert.rejects(p.applyApplianceAutomation(),/OFFLINE_CHARGE_QUEUE_REACHED/);
  assert.equal(p.emergencyState.status,'released'); assert.equal(p.emergencyState.untilMs,originalDeadline);
  assert.deepEqual(queued,['GivHome Emergency Stop','GivHome Cheap Overnight fallback charge']);
});

test('fault sweep: every snapshot read and every before/after-write wireless loss recovers after restart', async t => {
  t.mock.timers.enable({apis:['Date'],now:now.getTime()});
  const faults=[...Array.from({length:69},(_,i)=>({kind:'read',at:i+1})),
    ...['before','after'].flatMap(phase=>Array.from({length:7},(_,i)=>({kind:'write',phase,at:i+1})))];
  for(const fault of faults) {
    t.mock.timers.setTime(now.getTime());
    const p=platform(t), f=registers('CH2344G083',{31:800,32:900});
    let reads=0,writes=0;
    p.readHoldingRegisters=async(r,n)=>{
      if(fault.kind==='read'&&++reads===fault.at)throw new Error(`wireless read ${fault.at}`);
      return f.read(r,n);
    };
    p.writeDirectRegister=async(r,v)=>{
      const fail=fault.kind==='write'&&++writes===fault.at;
      if(fail&&fault.phase==='before')throw new Error('wireless before write');
      await f.write(r,v);
      if(fail)throw new Error('lost write acknowledgement');
    };
    await assert.rejects(p.requestEmergencyStop(),undefined,JSON.stringify(fault));
    p.initialiseBetaControls(); p.readHoldingRegisters=f.read; p.writeDirectRegister=f.write;
    advanceRetry(t,p); await p.recoverEmergencyStopIfNeeded();
    assert.equal(p.emergencyState.status,'verified',JSON.stringify(fault));
    assert.equal(p.emergencyState.untilMs,windowEnd.getTime());
    for(const r of [94,95,56,57,96,59])assert.equal(f.state[r],0,JSON.stringify(fault));
    assert.equal(f.state[27],1);
    assert.equal(f.state[31],800);assert.equal(f.state[32],900);
    assert.equal(f.writes.some(([r])=>[111,112,116,242,31,32].includes(r)),false);
  }
});

test('CE configured pause protection requires and restores its pause control without reading CH slot banks', async t => {
  const p=platform(t);p.inverterSerial='CE2225G298';p.applianceControl.features.ceAcCoupledLiveWrites=true;
  p.applianceControl.features.homeBatteryProtectionDuringSmartSlots=true;p.applianceControl.iogHomeBatteryProtectionMode='pauseDischarge';
  const f=registers('CE2225G298',{318:2});p.readHoldingRegisters=f.read;p.writeDirectRegister=f.write;
  await p.requestEmergencyStop();assert.equal(f.state[318],0);assert.ok(f.reads.includes(318));
  assert.equal(f.reads.some(r=>r>=242&&r<318),false);
});

test('CE configured pause with missing capability readback fails before all writes', async t => {
  const p=platform(t);p.inverterSerial='CE2225G298';p.applianceControl.features.ceAcCoupledLiveWrites=true;p.applianceControl.features.pauseTiles=true;
  const f=registers('CE2225G298',{318:undefined});p.readHoldingRegisters=f.read;p.writeDirectRegister=f.write;
  await assert.rejects(p.requestEmergencyStop(),/incomplete HR318/);assert.deepEqual(f.writes,[]);assert.equal(p.emergencyHeld(),true);
});

function idlePlatform(t, overrides = {}, cheap = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-18T08:00:00+01:00') });
  const p = platform(t), f = registers('CH2344G083', { 27: 1, 96: 0, 59: 0, 94: 0, 95: 0, 56: 0, 57: 0, ...overrides });
  p.readHoldingRegisters = f.read; p.writeDirectRegister = f.write;
  p.currentCheapStateForStatusTiles = () => cheap;
  const timer = setTimeout(() => {}, 3600000); timer.unref(); t.after(() => clearTimeout(timer));
  p.applianceCommandTimers.set('future', timer);
  const snapshot = { future: true }; p.applianceSnapshots.set('future', snapshot);
  p.activeChargeTarget = { endAtMs: Date.now() + 3600000 };
  for (const name of ['clearCeAcChargeSlotMemory', 'clearEveningExcessExportMemory', 'clearOctopusFluxExportMemory', 'clearOctopusAgileOutgoingMemory', 'setManualChargeHomeKitState']) p[name] = () => assert.fail('idle must preserve ownership and tile state');
  return { p, f, timer, snapshot };
}
for (const armed of [false, true]) test(`idle stop preserves future controls, timers, ownership and intents: armed=${armed}`, async t => {
  const { p, f, timer, snapshot } = idlePlatform(t, armed ? { 96: 1, 94: 2330, 95: 530, 59: 1, 291: 1800, 292: 1900 } : {});
  const before = { ...f.state }, generation = p.emergencyGeneration;
  const result = await p.requestEmergencyStop();
  assert.equal(result.idle, true); assert.deepEqual(f.writes, []); assert.deepEqual(f.state, before);
  assert.equal(f.reads.length, 23); assert.equal(p.applianceCommandTimers.get('future'), timer);
  assert.equal(p.applianceSnapshots.get('future'), snapshot); assert.ok(p.activeChargeTarget);
  assert.equal(p.emergencyGeneration, generation); assert.equal(p.emergencyHeld(), false);
  assert.equal(p.emergencyState.outcome, 'nothing-running');
  p.initialiseBetaControls(); assert.equal(p.emergencyHeld(), false);
});
test('idle during Cheap Overnight or IOG creates no hold even with protection deadlines', async t => {
  const { p, f } = idlePlatform(t, {}, { fallbackActive: true, fallbackWindowEnd: new Date('2026-10-18T09:00:00+01:00'), smartActive: true, protectedEnd: new Date('2026-10-18T10:00:00+01:00') });
  p.autoChargeProtectedUntilMs = Date.now() + 7200000;
  await p.requestEmergencyStop(); assert.equal(p.emergencyHeld(), false); assert.deepEqual(f.writes, []);
});
test('idle inspection coalesces repeated taps without cancelling a future timer', async t => {
  const { p, f } = idlePlatform(t);
  const first = p.acceptEmergencyStopRequest(), second = p.acceptEmergencyStopRequest();
  assert.equal(first, second); await first;
  assert.equal(f.reads.length, 23); assert.equal(p.applianceCommandTimers.size, 1);
});
test('idle detection allows queued work before and after its shared transport turn', async t => {
  const { p, f } = idlePlatform(t); let release;
  Object.assign(p, { commandQueueTail: new Promise(resolve => { release = resolve; }), commandTransportSequence: 0, commandQueueDepth: 0, commandPollHoldUntilMs: 0, enterQueuedCommandTransportGate: async (_, fn) => fn() });
  p.withManualChargeTransportGate = GivHomeModbusPlatform.prototype.withManualChargeTransportGate;
  const events = [];
  const before = p.withManualChargeTransportGate('future command before inspection', async () => events.push('before'));
  const stop = p.acceptEmergencyStopRequest();
  const after = p.withManualChargeTransportGate('future command after inspection', async () => events.push('after'));
  release(); await Promise.all([before, stop, after]);
  assert.deepEqual(events, ['before', 'after']); assert.deepEqual(f.writes, []);
});
test('idle recovery after lost initial read preserves armed future schedules and timers', async t => {
  const { p, f, timer } = idlePlatform(t, { 96: 1, 94: 2330, 95: 530 });
  p.readHoldingRegisters = async () => { throw new Error('wireless unavailable'); };
  await assert.rejects(p.requestEmergencyStop(), /wireless/);
  assert.equal(p.emergencyHeld(), true); assert.equal(p.applianceCommandTimers.get('future'), timer);
  p.initialiseBetaControls(); assert.equal(p.emergencyHeld(), true);
  p.readHoldingRegisters = f.read; advanceRetry(t, p); await p.recoverEmergencyStopIfNeeded();
  assert.equal(p.emergencyState.outcome, 'nothing-running'); assert.equal(p.emergencyHeld(), false);
  assert.deepEqual(f.writes, []); assert.equal(f.state[96], 1); assert.equal(p.applianceCommandTimers.get('future'), timer);
});
test('idle completion persistence failure holds safely and retries without hardware writes', async t => {
  const { p, f } = idlePlatform(t); const read = f.read;
  p.readHoldingRegisters = async (r, n) => {
    const result = await read(r, n);
    if (f.reads.length === 23) p.emergencyStateFile = path.join(p.getStoragePath(), 'missing', 'state');
    return result;
  };
  const file = p.emergencyStateFile;
  await assert.rejects(p.requestEmergencyStop()); assert.equal(p.emergencyHeld(), true); assert.deepEqual(f.writes, []);
  p.emergencyStateFile = file; p.readHoldingRegisters = f.read;
  advanceRetry(t, p); await p.recoverEmergencyStopIfNeeded();
  assert.equal(p.emergencyHeld(), false); assert.deepEqual(f.writes, []);
});
test('an existing verified hold is not erased by an otherwise idle button press', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: now.getTime() });
  const p = platform(t), f = registers('CH2344G083', { 27: 1, 96: 0, 59: 0 });
  p.readHoldingRegisters = f.read; p.writeDirectRegister = f.write;
  p.emergencyState = { identity: p.chargeTargetIdentity, status: 'verified', untilMs: windowEnd.getTime() };
  await p.requestEmergencyStop(); assert.equal(p.emergencyHeld(), true); assert.equal(p.emergencyState.untilMs, windowEnd.getTime());
});
test('manual retry of an unmutated failed inspection also leaves future schedules intact', async t => {
  const { p, f } = idlePlatform(t, { 96: 1, 94: 2330, 95: 530 });
  p.readHoldingRegisters = async () => { throw new Error('offline'); };
  await assert.rejects(p.requestEmergencyStop()); p.readHoldingRegisters = f.read;
  await p.requestEmergencyStop(); assert.equal(p.emergencyHeld(), false); assert.deepEqual(f.writes, []);
});
for (const serial of ['CE2225G298', 'ED2151G182']) test(`${serial} idle leaves armed future windows untouched`, async t => {
  const { p } = idlePlatform(t); p.inverterSerial = serial;
  p.applianceControl.features.ceAcCoupledLiveWrites = true;
  const f = registers(serial, { 27: 1, 96: 1, 59: 1, 94: 2330, 95: 530, 56: 1800, 57: 1900 });
  p.readHoldingRegisters = f.read; p.writeDirectRegister = f.write;
  await p.requestEmergencyStop(); assert.equal(p.emergencyHeld(), false); assert.deepEqual(f.writes, []);
  assert.equal(f.reads.length, 6);
});
test('a command already ahead of inspection can start, then is detected and stopped; stale queued intent is cancelled', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-18T08:00:00+01:00') });
  const p = platform(t), f = registers('CH2344G083', { 27: 1, 96: 0, 59: 0, 94: 0, 95: 0 });
  p.readHoldingRegisters = f.read; p.writeDirectRegister = f.write;
  let release;
  Object.assign(p, { commandQueueTail: new Promise(resolve => { release = resolve; }), commandTransportSequence: 0, commandQueueDepth: 0, commandPollHoldUntilMs: 0, enterQueuedCommandTransportGate: async (_, fn) => fn() });
  p.withManualChargeTransportGate = GivHomeModbusPlatform.prototype.withManualChargeTransportGate;
  const before = p.withManualChargeTransportGate('start before inspection', async () => Object.assign(f.state, { 96: 1, 94: 800, 95: 900 }));
  const stop = p.acceptEmergencyStopRequest();
  const after = p.withManualChargeTransportGate('stale intent after inspection', async () => assert.fail('stale command ran'));
  const rejected = assert.rejects(after, /cancelled/);
  release(); await Promise.all([before, stop, rejected]);
  assert.equal(f.state[96], 0); assert.equal(f.state[94], 0); assert.equal(f.state[95], 0);
  assert.equal(p.emergencyHeld(), true); assert.equal(p.emergencyGeneration, 1);
});
test('a saved read-only inspection is held after restart until readback is recovered', async t => {
  const { p, f } = idlePlatform(t); let resume;
  const read = f.read;
  p.readHoldingRegisters = async (r, n) => { if (!resume) await new Promise(resolve => { resume = resolve; }); return read(r, n); };
  const completion = p.acceptEmergencyStopRequest();
  assert.equal(p.emergencyHeld(), false);
  const restarted = Object.assign(Object.create(GivHomeModbusPlatform.prototype), p, { emergencyInFlight: null });
  restarted.initialiseBetaControls(); assert.equal(restarted.emergencyHeld(), true);
  resume(); await completion; assert.deepEqual(f.writes, []);
});
