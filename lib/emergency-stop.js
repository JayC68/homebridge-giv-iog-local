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

async function readEmergencySnapshot(read, profile) {
  const result = {};
  const addresses = [27, 59, 96, ...profile.slots.flatMap(s => s.pair), ...(profile.pause ? [318] : [])];
  for (const address of new Set(addresses)) {
    const values = await read(address, 1, `Emergency Stop HR${address}`);
    if (!Array.isArray(values) || values.length !== 1 || !Number.isInteger(values[0])) throw new Error(`Emergency Stop: incomplete HR${address} readback`);
    result[address] = values[0];
  }
  for (const address of [27, 59, 96]) if (![0, 1].includes(result[address])) throw new Error(`Emergency Stop: invalid HR${address} readback`);
  if (profile.pause && ![0, 1, 2, 3].includes(result[318])) throw new Error('Emergency Stop: invalid pause readback');
  for (const slot of profile.slots) activeSlot(result[slot.pair[0]], result[slot.pair[1]], new Date());
  return result;
}

async function executeEmergencyStop({ profile, before, read, write, now = new Date(), priorImplicated = [] }) {
  const implicated = profile.slots.filter(s => before[s.family === 'charge' ? 96 : 59] === 1 && activeSlot(before[s.pair[0]], before[s.pair[1]], now));
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
    try { await write(address, 0, `Emergency Stop disable HR${address}`); }
    catch (err) { failures.push(err.message); }
  }
  if (failures.length) throw new Error(`Emergency Stop: cancellation uncertain: ${failures.join('; ')}`);
  const disabled = await readEmergencySnapshot(read, profile);
  if (disabled[96] !== 0 || disabled[59] !== 0) throw new Error('Emergency Stop: controller re-enabled forced operation; no slots cleared');
  // Compare times again after cancellation: never erase a newly changed or unrelated schedule.
  for (const slot of profile.slots) {
    if (slot.pair.some(r => disabled[r] !== before[r])) throw new Error('Emergency Stop: schedule changed during cancellation; no slots cleared');
  }
  for (const slot of implicated) {
    if (!slot.clearAllowed) { failures.push(`${slot.family} slot ${slot.id} has no validated clear path`); continue; }
    for (const address of slot.pair) {
      try { await write(address, 0, `Emergency Stop clear ${slot.family} slot ${slot.id}`); }
      catch (err) { failures.push(err.message); }
    }
  }
  try { await write(27, 1, 'Emergency Stop restore Eco'); } catch (err) { failures.push(err.message); }
  if (profile.pause && before[318] !== 0) {
    try { await write(318, 0, 'Emergency Stop restore normal pause mode'); } catch (err) { failures.push(err.message); }
  }
  const after = await readEmergencySnapshot(read, profile);
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

module.exports = { emergencyProfile, readEmergencySnapshot, executeEmergencyStop, activeSlot, slotEnd };
