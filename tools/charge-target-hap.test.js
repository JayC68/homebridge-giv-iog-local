'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const homebridgeEntry = require.resolve('homebridge', { paths: [process.env.GIVHOME_HOMEBRIDGE_TEST_ROOT || process.cwd()] });
const hapEntry = require.resolve('@homebridge/hap-nodejs', { paths: [path.dirname(homebridgeEntry)] });
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

console.log(`Native test dependencies: Homebridge ${packageVersion(homebridgeEntry, 'homebridge')}; HAP ${packageVersion(hapEntry, '@homebridge/hap-nodejs')}`);

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
