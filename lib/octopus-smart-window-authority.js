'use strict';

/*
 * GivHome Intelligent Octopus Go smart-window authority.
 *
 * This is executable metadata and pure decision logic only. It makes no Octopus
 * network calls, exposes no HomeKit tiles, and sends no inverter writes. It
 * captures the original homebridge-giv-iog-local behaviour that protected the
 * house battery during Intelligent Octopus Go EV dispatch windows so that the
 * direct-Modbus appliance can later port that behaviour without guessing.
 */

const OCTOPUS_SMART_WINDOW_POLICY = Object.freeze({
  stage: 'GivHome Intelligent Octopus Go smart-window authority',
  executable: false,
  octopusNetworkCallsAdded: false,
  homeKitExposureAdded: false,
  inverterWritesAdded: false,
  automaticMutationPath: 'absent',
  sourceModel: 'homebridge-giv-iog-local@3.7.5: Kraken token + plannedDispatches + fallback off-peak + grace-to-half-hour + applyAutomation charge intent',
  purpose: 'Model Intelligent Octopus Go smart-window state and home-battery protection intent before enabling any API polling or automatic Modbus writes.',
  fallbackCheapStart: '23:30',
  fallbackCheapEnd: '05:30',
  defaultGraceMinutes: 30,
  protectionRule: 'When cheap/smart/grace is active, telemetry is safe, SOC is below target, and a cheap-window end is known, the original product intent is to charge/protect the battery until the cheap-window end.',
  noWritesUntilStageGate: 'No charge schedule, HR96, HR111, Intelligent Octopus Go API, or HomeKit Smart Window binding is added by this stage.'
});

function parseHmmToMinutes(value, label = 'time') {
  const text = String(value || '').trim();
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    throw new Error(`${label} must be HH:MM`);
  }
  return (Number(match[1]) * 60) + Number(match[2]);
}

function minutesSinceMidnight(date) {
  return (date.getHours() * 60) + date.getMinutes();
}

function isMinuteInWindow(nowMinutes, startMinutes, endMinutes) {
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function isInClockWindow(now, startHmm, endHmm) {
  const start = parseHmmToMinutes(startHmm, 'start');
  const end = parseHmmToMinutes(endHmm, 'end');
  return isMinuteInWindow(minutesSinceMidnight(now), start, end);
}

function clockWindowEnd(now, startHmm, endHmm) {
  const start = parseHmmToMinutes(startHmm, 'start');
  const end = parseHmmToMinutes(endHmm, 'end');
  const nowMins = minutesSinceMidnight(now);
  const endDate = new Date(now);
  endDate.setSeconds(0, 0);
  endDate.setHours(Math.floor(end / 60), end % 60, 0, 0);
  if (start > end && nowMins >= start) {
    endDate.setDate(endDate.getDate() + 1);
  }
  if (start < end && endDate <= now) {
    endDate.setDate(endDate.getDate() + 1);
  }
  return endDate;
}

function ceilToHalfHour(date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  const minutes = d.getMinutes();
  if (minutes === 0 || minutes === 30) return d;
  if (minutes < 30) {
    d.setMinutes(30, 0, 0);
    return d;
  }
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

function normaliseDispatches(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const start = row?.start instanceof Date ? new Date(row.start) : new Date(row?.startDt || row?.start || '');
      const end = row?.end instanceof Date ? new Date(row.end) : new Date(row?.endDt || row?.end || '');
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
      return Object.freeze({ start, end });
    })
    .filter(Boolean)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function protectedDispatchEnd(dispatchEnd, graceMinutes) {
  const rounded = ceilToHalfHour(dispatchEnd);
  const diffMinutes = Math.round((rounded.getTime() - dispatchEnd.getTime()) / 60000);
  if (diffMinutes > 0 && diffMinutes <= Math.max(0, graceMinutes)) {
    return rounded;
  }
  return new Date(dispatchEnd);
}

function getOctopusSmartWindowAuthorityState(nowInput, plannedDispatchRows = [], options = {}) {
  const now = nowInput instanceof Date ? new Date(nowInput) : new Date(nowInput || Date.now());
  if (Number.isNaN(now.getTime())) throw new Error('now must be a valid Date or timestamp');

  const graceMinutes = Number.isFinite(options.graceMinutes)
    ? Math.max(0, Math.min(30, Math.round(options.graceMinutes)))
    : OCTOPUS_SMART_WINDOW_POLICY.defaultGraceMinutes;
  const cheapStart = options.cheapStart || OCTOPUS_SMART_WINDOW_POLICY.fallbackCheapStart;
  const cheapEnd = options.cheapEnd || OCTOPUS_SMART_WINDOW_POLICY.fallbackCheapEnd;
  const manualSmartWindows = Array.isArray(options.manualSmartWindows) ? options.manualSmartWindows : [];
  const dispatches = normaliseDispatches(plannedDispatchRows);

  const fallbackActive = isInClockWindow(now, cheapStart, cheapEnd);
  const fallbackEnd = fallbackActive ? clockWindowEnd(now, cheapStart, cheapEnd) : null;
  const manualActiveWindows = manualSmartWindows
    .filter((entry) => entry?.start && entry?.end && isInClockWindow(now, entry.start, entry.end))
    .map((entry) => clockWindowEnd(now, entry.start, entry.end));
  const manualActive = manualActiveWindows.length > 0;

  let dispatchState = null;
  for (const dispatch of dispatches) {
    const protectedEnd = protectedDispatchEnd(dispatch.end, graceMinutes);
    if (now >= dispatch.start && now <= protectedEnd) {
      const dispatchActive = now <= dispatch.end;
      dispatchState = {
        cheapActive: true,
        graceActive: !dispatchActive,
        smartActive: !fallbackActive,
        cheapWindowEnd: protectedEnd,
        source: dispatchActive ? 'smart-charging' : 'grace-period',
        dispatchStart: dispatch.start,
        dispatchEnd: dispatch.end,
        protectedEnd,
        graceMinutes
      };
      break;
    }
  }

  const ends = [fallbackEnd, ...manualActiveWindows, dispatchState?.cheapWindowEnd]
    .filter((value) => value instanceof Date && !Number.isNaN(value.getTime()));
  const cheapWindowEnd = ends.length > 0 ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null;
  const cheapActive = Boolean(fallbackActive || manualActive || dispatchState?.cheapActive);
  const graceActive = Boolean(dispatchState?.graceActive);
  const smartActive = Boolean(manualActive || dispatchState?.smartActive || (dispatchState?.cheapActive && !fallbackActive));

  const labels = [];
  if (fallbackActive) labels.push('off-peak-hours');
  if (manualActive) labels.push('manual-smart-window');
  if (dispatchState?.source) labels.push(dispatchState.source);

  return Object.freeze({
    stage: OCTOPUS_SMART_WINDOW_POLICY.stage,
    executable: false,
    now,
    cheapActive,
    graceActive,
    smartActive,
    cheapWindowEnd,
    source: labels.length > 0 ? labels.join('+') : 'idle',
    fallbackActive,
    manualActive,
    dispatchActive: Boolean(dispatchState && !dispatchState.graceActive),
    dispatchGraceActive: Boolean(dispatchState?.graceActive),
    dispatchCount: dispatches.length,
    octopusNetworkCallsAdded: false,
    inverterWritesAdded: false,
    automaticMutationPath: 'absent'
  });
}

function buildEvBatteryProtectionIntent(snapshot = {}, cheapState = {}, options = {}) {
  const targetSoc = Number.isFinite(options.targetSoc) ? Math.max(1, Math.min(100, Math.round(options.targetSoc))) : 100;
  const online = snapshot.online !== false;
  const safeForAutomation = snapshot.safeForAutomation !== false;
  const soc = Number(snapshot.soc);
  const shouldCharge = Boolean(
    online
    && safeForAutomation
    && cheapState.cheapActive
    && cheapState.cheapWindowEnd instanceof Date
    && Number.isFinite(soc)
    && soc < targetSoc
  );

  return Object.freeze({
    stage: OCTOPUS_SMART_WINDOW_POLICY.stage,
    executable: false,
    inverterWritesAdded: false,
    automaticMutationPath: 'absent',
    mode: shouldCharge ? 'charge-protect-battery-during-cheap-window' : 'idle',
    reason: shouldCharge
      ? 'cheap/smart/grace window active and SOC below target'
      : 'conditions do not require home-battery protection charge intent',
    targetSoc,
    soc: Number.isFinite(soc) ? soc : null,
    cheapActive: Boolean(cheapState.cheapActive),
    smartActive: Boolean(cheapState.smartActive),
    graceActive: Boolean(cheapState.graceActive),
    cheapWindowEnd: cheapState.cheapWindowEnd || null,
    futureChargeRoute: 'defer to gated direct-Modbus charge lifecycle; write may bind only behind explicit local-control gates'
  });
}

function renderOctopusSmartWindowAuthorityLine() {
  return [
    'GivHome Intelligent Octopus Go smart-window authority snapshot:',
    'authoritySnapshotOnly=yes',
    'legacyDryRunExecutable=no',
    'intelligentOctopusGoNetworkCallsManagedBy=stage17-iog-runtime-engine',
    'stage17IntelligentOctopusGoPolling=active-only-when-configured',
    'homeKitExposureManagedBy=integrated-appliance-control',
    'inverterWritesManagedBy=queued-local-command-transport',
    'plannedDispatchesModel=yes',
    'fallbackCheapWindow=23:30-05:30',
    'gracePolicy=ceil-to-half-hour-up-to-30m',
    'homeBatteryProtectionRuntime=queued-if-smart-window-and-safe',
    'futureChargeRoute=gated-direct-Modbus-charge-lifecycle',
    'runtimeMeaning=authority-model-not-current-dispatch-result',
    `automaticMutationPath=${OCTOPUS_SMART_WINDOW_POLICY.automaticMutationPath}`
  ].join(' ');
}

module.exports = {
  OCTOPUS_SMART_WINDOW_POLICY,
  parseHmmToMinutes,
  isInClockWindow,
  ceilToHalfHour,
  normaliseDispatches,
  protectedDispatchEnd,
  getOctopusSmartWindowAuthorityState,
  buildEvBatteryProtectionIntent,
  renderOctopusSmartWindowAuthorityLine
};
