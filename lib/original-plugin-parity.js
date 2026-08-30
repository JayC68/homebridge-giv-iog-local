'use strict';

const PARITY_FEATURES = Object.freeze([
  {
    feature: 'Read-only HomeKit energy/status surface',
    originalSource: 'homebridge-giv-iog-local@3.7.5 ensureAccessories/getSnapshot',
    modbusStatus: 'partially implemented',
    releaseAction: 'semantic snapshot alignment and grid-flow correction',
    nextGate: 'soak after 1.0.0 runtime marker'
  },
  {
    feature: 'Charge 30/60/90/120 tiles',
    originalSource: 'forceCharge, forceCharge30, forceCharge90, forceCharge120',
    modbusStatus: 'live-capable behind local appliance-control gate and Charge tile gate',
    releaseAction: 'ported Charge 30/60/90/120 HomeKit switch surface to direct Modbus core lifecycle',
    nextGate: 'live validation on target inverter with preserved prestate readback'
  },
  {
    feature: 'Export 30/60/90/120 tiles',
    originalSource: 'forceExport, forceExport30, forceExport90, forceExport120',
    modbusStatus: 'live-capable behind local appliance-control gate and Export tile gate',
    releaseAction: 'ported Export 30/60/90/120 HomeKit switch surface to CH/AIO slot-8 route with captured-prestate-only restore',
    nextGate: 'live validation of export start, cleanup and restore on target inverter'
  },
  {
    feature: 'Intelligent Octopus Go smart windows',
    originalSource: 'Kraken token + plannedDispatches + cheap/grace/smart state merge',
    modbusStatus: 'network polling active behind local appliance control and Octopus gates',
    releaseAction: 'ported plannedDispatches/fallback/grace state merge with direct Octopus GraphQL polling',
    nextGate: 'observe real IOG dispatch window evidence'
  },
  {
    feature: 'home-battery protection during Intelligent Octopus Go smart slots',
    originalSource: 'applyAutomation charges during Intelligent Octopus Go dispatch windows when SOC below target',
    modbusStatus: 'automatic charge-capable behind local appliance control and Intelligent Octopus Go home-battery protection gates',
    releaseAction: 'bound Intelligent Octopus Go home-battery protection to gated direct-Modbus charge lifecycle',
    nextGate: 'validate real dispatch protection without GivTCP'
  },
  {
    feature: 'Battery Care Charging',
    originalSource: 'overnight-only charge-rate calculation using battery size and max charge power',
    modbusStatus: 'charge-rate write-capable behind local appliance control, EV protection and Battery Care gates',
    releaseAction: 'ported overnight-only Battery Care HR111 planning; excludes IOG extras, grace and manual tiles',
    nextGate: 'validate HR111 percent behaviour during main overnight cheap slot'
  },
  {
    feature: 'Evening Excess Export',
    originalSource: 'reserve ladder + setDischargeRate + discharge slot + cleanup/restore',
    modbusStatus: 'reserve-led export-capable behind local appliance control and Evening Excess Export gates',
    releaseAction: 'ported reserve ladder, Apple Home arm switch, HR112 export power and captured-prestate-only cleanup',
    nextGate: 'validate export automation with cautious SOC reserve settings'
  },
  {
    feature: 'Eve energy history',
    originalSource: 'fakegato-history with solar/import/export cumulative kWh persistence',
    modbusStatus: 'implemented as local persisted totals with optional fakegato-history integration',
    releaseAction: 'created Solar/Import/Export history collectors using semantic snapshot power fields',
    nextGate: 'verify Eve app rendering on target Homebridge install'
  },
  {
    feature: 'CE/AC-coupled compatibility',
    originalSource: '3.7.5 CE single-slot preservation and reinstatement',
    modbusStatus: 'profile-gated live path available only with separate CE/AC acknowledgement',
    releaseAction: 'implemented CE/AC core-window preserve/restore guard; CH/AIO slot-8 route remains blocked for CE/AC',
    nextGate: 'validate only on confirmed CE/AC hardware with explicit acknowledgement'
  }
]);

function getParityFeature(featureName) {
  return PARITY_FEATURES.find((entry) => entry.feature === featureName) || null;
}

function paritySummary() {
  return PARITY_FEATURES.map((entry) => `${entry.feature}: ${entry.modbusStatus}`).join(' | ');
}

module.exports = {
  PARITY_FEATURES,
  getParityFeature,
  paritySummary
};
