'use strict';

const { IR_INDEX } = require('./evidence-led-constants');

function assertRegisterArray(registers) {
  if (!Array.isArray(registers)) {
    throw new TypeError('registers must be an array of unsigned 16-bit register values');
  }

  if (registers.length <= IR_INDEX.SOC) {
    throw new RangeError(`IR0-60 decode requires at least ${IR_INDEX.SOC + 1} values`);
  }
}

function word(registers, index) {
  const value = registers[index];

  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`register ${index} is not an unsigned 16-bit value`);
  }

  return value;
}

function signed16(value) {
  return value > 0x7fff ? value - 0x10000 : value;
}

function maybeSoc(value) {
  return value >= 0 && value <= 100 ? value : null;
}

function maybeTenths(value) {
  return value === 0xffff ? null : value / 10;
}

function u32(high, low) {
  return (high * 0x10000) + low;
}

/*
 * GivHome 1.0.0 deliberately separates raw Modbus values from semantic HomeKit fields.
 * Directional split is applied in read-only-accessory-model using the register authority layer:
 * IR30 positive = export / negative = import; IR52 positive = discharge / negative = charge.
 */
function decodeInputRegisters0To60(registers) {
  assertRegisterArray(registers);

  const pvPower1W = word(registers, IR_INDEX.PV_POWER_1);
  const pvPower2W = word(registers, IR_INDEX.PV_POWER_2);
  const gridSignedPowerW = signed16(word(registers, IR_INDEX.GRID_SIGNED_POWER));
  const batterySignedPowerW = signed16(word(registers, IR_INDEX.BATTERY_SIGNED_POWER));
  const socRaw = word(registers, IR_INDEX.SOC);

  return {
    source: 'IR0-60',
    socPercent: maybeSoc(socRaw),
    socRaw,
    pvPowerW: pvPower1W + pvPower2W,
    pvPower1W,
    pvPower2W,
    gridSignedPowerW,
    loadPowerW: word(registers, IR_INDEX.LOAD_POWER),
    batterySignedPowerW,
    inverterTemperatureC: maybeTenths(word(registers, IR_INDEX.INVERTER_TEMPERATURE)),
    batteryTemperatureC: maybeTenths(word(registers, IR_INDEX.BATTERY_TEMPERATURE)),
    counters: {
      pvDay1Raw: word(registers, IR_INDEX.PV_DAY_1),
      pvDay2Raw: word(registers, IR_INDEX.PV_DAY_2),
      gridExportTodayRaw: word(registers, IR_INDEX.GRID_EXPORT_TODAY),
      gridImportTodayRaw: word(registers, IR_INDEX.GRID_IMPORT_TODAY),
      acChargeTodayRaw: word(registers, IR_INDEX.AC_CHARGE_TODAY),
      batteryChargeTodayRaw: word(registers, IR_INDEX.BATTERY_CHARGE_TODAY),
      batteryDischargeTodayRaw: word(registers, IR_INDEX.BATTERY_DISCHARGE_TODAY),
      pvGenerationTodayRaw: word(registers, IR_INDEX.PV_GENERATION_TODAY),
      batteryThroughputTotalRaw: u32(
        word(registers, IR_INDEX.BATTERY_THROUGHPUT_TOTAL_HIGH),
        word(registers, IR_INDEX.BATTERY_THROUGHPUT_TOTAL_LOW)
      ),
      lifetimeSolarRaw: u32(
        word(registers, IR_INDEX.LIFETIME_SOLAR_HIGH),
        word(registers, IR_INDEX.LIFETIME_SOLAR_LOW)
      ),
      gridExportTotalRaw: u32(
        word(registers, IR_INDEX.GRID_EXPORT_TOTAL_HIGH),
        word(registers, IR_INDEX.GRID_EXPORT_TOTAL_LOW)
      ),
      gridImportTotalRaw: u32(
        word(registers, IR_INDEX.GRID_IMPORT_TOTAL_HIGH),
        word(registers, IR_INDEX.GRID_IMPORT_TOTAL_LOW)
      ),
      pvGenerationTotalRaw: u32(
        word(registers, IR_INDEX.PV_GENERATION_TOTAL_HIGH),
        word(registers, IR_INDEX.PV_GENERATION_TOTAL_LOW)
      )
    }
  };
}

module.exports = {
  decodeInputRegisters0To60,
  signed16
};
