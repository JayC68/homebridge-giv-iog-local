'use strict';

const net = require('net');
const {
  CONNECT_TIMEOUT_MS,
  DEFAULT_UNIT_ADDRESS,
  DIRECT_LOCAL_DEFAULT_PORT,
  FRESH_ATTEMPT_GAP_MS,
  GENEROUS_CONNECT_TIMEOUT_MS,
  GENEROUS_READ_RESPONSE_TIMEOUT_MS,
  HOLDING_REGISTER_FUNCTION,
  INPUT_REGISTER_FUNCTION,
  READ_RESPONSE_TIMEOUT_MS,
  SHORT_CONNECT_TIMEOUT_MS,
  SHORT_OPPORTUNITY_COUNT,
  SHORT_READ_RESPONSE_TIMEOUT_MS
} = require('./evidence-led-constants');
const {
  FrameBuffer,
  buildReadHoldingRegistersFrame,
  buildReadInputRegistersFrame,
  parseFrame
} = require('./givenergy-frame');

class DirectLocalReadOnlyClient {
  constructor(options = {}) {
    this.host = String(options.host || '').trim();
    this.port = Number.isInteger(options.port) ? options.port : DIRECT_LOCAL_DEFAULT_PORT;
    this.deviceAddress = Number.isInteger(options.deviceAddress) ? options.deviceAddress : DEFAULT_UNIT_ADDRESS;
    this.adapterSerial = options.adapterSerial;
    this.connectTimeoutMs = Number.isInteger(options.connectTimeoutMs) ? options.connectTimeoutMs : CONNECT_TIMEOUT_MS;
    this.readTimeoutMs = Number.isInteger(options.readTimeoutMs) ? options.readTimeoutMs : READ_RESPONSE_TIMEOUT_MS;
    this.enableGracefulContinuity = options.enableGracefulContinuity !== false;
    this.gracefulLabelPrefix = options.gracefulLabelPrefix || '';
    this.onGracefulContinuityEvent = typeof options.onGracefulContinuityEvent === 'function' ? options.onGracefulContinuityEvent : null;
  }

  async readInputRegisters(start, count) {
    return this.readRegisters({
      start,
      count,
      registerFunction: INPUT_REGISTER_FUNCTION,
      buildFrame: buildReadInputRegistersFrame,
      label: 'IR'
    });
  }

  async readHoldingRegisters(start, count) {
    return this.readRegisters({
      start,
      count,
      registerFunction: HOLDING_REGISTER_FUNCTION,
      buildFrame: buildReadHoldingRegistersFrame,
      label: 'HR'
    });
  }

  async readRegisters(params) {
    if (!this.enableGracefulContinuity) {
      return this.readRegistersSingleAttempt(params);
    }

    const label = `${params.label}(${params.start},${params.count})`;
    return this.gracefulContinuityRead(label, async (client) => client.readRegistersSingleAttempt(params));
  }

  async gracefulContinuityRead(label, operation) {
    let lastError = new Error('read timed out');

    for (let opportunity = 1; opportunity <= SHORT_OPPORTUNITY_COUNT; opportunity++) {
      const client = this.cloneForAttempt({
        connectTimeoutMs: SHORT_CONNECT_TIMEOUT_MS,
        readTimeoutMs: SHORT_READ_RESPONSE_TIMEOUT_MS,
        enableGracefulContinuity: false
      });

      try {
        const value = await operation(client);
        this.emitGracefulContinuityEvent({
          phase: 'read',
          label,
          opportunity,
          opportunityKind: 'short',
          recovered: opportunity > 1,
          result: 'ok'
        });
        return value;
      } catch (err) {
        lastError = err;
        this.emitGracefulContinuityEvent({
          phase: 'read',
          label,
          opportunity,
          opportunityKind: 'short',
          result: 'fail',
          error: err && err.message ? err.message : String(err)
        });
      }

      if (opportunity < SHORT_OPPORTUNITY_COUNT) {
        await sleep(FRESH_ATTEMPT_GAP_MS);
      }
    }

    await sleep(FRESH_ATTEMPT_GAP_MS);

    const generousClient = this.cloneForAttempt({
      connectTimeoutMs: GENEROUS_CONNECT_TIMEOUT_MS,
      readTimeoutMs: GENEROUS_READ_RESPONSE_TIMEOUT_MS,
      enableGracefulContinuity: false
    });

    try {
      const value = await operation(generousClient);
      this.emitGracefulContinuityEvent({
        phase: 'read',
        label,
        opportunity: 'generous',
        opportunityKind: 'generous',
        recovered: true,
        result: 'ok'
      });
      return value;
    } catch (err) {
      lastError = err;
      this.emitGracefulContinuityEvent({
        phase: 'read',
        label,
        opportunity: 'generous',
        opportunityKind: 'generous',
        result: 'fail',
        exhausted: true,
        error: err && err.message ? err.message : String(err)
      });
    }

    throw lastError;
  }

  cloneForAttempt(overrides = {}) {
    return new DirectLocalReadOnlyClient({
      host: this.host,
      port: this.port,
      deviceAddress: this.deviceAddress,
      adapterSerial: this.adapterSerial,
      connectTimeoutMs: overrides.connectTimeoutMs,
      readTimeoutMs: overrides.readTimeoutMs,
      enableGracefulContinuity: overrides.enableGracefulContinuity,
      gracefulLabelPrefix: this.gracefulLabelPrefix,
      onGracefulContinuityEvent: this.onGracefulContinuityEvent
    });
  }

  emitGracefulContinuityEvent(event) {
    if (this.onGracefulContinuityEvent) {
      this.onGracefulContinuityEvent(event);
    }
  }

  async readRegistersSingleAttempt({ start, count, registerFunction, buildFrame, label }) {
    if (!this.host) {
      throw new Error('host is required');
    }

    const socket = await this.connect();
    const frames = new FrameBuffer();

    try {
      const request = buildFrame({
        adapterSerial: this.adapterSerial,
        deviceAddress: this.deviceAddress,
        base: start,
        count
      });

      socket.write(request);

      const deadline = Date.now() + this.readTimeoutMs;
      let lastUnexpectedResponse = null;

      while (Date.now() < deadline) {
        const response = await this.receiveMatchingChunk(socket, frames, Math.max(100, deadline - Date.now()));

        if (response.isHeartbeat) {
          continue;
        }

        if (
          response.mainFunction === 0x02 &&
          response.transparentFunction === registerFunction &&
          response.deviceAddress === this.deviceAddress &&
          response.baseRegister === start &&
          response.registerCount === count
        ) {
          if (lastUnexpectedResponse) {
            response.lastUnexpectedResponse = lastUnexpectedResponse;
          }
          return response;
        }

        lastUnexpectedResponse = summariseResponse(response);
      }

      const err = new Error(lastUnexpectedResponse ? `read timed out awaiting matching ${label} response after ${lastUnexpectedResponse.summary}` : `read timed out awaiting matching ${label} response`);
      if (lastUnexpectedResponse) {
        err.givEnergyFrameMeta = lastUnexpectedResponse;
      }
      throw err;
    } finally {
      socket.destroy();
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
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
      socket.setTimeout(this.connectTimeoutMs);
    });
  }

  receiveMatchingChunk(socket, frameBuffer, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;

      const cleanup = () => {
        clearTimeout(timer);
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
      };

      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err);
        else resolve(value);
      };

      const tryPop = () => {
        const frame = frameBuffer.popFrame();
        if (!frame) return false;

        try {
          finish(null, parseFrame(frame));
        } catch (err) {
          finish(err);
        }
        return true;
      };

      const onData = (chunk) => {
        frameBuffer.push(chunk);
        tryPop();
      };

      const onError = (err) => finish(err);
      const onClose = () => finish(new Error('connection closed'));

      if (tryPop()) {
        return;
      }

      timer = setTimeout(() => finish(new Error('receive timed out')), timeoutMs);
      socket.on('data', onData);
      socket.once('error', onError);
      socket.once('close', onClose);
    });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summariseResponse(response) {
  const meta = {
    summary: `main=${response.mainFunction} transparent=${response.transparentFunction} unit=${response.deviceAddress} serial=${response.inverterSerial || 'unknown'} base=${response.baseRegister} count=${response.registerCount}`,
    mainFunction: response.mainFunction,
    transparentFunction: response.transparentFunction,
    deviceAddress: response.deviceAddress,
    inverterSerial: response.inverterSerial,
    baseRegister: response.baseRegister,
    registerCount: response.registerCount,
    reason: response.unexpectedReason || (response.isUnexpectedResponse ? 'unexpected response' : 'non-matching response')
  };
  return meta;
}

module.exports = {
  DirectLocalReadOnlyClient,
  DirectModbusClient: DirectLocalReadOnlyClient
};
