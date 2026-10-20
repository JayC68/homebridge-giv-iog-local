'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const schema = require('../config.schema.json');
const expectedContract = '47207a5e754243c5231ca027be49f367add5a319571c84f9e78576d3386b8a2f';
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
  assert.equal(fieldHash, '3088f63c0896a5ef8f927295e0283d3fa27053cfde6e2b49048df0d32297dd37', 'no previously exposed setting may disappear');
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
