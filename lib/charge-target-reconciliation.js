'use strict';

const { classifySerialPrefix } = require('./profile-detector');

const CHARGE_TARGET_RECONCILIATION_STAGE = 'givhome-4.0.1-model-aware-ac-charge-target-reconciliation';

const CHARGE_TARGET_PROFILES = Object.freeze({
  aio: Object.freeze({
    profile: 'ch-aio',
    establishedTargetRegisters: Object.freeze(['HR20', 'HR116']),
    diagnosticTargetRegisters: Object.freeze(['HR242']),
    extendedSlotTargetWrites: false,
    logicalSlot1: Object.freeze({ start: 'HR94', end: 'HR95', generalTarget: 'HR116', slotTarget: 'HR242' })
  }),
  ac: Object.freeze({
    profile: 'ce-ac-coupled',
    establishedTargetRegisters: Object.freeze(['HR20', 'HR116']),
    diagnosticTargetRegisters: Object.freeze([]),
    extendedSlotTargetWrites: false,
    logicalSlot1: Object.freeze({ start: 'HR94', end: 'HR95', generalTarget: 'HR116', slotTarget: null })
  }),
  hybrid: Object.freeze({
    profile: 'ed-hybrid',
    establishedTargetRegisters: Object.freeze(['HR20', 'HR116']),
    diagnosticTargetRegisters: Object.freeze([]),
    extendedSlotTargetWrites: false,
    logicalSlot1: Object.freeze({ start: 'HR94', end: 'HR95', generalTarget: 'HR116', slotTarget: null })
  }),
  unsupported: Object.freeze({
    profile: 'unsupported-or-read-only',
    establishedTargetRegisters: Object.freeze([]),
    diagnosticTargetRegisters: Object.freeze([]),
    extendedSlotTargetWrites: false,
    logicalSlot1: Object.freeze({ start: null, end: null, generalTarget: null, slotTarget: null })
  })
});

function validSoc(value) {
  return Number.isInteger(value) && value >= 4 && value <= 100;
}

function valueOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function inferChargeTargetProfile(options = {}) {
  const serialProfile = classifySerialPrefix(options.serial || '');
  const model = String(options.model || '').trim();
  const deviceTypeCode = String(options.deviceTypeCode || '').trim();

  if (serialProfile.family === 'aio' || model === '8' || deviceTypeCode.startsWith('8')) return CHARGE_TARGET_PROFILES.aio;
  if (serialProfile.family === 'ac' || serialProfile.family === 'ac_coupled_candidate' || model === '3' || deviceTypeCode.startsWith('3')) return CHARGE_TARGET_PROFILES.ac;
  if (serialProfile.family === 'hybrid_candidate' || model === '2' || deviceTypeCode.startsWith('2')) return CHARGE_TARGET_PROFILES.hybrid;
  return CHARGE_TARGET_PROFILES.unsupported;
}

function expectedEstablishedTargetState(targetSoc) {
  if (!validSoc(targetSoc)) throw new Error(`AC charge target SOC must be 4-100 percent: ${targetSoc}`);
  return targetSoc === 100 ? { HR20: 0, HR116: 100 } : { HR20: 1, HR116: targetSoc };
}

function buildChargeTargetReconciliationPlan(snapshot = {}, options = {}) {
  const targetSoc = Number.isInteger(options.targetSoc) ? options.targetSoc : 100;
  const profile = options.profile || inferChargeTargetProfile(options);
  const expected = expectedEstablishedTargetState(targetSoc);
  const establishedWrites = [];
  const diagnostics = [];

  for (const [label, value] of Object.entries(expected)) {
    if (!profile.establishedTargetRegisters.includes(label)) continue;
    if (valueOrNull(snapshot[label]) !== value) {
      establishedWrites.push({ register: Number(label.slice(2)), label, value, reason: 'established-ac-charge-target-reconciliation' });
    }
  }

  if (profile.profile === 'ch-aio' && Number.isInteger(snapshot.HR242) && snapshot.HR242 !== targetSoc) {
    diagnostics.push({
      label: 'HR242',
      register: 242,
      value: snapshot.HR242,
      expected: targetSoc,
      severity: 'warn',
      action: profile.extendedSlotTargetWrites ? 'write-eligible-profile-required' : 'diagnostic-only-unvalidated-write',
      reason: 'CH/AIO slot-1 AC charge target differs from requested automation target'
    });
  }

  return {
    stage: CHARGE_TARGET_RECONCILIATION_STAGE,
    profile: profile.profile,
    targetSoc,
    expected,
    establishedWrites,
    diagnostics,
    restoreRegisters: Object.freeze(['HR20', 'HR111', 'HR116', 'HR94', 'HR95', 'HR96']),
    verifiedByReadbackRegisters: profile.profile === 'ch-aio'
      ? Object.freeze(['HR20', 'HR116', 'HR242', 'HR94', 'HR95', 'HR96'])
      : Object.freeze(['HR20', 'HR116', 'HR94', 'HR95', 'HR96']),
    unsafeSpeculativeWrites: diagnostics.filter((d) => d.action === 'diagnostic-only-unvalidated-write').map((d) => d.label),
    mutationAllowed: profile.establishedTargetRegisters.length > 0,
    extendedSlotTargetWritesAllowed: profile.extendedSlotTargetWrites === true
  };
}

function verifyChargeTargetReconciliation(snapshot = {}, plan = {}) {
  const expected = plan.expected || {};
  const mismatches = [];
  for (const [label, value] of Object.entries(expected)) {
    if (valueOrNull(snapshot[label]) !== value) mismatches.push({ label, expected: value, actual: valueOrNull(snapshot[label]) });
  }
  const diagnosticMismatches = Array.isArray(plan.diagnostics)
    ? plan.diagnostics.filter((d) => d.action === 'diagnostic-only-unvalidated-write')
    : [];
  return {
    ok: plan.mutationAllowed === true && mismatches.length === 0,
    mismatches,
    diagnosticMismatches,
    unsafeSpeculativeWrites: diagnosticMismatches.map((d) => d.label)
  };
}

module.exports = {
  CHARGE_TARGET_RECONCILIATION_STAGE,
  CHARGE_TARGET_PROFILES,
  inferChargeTargetProfile,
  expectedEstablishedTargetState,
  buildChargeTargetReconciliationPlan,
  verifyChargeTargetReconciliation
};
