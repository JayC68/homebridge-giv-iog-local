'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GivHomeModbusPlatform } = require('../index');
const { validateChargeTarget, loadChargeTarget, saveChargeTarget } = require('../lib/charge-target-setting');
const { buildApplianceControlConfig } = require('../lib/appliance-integrated-control');

function characteristic() {
  return {
    onGet(fn) { this.get = fn; return this; },
    onSet(fn) { this.set = fn; return this; },
    setProps(props) { this.props = props; return this; },
    updateValue(value) { this.value = value; return this; }
  };
}

function fixture(t, serial = 'CH2344G083') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'givhome-charge-target-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const platform = Object.create(GivHomeModbusPlatform.prototype);
  const registers = { HR20: 1, HR94: 2330, HR95: 530, HR96: 0, HR111: 50, HR116: 40, HR242: 80 };
  const chars = new Map();
  const service = {
    getCharacteristic(type) { if (!chars.has(type)) chars.set(type, characteristic()); return chars.get(type); },
    setCharacteristic(type, value) { this.getCharacteristic(type).updateValue(value); return this; },
    updateCharacteristic(type, value) { this.getCharacteristic(type).updateValue(value); return this; }
  };
  class Accessory {
    constructor(name, uuid) { this.displayName = name; this.UUID = uuid; this.context = {}; }
    getService(type) { return type === 'Lightbulb' ? service : null; }
  }
  const registrations = [];
  const removals = [];
  const writes = [];
  Object.assign(platform, {
    config: {}, name: 'GivHome', inverterSerial: serial,
    health: { state: 'online' },
    log: { info() {}, warn() {} },
    configuredChargeTarget: 100, chargeTargetIdentity: `GivHome:${serial}`,
    chargeTargetFile: path.join(directory, 'target.json'),
    applianceControl: { masterGateSatisfied: true, targetSoc: 100, cheapStart: '23:30', cheapEnd: '05:30', graceMinutes: 30,
      iogHomeBatteryProtectionMode: 'charge',
      features: { cheapOvernightCharging: true, chargeTiles: true, homeBatteryProtectionDuringSmartSlots: true, ceAcCoupledLiveWrites: true } },
    latestModel: { socPercent: 40, batteryDischargePowerW: 0, loadPowerW: 300 },
    octopusState: { dispatches: [] },
    applianceSnapshots: new Map(), applianceCommandTimers: new Map(), accessoryByUUID: new Map(), accessories: [],
    Service: { Lightbulb: 'Lightbulb', AccessoryInformation: 'Info' },
    Characteristic: { On: 'On', Brightness: 'Brightness', Name: 'Name' },
    api: {
      hap: { uuid: { generate: (value) => value }, HAPStatus: { INVALID_VALUE_IN_REQUEST: -70410, SERVICE_COMMUNICATION_FAILURE: -70402, NOT_ALLOWED_IN_CURRENT_STATE: -70412 }, HapStatusError: class extends Error { constructor(status) { super(String(status)); this.hapStatus = status; } } },
      platformAccessory: Accessory,
      registerPlatformAccessories(_plugin, _platform, items) { registrations.push(...items); },
      updatePlatformAccessories() {},
      unregisterPlatformAccessories(_plugin, _platform, items) { removals.push(...items); }
    },
    readChargePrestate: async () => ({ ...registers }),
    writeDirectRegister: async (register, value) => { writes.push([register, value]); registers[`HR${register}`] = value; },
    withManualChargeTransportGate: async (_label, run) => run(),
    setApplianceCommandState() {},
    persistCeAcChargeSlotSnapshot(snapshot) { this.ceAcChargeSlotMemory = { snapshot }; },
    clearCeAcChargeSlotMemory() { this.ceAcChargeSlotMemory = null; },
    logBatteryCarePlan() {}, logCheapOvernightPlan() {}
  });
  t.after(() => { if (platform.chargeTargetTimer) clearTimeout(platform.chargeTargetTimer); });
  return { platform, registers, writes, chars, registrations, removals };
}

test('only whole targets in the validated 4-100 range are accepted', () => {
  for (const value of [4, 40, 80, 100]) assert.equal(validateChargeTarget(value), value);
  for (const value of [0, 3, 101, NaN, Infinity, '80', null, 80.5]) assert.throws(() => validateChargeTarget(value));
  assert.equal(buildApplianceControlConfig({ targetSoc: 1 }).targetSoc, 4);
});

test('saved target survives reload, but changed configuration and identity take precedence', (t) => {
  const { platform: p } = fixture(t);
  saveChargeTarget(p.chargeTargetFile, p.chargeTargetIdentity, 100, 65);
  assert.equal(loadChargeTarget(p.chargeTargetFile, p.chargeTargetIdentity, 100), 65);
  assert.equal(loadChargeTarget(p.chargeTargetFile, p.chargeTargetIdentity, 90), 90);
  assert.equal(loadChargeTarget(p.chargeTargetFile, 'Other inverter', 100), 100);
  assert.equal(fs.statSync(p.chargeTargetFile).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(p.chargeTargetFile)), ['target.json']);
});

test('corrupt preference is rejected and missing preference uses configured target', (t) => {
  const { platform: p } = fixture(t);
  assert.equal(loadChargeTarget(p.chargeTargetFile, p.chargeTargetIdentity, 100), 100);
  fs.writeFileSync(p.chargeTargetFile, '{');
  assert.throws(() => loadChargeTarget(p.chargeTargetFile, p.chargeTargetIdentity, 100));
});

test('native dimmer wiring has one stable identity, range and percentage handlers', (t) => {
  const { platform: p, chars, registrations, writes } = fixture(t);
  p.ensureChargeTargetAccessory();
  p.ensureChargeTargetAccessory();
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].displayName, 'Charge Target');
  assert.deepEqual(chars.get('Brightness').props, { minValue: 4, maxValue: 100, minStep: 1 });
  assert.equal(chars.get('Brightness').get(), 100);
  chars.get('Brightness').set(70);
  assert.equal(chars.get('Brightness').get(), 70);
  assert.equal(chars.get('On').get(), true);
  assert.throws(() => chars.get('On').set(false), /-70410/);
  chars.get('On').set(true);
  assert.deepEqual(writes, [], 'a target is not a start/stop command');
});

test('disabled and unsupported control gates withhold or remove only the new tile', (t) => {
  const { platform: p, removals } = fixture(t);
  p.ensureChargeTargetAccessory();
  p.config.enableChargeTargetTile = false;
  p.ensureChargeTargetAccessory();
  assert.equal(removals.length, 1);
  assert.throws(() => p.setChargeTargetFromHome(80), /-70412/);
  p.config.enableChargeTargetTile = true;
  p.applianceControl.masterGateSatisfied = false;
  assert.equal(p.chargeTargetTileEnabled(), false);
  p.applianceControl.masterGateSatisfied = true;
  p.inverterSerial = 'GW00000000';
  assert.equal(p.chargeTargetTileEnabled(), false);
  p.inverterSerial = 'CE2225G298';
  p.applianceControl.features.ceAcCoupledLiveWrites = false;
  assert.equal(p.chargeTargetTileEnabled(), false);
});

test('failed save and invalid Home writes retain the previous target', (t) => {
  const { platform: p } = fixture(t);
  for (const value of [0, 101, '80', 80.5]) assert.throws(() => p.setChargeTargetFromHome(value), /-70410/);
  p.chargeTargetFile = path.join(p.chargeTargetFile, 'missing', 'target.json');
  assert.throws(() => p.setChargeTargetFromHome(70), /-70402/);
  assert.equal(p.applianceControl.targetSoc, 100);
});

test('rapid slider updates save the last value and coalesce active reconciliation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { platform: p } = fixture(t);
  let calls = 0;
  p.reconcileActiveChargeTarget = async () => { calls++; };
  for (const target of [90, 85, 75, 60]) p.setChargeTargetFromHome(target);
  assert.equal(p.applianceControl.targetSoc, 60);
  assert.equal(loadChargeTarget(p.chargeTargetFile, p.chargeTargetIdentity, 100), 60);
  t.mock.timers.tick(749);
  assert.equal(calls, 0);
  t.mock.timers.tick(1);
  assert.equal(calls, 1);
});

for (const serial of ['CH2344G083', 'CE2225G298', 'ED2151G182']) {
  test(`${serial}: active target changes verify only general limits and preserve cleanup snapshot`, async (t) => {
    const { platform: p, registers, writes } = fixture(t, serial);
    const original = { ...registers };
    await p.startTimedChargeCommand({ displayName: 'Charge 30m', minutes: 30 });
    const saved = p.applianceSnapshots.get('charge');
    const before = writes.length;
    p.setChargeTargetFromHome(60);
    await p.reconcileActiveChargeTarget();
    assert.deepEqual(writes.slice(before), [[20, 1], [116, 60]]);
    assert.equal(registers.HR242, 80);
    assert.equal(p.activeChargeTarget.targetSoc, 60);
    assert.equal(p.applianceSnapshots.get('charge'), saved);
    const count = writes.length;
    await p.reconcileActiveChargeTarget();
    assert.equal(writes.length, count);
    p.setChargeTargetFromHome(100);
    await p.reconcileActiveChargeTarget();
    assert.equal(registers.HR20, 0);
    await p.cleanupApplianceCommandFamily('charge', 'trial');
    assert.deepEqual(registers, original);
    assert.equal(p.activeChargeTarget, null);
    assert.equal(p.applianceControl.targetSoc, 100);
    assert.equal(writes.some(([register]) => register === 242), false);
  });
}

test('offline and unowned sessions accept a preference without inverter writes', async (t) => {
  const { platform: p, writes } = fixture(t);
  p.setChargeTargetFromHome(75);
  await p.reconcileActiveChargeTarget();
  assert.deepEqual(writes, []);
  await p.startTimedChargeCommand({ displayName: 'Charge 30m', minutes: 30 });
  p.setChargeTargetFromHome(65);
  p.health.state = 'stale';
  const count = writes.length;
  await p.reconcileActiveChargeTarget();
  assert.equal(writes.length, count);
  p.health.state = 'online';
  p.applianceSnapshots.clear();
  await p.reconcileActiveChargeTarget();
  assert.equal(writes.length, count);
});

test('externally changed charge times refuse target writes', async (t) => {
  const { platform: p, registers, writes } = fixture(t);
  await p.startTimedChargeCommand({ displayName: 'Charge 30m', minutes: 30 });
  p.setChargeTargetFromHome(65);
  registers.HR95 = 2359;
  const count = writes.length;
  await assert.rejects(p.reconcileActiveChargeTarget(), /owned charge settings changed/);
  assert.equal(writes.length, count);
  assert.ok(p.chargeTargetError);
  assert.equal(p.applianceSnapshots.get('charge').HR116, 40);
});

test('failed readback exposes a fault, preserves preference and retries without replacing prestate', async (t) => {
  const { platform: p, registers } = fixture(t);
  p.ensureChargeTargetAccessory();
  await p.startTimedChargeCommand({ displayName: 'Charge 30m', minutes: 30 });
  p.setChargeTargetFromHome(65);
  const write = p.writeDirectRegister;
  p.writeDirectRegister = async (register, value) => { if (register !== 116) await write(register, value); };
  await assert.rejects(p.reconcileActiveChargeTarget(), /readback failed/);
  assert.equal(p.applianceControl.targetSoc, 65);
  assert.equal(p.activeChargeTarget.targetSoc, 100);
  assert.throws(() => p.chargeTargetService.getCharacteristic('Brightness').get(), /-70402/);
  p.writeDirectRegister = write;
  await p.reconcileActiveChargeTarget();
  assert.equal(registers.HR116, 65);
  assert.equal(p.chargeTargetError, null);
  assert.equal(p.chargeTargetService.getCharacteristic('Brightness').get(), 65);
  assert.equal(p.applianceSnapshots.get('charge').HR116, 40);
});

test('a queued slider update rechecks ownership and newest preference before writing', async (t) => {
  const { platform: p, writes } = fixture(t);
  await p.startTimedChargeCommand({ displayName: 'Charge 30m', minutes: 30 });
  p.setChargeTargetFromHome(75);
  let release;
  p.withManualChargeTransportGate = async (_label, run) => { await new Promise((resolve) => { release = resolve; }); return run(); };
  const pending = p.reconcileActiveChargeTarget();
  p.setChargeTargetFromHome(55);
  release();
  await pending;
  assert.equal(p.activeChargeTarget.targetSoc, 55);
  assert.deepEqual(writes.slice(-2), [[20, 1], [116, 55]]);
});

test('selecting the previous target after a partial failure still reconciles the enable flag', async (t) => {
  const { platform: p, registers } = fixture(t);
  await p.startTimedChargeCommand({ displayName: 'Charge 30m', minutes: 30 });
  p.setChargeTargetFromHome(65);
  const write = p.writeDirectRegister;
  p.writeDirectRegister = async (register, value) => { if (register !== 116) await write(register, value); };
  await assert.rejects(p.reconcileActiveChargeTarget(), /readback failed/);
  assert.equal(registers.HR20, 1);
  p.setChargeTargetFromHome(100);
  p.writeDirectRegister = write;
  await p.reconcileActiveChargeTarget();
  assert.equal(registers.HR20, 0);
  assert.equal(registers.HR116, 100);
  assert.equal(p.chargeTargetError, null);
});

test('IOG target edits do not write during Cheap Overnight ownership', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T01:00:00+01:00').getTime() });
  const { platform: p, writes } = fixture(t);
  await p.startTimedChargeCommand({ minutes: 30 }, { automatic: true, label: 'Intelligent Octopus Go Home Battery Protection' });
  p.setChargeTargetFromHome(65);
  const count = writes.length;
  await p.reconcileActiveChargeTarget();
  assert.equal(writes.length, count);
});

test('IOG charge-mode protection adopts the slider target without taking a new snapshot', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T13:00:00+01:00').getTime() });
  const { platform: p, registers, writes } = fixture(t);
  p.octopusState.dispatches = [{ start: new Date('2026-10-10T13:00:00+01:00'), end: new Date('2026-10-10T16:00:00+01:00') }];
  await p.applyApplianceAutomation();
  const snapshot = p.applianceSnapshots.get('charge');
  p.setChargeTargetFromHome(65);
  const count = writes.length;
  await p.applyApplianceAutomation();
  assert.deepEqual(writes.slice(count), [[20, 1], [116, 65]]);
  assert.equal(p.autoChargeLabel, 'Intelligent Octopus Go Home Battery Protection');
  assert.equal(p.applianceSnapshots.get('charge'), snapshot);
  assert.equal(registers.HR96, 1);
  assert.equal(registers.HR242, 80);
});

test('IOG window crossing into Cheap Overnight during a read suppresses target writes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-09T23:29:59+01:00').getTime() });
  const { platform: p, writes } = fixture(t);
  p.octopusState.dispatches = [{ start: new Date('2026-10-09T23:00:00+01:00'), end: new Date('2026-10-10T00:00:00+01:00') }];
  await p.startTimedChargeCommand({ minutes: 30 }, { automatic: true, label: 'Intelligent Octopus Go Home Battery Protection' });
  p.setChargeTargetFromHome(65);
  const read = p.readChargePrestate;
  p.readChargePrestate = async () => {
    const result = await read();
    t.mock.timers.setTime(new Date('2026-10-09T23:30:01+01:00').getTime());
    return result;
  };
  const count = writes.length;
  await p.reconcileActiveChargeTarget();
  assert.equal(writes.length, count);
});

test('expired timed charge refuses a late target update', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T13:00:00+01:00').getTime() });
  const { platform: p, writes } = fixture(t);
  await p.startTimedChargeCommand({ displayName: 'Charge 30m', minutes: 30 });
  p.setChargeTargetFromHome(65);
  t.mock.timers.setTime(new Date('2026-10-10T13:30:00+01:00').getTime());
  const count = writes.length;
  await p.reconcileActiveChargeTarget();
  assert.equal(writes.length, count);
});

test('lowering overnight target below SOC cleans up; raising it starts with the saved preference', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T01:00:00+01:00').getTime() });
  const { platform: p, registers } = fixture(t);
  await p.applyApplianceAutomation();
  p.setChargeTargetFromHome(30);
  await p.applyApplianceAutomation();
  assert.equal(registers.HR96, 0);
  assert.equal(registers.HR116, 40);
  assert.equal(p.applianceControl.targetSoc, 30);
  p.setChargeTargetFromHome(70);
  await p.applyApplianceAutomation();
  assert.equal(registers.HR116, 70);
  assert.equal(registers.HR96, 1);
  assert.equal(p.applianceSnapshots.get('charge').HR116, 40);
});
