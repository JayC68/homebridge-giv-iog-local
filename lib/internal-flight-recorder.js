'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

const SCHEMA = 'givhome-modbus-internal-flight-recorder-v3.0';
const DEFAULT_BASE = '/var/lib/homebridge/givhome-flight-recorder';
const PLUGIN = 'GivHome Modbus';
const KEYVAL_RE = /\b([A-Za-z][A-Za-z0-9_\-]*)=([^\s]+)/g;

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDatePart(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localIso(date = new Date()) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function parseKeyValues(message) {
  const out = {};
  for (const match of message.matchAll(KEYVAL_RE)) {
    const key = match[1];
    const raw = String(match[2] || '').replace(/[;,]$/, '');
    if (raw.endsWith('W')) {
      const n = Number(raw.slice(0, -1));
      if (Number.isFinite(n)) {
        out[key] = n;
        continue;
      }
    }
    const n = Number(raw);
    out[key] = Number.isFinite(n) && raw.trim() !== '' ? n : raw;
  }
  return out;
}

function classify(message) {
  const m = String(message || '').toLowerCase();
  const cats = [];
  if (m.includes('poll ok')) cats.push('poll_ok');
  if (m.includes('intelligent octopus go') || m.includes('iog')) cats.push('intelligent_octopus_go');
  if (m.includes('smart window') || m.includes('smart-window') || m.includes('smartactive=yes') || m.includes('smart-slot')) cats.push('smart_window');
  if (m.includes('grace period') || m.includes('graceactive=yes') || m.includes('protecteduntil')) cats.push('protected_grace');
  if (m.includes('cheap overnight') || m.includes('cheap rate') || m.includes('fallback')) cats.push('cheap_window');
  if (m.includes('battery care')) cats.push('battery_care');
  if (m.includes('evening excess export')) cats.push('evening_excess_export');
  if (m.includes('eve history') || m.includes('fakegato')) cats.push('eve_history');
  if (m.includes('manual charge')) cats.push('manual_charge');
  if (m.includes('command queued') || m.includes('command started') || m.includes('command complete') || m.includes('command released') || m.includes('command deferred')) cats.push('command_queue');
  if (m.includes('hr94') || m.includes('hr95') || m.includes('hr96') || m.includes('hr111') || m.includes('hr116')) cats.push('charge_lifecycle');
  if (m.includes('hr56') || m.includes('hr57') || m.includes('hr59') || m.includes('hr112')) cats.push('export_lifecycle');
  if (m.includes('accessory') || m.includes('tile') || m.includes('registered')) cats.push('homekit_surface');
  if (m.includes('failed') || m.includes('error') || m.includes('timeout') || m.includes('retry') || m.includes('refused') || m.includes('stale')) cats.push('warning_or_failure');
  return Array.from(new Set(cats)).sort();
}

function severity(level, message) {
  const m = String(message || '').toLowerCase();
  if (level === 'error' || m.includes('failed') || m.includes('refused') || m.includes('error')) return 'error';
  if (level === 'warn' || m.includes('timeout') || m.includes('retry') || m.includes('stale') || m.includes('warn')) return 'warn';
  return 'info';
}

class InternalFlightRecorder {
  constructor(options = {}) {
    this.baseDir = String(options.baseDir || DEFAULT_BASE);
    this.plugin = String(options.plugin || PLUGIN);
    this.version = String(options.version || 'unknown');
    this.stage = String(options.stage || 'unknown');
    this.heartbeatMs = Number.isFinite(Number(options.heartbeatMs)) ? Number(options.heartbeatMs) : 60000;
    this.writeFailures = 0;
    this.lastError = '';
    this.lastFile = '';
    this.lastRecordAt = null;
    this.timer = null;
    this.writeLifecycle('internal_recorder_started', { baseDir: this.baseDir, pluginVersion: this.version, stage: this.stage });
    if (this.heartbeatMs > 0) {
      this.timer = setInterval(() => {
        this.writeLifecycle('internal_recorder_heartbeat', { pluginVersion: this.version, stage: this.stage });
      }, this.heartbeatMs);
      if (typeof this.timer.unref === 'function') this.timer.unref();
    }
  }

  fileFor(date = new Date()) {
    return path.join(this.baseDir, `givhome-modbus-${localDatePart(date)}.jsonl`);
  }

  writeRaw(record) {
    const now = new Date();
    const file = this.fileFor(now);
    const rec = Object.assign({
      schemaVersion: SCHEMA,
      capturedAt: localIso(now),
      plugin: this.plugin,
      pluginVersion: this.version,
      stage: this.stage
    }, record);
    try {
      fs.mkdirSync(this.baseDir, { recursive: true });
      fs.appendFileSync(file, JSON.stringify(rec, null, 0) + '\n', { encoding: 'utf8' });
      this.lastFile = file;
      this.lastRecordAt = now;
    } catch (err) {
      this.writeFailures += 1;
      this.lastError = err && err.message ? err.message : String(err);
    }
  }

  writeLifecycle(message, fields = {}) {
    this.writeRaw({
      kind: 'internal_recorder_lifecycle',
      severity: 'info',
      categories: ['recorder_lifecycle'],
      message,
      fields
    });
  }

  record(level, fmt, args) {
    const message = util.format(fmt, ...(Array.isArray(args) ? args : []));
    this.writeRaw({
      kind: 'homebridge_givhome_modbus_log',
      severity: severity(level, message),
      categories: classify(message),
      message,
      fields: parseKeyValues(message)
    });
  }

  status() {
    return {
      schemaVersion: SCHEMA,
      baseDir: this.baseDir,
      lastFile: this.lastFile,
      lastRecordAt: this.lastRecordAt ? localIso(this.lastRecordAt) : '',
      writeFailures: this.writeFailures,
      lastError: this.lastError
    };
  }

  wrapLogger(log) {
    const recorder = this;
    const wrapped = Object.create(log || {});
    for (const level of ['info', 'warn', 'error', 'debug']) {
      const original = log && typeof log[level] === 'function' ? log[level].bind(log) : null;
      wrapped[level] = function wrappedLog(fmt, ...args) {
        try { recorder.record(level, fmt, args); } catch {}
        if (original) return original(fmt, ...args);
        return undefined;
      };
    }
    return wrapped;
  }
}

function createInternalFlightRecorderLogger(log, options = {}) {
  const recorder = new InternalFlightRecorder(options);
  return { recorder, log: recorder.wrapLogger(log) };
}

module.exports = {
  SCHEMA,
  DEFAULT_BASE,
  InternalFlightRecorder,
  createInternalFlightRecorderLogger,
  localDatePart,
  localIso,
  classify,
  parseKeyValues
};
