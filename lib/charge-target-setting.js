'use strict';

const fs = require('fs');
const { randomUUID } = require('crypto');

function validateChargeTarget(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 4 || value > 100) {
    throw new Error('Charge Target must be a whole percentage from 4 to 100');
  }
  return value;
}

function loadChargeTarget(file, identity, configuredTarget) {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT') return configuredTarget;
    throw err;
  }
  // An explicit configuration change or a different inverter supersedes the Home preference.
  if (saved.schemaVersion !== 1 || saved.identity !== identity || saved.configuredTarget !== configuredTarget) return configuredTarget;
  return validateChargeTarget(saved.targetSoc);
}

function saveChargeTarget(file, identity, configuredTarget, targetSoc) {
  validateChargeTarget(targetSoc);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, identity, configuredTarget, targetSoc }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
}

module.exports = { validateChargeTarget, loadChargeTarget, saveChargeTarget };
