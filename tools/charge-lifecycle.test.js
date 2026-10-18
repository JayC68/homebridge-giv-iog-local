'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { GivHomeModbusPlatform } = require('../index');
const { buildChargeTargetReconciliationPlan, verifyChargeTargetReconciliation } = require('../lib/charge-target-reconciliation');
const { getMergedCheapState } = require('../lib/appliance-integrated-control');

function fixture(serial = 'CH2344G083', original = {}) {
  const platform = Object.create(GivHomeModbusPlatform.prototype);
  const registers = { HR20: 1, HR94: 2330, HR95: 530, HR96: 0, HR111: 50, HR116: 40, HR242: 80, HR318: 0, HR319: 0, HR320: 0, ...original };
  const writes = [];
  Object.assign(platform, {
    inverterSerial: serial,
    log: { warn() {}, info() {}, error() {} },
    health: { state: 'online' },
    latestModel: { socPercent: 40, batteryDischargePowerW: 0, loadPowerW: 300 },
    applianceControl: {
      cheapStart: '23:30', cheapEnd: '05:30', targetSoc: 100, graceMinutes: 30,
      iogHomeBatteryProtectionMode: 'charge', iogHomeBatteryProtectionPauseValue: 2,
      features: { cheapOvernightCharging: true, homeBatteryProtectionDuringSmartSlots: true, batteryCare: false, ceAcCoupledLiveWrites: true }
    },
    octopusState: { dispatches: [] },
    applianceSnapshots: new Map(),
    applianceCommandTimers: new Map(),
    autoChargeActive: false,
    autoChargeLabel: '',
    autoChargeProtectedUntilMs: 0,
    readChargePrestate: async () => ({ ...registers }),
    readPausePrestate: async () => ({ ...registers }),
    writeDirectRegister: async (register, value) => { writes.push([register, value]); registers[`HR${register}`] = value; },
    withManualChargeTransportGate: async (_label, run) => run(),
    setApplianceCommandState() {},
    setPauseTileStatesFromPrestate() {},
    persistCeAcChargeSlotSnapshot(snapshot) { this.ceAcChargeSlotMemory = { snapshot }; },
    clearCeAcChargeSlotMemory() { this.ceAcChargeSlotMemory = null; },
    logBatteryCarePlan() {},
    logCheapOvernightPlan() {}
  });
  require('./attach-control-fixture')(platform, registers);
  return { platform, registers, writes };
}

test('unsupported target profile produces no writes and cannot verify as supported', async () => {
  const plan = buildChargeTargetReconciliationPlan({ HR20: 1, HR116: 40 }, { serial: 'GW00000000', targetSoc: 100 });
  assert.equal(plan.mutationAllowed, false);
  assert.deepEqual(plan.establishedWrites, []);
  assert.equal(verifyChargeTargetReconciliation({ HR20: 0, HR116: 100 }, plan).ok, false);
  const { platform, writes } = fixture('GW00000000');
  await assert.rejects(platform.startTimedChargeCommand({ minutes: 30 }, { automatic: true }), /not supported/);
  assert.deepEqual(writes, []);
});

test('invalid snapshot or target is refused before writes', async () => {
  for (const original of [{ HR20: undefined }, { HR94: 2360 }, { HR111: 101 }]) {
    const { platform, writes } = fixture('CH2344G083', original);
    await assert.rejects(platform.startTimedChargeCommand({ minutes: 30 }, { automatic: true }), /incomplete or invalid/);
    assert.deepEqual(writes, []);
  }
  assert.throws(() => buildChargeTargetReconciliationPlan({}, { serial: 'CH2344G083', targetSoc: 1 }), /4-100/);
});

for (const serial of ['CH2344G083', 'CE2225G298', 'ED2151G182']) {
  test(`${serial}: read, compare, verify and restore the original general AC limit`, async () => {
    const { platform, registers, writes } = fixture(serial);
    const before = { ...registers };
    await platform.startTimedChargeCommand({ displayName: 'Cheap Overnight', minutes: 30 }, { automatic: true, label: 'Cheap Overnight' });
    assert.equal(registers.HR20, 0);
    assert.equal(registers.HR116, 100);
    assert.equal(registers.HR96, 1);
    assert.equal(registers.HR242, 80);
    assert.equal(writes.some(([register]) => register === 242), false);
    await platform.cleanupApplianceCommandFamily('charge', 'test ended');
    assert.deepEqual(registers, before);
    assert.equal(platform.applianceSnapshots.has('charge'), false);
  });
}

test('restoration mismatch keeps the original snapshot available for recovery', async () => {
  const { platform, registers } = fixture('CE2225G298');
  await platform.startTimedChargeCommand({ minutes: 30 }, { automatic: true });
  const normalWrite = platform.writeDirectRegister;
  platform.writeDirectRegister = async (register, value) => {
    if (register === 20) return;
    await normalWrite(register, value);
  };
  await assert.rejects(platform.cleanupApplianceCommandFamily('charge', 'test mismatch'), /HR20/);
  assert.equal(registers.HR96, 0);
  assert.equal(platform.applianceSnapshots.has('charge'), true);
  assert.ok(platform.ceAcChargeSlotMemory);
});

test('same-owner extension retains the original customer snapshot', async () => {
  const { platform, registers } = fixture();
  const before = { ...registers };
  await platform.startTimedChargeCommand({ minutes: 30 }, { automatic: true, label: 'IOG' });
  await platform.startTimedChargeCommand({ minutes: 60 }, { automatic: true, label: 'IOG' });
  await platform.cleanupApplianceCommandFamily('charge', 'extension ended');
  assert.deepEqual(registers, before);
});

test('an unrelated charge owner cannot replace the saved snapshot', async () => {
  const { platform, writes } = fixture();
  await platform.startTimedChargeCommand({ minutes: 30 }, { automatic: true, label: 'Cheap Overnight' });
  const count = writes.length;
  await assert.rejects(platform.startTimedChargeCommand({ minutes: 30 }, { automatic: true, label: 'IOG' }), /Previous control owner/);
  assert.equal(writes.length, count);
  assert.equal(platform.applianceSnapshots.get('charge').source, 'Cheap Overnight');
});

for (const mode of ['charge', 'pauseDischarge']) {
  test(`IOG ${mode}: overnight ends at 05:30, then cleanup precedes handover`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T01:00:00+01:00').getTime() });
    const { platform, registers, writes } = fixture();
    platform.applianceControl.iogHomeBatteryProtectionMode = mode;
    platform.octopusState.dispatches = [{ start: new Date('2026-10-10T00:30:00+01:00'), end: new Date('2026-10-10T06:00:00+01:00') }];
    await platform.applyApplianceAutomation();
    assert.equal(platform.autoChargeLabel, 'Cheap Overnight');
    assert.equal(registers.HR95, 530);
    const count = writes.length;
    await platform.applyApplianceAutomation();
    assert.equal(writes.length, count, 'IOG must observe without commanding during Cheap Overnight');
    t.mock.timers.setTime(new Date('2026-10-10T05:30:00+01:00').getTime());
    await platform.applyApplianceAutomation();
    assert.match(platform.autoChargeLabel, /Intelligent Octopus Go Home Battery Protection/);
    const handover = writes.slice(count);
    assert.deepEqual(handover[0], [96, 0], 'old charge must be disabled before the new owner writes');
    assert.ok(handover.some(([register, value]) => register === 20 && value === 1), 'original limit must be restored before handover');
    if (mode === 'charge') assert.equal(registers.HR95, 600);
    else assert.equal(registers.HR318, 2);
    t.mock.timers.setTime(new Date('2026-10-10T06:00:00+01:00').getTime());
    await platform.applyApplianceAutomation();
    assert.equal(platform.autoChargeActive, false);
    assert.equal(registers.HR20, 1);
    assert.equal(registers.HR116, 40);
    assert.equal(registers.HR96, 0);
    assert.equal(registers.HR318, 0);
  });
}

test('overnight end without IOG restores general controls and leaves charging off', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T01:00:00+01:00').getTime() });
  const { platform, registers } = fixture();
  await platform.applyApplianceAutomation();
  t.mock.timers.setTime(new Date('2026-10-10T05:30:00+01:00').getTime());
  await platform.applyApplianceAutomation();
  assert.equal(platform.autoChargeActive, false);
  assert.equal(registers.HR96, 0);
  assert.equal(registers.HR116, 40);
});

test('an active IOG command is cleaned before Cheap Overnight takes ownership', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-09T23:00:00+01:00').getTime() });
  const { platform, registers, writes } = fixture();
  platform.octopusState.dispatches = [{ start: new Date('2026-10-09T22:30:00+01:00'), end: new Date('2026-10-10T00:00:00+01:00') }];
  await platform.applyApplianceAutomation();
  assert.match(platform.autoChargeLabel, /Intelligent Octopus Go/);
  const count = writes.length;
  t.mock.timers.setTime(new Date('2026-10-09T23:30:00+01:00').getTime());
  await platform.applyApplianceAutomation();
  assert.equal(platform.autoChargeLabel, 'Cheap Overnight');
  assert.deepEqual(writes[count], [96, 0]);
  assert.equal(registers.HR95, 530);
  assert.equal(platform.applianceSnapshots.get('charge').HR116, 40);
});

for (const serial of ['CH2344G083', 'CE2225G298', 'ED2151G182']) {
  test(`${serial}: overnight45 to IOG100 handover verifies new limits after restoration`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-14T01:00:00+01:00').getTime() });
    const { platform: p, registers, writes } = fixture(serial);
    p.applianceControl.targetSoc = 45;
    p.applianceControl.iogChargeTargetSoc = 100;
    p.octopusState.dispatches = [{ start: new Date('2026-10-14T00:30:00+01:00'), end: new Date('2026-10-14T06:00:00+01:00') }];
    await p.applyApplianceAutomation();
    assert.equal(registers.HR116, 45);
    const count = writes.length;
    t.mock.timers.setTime(new Date('2026-10-14T05:30:00+01:00').getTime());
    p.latestModel.socPercent = 46;
    await p.applyApplianceAutomation();
    assert.equal(p.autoChargeLabel, 'Intelligent Octopus Go Home Battery Protection');
    assert.equal(registers.HR116, 100);
    assert.equal(registers.HR20, 0);
    assert.equal(registers.HR96, 1);
    assert.deepEqual(writes[count], [96, 0]);
    assert.equal(p.applianceSnapshots.get('charge').HR116, 40);
    assert.equal(registers.HR242, 80);
  });
}

test('failed IOG target readback cannot enable charging or claim active ownership', async () => {
  const { platform: p, registers, writes } = fixture();
  p.applianceControl.targetSoc = 45;
  const normalWrite = p.writeDirectRegister;
  p.writeDirectRegister = async (register, value) => { if (register !== 116) await normalWrite(register, value); };
  await assert.rejects(p.startTimedChargeCommand({ minutes: 30 }, { automatic: true, label: 'Intelligent Octopus Go Home Battery Protection' }), /pre-enable readback/);
  assert.equal(registers.HR96, 0);
  assert.ok(!writes.some(([register, value]) => register === 96 && value === 1));
  assert.equal(p.activeChargeTarget, undefined);
  assert.equal(p.applianceSnapshots.get('charge').HR116, 40);
  p.writeDirectRegister = normalWrite;
  await p.cleanupApplianceCommandFamily('charge', 'failed IOG start');
  assert.equal(registers.HR116, 40);
});

for (const serial of ['CH2344G083', 'CE2225G298', 'ED2151G182']) {
  test(`${serial}: solar overnight target, slider cap, Off fallback and IOG handover retain ownership`, async t => {
    const at = new Date('2026-10-17T01:00:00+01:00');
    t.mock.timers.enable({ apis: ['Date'], now: at.getTime() });
    const { platform:p, registers, writes } = fixture(serial);
    Object.assign(p, {
      config: { enableSolarAwareCheapOvernight:true },
      solarAwareEnabled:true,
      solarForecasts:{'2026-10-17':{date:'2026-10-17',kwh:30,fetchedAt:'2026-10-16T18:00:00+01:00'}},
      chargeTargetTileEnabled:()=>true,
      currentCheapStateForStatusTiles:()=>getMergedCheapState(new Date(),p.octopusState.dispatches,p.applianceControl,p.octopusState)
    });
    p.applianceControl.iogChargeTargetSoc=95;
    p.octopusState.dispatches=[{start:new Date('2026-10-17T00:30:00+01:00'),end:new Date('2026-10-17T06:00:00+01:00')}];
    await p.applyApplianceAutomation();
    assert.equal(p.activeChargeTarget.source,'Cheap Overnight'); assert.equal(registers.HR116,60);
    assert.equal(p.applianceControl.targetSoc,100); assert.equal(p.applianceControl.iogChargeTargetSoc,95);
    const snapshot=p.applianceSnapshots.get('charge');
    p.solarAwareEnabled=false; await p.reconcileActiveChargeTarget(); assert.equal(registers.HR116,100);
    p.solarAwareEnabled=true; p.applianceControl.targetSoc=45; await p.reconcileActiveChargeTarget(); assert.equal(registers.HR116,45);
    assert.equal(p.applianceSnapshots.get('charge'),snapshot);
    t.mock.timers.setTime(new Date('2026-10-17T05:31:00+01:00').getTime());
    await p.applyApplianceAutomation();
    assert.equal(p.activeChargeTarget.source,'Intelligent Octopus Go Home Battery Protection'); assert.equal(registers.HR116,95);
    const count=writes.length; p.applianceControl.targetSoc=40; await p.reconcileActiveChargeTarget(); assert.equal(writes.length,count);
    assert.equal(writes.some(([r])=>r===242),false);
  });
}

test('solar owner reconciles even when the separate Charge Target tile is hidden', async t => {
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-17T01:00:00+01:00').getTime()});
  const {platform:p,registers}=fixture();
  Object.assign(p,{config:{enableSolarAwareCheapOvernight:true},solarAwareEnabled:true,
    solarForecasts:{'2026-10-17':{date:'2026-10-17',kwh:30,fetchedAt:'2026-10-16T18:00:00+01:00'}},
    chargeTargetTileEnabled:()=>false,
    currentCheapStateForStatusTiles:()=>getMergedCheapState(new Date(),[],p.applianceControl,p.octopusState)});
  p.applianceControl.masterGateSatisfied=true;
  await p.applyApplianceAutomation(); assert.equal(registers.HR116,60);
  p.solarAwareEnabled=false; await p.reconcileActiveChargeTarget(); assert.equal(registers.HR116,100);
});
