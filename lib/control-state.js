'use strict';

const { inferChargeTargetProfile } = require('./charge-target-reconciliation');
const { CH_AIO_SLOT_MAP } = require('./register-authority');

function validTime(n) { return Number.isInteger(n) && n >= 0 && n <= 2359 && n % 100 < 60; }
function inWindow(start, end, now = new Date()) {
  if (!validTime(start) || !validTime(end) || (start === end && start !== 0)) throw new Error('Invalid or ambiguous control window');
  if (start === end) return false;
  const minute = now.getHours() * 60 + now.getMinutes(), a = (start / 100 | 0) * 60 + start % 100, b = (end / 100 | 0) * 60 + end % 100;
  return a < b ? minute >= a && minute < b : minute >= a || minute < b;
}
function endOfWindow(end, now = new Date()) {
  const result = new Date(now); result.setHours(end / 100 | 0, end % 100, 0, 0);
  if (result <= now) result.setDate(result.getDate() + 1);
  return result.getTime();
}
function controlProfile(serial) {
  const kind = inferChargeTargetProfile({ serial }).profile;
  if (kind === 'unsupported-or-read-only') throw new Error('Unsupported control profile; no writes permitted');
  const slots = [];
  for (const family of ['charge', 'export']) for (const [id, registers] of Object.entries(CH_AIO_SLOT_MAP[family].slots)) {
    if (kind !== 'ch-aio' && Number(id) > 2) continue;
    slots.push({ family, id: Number(id), pair: registers.slice(0, 2).map(r => Number(r.slice(2))), enable: family === 'charge' ? 96 : 59 });
  }
  // Only documented time endpoints are reset/restored. Targets and engineering
  // limits are deliberately absent from this authority; HR242 remains diagnostic.
  return { endpointAuthority: 'documented-profile-guarded-readback-required', kind, slots, route: kind === 'ch-aio' ? 'ch-aio' : 'core', pause: kind === 'ch-aio', pauseTimes: kind === 'ch-aio' };
}
async function readWords(read, addresses, label) {
  const groups = [];
  for (const r of [...new Set(addresses)].sort((a, b) => a - b)) {
    const last = groups.at(-1);
    if (last && last.length < 3 && last.at(-1) + 1 === r) last.push(r); else groups.push([r]);
  }
  const values = {};
  for (const group of groups) {
    let words;
    try { words = await read(group[0], group.length, `${label} HR${group[0]}`); }
    catch (err) { throw new Error(`${label} HR${group[0]}: ${err.message}`, { cause: err }); }
    if (!Array.isArray(words) || words.length !== group.length || !words.every(Number.isInteger)) throw new Error(`${label}: incomplete HR${group[0]} readback`);
    group.forEach((r, i) => { values[r] = words[i]; });
  }
  return values;
}
async function readNamespace(read, profile, family, label = 'Control namespace') {
  const slots = profile.slots.filter(s => !family || s.family === family);
  const addresses = slots.flatMap(s => s.pair);
  if (!family) addresses.push(27);
  if (!family || family === 'charge') addresses.push(20, 96, 111, 116);
  if (!family || family === 'export') addresses.push(59, 112, ...(profile.route === 'ch-aio' ? [293] : []));
  if (family === 'pause' || (!family && profile.pause)) addresses.push(318, ...(profile.pauseTimes ? [319, 320] : []));
  const state = await readWords(read, addresses, label);
  for (const slot of slots) inWindow(state[slot.pair[0]], state[slot.pair[1]]);
  for (const r of [20, 27, 96, 59].filter(r => r in state)) if (![0, 1].includes(state[r])) throw new Error(`${label}: invalid HR${r}`);
  for (const r of [111, 112, 116, 293].filter(r => r in state)) if (state[r] < 0 || state[r] > 100) throw new Error(`${label}: invalid HR${r}`);
  if (318 in state && ![0, 1, 2, 3].includes(state[318])) throw new Error(`${label}: invalid pause mode`);
  if (319 in state) {
    if (!validTime(state[319]) || !validTime(state[320])) throw new Error(`${label}: invalid pause window`);
    // Equal pause endpoints mean mode applies all day on supported firmware.
  }
  return state;
}
async function readDeviceTime(read, hostNow = new Date()) {
  const r = await readWords(read, [35, 36, 37, 38, 39, 40], 'Control clock');
  const year = r[35] < 100 ? 2000 + r[35] : r[35];
  const parsed = new Date(year, r[36] - 1, r[37], r[38], r[39], r[40]);
  // The repeated autumn hour has two valid instants. Match the inverter wall
  // time to the nearby host instant rather than assuming the first occurrence.
  const now = [parsed, new Date(+parsed + 3600000), new Date(+parsed - 3600000)].find(candidate =>
    candidate.getFullYear() === year && candidate.getMonth() === r[36] - 1 && candidate.getDate() === r[37]
      && candidate.getHours() === r[38] && candidate.getMinutes() === r[39] && candidate.getSeconds() === r[40]
      && Math.abs(candidate - hostNow) <= 120000);
  if (!now) throw new Error('Control clock is invalid or differs from Homebridge by more than two minutes; no speculative schedule edits');
  return now;
}
function pauseActive(state, profile, now) {
  if (!profile.pause || state[318] === 0) return false;
  if (!profile.pauseTimes) return true;
  if (state[319] === state[320]) return true;
  return inWindow(state[319], state[320], now);
}
function sameValues(state, expected) { return Object.entries(expected).every(([r, v]) => state[r] === v); }
function changedFutureRequiresEnable(profile, family, before, after, excluded = []) {
  return profile.slots.some(s => s.family === family && !excluded.includes(s.id) && after[s.pair[0]] !== after[s.pair[1]]
    && (before[s.enable] === 1 || s.pair.some(r => before[r] !== after[r])));
}
module.exports = { controlProfile, readWords, readNamespace, readDeviceTime, inWindow, endOfWindow, pauseActive, sameValues, changedFutureRequiresEnable };
