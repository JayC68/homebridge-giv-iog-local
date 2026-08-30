'use strict';

const {
  CAPABILITY_DISCOVERY_BANK_GAP_MS,
  INPUT_REGISTER_TELEMETRY_COUNT,
  INPUT_REGISTER_TELEMETRY_START,
  STAGE3_CORE_HR_BLOCKS,
  STAGE3_EXTENDED_HR_BLOCKS,
  STAGE3_EXTENDED_IR_BLOCKS,
  STAGE3_OPPORTUNITY_HR_BLOCKS,
  STAGE3_OPPORTUNITY_IR_BLOCKS
} = require('./evidence-led-constants');
const { decodeInputRegisters0To60 } = require('./telemetry-decoder');
const { classifySerialPrefix } = require('./profile-detector');

const READ_PLAN_VERSION = 'ios-build20-dewet22-family-aware-opportunity-sweep-v6';

const CAPABILITY_STATE = Object.freeze({
  LOCKED: 'locked',
  CANDIDATE: 'candidate',
  PROVEN: 'proven',
  FAILED: 'failed'
});

const HR = Object.freeze({
  MODEL_CODE: 0,
  ARM_FIRMWARE: 21,
  ECO_MODE: 27,
  CHARGE_SLOT_2_START: 31,
  CHARGE_SLOT_2_END: 32,
  EXPORT_SLOT_2_START: 44,
  EXPORT_SLOT_2_END: 45,
  EXPORT_SLOT_1_START: 56,
  EXPORT_SLOT_1_END: 57,
  EXPORT_ENABLE: 59,
  CHARGE_SLOT_1_START: 94,
  CHARGE_SLOT_1_END: 95,
  CHARGE_ENABLE: 96,
  CHARGE_POWER: 111,
  EXPORT_POWER: 112,
  CHARGE_TARGET_SOC: 116,
  CHARGE_SCHEDULE_SLOT_3_START: 246,
  CHARGE_SCHEDULE_SLOT_3_END: 247,
  CHARGE_SCHEDULE_SLOT_8_START: 261,
  CHARGE_SCHEDULE_SLOT_8_END: 262,
  CHARGE_SCHEDULE_SLOT_8_TARGET: 263,
  CHARGE_SCHEDULE_SLOT_9_START: 264,
  CHARGE_SCHEDULE_SLOT_9_END: 265,
  CHARGE_SCHEDULE_SLOT_9_TARGET: 266,
  CHARGE_SCHEDULE_SLOT_10_START: 267,
  CHARGE_SCHEDULE_SLOT_10_END: 268,
  CHARGE_SCHEDULE_SLOT_10_TARGET: 269,
  EXPORT_SCHEDULE_SLOT_3_START: 276,
  EXPORT_SCHEDULE_SLOT_3_END: 277,
  EXPORT_SCHEDULE_SLOT_8_START: 291,
  EXPORT_SCHEDULE_SLOT_8_END: 292,
  EXPORT_SCHEDULE_SLOT_8_TARGET: 293,
  EXPORT_SCHEDULE_SLOT_9_START: 294,
  EXPORT_SCHEDULE_SLOT_9_END: 295,
  EXPORT_SCHEDULE_SLOT_10_START: 297,
  EXPORT_SCHEDULE_SLOT_10_END: 298,
  EXPORT_SCHEDULE_SLOT_10_TARGET: 299,
  EXPORT_PRIORITY: 311,
  BATTERY_CHARGE_LIMIT_AC: 313,
  BATTERY_DISCHARGE_LIMIT_AC: 314,
  ENABLE_EPS: 317,
  GEN3_PAUSE_MODE: 318,
  OPTIONAL_HR1005: 1005,
  TPH_DISCHARGE_LIMIT: 1108,
  TPH_CHARGE_LIMIT: 1110,
  OPTIONAL_HR2040: 2040,
  OPTIONAL_HR2070: 2070,
  GRID_IMPORT_LIMIT: 101,
  GRID_IMPORT_LIMIT_ENABLED: 102,
  ENABLE_BATTERY_SELF_HEATING: 104,
  BATTERY_SOC_RESERVE: 110,
  BATTERY_DISCHARGE_MIN_POWER_RESERVE: 114,
  DISCHARGE_SOC_STOP_1: 120,
  ENABLE_LOCAL_COMMAND_TEST: 121,
  INVERTER_REBOOT: 163,
  ENABLE_RTC: 166,
  ENABLE_MANUAL_BATTERY_HEATER: 172,
  ENABLE_BATTERY_ON_PV_OR_GRID: 175,
  ENABLE_UPS_MODE: 177,
  ENABLE_G100_LIMIT_SWITCH: 178,
  ENABLE_INVERTER_PARALLEL_MODE: 199,
  INVERTER_ERRORS_1: 223,
  INVERTER_ERRORS_2: 224,
  ENABLE_PLANT_MODE: 300,
  PLANT_ROLE: 301,
  PLANT_METERS: 302,
  MPPT_OPERATING_MODE: 305,
  EPS_NOMINAL_VOLTAGE: 307,
  BATTERY_NOMINAL_POWER: 308,
  BATTERY_NOMINAL_CURRENT: 309,
  BATTERY_MAX_CHARGE_PCT: 310,
  BATTERY_PAUSE_SLOT_1_START: 319,
  BATTERY_PAUSE_SLOT_1_END: 320,
  OVERFREQUENCY_DERATING_START_POINT: 321,
  ENABLE_TARIFF_PRICING_BATTERY_LOGIC: 322,
  IMPORT_PRICE_BATTERY_DISCHARGE_THRESHOLD: 323,
  IMPORT_PRICE_BATTERY_CHARGE_THRESHOLD: 324,
  EXPORT_PRICE_BATTERY_DISCHARGE_THRESHOLD: 325,
  UNDERFREQUENCY_DERATING_START_POINT: 326,
  UNDERFREQUENCY_LOADING_SLOPE: 327,
  OVERFREQUENCY_DERATING_STOP_POINT: 328,
  ENABLE_BMS_OCV_CALIBRATION: 329,
  GATEWAY_POWER_OFF_SETTING: 330,
  FORCE_OFF_GRID: 331,
  ENABLE_MICRO_GRID: 332,
  ENABLE_EV_CHARGER: 333,
  EV_CHARGER_IMPORT_LIMIT: 334,
  EV_CHARGER_RECONNECTION_WAIT_TIME: 335,
  EV_CHARGER_SOC_LIMIT: 336,
  ENABLE_FAN: 337,
  FAN_SPEED: 338,
  ENABLE_GATEWAY: 339,
  BMS_COMMUNICATION_MODE: 340,
  N_PE_RELAY_TOGGLE: 341,
  AFCI_SETTING: 342,
  ENABLE_GENERATOR: 343,
  GENERATOR_START_SOC: 344,
  GENERATOR_STOP_SOC: 345,
  GENERATOR_CHARGE_POWER: 346,
  DISABLE_LEDS: 347,
  LCD_SCREEN_IDLE_TIMEOUT: 348,
  INVERTER_OPERATING_MODE: 351,
  SMART_LOAD_SLOT_1_START: 554,
  SMART_LOAD_SLOT_10_END: 573,
  HIGHBANK_DISCHARGE_DOWN_TO: 1109,
  HIGHBANK_CHARGE_UP_TO: 1111,
  HIGHBANK_ENABLE_AC_CHARGE: 1112,
  HIGHBANK_AC_CHARGE_1_START: 1113,
  HIGHBANK_AC_CHARGE_1_END: 1114,
  HIGHBANK_AC_CHARGE_2_START: 1115,
  HIGHBANK_AC_CHARGE_2_END: 1116,
  HIGHBANK_DISCHARGE_1_START: 1118,
  HIGHBANK_DISCHARGE_1_END: 1119,
  HIGHBANK_DISCHARGE_2_START: 1120,
  HIGHBANK_DISCHARGE_2_END: 1121,
  HIGHBANK_ENABLE_FORCE_DISCHARGE: 1122,
  HIGHBANK_ENABLE_FORCE_CHARGE: 1123,
  HIGHBANK_ENABLE_BATTERY_MAINTENANCE_MODE: 1124,
  EMS_ENABLE_PLANT_CONTROL: 2040,
  EMS_DISCHARGE_SLOT_1_START: 2044,
  EMS_DISCHARGE_SLOT_3_TARGET: 2052,
  EMS_CHARGE_SLOT_1_START: 2053,
  EMS_CHARGE_SLOT_3_TARGET: 2061,
  EMS_EXPORT_SLOT_1_START: 2062
});

function normaliseDiscoveryLevel(level = 'core') {
  const text = String(level || 'core').toLowerCase();
  if (text === 'opportunity') return 'opportunity';
  if (text === 'extended') return 'extended';
  return 'core';
}

const FAMILY_SCOPE_GUARDRAIL_REASON = 'Stage 3 records the current inverter family only. Evidence from one family must not be generalized into command support for another family; present, absent, unread and advisory-failed states are all meaningful.';

function buildReadPlan(level = 'core') {
  const normalised = normaliseDiscoveryLevel(level);
  const plan = [
    { kind: 'IR', base: INPUT_REGISTER_TELEMETRY_START, count: INPUT_REGISTER_TELEMETRY_COUNT, required: true, label: 'IR0-59 live telemetry, dashboard drilldown and serial evidence' },
    ...STAGE3_CORE_HR_BLOCKS
  ];

  if (normalised === 'extended') {
    plan.push(...STAGE3_EXTENDED_IR_BLOCKS, ...STAGE3_EXTENDED_HR_BLOCKS);
  }

  if (normalised === 'opportunity') {
    plan.push(...STAGE3_OPPORTUNITY_IR_BLOCKS, ...STAGE3_OPPORTUNITY_HR_BLOCKS);
  }

  return plan;
}

async function runCapabilityDiscovery(client, options = {}) {
  const level = normaliseDiscoveryLevel(options.level || 'core');
  const expectedSerial = String(options.expectedSerial || '').trim();
  const readPlan = buildReadPlan(level);
  const blocks = [];

  let telemetry;
  for (const block of readPlan) {
    const captured = await readCapabilityBlock(client, block);
    blocks.push(captured);

    if (captured.ok && block.kind === 'IR' && block.base === INPUT_REGISTER_TELEMETRY_START) {
      telemetry = {
        inverterSerial: captured.serial,
        registerCount: captured.registerCount,
        values: captured.values
      };
    }

    if (CAPABILITY_DISCOVERY_BANK_GAP_MS > 0) {
      await sleep(CAPABILITY_DISCOVERY_BANK_GAP_MS);
    }
  }

  return analyseCapabilityBlocks({
    level,
    expectedSerial,
    blocks,
    capturedAt: new Date().toISOString(),
    telemetry
  });
}

async function readCapabilityBlock(client, block) {
  const attempts = block.retryOnFailure ? 2 : 1;
  let lastFailure;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = Date.now();
    try {
      const response = block.kind === 'IR'
        ? await client.readInputRegisters(block.base, block.count)
        : await client.readHoldingRegisters(block.base, block.count);
      return {
        ...block,
        ok: true,
        attempts: attempt,
        ms: Date.now() - started,
        serial: response.inverterSerial,
        registerCount: response.registerCount,
        values: response.values
      };
    } catch (err) {
      lastFailure = {
        ...block,
        ok: false,
        attempts: attempt,
        ms: Date.now() - started,
        error: err && err.message ? err.message : String(err)
      };
      if (attempt < attempts) {
        await sleep(1000);
      }
    }
  }

  return lastFailure;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function analyseCapabilityBlocks({ level, expectedSerial, blocks, capturedAt, telemetry }) {
  const ir0 = blocks.find((block) => block.kind === 'IR' && block.base === 0 && block.ok);
  const serial = telemetry && telemetry.inverterSerial ? telemetry.inverterSerial : (ir0 && ir0.serial ? ir0.serial : '');
  const profile = classifySerialPrefix(serial || expectedSerial || '');
  const decoded = ir0 ? safeDecodeTelemetry(ir0.values) : null;
  const serialMatchesExpected = !expectedSerial || serial === expectedSerial;
  const directInverter = Boolean(serial && profile.isDirectInverterCandidate && serialMatchesExpected);

  const getHR = (address) => readRegister(blocks, 'HR', address);
  const hasAll = (addresses) => addresses.every((address) => Number.isInteger(getHR(address)));
  const blockOk = (kind, base) => blocks.some((block) => block.kind === kind && block.base === base && block.ok);

  const modelCode = getHR(HR.MODEL_CODE);
  const familyFromHr0 = familyFromModelCode(modelCode);
  const armFirmware = getHR(HR.ARM_FIRMWARE);
  const ecoRaw = getHR(HR.ECO_MODE);

  const manualChargeCoreAddresses = [HR.CHARGE_SLOT_1_START, HR.CHARGE_SLOT_1_END, HR.CHARGE_ENABLE, HR.CHARGE_POWER, HR.CHARGE_TARGET_SOC];
  const manualExportCoreAddresses = [HR.EXPORT_SLOT_1_START, HR.EXPORT_SLOT_1_END, HR.EXPORT_ENABLE, HR.EXPORT_POWER];
  const slot8ChargeAddresses = [HR.CHARGE_SCHEDULE_SLOT_8_START, HR.CHARGE_SCHEDULE_SLOT_8_END, HR.CHARGE_SCHEDULE_SLOT_8_TARGET, HR.CHARGE_POWER, HR.CHARGE_ENABLE];
  const slot8ExportAddresses = [HR.EXPORT_SCHEDULE_SLOT_8_START, HR.EXPORT_SCHEDULE_SLOT_8_END, HR.EXPORT_SCHEDULE_SLOT_8_TARGET, HR.EXPORT_POWER, HR.EXPORT_ENABLE];
  const cheapOvernightChargeAddresses = [
    HR.CHARGE_SCHEDULE_SLOT_9_START,
    HR.CHARGE_SCHEDULE_SLOT_9_END,
    HR.CHARGE_SCHEDULE_SLOT_9_TARGET,
    HR.CHARGE_SCHEDULE_SLOT_10_START,
    HR.CHARGE_SCHEDULE_SLOT_10_END,
    HR.CHARGE_SCHEDULE_SLOT_10_TARGET,
    HR.CHARGE_POWER,
    HR.CHARGE_ENABLE
  ];
  const acAioPowerPercentLimitsAddresses = [
    HR.BATTERY_CHARGE_LIMIT_AC,
    HR.BATTERY_DISCHARGE_LIMIT_AC
  ];
  const tphAddresses = [HR.TPH_DISCHARGE_LIMIT, HR.TPH_CHARGE_LIMIT];
  const dashboardDrilldownIrAddresses = [1, 2, 5, 8, 9, 13, 41, 56];
  const screenshotLocalControlAddresses = [
    HR.GRID_IMPORT_LIMIT,
    HR.GRID_IMPORT_LIMIT_ENABLED,
    HR.ENABLE_BATTERY_SELF_HEATING,
    HR.BATTERY_SOC_RESERVE,
    HR.BATTERY_DISCHARGE_MIN_POWER_RESERVE,
    HR.ENABLE_RTC,
    HR.ENABLE_MANUAL_BATTERY_HEATER,
    HR.ENABLE_UPS_MODE,
    HR.ENABLE_G100_LIMIT_SWITCH,
    HR.ENABLE_INVERTER_PARALLEL_MODE
  ];
  const acAioOpportunityAddresses = [
    HR.ENABLE_PLANT_MODE,
    HR.PLANT_ROLE,
    HR.PLANT_METERS,
    HR.MPPT_OPERATING_MODE,
    HR.EPS_NOMINAL_VOLTAGE,
    HR.BATTERY_NOMINAL_POWER,
    HR.BATTERY_NOMINAL_CURRENT,
    HR.BATTERY_MAX_CHARGE_PCT,
    HR.EXPORT_PRIORITY,
    HR.BATTERY_CHARGE_LIMIT_AC,
    HR.BATTERY_DISCHARGE_LIMIT_AC,
    HR.ENABLE_EPS,
    HR.GEN3_PAUSE_MODE,
    HR.BATTERY_PAUSE_SLOT_1_START,
    HR.BATTERY_PAUSE_SLOT_1_END,
    HR.ENABLE_TARIFF_PRICING_BATTERY_LOGIC,
    HR.IMPORT_PRICE_BATTERY_DISCHARGE_THRESHOLD,
    HR.IMPORT_PRICE_BATTERY_CHARGE_THRESHOLD,
    HR.EXPORT_PRICE_BATTERY_DISCHARGE_THRESHOLD,
    HR.FORCE_OFF_GRID,
    HR.ENABLE_MICRO_GRID,
    HR.ENABLE_EV_CHARGER,
    HR.EV_CHARGER_IMPORT_LIMIT,
    HR.EV_CHARGER_RECONNECTION_WAIT_TIME,
    HR.EV_CHARGER_SOC_LIMIT,
    HR.ENABLE_GENERATOR,
    HR.GENERATOR_START_SOC,
    HR.GENERATOR_STOP_SOC,
    HR.GENERATOR_CHARGE_POWER,
    HR.INVERTER_OPERATING_MODE
  ];
  const smartLoadAddresses = [HR.SMART_LOAD_SLOT_1_START, HR.SMART_LOAD_SLOT_10_END];
  const highBankControlAddresses = [
    HR.TPH_DISCHARGE_LIMIT,
    HR.HIGHBANK_DISCHARGE_DOWN_TO,
    HR.TPH_CHARGE_LIMIT,
    HR.HIGHBANK_CHARGE_UP_TO,
    HR.HIGHBANK_ENABLE_AC_CHARGE,
    HR.HIGHBANK_AC_CHARGE_1_START,
    HR.HIGHBANK_AC_CHARGE_1_END,
    HR.HIGHBANK_AC_CHARGE_2_START,
    HR.HIGHBANK_AC_CHARGE_2_END,
    HR.HIGHBANK_DISCHARGE_1_START,
    HR.HIGHBANK_DISCHARGE_1_END,
    HR.HIGHBANK_ENABLE_FORCE_DISCHARGE,
    HR.HIGHBANK_ENABLE_FORCE_CHARGE,
    HR.HIGHBANK_ENABLE_BATTERY_MAINTENANCE_MODE
  ];
  const plantEmsAddresses = [
    HR.EMS_ENABLE_PLANT_CONTROL,
    HR.EMS_DISCHARGE_SLOT_1_START,
    HR.EMS_DISCHARGE_SLOT_3_TARGET,
    HR.EMS_CHARGE_SLOT_1_START,
    HR.EMS_CHARGE_SLOT_3_TARGET,
    HR.EMS_EXPORT_SLOT_1_START,
    HR.OPTIONAL_HR2070
  ];

  const isGatewayOrBattery = profile.kind === 'gateway' || profile.kind === 'battery_module';
  const isAio = profile.family === 'aio' || familyFromHr0 === 'aio';
  const isAcOrAioInstallerConfigCandidate = isAio || profile.family === 'ac_coupled' || familyFromHr0 === 'ac_coupled';
  const isThreePhaseCandidate = profile.family === 'three_phase' || familyFromHr0 === 'three_phase';

  const commandExposureAllowed = false;

  const capabilities = {
    directTelemetry: capability(
      directInverter && decoded,
      directInverter && decoded ? CAPABILITY_STATE.PROVEN : CAPABILITY_STATE.FAILED,
      directInverter && decoded ? 'IR0-60 telemetry captured from expected direct inverter serial.' : 'IR0-60 telemetry was not captured from the expected direct inverter.',
      decoded || {}
    ),
    identityRead: capability(
      Number.isInteger(modelCode) || Number.isInteger(armFirmware),
      Number.isInteger(modelCode) || Number.isInteger(armFirmware) ? CAPABILITY_STATE.PROVEN : CAPABILITY_STATE.CANDIDATE,
      'HR0-59 gives model and firmware hints where the inverter supports them.',
      { HR0: modelCode ?? null, familyFromHr0, HR21: armFirmware ?? null }
    ),
    ecoModeRead: capability(
      ecoRaw === 0 || ecoRaw === 1,
      ecoRaw === 0 || ecoRaw === 1 ? CAPABILITY_STATE.PROVEN : CAPABILITY_STATE.CANDIDATE,
      'HR27 can establish Eco mode only when the value is binary 0/1.',
      { HR27: ecoRaw ?? null }
    ),
    manualChargeCore: capability(
      hasAll(manualChargeCoreAddresses),
      hasAll(manualChargeCoreAddresses) && isAio ? CAPABILITY_STATE.PROVEN : hasAll(manualChargeCoreAddresses) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'Core/manual charge evidence requires HR94, HR95, HR96, HR111 and HR116. Stage 3 records evidence only.',
      pickRegisters(getHR, manualChargeCoreAddresses)
    ),
    manualExportCore: capability(
      hasAll(manualExportCoreAddresses),
      hasAll(manualExportCoreAddresses) && isAio ? CAPABILITY_STATE.PROVEN : hasAll(manualExportCoreAddresses) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'Core/manual export evidence requires HR56, HR57, HR59 and HR112. Stage 3 records evidence only.',
      pickRegisters(getHR, manualExportCoreAddresses)
    ),
    chargeScheduleNamespace: capability(
      hasAll([HR.CHARGE_SCHEDULE_SLOT_3_START, HR.CHARGE_SCHEDULE_SLOT_10_END, HR.CHARGE_SCHEDULE_SLOT_10_TARGET]),
      hasAll([HR.CHARGE_SCHEDULE_SLOT_3_START, HR.CHARGE_SCHEDULE_SLOT_10_END, HR.CHARGE_SCHEDULE_SLOT_10_TARGET]) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'Charge schedule namespace evidence spans HR246-269; Stage 3 does not mutate it.',
      pickRegisters(getHR, [
        HR.CHARGE_SCHEDULE_SLOT_3_START,
        HR.CHARGE_SCHEDULE_SLOT_3_END,
        HR.CHARGE_SCHEDULE_SLOT_8_START,
        HR.CHARGE_SCHEDULE_SLOT_8_END,
        HR.CHARGE_SCHEDULE_SLOT_8_TARGET,
        HR.CHARGE_SCHEDULE_SLOT_9_START,
        HR.CHARGE_SCHEDULE_SLOT_9_END,
        HR.CHARGE_SCHEDULE_SLOT_9_TARGET,
        HR.CHARGE_SCHEDULE_SLOT_10_START,
        HR.CHARGE_SCHEDULE_SLOT_10_END,
        HR.CHARGE_SCHEDULE_SLOT_10_TARGET
      ])
    ),
    exportScheduleNamespace: capability(
      hasAll([HR.EXPORT_SCHEDULE_SLOT_3_START, HR.EXPORT_SCHEDULE_SLOT_10_END, HR.EXPORT_SCHEDULE_SLOT_10_TARGET]),
      hasAll([HR.EXPORT_SCHEDULE_SLOT_3_START, HR.EXPORT_SCHEDULE_SLOT_10_END, HR.EXPORT_SCHEDULE_SLOT_10_TARGET]) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'Export schedule namespace evidence spans HR276-299; Stage 3 does not mutate it.',
      pickRegisters(getHR, [
        HR.EXPORT_SCHEDULE_SLOT_3_START,
        HR.EXPORT_SCHEDULE_SLOT_3_END,
        HR.EXPORT_SCHEDULE_SLOT_8_START,
        HR.EXPORT_SCHEDULE_SLOT_8_END,
        HR.EXPORT_SCHEDULE_SLOT_8_TARGET,
        HR.EXPORT_SCHEDULE_SLOT_9_START,
        HR.EXPORT_SCHEDULE_SLOT_9_END,
        HR.EXPORT_SCHEDULE_SLOT_10_START,
        HR.EXPORT_SCHEDULE_SLOT_10_END,
        HR.EXPORT_SCHEDULE_SLOT_10_TARGET
      ])
    ),
    manualChargeSlot8FutureRoute: capability(
      hasAll(slot8ChargeAddresses),
      hasAll(slot8ChargeAddresses) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'iOS-derived future one-off charge route uses slot 8 plus HR111 and HR96. Candidate evidence only; no writes.',
      pickRegisters(getHR, slot8ChargeAddresses)
    ),
    manualExportSlot8FutureRoute: capability(
      hasAll(slot8ExportAddresses),
      hasAll(slot8ExportAddresses) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'iOS-derived future one-off export route uses slot 8 plus HR112 and HR59. Candidate evidence only; no writes.',
      pickRegisters(getHR, slot8ExportAddresses)
    ),
    cheapOvernightNamespace: capability(
      hasAll(cheapOvernightChargeAddresses),
      hasAll(cheapOvernightChargeAddresses) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'Cheap Overnight evidence uses charge schedule slots 9-10 plus HR111/HR96. Stage 3 records evidence only.',
      pickRegisters(getHR, cheapOvernightChargeAddresses)
    ),
    acAioPowerPercentLimits: capability(
      directInverter && isAcOrAioInstallerConfigCandidate && hasAll(acAioPowerPercentLimitsAddresses),
      directInverter && isAcOrAioInstallerConfigCandidate && hasAll(acAioPowerPercentLimitsAddresses) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'dewet22/givenergy-modbus names HR313 battery_charge_limit_ac and HR314 battery_discharge_limit_ac. Stage 3 records these as read-only candidate percent-limit evidence only.',
      {
        ...pickRegisters(getHR, acAioPowerPercentLimitsAddresses),
        registryNames: { HR313: 'battery_charge_limit_ac', HR314: 'battery_discharge_limit_ac' }
      }
    ),
    threePhaseCandidateEvidence: capability(
      isThreePhaseCandidate && hasAll(tphAddresses),
      isThreePhaseCandidate && hasAll(tphAddresses) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'Three-phase evidence can be inspected in extended mode via HR1080-1139, but Stage 3 never exposes command tiles.',
      pickRegisters(getHR, tphAddresses)
    ),
    extendedEvidenceCoverage: capability(
      level === 'extended' && (blockOk('IR', 60) || blockOk('IR', 180) || blockOk('HR', 1080) || blockOk('HR', 2040)),
      level === 'extended' ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      level === 'extended' ? 'Extended mode attempted optional evidence banks; failures are recorded but do not unlock commands.' : 'Extended mode was not requested.',
      {
        IR60_119: blockOk('IR', 60),
        IR180_239: blockOk('IR', 180),
        HR1080_1139: blockOk('HR', 1080),
        HR2040_2099: blockOk('HR', 2040),
        HR1005: getHR(HR.OPTIONAL_HR1005) ?? null,
        HR2040: getHR(HR.OPTIONAL_HR2040) ?? null,
        HR2070: getHR(HR.OPTIONAL_HR2070) ?? null
      }
    ),
    dashboardDrilldownTelemetry: capability(
      directInverter && blockOk('IR', 0),
      directInverter && blockOk('IR', 0) ? CAPABILITY_STATE.PROVEN : CAPABILITY_STATE.LOCKED,
      'Validated dashboard drilldown matrix evidence from IR0-59: PV voltage/current, grid voltage/frequency and inverter/battery temperature. Stage 3 records read-only evidence only.',
      pickInputRegisters(blocks, dashboardDrilldownIrAddresses)
    ),
    screenshotLocalControlOpportunity: capability(
      directInverter && hasAll(screenshotLocalControlAddresses),
      directInverter && hasAll(screenshotLocalControlAddresses) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'Screenshot-derived local-control opportunities including grid import limit, reserve/cutoff, self-heating, RTC/EPS/G100/parallel. Evidence only; no writes.',
      pickRegisters(getHR, screenshotLocalControlAddresses)
    ),
    acAioOpportunitySweep: capability(
      directInverter && isAcOrAioInstallerConfigCandidate && hasAll(acAioOpportunityAddresses),
      directInverter && isAcOrAioInstallerConfigCandidate && hasAll(acAioOpportunityAddresses) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'dewet22/GivEnergy app v4.0.7 HR300-351 AC/AIO installer-config opportunity sweep. Evidence only; no commands are unlocked.',
      {
        ...pickRegisters(getHR, acAioOpportunityAddresses),
        registryNames: {
          HR300: 'enable_plant_mode', HR301: 'plant_role', HR302: 'plant_meters', HR305: 'mppt_operating_mode', HR307: 'eps_nominal_voltage',
          HR308: 'battery_nominal_power', HR309: 'battery_nominal_current', HR310: 'battery_max_charge_pct', HR311: 'export_priority',
          HR313: 'battery_charge_limit_ac', HR314: 'battery_discharge_limit_ac', HR317: 'enable_eps', HR318: 'battery_pause_mode',
          HR319_320: 'battery_pause_slot_1', HR322: 'enable_tariff_pricing_battery_logic', HR333_336: 'ev_charger_config', HR343_346: 'generator_config', HR351: 'inverter_operating_mode'
        }
      }
    ),
    smartLoadScheduleOpportunity: capability(
      hasAll(smartLoadAddresses),
      hasAll(smartLoadAddresses) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'dewet22 registry identifies HR554-573 as Smart Load scheduling. Stage 3 only records whether the schedule bank is readable.',
      {
        HR554: getHR(HR.SMART_LOAD_SLOT_1_START) ?? null,
        HR573: getHR(HR.SMART_LOAD_SLOT_10_END) ?? null,
        bankRead: blockOk('HR', 540)
      }
    ),
    duplicateRealTimeControlEvidence: capability(
      Number.isInteger(getHR(HR.ENABLE_RTC)) || Number.isInteger(getHR(HR.OPTIONAL_HR1005)),
      Number.isInteger(getHR(HR.ENABLE_RTC)) || Number.isInteger(getHR(HR.OPTIONAL_HR1005)) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'The screenshot matrix flags Real-Time Control at HR166 and HR1005. Stage 3 records both where readable, without inferring write safety.',
      pickRegisters(getHR, [HR.ENABLE_RTC, HR.OPTIONAL_HR1005])
    ),
    highBankForceChargeExportOpportunity: capability(
      hasAll(highBankControlAddresses),
      hasAll(highBankControlAddresses) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'Screenshot matrix HR1108-1124 high-bank force charge/export/maintenance route. Evidence only; commands stay locked.',
      pickRegisters(getHR, highBankControlAddresses)
    ),
    plantEmsScheduleOpportunity: capability(
      hasAll(plantEmsAddresses),
      hasAll(plantEmsAddresses) ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'Screenshot matrix HR2040-2070 plant EMS charge/discharge/export schedule route. Evidence only; no mutation.',
      pickRegisters(getHR, plantEmsAddresses)
    ),
    familyScopeGuardrail: capability(
      directInverter,
      directInverter ? CAPABILITY_STATE.PROVEN : CAPABILITY_STATE.LOCKED,
      FAMILY_SCOPE_GUARDRAIL_REASON,
      {
        currentSerial: serial || null,
        serialFamily: profile.family,
        familyFromHr0,
        deviceKind: profile.kind,
        currentTargetOnly: true,
        familyGeneralisation: false,
        presentAbsentUnreadWarnRecorded: true
      }
    ),
    commandTileExposure: capability(
      false,
      commandExposureAllowed ? CAPABILITY_STATE.CANDIDATE : CAPABILITY_STATE.LOCKED,
      'Stage 3 is read-only capability discovery. HomeKit command tiles remain disabled regardless of evidence.'
    )
  };

  if (isGatewayOrBattery || !directInverter) {
    for (const key of Object.keys(capabilities)) {
      if (key !== 'directTelemetry' && key !== 'commandTileExposure') {
        capabilities[key] = capability(false, CAPABILITY_STATE.LOCKED, 'Responder is not an accepted direct inverter target for command capability discovery.');
      }
    }
  }

  const keyRegisters = buildKeyRegisterSummary(getHR);

  return {
    stage: 'Stage 3 RC 1 family-aware registry opportunity sweep',
    readPlanVersion: READ_PLAN_VERSION,
    capturedAt,
    level,
    expectedSerial: expectedSerial || null,
    serial,
    serialMatchesExpected,
    profile,
    familyFromHr0,
    directInverter,
    commandExposureAllowed,
    telemetry: decoded,
    keyRegisters,
    summary: summarise({ directInverter, serial, profile, blocks, capabilities }),
    capabilities,
    blocks: blocks.map(summariseBlock)
  };
}

function safeDecodeTelemetry(values) {
  try {
    return decodeInputRegisters0To60(values);
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
}

function readRegister(blocks, kind, address) {
  const block = blocks.find((candidate) => candidate.kind === kind && candidate.ok && address >= candidate.base && address < candidate.base + candidate.count);
  if (!block) return undefined;
  return block.values[address - block.base];
}

function pickInputRegisters(blocks, addresses) {
  const result = {};
  for (const address of addresses) {
    const block = blocks.find((candidate) => candidate.kind === 'IR' && candidate.ok && address >= candidate.base && address < candidate.base + candidate.count);
    result[`IR${address}`] = block ? block.values[address - block.base] : null;
  }
  return result;
}

function pickRegisters(getHR, addresses) {
  const result = {};
  for (const address of addresses) {
    const value = getHR(address);
    result[`HR${address}`] = Number.isInteger(value) ? value : null;
  }
  return result;
}

function buildKeyRegisterSummary(getHR) {
  return {
    identity: pickRegisters(getHR, [HR.MODEL_CODE, HR.ARM_FIRMWARE, HR.ECO_MODE]),
    manualChargeCore: pickRegisters(getHR, [HR.CHARGE_SLOT_1_START, HR.CHARGE_SLOT_1_END, HR.CHARGE_ENABLE, HR.CHARGE_POWER, HR.CHARGE_TARGET_SOC]),
    manualExportCore: pickRegisters(getHR, [HR.EXPORT_SLOT_1_START, HR.EXPORT_SLOT_1_END, HR.EXPORT_ENABLE, HR.EXPORT_POWER]),
    scheduleBackedChargeSlot8: pickRegisters(getHR, [HR.CHARGE_SCHEDULE_SLOT_8_START, HR.CHARGE_SCHEDULE_SLOT_8_END, HR.CHARGE_SCHEDULE_SLOT_8_TARGET, HR.CHARGE_POWER, HR.CHARGE_ENABLE]),
    scheduleBackedExportSlot8: pickRegisters(getHR, [HR.EXPORT_SCHEDULE_SLOT_8_START, HR.EXPORT_SCHEDULE_SLOT_8_END, HR.EXPORT_SCHEDULE_SLOT_8_TARGET, HR.EXPORT_POWER, HR.EXPORT_ENABLE]),
    cheapOvernightChargeSlots9And10: pickRegisters(getHR, [HR.CHARGE_SCHEDULE_SLOT_9_START, HR.CHARGE_SCHEDULE_SLOT_9_END, HR.CHARGE_SCHEDULE_SLOT_9_TARGET, HR.CHARGE_SCHEDULE_SLOT_10_START, HR.CHARGE_SCHEDULE_SLOT_10_END, HR.CHARGE_SCHEDULE_SLOT_10_TARGET]),
    acAioPowerPercentLimits: {
      ...pickRegisters(getHR, [HR.EXPORT_PRIORITY, HR.BATTERY_CHARGE_LIMIT_AC, HR.BATTERY_DISCHARGE_LIMIT_AC, HR.ENABLE_EPS, HR.GEN3_PAUSE_MODE]),
      registryNames: { HR311: 'export_priority', HR313: 'battery_charge_limit_ac', HR314: 'battery_discharge_limit_ac', HR317: 'enable_eps', HR318: 'battery_pause_mode' }
    },
    acAioRegistryOpportunitySweep: pickRegisters(getHR, [HR.ENABLE_PLANT_MODE, HR.PLANT_ROLE, HR.PLANT_METERS, HR.BATTERY_NOMINAL_POWER, HR.BATTERY_NOMINAL_CURRENT, HR.BATTERY_MAX_CHARGE_PCT, HR.BATTERY_PAUSE_SLOT_1_START, HR.BATTERY_PAUSE_SLOT_1_END, HR.ENABLE_TARIFF_PRICING_BATTERY_LOGIC, HR.IMPORT_PRICE_BATTERY_DISCHARGE_THRESHOLD, HR.IMPORT_PRICE_BATTERY_CHARGE_THRESHOLD, HR.EXPORT_PRICE_BATTERY_DISCHARGE_THRESHOLD, HR.ENABLE_EV_CHARGER, HR.EV_CHARGER_IMPORT_LIMIT, HR.EV_CHARGER_SOC_LIMIT, HR.ENABLE_GENERATOR, HR.GENERATOR_START_SOC, HR.GENERATOR_STOP_SOC, HR.GENERATOR_CHARGE_POWER, HR.INVERTER_OPERATING_MODE]),
    screenshotLocalControlOpportunities: pickRegisters(getHR, [HR.GRID_IMPORT_LIMIT, HR.GRID_IMPORT_LIMIT_ENABLED, HR.ENABLE_BATTERY_SELF_HEATING, HR.BATTERY_SOC_RESERVE, HR.BATTERY_DISCHARGE_MIN_POWER_RESERVE, HR.ENABLE_RTC, HR.ENABLE_MANUAL_BATTERY_HEATER, HR.ENABLE_UPS_MODE, HR.ENABLE_G100_LIMIT_SWITCH, HR.ENABLE_INVERTER_PARALLEL_MODE]),
    smartLoadSchedule: pickRegisters(getHR, [HR.SMART_LOAD_SLOT_1_START, HR.SMART_LOAD_SLOT_10_END]),
    duplicateRealTimeControl: pickRegisters(getHR, [HR.ENABLE_RTC, HR.OPTIONAL_HR1005]),
    highBankForceChargeExport: pickRegisters(getHR, [HR.TPH_DISCHARGE_LIMIT, HR.HIGHBANK_DISCHARGE_DOWN_TO, HR.TPH_CHARGE_LIMIT, HR.HIGHBANK_CHARGE_UP_TO, HR.HIGHBANK_ENABLE_AC_CHARGE, HR.HIGHBANK_AC_CHARGE_1_START, HR.HIGHBANK_AC_CHARGE_1_END, HR.HIGHBANK_ENABLE_FORCE_DISCHARGE, HR.HIGHBANK_ENABLE_FORCE_CHARGE, HR.HIGHBANK_ENABLE_BATTERY_MAINTENANCE_MODE]),
    plantEmsSchedule: pickRegisters(getHR, [HR.EMS_ENABLE_PLANT_CONTROL, HR.EMS_DISCHARGE_SLOT_1_START, HR.EMS_DISCHARGE_SLOT_3_TARGET, HR.EMS_CHARGE_SLOT_1_START, HR.EMS_CHARGE_SLOT_3_TARGET, HR.EMS_EXPORT_SLOT_1_START, HR.OPTIONAL_HR2070]),
    threePhaseExtended: pickRegisters(getHR, [HR.TPH_DISCHARGE_LIMIT, HR.TPH_CHARGE_LIMIT]),
    optionalExtended: pickRegisters(getHR, [HR.OPTIONAL_HR1005, HR.OPTIONAL_HR2040, HR.OPTIONAL_HR2070])
  };
}

function capability(present, state, reason, evidence = {}) {
  return {
    present: Boolean(present),
    state,
    reason,
    evidence
  };
}

function familyFromModelCode(value) {
  if (!Number.isInteger(value)) return 'unknown';
  if (value === 2) return 'hybrid';
  if (value === 3) return 'ac_coupled';
  if (value === 4 || value === 6) return 'three_phase';
  if (value === 5 || value === 7) return 'ems_or_gateway';
  if (value === 8) return 'aio';
  return 'unknown';
}

function isRequiredBlock(block) {
  return block.required === true && block.advisory !== true;
}

function isAdvisoryBlock(block) {
  return block.advisory === true || block.required !== true;
}

function summarise({ directInverter, serial, profile, blocks, capabilities }) {
  const okBlocks = blocks.filter((block) => block.ok).length;
  const failedBlocks = blocks.filter((block) => !block.ok).length;
  const okRequiredBlocks = blocks.filter((block) => isRequiredBlock(block) && block.ok).length;
  const failedRequiredBlocks = blocks.filter((block) => isRequiredBlock(block) && !block.ok).length;
  const okAdvisoryBlocks = blocks.filter((block) => isAdvisoryBlock(block) && block.ok).length;
  const failedAdvisoryBlocks = blocks.filter((block) => isAdvisoryBlock(block) && !block.ok).length;
  const states = {};
  for (const [key, value] of Object.entries(capabilities)) {
    states[key] = value.state;
  }
  return {
    directInverter,
    serial,
    family: profile.family,
    kind: profile.kind,
    okBlocks,
    failedBlocks,
    okRequiredBlocks,
    failedRequiredBlocks,
    okAdvisoryBlocks,
    failedAdvisoryBlocks,
    capabilityStates: states
  };
}

function summariseBlock(block) {
  const range = `${block.kind}${block.base}-${block.base + block.count - 1}`;
  if (!block.ok) {
    return {
      kind: block.kind,
      base: block.base,
      count: block.count,
      range,
      label: block.label,
      required: block.required === true && block.advisory !== true,
      advisory: block.advisory === true || block.required !== true,
      ok: false,
      attempts: block.attempts || 1,
      ms: block.ms,
      error: block.error
    };
  }

  return {
    kind: block.kind,
    base: block.base,
    count: block.count,
    range,
    label: block.label,
    required: block.required === true && block.advisory !== true,
    advisory: block.advisory === true || block.required !== true,
    ok: true,
    attempts: block.attempts || 1,
    ms: block.ms,
    serial: block.serial,
    registerCount: block.registerCount,
    nonZeroCount: block.values.filter((value) => value !== 0).length,
    min: Math.min(...block.values),
    max: Math.max(...block.values),
    values: block.values
  };
}

function renderBlockLogLine(block) {
  const status = block.advisory ? 'ADVISORY' : 'REQUIRED';
  if (!block.ok) {
    return `Stage 3 capability bank ${block.advisory ? 'WARN' : 'FAIL'}: ${block.range} ${status} attempts=${block.attempts || 1} ms=${block.ms} error=${block.error}`;
  }
  return `Stage 3 capability bank OK: ${block.range} ${status} attempts=${block.attempts || 1} ms=${block.ms} serial=${block.serial || 'unknown'} nonZero=${block.nonZeroCount} label=${block.label}`;
}

function capabilityStateSummaryLine(capabilities) {
  return Object.entries(capabilities)
    .map(([name, detail]) => `${name}=${detail.state}`)
    .join(' ');
}

module.exports = {
  CAPABILITY_STATE,
  HR,
  READ_PLAN_VERSION,
  analyseCapabilityBlocks,
  buildReadPlan,
  normaliseDiscoveryLevel,
  capabilityStateSummaryLine,
  renderBlockLogLine,
  runCapabilityDiscovery
};
