'use strict';

const {
  DEFAULT_ADAPTER_SERIAL,
  DEFAULT_UNIT_ADDRESS
} = require('./evidence-led-constants');
const {
  crc16Modbus,
  readUInt16BE,
  writeUInt16BE
} = require('./givenergy-frame');
const {
  ORDERED_DRY_RUN_COMMANDS
} = require('./stage4-safety-framework');

const WRITE_SINGLE_REGISTER_FUNCTION = 0x06;
const STAGE5_OFFLINE_COMPOSER_VERSION = 'givhome-1.0.0-offline-function06-frame-verifier';

function assertUInt16(name, value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${name} must be an unsigned 16-bit value`);
  }
}

function assertUInt8(name, value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${name} must be an unsigned 8-bit value`);
  }
}

function normaliseAdapterSerial(adapterSerial) {
  const serial = String(adapterSerial || DEFAULT_ADAPTER_SERIAL).trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(serial)) {
    throw new Error('adapterSerial must be exactly 10 ASCII letters/numbers');
  }
  return serial;
}

function buildOfflineWriteSingleRegisterFrame(options = {}) {
  const adapterSerial = normaliseAdapterSerial(options.adapterSerial);
  const deviceAddress = options.deviceAddress ?? DEFAULT_UNIT_ADDRESS;
  const register = options.register;
  const value = options.value;

  assertUInt8('deviceAddress', deviceAddress);
  assertUInt16('register', register);
  assertUInt16('value', value);

  const transparent = Buffer.concat([
    Buffer.from([deviceAddress, WRITE_SINGLE_REGISTER_FUNCTION]),
    writeUInt16BE(register),
    writeUInt16BE(value)
  ]);

  const crc = crc16Modbus(transparent);
  const payload = Buffer.concat([
    Buffer.from(adapterSerial, 'ascii'),
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 0x08]),
    transparent,
    Buffer.from([crc & 0xff, (crc >> 8) & 0xff])
  ]);

  return Buffer.concat([
    Buffer.from([0x59, 0x59]),
    writeUInt16BE(0x0001),
    writeUInt16BE(payload.length + 2),
    Buffer.from([0x01, 0x02]),
    payload
  ]);
}

function summariseOfflineWriteFrame(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < 34) {
    throw new Error('offline write frame too short');
  }
  return {
    marker: frame.subarray(0, 2).toString('hex'),
    declaredLength: readUInt16BE(frame, 4),
    outerFunction: frame[6],
    mainFunction: frame[7],
    deviceAddress: frame[26],
    transparentFunction: frame[27],
    register: (frame[28] << 8) | frame[29],
    value: (frame[30] << 8) | frame[31],
    crcLow: frame[32],
    crcHigh: frame[33],
    length: frame.length
  };
}

function verifyOfflineWriteFrame(frame) {
  const summary = summariseOfflineWriteFrame(frame);
  const transparent = frame.subarray(26, 32);
  const crc = crc16Modbus(transparent);
  const crcLow = crc & 0xff;
  const crcHigh = (crc >> 8) & 0xff;
  const expectedDeclaredLength = frame.length - 6;

  const markerOk = summary.marker === '5959';
  const declaredLengthOk = summary.declaredLength === expectedDeclaredLength;
  const outerFunctionOk = summary.outerFunction === 0x01;
  const mainFunctionOk = summary.mainFunction === 0x02;
  const transparentFunctionOk = summary.transparentFunction === WRITE_SINGLE_REGISTER_FUNCTION;
  const crcOk = summary.crcLow === crcLow && summary.crcHigh === crcHigh;
  const lengthOk = frame.length === 34;

  return {
    markerOk,
    declaredLengthOk,
    outerFunctionOk,
    mainFunctionOk,
    transparentFunctionOk,
    function06Ok: transparentFunctionOk,
    crcOk,
    lengthOk,
    echoShapeOk: markerOk && declaredLengthOk && outerFunctionOk && mainFunctionOk && transparentFunctionOk && lengthOk,
    ok: markerOk && declaredLengthOk && outerFunctionOk && mainFunctionOk && transparentFunctionOk && crcOk && lengthOk,
    expectedCrcLow: crcLow,
    expectedCrcHigh: crcHigh,
    summary
  };
}

const SAMPLE_OFFLINE_VALUES = Object.freeze({
  manualChargeSlot8: Object.freeze({ HR261: 2330, HR262: 530, HR263: 100, HR111: 100, HR96: 1, HR116: 100, HR313: 100 }),
  manualExportSlot8: Object.freeze({ HR291: 1900, HR292: 1930, HR293: 100, HR112: 30, HR59: 1, HR314: 100 }),
  cheapOvernightChargeSlots9And10: Object.freeze({ HR264: 2330, HR265: 0, HR266: 100, HR267: 0, HR268: 530, HR269: 100, HR111: 100, HR96: 1, HR116: 100, HR313: 100 }),
  acAioPowerPercentLimits: Object.freeze({ HR313: 100, HR314: 100, HR318: 0 })
});

function buildStage5OfflineWriteComposerReport(stage4Report = {}) {
  const commands = stage4Report.dryRunCommands || {};
  const plans = {};
  for (const name of ORDERED_DRY_RUN_COMMANDS) {
    const command = commands[name] || {};
    const plannedRegisters = Array.isArray(command.plannedRegisters) ? command.plannedRegisters.slice() : [];
    const sampleValues = SAMPLE_OFFLINE_VALUES[name] || {};
    const offlineFrames = [];
    for (const register of plannedRegisters) {
      const key = `HR${register}`;
      const value = Number.isInteger(sampleValues[key]) ? sampleValues[key] : 0;
      const frame = buildOfflineWriteSingleRegisterFrame({ register, value });
      offlineFrames.push({ register, value, summary: summariseOfflineWriteFrame(frame), verification: verifyOfflineWriteFrame(frame) });
    }
    const allVerified = offlineFrames.length > 0 && offlineFrames.every((entry) => entry.verification && entry.verification.ok === true);
    plans[name] = {
      state: command.state === 'rendered-not-executable' ? 'frames-rendered-offline-only' : 'blocked-no-dry-run-command',
      verificationState: allVerified ? 'verified-offline-only' : 'blocked-or-unverified',
      plannedRegisters,
      frameCount: offlineFrames.length,
      verifiedFrameCount: offlineFrames.filter((entry) => entry.verification && entry.verification.ok === true).length,
      offlineFrames,
      transportBinding: 'absent',
      requestBinding: 'absent',
      mutationCommitAllowed: false,
      executable: false,
      liveWritesAvailable: false,
      commandExposure: 'locked'
    };
  }
  const totalFrameCount = Object.values(plans).reduce((sum, plan) => sum + plan.frameCount, 0);
  const totalVerifiedFrameCount = Object.values(plans).reduce((sum, plan) => sum + plan.verifiedFrameCount, 0);
  return {
    stage: 'GivHome 1.0.0 offline Function 06 frame verifier',
    version: STAGE5_OFFLINE_COMPOSER_VERSION,
    function06FrameComposer: 'present-offline-only',
    function06FrameVerifier: 'present-offline-only',
    transportBinding: 'absent',
    requestBinding: 'absent',
    mutationCommitAllowed: false,
    executable: false,
    liveWritesAvailable: false,
    commandTilesAvailable: false,
    commandExposure: 'locked',
    verification: {
      totalFrameCount,
      totalVerifiedFrameCount,
      allFramesVerified: totalFrameCount > 0 && totalFrameCount === totalVerifiedFrameCount,
      crcChecked: true,
      lengthChecked: true,
      echoShapeChecked: true,
      function06Checked: true
    },
    plans
  };
}

function renderStage5OfflineComposerLine(report) {
  return [
    'Stage 5 offline Function 06 composer:',
    `function06FrameComposer=${report.function06FrameComposer}`,
    `function06FrameVerifier=${report.function06FrameVerifier || 'absent'}`,
    'transportBinding=absent',
    'requestBinding=absent',
    'mutationCommit=no',
    'liveWritesAvailable=no',
    'commandTiles=disabled',
    'commandExposure=locked'
  ].join(' ');
}

function renderStage5OfflineFramePlanLine(report) {
  const count = (name) => report.plans && report.plans[name] ? report.plans[name].frameCount : 0;
  const state = (name) => report.plans && report.plans[name] ? report.plans[name].state : 'blocked-no-dry-run-command';
  return [
    'Stage 5 offline Function 06 frame plan:',
    `manualChargeSlot8=${state('manualChargeSlot8')} frames=${count('manualChargeSlot8')}`,
    `manualExportSlot8=${state('manualExportSlot8')} frames=${count('manualExportSlot8')}`,
    `cheapOvernightChargeSlots9And10=${state('cheapOvernightChargeSlots9And10')} frames=${count('cheapOvernightChargeSlots9And10')}`,
    `acAioPowerPercentLimits=${state('acAioPowerPercentLimits')} frames=${count('acAioPowerPercentLimits')}`,
    'notExecutable=yes',
    'transportBinding=absent',
    'mutationCommit=no',
    'commandExposure=locked'
  ].join(' ');
}

function renderStage5OfflineFrameVerificationLine(report) {
  const state = (name) => report.plans && report.plans[name] ? report.plans[name].verificationState : 'blocked-or-unverified';
  const verified = (name) => report.plans && report.plans[name] ? report.plans[name].verifiedFrameCount : 0;
  const v = report.verification || {};
  return [
    'Stage 5 offline Function 06 frame verification:',
    `manualChargeSlot8=${state('manualChargeSlot8')} verifiedFrames=${verified('manualChargeSlot8')}`,
    `manualExportSlot8=${state('manualExportSlot8')} verifiedFrames=${verified('manualExportSlot8')}`,
    `cheapOvernightChargeSlots9And10=${state('cheapOvernightChargeSlots9And10')} verifiedFrames=${verified('cheapOvernightChargeSlots9And10')}`,
    `acAioPowerPercentLimits=${state('acAioPowerPercentLimits')} verifiedFrames=${verified('acAioPowerPercentLimits')}`,
    `totalFrames=${v.totalFrameCount || 0}`,
    `verifiedFrames=${v.totalVerifiedFrameCount || 0}`,
    `crcChecked=${v.crcChecked ? 'yes' : 'no'}`,
    `lengthChecked=${v.lengthChecked ? 'yes' : 'no'}`,
    `echoShapeChecked=${v.echoShapeChecked ? 'yes' : 'no'}`,
    `function06Checked=${v.function06Checked ? 'yes' : 'no'}`,
    'transportBinding=absent',
    'mutationCommit=no',
    'commandExposure=locked'
  ].join(' ');
}

module.exports = {
  WRITE_SINGLE_REGISTER_FUNCTION,
  STAGE5_OFFLINE_COMPOSER_VERSION,
  buildOfflineWriteSingleRegisterFrame,
  buildStage5OfflineWriteComposerReport,
  renderStage5OfflineComposerLine,
  renderStage5OfflineFramePlanLine,
  renderStage5OfflineFrameVerificationLine,
  summariseOfflineWriteFrame,
  verifyOfflineWriteFrame
};
