'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const homebridgeEntry = require.resolve('homebridge', { paths: [process.env.GIVHOME_HOMEBRIDGE_TEST_ROOT || process.cwd()] });
let hapEntry;
try { hapEntry = require.resolve('@homebridge/hap-nodejs', { paths: [path.dirname(homebridgeEntry)] }); }
catch { hapEntry = require.resolve('hap-nodejs', { paths: [path.dirname(homebridgeEntry)] }); }
const hap = require(hapEntry);
const { GivHomeModbusPlatform } = require('../index');

// Use real native services without relying on Homebridge's private wrapper exports.
class NativeTestAccessory extends hap.Accessory {
  constructor(name, uuid) { super(name, uuid); this.context = {}; }
}

function packageVersion(entry, name) {
  let directory = path.dirname(entry);
  while (directory !== path.dirname(directory)) {
    const file = path.join(directory, 'package.json');
    if (fs.existsSync(file)) {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (pkg.name === name) return pkg.version;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Cannot identify ${name} test dependency`);
}

console.log(`Native test dependencies: Homebridge ${packageVersion(homebridgeEntry, 'homebridge')}; HAP ${packageVersion(hapEntry, hapEntry.includes('@homebridge') ? '@homebridge/hap-nodejs' : 'hap-nodejs')}`);

function makePlatform(t, directory, overrides = {}) {
  const config = {
    name: 'GivHome', inverterSerial: 'CH2344G083', inverterHost: '127.0.0.1',
    flightRecorderDir: path.join(directory, 'recorder'),
    enableApplianceControl: true, applianceControlAcknowledgement: 'ENABLE_GIVHOME_APPLIANCE_CONTROL',
    enableCheapOvernightCharging: true, targetSoc: 100, ...overrides
  };
  const registered = [];
  const api = {
    hap, platformAccessory: NativeTestAccessory, user: { storagePath: () => directory }, on() {},
    registerPlatformAccessories(_plugin, _platform, accessories) { registered.push(...accessories); },
    updatePlatformAccessories() {}, unregisterPlatformAccessories() {}
  };
  const log = Object.assign(() => {}, { info() {}, warn() {}, error() {}, debug() {} });
  const platform = new GivHomeModbusPlatform(log, config, api);
  t.after(() => { clearInterval(platform.flightRecorder.timer); clearTimeout(platform.chargeTargetTimer); });
  return { platform, registered };
}

function storage(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'givhome-native-hap-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('real HAP Lightbulb exposes a writable bounded Brightness and safe On handlers', async (t) => {
  const directory = storage(t);
  const { platform: p, registered } = makePlatform(t, directory);
  p.ensureChargeTargetAccessory();
  assert.equal(registered.length, 1);
  const bulb = registered[0].getService(hap.Service.Lightbulb);
  const brightness = bulb.getCharacteristic(hap.Characteristic.Brightness);
  const on = bulb.getCharacteristic(hap.Characteristic.On);
  assert.equal(brightness.props.minValue, 4);
  assert.equal(brightness.props.maxValue, 100);
  assert.equal(brightness.props.minStep, 1);
  assert.ok(brightness.props.perms.includes(hap.Perms.PAIRED_WRITE));
  await brightness.handleSetRequest(65);
  assert.equal(await brightness.handleGetRequest(), 65);
  assert.equal(await on.handleGetRequest(), true);
  await assert.rejects(on.handleSetRequest(false), (err) => err === hap.HAPStatus.INVALID_VALUE_IN_REQUEST || err.hapStatus === hap.HAPStatus.INVALID_VALUE_IN_REQUEST);
  assert.equal(p.applianceControl.targetSoc, 65);
  assert.equal(p.applianceSnapshots.size, 0, 'native slider does not start a charge');
  const services = registered[0].services;
  assert.equal(services.filter((service) => service.UUID === hap.Service.Lightbulb.UUID).length, 1);
});

test('target stays On through telemetry publication and stale connection handling', (t) => {
  const { platform: p } = makePlatform(t, storage(t));
  p.ensureChargeTargetAccessory();
  p.setChargeTargetFromHome(67);
  p.currentCheapStateForStatusTiles = () => ({});
  const on = p.chargeTargetService.getCharacteristic(hap.Characteristic.On);
  on.updateValue(false);
  p.updateAccessories({});
  assert.equal(on.value, true);
  p.markAccessoriesInactive();
  assert.equal(on.value, true);
  assert.equal(p.chargeTargetService.getCharacteristic(hap.Characteristic.Brightness).value, 67);
  assert.equal(p.applianceControl.targetSoc, 67);
  assert.equal(p.applianceSnapshots.size, 0);
});

test('real platform reload restores the preference and honours config changes and tile disabling', (t) => {
  const directory = storage(t);
  const first = makePlatform(t, directory).platform;
  first.setChargeTargetFromHome(60);
  assert.equal(makePlatform(t, directory).platform.applianceControl.targetSoc, 60);
  assert.equal(makePlatform(t, directory, { targetSoc: 90 }).platform.applianceControl.targetSoc, 90);
  assert.equal(makePlatform(t, directory, { enableChargeTargetTile: false }).platform.applianceControl.targetSoc, 100);
});

test('real platform contains a corrupt preference without losing telemetry setup', (t) => {
  const directory = storage(t);
  const first = makePlatform(t, directory).platform;
  fs.writeFileSync(first.chargeTargetFile, '{');
  const restored = makePlatform(t, directory).platform;
  assert.equal(restored.applianceControl.targetSoc, 100);
  assert.equal(restored.health.state, 'starting');
  restored.ensureChargeTargetAccessory();
  assert.ok(restored.chargeTargetService);
});

test('real constructor reload isolates default and explicit IOG targets from saved overnight slider', (t) => {
  const directory = storage(t);
  const first = makePlatform(t, directory, { targetSoc: 70, iogChargeTargetSoc: 90 }).platform;
  first.setChargeTargetFromHome(45);
  const restored = makePlatform(t, directory, { targetSoc: 70, iogChargeTargetSoc: 90 }).platform;
  assert.equal(restored.applianceControl.targetSoc, 45);
  assert.equal(restored.configuredChargeTarget, 70);
  assert.equal(restored.applianceControl.iogChargeTargetSoc, 90);
  const defaultIog = makePlatform(t, directory, { targetSoc: 70 }).platform;
  assert.equal(defaultIog.applianceControl.targetSoc, 45);
  assert.equal(defaultIog.applianceControl.iogChargeTargetSoc, 100);
  defaultIog.setChargeTargetFromHome(95);
  assert.equal(defaultIog.applianceControl.iogChargeTargetSoc, 100);
});

test('new native switches are opt-in and reuse UUIDs on reload', async t => {
  const directory = storage(t);
  const ordinary = makePlatform(t, directory);
  ordinary.platform.ensureBetaControlAccessories();
  assert.equal(ordinary.registered.length, 0);
  const first = makePlatform(t, directory, { enableSolarAwareCheapOvernight: true, enableEmergencyStopTile: true });
  first.platform.ensureBetaControlAccessories();
  assert.equal(first.registered.length, 2);
  const solar = first.registered.find(a => a.context.definitionId === 'solar-aware-overnight');
  const switchOn = solar.getService(hap.Service.Switch).getCharacteristic(hap.Characteristic.On);
  await switchOn.handleSetRequest(false); assert.equal(await switchOn.handleGetRequest(), false);
  const second = makePlatform(t, directory, { enableSolarAwareCheapOvernight: true, enableEmergencyStopTile: true });
  for (const accessory of first.registered) second.platform.configureAccessory(accessory);
  second.platform.ensureBetaControlAccessories();
  assert.equal(second.registered.length,0); assert.equal(second.platform.solarAwareEnabled,false);
  assert.equal(await solar.getService(hap.Service.Switch).getCharacteristic(hap.Characteristic.On).handleGetRequest(),false);
});

test('native Emergency Stop is momentary, reports failure and never treats Off as verified', async t => {
  const { platform:p, registered } = makePlatform(t, storage(t), { enableEmergencyStopTile: true });
  p.ensureBetaControlAccessories();
  const on = registered[0].getService(hap.Service.Switch).getCharacteristic(hap.Characteristic.On);
  let calls=0;
  p.requestEmergencyStop=async()=>{calls++;};
  await on.handleSetRequest(true); await new Promise(setImmediate); assert.equal(calls,1); assert.equal(on.value,false);
  await on.handleSetRequest(false); assert.equal(calls,1);
  p.requestEmergencyStop=async()=>{p.emergencyState={status:'failed'}; throw new Error('simulated failed readback');};
  const communicationFailure=err=>err===hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE || err.hapStatus===hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE;
  await assert.rejects(on.handleSetRequest(true),communicationFailure);
  await assert.rejects(on.handleGetRequest(),communicationFailure);
  assert.equal(p.emergencyHeld(),true);
});

test('native switches respect master, unsupported model, CE acknowledgement and removal', t => {
  for (const overrides of [{enableApplianceControl:false},{inverterSerial:'GW00000000'},{inverterSerial:'CE2225G298'}]) {
    const {platform:p,registered}=makePlatform(t,storage(t),{enableEmergencyStopTile:true,...overrides});
    p.ensureBetaControlAccessories(); assert.equal(registered.length,0);
  }
  const {platform:p,registered}=makePlatform(t,storage(t),{enableEmergencyStopTile:true});
  p.ensureBetaControlAccessories(); assert.equal(registered.length,1);
  p.config.enableEmergencyStopTile=false; p.ensureBetaControlAccessories(); assert.equal(p.accessories.length,0);
});

test('solar native toggle saves first, rejects storage failure and leaves prior preference', async t => {
  const {platform:p,registered}=makePlatform(t,storage(t),{enableSolarAwareCheapOvernight:true});
  p.ensureBetaControlAccessories();
  const on=registered[0].getService(hap.Service.Switch).getCharacteristic(hap.Characteristic.On);
  p.solarStateFile=path.join(p.getStoragePath(),'missing','state');
  await assert.rejects(on.handleSetRequest(false)); assert.equal(p.solarAwareEnabled,true);
});
