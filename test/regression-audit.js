'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(root, 'config.schema.json'), 'utf8'));

function section(start, end) {
  const a = source.indexOf(start);
  assert(a >= 0, `missing section start: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert(b >= 0, `missing section end: ${end}`);
  return source.slice(a, b);
}

assert.strictEqual(pkg.version, '3.7.5');
assert(source.includes("const BUILD_VERSION = '3.7.5';"));

const timed = section('  buildTimedSlotSteps(', '  buildNeutralizeSlotSteps(');
assert(timed.includes("if (this.isCeAcCoupledSystem())"), 'CE boundary missing');
assert(timed.includes("customAction: 'rememberCeChargeSlot'"), 'CE remember action missing');
assert(timed.includes("...(this.isCeAcCoupledSystem() ? { failCleanupKind: 'charge' } : {})"), 'failed-start cleanup is not CE-scoped');
assert(!timed.includes("failCleanupKind: 'discharge'"), 'CH/shared discharge lifecycle was modified');

const remember = section('  async rememberCeChargeSlotBeforeWrite(', '  buildCeChargeReinstateSteps(');
assert(remember.includes('telemetry.safeForAutomation'), 'CE pre-state is not freshness-gated');
assert(remember.includes('telemetry.hasSourceTimestamp'), 'CE pre-state does not require Last_Updated_Time');
assert(remember.includes('existing remembered slot retained'), 'restart-safe CE memory missing');

const recovery = section('  async maybeRecoverStaleGivTcp(', '  getTelemetryStatusBrightness(');
assert(recovery.includes("status.state !== 'offline'"), 'recovery does not require offline state');
assert(recovery.includes('status.hasSourceTimestamp'), 'recovery does not require Last_Updated_Time');
assert(recovery.includes('givTcpRecoveryCooldownSeconds'), 'recovery cooldown missing');
assert(recovery.includes('sourceTimestampMs > this.givTcpRecoveryLastSourceTimestampMs'), 'fresh timestamp advancement check missing');
assert(!recovery.includes('postRestControl('), 'recovery path must not send inverter writes');
assert(source.includes("execFile('/usr/bin/sudo', ['-n', this.givTcpRecoveryCommand]"), 'narrow non-interactive sudo execution missing');
assert(source.includes('this.enableGivTcpSelfRecovery = Boolean(this.config.enableGivTcpSelfRecovery);'), 'self-recovery must remain opt-in');

const props = schema.schema.properties;
assert.strictEqual(props.enableGivTcpSelfRecovery.default, false);
assert(props.givTcpRecoveryStaleSeconds.minimum >= 600);
assert(props.givTcpRecoveryCooldownSeconds.minimum >= 1800);

console.log('PASS: version hygiene');
console.log('PASS: CH/AIO command lifecycle protected');
console.log('PASS: CE single-slot behaviour isolated and freshness-gated');
console.log('PASS: GivTCP recovery is opt-in, write-free and cooldown-protected');
