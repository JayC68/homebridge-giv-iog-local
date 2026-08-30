'use strict';

/*
 * Minimal single-process async gate.
 * Stage 0 has no wire traffic, but later direct Modbus reads/writes must pass
 * through one exclusive gate.
 */

class TransportGate {
  constructor() {
    this.locked = false;
  }

  async runExclusive(fn) {
    if (this.locked) {
      throw new Error('Transport gate is busy.');
    }

    this.locked = true;
    try {
      return await fn();
    } finally {
      this.locked = false;
    }
  }
}

module.exports = {
  TransportGate
};
