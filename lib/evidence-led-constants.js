'use strict';

const STAGE = 'GivHome Modbus 4.0.0-beta.1';
const STAGE_RUNTIME_MARKER = 'GivHome Modbus 4.0.0-beta.1 loaded; direct local GivEnergy monitoring, HR318-only Pause tiles, reactive Intelligent Octopus Go home-battery protection, observed-power Octopus Flux Export budgeting, shared export-route cleanup, adaptive readback backoff, all-day Octopus Agile Export Autopilot planner with saleable-energy budgeting, multi-slot trading evidence, adaptive learning, staged live gates, optional export MPAN audit, CE/AC charge cleanup, quieter Battery Care evidence logging, grid chatter suppression, export-power enforcement, Eve history and GivEnergy YY-framed Modbus transport are available when configured.';

const DIRECT_LOCAL_DEFAULT_PORT = 8899;
const DEFAULT_UNIT_ADDRESS = 0x11;
const DEFAULT_ADAPTER_SERIAL = 'AB1234G567';

const CONNECT_TIMEOUT_MS = 1250;
const READ_RESPONSE_TIMEOUT_MS = 3000;
const CAPABILITY_DISCOVERY_BANK_GAP_MS = 750;
const SHORT_CONNECT_TIMEOUT_MS = 350;
const SHORT_READ_RESPONSE_TIMEOUT_MS = 650;
const SHORT_OPPORTUNITY_COUNT = 3;
const FRESH_ATTEMPT_GAP_MS = 125;
const GENEROUS_CONNECT_TIMEOUT_MS = 3750;
const GENEROUS_READ_RESPONSE_TIMEOUT_MS = 3750;
const TCP_REACHABILITY_TIMEOUT_MS = 750;
const DISCOVERY_CONCURRENCY = 32;
const MAX_FRAME_LENGTH = 4096;

const INPUT_REGISTER_TELEMETRY_START = 0;
const INPUT_REGISTER_TELEMETRY_COUNT = 60;
const HOLDING_REGISTER_FUNCTION = 0x03;
const INPUT_REGISTER_FUNCTION = 0x04;

const DEFAULT_POLL_INTERVAL_SECONDS = 30;
const MIN_POLL_INTERVAL_SECONDS = 10;
const MAX_POLL_INTERVAL_SECONDS = 300;
const DEFAULT_STALE_AFTER_CONSECUTIVE_FAILURES = 3;
const MIN_STALE_AFTER_CONSECUTIVE_FAILURES = 1;
const MAX_STALE_AFTER_CONSECUTIVE_FAILURES = 10;
const ACTIVE_POWER_THRESHOLD_W = 25;
const GRID_ACTIVE_POWER_THRESHOLD_W = 50;

const CAPABILITY_DISCOVERY_LEVELS = Object.freeze({
  OFF: 'off',
  CORE: 'core',
  EXTENDED: 'extended',
  OPPORTUNITY: 'opportunity'
});

/*
 * Stage 3 discovery intentionally reads only.  The read plan is evidence-led:
 * - iOS Build 20 profile scanner names the HR ranges that matter.
 * - dewet22/jak protocol notes warn that 60-register aligned reads are the safest primitive.
 * We therefore read aligned 60-register banks, then interpret the iOS-derived sub-ranges.
 */
const STAGE3_CORE_HR_BLOCKS = Object.freeze([
  { kind: 'HR', base: 0, count: 60, required: true, retryOnFailure: true, label: 'HR0-59 identity, mode, export slots 1-2, export enable' },
  { kind: 'HR', base: 60, count: 60, required: true, retryOnFailure: true, label: 'HR60-119 charge slot 1, charge enable, power, target SOC' },
  { kind: 'HR', base: 240, count: 60, required: true, retryOnFailure: true, label: 'HR240-299 charge/export schedule namespace slots 3-10' },
  { kind: 'HR', base: 300, count: 60, advisory: true, retryOnFailure: true, label: 'HR300-359 advisory Gen3 flags and candidate power limits' }
]);

const STAGE3_EXTENDED_IR_BLOCKS = Object.freeze([
  { kind: 'IR', base: 60, count: 60, advisory: true, label: 'IR60-119 optional battery-module/read-only extended telemetry' },
  { kind: 'IR', base: 180, count: 60, advisory: true, label: 'IR180-239 optional extended energy totals where supported' }
]);

const STAGE3_EXTENDED_HR_BLOCKS = Object.freeze([
  { kind: 'HR', base: 120, count: 60, advisory: true, retryOnFailure: true, label: 'HR120-179 advisory firmware, RTC, EPS, G100 and inverter-option evidence' },
  { kind: 'HR', base: 180, count: 60, advisory: true, retryOnFailure: true, label: 'HR180-239 advisory parallel/fault/hot-water-diverter evidence' },
  { kind: 'HR', base: 540, count: 60, advisory: true, retryOnFailure: true, label: 'HR540-599 advisory smart-load schedule evidence' },
  { kind: 'HR', base: 960, count: 60, advisory: true, retryOnFailure: true, label: 'HR960-1019 advisory HR1005 duplicate real-time-control evidence' },
  { kind: 'HR', base: 1080, count: 60, advisory: true, retryOnFailure: true, label: 'HR1080-1139 advisory high-bank force-charge/discharge evidence' },
  { kind: 'HR', base: 2040, count: 60, advisory: true, retryOnFailure: true, label: 'HR2040-2099 advisory plant EMS charge/discharge/export schedule evidence' }
]);

const STAGE3_OPPORTUNITY_HR_BLOCKS = STAGE3_EXTENDED_HR_BLOCKS;
const STAGE3_OPPORTUNITY_IR_BLOCKS = STAGE3_EXTENDED_IR_BLOCKS;

const IR_INDEX = Object.freeze({
  BATTERY_THROUGHPUT_TOTAL_HIGH: 6,
  BATTERY_THROUGHPUT_TOTAL_LOW: 7,
  LIFETIME_SOLAR_HIGH: 11,
  LIFETIME_SOLAR_LOW: 12,
  PV_DAY_1: 17,
  PV_POWER_1: 18,
  PV_DAY_2: 19,
  PV_POWER_2: 20,
  GRID_EXPORT_TOTAL_HIGH: 21,
  GRID_EXPORT_TOTAL_LOW: 22,
  GRID_EXPORT_TODAY: 25,
  GRID_IMPORT_TODAY: 26,
  GRID_SIGNED_POWER: 30,
  GRID_IMPORT_TOTAL_HIGH: 32,
  GRID_IMPORT_TOTAL_LOW: 33,
  AC_CHARGE_TODAY: 35,
  BATTERY_CHARGE_TODAY: 36,
  BATTERY_DISCHARGE_TODAY: 37,
  INVERTER_TEMPERATURE: 41,
  LOAD_POWER: 42,
  PV_GENERATION_TODAY: 44,
  PV_GENERATION_TOTAL_HIGH: 45,
  PV_GENERATION_TOTAL_LOW: 46,
  BATTERY_SIGNED_POWER: 52,
  BATTERY_TEMPERATURE: 56,
  SOC: 59
});

module.exports = {
  STAGE,
  STAGE_RUNTIME_MARKER,
  DIRECT_LOCAL_DEFAULT_PORT,
  DEFAULT_UNIT_ADDRESS,
  DEFAULT_ADAPTER_SERIAL,
  CONNECT_TIMEOUT_MS,
  READ_RESPONSE_TIMEOUT_MS,
  CAPABILITY_DISCOVERY_BANK_GAP_MS,
  SHORT_CONNECT_TIMEOUT_MS,
  SHORT_READ_RESPONSE_TIMEOUT_MS,
  SHORT_OPPORTUNITY_COUNT,
  FRESH_ATTEMPT_GAP_MS,
  GENEROUS_CONNECT_TIMEOUT_MS,
  GENEROUS_READ_RESPONSE_TIMEOUT_MS,
  TCP_REACHABILITY_TIMEOUT_MS,
  DISCOVERY_CONCURRENCY,
  MAX_FRAME_LENGTH,
  INPUT_REGISTER_TELEMETRY_START,
  INPUT_REGISTER_TELEMETRY_COUNT,
  HOLDING_REGISTER_FUNCTION,
  INPUT_REGISTER_FUNCTION,
  DEFAULT_POLL_INTERVAL_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
  MAX_POLL_INTERVAL_SECONDS,
  DEFAULT_STALE_AFTER_CONSECUTIVE_FAILURES,
  MIN_STALE_AFTER_CONSECUTIVE_FAILURES,
  MAX_STALE_AFTER_CONSECUTIVE_FAILURES,
  ACTIVE_POWER_THRESHOLD_W,
  GRID_ACTIVE_POWER_THRESHOLD_W,
  CAPABILITY_DISCOVERY_LEVELS,
  STAGE3_CORE_HR_BLOCKS,
  STAGE3_EXTENDED_IR_BLOCKS,
  STAGE3_EXTENDED_HR_BLOCKS,
  STAGE3_OPPORTUNITY_HR_BLOCKS,
  STAGE3_OPPORTUNITY_IR_BLOCKS,
  IR_INDEX
};

const BETA54_IOG_PAUSE_MODE_RUNTIME_MARKER = 'GivHome pause-mode home-battery protection supports Charge mode plus Pause Discharge, Pause Charge and Pause Both with HR318-only write/readback/restore for pause modes.';
module.exports.BETA54_IOG_PAUSE_MODE_RUNTIME_MARKER = BETA54_IOG_PAUSE_MODE_RUNTIME_MARKER;
