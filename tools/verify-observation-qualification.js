'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const files = ['index.js', 'config.schema.json', 'package.json', ...fs.readdirSync(path.join(root, 'lib')).filter(n => n.endsWith('.js')).map(n => `lib/${n}`)].sort();
const digest = crypto.createHash('sha256');
for (const file of files) { digest.update(file + '\0'); digest.update(fs.readFileSync(path.join(root, file))); }
const runtimeSha256 = digest.digest('hex');
if (process.argv.includes('--runtime-hash')) { console.log(runtimeSha256); process.exit(0); }
const record = JSON.parse(fs.readFileSync(path.join(root, 'docs/OBSERVATION_QUALIFICATION.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const numeric = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const hardware = p => p && typeof p.hardware === 'string' && p.hardware.length > 0 && p.paired === true
  && numeric(p.hours) && p.hours >= 72 && p.noGrowingRetainedHeap === true && p.controlsResponsive === true
  && numeric(p.addedHeapMiB) && p.addedHeapMiB <= 8 && numeric(p.addedRssMiB) && p.addedRssMiB <= 16
  && numeric(p.addedOneCoreCpuPercent) && p.addedOneCoreCpuPercent < 1
  && numeric(p.addedLoopP95Ms) && p.addedLoopP95Ms < 5 && numeric(p.addedLoopP99Ms) && p.addedLoopP99Ms < 10;
if (record.status !== 'passed' || record.version !== pkg.version || record.runtimeSha256 !== runtimeSha256
  || !hardware(record.minimumPi) || !hardware(record.busierPi) || record.networkIsolationPassed !== true
  || record.faultAndRetentionPassed !== true || typeof record.evidence !== 'string' || !record.evidence.trim()) {
  console.error('BLOCKED: physical Pi resource/privacy qualification is incomplete or does not match this runtime.');
  console.error(`Runtime SHA-256: ${runtimeSha256}`);
  process.exit(1);
}
console.log(`PASS matched 72-hour Pi qualification record for ${pkg.version}; evidence: ${record.evidence}`);
