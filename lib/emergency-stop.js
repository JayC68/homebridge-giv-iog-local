'use strict';

const { inferChargeTargetProfile } = require('./charge-target-reconciliation');
const { CH_AIO_SLOT_MAP, REGISTER_AUTHORITY } = require('./register-authority');

function timeValid(value) {
  return Number.isInteger(value) && value >= 0 && value <= 2359 && value % 100 < 60;
}
function activeSlot(start, end, now) {
  if (!timeValid(start) || !timeValid(end)) throw new Error('invalid or incomplete schedule readback');
  if (start === end) {
    if (start !== 0) throw new Error('equal non-zero schedule times are ambiguous');
    return false;
  }
  const minute = now.getHours() * 60 + now.getMinutes();
  const a = Math.floor(start / 100) * 60 + start % 100;
  const b = Math.floor(end / 100) * 60 + end % 100;
  return a < b ? minute >= a && minute < b : minute >= a || minute < b;
}
function slotEnd(end, now) {
  const date = new Date(now);
  date.setHours(Math.floor(end / 100), end % 100, 0, 0);
  if (date <= now) date.setDate(date.getDate() + 1);
  return date.getTime();
}

function emergencyProfile(serial) {
  const profile = inferChargeTargetProfile({ serial }).profile;
  if (profile === 'unsupported-or-read-only') throw new Error('Emergency Stop: unsupported inverter profile; no writes sent');
  const slots = [];
  for (const family of ['charge', 'export']) {
    const map = CH_AIO_SLOT_MAP[family].slots;
    // Older single-phase profiles have two core slots, not the CH ten-slot bank.
    for (const [id, registers] of Object.entries(map)) {
      if (profile !== 'ch-aio' && Number(id) > 2) continue;
      const pair = registers.slice(0, 2).map(r => Number(r.slice(2)));
      slots.push({ family, id: Number(id), pair, clearAllowed: pair.every(r => REGISTER_AUTHORITY[`HR${r}`]?.authority === 'validated') });
    }
  }
  return { profile, slots, pause: profile === 'ch-aio' };
}

async function readEmergencySnapshot(read, profile, phase = 'snapshot') {
  const result = {};
  const addresses = [27, 59, 96, ...profile.slots.flatMap(s => s.pair), ...(profile.pause ? [318] : [])];
  const groups = [];
  for (const address of [...new Set(addresses)].sort((a,b)=>a-b)) {
    const previous = groups[groups.length-1];
    if (previous && previous[0]+previous.length===address) previous.push(address);
    else groups.push([address]);
  }
  // Read adjacent required words together; never expand into optional registers.
  for (const group of groups) {
    const address = group[0];
    let values;
    try { values = await read(address, group.length, `Emergency Stop ${phase} HR${address}`); }
    catch (err) { throw new Error(`Emergency Stop ${phase} HR${address} read failed: ${err.message}`, { cause: err }); }
    if (!Array.isArray(values) || values.length !== group.length || !values.every(Number.isInteger)) throw new Error(`Emergency Stop: incomplete HR${address} readback`);
    group.forEach((r,i)=>{result[r]=values[i];});
  }
  for (const address of [27, 59, 96]) if (![0, 1].includes(result[address])) throw new Error(`Emergency Stop: invalid HR${address} readback`);
  if (profile.pause && ![0, 1, 2, 3].includes(result[318])) throw new Error('Emergency Stop: invalid pause readback');
  for (const slot of profile.slots) activeSlot(result[slot.pair[0]], result[slot.pair[1]], new Date());
  return result;
}

function recoveryPlan(profile, record, before, now = new Date()) {
  const requestedAt = new Date(record.requestedAt);
  if (!Number.isFinite(requestedAt.getTime()) || requestedAt > now) throw new Error('Emergency Stop: recovery request time is invalid');
  let original = record.recoveryRegisters || record.initialRegisters;
  const implicated = [...(record.implicated || [])];
  const currentlyActive = profile.slots.filter(slot => before[slot.family === 'charge' ? 96 : 59] === 1
    && activeSlot(before[slot.pair[0]], before[slot.pair[1]], now));
  if (!original && !implicated.length && currentlyActive.length && now - requestedAt < 86400000
    && currentlyActive.every(slot => activeSlot(before[slot.pair[0]], before[slot.pair[1]], requestedAt)
      && slotEnd(before[slot.pair[1]], requestedAt) > now.getTime())) {
    // A lost first read need not abandon a still-running original occurrence.
    // Later windows and the following day's repeated HHMM window do not qualify.
    original = before;
  }
  // Old beta records may predate explicit recovery plans. Reconstruct only from
  // their saved pre-write evidence, never from whatever new action is running now.
  if (original) for (const slot of profile.slots) {
    if (original[slot.family === 'charge' ? 96 : 59] === 1
      && activeSlot(original[slot.pair[0]], original[slot.pair[1]], requestedAt)
      && !implicated.some(s => s.family === slot.family && s.id === slot.id)) {
      implicated.push({ family: slot.family, id: slot.id, times: slot.pair.map(r => original[r]) });
    }
  }
  for (const prior of implicated) {
    const slot = profile.slots.find(s => s.family === prior.family && s.id === prior.id);
    if (!slot || !Array.isArray(prior.times) || prior.times.length !== 2) throw new Error('Emergency Stop: invalid saved recovery slot');
    activeSlot(prior.times[0], prior.times[1], requestedAt);
    if (prior.times[0] === prior.times[1]) throw new Error('Emergency Stop: invalid saved recovery window');
    if (!slot.pair.every((r, i) => before[r] === prior.times[i] || before[r] === 0)) throw new Error('Emergency Stop: previously implicated schedule changed; recovery will not overwrite it');
  }
  const cleared = implicated.every(prior => profile.slots.find(s => s.family === prior.family && s.id === prior.id).pair.every(r => before[r] === 0));
  const controlsSafe = before[27] === 1 && (!profile.pause || before[318] === 0);
  // Once the original slots are gone, a later action in another slot is not ours
  // to cancel. Recovery can retire the old request without touching that action.
  const verified = cleared && controlsSafe && (implicated.length > 0 || currentlyActive.length === 0);
  if (!verified) {
    const newActive = currentlyActive.some(slot => !implicated.some(s => s.family === slot.family && s.id === slot.id));
    if (newActive) throw new Error('Emergency Stop: a later action is active; recovery will not cancel an unrelated schedule');
    if (!original) throw new Error('Emergency Stop: original action evidence unavailable; awaiting a verified safe readback');
  }
  const untilMs = Math.max(Number.isFinite(record.untilMs) ? record.untilMs : 0, requestedAt.getTime() + 60000,
    ...implicated.map(s => slotEnd(s.times[1], requestedAt)));
  return { implicated, untilMs, verified };
}

async function executeEmergencyStop({ profile, before, read, write, now = new Date(), priorImplicated = [], priorOnly = false }) {
  const implicated = priorOnly ? [] : profile.slots.filter(s => before[s.family === 'charge' ? 96 : 59] === 1 && activeSlot(before[s.pair[0]], before[s.pair[1]], now));
  for (const prior of priorImplicated) {
    const slot = profile.slots.find(s => s.family === prior.family && s.id === prior.id);
    if (!slot || !Array.isArray(prior.times) || prior.times.length !== 2) throw new Error('Emergency Stop: invalid saved implicated slot');
    if (slot.pair.every(r => before[r] === 0)) continue;
    if (!slot.pair.every((r, i) => before[r] === prior.times[i] || before[r] === 0)) throw new Error('Emergency Stop: previously implicated schedule changed; investigate before retry');
    if (!implicated.includes(slot)) implicated.push(slot);
  }
  const failures = [];
  // Both cancellation attempts run even if one fails; no schedule is edited unless both are verified off.
  for (const address of [96, 59]) {
    if (before[address] === 0) continue;
    try { await write(address, 0, `Emergency Stop disable HR${address}`); }
    catch (err) { failures.push(err.message); }
  }
  if (failures.length) throw new Error(`Emergency Stop: cancellation uncertain: ${failures.join('; ')}`);
  const disabled = await readEmergencySnapshot(read, profile, 'cancel-verification');
  if (disabled[96] !== 0 || disabled[59] !== 0) throw new Error('Emergency Stop: controller re-enabled forced operation; no slots cleared');
  // Compare times again after cancellation: never erase a newly changed or unrelated schedule.
  for (const slot of profile.slots) {
    if (slot.pair.some(r => disabled[r] !== before[r])) throw new Error('Emergency Stop: schedule changed during cancellation; no slots cleared');
  }
  for (const slot of implicated) {
    if (!slot.clearAllowed) { failures.push(`${slot.family} slot ${slot.id} has no validated clear path`); continue; }
    for (const address of slot.pair) {
      if (disabled[address] === 0) continue;
      try { await write(address, 0, `Emergency Stop clear ${slot.family} slot ${slot.id}`); }
      catch (err) { failures.push(err.message); }
    }
  }
  if (before[27] !== 1) {
    try { await write(27, 1, 'Emergency Stop restore Eco'); } catch (err) { failures.push(err.message); }
  }
  if (profile.pause && before[318] !== 0) {
    try { await write(318, 0, 'Emergency Stop restore normal pause mode'); } catch (err) { failures.push(err.message); }
  }
  const after = await readEmergencySnapshot(read, profile, 'final-verification');
  for (const address of [96, 59, 27, ...(profile.pause ? [318] : [])]) {
    if (after[address] !== (address === 27 ? 1 : 0)) failures.push(`HR${address} readback mismatch`);
  }
  const cleared = new Set(implicated.filter(s => s.clearAllowed).flatMap(s => s.pair));
  for (const slot of profile.slots) for (const address of slot.pair) {
    if (after[address] !== (cleared.has(address) ? 0 : before[address])) failures.push(`HR${address} schedule readback mismatch`);
  }
  if (failures.length) throw new Error(`Emergency Stop incomplete: ${failures.join('; ')}; automation remains held`);
  return { implicated, untilMs: Math.max(now.getTime() + 60000, ...implicated.map(s => slotEnd(before[s.pair[1]], now))), before, after };
}

module.exports = { emergencyProfile, readEmergencySnapshot, executeEmergencyStop, recoveryPlan, activeSlot, slotEnd };
