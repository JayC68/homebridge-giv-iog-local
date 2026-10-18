'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { after } = require('node:test');
const temporary = [];
after(() => { for (const dir of temporary) fs.rmSync(dir, { recursive: true, force: true }); });
module.exports = function attach(platform, registers, directory) {
  if (!directory) { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'givhome-regression-')); temporary.push(directory); }
  platform.getStoragePath = () => directory;
  platform.config ||= {}; platform.log.error ||= () => {};
  platform.api ||= { hap: { uuid: { generate: s => s } } };
  platform.readHoldingRegisters = async (r, n) => {
    const d = new Date(), clock = { 35: d.getFullYear() - 2000, 36: d.getMonth() + 1, 37: d.getDate(), 38: d.getHours(), 39: d.getMinutes(), 40: d.getSeconds() };
    return Array.from({ length: n }, (_, i) => clock[r + i] ?? registers[`HR${r + i}`] ?? 0);
  };
  platform.initialiseControlLifecycle();
};
