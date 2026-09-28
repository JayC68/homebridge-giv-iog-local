'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_REFRESH_MINUTES = 360;
const MIN_REFRESH_MINUTES = 60;
const DEFAULT_PERFORMANCE_RATIO = 0.80;
const UK_POSTCODE_RE = /^(GIR\s?0AA|(?:[A-Z]{1,2}\d[A-Z\d]?|[A-Z]{2}\d{1,2}|[A-Z]\d[A-Z])\s?\d[A-Z]{2})$/i;

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function numberOr(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function hhmmToMinutes(value) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}
function minuteInWindow(minute, start, end) {
  if (start === null || end === null || start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
function normaliseConfig(config = {}) {
  const enabled = config.enablePredictedSolar === true;
  const location = String(config.predictedSolarLocation || '').trim();
  const countryCode = String(config.predictedSolarCountryCode || '').trim().toUpperCase();
  const performanceRatio = DEFAULT_PERFORMANCE_RATIO;
  const refreshMinutes = Math.max(MIN_REFRESH_MINUTES, Math.round(numberOr(config.predictedSolarRefreshMinutes, DEFAULT_REFRESH_MINUTES)));
  const arrays = Array.isArray(config.predictedSolarArrays) ? config.predictedSolarArrays.map((raw, i) => {
    const capacityKw = numberOr(raw && raw.capacityKw, 0);
    const tiltDegrees = clamp(numberOr(raw && raw.tiltDegrees, 35), 0, 90);
    const azimuthDegrees = clamp(numberOr(raw && raw.azimuthDegrees, 180), 0, 359);
    const shading = Array.isArray(raw && raw.shading) ? raw.shading.map((slot) => ({
      start: String(slot && slot.start || ''),
      end: String(slot && slot.end || '')
    })).filter((slot) => hhmmToMinutes(slot.start) !== null && hhmmToMinutes(slot.end) !== null) : [];
    return { name: String(raw && raw.name || `Array ${i + 1}`).trim() || `Array ${i + 1}`, capacityKw, tiltDegrees, azimuthDegrees, shading };
  }).filter((array) => array.capacityKw > 0) : [];
  const referenceKwh = numberOr(config.predictedSolarReferenceKwh, 0);
  return { enabled, location, countryCode, performanceRatio, refreshMinutes, arrays, referenceKwh };
}
function validateConfig(config) {
  const c = normaliseConfig(config);
  if (!c.enabled) return { ok: true, enabled: false, config: c };
  if (!c.location) return { ok: false, enabled: true, reason: 'location/postcode is required', config: c };
  if (c.countryCode && !/^[A-Z]{2}$/.test(c.countryCode)) return { ok: false, enabled: true, reason: 'country code must be two ISO letters', config: c };
  if (c.arrays.length < 1) return { ok: false, enabled: true, reason: 'at least one PV array with capacity above 0 kWp is required', config: c };
  return { ok: true, enabled: true, config: c };
}
function shadingMultiplier(array, isoLocalTime) {
  const hhmm = String(isoLocalTime || '').slice(11, 16);
  const minute = hhmmToMinutes(hhmm);
  if (minute === null) return 1;
  let multiplier = 1;
  for (const slot of array.shading || []) {
    if (minuteInWindow(minute, hhmmToMinutes(slot.start), hhmmToMinutes(slot.end))) {
      return 0;
    }
  }
  return clamp(multiplier, 0, 1);
}
function energyFromHourly(array, hourly, targetDate, performanceRatio) {
  if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.global_tilted_irradiance)) throw new Error('Open-Meteo hourly GTI is missing');
  let kwh = 0; let samples = 0;
  for (let i = 0; i < hourly.time.length; i += 1) {
    const time = String(hourly.time[i] || '');
    if (!time.startsWith(targetDate + 'T')) continue;
    const gti = Number(hourly.global_tilted_irradiance[i]);
    if (!Number.isFinite(gti) || gti < 0) continue;
    kwh += (gti / 1000) * array.capacityKw * performanceRatio * shadingMultiplier(array, time);
    samples += 1;
  }
  if (!samples) throw new Error(`Open-Meteo returned no GTI samples for ${targetDate}`);
  return kwh;
}
function nextForecastDate(hourly) {
  const dates = [...new Set((hourly && Array.isArray(hourly.time) ? hourly.time : []).map((t) => String(t).slice(0, 10)).filter(Boolean))];
  if (dates.length < 2) throw new Error('Open-Meteo response does not include tomorrow');
  return dates[1];
}
function brightnessForForecast(kwh, referenceKwh) {
  if (!Number.isFinite(kwh) || kwh < 0 || !Number.isFinite(referenceKwh) || referenceKwh <= 0) return 1;
  return clamp(Math.round((kwh / referenceKwh) * 100), 1, 99);
}
async function fetchJson(url, timeoutMs = 12000, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { 'User-Agent': 'homebridge-giv-iog-local/4.0.0' } });
    if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : 'no-response'}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}
function buildGeocodeUrl(location, countryCode) {
  const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
  u.searchParams.set('name', location); u.searchParams.set('count', '1'); u.searchParams.set('language', 'en'); u.searchParams.set('format', 'json');
  if (countryCode) u.searchParams.set('countryCode', countryCode);
  return u.toString();
}
function isUkPostcode(location, countryCode) {
  return String(countryCode || '').trim().toUpperCase() === 'GB' && UK_POSTCODE_RE.test(String(location || '').trim());
}
function buildUkPostcodeUrl(postcode) {
  const compact = String(postcode || '').trim().replace(/\s+/g, '');
  return `https://api.postcodes.io/postcodes/${encodeURIComponent(compact)}`;
}
function openMeteoAzimuth(compassDegrees) {
  const compass = ((numberOr(compassDegrees, 180) % 360) + 360) % 360;
  return compass - 180;
}
function buildForecastUrl(latitude, longitude, array) {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', String(latitude)); u.searchParams.set('longitude', String(longitude));
  u.searchParams.set('hourly', 'global_tilted_irradiance'); u.searchParams.set('tilt', String(array.tiltDegrees)); u.searchParams.set('azimuth', String(openMeteoAzimuth(array.azimuthDegrees)));
  u.searchParams.set('forecast_days', '2'); u.searchParams.set('timezone', 'auto');
  return u.toString();
}
class PredictedSolarController {
  constructor({ config, log, storagePath, onUpdate, fetchImpl }) {
    this.validation = validateConfig(config); this.log = log; this.storagePath = storagePath; this.onUpdate = onUpdate; this.fetchImpl = fetchImpl || global.fetch;
    this.timer = null; this.inFlight = false; this.location = null; this.cacheFile = path.join(storagePath || '.', 'givhome_predicted_solar_location.json');
  }
  get enabled() { return this.validation.enabled; }
  get valid() { return this.validation.ok; }
  start() {
    if (!this.enabled) return;
    if (!this.valid) { this.log.warn('[PredictedSolar] disabled safely: %s', this.validation.reason); return; }
    this.refresh().catch((e) => this.log.warn('[PredictedSolar] initial refresh failed safely: %s', e.message));
    this.timer = setInterval(() => this.refresh().catch((e) => this.log.warn('[PredictedSolar] refresh failed safely: %s', e.message)), this.validation.config.refreshMinutes * 60000);
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  loadCachedLocation() {
    try { const c = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')); const key = `${this.validation.config.location}|${this.validation.config.countryCode}`; if (c.key === key && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) return c; } catch {}
    return null;
  }
  saveCachedLocation(location) { try { fs.writeFileSync(this.cacheFile, JSON.stringify(location, null, 2)); } catch (e) { this.log.warn('[PredictedSolar] location cache write failed safely: %s', e.message); } }
  async resolveLocation() {
    if (this.location) return this.location;
    const cached = this.loadCachedLocation(); if (cached) { this.location = cached; return cached; }
    const c = this.validation.config;
    let hit = null;
    if (isUkPostcode(c.location, c.countryCode)) {
      const data = await fetchJson(buildUkPostcodeUrl(c.location), 12000, this.fetchImpl);
      const result = data && data.result;
      if (result) hit = { latitude: result.latitude, longitude: result.longitude, name: result.postcode || c.location, country: result.country || c.countryCode };
    } else {
      const data = await fetchJson(buildGeocodeUrl(c.location, c.countryCode), 12000, this.fetchImpl);
      hit = data && Array.isArray(data.results) && data.results[0];
    }
    if (!hit || !Number.isFinite(Number(hit.latitude)) || !Number.isFinite(Number(hit.longitude))) throw new Error('location/postcode was not found');
    this.location = { key: `${c.location}|${c.countryCode}`, latitude: Number(hit.latitude), longitude: Number(hit.longitude), name: hit.name || c.location, country: hit.country || c.countryCode };
    this.saveCachedLocation(this.location); return this.location;
  }
  async refresh() {
    if (!this.enabled || !this.valid || this.inFlight) return null;
    this.inFlight = true;
    try {
      const c = this.validation.config; const loc = await this.resolveLocation();
      let targetDate = null; let totalKwh = 0; const perArray = [];
      for (const array of c.arrays) {
        const data = await fetchJson(buildForecastUrl(loc.latitude, loc.longitude, array), 12000, this.fetchImpl);
        const date = nextForecastDate(data.hourly); if (targetDate && targetDate !== date) throw new Error('array forecast dates disagree'); targetDate = date;
        const kwh = energyFromHourly(array, data.hourly, date, c.performanceRatio); totalKwh += kwh; perArray.push({ name: array.name, kwh });
      }
      const configuredReference = c.referenceKwh > 0 ? c.referenceKwh : 0;
      const fallbackReference = c.arrays.reduce((sum, a) => sum + a.capacityKw, 0) * 4;
      const referenceKwh = configuredReference || fallbackReference;
      const result = { date: targetDate, kwh: totalKwh, referenceKwh, brightness: brightnessForForecast(totalKwh, referenceKwh), perArray, location: loc, fetchedAt: new Date().toISOString() };
      if (typeof this.onUpdate === 'function') this.onUpdate(result);
      this.log.info('[PredictedSolar] tomorrow=%s forecast=%skWh reference=%skWh tile=%s%% arrays=%s source=Open-Meteo GTI', targetDate, totalKwh.toFixed(2), referenceKwh.toFixed(2), result.brightness, perArray.map((x) => `${x.name}:${x.kwh.toFixed(2)}`).join(','));
      return result;
    } finally { this.inFlight = false; }
  }
}
module.exports = { PredictedSolarController, normaliseConfig, validateConfig, shadingMultiplier, energyFromHourly, nextForecastDate, brightnessForForecast, buildGeocodeUrl, isUkPostcode, buildUkPostcodeUrl, buildForecastUrl, openMeteoAzimuth, fetchJson };
