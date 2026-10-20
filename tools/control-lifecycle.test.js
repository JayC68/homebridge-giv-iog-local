'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { fixture } = require('./control-test-fixture');
const { controlProfile, inWindow } = require('../lib/control-state');
const { GivHomeModbusPlatform: P } = require('../index');
let connections = 0;
require('net').Socket.prototype.connect = function () { connections++; throw new Error('Tests prohibit real networking'); };
test.after(() => assert.equal(connections, 0));

for (const serial of ['CH2344G083', 'CE2225G298', 'ED2151G182']) {
  test(`${serial}: idle preserves armed future controls and queued cleanup`, async t => {
    const { p, registers, writes, restart } = fixture(t, { serial, state: { 96: 1, 94: 2330, 95: 530, 59: 1, 56: 1800, 57: 1900 } });
    const before = { ...registers }; const timer = setTimeout(() => {}, 100000); timer.unref(); p.applianceCommandTimers.set('future', timer);
    const result = await p.requestEmergencyStop();
    assert.equal(result.idle, true); assert.deepEqual(writes, []); assert.deepEqual(registers, before);
    assert.equal(p.applianceCommandTimers.size, 1); assert.equal(p.emergencyHeld(), false); assert.equal(restart().emergencyHeld(), false);
  });
  for (const slot of controlProfile(serial).slots) test(`${serial}: stop ${slot.family} ${slot.id} retires only this occurrence and admits a new command`, async t => {
    const { p, registers } = fixture(t, { serial, state: { [slot.enable]: 1, [slot.pair[0]]: 800, [slot.pair[1]]: 1000 } });
    await p.requestEmergencyStop();
    assert.equal(p.emergencyHeld(), false); assert.equal(registers[slot.pair[0]], 0); assert.equal(registers[slot.pair[1]], 0);
    if (slot.family === 'charge') await p.startTimedChargeCommand({ displayName: 'Charge 30m', kind: 'charge30', minutes: 30 });
    else await p.startTimedExportCommand({ displayName: 'Export 30m', kind: 'export30', minutes: 30 });
    assert.ok(p.currentControlOwner(slot.family));
  });
  test(`${serial}: ordinary charge cleanup restores future namespace eligibility`, async t => {
    const { p, registers, writes } = fixture(t, { serial, state: { 96: 1, 94: 1800, 95: 1900, 31: 2000, 32: 2100 } });
    const before = { ...registers };
    await p.startTimedChargeCommand({ displayName: 'Charge 30m', kind: 'charge30', minutes: 30 });
    await p.cleanupApplianceCommandFamily('charge', 'finished');
    assert.deepEqual(registers, before); assert.equal(registers[96], 1); assert.equal(writes.some(([r]) => r === 242), false);
  });
  test(`${serial}: expiry restores a recurring core slot for tomorrow`, async t => {
    const { p, registers } = fixture(t, { serial, state: { 96: 1, 94: 800, 95: 1000 } });
    await p.requestEmergencyStop(); assert.equal(registers[94], 0);
    t.mock.timers.tick(91 * 60000); await p.restoreDeferredControlWindows();
    assert.equal(registers[94], 800); assert.equal(registers[95], 1000); assert.equal(registers[96], 1);
  });
  test(`${serial}: start refusal and unrelated Off never disable the current owner`, async t => {
    const { p, registers, writes } = fixture(t, { serial, state: { 96: 1, 94: 800, 95: 1000, 59: 1, 56: 800, 57: 1000 } });
    await p.handleApplianceCommandSet('charge30', true); await p.handleApplianceCommandSet('export30', true);
    await p.handleApplianceCommandSet('charge30', false); await p.handleApplianceCommandSet('export30', false);
    assert.deepEqual(writes, []); assert.equal(registers[96], 1); assert.equal(registers[59], 1);
  });
}

test('future pause window is not mistaken for a current action', async t => {
  const { p, registers, writes } = fixture(t, { state: { 318: 2, 319: 1800, 320: 1900 } });
  await p.requestEmergencyStop(); assert.deepEqual(writes, []); assert.equal(registers[318], 2); assert.equal(p.emergencyHeld(), false);
});
test('active timed pause is stopped and restored for its next occurrence', async t => {
  const { p, registers } = fixture(t, { state: { 318: 2, 319: 800, 320: 1000 } });
  await p.requestEmergencyStop(); assert.equal(registers[318], 0); assert.equal(p.emergencyHeld(), false);
  t.mock.timers.tick(91 * 60000); await p.restoreDeferredControlWindows(); assert.equal(registers[318], 2);
});
test('two-slot mode-only pause does not require unsupported timing words', async t => {
  const { p, registers, reads } = fixture(t, { serial: 'CE2225G298', state: { 318: 2 } });
  await p.requestEmergencyStop(); assert.equal(registers[318], 0);
  assert.equal(reads.some(({ r, n }) => r <= 319 && r + n > 319), false);
});
test('new user command survives old cleanup token and old expiry', async t => {
  const { p, registers } = fixture(t);
  await p.startTimedChargeCommand({ displayName: 'Charge 30m', kind: 'charge30', minutes: 30 });
  const old = p.currentControlOwner('charge').id;
  p.scheduleApplianceCommandCleanup('charge30', 'charge', 30);
  await p.requestEmergencyStop();
  await p.startTimedChargeCommand({ displayName: 'Charge 2h', kind: 'charge120', minutes: 120 });
  const current = p.currentControlOwner('charge').id;
  await p.cleanupApplianceCommandFamily('charge', 'old timer fired', old);
  assert.equal(p.currentControlOwner('charge').id, current); assert.equal(registers[96], 1);
});
test('stale owner cleanup preserves external-controller changes', async t => {
  const { p, registers, writes } = fixture(t);
  await p.startTimedChargeCommand({ displayName: 'Charge 30m', kind: 'charge30', minutes: 30 });
  registers[94] = 900; registers[95] = 1100;
  const count = writes.length; const result = await p.cleanupApplianceCommandFamily('charge', 'old ended');
  assert.equal(result.superseded, true); assert.equal(writes.length, count); assert.equal(registers[94], 900);
});
test('lost stop-write acknowledgement is reconciled once after restart', async t => {
  const f = fixture(t, { state: { 96: 1, 261: 800, 262: 1000, 94: 1800, 95: 1900 } });
  const write = f.p.writeDirectRegister; let lost = false;
  f.p.writeDirectRegister = async (...args) => { await write(...args); if (!lost) { lost = true; throw new Error('lost ack'); } };
  await assert.rejects(f.p.requestEmergencyStop(), /lost ack/); assert.equal(f.p.emergencyHeld(), true);
  const restarted = f.restart(); await restarted.recoverEmergencyStopIfNeeded();
  assert.equal(restarted.emergencyHeld(), false); assert.equal(f.writes.filter(([r, v]) => r === 96 && v === 0).length, 1);
  assert.equal(f.registers[94], 1800); assert.equal(f.registers[261], 0);
});
test('lost final stop read retries without repeating any writes', async t => {
  const f = fixture(t, { state: { 96: 1, 261: 800, 262: 1000 } }); const read = f.p.readHoldingRegisters; let lost = false;
  f.p.readHoldingRegisters = async (r, n, label) => { if (!lost && label.startsWith('Emergency Stop final verification')) { lost = true; throw new Error('final receive timeout'); } return read(r, n, label); };
  await assert.rejects(f.p.requestEmergencyStop(), /final receive/); const count = f.writes.length;
  f.p.readHoldingRegisters = read; t.mock.timers.setTime(f.p.emergencyRetryAtMs + 1); await f.p.recoverEmergencyStopIfNeeded();
  assert.equal(f.p.emergencyHeld(), false); assert.equal(f.writes.length, count);
});
test('partial normal cleanup retains its journal and recovers after restart', async t => {
  const f = fixture(t, { state: { 96: 1, 94: 1800, 95: 1900 } });
  await f.p.startTimedChargeCommand({ displayName: 'Charge 30m', kind: 'charge30', minutes: 30 });
  const write = f.p.writeDirectRegister; let lost = false;
  f.p.writeDirectRegister = async (...args) => { await write(...args); if (!lost) { lost = true; throw new Error('cleanup ack lost'); } };
  await assert.rejects(f.p.cleanupApplianceCommandFamily('charge', 'off'), /ack lost/);
  const p = f.restart(); await p.recoverControlLifecycle();
  assert.equal(p.currentControlOwner('charge'), null); assert.equal(f.registers[94], 1800); assert.equal(f.registers[96], 1);
});
test('clock mismatch fails before all writes and remains a retryable fault', async t => {
  const { p, writes } = fixture(t, { clockOffset: 3600000, state: { 96: 1, 94: 800, 95: 1000 } });
  await assert.rejects(p.requestEmergencyStop(), /clock/); assert.deepEqual(writes, []); assert.equal(p.emergencyHeld(), true);
});
test('unreachable inverter is not treated as idle and retry clears only after readback', async t => {
  const f = fixture(t); const read = f.p.readHoldingRegisters;
  f.p.readHoldingRegisters = async () => { throw new Error('unreachable'); };
  await assert.rejects(f.p.requestEmergencyStop(), /unreachable/); assert.equal(f.p.emergencyHeld(), true);
  f.p.readHoldingRegisters = read; t.mock.timers.setTime(f.p.emergencyRetryAtMs + 1); await f.p.recoverEmergencyStopIfNeeded();
  assert.equal(f.p.emergencyHeld(), false); assert.deepEqual(f.writes, []);
});

for (const serial of ['CH2344G083', 'CE2225G298', 'ED2151G182']) {
  for (const fault of ['before', 'after', 'lying']) for (let at = 1; at <= 6; at++) {
    test(`${serial}: ${fault} write fault ${at} recovers without duplicate mutation`, async t => {
      const f = fixture(t, { serial, state: { 96: 1, 94: 800, 95: 1000, 31: 1800, 32: 1900, 27: 0 } });
      const write = f.p.writeDirectRegister; let calls = 0, injected = false;
      f.p.writeDirectRegister = async (...args) => {
        if (++calls !== at) return write(...args);
        injected = true;
        if (fault === 'before') throw new Error('injected before write');
        if (fault === 'after') { await write(...args); throw new Error('injected lost ack'); }
        // A successful transport response without changing the register.
      };
      try { await f.p.requestEmergencyStop(); } catch (err) { assert.match(err.message, /injected|readback mismatch/); }
      const p = f.restart(); await p.recoverEmergencyStopIfNeeded();
      assert.equal(p.emergencyHeld(), false); assert.equal(f.registers[94], 0); assert.equal(f.registers[95], 0);
      assert.equal(f.registers[31], 1800); assert.equal(f.registers[32], 1900); assert.equal(f.registers[96], 1); assert.equal(f.registers[27], 1);
      if (injected && fault === 'after') assert.equal(f.writes.filter(([r,v]) => r === 94 && v === 0).length, 1);
    });
  }
  test(`${serial}: every stop read position survives a one-time receive failure`, async t => {
    const reference = fixture(t, { serial, state: { 96: 1, 94: 800, 95: 1000, 27: 0 } });
    await reference.p.requestEmergencyStop(); const count = reference.reads.length;
    for (let at = 1; at <= count; at++) {
      const f = fixture(t, { serial, now: null, state: { 96: 1, 94: 800, 95: 1000, 27: 0 } });
      const read = f.p.readHoldingRegisters; let calls = 0;
      f.p.readHoldingRegisters = async (...args) => { if (++calls === at) throw new Error('injected read timeout'); return read(...args); };
      await assert.rejects(f.p.requestEmergencyStop(), /injected read timeout/);
      assert.equal(f.p.emergencyHeld(), true);
      const p = f.restart(); await p.recoverEmergencyStopIfNeeded();
      assert.equal(p.emergencyHeld(), false, `read position ${at}`); assert.equal(f.registers[94], 0); assert.equal(f.registers[96], 1);
    }
  });
  test(`${serial}: ordinary export cleanup preserves a future slot and namespace`, async t => {
    const f = fixture(t, { serial, state: { 59: 1, 56: 1800, 57: 1900, 44: 2000, 45: 2100 } });
    await f.p.startTimedExportCommand({ displayName: 'Export 30m', kind: 'export30', minutes: 30 });
    await f.p.cleanupApplianceCommandFamily('export', 'finished');
    assert.equal(f.registers[59], 1); assert.equal(f.registers[56], 1800); assert.equal(f.registers[57], 1900);
    assert.equal(f.registers[44], 2000); assert.equal(f.registers[45], 2100);
  });
}
test('legacy verified stop reconciles immediately instead of holding until an unrelated deadline', async t => {
  const f = fixture(t, { state: { 96: 0, 261: 0, 262: 0, 94: 1800, 95: 1900 } });
  f.p.emergencyState = { identity: f.p.chargeTargetIdentity, status: 'verified', requestedAt: new Date().toISOString(), untilMs: Date.now()+7200000,
    initialRegisters: { ...f.registers, 96: 1, 261: 800, 262: 1000 }, implicated: [{ family: 'charge', id: 8, times: [800, 1000] }] };
  await f.p.recoverEmergencyStopIfNeeded(); assert.equal(f.p.emergencyHeld(), false); assert.equal(f.registers[96], 1); assert.equal(f.registers[94], 1800);
});
test('legacy recovery refuses a later changed action', async t => {
  const f = fixture(t, { state: { 96: 1, 261: 815, 262: 1100 } });
  f.p.emergencyState = { identity: f.p.chargeTargetIdentity, status: 'failed', requestedAt: new Date().toISOString(), initialRegisters: { ...f.registers, 261: 800, 262: 1000 }, implicated: [{ family: 'charge', id: 8 }] };
  await f.p.recoverEmergencyStopIfNeeded(); assert.equal(f.p.emergencyHeld(), true); assert.deepEqual(f.writes, []);
});
test('old export metadata cannot retain a dead two-hour logical claim or cancel physical settings', async t => {
  const f = fixture(t, { state: { 59: 1, 291: 800, 292: 1000 } });
  f.p.activeOctopusFluxExportSlot = { start: new Date(), end: new Date(Date.now()+7200000) };
  await f.p.reconcileLegacyControlMemories(); assert.equal(f.p.activeOctopusFluxExportSlot, null); assert.deepEqual(f.writes, []);
  assert.ok(f.p.controlLedger.legacyExportEvidence); assert.equal(f.registers[291], 800);
});
test('deferred restore waits for a newer owned action and preserves externally replaced schedules', async t => {
  const f = fixture(t, { state: { 96: 1, 94: 800, 95: 900 } });
  await f.p.requestEmergencyStop(); await f.p.startTimedChargeCommand({ displayName: 'Charge 2h', kind: 'charge120', minutes: 120 });
  t.mock.timers.tick(31*60000); const count = f.writes.length; await f.p.restoreDeferredControlWindows(); assert.equal(f.writes.length, count);
  await f.p.cleanupApplianceCommandFamily('charge', 'finished'); f.registers[94]=1400; f.registers[95]=1500;
  await f.p.restoreDeferredControlWindows(); assert.equal(f.registers[94], 1400); assert.equal(f.p.controlLedger.deferred.length, 0);
});
test('cancelled occurrence does not suppress tomorrow or a later IOG dispatch', async t => {
  const { p } = fixture(t); p.currentCheapStateForStatusTiles = () => ({ fallbackWindowEnd: new Date('2026-10-19T05:30:00+01:00'), activeDispatchStart: new Date('2026-10-18T08:00:00+01:00'), protectedEnd: new Date('2026-10-18T09:00:00+01:00') });
  p.rememberStoppedOccurrence(p.controlOccurrence('Cheap Overnight')); p.rememberStoppedOccurrence(p.controlOccurrence('Intelligent Octopus Go Home Battery Protection'));
  assert.equal(p.occurrenceStopped('Cheap Overnight'), true); assert.equal(p.occurrenceStopped('Intelligent Octopus Go Home Battery Protection'), true);
  p.currentCheapStateForStatusTiles = () => ({ fallbackWindowEnd: new Date('2026-10-20T05:30:00+01:00'), activeDispatchStart: new Date('2026-10-18T09:30:00+01:00'), protectedEnd: new Date('2026-10-18T10:00:00+01:00') });
  assert.equal(p.occurrenceStopped('Cheap Overnight'), false); assert.equal(p.occurrenceStopped('Intelligent Octopus Go Home Battery Protection'), false);
});
test('durable journal corruption prevents writes and preserves the evidence', async t => {
  const f = fixture(t); fs.writeFileSync(f.p.controlLedgerFile, '{broken'); const p = f.restart();
  await assert.rejects(p.requestEmergencyStop(), /journal/); assert.deepEqual(f.writes, []); assert.equal(fs.readFileSync(p.controlLedgerFile, 'utf8'), '{broken');
});
test('invalid recurring register addresses are rejected on restart', async t => {
  const f = fixture(t); f.p.controlLedger.deferred.push({ id: 'bad', family: 'charge', slotId: 1, pair: [242], times: [100], dueAtMs: 0 });
  f.p.saveControlLedger(); const p = f.restart(); assert.ok(p.controlStorageFault); await assert.rejects(p.requestEmergencyStop()); assert.deepEqual(f.writes, []);
});
for (const date of ['2026-10-18T23:45:00+01:00', '2026-10-25T01:30:00+01:00', '2026-10-25T01:30:00Z']) test(`cross-midnight schedule and DST stop ${date}`, async t => {
  const f = fixture(t, { now: date, state: { 96: 1, 94: 2330, 95: 530 } });
  await f.p.requestEmergencyStop(); assert.equal(f.p.emergencyHeld(), false); assert.equal(f.registers[94], 0);
  t.mock.timers.setTime(new Date(date).getTime()+8*3600000); await f.p.restoreDeferredControlWindows(); assert.equal(f.registers[94], 2330); assert.equal(f.registers[96], 1);
});

for (const serial of ['CH2344G083', 'CE2225G298', 'ED2151G182']) test(`${serial}: evening external stop cannot prevent tonight's Cheap Overnight`, async t => {
  const f = fixture(t, { serial, now: '2026-10-18T20:51:00+01:00', state: { 96: 1, 261: 2051, 262: 2251, 94: 2051, 95: 2251 } });
  // Only the route supported by each profile is relevant to its control bank.
  await f.p.requestEmergencyStop(); assert.equal(f.p.emergencyHeld(), false);
  t.mock.timers.setTime(new Date('2026-10-18T23:31:00+01:00').getTime());
  await f.p.applyApplianceAutomation();
  assert.equal(f.p.autoChargeLabel, 'Cheap Overnight'); assert.equal(f.registers[96], 1); assert.equal(f.registers[116], 100);
});
for (const serial of ['CH2344G083', 'CE2225G298', 'ED2151G182']) test(`${serial}: cancelled overnight does not restart under IOG label; later handover works`, async t => {
  const f = fixture(t, { serial, now: '2026-10-19T05:00:00+01:00' });
  f.p.applianceControl.features.homeBatteryProtectionDuringSmartSlots = true;
  f.p.octopusState.dispatches = [{ start: new Date('2026-10-19T04:30:00+01:00'), end: new Date('2026-10-19T06:30:00+01:00') }];
  await f.p.applyApplianceAutomation(); assert.equal(f.p.autoChargeLabel, 'Cheap Overnight');
  await f.p.requestEmergencyStop(); const count = f.writes.length;
  await f.p.applyApplianceAutomation(); assert.equal(f.writes.length, count); assert.equal(f.p.currentControlOwner('charge'), null);
  t.mock.timers.setTime(new Date('2026-10-19T05:31:00+01:00').getTime()); await f.p.applyApplianceAutomation();
  assert.equal(f.p.autoChargeLabel, 'Intelligent Octopus Go Home Battery Protection'); assert.equal(f.registers[96], 1);
});
test('queued pre-stop intent is cancelled; a deliberate post-stop intent is admitted', async t => {
  const { p } = fixture(t); let release; p.commandQueueTail = new Promise(resolve => { release = resolve; });
  const old = P.prototype.withManualChargeTransportGate.call(p, 'old command', async () => assert.fail('old intent ran'));
  p.emergencyGeneration++; p.emergencyState = { version: 2, status: 'verified', untilMs: 0 }; release();
  await assert.rejects(old, /cancelled/); let ran = false;
  await P.prototype.withManualChargeTransportGate.call(p, 'new command', async () => { ran = true; }); assert.equal(ran, true);
});
test('both production write paths enforce an unresolved stop before network access', async t => {
  const { p } = fixture(t); p.emergencyState = { status: 'failed' };
  await assert.rejects(P.prototype.writeManualChargeRegister.call(p, 96, 1, 'start'), /held/);
  await assert.rejects(P.prototype.writeDirectRegister.call(p, 96, 1, 'Emergency Stop fake'), /held/);
});
for (const state of [{ 27: undefined }, { 59: 2 }, { 94: 2360 }, { 318: 7 }, { 94: 130, 95: 130 }]) test(`invalid readback sends no stop writes ${JSON.stringify(state)}`, async t => {
  const f = fixture(t, { state }); await assert.rejects(f.p.requestEmergencyStop()); assert.deepEqual(f.writes, []);
});
test('unknown outcome during cleanup retains evidence and never overwrites external changes', async t => {
  const f = fixture(t); await f.p.startTimedChargeCommand({ displayName: 'Charge 30m', kind: 'charge30', minutes: 30 });
  const write = f.p.writeDirectRegister;
  f.p.writeDirectRegister = async (...args) => { await write(...args); f.registers[94] = 1400; throw new Error('external intervention'); };
  await assert.rejects(f.p.cleanupApplianceCommandFamily('charge', 'off'));
  const count = f.writes.length, p = f.restart(); await p.recoverControlLifecycle();
  assert.equal(f.writes.length, count); assert.equal(f.registers[94], 1400); assert.ok(p.currentControlOwner('charge'));
});
test('explicit pause Off returns Eco and suppresses only the current IOG occurrence, including extension', async t => {
  const f = fixture(t, { now: '2026-10-18T13:00:00+01:00' });
  f.p.applianceControl.features.cheapOvernightCharging = false; f.p.applianceControl.features.homeBatteryProtectionDuringSmartSlots = true;
  f.p.applianceControl.iogHomeBatteryProtectionMode = 'pauseDischarge'; f.p.applianceControl.iogHomeBatteryProtectionPauseValue = 2;
  f.p.octopusState.dispatches = [{ start: new Date('2026-10-18T12:30:00+01:00'), end: new Date('2026-10-18T14:00:00+01:00') }];
  await f.p.applyApplianceAutomation(); assert.equal(f.registers[318], 2);
  await f.p.handleApplianceCommandSet('pauseDischarge', false); assert.equal(f.registers[318], 0);
  const count = f.writes.length; f.p.octopusState.dispatches[0].end = new Date('2026-10-18T14:30:00+01:00');
  await f.p.applyApplianceAutomation(); assert.equal(f.writes.length, count);
  t.mock.timers.setTime(new Date('2026-10-18T15:00:00+01:00').getTime());
  f.p.octopusState.dispatches = [{ start: new Date('2026-10-18T15:00:00+01:00'), end: new Date('2026-10-18T16:00:00+01:00') }];
  await f.p.applyApplianceAutomation(); assert.equal(f.registers[318], 2);
});

test('simultaneous current charge, export and pause stop preserves unrelated future schedules', async t => {
  const f = fixture(t, { state: { 96: 1, 94: 800, 95: 1000, 59: 1, 291: 800, 292: 1000, 31: 1800, 32: 1900, 44: 2000, 45: 2100, 318: 3 } });
  await f.p.requestEmergencyStop(); assert.equal(f.registers[94], 0); assert.equal(f.registers[291], 0); assert.equal(f.registers[318], 0);
  assert.equal(f.registers[31], 1800); assert.equal(f.registers[44], 2000); assert.equal(f.registers[96], 1); assert.equal(f.registers[59], 1);
  assert.equal(f.p.emergencyHeld(), false);
});
test('failed durable stop acceptance sends no reads or writes', async t => {
  const f = fixture(t); f.p.emergencyStateFile = require('path').join(f.directory, 'missing', 'record.json');
  await assert.rejects(f.p.requestEmergencyStop()); assert.deepEqual(f.writes, []); assert.deepEqual(f.reads, []);
});
test('malformed saved stop transaction fails before any mutation', async t => {
  const f = fixture(t); fs.writeFileSync(f.p.emergencyStateFile, JSON.stringify({ version: 2, identity: f.p.chargeTargetIdentity, status: 'failed', requestedAt: new Date().toISOString(), transaction: { writes: [[96, 0]], working: { 96: 1 } } }));
  const p = f.restart(); assert.equal(p.emergencyHeld(), true); await p.recoverEmergencyStopIfNeeded(); assert.deepEqual(f.writes, []);
});
for (const serial of ['CH2344G083', 'CE2225G298', 'ED2151G182']) test(`${serial}: safeguard cannot disable active slot 2 or a new command queued before it`, async t => {
  const f = fixture(t, { serial, state: { 96: 1, 94: 600, 95: 700, 31: 800, 32: 1000 } });
  await f.p.runManualChargeExpiredSlotSupervisorOnce('test'); assert.deepEqual(f.writes, []);
  f.registers[31] = 0; f.registers[32] = 0;
  await f.p.startTimedChargeCommand({ displayName: 'Charge 30m', kind: 'charge30', minutes: 30 });
  const owner = f.p.currentControlOwner('charge'); owner.endAtMs = Date.now()-7200000;
  f.registers[94] = 600; f.registers[95] = 700; owner.expected[94] = 600; owner.expected[95] = 700;
  const gate = f.p.withManualChargeTransportGate; f.p.withManualChargeTransportGate = async (label, fn) => {
    owner.id = 'new-command'; f.registers[31] = 800; f.registers[32] = 1000; return gate(label, fn);
  };
  const count = f.writes.length; await f.p.runManualChargeExpiredSlotSupervisorOnce('queue-race'); assert.equal(f.writes.length, count); assert.equal(f.registers[96], 1);
});
test('bounded cancellation journal rejects overflow without evicting unresolved evidence', t => {
  const { p } = fixture(t);
  for (let i=0; i<256; i++) p.rememberStoppedOccurrence({ source: 'test', key: String(i), untilMs: Date.now()+86400000 });
  assert.throws(() => p.rememberStoppedOccurrence({ source: 'test', key: 'overflow', untilMs: Date.now()+86400000 }), /full/);
  assert.equal(p.controlLedger.stopped.length, 256); assert.ok(fs.statSync(p.controlLedgerFile).size < 524288);
});
test('saved CE pause ownership still requires mode readback when the tile is removed', async t => {
  const f = fixture(t, { serial: 'CE2225G298' });
  await f.p.startManualPauseCommand({ displayName: 'Pause Dis', kind: 'pauseDischarge', pauseValue: 2 });
  f.p.applianceControl.features.pauseTiles = false; f.p.applianceControl.features.homeBatteryProtectionDuringSmartSlots = false;
  f.p.initialiseBetaControls(); assert.equal(f.p.controlProfile.pause, true);
  await f.p.requestEmergencyStop(); assert.equal(f.registers[318], 0); assert.equal(f.p.currentControlOwner('pause'), null);
});
test('CE charge and pause acquisition retain the explicit live-write acknowledgement', async t => {
  const f = fixture(t, { serial: 'CE2225G298' }); f.p.applianceControl.features.ceAcCoupledLiveWrites = false;
  await assert.rejects(f.p.startTimedChargeCommand({ minutes: 30 }), /acknowledgement/);
  await assert.rejects(f.p.startManualPauseCommand({ displayName: 'Pause Dis', pauseValue: 2 }), /acknowledgement/);
  assert.deepEqual(f.writes, []);
});
for (const family of ['charge', 'export']) for (const fault of ['before', 'after']) for (let at=1; at<=7; at++) test(`armed future ${family}: interrupted start ${fault} write ${at} restores eligibility`, async t => {
  const f = fixture(t, { state: { 96: 1, 94: 1800, 95: 1900, 31: 2000, 32: 2100, 59: 1, 56: 1800, 57: 1900, 44: 2000, 45: 2100 } });
  const original = { ...f.registers }, write = f.p.writeDirectRegister; let calls=0;
  f.p.writeDirectRegister = async (...args) => { if (++calls !== at) return write(...args); if (fault==='after') await write(...args); throw new Error('start communication loss'); };
  try { if (family==='charge') await f.p.startTimedChargeCommand({ displayName:'Charge 30m', kind:'charge30', minutes:30 }); else await f.p.startTimedExportCommand({ displayName:'Export 30m', kind:'export30', minutes:30 }); }
  catch (err) { assert.match(err.message,/start communication loss/); }
  f.p.writeDirectRegister=write; await f.p.cleanupApplianceCommandFamily(family,'interrupted start');
  assert.deepEqual(f.registers, original); assert.equal(f.p.currentControlOwner(family),null);
  assert.equal(f.writes[0][0], family==='charge'?96:59); assert.equal(f.writes[0][1],0);
});

test('Emergency Stop accepts an omitted exposure setting but explicit false refuses without writes', async t => {
  const enabled = fixture(t); delete enabled.p.config.enableEmergencyStopTile;
  await enabled.p.acceptEmergencyStopRequest();
  assert.equal(enabled.p.emergencyState.status, 'released');
  assert.equal(enabled.writes.length, 0, 'default exposure does not change an idle inverter');
  const disabled = fixture(t, { now: null, config: { enableEmergencyStopTile: false } });
  disabled.p.config.enableEmergencyStopTile = false;
  assert.throws(() => disabled.p.acceptEmergencyStopRequest(), /not enabled/);
  assert.equal(disabled.writes.length, 0);
});
