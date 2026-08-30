'use strict';

const STAGE4_FRAMEWORK_VERSION = 'givhome-1.0.0-non-executable-command-dry-run-composer';
const STAGE4_MODE = 'non-executable-command-dry-run-composer';

const HR_GROUPS = Object.freeze({
  manualChargeCore: Object.freeze([94, 95, 96, 111, 116]),
  manualExportCore: Object.freeze([56, 57, 59, 112]),
  chargeSlot8FutureRoute: Object.freeze([261, 262, 263]),
  exportSlot8FutureRoute: Object.freeze([291, 292, 293]),
  cheapOvernightChargeSlots9And10: Object.freeze([264, 265, 266, 267, 268, 269]),
  acAioPowerPercentLimits: Object.freeze([313, 314, 318]),
  acAioPauseSlot1: Object.freeze([319, 320])
});

const ORDERED_GROUPS = Object.freeze(Object.keys(HR_GROUPS));

const FUTURE_LIFECYCLE_PLANS = Object.freeze({
  manualChargeSlot8: Object.freeze({
    command: 'manual-charge-slot-8',
    preserveGroups: Object.freeze(['manualChargeCore', 'chargeSlot8FutureRoute', 'acAioPowerPercentLimits']),
    plannedRegisters: Object.freeze([261, 262, 263, 111, 96, 116, 313]),
    verificationGroups: Object.freeze(['manualChargeCore', 'chargeSlot8FutureRoute', 'acAioPowerPercentLimits'])
  }),
  manualExportSlot8: Object.freeze({
    command: 'manual-export-slot-8',
    preserveGroups: Object.freeze(['manualExportCore', 'exportSlot8FutureRoute', 'acAioPowerPercentLimits']),
    plannedRegisters: Object.freeze([291, 292, 293, 112, 59, 314]),
    verificationGroups: Object.freeze(['manualExportCore', 'exportSlot8FutureRoute', 'acAioPowerPercentLimits'])
  }),
  cheapOvernightChargeSlots9And10: Object.freeze({
    command: 'cheap-overnight-charge-slots-9-and-10',
    preserveGroups: Object.freeze(['manualChargeCore', 'cheapOvernightChargeSlots9And10', 'acAioPowerPercentLimits']),
    plannedRegisters: Object.freeze([264, 265, 266, 267, 268, 269, 111, 96, 116, 313]),
    verificationGroups: Object.freeze(['manualChargeCore', 'cheapOvernightChargeSlots9And10', 'acAioPowerPercentLimits'])
  }),
  acAioPowerPercentLimits: Object.freeze({
    command: 'ac-aio-power-percent-limits',
    preserveGroups: Object.freeze(['acAioPowerPercentLimits']),
    plannedRegisters: Object.freeze([313, 314, 318]),
    verificationGroups: Object.freeze(['acAioPowerPercentLimits'])
  })
});

const ORDERED_LIFECYCLE_PLANS = Object.freeze(Object.keys(FUTURE_LIFECYCLE_PLANS));


const ORDERED_DRY_RUN_COMMANDS = ORDERED_LIFECYCLE_PLANS;

function dryRunStateForPlan(plan) {
  if (!plan) return 'blocked-unread-preserve';
  if (plan.state === 'planned-not-executable') return 'rendered-not-executable';
  return plan.state.replace(/^planned-/, 'blocked-');
}

function buildDryRunCommandComposer(lifecyclePlans) {
  const commands = {};
  for (const name of ORDERED_DRY_RUN_COMMANDS) {
    const plan = lifecyclePlans && lifecyclePlans[name] ? lifecyclePlans[name] : null;
    commands[name] = {
      command: plan ? plan.command : name,
      state: dryRunStateForPlan(plan),
      requestBinding: 'absent',
      plannedRegisters: plan ? plan.plannedRegisters.slice() : [],
      preserveGroups: plan ? plan.preserveGroups.slice() : [],
      verificationGroups: plan ? plan.verificationGroups.slice() : [],
      mutationCommitAllowed: false,
      executable: false,
      liveWritesAvailable: false,
      commandExposure: 'locked'
    };
  }
  return commands;
}

function valueLabel(value) {
  return Number.isInteger(value) ? String(value) : 'unread';
}

function buildHoldingRegisterMap(blocks = []) {
  const map = new Map();
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || block.kind !== 'HR' || block.ok !== true || !Array.isArray(block.values)) continue;
    for (let i = 0; i < block.values.length; i += 1) {
      map.set(block.base + i, block.values[i]);
    }
  }
  return map;
}

function summariseRegisterGroup(registerMap, registers) {
  const values = {};
  let readable = 0;
  for (const register of registers) {
    const value = registerMap.has(register) ? registerMap.get(register) : null;
    values[`HR${register}`] = Number.isInteger(value) ? value : 'unread';
    if (Number.isInteger(value)) readable += 1;
  }

  return {
    registers: registers.slice(),
    values,
    readable,
    total: registers.length,
    state: readable === registers.length ? 'complete' : (readable > 0 ? 'partial' : 'unread')
  };
}


function groupState(groups, groupName) {
  return groups && groups[groupName] ? groups[groupName].state : 'unread';
}

function planState(groups, plan) {
  const states = plan.preserveGroups.map((groupName) => groupState(groups, groupName));
  if (states.every((state) => state === 'complete')) return 'planned-not-executable';
  if (states.some((state) => state === 'partial')) return 'blocked-partial-preserve';
  return 'blocked-unread-preserve';
}

function buildLifecyclePlans(groups) {
  const plans = {};
  for (const name of ORDERED_LIFECYCLE_PLANS) {
    const plan = FUTURE_LIFECYCLE_PLANS[name];
    plans[name] = {
      command: plan.command,
      state: planState(groups, plan),
      preserveGroups: plan.preserveGroups.slice(),
      plannedRegisters: plan.plannedRegisters.slice(),
      verificationGroups: plan.verificationGroups.slice(),
      executable: false,
      liveWritesAvailable: false,
      commandExposure: 'locked'
    };
  }
  return plans;
}

function buildStage4SafetyFrameworkReport(stage3Report = {}) {
  const registerMap = buildHoldingRegisterMap(stage3Report.blocks || []);
  const groups = {};
  for (const groupName of ORDERED_GROUPS) {
    groups[groupName] = summariseRegisterGroup(registerMap, HR_GROUPS[groupName]);
  }

  const completeGroups = ORDERED_GROUPS.filter((name) => groups[name].state === 'complete').length;
  const partialGroups = ORDERED_GROUPS.filter((name) => groups[name].state === 'partial').length;
  const unreadGroups = ORDERED_GROUPS.filter((name) => groups[name].state === 'unread').length;

  const lifecyclePlans = buildLifecyclePlans(groups);

  return {
    stage: 'GivHome 1.0.0 write/readback safety framework',
    version: STAGE4_FRAMEWORK_VERSION,
    mode: STAGE4_MODE,
    currentTargetOnly: true,
    writeFunctionAvailable: false,
    commandTilesAvailable: false,
    preserveBeforeWriteRequired: true,
    verifyAfterWriteRequired: true,
    restoreOnFailureRequired: true,
    executable: false,
    commandExposure: 'locked',
    sourceStage3Serial: stage3Report.serial || 'unknown',
    sourceStage3Family: stage3Report.profile && stage3Report.profile.family ? stage3Report.profile.family : 'unknown',
    summary: {
      groupCount: ORDERED_GROUPS.length,
      completeGroups,
      partialGroups,
      unreadGroups
    },
    groups,
    lifecyclePlans,
    dryRunCommands: buildDryRunCommandComposer(lifecyclePlans)
  };
}

function renderStage4FrameworkLine(report) {
  return 'Stage 4 safety framework: mode=%s currentTargetOnly=yes preserveBeforeWrite=required verifyAfterWrite=required restoreOnFailure=required writeFunction06=disabled commandTiles=disabled commandExposure=%s'
    .replace('%s', report.mode)
    .replace('%s', report.commandExposure || 'locked');
}

function renderStage4SnapshotLine(report) {
  const status = (name) => report.groups && report.groups[name] ? report.groups[name].state : 'unread';
  return [
    'Stage 4 register snapshot:',
    `manualChargeCore=${status('manualChargeCore')}`,
    `manualExportCore=${status('manualExportCore')}`,
    `chargeSlot8FutureRoute=${status('chargeSlot8FutureRoute')}`,
    `exportSlot8FutureRoute=${status('exportSlot8FutureRoute')}`,
    `cheapOvernightChargeSlots9And10=${status('cheapOvernightChargeSlots9And10')}`,
    `acAioPowerPercentLimits=${status('acAioPowerPercentLimits')}`,
    'restorePlan=not-executable',
    'commandExposure=locked'
  ].join(' ');
}

function renderStage4KeyValuesLine(report) {
  const charge = report.groups && report.groups.manualChargeCore ? report.groups.manualChargeCore.values : {};
  const exportCore = report.groups && report.groups.manualExportCore ? report.groups.manualExportCore.values : {};
  const ac = report.groups && report.groups.acAioPowerPercentLimits ? report.groups.acAioPowerPercentLimits.values : {};
  return [
    'Stage 4 key preserve values:',
    `HR94 charge_slot_1_start=${valueLabel(charge.HR94)}`,
    `HR95 charge_slot_1_end=${valueLabel(charge.HR95)}`,
    `HR96 charge_enable=${valueLabel(charge.HR96)}`,
    `HR111 charge_power=${valueLabel(charge.HR111)}`,
    `HR116 charge_target_soc=${valueLabel(charge.HR116)}`,
    `HR56 export_slot_1_start=${valueLabel(exportCore.HR56)}`,
    `HR57 export_slot_1_end=${valueLabel(exportCore.HR57)}`,
    `HR59 export_enable=${valueLabel(exportCore.HR59)}`,
    `HR112 export_power=${valueLabel(exportCore.HR112)}`,
    `HR313 battery_charge_limit_ac=${valueLabel(ac.HR313)}`,
    `HR314 battery_discharge_limit_ac=${valueLabel(ac.HR314)}`,
    'commandExposure=locked'
  ].join(' ');
}

function renderStage4GuardrailLine(report) {
  return [
    'Stage 4 restore guardrails:',
    `completeGroups=${report.summary.completeGroups}`,
    `partialGroups=${report.summary.partialGroups}`,
    `unreadGroups=${report.summary.unreadGroups}`,
    'writeFunction06=disabled',
    'liveWritesAvailable=no',
    'commandTiles=disabled',
    'commandExposure=locked'
  ].join(' ');
}


function renderStage4LifecyclePlanLine(report) {
  const plan = (name) => report.lifecyclePlans && report.lifecyclePlans[name] ? report.lifecyclePlans[name].state : 'blocked-unread-preserve';
  return [
    'Stage 4 lifecycle plan:',
    `manualChargeSlot8=${plan('manualChargeSlot8')}`,
    `manualExportSlot8=${plan('manualExportSlot8')}`,
    `cheapOvernightChargeSlots9And10=${plan('cheapOvernightChargeSlots9And10')}`,
    `acAioPowerPercentLimits=${plan('acAioPowerPercentLimits')}`,
    'preserveBeforeMutation=required',
    'verifyAfterMutation=required',
    'restoreOnFailure=required',
    'writeFunction06=disabled',
    'liveWritesAvailable=no',
    'commandExposure=locked'
  ].join(' ');
}

function renderStage4PlannedRegisterLine(report) {
  const regs = (name) => {
    const plan = report.lifecyclePlans && report.lifecyclePlans[name];
    return plan ? plan.plannedRegisters.map((register) => `HR${register}`).join(',') : 'unread';
  };
  return [
    'Stage 4 planned register sets:',
    `manualChargeSlot8=${regs('manualChargeSlot8')}`,
    `manualExportSlot8=${regs('manualExportSlot8')}`,
    `cheapOvernightChargeSlots9And10=${regs('cheapOvernightChargeSlots9And10')}`,
    `acAioPowerPercentLimits=${regs('acAioPowerPercentLimits')}`,
    'notExecutable=yes',
    'commandTiles=disabled',
    'commandExposure=locked'
  ].join(' ');
}


function renderStage4DryRunIntentLine(report) {
  const state = (name) => report.dryRunCommands && report.dryRunCommands[name] ? report.dryRunCommands[name].state : 'blocked-unread-preserve';
  return [
    'Stage 4 dry-run command intents:',
    `manualChargeSlot8=${state('manualChargeSlot8')}`,
    `manualExportSlot8=${state('manualExportSlot8')}`,
    `cheapOvernightChargeSlots9And10=${state('cheapOvernightChargeSlots9And10')}`,
    `acAioPowerPercentLimits=${state('acAioPowerPercentLimits')}`,
    'requestBinding=absent',
    'mutationCommit=no',
    'writeFunction06=disabled',
    'liveWritesAvailable=no',
    'commandExposure=locked'
  ].join(' ');
}

function renderStage4DryRunWriteOrderLine(report) {
  const regs = (name) => {
    const command = report.dryRunCommands && report.dryRunCommands[name];
    return command ? command.plannedRegisters.map((register) => `HR${register}`).join(',') : 'unread';
  };
  return [
    'Stage 4 dry-run write order:',
    `manualChargeSlot8=${regs('manualChargeSlot8')}`,
    `manualExportSlot8=${regs('manualExportSlot8')}`,
    `cheapOvernightChargeSlots9And10=${regs('cheapOvernightChargeSlots9And10')}`,
    `acAioPowerPercentLimits=${regs('acAioPowerPercentLimits')}`,
    'notExecutable=yes',
    'mutationCommit=no',
    'commandTiles=disabled',
    'commandExposure=locked'
  ].join(' ');
}

module.exports = {
  HR_GROUPS,
  FUTURE_LIFECYCLE_PLANS,
  ORDERED_LIFECYCLE_PLANS,
  ORDERED_DRY_RUN_COMMANDS,
  ORDERED_GROUPS,
  STAGE4_FRAMEWORK_VERSION,
  STAGE4_MODE,
  buildHoldingRegisterMap,
  buildLifecyclePlans,
  buildDryRunCommandComposer,
  buildStage4SafetyFrameworkReport,
  renderStage4FrameworkLine,
  renderStage4GuardrailLine,
  renderStage4LifecyclePlanLine,
  renderStage4DryRunIntentLine,
  renderStage4DryRunWriteOrderLine,
  renderStage4PlannedRegisterLine,
  renderStage4KeyValuesLine,
  renderStage4SnapshotLine,
  summariseRegisterGroup
};
