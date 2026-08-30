'use strict';

/*
 * Evidence-led serial hinting only.
 * A valid GivEnergy-style response is not enough to prove a direct inverter.
 * Gateway, dongle and battery-module serials are responders/devices, not
 * accepted direct inverter targets for this plugin stage.
 */

const SERIAL_PREFIX_PROFILES = Object.freeze({
  CH: Object.freeze({ family: 'aio', kind: 'inverter', isDirectInverterCandidate: true }),
  CE: Object.freeze({ family: 'ac_coupled_candidate', kind: 'inverter', isDirectInverterCandidate: true }),
  SA: Object.freeze({ family: 'hybrid_candidate', kind: 'inverter', isDirectInverterCandidate: true }),
  SD: Object.freeze({ family: 'hybrid_candidate', kind: 'inverter', isDirectInverterCandidate: true }),
  FD: Object.freeze({ family: 'hybrid_candidate', kind: 'inverter', isDirectInverterCandidate: true }),
  FA: Object.freeze({ family: 'hybrid_candidate', kind: 'inverter', isDirectInverterCandidate: true }),
  FG: Object.freeze({ family: 'hybrid_candidate', kind: 'inverter', isDirectInverterCandidate: true }),
  ED: Object.freeze({ family: 'hybrid_candidate', kind: 'inverter', isDirectInverterCandidate: true }),

  GW: Object.freeze({ family: 'gateway_or_system_controller', kind: 'gateway', isDirectInverterCandidate: false }),
  WK: Object.freeze({ family: 'gateway_or_system_controller', kind: 'gateway', isDirectInverterCandidate: false }),

  WJ: Object.freeze({ family: 'ambiguous_adapter_or_aio_label', kind: 'ambiguous', isDirectInverterCandidate: false }),
  WG: Object.freeze({ family: 'ambiguous_givenergy_device', kind: 'ambiguous', isDirectInverterCandidate: false }),
  WH: Object.freeze({ family: 'ambiguous_givenergy_device', kind: 'ambiguous', isDirectInverterCandidate: false }),
  WE: Object.freeze({ family: 'external_wifi_dongle', kind: 'adapter', isDirectInverterCandidate: false }),
  WF: Object.freeze({ family: 'external_wifi_dongle', kind: 'adapter', isDirectInverterCandidate: false }),
  WO: Object.freeze({ family: 'external_wifi_dongle', kind: 'adapter', isDirectInverterCandidate: false }),
  WT: Object.freeze({ family: 'three_phase_or_special_candidate', kind: 'ambiguous', isDirectInverterCandidate: false }),

  GB: Object.freeze({ family: 'battery_module', kind: 'battery', isDirectInverterCandidate: false }),
  BP: Object.freeze({ family: 'battery_module', kind: 'battery', isDirectInverterCandidate: false }),
  PBG: Object.freeze({ family: 'battery_module', kind: 'battery', isDirectInverterCandidate: false })
});

function normaliseSerial(serial) {
  return String(serial || '').trim().toUpperCase();
}

function classifySerialPrefix(serial) {
  const normalised = normaliseSerial(serial);

  if (!normalised) {
    return {
      serial: '',
      prefix: '',
      family: 'unknown',
      kind: 'unknown',
      isDirectInverterCandidate: false,
      writeEligibleFromSerialAlone: false
    };
  }

  const three = normalised.slice(0, 3);
  const two = normalised.slice(0, 2);
  const prefix = Object.prototype.hasOwnProperty.call(SERIAL_PREFIX_PROFILES, three) ? three : two;
  const profile = SERIAL_PREFIX_PROFILES[prefix] || Object.freeze({
    family: 'unknown_givenergy_candidate',
    kind: 'unknown',
    isDirectInverterCandidate: false
  });

  return {
    serial: normalised,
    prefix,
    family: profile.family,
    kind: profile.kind,
    isDirectInverterCandidate: profile.isDirectInverterCandidate,
    writeEligibleFromSerialAlone: false
  };
}

function isDirectInverterCandidate(serial) {
  return classifySerialPrefix(serial).isDirectInverterCandidate === true;
}

module.exports = {
  SERIAL_PREFIX_PROFILES,
  classifySerialPrefix,
  isDirectInverterCandidate
};
