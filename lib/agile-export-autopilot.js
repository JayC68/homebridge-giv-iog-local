'use strict';

const DAY_CODES = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const HALF_HOUR_MS = 30 * 60 * 1000;

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function round(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayCode(date = new Date()) {
  return DAY_CODES[date.getDay()] || 'unknown';
}

function halfHourKey(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = date.getMinutes() < 30 ? '00' : '30';
  return `${h}:${m}`;
}

function monthKey(date = new Date()) {
  return String(date.getMonth() + 1).padStart(2, '0');
}

function ewma(previous, sample, alpha = 0.18) {
  const p = Number(previous);
  const s = Number(sample);
  if (!Number.isFinite(s)) return Number.isFinite(p) ? p : 0;
  if (!Number.isFinite(p)) return s;
  return (p * (1 - alpha)) + (s * alpha);
}

function updateBucket(bucket, sample, alpha) {
  const b = bucket && typeof bucket === 'object' ? bucket : {};
  b.samples = Math.min(1000000, Math.max(0, Number(b.samples || 0)) + 1);
  b.avgLoadKw = round(ewma(b.avgLoadKw, sample.loadKw, alpha), 4);
  b.avgPvKw = round(ewma(b.avgPvKw, sample.pvKw, alpha), 4);
  b.avgGridExportKw = round(ewma(b.avgGridExportKw, sample.gridExportKw, alpha), 4);
  b.avgBatteryDischargeKw = round(ewma(b.avgBatteryDischargeKw, sample.batteryDischargeKw, alpha), 4);
  b.avgSoc = round(ewma(b.avgSoc, sample.soc, alpha), 2);
  b.updatedAt = sample.capturedAt;
  return b;
}

function updateLearningState(state, model, now = new Date(), options = {}) {
  const out = state && typeof state === 'object' ? state : {};
  out.version = out.version || 'agile-export-autopilot-learning-v1';
  out.createdAt = out.createdAt || now.toISOString();
  out.updatedAt = now.toISOString();
  out.samples = Math.min(1000000, Math.max(0, Number(out.samples || 0)) + 1);
  out.byMonth = out.byMonth && typeof out.byMonth === 'object' ? out.byMonth : {};
  out.byDay = out.byDay && typeof out.byDay === 'object' ? out.byDay : {};
  out.byHalfHour = out.byHalfHour && typeof out.byHalfHour === 'object' ? out.byHalfHour : {};
  out.byMonthDayHalfHour = out.byMonthDayHalfHour && typeof out.byMonthDayHalfHour === 'object' ? out.byMonthDayHalfHour : {};

  const sample = {
    capturedAt: now.toISOString(),
    soc: numberOrNull(model && model.socPercent),
    loadKw: Math.max(0, numberOrNull(model && model.loadPowerW) === null ? 0 : Number(model.loadPowerW) / 1000),
    pvKw: Math.max(0, numberOrNull(model && model.pvPowerW) === null ? 0 : Number(model.pvPowerW) / 1000),
    gridExportKw: Math.max(0, numberOrNull(model && model.gridExportPowerW) === null ? 0 : Number(model.gridExportPowerW) / 1000),
    batteryDischargeKw: Math.max(0, numberOrNull(model && model.batteryDischargePowerW) === null ? 0 : Number(model.batteryDischargePowerW) / 1000)
  };
  const alpha = Number.isFinite(Number(options.alpha)) ? Number(options.alpha) : 0.16;
  const mKey = monthKey(now);
  const dKey = dayCode(now);
  const hhKey = halfHourKey(now);
  const combined = `${mKey}-${dKey}-${hhKey}`;

  out.overall = updateBucket(out.overall, sample, alpha);
  out.byMonth[mKey] = updateBucket(out.byMonth[mKey], sample, alpha);
  out.byDay[dKey] = updateBucket(out.byDay[dKey], sample, alpha);
  out.byHalfHour[hhKey] = updateBucket(out.byHalfHour[hhKey], sample, alpha);
  out.byMonthDayHalfHour[combined] = updateBucket(out.byMonthDayHalfHour[combined], sample, alpha);
  out.lastSample = sample;
  return out;
}

function bucketForSlot(learning, date = new Date()) {
  const empty = {};
  const combined = `${monthKey(date)}-${dayCode(date)}-${halfHourKey(date)}`;
  return (learning && learning.byMonthDayHalfHour && learning.byMonthDayHalfHour[combined])
    || (learning && learning.byHalfHour && learning.byHalfHour[halfHourKey(date)])
    || (learning && learning.byDay && learning.byDay[dayCode(date)])
    || (learning && learning.byMonth && learning.byMonth[monthKey(date)])
    || (learning && learning.overall)
    || empty;
}

function loadPvForSlot(model, learning, date = new Date(), now = new Date()) {
  const isCurrent = Math.abs(date.getTime() - now.getTime()) < HALF_HOUR_MS;
  const liveLoad = numberOrNull(model && model.loadPowerW);
  const livePv = numberOrNull(model && model.pvPowerW);
  if (isCurrent && liveLoad !== null && livePv !== null) {
    return { loadKw: Math.max(0, liveLoad / 1000), pvKw: Math.max(0, livePv / 1000), source: 'live-telemetry' };
  }
  const bucket = bucketForSlot(learning, date);
  const loadKw = Number.isFinite(Number(bucket.avgLoadKw)) ? Number(bucket.avgLoadKw) : (liveLoad !== null ? Math.max(0, liveLoad / 1000) : 0.5);
  const pvKw = Number.isFinite(Number(bucket.avgPvKw)) ? Number(bucket.avgPvKw) : (livePv !== null ? Math.max(0, livePv / 1000) : 0);
  const samples = Number(bucket.samples || 0);
  return { loadKw: Math.max(0, loadKw), pvKw: Math.max(0, pvKw), source: samples >= 6 ? 'learned-season-day-halfhour' : 'learned-fallback', samples };
}

function strategyConfig(strategy) {
  const key = String(strategy || 'balanced').trim();
  if (key === 'maximumReturn' || key === 'maximum-value' || key === 'maximum') {
    return { key: 'maximumReturn', budgetFactor: 1.0, confidenceMarginKwh: 0.15, maxSlots: 48, minConfidenceSamples: 0 };
  }
  if (key === 'extraCautious' || key === 'cautious') {
    return { key: 'extraCautious', budgetFactor: 0.65, confidenceMarginKwh: 0.7, maxSlots: 6, minConfidenceSamples: 10 };
  }
  return { key: 'balanced', budgetFactor: 0.85, confidenceMarginKwh: 0.35, maxSlots: 18, minConfidenceSamples: 2 };
}

function estimateSaleableEnergyKwh(model, learning, config, now = new Date()) {
  const batteryCapacityKwh = Math.max(0.1, Number(config.batteryCapacityKwh || 13.5));
  const soc = numberOrNull(model && model.socPercent);
  if (soc === null) {
    return { saleableKwh: 0, confidence: 'low', reason: 'soc-unavailable', reserveSoc: Number(config.octopusAgileOutgoingReserveSoc || 35), reserveKwh: Number(config.octopusAgileOutgoingEveningReserveKwh || 3), safetyKwh: 0 };
  }
  const reserveSoc = clamp(config.octopusAgileOutgoingReserveSoc, 5, 95);
  const reserveFromSocKwh = (reserveSoc / 100) * batteryCapacityKwh;
  const reserveKwh = Math.max(reserveFromSocKwh, Math.max(0, Number(config.octopusAgileOutgoingEveningReserveKwh || 0)));
  const safetyKwh = (clamp(config.octopusAgileOutgoingSafetyMarginSoc, 0, 30) / 100) * batteryCapacityKwh;
  const socEnergyKwh = (soc / 100) * batteryCapacityKwh;
  const strat = strategyConfig(config.octopusAgileOutgoingStrategy);
  const raw = Math.max(0, socEnergyKwh - reserveKwh - safetyKwh - strat.confidenceMarginKwh);
  const customCap = Math.max(0, Number(config.octopusAgileOutgoingDailyExportCapKwh || 0));
  const autoCap = Math.max(0.1, Math.min(customCap || batteryCapacityKwh, batteryCapacityKwh * 0.72));
  const mode = String(config.octopusAgileOutgoingDailyExportMode || 'auto');
  const cap = mode === 'custom' ? (customCap || autoCap) : autoCap;
  const saleableKwh = round(Math.min(raw * strat.budgetFactor, cap), 3);
  const samples = Number(learning && learning.samples || 0);
  const confidence = samples >= 288 ? 'high' : (samples >= 48 ? 'medium' : 'low');
  return { saleableKwh, confidence, reason: `soc=${round(soc, 1)} reserveProtected=yes strategy=${strat.key} dailyMode=${mode}`, reserveSoc, reserveKwh: round(reserveKwh, 3), safetyKwh: round(safetyKwh, 3), socEnergyKwh: round(socEnergyKwh, 3), rawKwh: round(raw, 3), capKwh: round(cap, 3), samples };
}

function slotDurationHours(rate, now = new Date()) {
  if (!rate || !(rate.start instanceof Date) || !(rate.end instanceof Date)) return 0;
  const startMs = Math.max(rate.start.getTime(), now.getTime());
  const endMs = rate.end.getTime();
  return Math.max(0, (endMs - startMs) / 3600000);
}

function estimateSlot(rate, model, learning, config, now = new Date()) {
  const pvLoad = loadPvForSlot(model, learning, rate.start, now);
  const maxBatteryKw = Math.max(0.1, Number(config.maxBatteryExportPowerKw || 6));
  const maxGridKw = Math.max(0.1, Number(config.maxGridExportPowerKw || maxBatteryKw));
  const requestedKw = Math.max(0.1, Math.min(Number(config.octopusAgileOutgoingExportPowerKw || maxBatteryKw), maxBatteryKw));
  const gridCeilingBatteryKw = Math.max(0, maxGridKw + pvLoad.loadKw - pvLoad.pvKw);
  const batteryKw = round(Math.min(requestedKw, maxBatteryKw, gridCeilingBatteryKw), 3);
  const hours = slotDurationHours(rate, now);
  const usableKwh = round(Math.max(0, batteryKw * hours), 3);
  const expectedGridExportKw = round(Math.max(0, batteryKw + pvLoad.pvKw - pvLoad.loadKw), 3);
  return { batteryKw, usableKwh, expectedGridExportKw, pvKw: round(pvLoad.pvKw, 3), loadKw: round(pvLoad.loadKw, 3), source: pvLoad.source, samples: pvLoad.samples || 0 };
}

function buildSlotPlan({ model, learning, config, rates, now = new Date(), isRunDay, isWithinAllowedWindow }) {
  const saleable = estimateSaleableEnergyKwh(model, learning, config, now);
  const baselinePence = Math.max(0, Number(config.octopusAgileOutgoingReferenceImportPence || 0));
  const rewardPence = Math.max(0, Number(config.octopusAgileOutgoingMinimumGrossMarginPence || 0));
  const minimumPrice = Number(config.octopusAgileOutgoingMinimumExportPricePence || 0);
  const threshold = Math.max(minimumPrice, baselinePence + rewardPence);
  const strat = strategyConfig(config.octopusAgileOutgoingStrategy);
  const chosen = [];
  const rejected = [];
  if (!Array.isArray(rates) || !rates.length) return { selected: [], rejected, saleable, threshold, reason: 'no-rates' };
  let remaining = Math.max(0, saleable.saleableKwh);
  const candidates = [];
  for (const rate of rates) {
    if (!rate || !(rate.start instanceof Date) || !(rate.end instanceof Date) || rate.end <= now) continue;
    if (typeof isRunDay === 'function' && !isRunDay(rate.start)) { rejected.push({ rate, reason: 'day-not-enabled' }); continue; }
    if (typeof isWithinAllowedWindow === 'function') {
      const midpoint = new Date((rate.start.getTime() + rate.end.getTime()) / 2);
      if (!isWithinAllowedWindow(midpoint)) { rejected.push({ rate, reason: 'outside-allowed-window' }); continue; }
    }
    const price = Number(rate.pricePence);
    if (!Number.isFinite(price)) continue;
    if (price < threshold) { rejected.push({ rate, reason: `below-threshold price=${round(price, 2)} threshold=${round(threshold, 2)}` }); continue; }
    const slot = estimateSlot(rate, model, learning, config, now);
    if (slot.usableKwh < Number(config.octopusAgileOutgoingMinimumExportKwh || 0.1)) { rejected.push({ rate, reason: `insufficient-headroom usable=${slot.usableKwh}` }); continue; }
    const score = price * slot.usableKwh;
    candidates.push({ rate, pricePence: price, score, slot });
  }
  candidates.sort((a, b) => b.score - a.score || b.pricePence - a.pricePence || a.rate.start - b.rate.start);
  for (const candidate of candidates) {
    if (remaining <= 0 || chosen.length >= strat.maxSlots) break;
    const kwh = Math.min(candidate.slot.usableKwh, remaining);
    if (kwh <= 0) continue;
    chosen.push({
      start: candidate.rate.start,
      end: candidate.rate.end,
      pricePence: round(candidate.pricePence, 3),
      expectedKwh: round(kwh, 3),
      expectedValuePence: round(kwh * candidate.pricePence, 2),
      batteryKw: candidate.slot.batteryKw,
      expectedGridExportKw: candidate.slot.expectedGridExportKw,
      pvKw: candidate.slot.pvKw,
      loadKw: candidate.slot.loadKw,
      source: candidate.slot.source,
      score: round(candidate.score, 2)
    });
    remaining = round(remaining - kwh, 4);
  }
  chosen.sort((a, b) => a.start - b.start);
  return {
    selected: chosen,
    rejected,
    saleable,
    threshold: round(threshold, 2),
    baselinePence: round(baselinePence, 2),
    rewardPence: round(rewardPence, 2),
    strategy: strat.key,
    plannedKwh: round(chosen.reduce((sum, slot) => sum + Number(slot.expectedKwh || 0), 0), 3),
    plannedValuePence: round(chosen.reduce((sum, slot) => sum + Number(slot.expectedValuePence || 0), 0), 2),
    candidateCount: candidates.length,
    rejectedCount: rejected.length,
    reason: chosen.length ? 'selected' : (saleable.saleableKwh <= 0 ? 'no-saleable-energy' : 'no-profitable-headroom-slots')
  };
}

function findCurrentSelectedSlot(plan, now = new Date()) {
  if (!plan || !Array.isArray(plan.selected)) return null;
  return plan.selected.find((slot) => now >= slot.start && now < slot.end) || null;
}

module.exports = {
  buildSlotPlan,
  estimateSaleableEnergyKwh,
  findCurrentSelectedSlot,
  localDayKey,
  updateLearningState,
  strategyConfig,
  halfHourKey,
  dayCode
};
