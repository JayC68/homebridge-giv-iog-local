'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const schema = require('../config.schema.json');
const { buildApplianceControlConfig } = require('../lib/appliance-integrated-control');
const { migrateExistingConfig } = require('../homebridge-ui/public/config-migration');
const expectedContract = '5e626269f93c2f38bf63693c9cf9fb5a1e3fc4d228511e3234c491d2e4c79d58';
function runtimeContract(value) {
  if (Array.isArray(value)) return value.map(runtimeContract);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['title', 'description', 'enumNames'].includes(key)).sort(([a],[b]) => a.localeCompare(b)).map(([key,v]) => [key,runtimeContract(v)]));
}
function fields(nodes, model, visibleOnly = false) {
  return nodes.flatMap(node => {
    if (typeof node === 'string') return [{ key: node }];
    if (visibleOnly && node.condition && !new Function('model', node.condition.functionBody)(model)) return [];
    return [...(node.key ? [node] : []), ...fields(node.items || [], model, visibleOnly)];
  });
}
const visible = model => fields(schema.form, model, true).map(n => n.key);

test('Config presentation preserves all published defaults, keys, types, limits and enum values', () => {
  const hash = crypto.createHash('sha256').update(JSON.stringify(runtimeContract(schema.schema))).digest('hex');
  assert.equal(hash, expectedContract);
  const fieldHash = crypto.createHash('sha256').update(JSON.stringify([...new Set(fields(schema.form, {}).map(n => n.key))].sort())).digest('hex');
  assert.equal(fieldHash, '3301ea65ce35c42b06c38364ca79779157cf816b08f404c84589c42864cea8e2', 'only the retired Solar 2mrw scale may disappear');
  const known = new Set(Object.keys(schema.schema.properties));
  for (const { key } of fields(schema.form, {})) assert.ok(known.has(key.split(/[.[]/)[0]), `unknown setting ${key}`);
});

test('Hidden settings keep independent controls accessible without enabling another feature', () => {
  const disabled = { enablePredictedSolar: false, enableOctopusSmartWindows: false, enableOctopusAgileOutgoingAutoExport: false };
  assert.ok(visible(disabled).includes('enableSolarObservation'));
  assert.ok(visible(disabled).includes('enableEmergencyStopTile'));
  assert.ok(visible(disabled).includes('maxPvKw'), 'live solar display does not require forecast enablement');
  assert.ok(!visible(disabled).includes('octopusApiKey'));
  const audit = { ...disabled, enableOctopusAgileOutgoingAutoExport: true, octopusAgileOutgoingEnableMpanAudit: true };
  assert.equal(visible(audit).filter(k => k === 'octopusApiKey').length, 1, 'meter audit can use API key without IOG');
  audit.enableOctopusSmartWindows = true;
  assert.equal(visible(audit).filter(k => k === 'octopusApiKey').length, 1, 'API key is not duplicated');
  for (const item of fields(schema.form, audit, true).filter(n => n.key === 'octopusApiKey')) assert.equal(item.type, 'password');
});

test('Custom days, time limits and IOG target follow only their matching choices', () => {
  const model = { enableOctopusFluxExport: true, octopusFluxRunDaysPreset: 'everyday', octopusFluxRunSunday: false,
    enableOctopusAgileOutgoingAutoExport: true, octopusAgileOutgoingRunDaysPreset: 'everyday', octopusAgileOutgoingSlotSearchMode: 'anyHighValue',
    octopusAgileOutgoingAllowedStartTime: '10:15', enableOctopusSmartWindows: true, enableEvSmartWindowBatteryProtection: true, iogHomeBatteryProtectionMode: 'pauseDischarge', iogChargeTargetSoc: 77 };
  const before = structuredClone(model);
  assert.ok(!visible(model).includes('octopusFluxRunSunday'));
  assert.ok(!visible(model).includes('octopusAgileOutgoingRunSunday'));
  assert.ok(!visible(model).includes('octopusAgileOutgoingAllowedStartTime'));
  assert.ok(!visible(model).includes('iogChargeTargetSoc'));
  assert.deepEqual(model, before, 'visibility evaluation does not rewrite saved preferences');
  Object.assign(model, { octopusFluxRunDaysPreset: 'custom', octopusAgileOutgoingRunDaysPreset: 'custom', octopusAgileOutgoingSlotSearchMode: 'customWindow', iogHomeBatteryProtectionMode: 'charge' });
  for (const key of ['octopusFluxRunSunday','octopusAgileOutgoingRunSunday','octopusAgileOutgoingAllowedStartTime','iogChargeTargetSoc']) assert.ok(visible(model).includes(key));
  assert.equal(model.octopusFluxRunSunday, false);
  assert.equal(model.iogChargeTargetSoc, 77);
});

test('All nine selectors have explicit UI choices without changing optional stored schema', () => {
  const selectors = fields(schema.form, {}).filter(n => n.key && (schema.schema.properties[n.key]?.enum || schema.schema.properties[n.key]?.oneOf));
  assert.equal(selectors.length, 9);
  for (const field of selectors) {
    assert.equal(field.required, true);
    assert.ok(!schema.schema.required.includes(field.key), 'UI requirement must not migrate existing optional config');
    assert.ok(Object.hasOwn(schema.schema.properties[field.key], 'default'));
  }
});

function withSchemaDefaults(config) {
  const result = structuredClone(config);
  for (const [key, property] of Object.entries(schema.schema.properties)) {
    if (!Object.hasOwn(result, key) && Object.hasOwn(property, 'default')) result[key] = structuredClone(property.default);
  }
  return result;
}

test('Existing configurations are prepared without changing their effective appliance behaviour', () => {
  const identity = { platform: 'GivHomeModbus', inverterSerial: 'CH2344G083',
    enableApplianceControl: true, applianceControlAcknowledgement: 'ENABLE_GIVHOME_APPLIANCE_CONTROL' };
  const cases = {
    '01-complete-v4': { ...identity, name: 'Longstanding Home', enableCheapOvernightCharging: false,
      enableOctopusFluxExport: false, octopusFluxRunDaysPreset: 'custom', octopusFluxRunMonday: false,
      octopusFluxRunTuesday: true, maxBatteryChargePowerKw: 3.6, maxBatteryExportPowerKw: 3.6,
      maxGridExportPowerKw: 2.7, timedExportPowerKw: 1.8, predictedSolarCountryCode: 'GB' },
    '02-sparse-no-name': { ...identity, enableBatteryCareCharging: false,
      enableEvSmartWindowBatteryProtection: false, targetSoc: 61 },
    '03-legacy-aliases': { ...identity, name: 'Migration Example', enableCheapOvernightCharging: false,
      enableExcessEnergyExport: true, excessExportStartTime: '20:15', excessExportReserveSoc: 41,
      excessExportDischargeKw: 2.2, excessExportSlotMinutes: 45, excessExportMarginSoc: 7,
      maxBatteryDischargePowerKw: 3.2, gridExportLimitKw: 2.1, manualExportPowerPercent: 45,
      enableFluxPeakExport: true, fluxExportStartTime: '16:30', fluxExportEndTime: '18:30',
      fluxReserveSoc: 44, fluxEveningReserveKwh: 5.5, fluxSafetyMarginSoc: 8,
      fluxExportPowerKw: 1.7, fluxSlotMinutes: 45, fluxMinimumExportKwh: 1.3,
      enableAgileOutgoingAutoExport: true, agileOutgoingExportPowerKw: 1.9 },
    '04-old-day-lists': { ...identity, name: 'Migration Example', enableCheapOvernightCharging: false,
      enableOctopusFluxExport: true, octopusFluxDaysToRun: ['mon', 'wed'],
      enableOctopusAgileOutgoingAutoExport: true, octopusAgileOutgoingDaysToRun: ['tue', 'sat'],
      enableTimedExportTiles: true, manualExportPowerPercent: 35, maxBatteryChargePowerKw: 4.5 },
    '05-numeric-strings': { ...identity, name: 'String settings', enableCheapOvernightCharging: false,
      octopusAgileOutgoingReferenceImportPence: '7.5', octopusAgileOutgoingMinimumGrossMarginPence: '6.25',
      octopusAgileOutgoingEveningReserveKwh: '4.25', octopusAgileOutgoingSafetyMarginSoc: '5.5',
      octopusAgileOutgoingMinimumExportKwh: '0.75', octopusAgileOutgoingMpanAuditDelayHours: '24',
      octopusAgileOutgoingMpanMismatchToleranceKwh: '0.6' },
    '06-canonical-precedence': { ...identity, name: 'Canonical wins', enableCheapOvernightCharging: false,
      enableEveningExcessExport: false, enableExcessEnergyExport: true,
      eveningExportReserveSoc: 33, excessExportReserveSoc: 77,
      enableOctopusFluxExport: false, enableFluxPeakExport: true,
      octopusFluxReserveSoc: 29, fluxReserveSoc: 78 }
  };
  for (const [id, before] of Object.entries(cases)) {
    const prepared = migrateExistingConfig(before).config;
    const afterFormDefaults = withSchemaDefaults(prepared);
    const originalEffective = { ...buildApplianceControlConfig(before) };
    const migratedEffective = { ...buildApplianceControlConfig(afterFormDefaults) };
    // An old explicit day list is represented as the equivalent custom preset.
    // The resolved days are compared; the preset label itself is canonical metadata.
    delete originalEffective.octopusFluxRunDaysPreset;
    delete originalEffective.octopusAgileOutgoingRunDaysPreset;
    delete migratedEffective.octopusFluxRunDaysPreset;
    delete migratedEffective.octopusAgileOutgoingRunDaysPreset;
    assert.deepEqual(migratedEffective, originalEffective, id);
    assert.deepEqual(migrateExistingConfig(prepared).config, prepared, `${id} migration is idempotent`);
    assert.equal(prepared.platform, before.platform, `${id} platform identity retained`);
    assert.equal(prepared.inverterSerial, before.inverterSerial, `${id} serial retained`);
  }
});

test('Sparse identity, old export days and unknown owner settings survive preparation', () => {
  const sparse = migrateExistingConfig({ platform: 'GivHomeModbus', inverterSerial: 'CH2344G083',
    predictedSolarReferenceKwh: 27, customOwnerMetadata: { keep: true } }).config;
  assert.equal(sparse.name, 'GivHome Modbus');
  assert.equal(sparse.enableCheapOvernightCharging, false);
  assert.equal(Object.hasOwn(sparse, 'predictedSolarReferenceKwh'), false);
  assert.deepEqual(sparse.customOwnerMetadata, { keep: true });
  const days = migrateExistingConfig({ platform: 'GivHomeModbus', name: 'Home', inverterSerial: 'CH2344G083',
    octopusFluxDaysToRun: ['mon', 'wed'], octopusAgileOutgoingDaysToRun: ['tue', 'sat'] }).config;
  assert.equal(days.octopusFluxRunDaysPreset, 'custom');
  assert.equal(days.octopusFluxRunMonday, true);
  assert.equal(days.octopusFluxRunTuesday, false);
  assert.equal(days.octopusFluxRunWednesday, true);
  assert.equal(days.octopusAgileOutgoingRunTuesday, true);
  assert.equal(days.octopusAgileOutgoingRunSaturday, true);
  assert.equal(days.octopusAgileOutgoingRunSunday, false);
});

test('Custom UI wrapper is packaged, migrates only existing blocks and retains unknown settings', () => {
  assert.equal(schema.customUi, true);
  for (const file of ['index.html', 'ui.js', 'config-migration.js']) assert.ok(fs.existsSync(path.resolve(__dirname, '../homebridge-ui/public', file)));
  const ui = fs.readFileSync(path.resolve(__dirname, '../homebridge-ui/public/ui.js'), 'utf8');
  assert.match(ui, /blocks\.length > 0/);
  assert.match(ui, /updatePluginConfig\(prepared\)/);
  assert.match(ui, /createForm\(pluginSchema, prepared\[0\]\)/);
  assert.match(ui, /form\.onChange/);
  assert.match(ui, /\.\.\.\(passthrough\[0\]/);
});

test('Solar 2mrw has no manual scale or advanced panel', () => {
  assert.equal(Object.hasOwn(schema.schema.properties, 'predictedSolarReferenceKwh'), false);
  assert.equal(schema.form.some(item => item && item.title === 'Predicted Solar \u2014 advanced'), false);
});
