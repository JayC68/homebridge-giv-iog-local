'use strict';

const net = require('net');
const {
  CONNECT_TIMEOUT_MS,
  DEFAULT_UNIT_ADDRESS,
  DIRECT_LOCAL_DEFAULT_PORT,
  FRESH_ATTEMPT_GAP_MS,
  GENEROUS_CONNECT_TIMEOUT_MS,
  GENEROUS_READ_RESPONSE_TIMEOUT_MS,
  SHORT_CONNECT_TIMEOUT_MS,
  SHORT_OPPORTUNITY_COUNT,
  SHORT_READ_RESPONSE_TIMEOUT_MS
} = require('./evidence-led-constants');
const { DirectLocalReadOnlyClient } = require('./direct-modbus-client');
const {
  buildOfflineWriteSingleRegisterFrame,
  verifyOfflineWriteFrame,
  summariseOfflineWriteFrame
} = require('./stage5-offline-write-composer');

const STAGE5_LIVE_HARNESS_VERSION = 'givhome-1.0.0-gated-live-function06-harness';

function assertUInt16(name, value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${name} must be an unsigned 16-bit value`);
  }
}

function assertOptions(options = {}) {
  if (options.allowLiveSameValueWrite !== true) {
    throw new Error('live same-value write harness requires allowLiveSameValueWrite=true');
  }
  if (!options.host) {
    throw new Error('host is required');
  }
  assertUInt16('register', options.register);
}


function connectSocket({ host, port, connectTimeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      socket.removeListener('connect', onConnect);
      socket.removeListener('error', onError);
      socket.removeListener('timeout', onTimeout);
      if (err) {
        socket.destroy();
        reject(err);
      } else {
        resolve(socket);
      }
    };
    const onConnect = () => finish(null);
    const onError = (err) => finish(err);
    const onTimeout = () => finish(new Error('connect timed out'));
    socket.once('connect', onConnect);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
    socket.setTimeout(connectTimeoutMs || CONNECT_TIMEOUT_MS);
  });
}

async function connectSocketWithPreSendContinuity(options = {}) {
  if (options.enablePreSendGracefulContinuity === false) {
    return connectSocket(options);
  }

  let lastErr = null;
  for (let opportunity = 1; opportunity <= SHORT_OPPORTUNITY_COUNT; opportunity++) {
    try {
      const socket = await connectSocket({
        host: options.host,
        port: options.port,
        connectTimeoutMs: SHORT_CONNECT_TIMEOUT_MS
      });
      if (typeof options.onPreSendContinuityEvent === 'function') {
        options.onPreSendContinuityEvent({ phase: 'pre-send-connect', opportunity, opportunityKind: 'short', recovered: opportunity > 1, result: 'ok' });
      }
      return socket;
    } catch (err) {
      lastErr = err;
      if (typeof options.onPreSendContinuityEvent === 'function') {
        options.onPreSendContinuityEvent({ phase: 'pre-send-connect', opportunity, opportunityKind: 'short', result: 'fail', error: err && err.message ? err.message : String(err) });
      }
    }
    if (opportunity < SHORT_OPPORTUNITY_COUNT) {
      await sleep(FRESH_ATTEMPT_GAP_MS);
    }
  }

  await sleep(FRESH_ATTEMPT_GAP_MS);

  try {
    const socket = await connectSocket({
      host: options.host,
      port: options.port,
      connectTimeoutMs: GENEROUS_CONNECT_TIMEOUT_MS
    });
    if (typeof options.onPreSendContinuityEvent === 'function') {
      options.onPreSendContinuityEvent({ phase: 'pre-send-connect', opportunity: 'generous', opportunityKind: 'generous', recovered: true, result: 'ok' });
    }
    return socket;
  } catch (err) {
    lastErr = err;
    if (typeof options.onPreSendContinuityEvent === 'function') {
      options.onPreSendContinuityEvent({ phase: 'pre-send-connect', opportunity: 'generous', opportunityKind: 'generous', result: 'fail', exhausted: true, error: err && err.message ? err.message : String(err) });
    }
  }

  throw lastErr || new Error('connect timed out');
}

async function sendFunction06FrameOnce(options = {}) {
  const socket = await connectSocketWithPreSendContinuity(options);
  const frame = options.frame;
  const responseTimeoutMs = Number.isInteger(options.responseTimeoutMs) ? options.responseTimeoutMs : 1500;
  return new Promise((resolve) => {
    let settled = false;
    let payloadSent = false;
    const chunks = [];
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
      socket.destroy();
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Object.assign({ payloadSent }, value));
    };
    const onData = (chunk) => {
      chunks.push(chunk);
      finish({
        responseReceived: true,
        responseBytes: Buffer.concat(chunks).length,
        responseHex: Buffer.concat(chunks).toString('hex'),
        postSendError: ''
      });
    };
    const onError = (err) => finish({
      responseReceived: false,
      responseBytes: chunks.length > 0 ? Buffer.concat(chunks).length : 0,
      responseHex: chunks.length > 0 ? Buffer.concat(chunks).toString('hex') : '',
      postSendError: err && err.message ? err.message : String(err)
    });
    const onClose = () => finish({
      responseReceived: chunks.length > 0,
      responseBytes: chunks.length > 0 ? Buffer.concat(chunks).length : 0,
      responseHex: chunks.length > 0 ? Buffer.concat(chunks).toString('hex') : '',
      postSendError: chunks.length > 0 ? '' : 'connection closed after payload send'
    });
    timer = setTimeout(() => finish({
      responseReceived: false,
      responseBytes: 0,
      responseHex: '',
      postSendError: 'acknowledgement timed out after payload send'
    }), responseTimeoutMs);
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
    payloadSent = true;
    socket.write(frame);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLiveSameValueWriteHarness(options = {}) {
  assertOptions(options);
  const register = options.register;
  const port = Number.isInteger(options.port) ? options.port : DIRECT_LOCAL_DEFAULT_PORT;
  const deviceAddress = Number.isInteger(options.deviceAddress) ? options.deviceAddress : DEFAULT_UNIT_ADDRESS;
  const connectTimeoutMs = Number.isInteger(options.connectTimeoutMs) ? options.connectTimeoutMs : CONNECT_TIMEOUT_MS;
  const readTimeoutMs = Number.isInteger(options.readTimeoutMs) ? options.readTimeoutMs : GENEROUS_READ_RESPONSE_TIMEOUT_MS;
  const responseTimeoutMs = Number.isInteger(options.responseTimeoutMs) ? options.responseTimeoutMs : 1500;
  const clientOptions = {
    host: options.host,
    port,
    deviceAddress,
    adapterSerial: options.adapterSerial,
    connectTimeoutMs,
    readTimeoutMs
  };

  const client = new DirectLocalReadOnlyClient(clientOptions);
  const pre = await client.readHoldingRegisters(register, 1);
  const originalValue = pre.values[0];
  const frame = buildOfflineWriteSingleRegisterFrame({
    adapterSerial: options.adapterSerial,
    deviceAddress,
    register,
    value: originalValue
  });
  const frameVerification = verifyOfflineWriteFrame(frame);
  if (!frameVerification.ok) {
    throw new Error('offline Function 06 frame verification failed before live send');
  }

  const writeResponse = await sendFunction06FrameOnce({
    host: options.host,
    port,
    connectTimeoutMs,
    responseTimeoutMs,
    frame
  });

  const post = await client.readHoldingRegisters(register, 1);
  const postValue = post.values[0];
  let restoreAttempted = false;
  let restoreSucceeded = false;
  let restoreError = '';

  if (postValue !== originalValue) {
    restoreAttempted = true;
    try {
      const restoreFrame = buildOfflineWriteSingleRegisterFrame({
        adapterSerial: options.adapterSerial,
        deviceAddress,
        register,
        value: originalValue
      });
      await sendFunction06FrameOnce({
        host: options.host,
        port,
        connectTimeoutMs,
        responseTimeoutMs,
        frame: restoreFrame
      });
      const restored = await client.readHoldingRegisters(register, 1);
      restoreSucceeded = restored.values[0] === originalValue;
    } catch (err) {
      restoreError = err && err.message ? err.message : String(err);
    }
  }

  return {
    stage: 'GivHome 1.0.0 gated live reversible HR313/HR314/configured-HR261 Function 06 harness',
    version: STAGE5_LIVE_HARNESS_VERSION,
    target: `${options.host}:${port}`,
    unit: deviceAddress,
    register,
    originalValue,
    requestedValue: originalValue,
    sameValueOnly: true,
    preReadOk: true,
    writeFrameVerified: frameVerification.ok,
    writeFrameSummary: summariseOfflineWriteFrame(frame),
    writeResponse,
    postValue,
    readbackMatches: postValue === originalValue,
    restoreAttempted,
    restoreSucceeded,
    restoreError,
    mutationIntent: 'same-value-round-trip-only',
    commandTilesAvailable: false,
    requestBinding: 'manual-terminal-harness-only',
    automaticMutationPath: 'absent',
    ok: postValue === originalValue && restoreAttempted === false
  };
}

function renderLiveSameValueHarnessResult(result) {
  return [
    'Stage 5 live same-value Function 06 harness:',
    `register=HR${result.register}`,
    `preRead=${result.originalValue}`,
    `requestedValue=${result.requestedValue}`,
    `postRead=${result.postValue}`,
    `sameValueOnly=${result.sameValueOnly ? 'yes' : 'no'}`,
    `writeFrameVerified=${result.writeFrameVerified ? 'yes' : 'no'}`,
    `writeResponse=${result.writeResponse && result.writeResponse.responseReceived ? 'received' : 'not-required-or-timeout'}`,
    `readbackMatches=${result.readbackMatches ? 'yes' : 'no'}`,
    `restoreAttempted=${result.restoreAttempted ? 'yes' : 'no'}`,
    `commandTiles=disabled`,
    `automaticMutationPath=absent`,
    `liveHarnessResult=${result.ok ? 'PASS' : 'FAIL'}`
  ].join(' ');
}


function safeReversibleTargetValue(originalValue, options = {}) {
  const delta = Number.isInteger(options.delta) ? options.delta : -1;
  const candidate = originalValue + delta;
  if (!Number.isInteger(candidate) || candidate < 0 || candidate > 100) {
    throw new Error(`no safe reversible target from originalValue=${originalValue} delta=${delta}`);
  }
  if (candidate === originalValue) {
    throw new Error('reversible target must differ from original value');
  }
  return candidate;
}

async function writeRegisterFrameAndReadBack(clientOptions, register, value, label, timings = {}) {
  const frame = buildOfflineWriteSingleRegisterFrame({
    adapterSerial: clientOptions.adapterSerial,
    deviceAddress: clientOptions.deviceAddress,
    register,
    value
  });
  const frameVerification = verifyOfflineWriteFrame(frame);
  if (!frameVerification.ok) {
    throw new Error(`${label} Function 06 frame verification failed before live send`);
  }
  const writeResponse = await sendFunction06FrameOnce({
    host: clientOptions.host,
    port: clientOptions.port,
    connectTimeoutMs: clientOptions.connectTimeoutMs,
    responseTimeoutMs: timings.responseTimeoutMs,
    frame
  });
  const client = new DirectLocalReadOnlyClient(clientOptions);
  const read = await client.readHoldingRegisters(register, 1);
  return {
    label,
    requestedValue: value,
    postReadValue: read.values[0],
    frameVerified: frameVerification.ok,
    writeResponse,
    readbackMatches: read.values[0] === value
  };
}

async function runLiveReversibleHr313Harness(options = {}) {
  if (options.allowLiveReversibleWrite !== true) {
    throw new Error('live reversible write harness requires allowLiveReversibleWrite=true');
  }
  const register = Number.isInteger(options.register) ? options.register : 313;
  if (register !== 313) {
    throw new Error('GivHome 1.0.0 reversible harness is deliberately limited to HR313');
  }
  assertOptions({ ...options, allowLiveSameValueWrite: true, register });

  const port = Number.isInteger(options.port) ? options.port : DIRECT_LOCAL_DEFAULT_PORT;
  const deviceAddress = Number.isInteger(options.deviceAddress) ? options.deviceAddress : DEFAULT_UNIT_ADDRESS;
  const connectTimeoutMs = Number.isInteger(options.connectTimeoutMs) ? options.connectTimeoutMs : CONNECT_TIMEOUT_MS;
  const readTimeoutMs = Number.isInteger(options.readTimeoutMs) ? options.readTimeoutMs : GENEROUS_READ_RESPONSE_TIMEOUT_MS;
  const responseTimeoutMs = Number.isInteger(options.responseTimeoutMs) ? options.responseTimeoutMs : 1500;
  const clientOptions = {
    host: options.host,
    port,
    deviceAddress,
    adapterSerial: options.adapterSerial,
    connectTimeoutMs,
    readTimeoutMs
  };

  const client = new DirectLocalReadOnlyClient(clientOptions);
  const pre = await client.readHoldingRegisters(register, 1);
  const originalValue = pre.values[0];
  const temporaryValue = safeReversibleTargetValue(originalValue, options);

  let temporaryWrite;
  let restoreWrite;
  let restoreAttempted = false;
  let restoreSucceeded = false;
  let restoreError = '';

  try {
    temporaryWrite = await writeRegisterFrameAndReadBack(clientOptions, register, temporaryValue, 'temporary-live-write', { responseTimeoutMs });
  } finally {
    restoreAttempted = true;
    try {
      restoreWrite = await writeRegisterFrameAndReadBack(clientOptions, register, originalValue, 'restore-live-write', { responseTimeoutMs });
      restoreSucceeded = restoreWrite.readbackMatches === true;
    } catch (err) {
      restoreError = err && err.message ? err.message : String(err);
    }
  }

  const temporaryReadbackMatches = !!(temporaryWrite && temporaryWrite.readbackMatches);
  const finalValue = restoreWrite ? restoreWrite.postReadValue : null;
  const ok = temporaryReadbackMatches && restoreAttempted && restoreSucceeded && finalValue === originalValue;

  return {
    stage: 'GivHome 1.0.0 gated live reversible HR313/HR314/configured-HR261 Function 06 harness',
    version: 'givhome-1.0.0-gated-live-reversible-hr313-function06-harness',
    target: `${options.host}:${port}`,
    unit: deviceAddress,
    register,
    originalValue,
    temporaryValue,
    finalValue,
    sameValueOnly: false,
    reversibleOnly: true,
    temporaryWriteFrameVerified: !!(temporaryWrite && temporaryWrite.frameVerified),
    temporaryWriteResponseReceived: !!(temporaryWrite && temporaryWrite.writeResponse && temporaryWrite.writeResponse.responseReceived),
    temporaryReadbackMatches,
    restoreAttempted,
    restoreFrameVerified: !!(restoreWrite && restoreWrite.frameVerified),
    restoreResponseReceived: !!(restoreWrite && restoreWrite.writeResponse && restoreWrite.writeResponse.responseReceived),
    restoreSucceeded,
    restoreError,
    readbackMatchesOriginalAfterRestore: finalValue === originalValue,
    mutationIntent: 'bounded-reversible-hr313-round-trip-only',
    commandTilesAvailable: false,
    requestBinding: 'manual-terminal-harness-only',
    automaticMutationPath: 'absent',
    ok
  };
}

async function runLiveReversibleHr314Harness(options = {}) {
  if (options.allowLiveReversibleWrite !== true) {
    throw new Error('live reversible write harness requires allowLiveReversibleWrite=true');
  }
  const register = Number.isInteger(options.register) ? options.register : 314;
  if (register !== 314) {
    throw new Error('GivHome 1.0.0 reversible harness is deliberately limited to HR314');
  }
  assertOptions({ ...options, allowLiveSameValueWrite: true, register });

  const port = Number.isInteger(options.port) ? options.port : DIRECT_LOCAL_DEFAULT_PORT;
  const deviceAddress = Number.isInteger(options.deviceAddress) ? options.deviceAddress : DEFAULT_UNIT_ADDRESS;
  const connectTimeoutMs = Number.isInteger(options.connectTimeoutMs) ? options.connectTimeoutMs : CONNECT_TIMEOUT_MS;
  const readTimeoutMs = Number.isInteger(options.readTimeoutMs) ? options.readTimeoutMs : GENEROUS_READ_RESPONSE_TIMEOUT_MS;
  const responseTimeoutMs = Number.isInteger(options.responseTimeoutMs) ? options.responseTimeoutMs : 1500;
  const clientOptions = {
    host: options.host,
    port,
    deviceAddress,
    adapterSerial: options.adapterSerial,
    connectTimeoutMs,
    readTimeoutMs
  };

  const client = new DirectLocalReadOnlyClient(clientOptions);
  const pre = await client.readHoldingRegisters(register, 1);
  const originalValue = pre.values[0];
  const temporaryValue = safeReversibleTargetValue(originalValue, options);

  let temporaryWrite;
  let restoreWrite;
  let restoreAttempted = false;
  let restoreSucceeded = false;
  let restoreError = '';

  try {
    temporaryWrite = await writeRegisterFrameAndReadBack(clientOptions, register, temporaryValue, 'temporary-live-write', { responseTimeoutMs });
  } finally {
    restoreAttempted = true;
    try {
      restoreWrite = await writeRegisterFrameAndReadBack(clientOptions, register, originalValue, 'restore-live-write', { responseTimeoutMs });
      restoreSucceeded = restoreWrite.readbackMatches === true;
    } catch (err) {
      restoreError = err && err.message ? err.message : String(err);
    }
  }

  const temporaryReadbackMatches = !!(temporaryWrite && temporaryWrite.readbackMatches);
  const finalValue = restoreWrite ? restoreWrite.postReadValue : null;
  const ok = temporaryReadbackMatches && restoreAttempted && restoreSucceeded && finalValue === originalValue;

  return {
    stage: 'GivHome 1.0.0 gated live reversible HR314 Function 06 harness',
    version: 'givhome-1.0.0-gated-live-reversible-hr314-function06-harness',
    target: `${options.host}:${port}`,
    unit: deviceAddress,
    register,
    originalValue,
    temporaryValue,
    finalValue,
    sameValueOnly: false,
    reversibleOnly: true,
    temporaryWriteFrameVerified: !!(temporaryWrite && temporaryWrite.frameVerified),
    temporaryWriteResponseReceived: !!(temporaryWrite && temporaryWrite.writeResponse && temporaryWrite.writeResponse.responseReceived),
    temporaryReadbackMatches,
    restoreAttempted,
    restoreFrameVerified: !!(restoreWrite && restoreWrite.frameVerified),
    restoreResponseReceived: !!(restoreWrite && restoreWrite.writeResponse && restoreWrite.writeResponse.responseReceived),
    restoreSucceeded,
    restoreError,
    readbackMatchesOriginalAfterRestore: finalValue === originalValue,
    mutationIntent: 'bounded-reversible-hr314-round-trip-only',
    commandTilesAvailable: false,
    requestBinding: 'manual-terminal-harness-only',
    automaticMutationPath: 'absent',
    ok
  };
}


function safeDisabledSlotTimeTargetValue(originalValue) {
  const candidates = [1, 2, 3, 5, 10, 15, 30, 45, 100];
  for (const candidate of candidates) {
    if (candidate !== originalValue) return candidate;
  }
  throw new Error(`no safe dormant-slot time target from originalValue=${originalValue}`);
}

async function runLiveReversibleDormantHr261Harness(options = {}) {
  if (options.allowLiveReversibleWrite !== true) {
    throw new Error('live reversible dormant slot harness requires allowLiveReversibleWrite=true');
  }
  const register = Number.isInteger(options.register) ? options.register : 261;
  if (register !== 261) {
    throw new Error('GivHome 1.0.0 dormant-slot reversible harness is deliberately limited to HR261');
  }
  assertOptions({ ...options, allowLiveSameValueWrite: true, register });

  const port = Number.isInteger(options.port) ? options.port : DIRECT_LOCAL_DEFAULT_PORT;
  const deviceAddress = Number.isInteger(options.deviceAddress) ? options.deviceAddress : DEFAULT_UNIT_ADDRESS;
  const connectTimeoutMs = Number.isInteger(options.connectTimeoutMs) ? options.connectTimeoutMs : CONNECT_TIMEOUT_MS;
  const readTimeoutMs = Number.isInteger(options.readTimeoutMs) ? options.readTimeoutMs : GENEROUS_READ_RESPONSE_TIMEOUT_MS;
  const responseTimeoutMs = Number.isInteger(options.responseTimeoutMs) ? options.responseTimeoutMs : 1500;
  const clientOptions = {
    host: options.host,
    port,
    deviceAddress,
    adapterSerial: options.adapterSerial,
    connectTimeoutMs,
    readTimeoutMs
  };

  const client = new DirectLocalReadOnlyClient(clientOptions);
  const group = await client.readHoldingRegisters(261, 3);
  const originalStart = group.values[0];
  const originalEnd = group.values[1];
  const originalTarget = group.values[2];
  if (originalStart !== 0 || originalEnd !== 0) {
    throw new Error(`HR261 dormant-slot harness refused: slot start/end not dormant HR261=${originalStart} HR262=${originalEnd}; HR263 target=${originalTarget} preserved`);
  }
  if (!Number.isInteger(originalTarget) || originalTarget < 0 || originalTarget > 100) {
    throw new Error(`HR261 dormant-slot harness refused: HR263 target=${originalTarget} outside expected 0-100 preserve range`);
  }

  const temporaryValue = safeDisabledSlotTimeTargetValue(originalStart);
  let temporaryWrite;
  let restoreWrite;
  let restoreAttempted = false;
  let restoreSucceeded = false;
  let restoreError = '';
  let finalGroup = null;

  try {
    temporaryWrite = await writeRegisterFrameAndReadBack(clientOptions, register, temporaryValue, 'temporary-live-write-dormant-slot-start', { responseTimeoutMs });
  } finally {
    restoreAttempted = true;
    try {
      restoreWrite = await writeRegisterFrameAndReadBack(clientOptions, register, originalStart, 'restore-live-write-dormant-slot-start', { responseTimeoutMs });
      finalGroup = await client.readHoldingRegisters(261, 3);
      restoreSucceeded = restoreWrite.readbackMatches === true && finalGroup.values[0] === originalStart && finalGroup.values[1] === originalEnd && finalGroup.values[2] === originalTarget;
    } catch (err) {
      restoreError = err && err.message ? err.message : String(err);
    }
  }

  const temporaryReadbackMatches = !!(temporaryWrite && temporaryWrite.readbackMatches);
  const finalStart = finalGroup ? finalGroup.values[0] : (restoreWrite ? restoreWrite.postReadValue : null);
  const finalEnd = finalGroup ? finalGroup.values[1] : null;
  const finalTarget = finalGroup ? finalGroup.values[2] : null;
  const ok = temporaryReadbackMatches && restoreAttempted && restoreSucceeded && finalStart === originalStart && finalEnd === originalEnd && finalTarget === originalTarget;

  return {
    stage: 'GivHome 1.0.0 gated live reversible dormant charge-slot HR261 start Function 06 harness',
    version: 'givhome-1.0.0-gated-live-reversible-dormant-hr261-start-function06-harness',
    target: `${options.host}:${port}`,
    unit: deviceAddress,
    register,
    originalValue: originalStart,
    originalEnd,
    originalTarget,
    temporaryValue,
    finalValue: finalStart,
    finalEnd,
    finalTarget,
    sameValueOnly: false,
    reversibleOnly: true,
    dormantSlotOnly: true,
    temporaryWriteFrameVerified: !!(temporaryWrite && temporaryWrite.frameVerified),
    temporaryWriteResponseReceived: !!(temporaryWrite && temporaryWrite.writeResponse && temporaryWrite.writeResponse.responseReceived),
    temporaryReadbackMatches,
    restoreAttempted,
    restoreFrameVerified: !!(restoreWrite && restoreWrite.frameVerified),
    restoreResponseReceived: !!(restoreWrite && restoreWrite.writeResponse && restoreWrite.writeResponse.responseReceived),
    restoreSucceeded,
    restoreError,
    readbackMatchesOriginalAfterRestore: finalStart === originalStart && finalEnd === originalEnd && finalTarget === originalTarget,
    mutationIntent: 'bounded-reversible-dormant-start-only-hr261-round-trip-only',
    commandTilesAvailable: false,
    requestBinding: 'manual-terminal-harness-only',
    automaticMutationPath: 'absent',
    ok
  };
}


function isValidHmm(value) {
  if (!Number.isInteger(value) || value < 0 || value > 2359) return false;
  const minutes = value % 100;
  const hours = Math.floor(value / 100);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function hmmToMinutes(value) {
  if (!isValidHmm(value)) {
    throw new Error(`invalid HHMM value ${value}`);
  }
  return Math.floor(value / 100) * 60 + (value % 100);
}

function minutesToHmm(totalMinutes) {
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0 || totalMinutes >= 24 * 60) {
    throw new Error(`invalid minute-of-day value ${totalMinutes}`);
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours * 100 + minutes;
}

function nowHmm() {
  const d = new Date();
  return d.getHours() * 100 + d.getMinutes();
}

function isHmmWithinSlot(nowValue, startValue, endValue) {
  if (!isValidHmm(nowValue) || !isValidHmm(startValue) || !isValidHmm(endValue)) return false;
  const nowMinutes = hmmToMinutes(nowValue);
  const startMinutes = hmmToMinutes(startValue);
  const endMinutes = hmmToMinutes(endValue);
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function safeConfiguredSlotStartTargetValue(originalStart, originalEnd) {
  if (!isValidHmm(originalStart) || !isValidHmm(originalEnd)) {
    throw new Error(`configured-slot harness refused: invalid start/end HR261=${originalStart} HR262=${originalEnd}`);
  }
  const startMinutes = hmmToMinutes(originalStart);
  const endMinutes = hmmToMinutes(originalEnd);
  const candidates = [startMinutes + 1, startMinutes - 1, startMinutes + 2, startMinutes - 2];
  for (const candidateMinutes of candidates) {
    if (!Number.isInteger(candidateMinutes) || candidateMinutes < 0 || candidateMinutes >= 24 * 60) continue;
    if (candidateMinutes === endMinutes) continue;
    const candidate = minutesToHmm(candidateMinutes);
    if (candidate !== originalStart && isValidHmm(candidate)) return candidate;
  }
  throw new Error(`no safe configured-slot start target from HR261=${originalStart} HR262=${originalEnd}`);
}

async function runLiveReversibleConfiguredHr261Harness(options = {}) {
  if (options.allowLiveReversibleWrite !== true) {
    throw new Error('live reversible configured slot harness requires allowLiveReversibleWrite=true');
  }
  const register = Number.isInteger(options.register) ? options.register : 261;
  if (register !== 261) {
    throw new Error('GivHome 1.0.0 configured-slot reversible harness is deliberately limited to HR261');
  }
  assertOptions({ ...options, allowLiveSameValueWrite: true, register });

  const port = Number.isInteger(options.port) ? options.port : DIRECT_LOCAL_DEFAULT_PORT;
  const deviceAddress = Number.isInteger(options.deviceAddress) ? options.deviceAddress : DEFAULT_UNIT_ADDRESS;
  const connectTimeoutMs = Number.isInteger(options.connectTimeoutMs) ? options.connectTimeoutMs : CONNECT_TIMEOUT_MS;
  const readTimeoutMs = Number.isInteger(options.readTimeoutMs) ? options.readTimeoutMs : GENEROUS_READ_RESPONSE_TIMEOUT_MS;
  const responseTimeoutMs = Number.isInteger(options.responseTimeoutMs) ? options.responseTimeoutMs : 1500;
  const clientOptions = {
    host: options.host,
    port,
    deviceAddress,
    adapterSerial: options.adapterSerial,
    connectTimeoutMs,
    readTimeoutMs
  };

  const client = new DirectLocalReadOnlyClient(clientOptions);
  const group = await client.readHoldingRegisters(261, 3);
  const originalStart = group.values[0];
  const originalEnd = group.values[1];
  const originalTarget = group.values[2];

  if (!isValidHmm(originalStart) || !isValidHmm(originalEnd) || originalStart === 0 || originalEnd === 0 || originalStart === originalEnd) {
    throw new Error(`HR261 configured-slot harness refused: slot start/end not configured or invalid HR261=${originalStart} HR262=${originalEnd}; HR263 target=${originalTarget} preserved`);
  }
  if (!Number.isInteger(originalTarget) || originalTarget < 0 || originalTarget > 100) {
    throw new Error(`HR261 configured-slot harness refused: HR263 target=${originalTarget} outside expected 0-100 preserve range`);
  }

  const nowValue = Number.isInteger(options.nowHmm) ? options.nowHmm : nowHmm();
  if (!isValidHmm(nowValue)) {
    throw new Error(`HR261 configured-slot harness refused: invalid current HHMM ${nowValue}`);
  }
  if (isHmmWithinSlot(nowValue, originalStart, originalEnd) && options.allowCurrentlyActiveSlot !== true) {
    throw new Error(`HR261 configured-slot harness refused: current time ${nowValue} is inside configured slot HR261=${originalStart} HR262=${originalEnd}`);
  }

  const temporaryValue = safeConfiguredSlotStartTargetValue(originalStart, originalEnd);
  let temporaryWrite;
  let restoreWrite;
  let restoreAttempted = false;
  let restoreSucceeded = false;
  let restoreError = '';
  let finalGroup = null;

  try {
    temporaryWrite = await writeRegisterFrameAndReadBack(clientOptions, register, temporaryValue, 'temporary-live-write-configured-slot-start', { responseTimeoutMs });
  } finally {
    restoreAttempted = true;
    try {
      restoreWrite = await writeRegisterFrameAndReadBack(clientOptions, register, originalStart, 'restore-live-write-configured-slot-start', { responseTimeoutMs });
      finalGroup = await client.readHoldingRegisters(261, 3);
      restoreSucceeded = restoreWrite.readbackMatches === true && finalGroup.values[0] === originalStart && finalGroup.values[1] === originalEnd && finalGroup.values[2] === originalTarget;
    } catch (err) {
      restoreError = err && err.message ? err.message : String(err);
    }
  }

  const temporaryReadbackMatches = !!(temporaryWrite && temporaryWrite.readbackMatches);
  const finalStart = finalGroup ? finalGroup.values[0] : (restoreWrite ? restoreWrite.postReadValue : null);
  const finalEnd = finalGroup ? finalGroup.values[1] : null;
  const finalTarget = finalGroup ? finalGroup.values[2] : null;
  const ok = temporaryReadbackMatches && restoreAttempted && restoreSucceeded && finalStart === originalStart && finalEnd === originalEnd && finalTarget === originalTarget;

  return {
    stage: 'GivHome 1.0.0 gated live reversible configured charge-slot HR261 start Function 06 harness',
    version: 'givhome-1.0.0-gated-live-reversible-configured-hr261-start-function06-harness',
    target: `${options.host}:${port}`,
    unit: deviceAddress,
    register,
    originalValue: originalStart,
    originalEnd,
    originalTarget,
    currentHmm: nowValue,
    temporaryValue,
    finalValue: finalStart,
    finalEnd,
    finalTarget,
    sameValueOnly: false,
    reversibleOnly: true,
    configuredSlotOnly: true,
    currentTimeOutsideSlot: !isHmmWithinSlot(nowValue, originalStart, originalEnd),
    temporaryWriteFrameVerified: !!(temporaryWrite && temporaryWrite.frameVerified),
    temporaryWriteResponseReceived: !!(temporaryWrite && temporaryWrite.writeResponse && temporaryWrite.writeResponse.responseReceived),
    temporaryReadbackMatches,
    restoreAttempted,
    restoreFrameVerified: !!(restoreWrite && restoreWrite.frameVerified),
    restoreResponseReceived: !!(restoreWrite && restoreWrite.writeResponse && restoreWrite.writeResponse.responseReceived),
    restoreSucceeded,
    restoreError,
    readbackMatchesOriginalAfterRestore: finalStart === originalStart && finalEnd === originalEnd && finalTarget === originalTarget,
    mutationIntent: 'bounded-reversible-configured-start-only-hr261-round-trip-only',
    commandTilesAvailable: false,
    requestBinding: 'manual-terminal-harness-only',
    automaticMutationPath: 'absent',
    ok
  };
}

function safeConfiguredSlotEndTargetValue(originalStart, originalEnd) {
  if (!isValidHmm(originalStart) || !isValidHmm(originalEnd)) {
    throw new Error(`configured-slot end harness refused: invalid start/end HR261=${originalStart} HR262=${originalEnd}`);
  }
  const startMinutes = hmmToMinutes(originalStart);
  const endMinutes = hmmToMinutes(originalEnd);
  const candidates = [endMinutes + 1, endMinutes - 1, endMinutes + 2, endMinutes - 2];
  for (const candidateMinutes of candidates) {
    if (!Number.isInteger(candidateMinutes) || candidateMinutes < 0 || candidateMinutes >= 24 * 60) continue;
    if (candidateMinutes === startMinutes) continue;
    const candidate = minutesToHmm(candidateMinutes);
    if (candidate !== originalEnd && isValidHmm(candidate)) return candidate;
  }
  throw new Error(`no safe configured-slot end target from HR261=${originalStart} HR262=${originalEnd}`);
}

async function runLiveReversibleConfiguredHr262Harness(options = {}) {
  if (options.allowLiveReversibleWrite !== true) {
    throw new Error('live reversible configured slot end harness requires allowLiveReversibleWrite=true');
  }
  const register = Number.isInteger(options.register) ? options.register : 262;
  if (register !== 262) {
    throw new Error('GivHome 1.0.0 configured-slot reversible end harness is deliberately limited to HR262');
  }
  assertOptions({ ...options, allowLiveSameValueWrite: true, register });

  const port = Number.isInteger(options.port) ? options.port : DIRECT_LOCAL_DEFAULT_PORT;
  const deviceAddress = Number.isInteger(options.deviceAddress) ? options.deviceAddress : DEFAULT_UNIT_ADDRESS;
  const connectTimeoutMs = Number.isInteger(options.connectTimeoutMs) ? options.connectTimeoutMs : CONNECT_TIMEOUT_MS;
  const readTimeoutMs = Number.isInteger(options.readTimeoutMs) ? options.readTimeoutMs : GENEROUS_READ_RESPONSE_TIMEOUT_MS;
  const responseTimeoutMs = Number.isInteger(options.responseTimeoutMs) ? options.responseTimeoutMs : 1500;
  const clientOptions = {
    host: options.host,
    port,
    deviceAddress,
    adapterSerial: options.adapterSerial,
    connectTimeoutMs,
    readTimeoutMs
  };

  const client = new DirectLocalReadOnlyClient(clientOptions);
  const group = await client.readHoldingRegisters(261, 3);
  const originalStart = group.values[0];
  const originalEnd = group.values[1];
  const originalTarget = group.values[2];

  if (!isValidHmm(originalStart) || !isValidHmm(originalEnd) || originalStart === 0 || originalEnd === 0 || originalStart === originalEnd) {
    throw new Error(`HR262 configured-slot harness refused: slot start/end not configured or invalid HR261=${originalStart} HR262=${originalEnd}; HR263 target=${originalTarget} preserved`);
  }
  if (!Number.isInteger(originalTarget) || originalTarget < 0 || originalTarget > 100) {
    throw new Error(`HR262 configured-slot harness refused: HR263 target=${originalTarget} outside expected 0-100 preserve range`);
  }

  const nowValue = Number.isInteger(options.nowHmm) ? options.nowHmm : nowHmm();
  if (!isValidHmm(nowValue)) {
    throw new Error(`HR262 configured-slot harness refused: invalid current HHMM ${nowValue}`);
  }
  if (isHmmWithinSlot(nowValue, originalStart, originalEnd) && options.allowCurrentlyActiveSlot !== true) {
    throw new Error(`HR262 configured-slot harness refused: current time ${nowValue} is inside configured slot HR261=${originalStart} HR262=${originalEnd}`);
  }

  const temporaryValue = safeConfiguredSlotEndTargetValue(originalStart, originalEnd);
  let temporaryWrite;
  let restoreWrite;
  let restoreAttempted = false;
  let restoreSucceeded = false;
  let restoreError = '';
  let finalGroup = null;

  try {
    temporaryWrite = await writeRegisterFrameAndReadBack(clientOptions, register, temporaryValue, 'temporary-live-write-configured-slot-end', { responseTimeoutMs });
  } finally {
    restoreAttempted = true;
    try {
      restoreWrite = await writeRegisterFrameAndReadBack(clientOptions, register, originalEnd, 'restore-live-write-configured-slot-end', { responseTimeoutMs });
      finalGroup = await client.readHoldingRegisters(261, 3);
      restoreSucceeded = restoreWrite.readbackMatches === true && finalGroup.values[0] === originalStart && finalGroup.values[1] === originalEnd && finalGroup.values[2] === originalTarget;
    } catch (err) {
      restoreError = err && err.message ? err.message : String(err);
    }
  }

  const temporaryReadbackMatches = !!(temporaryWrite && temporaryWrite.readbackMatches);
  const finalStart = finalGroup ? finalGroup.values[0] : null;
  const finalEnd = finalGroup ? finalGroup.values[1] : (restoreWrite ? restoreWrite.postReadValue : null);
  const finalTarget = finalGroup ? finalGroup.values[2] : null;
  const ok = temporaryReadbackMatches && restoreAttempted && restoreSucceeded && finalStart === originalStart && finalEnd === originalEnd && finalTarget === originalTarget;

  return {
    stage: 'GivHome 1.0.0 gated live reversible configured charge-slot HR262 end Function 06 harness',
    version: 'givhome-1.0.0-gated-live-reversible-configured-hr262-end-function06-harness',
    target: `${options.host}:${port}`,
    unit: deviceAddress,
    register,
    originalValue: originalEnd,
    originalStart,
    originalEnd,
    originalTarget,
    currentHmm: nowValue,
    temporaryValue,
    finalValue: finalEnd,
    finalStart,
    finalEnd,
    finalTarget,
    sameValueOnly: false,
    reversibleOnly: true,
    configuredSlotOnly: true,
    currentTimeOutsideSlot: !isHmmWithinSlot(nowValue, originalStart, originalEnd),
    temporaryWriteFrameVerified: !!(temporaryWrite && temporaryWrite.frameVerified),
    temporaryWriteResponseReceived: !!(temporaryWrite && temporaryWrite.writeResponse && temporaryWrite.writeResponse.responseReceived),
    temporaryReadbackMatches,
    restoreAttempted,
    restoreFrameVerified: !!(restoreWrite && restoreWrite.frameVerified),
    restoreResponseReceived: !!(restoreWrite && restoreWrite.writeResponse && restoreWrite.writeResponse.responseReceived),
    restoreSucceeded,
    restoreError,
    readbackMatchesOriginalAfterRestore: finalStart === originalStart && finalEnd === originalEnd && finalTarget === originalTarget,
    mutationIntent: 'bounded-reversible-configured-end-only-hr262-round-trip-only',
    commandTilesAvailable: false,
    requestBinding: 'manual-terminal-harness-only',
    automaticMutationPath: 'absent',
    ok
  };
}


function safeConfiguredSlotTargetTargetValue(originalTarget) {
  if (!Number.isInteger(originalTarget) || originalTarget < 0 || originalTarget > 100) {
    throw new Error(`configured-slot target harness refused: HR263 target=${originalTarget} outside expected 0-100 range`);
  }
  const candidates = [originalTarget - 1, originalTarget + 1, originalTarget - 2, originalTarget + 2, 99, 100, 50];
  for (const candidate of candidates) {
    if (!Number.isInteger(candidate) || candidate < 0 || candidate > 100) continue;
    if (candidate !== originalTarget) return candidate;
  }
  throw new Error(`no safe configured-slot target value from HR263=${originalTarget}`);
}

async function runLiveReversibleConfiguredHr263Harness(options = {}) {
  if (options.allowLiveReversibleWrite !== true) {
    throw new Error('live reversible configured slot target harness requires allowLiveReversibleWrite=true');
  }
  const register = Number.isInteger(options.register) ? options.register : 263;
  if (register !== 263) {
    throw new Error('GivHome 1.0.0 configured-slot reversible target harness is deliberately limited to HR263');
  }
  assertOptions({ ...options, allowLiveSameValueWrite: true, register });

  const port = Number.isInteger(options.port) ? options.port : DIRECT_LOCAL_DEFAULT_PORT;
  const deviceAddress = Number.isInteger(options.deviceAddress) ? options.deviceAddress : DEFAULT_UNIT_ADDRESS;
  const connectTimeoutMs = Number.isInteger(options.connectTimeoutMs) ? options.connectTimeoutMs : CONNECT_TIMEOUT_MS;
  const readTimeoutMs = Number.isInteger(options.readTimeoutMs) ? options.readTimeoutMs : GENEROUS_READ_RESPONSE_TIMEOUT_MS;
  const responseTimeoutMs = Number.isInteger(options.responseTimeoutMs) ? options.responseTimeoutMs : 1500;
  const clientOptions = {
    host: options.host,
    port,
    deviceAddress,
    adapterSerial: options.adapterSerial,
    connectTimeoutMs,
    readTimeoutMs
  };

  const client = new DirectLocalReadOnlyClient(clientOptions);
  const group = await client.readHoldingRegisters(261, 3);
  const originalStart = group.values[0];
  const originalEnd = group.values[1];
  const originalTarget = group.values[2];

  if (!isValidHmm(originalStart) || !isValidHmm(originalEnd) || originalStart === 0 || originalEnd === 0 || originalStart === originalEnd) {
    throw new Error(`HR263 configured-slot harness refused: slot start/end not configured or invalid HR261=${originalStart} HR262=${originalEnd}; HR263 target=${originalTarget}`);
  }
  if (!Number.isInteger(originalTarget) || originalTarget < 0 || originalTarget > 100) {
    throw new Error(`HR263 configured-slot harness refused: HR263 target=${originalTarget} outside expected 0-100 preserve range`);
  }

  const nowValue = Number.isInteger(options.nowHmm) ? options.nowHmm : nowHmm();
  if (!isValidHmm(nowValue)) {
    throw new Error(`HR263 configured-slot harness refused: invalid current HHMM ${nowValue}`);
  }
  if (isHmmWithinSlot(nowValue, originalStart, originalEnd) && options.allowCurrentlyActiveSlot !== true) {
    throw new Error(`HR263 configured-slot harness refused: current time ${nowValue} is inside configured slot HR261=${originalStart} HR262=${originalEnd}`);
  }

  const temporaryValue = safeConfiguredSlotTargetTargetValue(originalTarget);
  let temporaryWrite;
  let restoreWrite;
  let restoreAttempted = false;
  let restoreSucceeded = false;
  let restoreError = '';
  let finalGroup = null;

  try {
    temporaryWrite = await writeRegisterFrameAndReadBack(clientOptions, register, temporaryValue, 'temporary-live-write-configured-slot-target', { responseTimeoutMs });
  } finally {
    restoreAttempted = true;
    try {
      restoreWrite = await writeRegisterFrameAndReadBack(clientOptions, register, originalTarget, 'restore-live-write-configured-slot-target', { responseTimeoutMs });
      finalGroup = await client.readHoldingRegisters(261, 3);
      restoreSucceeded = restoreWrite.readbackMatches === true && finalGroup.values[0] === originalStart && finalGroup.values[1] === originalEnd && finalGroup.values[2] === originalTarget;
    } catch (err) {
      restoreError = err && err.message ? err.message : String(err);
    }
  }

  const temporaryReadbackMatches = !!(temporaryWrite && temporaryWrite.readbackMatches);
  const finalStart = finalGroup ? finalGroup.values[0] : null;
  const finalEnd = finalGroup ? finalGroup.values[1] : null;
  const finalTarget = finalGroup ? finalGroup.values[2] : (restoreWrite ? restoreWrite.postReadValue : null);
  const ok = temporaryReadbackMatches && restoreAttempted && restoreSucceeded && finalStart === originalStart && finalEnd === originalEnd && finalTarget === originalTarget;

  return {
    stage: 'GivHome 1.0.0 gated live reversible configured charge-slot HR263 target Function 06 harness',
    version: 'givhome-1.0.0-gated-live-reversible-configured-hr263-target-function06-harness',
    target: `${options.host}:${port}`,
    unit: deviceAddress,
    register,
    originalValue: originalTarget,
    originalStart,
    originalEnd,
    originalTarget,
    currentHmm: nowValue,
    temporaryValue,
    finalValue: finalTarget,
    finalStart,
    finalEnd,
    finalTarget,
    sameValueOnly: false,
    reversibleOnly: true,
    configuredSlotOnly: true,
    currentTimeOutsideSlot: !isHmmWithinSlot(nowValue, originalStart, originalEnd),
    temporaryWriteFrameVerified: !!(temporaryWrite && temporaryWrite.frameVerified),
    temporaryWriteResponseReceived: !!(temporaryWrite && temporaryWrite.writeResponse && temporaryWrite.writeResponse.responseReceived),
    temporaryReadbackMatches,
    restoreAttempted,
    restoreFrameVerified: !!(restoreWrite && restoreWrite.frameVerified),
    restoreResponseReceived: !!(restoreWrite && restoreWrite.writeResponse && restoreWrite.writeResponse.responseReceived),
    restoreSucceeded,
    restoreError,
    readbackMatchesOriginalAfterRestore: finalStart === originalStart && finalEnd === originalEnd && finalTarget === originalTarget,
    mutationIntent: 'bounded-reversible-configured-target-only-hr263-round-trip-only',
    commandTilesAvailable: false,
    requestBinding: 'manual-terminal-harness-only',
    automaticMutationPath: 'absent',
    ok
  };
}


function safeConfiguredSlotGroupTemporaryValues(originalStart, originalEnd, originalTarget) {
  if (!isValidHmm(originalStart) || !isValidHmm(originalEnd) || originalStart === 0 || originalEnd === 0 || originalStart === originalEnd) {
    throw new Error(`configured-slot group harness refused: invalid configured slot HR261=${originalStart} HR262=${originalEnd}`);
  }
  if (!Number.isInteger(originalTarget) || originalTarget < 0 || originalTarget > 100) {
    throw new Error(`configured-slot group harness refused: HR263 target=${originalTarget} outside expected 0-100 range`);
  }
  const startMinutes = hmmToMinutes(originalStart);
  const endMinutes = hmmToMinutes(originalEnd);
  const targetCandidates = [originalTarget - 1, originalTarget + 1, originalTarget - 2, originalTarget + 2, 99, 50, 100];
  const minuteOffsets = [1, -1, 2, -2];
  for (const offset of minuteOffsets) {
    const tempStartMinutes = startMinutes + offset;
    const tempEndMinutes = endMinutes + offset;
    if (tempStartMinutes < 0 || tempStartMinutes >= 24 * 60 || tempEndMinutes < 0 || tempEndMinutes >= 24 * 60) continue;
    if (tempStartMinutes === tempEndMinutes) continue;
    const temporaryStart = minutesToHmm(tempStartMinutes);
    const temporaryEnd = minutesToHmm(tempEndMinutes);
    if (!isValidHmm(temporaryStart) || !isValidHmm(temporaryEnd)) continue;
    for (const temporaryTarget of targetCandidates) {
      if (!Number.isInteger(temporaryTarget) || temporaryTarget < 0 || temporaryTarget > 100 || temporaryTarget === originalTarget) continue;
      return { temporaryStart, temporaryEnd, temporaryTarget };
    }
  }
  throw new Error(`no safe configured-slot group target from HR261=${originalStart} HR262=${originalEnd} HR263=${originalTarget}`);
}


function phaseValue(value) {
  return value === null || value === undefined ? 'null' : String(value);
}

function pushPhase(phaseLog, message) {
  phaseLog.push(message);
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readHoldingWithPhase(clientOptions, base, count, label, phaseLog, options = {}) {
  const attempts = Number.isInteger(options.attempts) ? options.attempts : 3;
  const gapMs = Number.isInteger(options.gapMs) ? options.gapMs : 750;
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const client = new DirectLocalReadOnlyClient(clientOptions);
      const read = await client.readHoldingRegisters(base, count);
      pushPhase(phaseLog, `phase=${label} attempt=${attempt} result=ok values=${read.values.join(',')}`);
      return read;
    } catch (err) {
      lastErr = err;
      pushPhase(phaseLog, `phase=${label} attempt=${attempt} result=fail error=${err && err.message ? err.message : String(err)}`);
      if (attempt < attempts) await sleepMs(gapMs);
    }
  }
  throw lastErr || new Error(`${label} read failed`);
}

async function writeRegisterWithPhase(clientOptions, register, value, label, phaseLog, timings = {}) {
  const responseTimeoutMs = Number.isInteger(timings.responseTimeoutMs) ? timings.responseTimeoutMs : 5000;
  const readAttempts = Number.isInteger(timings.readAttempts) ? timings.readAttempts : 3;
  const readGapMs = Number.isInteger(timings.readGapMs) ? timings.readGapMs : 750;
  const frame = buildOfflineWriteSingleRegisterFrame({
    adapterSerial: clientOptions.adapterSerial,
    deviceAddress: clientOptions.deviceAddress,
    register,
    value
  });
  const frameVerification = verifyOfflineWriteFrame(frame);
  pushPhase(phaseLog, `phase=${label}:frame register=HR${register} value=${value} verified=${frameVerification.ok ? 'yes' : 'no'}`);
  if (!frameVerification.ok) {
    throw new Error(`${label} Function 06 frame verification failed before live send`);
  }
  const writeResponse = await sendFunction06FrameOnce({
    host: clientOptions.host,
    port: clientOptions.port,
    connectTimeoutMs: clientOptions.connectTimeoutMs,
    responseTimeoutMs,
    frame
  });
  pushPhase(phaseLog, `phase=${label}:write register=HR${register} value=${value} responseReceived=${writeResponse && writeResponse.responseReceived ? 'yes' : 'no'} responseBytes=${writeResponse ? writeResponse.responseBytes : 0}`);
  const read = await readHoldingWithPhase(clientOptions, register, 1, `${label}:post-read`, phaseLog, { attempts: readAttempts, gapMs: readGapMs });
  const postReadValue = read.values[0];
  const readbackMatches = postReadValue === value;
  pushPhase(phaseLog, `phase=${label}:post-read-check register=HR${register} requested=${value} postRead=${postReadValue} readbackMatches=${readbackMatches ? 'yes' : 'no'}`);
  return {
    label,
    requestedValue: value,
    postReadValue,
    frameVerified: frameVerification.ok,
    writeResponse,
    readbackMatches
  };
}

async function runLiveReversibleConfiguredChargeSlotGroupHarness(options = {}) {
  if (options.allowLiveReversibleWrite !== true) {
    throw new Error('live reversible configured slot group harness requires allowLiveReversibleWrite=true');
  }
  assertOptions({ ...options, allowLiveSameValueWrite: true, register: 261 });

  const phaseLog = [];
  const port = Number.isInteger(options.port) ? options.port : DIRECT_LOCAL_DEFAULT_PORT;
  const deviceAddress = Number.isInteger(options.deviceAddress) ? options.deviceAddress : DEFAULT_UNIT_ADDRESS;
  const connectTimeoutMs = Number.isInteger(options.connectTimeoutMs) ? options.connectTimeoutMs : CONNECT_TIMEOUT_MS;
  const readTimeoutMs = Number.isInteger(options.readTimeoutMs) ? options.readTimeoutMs : 6000;
  const responseTimeoutMs = Number.isInteger(options.responseTimeoutMs) ? options.responseTimeoutMs : 5000;
  const clientOptions = {
    host: options.host,
    port,
    deviceAddress,
    adapterSerial: options.adapterSerial,
    connectTimeoutMs,
    readTimeoutMs
  };
  pushPhase(phaseLog, `phase=setup target=${options.host}:${port} unit=${deviceAddress} responseTimeoutMs=${responseTimeoutMs} readTimeoutMs=${readTimeoutMs}`);

  const group = await readHoldingWithPhase(clientOptions, 261, 3, 'pre-read-original-group', phaseLog, { attempts: 3, gapMs: 750 });
  const originalStart = group.values[0];
  const originalEnd = group.values[1];
  const originalTarget = group.values[2];
  pushPhase(phaseLog, `phase=guard originalStart=${originalStart} originalEnd=${originalEnd} originalTarget=${originalTarget}`);

  if (!isValidHmm(originalStart) || !isValidHmm(originalEnd) || originalStart === 0 || originalEnd === 0 || originalStart === originalEnd) {
    throw new Error(`configured-slot group harness refused: slot start/end not configured or invalid HR261=${originalStart} HR262=${originalEnd}; HR263 target=${originalTarget}`);
  }
  if (!Number.isInteger(originalTarget) || originalTarget < 0 || originalTarget > 100) {
    throw new Error(`configured-slot group harness refused: HR263 target=${originalTarget} outside expected 0-100 range`);
  }

  const nowValue = Number.isInteger(options.nowHmm) ? options.nowHmm : nowHmm();
  if (!isValidHmm(nowValue)) {
    throw new Error(`configured-slot group harness refused: invalid current HHMM ${nowValue}`);
  }
  if (isHmmWithinSlot(nowValue, originalStart, originalEnd) && options.allowCurrentlyActiveSlot !== true) {
    throw new Error(`configured-slot group harness refused: current time ${nowValue} is inside configured slot HR261=${originalStart} HR262=${originalEnd}`);
  }
  pushPhase(phaseLog, `phase=guard currentHmm=${nowValue} currentTimeOutsideSlot=yes`);

  const temps = safeConfiguredSlotGroupTemporaryValues(originalStart, originalEnd, originalTarget);
  const temporaryValues = { HR261: temps.temporaryStart, HR262: temps.temporaryEnd, HR263: temps.temporaryTarget };
  const originalValues = { HR261: originalStart, HR262: originalEnd, HR263: originalTarget };
  pushPhase(phaseLog, `phase=temporary-plan temporaryStart=${temporaryValues.HR261} temporaryEnd=${temporaryValues.HR262} temporaryTarget=${temporaryValues.HR263}`);

  const temporaryWrites = [];
  const restoreWrites = [];
  let temporaryGroup = null;
  let finalGroup = null;
  let restoreAttempted = false;
  let restoreSucceeded = false;
  let operationError = '';
  let restoreError = '';
  let finalReadbackError = '';

  try {
    try {
      pushPhase(phaseLog, 'phase=temporary-write-start');
      temporaryWrites.push(await writeRegisterWithPhase(clientOptions, 261, temporaryValues.HR261, 'temporary-live-write-configured-slot-group-start', phaseLog, { responseTimeoutMs, readAttempts: 3, readGapMs: 750 }));
      temporaryWrites.push(await writeRegisterWithPhase(clientOptions, 262, temporaryValues.HR262, 'temporary-live-write-configured-slot-group-end', phaseLog, { responseTimeoutMs, readAttempts: 3, readGapMs: 750 }));
      temporaryWrites.push(await writeRegisterWithPhase(clientOptions, 263, temporaryValues.HR263, 'temporary-live-write-configured-slot-group-target', phaseLog, { responseTimeoutMs, readAttempts: 3, readGapMs: 750 }));
      temporaryGroup = await readHoldingWithPhase(clientOptions, 261, 3, 'temporary-group-readback', phaseLog, { attempts: 3, gapMs: 750 });
      pushPhase(phaseLog, 'phase=temporary-write-complete');
    } catch (err) {
      operationError = err && err.message ? err.message : String(err);
      pushPhase(phaseLog, `phase=temporary-write-error error=${operationError}`);
    }
  } finally {
    restoreAttempted = true;
    pushPhase(phaseLog, 'phase=restore-start');
    try {
      restoreWrites.push(await writeRegisterWithPhase(clientOptions, 261, originalValues.HR261, 'restore-live-write-configured-slot-group-start', phaseLog, { responseTimeoutMs, readAttempts: 4, readGapMs: 750 }));
      restoreWrites.push(await writeRegisterWithPhase(clientOptions, 262, originalValues.HR262, 'restore-live-write-configured-slot-group-end', phaseLog, { responseTimeoutMs, readAttempts: 4, readGapMs: 750 }));
      restoreWrites.push(await writeRegisterWithPhase(clientOptions, 263, originalValues.HR263, 'restore-live-write-configured-slot-group-target', phaseLog, { responseTimeoutMs, readAttempts: 4, readGapMs: 750 }));
    } catch (err) {
      restoreError = err && err.message ? err.message : String(err);
      pushPhase(phaseLog, `phase=restore-error error=${restoreError}`);
    }

    try {
      finalGroup = await readHoldingWithPhase(clientOptions, 261, 3, 'forced-final-group-readback', phaseLog, { attempts: 5, gapMs: 1000 });
      restoreSucceeded = restoreWrites.length === 3 && restoreWrites.every((entry) => entry && entry.readbackMatches === true) &&
        finalGroup.values[0] === originalValues.HR261 &&
        finalGroup.values[1] === originalValues.HR262 &&
        finalGroup.values[2] === originalValues.HR263;
      pushPhase(phaseLog, `phase=forced-final-state start=${finalGroup.values[0]} end=${finalGroup.values[1]} target=${finalGroup.values[2]} restored=${restoreSucceeded ? 'yes' : 'no'}`);
    } catch (err) {
      finalReadbackError = err && err.message ? err.message : String(err);
      pushPhase(phaseLog, `phase=forced-final-readback-error error=${finalReadbackError}`);
    }
  }

  const temporaryGroupMatches = !!(temporaryGroup && temporaryGroup.values[0] === temporaryValues.HR261 && temporaryGroup.values[1] === temporaryValues.HR262 && temporaryGroup.values[2] === temporaryValues.HR263);
  const temporaryWritesOk = temporaryWrites.length === 3 && temporaryWrites.every((entry) => entry && entry.frameVerified && entry.readbackMatches);
  const temporaryResponsesOk = temporaryWrites.length === 3 && temporaryWrites.every((entry) => entry && entry.writeResponse && entry.writeResponse.responseReceived);
  const restoreResponsesOk = restoreWrites.length === 3 && restoreWrites.every((entry) => entry && entry.writeResponse && entry.writeResponse.responseReceived);
  const finalStart = finalGroup ? finalGroup.values[0] : null;
  const finalEnd = finalGroup ? finalGroup.values[1] : null;
  const finalTarget = finalGroup ? finalGroup.values[2] : null;
  const ok = !operationError && !restoreError && !finalReadbackError && temporaryWritesOk && temporaryGroupMatches && restoreAttempted && restoreSucceeded &&
    finalStart === originalValues.HR261 && finalEnd === originalValues.HR262 && finalTarget === originalValues.HR263;

  return {
    stage: 'GivHome 1.0.0 grouped configured charge-slot HR261/HR262/HR263 Function 06 transaction harness',
    version: 'givhome-1.0.0-grouped-configured-charge-slot-function06-transaction-harness',
    target: `${options.host}:${port}`,
    unit: deviceAddress,
    registerGroup: 'HR261-HR263',
    originalStart,
    originalEnd,
    originalTarget,
    currentHmm: nowValue,
    temporaryStart: temporaryValues.HR261,
    temporaryEnd: temporaryValues.HR262,
    temporaryTarget: temporaryValues.HR263,
    temporaryGroupStart: temporaryGroup ? temporaryGroup.values[0] : null,
    temporaryGroupEnd: temporaryGroup ? temporaryGroup.values[1] : null,
    temporaryGroupTarget: temporaryGroup ? temporaryGroup.values[2] : null,
    finalStart,
    finalEnd,
    finalTarget,
    temporaryWriteFrameVerified: temporaryWrites.length === 3 && temporaryWrites.every((entry) => entry && entry.frameVerified),
    temporaryWriteResponsesReceived: temporaryResponsesOk,
    temporaryGroupReadbackMatches: temporaryGroupMatches,
    restoreAttempted,
    restoreFrameVerified: restoreWrites.length === 3 && restoreWrites.every((entry) => entry && entry.frameVerified),
    restoreResponsesReceived: restoreResponsesOk,
    restoreSucceeded,
    operationError,
    restoreError,
    finalReadbackError,
    readbackMatchesOriginalAfterRestore: finalStart === originalValues.HR261 && finalEnd === originalValues.HR262 && finalTarget === originalValues.HR263,
    reversibleOnly: true,
    configuredSlotOnly: true,
    currentTimeOutsideSlot: !isHmmWithinSlot(nowValue, originalStart, originalEnd),
    slotGuard: 'configuredStartEndValidAndNowOutsideSlot',
    groupTransactionOnly: true,
    forcedFinalReadback: !!finalGroup,
    phaseLog,
    mutationIntent: 'bounded-reversible-configured-charge-slot-group-round-trip-only',
    commandTilesAvailable: false,
    requestBinding: 'manual-terminal-harness-only',
    automaticMutationPath: 'absent',
    ok
  };
}

function renderLiveReversibleConfiguredChargeSlotGroupResult(result) {
  return [
    'Stage 5 live grouped configured charge-slot Function 06 transaction harness:',
    `registerGroup=${result.registerGroup}`,
    `original=${phaseValue(result.originalStart)},${phaseValue(result.originalEnd)},${phaseValue(result.originalTarget)}`,
    `temporary=${phaseValue(result.temporaryStart)},${phaseValue(result.temporaryEnd)},${phaseValue(result.temporaryTarget)}`,
    `temporaryGroupReadback=${phaseValue(result.temporaryGroupStart)},${phaseValue(result.temporaryGroupEnd)},${phaseValue(result.temporaryGroupTarget)}`,
    `final=${phaseValue(result.finalStart)},${phaseValue(result.finalEnd)},${phaseValue(result.finalTarget)}`,
    `temporaryWriteFrameVerified=${result.temporaryWriteFrameVerified ? 'yes' : 'no'}`,
    `temporaryGroupReadbackMatches=${result.temporaryGroupReadbackMatches ? 'yes' : 'no'}`,
    `restoreAttempted=${result.restoreAttempted ? 'yes' : 'no'}`,
    `restoreFrameVerified=${result.restoreFrameVerified ? 'yes' : 'no'}`,
    `restoreSucceeded=${result.restoreSucceeded ? 'yes' : 'no'}`,
    `forcedFinalReadback=${result.forcedFinalReadback ? 'yes' : 'no'}`,
    `operationError=${result.operationError || 'none'}`,
    `restoreError=${result.restoreError || 'none'}`,
    `finalReadbackError=${result.finalReadbackError || 'none'}`,
    `readbackMatchesOriginalAfterRestore=${result.readbackMatchesOriginalAfterRestore ? 'yes' : 'no'}`,
    'commandTiles=disabled',
    'automaticMutationPath=absent',
    `liveHarnessResult=${result.ok ? 'PASS' : 'FAIL'}`
  ].join(' ');
}

function renderLiveReversibleHarnessResult(result) {
  return [
    `Stage 5 live reversible HR${result.register} Function 06 harness:`,
    `register=HR${result.register}`,
    `preRead=${result.originalValue}`,
    `temporaryValue=${result.temporaryValue}`,
    `afterTemporaryRead=${result.temporaryReadbackMatches ? result.temporaryValue : 'mismatch'}`,
    `finalRead=${result.finalValue}`,
    `sameValueOnly=no`,
    `reversibleOnly=yes`,
    `temporaryWriteFrameVerified=${result.temporaryWriteFrameVerified ? 'yes' : 'no'}`,
    `temporaryReadbackMatches=${result.temporaryReadbackMatches ? 'yes' : 'no'}`,
    `restoreAttempted=${result.restoreAttempted ? 'yes' : 'no'}`,
    `restoreFrameVerified=${result.restoreFrameVerified ? 'yes' : 'no'}`,
    `restoreSucceeded=${result.restoreSucceeded ? 'yes' : 'no'}`,
    `readbackMatchesOriginalAfterRestore=${result.readbackMatchesOriginalAfterRestore ? 'yes' : 'no'}`,
    `commandTiles=disabled`,
    `automaticMutationPath=absent`,
    `liveHarnessResult=${result.ok ? 'PASS' : 'FAIL'}`
  ].join(' ');
}

module.exports = {
  STAGE5_LIVE_HARNESS_VERSION,
  runLiveSameValueWriteHarness,
  renderLiveSameValueHarnessResult,
  runLiveReversibleHr313Harness,
  runLiveReversibleHr314Harness,
  runLiveReversibleDormantHr261Harness,
  runLiveReversibleConfiguredHr261Harness,
  runLiveReversibleConfiguredHr262Harness,
  runLiveReversibleConfiguredHr263Harness,
  runLiveReversibleConfiguredChargeSlotGroupHarness,
  renderLiveReversibleConfiguredChargeSlotGroupResult,
  renderLiveReversibleHarnessResult,
  sendFunction06FrameOnce
};
