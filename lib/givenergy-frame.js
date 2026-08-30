'use strict';

const {
  DEFAULT_ADAPTER_SERIAL,
  DEFAULT_UNIT_ADDRESS,
  HOLDING_REGISTER_FUNCTION,
  INPUT_REGISTER_FUNCTION,
  MAX_FRAME_LENGTH
} = require('./evidence-led-constants');

const YY_MARKER = Buffer.from([0x59, 0x59, 0x00, 0x01]);

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

function writeUInt16BE(value) {
  assertUInt16('value', value);
  return Buffer.from([(value >> 8) & 0xff, value & 0xff]);
}

function readUInt16BE(buffer, offset) {
  if (!Buffer.isBuffer(buffer) || buffer.length < offset + 2) {
    return 0;
  }
  return ((buffer[offset] << 8) | buffer[offset + 1]) & 0xffff;
}

function crc16Modbus(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('buffer must be a Buffer');
  }

  let crc = 0xffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const carry = crc & 0x0001;
      crc >>= 1;
      if (carry) {
        crc ^= 0xa001;
      }
    }
  }

  return crc & 0xffff;
}

function normaliseAdapterSerial(adapterSerial) {
  const serial = String(adapterSerial || DEFAULT_ADAPTER_SERIAL).trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(serial)) {
    throw new Error('adapterSerial must be exactly 10 ASCII letters/numbers');
  }
  return serial;
}

function buildReadRegistersFrame(options = {}) {
  const adapterSerial = normaliseAdapterSerial(options.adapterSerial);
  const deviceAddress = options.deviceAddress ?? DEFAULT_UNIT_ADDRESS;
  const base = options.base ?? 0;
  const count = options.count ?? 60;
  const registerFunction = options.registerFunction ?? INPUT_REGISTER_FUNCTION;

  assertUInt8('deviceAddress', deviceAddress);
  assertUInt16('base', base);
  assertUInt16('count', count);
  assertUInt8('registerFunction', registerFunction);

  if (registerFunction !== INPUT_REGISTER_FUNCTION && registerFunction !== HOLDING_REGISTER_FUNCTION) {
    throw new RangeError('registerFunction must be read input registers (0x04) or read holding registers (0x03)');
  }

  if (count < 1 || count > 125) {
    throw new RangeError('count must be 1...125');
  }

  const transparent = Buffer.concat([
    Buffer.from([deviceAddress, registerFunction]),
    writeUInt16BE(base),
    writeUInt16BE(count)
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

function buildReadInputRegistersFrame(options = {}) {
  return buildReadRegistersFrame({ ...options, registerFunction: INPUT_REGISTER_FUNCTION });
}

function buildReadHoldingRegistersFrame(options = {}) {
  return buildReadRegistersFrame({ ...options, registerFunction: HOLDING_REGISTER_FUNCTION });
}

class FrameBuffer {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError('chunk must be a Buffer');
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  popFrame() {
    const start = this.buffer.indexOf(YY_MARKER);

    if (start < 0) {
      if (this.buffer.length > 3) {
        this.buffer = this.buffer.subarray(this.buffer.length - 3);
      }
      return null;
    }

    if (start > 0) {
      this.buffer = this.buffer.subarray(start);
    }

    if (this.buffer.length < 6) {
      return null;
    }

    const declaredLength = readUInt16BE(this.buffer, 4);
    const totalLength = declaredLength + 6;

    if (totalLength <= 6 || totalLength > MAX_FRAME_LENGTH) {
      this.buffer = this.buffer.subarray(Math.min(2, this.buffer.length));
      return null;
    }

    if (this.buffer.length < totalLength) {
      return null;
    }

    const frame = this.buffer.subarray(0, totalLength);
    this.buffer = this.buffer.subarray(totalLength);
    return frame;
  }
}

function parseFrame(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < 8) {
    throw new Error('Frame too short');
  }

  if (frame[0] !== 0x59 || frame[1] !== 0x59) {
    throw new Error('Unexpected frame marker');
  }

  const declaredLength = readUInt16BE(frame, 4);
  if (declaredLength + 6 !== frame.length) {
    throw new Error('Frame length mismatch');
  }

  const mainFunction = frame[7];

  if (mainFunction === 0x01) {
    return {
      isHeartbeat: true,
      mainFunction,
      transparentFunction: 0,
      deviceAddress: 0,
      inverterSerial: '',
      baseRegister: 0,
      registerCount: 0,
      values: []
    };
  }

  if (mainFunction !== 0x02) {
    throw new Error(`Unexpected main function ${mainFunction}`);
  }

  if (frame.length < 44) {
    throw new Error(`Transparent frame too short: ${frame.length}`);
  }

  const deviceAddress = frame[26];
  const transparentFunction = frame[27] & 0x7f;
  const inverterSerial = frame.subarray(28, 38).toString('ascii').trim();
  const baseRegister = readUInt16BE(frame, 38);

  if (transparentFunction !== INPUT_REGISTER_FUNCTION && transparentFunction !== HOLDING_REGISTER_FUNCTION) {
    return {
      isHeartbeat: false,
      isUnexpectedResponse: true,
      unexpectedReason: `unexpected transparent function ${transparentFunction}`,
      mainFunction,
      transparentFunction,
      deviceAddress,
      inverterSerial,
      baseRegister,
      registerCount: 0,
      values: []
    };
  }

  const registerCount = readUInt16BE(frame, 40);
  const valuesStart = 42;
  const valuesBytes = registerCount * 2;

  if (frame.length < valuesStart + valuesBytes) {
    throw new Error('Register response incomplete');
  }

  const values = [];
  for (let i = 0; i < registerCount; i += 1) {
    values.push(readUInt16BE(frame, valuesStart + i * 2));
  }

  return {
    isHeartbeat: false,
    isUnexpectedResponse: false,
    mainFunction,
    transparentFunction,
    deviceAddress,
    inverterSerial,
    baseRegister,
    registerCount,
    values
  };
}

module.exports = {
  YY_MARKER,
  FrameBuffer,
  buildReadHoldingRegistersFrame,
  buildReadInputRegistersFrame,
  buildReadRegistersFrame,
  crc16Modbus,
  parseFrame,
  readUInt16BE,
  writeUInt16BE
};
