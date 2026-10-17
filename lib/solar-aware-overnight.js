'use strict';

const fs = require('fs');
const { randomUUID } = require('crypto');

function saveState(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function solarConfig(config = {}) {
  const result = {
    lowKwh: config.solarAwareLowForecastKwh ?? 10,
    highKwh: config.solarAwareHighForecastKwh ?? 20,
    lowTarget: config.solarAwareLowTargetSoc ?? 100,
    mediumTarget: config.solarAwareMediumTargetSoc ?? 80,
    highTarget: config.solarAwareHighTargetSoc ?? 60
  };
  result.valid = [result.lowKwh, result.highKwh].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000)
    && result.highKwh > result.lowKwh
    && [result.lowTarget, result.mediumTarget, result.highTarget].every(n => Number.isInteger(n) && n >= 4 && n <= 100)
    && result.lowTarget >= result.mediumTarget && result.mediumTarget >= result.highTarget;
  return result;
}

function selectOvernightTarget({ config, enabled, forecasts, windowEnd, now = new Date(), fallback }) {
  const settings = solarConfig(config);
  const result = { targetSoc: fallback, reason: 'normal Charge Target' };
  if (!enabled) return result;
  if (!settings.valid) return { ...result, reason: 'invalid solar settings; normal Charge Target' };
  if (!(windowEnd instanceof Date) || !Number.isFinite(windowEnd.getTime())) return result;
  const forecast = forecasts?.[localDate(windowEnd)];
  const age = now.getTime() - Date.parse(forecast?.fetchedAt);
  if (!forecast || forecast.date !== localDate(windowEnd) || typeof forecast.kwh !== 'number'
    || !Number.isFinite(forecast.kwh) || forecast.kwh < 0 || !Number.isFinite(age) || age < 0 || age > 24 * 3600000) {
    return { ...result, reason: 'forecast unavailable, stale or wrong day; normal Charge Target' };
  }
  const tier = forecast.kwh < settings.lowKwh ? 'low' : forecast.kwh < settings.highKwh ? 'medium' : 'high';
  return { targetSoc: Math.min(fallback, settings[`${tier}Target`]), reason: `${tier} solar forecast`, forecastKwh: forecast.kwh, date: forecast.date };
}

module.exports = { saveState, localDate, solarConfig, selectOvernightTarget };
