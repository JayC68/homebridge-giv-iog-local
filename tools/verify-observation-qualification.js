'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const numeric = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const hardware = p => p && typeof p.hardware === 'string' && p.hardware.length > 0 && p.paired === true
  && numeric(p.hours) && p.hours >= 72 && p.noGrowingRetainedHeap === true && p.controlsResponsive === true
  && numeric(p.addedHeapMiB) && p.addedHeapMiB <= 8 && numeric(p.addedRssMiB) && p.addedRssMiB <= 16
  && numeric(p.addedOneCoreCpuPercent) && p.addedOneCoreCpuPercent < 1
  && numeric(p.addedLoopP95Ms) && p.addedLoopP95Ms < 5 && numeric(p.addedLoopP99Ms) && p.addedLoopP99Ms < 10;

function publicationDecision({ record, pkg, runtimeSha256, schema, foundation }, allowBeta = false) {
  const matches = record?.version === pkg?.version && record?.runtimeSha256 === runtimeSha256
    && record?.networkIsolationPassed === true && record?.faultAndRetentionPassed === true
    && typeof record?.evidence === 'string' && record.evidence.trim().length > 0;
  if (!matches) return { allowed: false, hardwareQualified: false };
  if (record.status === 'passed' && hardware(record.minimumPi) && hardware(record.busierPi)) {
    return { allowed: true, hardwareQualified: true };
  }
  const approval = record.betaPublication;
  // This explicit owner approval applies only to this default-on foundation beta, never a stable/automatic release.
  const optionalFoundation = schema?.schema?.properties?.enableSolarObservation?.default === true
    && schema?.schema?.properties?.enableEmergencyStopTile?.default === true
    && foundation?.automaticControl === false && foundation?.qualified === false;
  const approvedBeta = allowBeta && record.status === 'pending' && pkg.version === '4.0.3-beta.10'
    && approval?.version === pkg.version && approval?.authorizedBy === 'project owner'
    && approval?.authorizedOn === '2026-10-21'
    && approval?.observationDefaultEnabled === true && approval?.emergencyStopDefaultEnabled === true && approval?.channel === 'beta'
    && approval?.optIn === true && approval?.piSoakRequiredBeforeBetaPublication === false && optionalFoundation;
  const readiness = record.stableReadiness;
  const fieldObservedStable = !allowBeta && record.status === 'field-observed' && pkg.version === '4.1.1'
    && readiness?.version === pkg.version && readiness?.reviewedBy === 'project owner'
    && readiness?.reviewedOn === '2026-10-21' && readiness?.channel === 'stable'
    && readiness?.fieldInstallationOperational === true && readiness?.resourceBudgetsClaimed === false
    && readiness?.automaticSolarPlanningEnabled === false && optionalFoundation;
  return { allowed: Boolean(approvedBeta || fieldObservedStable), hardwareQualified: false };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const files = ['index.js', 'config.schema.json', 'package.json',
    ...fs.readdirSync(path.join(root, 'lib')).filter(n => n.endsWith('.js')).map(n => `lib/${n}`),
    ...fs.readdirSync(path.join(root, 'homebridge-ui/public')).filter(n => /\.(?:html|js)$/.test(n)).map(n => `homebridge-ui/public/${n}`)].sort();
  const digest = crypto.createHash('sha256');
  for (const file of files) { digest.update(file + '\0'); digest.update(fs.readFileSync(path.join(root, file))); }
  const runtimeSha256 = digest.digest('hex');
  if (process.argv.includes('--runtime-hash')) { console.log(runtimeSha256); return; }
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const pkg = read('package.json');
  const decision = publicationDecision({ record: read('docs/maintainer/OBSERVATION_QUALIFICATION.json'), pkg,
    schema: read('config.schema.json'), foundation: require('../lib/solar-observation').emptyModel({}), runtimeSha256 },
  process.argv.includes('--beta-publication'));
  if (!decision.allowed) {
    console.error('BLOCKED: matching hardware qualification, the recorded beta exception or matching field-observed stable readiness is required.');
    console.error(`Runtime SHA-256: ${runtimeSha256}`); process.exitCode = 1; return;
  }
  console.log(decision.hardwareQualified ? 'PASS matched 72-hour Pi qualification record.'
    : pkg.version === '4.1.1'
      ? 'PASS field-observed 4.1.1 stable readiness; formal paired resource budgets are not claimed.'
      : 'PASS owner-authorised beta.10 publication; formal resource budgets remain unmeasured.');
}

module.exports = { publicationDecision };
if (require.main === module) main();
