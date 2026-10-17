'use strict';

// Observe the existing response without changing its request or the current forecast calculation.
function localUtcResolver(timeZone, referenceDate) {
  const format = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const label = ms => {
    const parts = Object.fromEntries(format.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  const naive = s => {
    if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(s)) return null;
    const ms = Date.parse(s + ':00Z');
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 16) === s ? ms : null;
  };
  const ref = naive(`${referenceDate}T12:00`);
  if (ref === null) throw new Error('invalid forecast date');
  const offsets = [...new Set([-36, 0, 36].map(h => {
    const utc = ref + h * 3600000; return naive(label(utc)) - utc;
  }))];
  return text => {
    const ms = naive(text); if (ms === null) return null;
    const candidates = offsets.map(o => ms - o).filter(utc => label(utc) === text);
    return candidates.length === 1 ? candidates[0] : null;
  };
}

function captureArrayForecast({ data, array, targetDate, performanceRatio, shadingMultiplier }) {
  const hourly = data?.hourly;
  const timezone = typeof data?.timezone === 'string' && data.timezone.length <= 64 ? data.timezone : null;
  let resolve = () => null;
  try { if (timezone) resolve = localUtcResolver(timezone, targetDate); } catch { /* Keep unresolved labels, unqualified. */ }
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const values = Array.isArray(hourly?.global_tilted_irradiance) ? hourly.global_tilted_irradiance : [];
  const intervals = []; let invalid = 0; let previousEnd = null;
  for (let i = 0; i < Math.min(times.length, 72); i++) {
    const label = typeof times[i] === 'string' && times[i].length <= 19 ? times[i] : null;
    const irradiance = values[i];
    const end = resolve(label);
    const valid = typeof irradiance === 'number' && Number.isFinite(irradiance) && irradiance >= 0 && irradiance <= 2000;
    if (!valid || end === null || (previousEnd !== null && end - previousEnd !== 3600000)) invalid++;
    intervals.push({ endLocal: label, endUtc: end, startUtc: end === null ? null : end - 3600000,
      kwh: valid ? Math.round(irradiance / 1000 * array.capacityKw * performanceRatio * shadingMultiplier(array, label) * 1e8) / 1e8 : null });
    previousEnd = end;
  }
  return { timezone, intervals, invalid, truncated: times.length > 72, receivedAt: Date.now(),
    timeBasis: 'GTI mean over preceding hour', qualified: false };
}

module.exports = { localUtcResolver, captureArrayForecast };
