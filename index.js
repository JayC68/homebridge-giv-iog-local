'use strict';

const fs = require('fs');

const {
  DEFAULT_ADAPTER_SERIAL,
  DEFAULT_UNIT_ADDRESS,
  DEFAULT_POLL_INTERVAL_SECONDS,
  GENEROUS_CONNECT_TIMEOUT_MS,
  GENEROUS_READ_RESPONSE_TIMEOUT_MS,
  DEFAULT_STALE_AFTER_CONSECUTIVE_FAILURES,
  DIRECT_LOCAL_DEFAULT_PORT,
  INPUT_REGISTER_TELEMETRY_COUNT,
  INPUT_REGISTER_TELEMETRY_START,
  MAX_POLL_INTERVAL_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
  MAX_STALE_AFTER_CONSECUTIVE_FAILURES,
  MIN_STALE_AFTER_CONSECUTIVE_FAILURES,
  STAGE,
  STAGE_RUNTIME_MARKER
} = require('./lib/evidence-led-constants');
const { DirectLocalReadOnlyClient } = require('./lib/direct-modbus-client');
const { createInternalFlightRecorderLogger } = require('./lib/internal-flight-recorder');
const { decodeInputRegisters0To60 } = require('./lib/telemetry-decoder');
const { classifySerialPrefix } = require('./lib/profile-detector');
const {
  capabilityStateSummaryLine,
  renderBlockLogLine,
  runCapabilityDiscovery
} = require('./lib/capability-discovery');
const {
  buildStage4SafetyFrameworkReport,
  renderStage4FrameworkLine,
  renderStage4GuardrailLine,
  renderStage4LifecyclePlanLine,
  renderStage4DryRunIntentLine,
  renderStage4DryRunWriteOrderLine,
  renderStage4PlannedRegisterLine,
  renderStage4KeyValuesLine,
  renderStage4SnapshotLine
} = require('./lib/stage4-safety-framework');
const {
  buildOfflineWriteSingleRegisterFrame,
  buildStage5OfflineWriteComposerReport,
  renderStage5OfflineComposerLine,
  renderStage5OfflineFramePlanLine,
  renderStage5OfflineFrameVerificationLine,
  verifyOfflineWriteFrame
} = require('./lib/stage5-offline-write-composer');
const {
  ACCESSORY_IDS,
  accessoryDefinitions,
  batteryLevelState,
  deriveTelemetryModel,
  solarBrightnessEvidence,
  telemetryBrightnessState
} = require('./lib/read-only-accessory-model');
const {
  buildManualChargeAccessoryGateStatus,
  buildManualChargeActualHomeKitBindingPlan,
  renderManualChargeAccessoryGateLine,
  renderManualChargeActualHomeKitBindingPlanLine
} = require('./lib/manual-charge-accessory-gate');
const {
  buildManualChargeStartPlan,
  buildManualChargeCancelPlan
} = require('./lib/manual-charge-command-core');
const {
  buildManualChargeSupervisorStatus,
  evaluateManualChargeExpiredSlot,
  renderManualChargeSupervisorStatusLine,
  renderManualChargeSupervisorEvaluationLine
} = require('./lib/manual-charge-supervisor');
const { sendFunction06FrameOnce } = require('./lib/stage5-live-write-harness');
const { renderExportLifecycleAuthorityLine } = require('./lib/stage8-export-lifecycle-authority');
const { renderOctopusSmartWindowAuthorityLine } = require('./lib/octopus-smart-window-authority');
const { renderBatteryCareAuthorityLine } = require('./lib/battery-care-authority');
const {
  COMMAND_TILES,
  COMMAND_KINDS,
  buildApplianceControlConfig,
  renderIntegratedControlLine,
  getMergedCheapState,
  getBatteryCarePlan,
  earlyTerminationGraceEnd,
  ceilToHalfHour,
  isCeAcCoupledSerial,
  getCommandTile,
  safeStorageName,
  loadJson,
  saveJson
} = require('./lib/appliance-integrated-control');
const {
  buildSlotPlan: buildAgileExportAutopilotSlotPlan,
  findCurrentSelectedSlot: findCurrentAgileExportAutopilotSlot,
  updateLearningState: updateAgileExportAutopilotLearningState
} = require('./lib/agile-export-autopilot');

const PLUGIN_NAME = 'homebridge-giv-iog-local';
const PLATFORM_NAME = 'GivHomeModbus';
const MANUAL_CHARGE_ACCESSORY_ID = 'manual-charge-command';
const APPLIANCE_COMMAND_ACCESSORY_PREFIX = 'appliance-command';
const EVE_HISTORY_ACCESSORY_PREFIX = 'eve-history';
const READ_ONLY_ACCESSORY_UX_REVISION = 'givhome-1.1.0-agile-outgoing-status-lightbulb-ux-v2';
const DEFAULT_MANUAL_CHARGE_COMMAND_DURATION_MINUTES = 30;
const APPLIANCE_AUTOMATION_INTERVAL_MS = 30000;
const COMMAND_TRANSPORT_WAIT_TIMEOUT_MS = 180000;
const COMMAND_TRANSPORT_HOLD_MS = 45000;
const COMMAND_TRANSPORT_DEFER_LOG_MS = 5000;
const COMMAND_TRANSPORT_QUEUE_HOLD_MS = 15000;
const COMMAND_RETRY_ATTEMPTS = 3;
const COMMAND_RETRY_GAP_MS = 1500;
const CANCEL_DISABLE_ATTEMPTS = 6;


class GivHomeModbusPlatform {
  constructor(log, config, api) {
    this.config = config || {};
    const flight = createInternalFlightRecorderLogger(log, {
      baseDir: this.config.flightRecorderDir || '/var/lib/homebridge/givhome-flight-recorder',
      version: '4.0.0-beta.1',
      stage: 'GivHome Modbus 4.0.0-beta.1'
    });
    this.flightRecorder = flight.recorder;
    this.log = flight.log;
    this.api = api;

    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.accessories = [];
    this.accessoryByUUID = new Map();
    this.pollTimer = null;
    this.pollInFlight = false;
    this.latestModel = null;
    this.health = {
      state: 'starting',
      totalPolls: 0,
      totalFailures: 0,
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorReason: '',
      lastResponseMeta: null
    };

    this.name = String(this.config.name || 'GivHome Modbus').trim() || 'GivHome Modbus';
    this.inverterHost = String(this.config.inverterHost || '').trim();
    this.inverterPort = Number.isInteger(this.config.inverterPort) ? this.config.inverterPort : DIRECT_LOCAL_DEFAULT_PORT;
    this.configuredModbusUnitAddress = Number.isInteger(this.config.modbusUnitAddress) ? this.config.modbusUnitAddress : null;
    this.engineeringModbusUnitOverride = this.config.enableEngineeringModbusUnitOverride === true
      && String(this.config.engineeringModbusUnitOverrideAcknowledgement || '').trim() === 'ENABLE_ENGINEERING_MODBUS_UNIT_OVERRIDE'
      && Number.isInteger(this.config.modbusUnitAddress)
      && this.config.modbusUnitAddress >= 1
      && this.config.modbusUnitAddress <= 247;
    this.deviceAddress = this.engineeringModbusUnitOverride ? this.config.modbusUnitAddress : DEFAULT_UNIT_ADDRESS;
    this.inverterSerial = String(this.config.inverterSerial || '').trim();
    this.enableReadOnlyPolling = this.config.enableReadOnlyPolling !== false;
    this.pollIntervalSeconds = normalisePollInterval(this.config.pollIntervalSeconds);
    this.staleAfterConsecutiveFailures = normaliseStaleAfterConsecutiveFailures(this.config.staleAfterConsecutiveFailures);
    this.advancedDiagnostics = this.config.advancedDiagnostics === true;
    this.enableReadOnlyCapabilityDiscovery = this.config.enableReadOnlyCapabilityDiscovery === true;
    this.capabilityDiscoveryLevel = normaliseCapabilityDiscoveryLevel(this.config.capabilityDiscoveryLevel);
    this.capabilityDiscoveryInFlight = false;
    this.capabilityDiscoveryComplete = false;
    this.enableStage4SafetyFrameworkReadback = this.config.enableStage4SafetyFrameworkReadback !== false;
    this.manualChargeAccessoryGateStatus = buildManualChargeAccessoryGateStatus(this.config);
    this.manualChargeCommandDurationMinutes = normaliseManualChargeCommandDurationMinutes(this.config.manualChargeCommandDurationMinutes);
    this.manualChargeOriginalSlot = null;
    this.manualChargeCommandInFlight = null;
    this.manualChargeSwitchService = null;
    this.manualChargeSupervisorStatus = buildManualChargeSupervisorStatus(this.config);
    this.manualChargeSupervisorTimer = null;
    this.manualChargeSupervisorInFlight = false;
    this.commandTransportInFlight = false;
    this.commandPollHoldUntilMs = 0;
    this.commandIntentPending = false;
    this.commandQueueDepth = 0;
    this.commandQueueTail = Promise.resolve();
    this.commandTransportSequence = 0;
    this.maxPvKw = Number.isFinite(this.config.maxPvKw) && this.config.maxPvKw > 0 ? this.config.maxPvKw : null;
    this.solarCalibrationWarned = false;
    this.applianceControl = buildApplianceControlConfig(this.config);
    this.applianceCommandServices = new Map();
    this.applianceCommandTimers = new Map();
    this.applianceCommandInFlight = null;
    this.applianceSnapshots = new Map();
    this.octopusState = {
      token: null,
      tokenRetrievedAt: 0,
      lastPollMs: 0,
      lastPollOk: false,
      lastError: '',
      polling: false,
      dispatches: [],
      lastCheapUntil: null,
      earlyTerminationGraceUntil: null,
      earlyTerminationDispatchStart: null,
      earlyTerminationDispatchEnd: null
    };
    this.applianceAutomationTimer = null;
    this.lastAutomationSignature = '';
    this.autoChargeActive = false;
    this.autoChargeLabel = '';
    this.autoChargeProtectedUntilMs = 0;
    this.manualPauseIntent = 0;
    this.iogPauseSuppressedUntilMs = 0;
    this.lastBatteryCarePlanLogSignature = '';
    this.lastBatteryCarePlanLogMs = 0;
    this.batteryCareIdleLogIntervalMs = 15 * 60 * 1000;
    this.applianceCommandTruthCache = new Map();
    this.applianceCommandTruthSnapshot = null;
    this.applianceCommandTruthSnapshotAtMs = 0;
    this.applianceCommandTruthSnapshotInFlight = null;
    this.applianceCommandTruthSnapshotTtlMs = 5000;
    this.activeExcessExportSlot = null;
    this.excessEnergyExportActive = false;
    this.lastExcessExportDecisionSignature = '';
    this.lastExcessExportDecisionLogMs = 0;
    this.lastEveningExcessExportRecoveryAttemptMs = 0;
    this.eveningExcessExportRecoveryBaseBackoffMs = 5 * 60 * 1000;
    this.eveningExcessExportRecoveryMaxBackoffMs = 60 * 60 * 1000;
    this.eveningExcessExportRecoveryBackoffMs = this.eveningExcessExportRecoveryBaseBackoffMs;
    this.eveningExcessExportRecoveryConsecutiveFailures = 0;
    this.eveningExcessExportRecoveryFailedLast = false;
    this.readbackContinuityLogState = new Map();
    this.readbackContinuityLogIntervalMs = 15 * 60 * 1000;
    this.eveningExcessExportArmed = this.applianceControl.features.eveningExcessExport;
    this.loadEveningExcessExportMemory();
    this.activeOctopusFluxExportSlot = null;
    this.octopusFluxExportActive = false;
    this.octopusFluxExportObservedBatteryKwh = 0;
    this.octopusFluxExportObservedGridKwh = 0;
    this.octopusFluxExportLastObservedAtMs = 0;
    this.lastOctopusFluxObservedPowerLogMs = 0;
    this.octopusFluxExportArmed = this.applianceControl.features.octopusFluxExport;
    this.lastOctopusFluxExportDecisionSignature = '';
    this.lastOctopusFluxExportDecisionLogMs = 0;
    this.loadOctopusFluxExportMemory();
    this.activeOctopusAgileOutgoingSlot = null;
    this.octopusAgileOutgoingExportActive = false;
    this.octopusAgileOutgoingExportArmed = this.applianceControl.features.octopusAgileOutgoingExport;
    this.lastOctopusAgileOutgoingDecisionSignature = '';
    this.lastOctopusAgileOutgoingDecisionLogMs = 0;
    this.octopusAgileOutgoingPrices = { fetchedAtMs: 0, productCode: '', tariffCode: '', rates: [], error: '' };
    this.octopusAgileOutgoingLastFetchMs = 0;
    this.octopusAgileOutgoingFetchInFlight = null;
    this.octopusAgileOutgoingLastMonitorMs = 0;
    this.octopusAgileOutgoingObservedExportKwh = 0;
    this.octopusAgileOutgoingLastObservedAtMs = 0;
    this.octopusAgileOutgoingLastAuditMs = 0;
    this.octopusAgileOutgoingSuspendedReason = '';
    this.octopusAgileOutgoingLastPlannerLogSignature = '';
    this.octopusAgileOutgoingLastPlannerLogMs = 0;
    this.octopusAgileOutgoingLastLearningSaveMs = 0;
    this.octopusAgileOutgoingDailyPlan = null;
    this.loadOctopusAgileOutgoingMemory();
    this.ceAcChargeSlotMemory = null;
    this.loadCeAcChargeSlotMemory();
    this.eveHistoryServices = new Map();
    this.eveHistoryRuntimeTotals = new Map();
    this.eveHistoryLastRecordMs = 0;
    this.fakeGatoHistoryService = null;
    this.warnedMissingFakeGato = false;
    try {
      const fakeGatoHistory = require('fakegato-history');
      this.fakeGatoHistoryService = fakeGatoHistory(this.api);
    } catch {
      this.fakeGatoHistoryService = null;
    }

    this.log.info(STAGE_RUNTIME_MARKER);
    if (this.flightRecorder) {
      const recorderStatus = this.flightRecorder.status();
      this.log.warn('GivHome evidence internal Flight Recorder active: schema=%s baseDir=%s lastFile=%s writeFailures=%s externalServiceDependency=no automaticMutationPath=absent', recorderStatus.schemaVersion, recorderStatus.baseDir, recorderStatus.lastFile || 'pending', recorderStatus.writeFailures);
    }
    this.log.info('%s', renderManualChargeAccessoryGateLine(this.manualChargeAccessoryGateStatus));
    if (!this.manualChargeAccessoryGateStatus.enabled) {
      this.log.warn('Manual Charge command accessory remains disabled: homeKitExposure=locked commandTiles=disabled liveWritesFromHomeKit=no automaticMutationPath=absent');
    } else if (!this.manualChargeAccessoryGateStatus.liveWriteGateSatisfied) {
      this.log.warn('Manual Charge command accessory gate requested: service shell may be exposed, but HomeKit live writes remain locked because the second gate is not satisfied.');
    } else {
      this.log.warn('Manual Charge command accessory dual gate satisfied: HomeKit Set handler will bind for explicit user-triggered Manual Charge start/cancel only. automaticMutationPath=absent');
    }
    this.log.warn('GivHome evidence Intelligent Octopus Go dynamic-slot enforcement: original plugin semantic snapshot model retained; grid flow split corrected (IR30 positive=export, negative=import); Intelligent Octopus Go dispatch windows are logged, home-battery protection is continuously re-enforced while smart windows or early-termination billing grace are active, SOC-at-target no longer suppresses protection, changed dispatch windows can update the active inverter charge window, and plugin-internal Flight Recorder records GivHome Modbus evidence without relying on the external tail service.');
    this.log.warn('GivHome evidence Advanced Modbus unit policy: normalUnitAddress=17 configuredModbusUnitAddress=%s engineeringOverride=%s activeUnitAddress=%s uiExposure=hidden-from-normal-config automaticMutationPath=absent', this.configuredModbusUnitAddress ?? 'unset', this.engineeringModbusUnitOverride ? 'yes' : 'no', this.deviceAddress);
    this.log.warn('GivHome evidence smart-window policy: graceMinutes=%s cheapStart=%s cheapEnd=%s octopusPollSeconds=%s scope=Intelligent-Octopus-Go-dispatch-plus-early-termination-billing-grace gracePolicy=ceil-to-next-half-hour-up-to-configured-cap normalDispatchEndExtended=no dynamicDispatchUpdates=yes batteryCareGracePeriodsExcluded=yes automaticMutationPath=absent', this.applianceControl.graceMinutes, this.applianceControl.cheapStart, this.applianceControl.cheapEnd, this.applianceControl.octopusPollSeconds);
    this.log.warn('GivHome evidence v3.7.5 parity policy: octopusAgileOutgoingAutonomousExport=yes octopusAgileOutgoingMpanAudit=yes octopusFluxPeakExportPlanner=yes eveningExcessExportConfigSection=yes eveningExcessExportLegacyAliases=yes eveningExcessExportPlannerIdleReasons=yes eveningExcessExportRecoverySharedSnapshot=yes eveningExcessExportRecovery=yes truthBackedCommandSwitches=yes ceAcPersistentChargeSlotMemory=yes ceAcCleanupLeavesHr96Off=yes eveHistoryHardening=yes normalDispatchEndExtended=no automaticMutationPath=absent');
    this.log.warn('GivHome evidence Battery Care configuration: enabled=%s batteryCapacityKwh=%s maxBatteryChargePowerKw=%s batteryCareMode=%s minimumOvernightMinutes=%s targetSoc=%s route=HR111,HR116,HR94,HR95,HR96 scope=main-overnight-cheap-window-only excludes=short-IOG-dispatches,grace-periods,manual-tiles automaticMutationPath=%s', this.applianceControl.features.batteryCare ? 'yes' : 'no', this.applianceControl.batteryCapacityKwh, this.applianceControl.maxBatteryChargePowerKw, this.applianceControl.batteryCareMode, this.applianceControl.batteryCareMinimumWindowMinutes, this.applianceControl.targetSoc, this.applianceControl.automaticMutationPath);
    this.log.warn('GivHome evidence Octopus Agile Export Autopilot configuration: enabled=%s armed=%s stage=%s dryRun=%s slotSearchMode=%s allowedWindow=%s strategy=%s learningMode=%s dailyExportMode=%s region=%s product=%s tariff=%s daysPreset=%s daysToRun=%s minimumPricePence=%s minimumExtraRewardPence=%s energyCostBaselinePence=%s reserveSoc=%s reserveKwh=%s safetyMarginSoc=%s exportPowerKw=%s dailyExportCapKwh=%s mpanAudit=%s exportMpanConfigured=%s exportMeterSerialConfigured=%s automaticMutationPath=%s', this.applianceControl.features.octopusAgileOutgoingExport ? 'yes' : 'no', this.octopusAgileOutgoingExportArmed ? 'yes' : 'no', this.getOctopusAgileOutgoingExecutionStage(), this.applianceControl.octopusAgileOutgoingDryRun ? 'yes' : 'no', this.getOctopusAgileOutgoingSlotSearchMode(), this.formatOctopusAgileOutgoingAllowedWindow(), this.applianceControl.octopusAgileOutgoingStrategy, this.applianceControl.octopusAgileOutgoingLearningMode, this.applianceControl.octopusAgileOutgoingDailyExportMode, this.applianceControl.octopusAgileOutgoingRegionCode, this.applianceControl.octopusAgileOutgoingProductCode, this.getOctopusAgileOutgoingTariffCode(), this.applianceControl.octopusAgileOutgoingRunDaysPreset || 'legacy-list', this.formatOctopusAgileOutgoingDaysToRun(), this.applianceControl.octopusAgileOutgoingMinimumExportPricePence, this.applianceControl.octopusAgileOutgoingMinimumGrossMarginPence, this.applianceControl.octopusAgileOutgoingReferenceImportPence, this.applianceControl.octopusAgileOutgoingReserveSoc, this.applianceControl.octopusAgileOutgoingEveningReserveKwh, this.applianceControl.octopusAgileOutgoingSafetyMarginSoc, this.applianceControl.octopusAgileOutgoingExportPowerKw, this.applianceControl.octopusAgileOutgoingDailyExportCapKwh, this.applianceControl.octopusAgileOutgoingEnableMpanAudit ? 'yes' : 'no', this.applianceControl.octopusExportMpan ? 'yes' : 'no', this.applianceControl.octopusExportMeterSerial ? 'yes' : 'no', this.applianceControl.automaticMutationPath);
    const fluxEligibleMinutes = clockWindowDurationMinutes(this.applianceControl.octopusFluxExportStartTime, this.applianceControl.octopusFluxExportEndTime);
    const fluxFullBandKwh = Number.isFinite(fluxEligibleMinutes) ? ((Number(this.applianceControl.octopusFluxExportPowerKw) || 0) * (fluxEligibleMinutes / 60)).toFixed(2) : 'n/a';
    this.log.warn('GivHome evidence Octopus Flux Export configuration: enabled=%s armed=%s mode=fixed-peak-window eligiblePeakWindow=%s-%s fullBandKwhAtRequestedPower=%s windowMeaning=eligible-peak-period actualRun=energy-budgeted-short-slots daysPreset=%s daysToRun=%s reserveSoc=%s reserveKwh=%s safetyMarginSoc=%s exportPowerKw=%s slotMinutes=%s minimumExportKwh=%s automaticMutationPath=%s', this.applianceControl.features.octopusFluxExport ? 'yes' : 'no', this.octopusFluxExportArmed ? 'yes' : 'no', this.applianceControl.octopusFluxExportStartTime, this.applianceControl.octopusFluxExportEndTime, fluxFullBandKwh, this.applianceControl.octopusFluxRunDaysPreset || 'legacy-list', this.formatOctopusFluxDaysToRun(), this.applianceControl.octopusFluxReserveSoc, this.applianceControl.octopusFluxEveningReserveKwh, this.applianceControl.octopusFluxSafetyMarginSoc, this.applianceControl.octopusFluxExportPowerKw, this.applianceControl.octopusFluxSlotMinutes, this.applianceControl.octopusFluxMinimumExportKwh, this.applianceControl.automaticMutationPath);
    this.log.warn('%s', renderExportLifecycleAuthorityLine());
    this.log.warn('%s', renderOctopusSmartWindowAuthorityLine());
    this.log.warn('%s', renderBatteryCareAuthorityLine());
    this.log.warn('%s', renderIntegratedControlLine(this.applianceControl));
    this.log.warn('GivHome evidence status tile policy: cheapRateTile=%s intelligentOctopusGoConfigured=%s smartWindowTile=%s gracePeriodTile=%s noIntelligentOctopusGoNoSmartTiles=yes', this.applianceControl.features.cheapOvernightCharging ? 'yes' : 'no', this.isIntelligentOctopusGoConfigured() ? 'yes' : 'no', this.isIntelligentOctopusGoConfigured() ? 'yes' : 'no', this.isIntelligentOctopusGoConfigured() ? 'yes' : 'no');
    this.log.warn('%s', renderManualChargeSupervisorStatusLine(this.manualChargeSupervisorStatus));

    if (this.inverterSerial) {
      const hint = classifySerialPrefix(this.inverterSerial);
      this.log.info('Configured serial: %s -> %s / %s', this.inverterSerial, hint.family, hint.kind);
    }

    api.on('didFinishLaunching', () => {
      this.didFinishLaunching();
    });
  }

  configureAccessory(accessory) {
    this.accessories.push(accessory);
    this.accessoryByUUID.set(accessory.UUID, accessory);
  }

  didFinishLaunching() {
    const validation = this.validateConfiguredTarget();
    if (!validation.ok) {
      this.log.warn('Not configured: %s', validation.reason);
      this.log.warn('No accessories or polling will be started until inverterHost and inverterSerial are configured.');
      this.unregisterCachedAccessories('not configured');
      return;
    }

    this.ensureReadOnlyAccessories();
    this.ensureManualChargeCommandAccessory();
    this.ensureApplianceCommandAccessories();
    this.ensureEveHistoryAccessories();

    if (!this.enableReadOnlyPolling) {
      this.log.warn('Read-only polling is disabled in config. Accessories will stay idle.');
      return;
    }

    this.log.info(
      'Starting read-only IR0-60 polling: %s:%s unit=%s interval=%ss',
      this.inverterHost,
      this.inverterPort,
      this.deviceAddress,
      this.pollIntervalSeconds
    );

    this.pollOnce();
    this.pollTimer = setInterval(() => this.pollOnce(), this.pollIntervalSeconds * 1000);
    this.startManualChargeSupervisor();
    this.startApplianceAutomationLoops();

    if (this.enableReadOnlyCapabilityDiscovery) {
      this.log.info('GivHome capability read-only capability discovery is enabled: level=%s', this.capabilityDiscoveryLevel);
      setTimeout(() => this.runStage3CapabilityDiscovery(), 5000);
    }
  }

  validateConfiguredTarget() {
    if (!this.inverterHost) {
      return { ok: false, reason: 'inverterHost is required' };
    }

    if (!this.inverterSerial) {
      return { ok: false, reason: 'inverterSerial is required so gateway/controller responders can be rejected' };
    }

    const serialProfile = classifySerialPrefix(this.inverterSerial);
    if (!serialProfile.isDirectInverterCandidate) {
      return { ok: false, reason: `configured serial is not a direct inverter candidate: ${this.inverterSerial} (${serialProfile.kind})` };
    }

    return { ok: true };
  }

  unregisterCachedAccessories(reason) {
    if (this.accessories.length === 0) return;
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
    this.log.warn('Removed %s cached read-only accessor%s because the plugin is %s.', this.accessories.length, this.accessories.length === 1 ? 'y' : 'ies', reason);
    this.accessories = [];
    this.accessoryByUUID.clear();
  }

  isIntelligentOctopusGoConfigured() {
    return Boolean(this.applianceControl.features.intelligentOctopusGoConfigured);
  }

  readOnlyAccessoryDefinitionOptions() {
    return {
      includeCheapRate: Boolean(this.applianceControl.features.cheapOvernightCharging),
      includeIntelligentOctopusGoTiles: this.isIntelligentOctopusGoConfigured()
    };
  }

  currentCheapStateForStatusTiles(now = new Date()) {
    return getMergedCheapState(now, this.octopusState.dispatches, this.applianceControl, this.octopusState);
  }

  ensureReadOnlyAccessories() {
    const definitions = accessoryDefinitions(this.name, this.readOnlyAccessoryDefinitionOptions());
    const expectedUUIDs = new Set();
    const created = [];

    for (const definition of definitions) {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${this.name}:${READ_ONLY_ACCESSORY_UX_REVISION}:${definition.id}`);
      expectedUUIDs.add(uuid);

      let accessory = this.accessoryByUUID.get(uuid);
      if (!accessory) {
        accessory = new this.api.platformAccessory(definition.displayName, uuid);
        accessory.context.definitionId = definition.id;
        accessory.context.readOnly = true;
        this.accessoryByUUID.set(uuid, accessory);
        created.push(accessory);
      }

      accessory.context.definitionId = definition.id;
      accessory.context.readOnly = true;
      accessory.context.displayName = definition.displayName;
      accessory.displayName = definition.displayName;
      this.configureAccessoryServices(accessory, definition);
    }

    const stale = this.accessories.filter((accessory) => accessory.context && accessory.context.readOnly && !expectedUUIDs.has(accessory.UUID));
    if (stale.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      this.log.info('Removed %s stale read-only accessor%s.', stale.length, stale.length === 1 ? 'y' : 'ies');
    }

    if (this.applianceControl.features.octopusFluxExport) {
      const uuid = this.applianceCommandUUID(COMMAND_KINDS.OCTOPUS_FLUX_EXPORT);
      let accessory = this.accessoryByUUID.get(uuid);
      const isNew = !accessory;
      if (!accessory) {
        accessory = new this.api.platformAccessory('Octopus Flux Export', uuid);
        this.accessoryByUUID.set(uuid, accessory);
        this.accessories.push(accessory);
        created.push(accessory);
      }
      accessory.context.definitionId = `${APPLIANCE_COMMAND_ACCESSORY_PREFIX}:${COMMAND_KINDS.OCTOPUS_FLUX_EXPORT}`;
      accessory.context.commandAccessory = true;
      accessory.context.applianceCommandKind = COMMAND_KINDS.OCTOPUS_FLUX_EXPORT;
      accessory.displayName = 'Octopus Flux Export';
      this.configureOctopusFluxExportAccessory(accessory);
      if (!isNew) {
        this.log.warn('GivHome evidence Octopus Flux Export accessory already registered: armed=%s', this.octopusFluxExportArmed ? 'yes' : 'no');
      }
    } else {
      const uuid = this.applianceCommandUUID(COMMAND_KINDS.OCTOPUS_FLUX_EXPORT);
      const existing = this.accessoryByUUID.get(uuid);
      if (existing) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existing]);
        this.accessoryByUUID.delete(uuid);
        this.accessories = this.accessories.filter((candidate) => candidate.UUID !== uuid);
        this.log.warn('Removed Octopus Flux Export accessory because its GivHome command feature gate is disabled.');
      }
    }

    if (this.applianceControl.features.octopusAgileOutgoingExport) {
      const uuid = this.applianceCommandUUID(COMMAND_KINDS.OCTOPUS_AGILE_OUTGOING_EXPORT);
      let accessory = this.accessoryByUUID.get(uuid);
      const isNew = !accessory;
      if (!accessory) {
        accessory = new this.api.platformAccessory('Octopus Agile Export', uuid);
        this.accessoryByUUID.set(uuid, accessory);
        this.accessories.push(accessory);
        created.push(accessory);
      }
      accessory.context.definitionId = `${APPLIANCE_COMMAND_ACCESSORY_PREFIX}:${COMMAND_KINDS.OCTOPUS_AGILE_OUTGOING_EXPORT}`;
      accessory.context.commandAccessory = true;
      accessory.context.applianceCommandKind = COMMAND_KINDS.OCTOPUS_AGILE_OUTGOING_EXPORT;
      accessory.displayName = 'Octopus Agile Export';
      this.configureOctopusAgileOutgoingExportAccessory(accessory);
      if (!isNew) {
        this.log.warn('GivHome evidence Octopus Agile Export accessory already registered: armed=%s dryRun=%s', this.octopusAgileOutgoingExportArmed ? 'yes' : 'no', this.applianceControl.octopusAgileOutgoingDryRun ? 'yes' : 'no');
      }
    } else {
      const uuid = this.applianceCommandUUID(COMMAND_KINDS.OCTOPUS_AGILE_OUTGOING_EXPORT);
      const existing = this.accessoryByUUID.get(uuid);
      if (existing) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existing]);
        this.accessoryByUUID.delete(uuid);
        this.accessories = this.accessories.filter((candidate) => candidate.UUID !== uuid);
        this.log.warn('Removed Octopus Agile Export accessory because its GivHome command feature gate is disabled.');
      }
    }

    if (created.length > 0) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, created);
      this.log.info('Registered %s read-only accessor%s.', created.length, created.length === 1 ? 'y' : 'ies');
    } else {
      this.log.info('Read-only accessories already registered.');
    }
  }


  manualChargeAccessoryUUID() {
    return this.api.hap.uuid.generate(`${PLUGIN_NAME}:${this.name}:${MANUAL_CHARGE_ACCESSORY_ID}`);
  }

  ensureManualChargeCommandAccessory() {
    const uuid = this.manualChargeAccessoryUUID();
    let accessory = this.accessoryByUUID.get(uuid);

    if (!this.manualChargeAccessoryGateStatus.enabled) {
      if (accessory) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessoryByUUID.delete(uuid);
        this.accessories = this.accessories.filter((candidate) => candidate.UUID !== uuid);
        this.log.warn('Removed cached Manual Charge command accessory because the GivHome evidence accessory gate is disabled.');
      }
      this.log.warn('Manual Charge command accessory not registered: homeKitExposure=locked commandTiles=disabled liveWritesFromHomeKit=no');
      return;
    }

    const created = !accessory;
    if (!accessory) {
      accessory = new this.api.platformAccessory('Manual Charge', uuid);
      accessory.context.definitionId = MANUAL_CHARGE_ACCESSORY_ID;
      accessory.context.commandAccessory = true;
      this.accessoryByUUID.set(uuid, accessory);
      this.accessories.push(accessory);
    }

    accessory.context.definitionId = MANUAL_CHARGE_ACCESSORY_ID;
    accessory.context.commandAccessory = true;
    this.configureManualChargeCommandAccessory(accessory);

    if (created) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.log.warn('Registered GivHome evidence Manual Charge command accessory shell: liveWritesFromHomeKit=%s', this.manualChargeAccessoryGateStatus.liveWritesFromHomeKit ? 'yes' : 'no');
    } else {
      this.log.warn('GivHome evidence Manual Charge command accessory already registered: liveWritesFromHomeKit=%s', this.manualChargeAccessoryGateStatus.liveWritesFromHomeKit ? 'yes' : 'no');
    }

    const bindingPlan = buildManualChargeActualHomeKitBindingPlan(this.config, {
      startHmm: 1200,
      endHmm: 1201,
      powerPercent: 100,
      targetSoc: 100,
      originalStart: 0,
      originalEnd: 0
    });
    this.log.warn('%s', renderManualChargeActualHomeKitBindingPlanLine(bindingPlan));
  }


  applianceCommandUUID(kind) {
    return this.api.hap.uuid.generate(`${PLUGIN_NAME}:${this.name}:${APPLIANCE_COMMAND_ACCESSORY_PREFIX}:${kind}`);
  }

  eveHistoryUUID(kind) {
    return this.api.hap.uuid.generate(`${PLUGIN_NAME}:${this.name}:${EVE_HISTORY_ACCESSORY_PREFIX}:${kind}`);
  }

  ensureApplianceCommandAccessories() {
    const enabledCharge = this.applianceControl.features.chargeTiles;
    const enabledExport = this.applianceControl.features.exportTiles;
    const enabledPause = this.applianceControl.features.pauseTiles;
    const desired = new Set();
    const created = [];

    for (const tile of COMMAND_TILES) {
      const expose = (tile.family === 'charge' && enabledCharge) || (tile.family === 'export' && enabledExport) || (tile.family === 'pause' && enabledPause);
      const uuid = this.applianceCommandUUID(tile.kind);
      if (!expose) {
        const existing = this.accessoryByUUID.get(uuid);
        if (existing) {
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existing]);
          this.accessoryByUUID.delete(uuid);
          this.accessories = this.accessories.filter((candidate) => candidate.UUID !== uuid);
          this.log.warn('Removed GivHome evidence %s accessory because its feature gate is disabled.', tile.displayName);
        }
        continue;
      }
      desired.add(uuid);
      let accessory = this.accessoryByUUID.get(uuid);
      const isNew = !accessory;
      if (!accessory) {
        accessory = new this.api.platformAccessory(tile.displayName, uuid);
        this.accessoryByUUID.set(uuid, accessory);
        this.accessories.push(accessory);
        created.push(accessory);
      }
      accessory.context.definitionId = `${APPLIANCE_COMMAND_ACCESSORY_PREFIX}:${tile.kind}`;
      accessory.context.commandAccessory = true;
      accessory.context.applianceCommandKind = tile.kind;
      accessory.displayName = tile.displayName;
      this.configureApplianceCommandAccessory(accessory, tile);
      if (!isNew) {
        this.log.warn('GivHome evidence command accessory already registered: %s liveCapable=yes', tile.displayName);
      }
    }

    if (this.applianceControl.features.eveningExcessExport) {
      const uuid = this.applianceCommandUUID(COMMAND_KINDS.EVENING_EXCESS_EXPORT);
      let accessory = this.accessoryByUUID.get(uuid);
      const isNew = !accessory;
      if (!accessory) {
        accessory = new this.api.platformAccessory('Evening Excess Export', uuid);
        this.accessoryByUUID.set(uuid, accessory);
        this.accessories.push(accessory);
        created.push(accessory);
      }
      accessory.context.definitionId = `${APPLIANCE_COMMAND_ACCESSORY_PREFIX}:${COMMAND_KINDS.EVENING_EXCESS_EXPORT}`;
      accessory.context.commandAccessory = true;
      accessory.context.applianceCommandKind = COMMAND_KINDS.EVENING_EXCESS_EXPORT;
      accessory.displayName = 'Evening Excess Export';
      this.configureEveningExcessExportAccessory(accessory);
      if (!isNew) {
        this.log.warn('GivHome evidence Evening Excess Export accessory already registered: armed=%s', this.eveningExcessExportArmed ? 'yes' : 'no');
      }
    } else {
      const uuid = this.applianceCommandUUID(COMMAND_KINDS.EVENING_EXCESS_EXPORT);
      const existing = this.accessoryByUUID.get(uuid);
      if (existing) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existing]);
        this.accessoryByUUID.delete(uuid);
        this.accessories = this.accessories.filter((candidate) => candidate.UUID !== uuid);
        this.log.warn('Removed Evening Excess Export accessory because its GivHome command feature gate is disabled.');
      }
    }

    if (created.length > 0) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, created);
      this.log.warn('Registered %s GivHome evidence appliance command accessor%s.', created.length, created.length === 1 ? 'y' : 'ies');
    }
  }

  configureApplianceCommandAccessory(accessory, tile) {
    const info = accessory.getService(this.Service.AccessoryInformation) || accessory.addService(this.Service.AccessoryInformation);
    info
      .setCharacteristic(this.Characteristic.Manufacturer, 'Kernowek Consulting')
      .setCharacteristic(this.Characteristic.Model, 'GivHome Direct Appliance Command')
      .setCharacteristic(this.Characteristic.SerialNumber, this.inverterSerial || 'unconfirmed')
      .setCharacteristic(this.Characteristic.FirmwareRevision, '1.0.0');

    const service = accessory.getServiceById(this.Service.Switch, tile.kind) || accessory.addService(this.Service.Switch, tile.displayName, tile.kind);
    service.setCharacteristic(this.Characteristic.Name, tile.displayName);
    service.updateCharacteristic(this.Characteristic.On, false);
    this.applianceCommandServices.set(tile.kind, service);
    const onCharacteristic = service.getCharacteristic(this.Characteristic.On);
    if (typeof onCharacteristic.onGet === 'function') {
      onCharacteristic.onGet(async () => this.getApplianceCommandTruthState(tile.kind));
    }
    if (typeof onCharacteristic.onSet === 'function') {
      onCharacteristic.onSet(async (value) => this.handleApplianceCommandSet(tile.kind, Boolean(value)));
    } else if (typeof onCharacteristic.on === 'function') {
      onCharacteristic.on('set', (value, callback) => {
        this.handleApplianceCommandSet(tile.kind, Boolean(value)).then(() => callback()).catch(callback);
      });
    }
  }

  configureEveningExcessExportAccessory(accessory) {
    const info = accessory.getService(this.Service.AccessoryInformation) || accessory.addService(this.Service.AccessoryInformation);
    info
      .setCharacteristic(this.Characteristic.Manufacturer, 'Kernowek Consulting')
      .setCharacteristic(this.Characteristic.Model, 'GivHome Direct Evening Excess Export')
      .setCharacteristic(this.Characteristic.SerialNumber, this.inverterSerial || 'unconfirmed')
      .setCharacteristic(this.Characteristic.FirmwareRevision, '1.0.0');
    const service = accessory.getServiceById(this.Service.Switch, COMMAND_KINDS.EVENING_EXCESS_EXPORT)
      || accessory.addService(this.Service.Switch, 'Evening Excess Export', COMMAND_KINDS.EVENING_EXCESS_EXPORT);
    service.setCharacteristic(this.Characteristic.Name, 'Evening Excess Export');
    service.updateCharacteristic(this.Characteristic.On, Boolean(this.eveningExcessExportArmed));
    this.applianceCommandServices.set(COMMAND_KINDS.EVENING_EXCESS_EXPORT, service);
    const onCharacteristic = service.getCharacteristic(this.Characteristic.On);
    if (typeof onCharacteristic.onGet === 'function') {
      onCharacteristic.onGet(async () => this.getEveningExcessExportTruthState());
    }
    const handler = async (value) => {
      this.eveningExcessExportArmed = Boolean(value);
      service.updateCharacteristic(this.Characteristic.On, this.eveningExcessExportArmed);
      this.log.warn('Evening Excess Export %s from Apple Home: automaticMutationPath=%s', this.eveningExcessExportArmed ? 'armed' : 'disarmed', this.applianceControl.automaticMutationPath);
      if (!this.eveningExcessExportArmed) {
        this.activeExcessExportSlot = null;
        this.clearEveningExcessExportMemory();
        await this.cleanupApplianceCommandFamily('export', 'Evening Excess Export disarmed');
      }
    };
    if (typeof onCharacteristic.onSet === 'function') onCharacteristic.onSet(handler);
    else if (typeof onCharacteristic.on === 'function') onCharacteristic.on('set', (value, callback) => handler(value).then(() => callback()).catch(callback));
  }

  configureOctopusFluxExportAccessory(accessory) {
    const info = accessory.getService(this.Service.AccessoryInformation) || accessory.addService(this.Service.AccessoryInformation);
    info
      .setCharacteristic(this.Characteristic.Manufacturer, 'Kernowek Consulting')
      .setCharacteristic(this.Characteristic.Model, 'GivHome Direct Octopus Flux Export')
      .setCharacteristic(this.Characteristic.SerialNumber, this.inverterSerial || 'unconfirmed')
      .setCharacteristic(this.Characteristic.FirmwareRevision, '4.0.0-beta.1');
    const service = accessory.getServiceById(this.Service.Switch, COMMAND_KINDS.OCTOPUS_FLUX_EXPORT)
      || accessory.addService(this.Service.Switch, 'Octopus Flux Export', COMMAND_KINDS.OCTOPUS_FLUX_EXPORT);
    service.setCharacteristic(this.Characteristic.Name, 'Octopus Flux Export');
    service.updateCharacteristic(this.Characteristic.On, Boolean(this.octopusFluxExportArmed));
    this.applianceCommandServices.set(COMMAND_KINDS.OCTOPUS_FLUX_EXPORT, service);
    const onCharacteristic = service.getCharacteristic(this.Characteristic.On);
    if (typeof onCharacteristic.onGet === 'function') {
      onCharacteristic.onGet(async () => this.getOctopusFluxExportTruthState());
    }
    const handler = async (value) => {
      this.octopusFluxExportArmed = Boolean(value);
      service.updateCharacteristic(this.Characteristic.On, this.octopusFluxExportArmed);
      this.log.warn('Octopus Flux Export %s from Apple Home: automaticMutationPath=%s', this.octopusFluxExportArmed ? 'armed' : 'disarmed', this.applianceControl.automaticMutationPath);
      if (!this.octopusFluxExportArmed) {
        this.clearOctopusFluxExportMemory();
        await this.cleanupApplianceCommandFamily('export', 'Octopus Flux Export disarmed');
      }
    };
    if (typeof onCharacteristic.onSet === 'function') onCharacteristic.onSet(handler);
    else if (typeof onCharacteristic.on === 'function') onCharacteristic.on('set', (value, callback) => handler(value).then(() => callback()).catch(callback));
  }

  configureOctopusAgileOutgoingExportAccessory(accessory) {
    const info = accessory.getService(this.Service.AccessoryInformation) || accessory.addService(this.Service.AccessoryInformation);
    info
      .setCharacteristic(this.Characteristic.Manufacturer, 'Kernowek Consulting')
      .setCharacteristic(this.Characteristic.Model, 'GivHome Direct Octopus Agile Export')
      .setCharacteristic(this.Characteristic.SerialNumber, this.inverterSerial || 'unconfirmed')
      .setCharacteristic(this.Characteristic.FirmwareRevision, '4.0.0-beta.1');
    const service = accessory.getServiceById(this.Service.Switch, COMMAND_KINDS.OCTOPUS_AGILE_OUTGOING_EXPORT)
      || accessory.addService(this.Service.Switch, 'Octopus Agile Export', COMMAND_KINDS.OCTOPUS_AGILE_OUTGOING_EXPORT);
    service.setCharacteristic(this.Characteristic.Name, 'Octopus Agile Export');
    service.updateCharacteristic(this.Characteristic.On, Boolean(this.octopusAgileOutgoingExportArmed));
    this.applianceCommandServices.set(COMMAND_KINDS.OCTOPUS_AGILE_OUTGOING_EXPORT, service);
    const onCharacteristic = service.getCharacteristic(this.Characteristic.On);
    if (typeof onCharacteristic.onGet === 'function') {
      onCharacteristic.onGet(async () => this.getOctopusAgileOutgoingTruthState());
    }
    const handler = async (value) => {
      this.octopusAgileOutgoingExportArmed = Boolean(value);
      service.updateCharacteristic(this.Characteristic.On, this.octopusAgileOutgoingExportArmed);
      this.log.warn('Octopus Agile Export %s from Apple Home: autonomousExport=%s dryRun=%s mpanAudit=%s automaticMutationPath=%s', this.octopusAgileOutgoingExportArmed ? 'armed' : 'disarmed', this.octopusAgileOutgoingExportArmed ? 'yes' : 'no', this.applianceControl.octopusAgileOutgoingDryRun ? 'yes' : 'no', this.applianceControl.octopusAgileOutgoingEnableMpanAudit ? 'yes' : 'no', this.applianceControl.automaticMutationPath);
      if (!this.octopusAgileOutgoingExportArmed) {
        this.clearOctopusAgileOutgoingMemory();
        await this.cleanupApplianceCommandFamily('export', 'Octopus Agile Export disarmed');
      }
    };
    if (typeof onCharacteristic.onSet === 'function') onCharacteristic.onSet(handler);
    else if (typeof onCharacteristic.on === 'function') onCharacteristic.on('set', (value, callback) => handler(value).then(() => callback()).catch(callback));
  }

  ensureEveHistoryAccessories() {
    if (!this.applianceControl.features.eveHistory) return;
    const kinds = [
      { kind: 'solar', displayName: 'Eve Solar History', valueKey: 'pvPowerW' },
      { kind: 'import', displayName: 'Eve Import History', valueKey: 'gridImportPowerW' },
      { kind: 'export', displayName: 'Eve Export History', valueKey: 'gridExportPowerW' }
    ];
    const created = [];
    for (const meta of kinds) {
      const uuid = this.eveHistoryUUID(meta.kind);
      let accessory = this.accessoryByUUID.get(uuid);
      if (!accessory) {
        accessory = new this.api.platformAccessory(meta.displayName, uuid);
        this.accessoryByUUID.set(uuid, accessory);
        this.accessories.push(accessory);
        created.push(accessory);
      }
      accessory.context.definitionId = `${EVE_HISTORY_ACCESSORY_PREFIX}:${meta.kind}`;
      accessory.context.eveHistoryKind = meta.kind;
      accessory.context.eveHistoryValueKey = meta.valueKey;
      accessory.displayName = meta.displayName;
      this.configureEveHistoryAccessory(accessory, meta);
    }
    if (created.length > 0) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, created);
      this.log.warn('Registered %s GivHome evidence Eve history accessor%s.', created.length, created.length === 1 ? 'y' : 'ies');
    }
  }

  configureEveHistoryAccessory(accessory, meta) {
    const info = accessory.getService(this.Service.AccessoryInformation) || accessory.addService(this.Service.AccessoryInformation);
    info
      .setCharacteristic(this.Characteristic.Manufacturer, 'Kernowek Consulting')
      .setCharacteristic(this.Characteristic.Model, 'GivHome Direct Eve History')
      .setCharacteristic(this.Characteristic.SerialNumber, `${this.inverterSerial || 'unconfirmed'}-${meta.kind}`)
      .setCharacteristic(this.Characteristic.FirmwareRevision, '1.0.0');
    const service = accessory.getServiceById(this.Service.Outlet, meta.kind) || accessory.addService(this.Service.Outlet, meta.displayName, meta.kind);
    service.setCharacteristic(this.Characteristic.Name, meta.displayName);
    const eveOn = service.getCharacteristic(this.Characteristic.On);
    if (typeof eveOn.onGet === 'function') eveOn.onGet(() => false);
    eveOn.onSet(async () => {});
    service.updateCharacteristic(this.Characteristic.On, false);
    const outletInUse = service.getCharacteristic(this.Characteristic.OutletInUse);
    if (typeof outletInUse.onGet === 'function') outletInUse.onGet(() => false);
    service.updateCharacteristic(this.Characteristic.OutletInUse, false);
    if (this.fakeGatoHistoryService && !this.eveHistoryServices.has(meta.kind)) {
      try {
        const history = new this.fakeGatoHistoryService('energy', accessory, { size: 12 * 24 * 365 * 5, storage: 'fs' });
        this.eveHistoryServices.set(meta.kind, history);
        this.log.warn('Eve history fakegato service enabled for %s', meta.displayName);
      } catch (err) {
        this.log.warn('Eve history fakegato service failed for %s: %s', meta.displayName, err && err.message ? err.message : String(err));
      }
    }
  }

  configureManualChargeCommandAccessory(accessory) {
    const info = accessory.getService(this.Service.AccessoryInformation) || accessory.addService(this.Service.AccessoryInformation);
    info
      .setCharacteristic(this.Characteristic.Manufacturer, 'Kernowek Consulting')
      .setCharacteristic(this.Characteristic.Model, 'GivHome Direct Manual Charge')
      .setCharacteristic(this.Characteristic.SerialNumber, this.inverterSerial || 'unconfirmed')
      .setCharacteristic(this.Characteristic.FirmwareRevision, '1.0.0');

    const service = accessory.getService(this.Service.Switch) || accessory.addService(this.Service.Switch, 'Manual Charge');
    this.manualChargeSwitchService = service;
    accessory.displayName = 'Manual Charge';
    service.setCharacteristic(this.Characteristic.Name, 'Manual Charge');
    service.updateCharacteristic(this.Characteristic.On, false);

    if (!this.manualChargeAccessoryGateStatus.liveWriteGateSatisfied) {
      this.log.warn('Manual Charge command accessory service shell configured without live HomeKit Set handler: second gate not satisfied.');
      return;
    }

    const onCharacteristic = service.getCharacteristic(this.Characteristic.On);
    if (typeof onCharacteristic.onGet === 'function') {
      onCharacteristic.onGet(async () => this.getManualChargeTruthState());
    }
    if (typeof onCharacteristic.onSet === 'function') {
      onCharacteristic.onSet(async (value) => this.handleManualChargeHomeKitSet(value));
    } else if (typeof onCharacteristic.on === 'function') {
      onCharacteristic.on('set', (value, callback) => {
        this.handleManualChargeHomeKitSet(value).then(() => callback()).catch(callback);
      });
    } else {
      this.log.error('Manual Charge command accessory could not bind HomeKit Set handler: unsupported HAP characteristic API.');
      return;
    }

    this.log.warn('Manual Charge HomeKit Set handler bound behind dual explicit gates: liveWritesFromHomeKit=yes automaticMutationPath=absent');
  }

  async handleManualChargeHomeKitSet(value) {
    if (!this.manualChargeAccessoryGateStatus.liveWriteGateSatisfied) {
      this.log.warn('Manual Charge HomeKit live write rejected because the GivHome evidence second gate is not satisfied');
      this.setManualChargeHomeKitState(false);
      return;
    }

    const desiredOn = value === true || value === 1;
    const requested = desiredOn ? 'on' : 'off';

    if (this.manualChargeCommandInFlight) {
      this.log.warn('Manual Charge HomeKit set coalesced: requested=%s inFlight=%s liveWritesFromHomeKit=yes automaticMutationPath=absent', requested, this.manualChargeCommandInFlight.kind);
      try {
        await this.manualChargeCommandInFlight.promise;
      } catch (err) {
        this.log.warn('Manual Charge HomeKit in-flight command ended uncertain before coalesced %s: %s', requested, err && err.message ? err.message : String(err));
      }
      if (!desiredOn) {
        await this.runManualChargeCommandSafely('cancel', () => this.cancelManualChargeFromHomeKit());
        this.setManualChargeHomeKitState(false);
        return;
      }
    }

    const kind = desiredOn ? 'start' : 'cancel';
    const promise = this.runManualChargeCommandSafely(kind, async () => {
      if (desiredOn) {
        await this.startManualChargeFromHomeKit();
        this.setManualChargeHomeKitState(true);
        return;
      }

      await this.cancelManualChargeFromHomeKit();
      this.setManualChargeHomeKitState(false);
    });

    this.manualChargeCommandInFlight = { kind, promise };
    try {
      await promise;
    } finally {
      if (this.manualChargeCommandInFlight && this.manualChargeCommandInFlight.promise === promise) {
        this.manualChargeCommandInFlight = null;
      }
    }
  }

  async runManualChargeCommandSafely(kind, fn) {
    try {
      await this.withManualChargeTransportGate(`Manual Charge HomeKit ${kind}`, fn);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      this.log.warn('Manual Charge HomeKit %s failed without throwing to HomeKit: %s automaticMutationPath=absent', kind, message);
      try {
        await this.bestEffortManualChargeSafeState(`homekit-${kind}-failure`);
      } catch (cleanupErr) {
        this.log.warn('Manual Charge HomeKit %s cleanup uncertain: %s', kind, cleanupErr && cleanupErr.message ? cleanupErr.message : String(cleanupErr));
      }
      this.setManualChargeHomeKitState(false);
    }
  }

  async withManualChargeTransportGate(label, fn) {
    const ticket = ++this.commandTransportSequence;
    const queuedAtMs = Date.now();
    const depthAtQueue = this.commandQueueDepth;
    this.commandQueueDepth += 1;
    this.commandIntentPending = true;
    this.commandPollHoldUntilMs = Math.max(this.commandPollHoldUntilMs, Date.now() + COMMAND_TRANSPORT_QUEUE_HOLD_MS);
    this.log.warn('GivHome evidence command queued: ticket=%s label=%s depthBefore=%s pollingHeld=yes queueHoldMs=%s automaticMutationPath=local-command-queue', ticket, label, depthAtQueue, COMMAND_TRANSPORT_QUEUE_HOLD_MS);

    const previous = this.commandQueueTail || Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      try {
        return await this.enterQueuedCommandTransportGate(label, fn, ticket, queuedAtMs);
      } finally {
        this.commandQueueDepth = Math.max(0, this.commandQueueDepth - 1);
        this.commandIntentPending = this.commandQueueDepth > 0;
        if (!this.commandIntentPending && !this.commandTransportInFlight) {
          this.commandPollHoldUntilMs = Math.max(this.commandPollHoldUntilMs, Date.now() + 5000);
        }
      }
    });

    this.commandQueueTail = run.catch(() => undefined);
    return run;
  }

  async enterQueuedCommandTransportGate(label, fn, ticket, queuedAtMs) {
    const acquireStartedMs = Date.now();
    let nextDeferLogMs = acquireStartedMs;
    this.commandPollHoldUntilMs = Math.max(this.commandPollHoldUntilMs, Date.now() + COMMAND_TRANSPORT_QUEUE_HOLD_MS);

    while (this.pollInFlight || this.capabilityDiscoveryInFlight || this.commandTransportInFlight) {
      const waitedMs = Date.now() - acquireStartedMs;
      if (Date.now() >= nextDeferLogMs) {
        this.log.warn('GivHome evidence command deferred: ticket=%s label=%s waitedMs=%s pollInFlight=%s capabilityDiscoveryInFlight=%s commandTransportInFlight=%s automaticMutationPath=local-command-queue', ticket, label, waitedMs, this.pollInFlight ? 'yes' : 'no', this.capabilityDiscoveryInFlight ? 'yes' : 'no', this.commandTransportInFlight ? 'yes' : 'no');
        nextDeferLogMs = Date.now() + COMMAND_TRANSPORT_DEFER_LOG_MS;
      }
      if (waitedMs >= COMMAND_TRANSPORT_WAIT_TIMEOUT_MS) {
        throw new Error(`${label} queued transport timed out after ${waitedMs}ms waiting for direct Modbus transport idle`);
      }
      this.commandPollHoldUntilMs = Math.max(this.commandPollHoldUntilMs, Date.now() + COMMAND_TRANSPORT_QUEUE_HOLD_MS);
      await sleep(250);
    }

    this.commandTransportInFlight = true;
    this.commandPollHoldUntilMs = Date.now() + COMMAND_TRANSPORT_HOLD_MS;
    this.log.warn('GivHome evidence command started: ticket=%s label=%s queuedForMs=%s pollingHeld=yes holdMs=%s evidence=iOSLocalInverterTransportGate automaticMutationPath=local-command-queue', ticket, label, Date.now() - queuedAtMs, COMMAND_TRANSPORT_HOLD_MS);
    try {
      const result = await fn();
      this.log.warn('GivHome evidence command complete: ticket=%s label=%s result=success automaticMutationPath=local-command-queue', ticket, label);
      return result;
    } finally {
      this.commandPollHoldUntilMs = Date.now() + 5000;
      this.commandTransportInFlight = false;
      this.log.warn('GivHome evidence command released: ticket=%s label=%s pollingHoldAfterMs=5000 automaticMutationPath=local-command-queue', ticket, label);
    }
  }

  setManualChargeHomeKitState(value) {
    if (this.manualChargeSwitchService) {
      this.manualChargeSwitchService.updateCharacteristic(this.Characteristic.On, value === true);
    }
  }

  manualChargeClientOptions() {
    return {
      host: this.inverterHost,
      port: this.inverterPort,
      deviceAddress: this.deviceAddress,
      connectTimeoutMs: GENEROUS_CONNECT_TIMEOUT_MS,
      readTimeoutMs: GENEROUS_READ_RESPONSE_TIMEOUT_MS
    };
  }

  async readManualChargeCore() {
    const client = new DirectLocalReadOnlyClient(this.manualChargeClientOptions());
    const core = await client.readHoldingRegisters(94, 3);
    const powerTarget = await client.readHoldingRegisters(111, 6);
    return {
      HR94: core.values[0],
      HR95: core.values[1],
      HR96: core.values[2],
      HR111: powerTarget.values[0],
      HR116: powerTarget.values[5]
    };
  }

  async readManualChargeCoreWithRetry(label, attempts = COMMAND_RETRY_ATTEMPTS) {
    let lastErr = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await this.readManualChargeCore();
        if (attempt > 1) {
          this.log.warn('Manual Charge HomeKit retry recovered: phase=%s attempt=%s', label, attempt);
        }
        return result;
      } catch (err) {
        lastErr = err;
        this.log.warn('Manual Charge HomeKit retry: phase=%s attempt=%s result=fail error=%s', label, attempt, err && err.message ? err.message : String(err));
        await sleep(COMMAND_RETRY_GAP_MS);
      }
    }
    throw lastErr || new Error(`${label} failed`);
  }

  async startManualChargeFromHomeKit() {
    const original = await this.readManualChargeCoreWithRetry('start-snapshot');
    if (original.HR96 !== 0) {
      throw new Error(`Manual Charge start refused: HR96 already enabled (${original.HR96})`);
    }

    const now = new Date();
    const end = addMinutes(now, this.manualChargeCommandDurationMinutes);
    if (now.toDateString() !== end.toDateString()) {
      throw new Error('Manual Charge start refused because the requested duration crosses midnight');
    }

    const startHmm = dateToHmm(now);
    const endHmm = dateToHmm(end);
    const powerPercent = validPercentOrDefault(original.HR111, 100);
    const targetSoc = validPercentOrDefault(original.HR116, 100);

    this.manualChargeOriginalSlot = {
      HR94: original.HR94,
      HR95: original.HR95,
      HR96: original.HR96,
      HR111: original.HR111,
      HR116: original.HR116,
      startedAt: new Date().toISOString()
    };

    this.log.warn('Manual Charge HomeKit start executing: HR111=%s HR116=%s HR94=%s HR95=%s HR96=1 durationMinutes=%s route=core evidence=iOSPreEnableVerify', powerPercent, targetSoc, startHmm, endHmm, this.manualChargeCommandDurationMinutes);

    const preEnableWrites = [
      { register: 111, label: 'HR111', value: powerPercent },
      { register: 116, label: 'HR116', value: targetSoc },
      { register: 94, label: 'HR94', value: startHmm },
      { register: 95, label: 'HR95', value: endHmm }
    ];

    for (const write of preEnableWrites) {
      await this.writeManualChargeRegisterWithRetry(write.register, write.value, `Manual Charge start ${write.label}`);
    }

    await this.verifyManualChargePreEnable({ startHmm, endHmm, powerPercent, targetSoc });
    this.log.warn('Manual Charge HomeKit pre-enable verified: HR94=%s HR95=%s HR111=%s HR116=%s enableWriteAllowed=yes', startHmm, endHmm, powerPercent, targetSoc);

    await this.writeManualChargeRegisterWithRetry(96, 1, 'Manual Charge enable HR96');
    await this.verifyManualChargeEnable(1, 'start-enable');
    this.log.warn('Manual Charge HomeKit start complete: liveWritesFromHomeKit=yes automaticMutationPath=absent');
  }

  async cancelManualChargeFromHomeKit() {
    const originalSlot = this.manualChargeOriginalSlot;
    this.log.warn('Manual Charge HomeKit cancel executing: restoreSlot=%s restoreFirst=HR96 evidence=iOSDisableFirst', originalSlot ? 'yes' : 'no');

    await this.disableManualChargeEnableWithRetries('cancel');

    if (originalSlot) {
      await this.writeManualChargeRegisterWithRetry(94, originalSlot.HR94, 'Manual Charge restore HR94');
      await this.writeManualChargeRegisterWithRetry(95, originalSlot.HR95, 'Manual Charge restore HR95');
      await this.writeManualChargeRegisterWithRetry(111, originalSlot.HR111, 'Manual Charge restore HR111');
      await this.writeManualChargeRegisterWithRetry(116, originalSlot.HR116, 'Manual Charge restore HR116');
      await this.verifyManualChargeRestored(originalSlot, 'cancel');
    }

    this.manualChargeOriginalSlot = null;
    this.log.warn('Manual Charge HomeKit cancel complete: HR96 disabled first. automaticMutationPath=absent');
  }

  async verifyManualChargePreEnable(expected) {
    for (let attempt = 1; attempt <= COMMAND_RETRY_ATTEMPTS; attempt++) {
      try {
        const actual = await this.readManualChargeCore();
        this.log.warn('Manual Charge HomeKit pre-enable readback: attempt=%s HR94=%s HR95=%s HR111=%s HR116=%s HR96=%s', attempt, actual.HR94, actual.HR95, actual.HR111, actual.HR116, actual.HR96);
        if (actual.HR94 === expected.startHmm && actual.HR95 === expected.endHmm && actual.HR111 === expected.powerPercent && actual.HR116 === expected.targetSoc && actual.HR96 === 0) {
          return true;
        }
      } catch (err) {
        this.log.warn('Manual Charge HomeKit pre-enable readback failed: attempt=%s error=%s', attempt, err && err.message ? err.message : String(err));
      }
      await sleep(COMMAND_RETRY_GAP_MS);
    }
    await this.bestEffortManualChargeSafeState('pre-enable-verification-failed');
    throw new Error('Manual Charge pre-enable register verification failed; HR96 was not left enabled');
  }

  async verifyManualChargeEnable(expectedValue, label) {
    for (let attempt = 1; attempt <= COMMAND_RETRY_ATTEMPTS; attempt++) {
      try {
        const actual = await this.readManualChargeCore();
        this.log.warn('Manual Charge HomeKit enable readback: phase=%s attempt=%s HR96=%s', label, attempt, actual.HR96);
        if (actual.HR96 === expectedValue) return true;
      } catch (err) {
        this.log.warn('Manual Charge HomeKit enable readback failed: phase=%s attempt=%s error=%s', label, attempt, err && err.message ? err.message : String(err));
      }
      await sleep(COMMAND_RETRY_GAP_MS);
    }
    throw new Error(`Manual Charge enable readback did not match ${expectedValue}`);
  }

  async verifyManualChargeRestored(original, reason) {
    for (let attempt = 1; attempt <= COMMAND_RETRY_ATTEMPTS; attempt++) {
      try {
        const actual = await this.readManualChargeCore();
        this.log.warn('Manual Charge HomeKit restore readback: reason=%s attempt=%s HR94=%s HR95=%s HR96=%s HR111=%s HR116=%s', reason, attempt, actual.HR94, actual.HR95, actual.HR96, actual.HR111, actual.HR116);
        if (actual.HR94 === original.HR94 && actual.HR95 === original.HR95 && actual.HR96 === 0 && actual.HR111 === original.HR111 && actual.HR116 === original.HR116) {
          return true;
        }
      } catch (err) {
        this.log.warn('Manual Charge HomeKit restore readback failed: reason=%s attempt=%s error=%s', reason, attempt, err && err.message ? err.message : String(err));
      }
      await sleep(COMMAND_RETRY_GAP_MS);
    }
    throw new Error('Manual Charge restore readback did not match original snapshot');
  }

  async disableManualChargeEnableWithRetries(context) {
    for (let attempt = 1; attempt <= CANCEL_DISABLE_ATTEMPTS; attempt++) {
      try {
        await this.writeManualChargeRegisterWithRetry(96, 0, `Manual Charge ${context} disable HR96`, 1);
        const actual = await this.readManualChargeCore();
        if (actual.HR96 === 0) {
          this.log.warn('Manual Charge HomeKit disable verified: context=%s attempt=%s HR96=0', context, attempt);
          return true;
        }
      } catch (err) {
        this.log.warn('Manual Charge HomeKit disable retry: context=%s attempt=%s error=%s', context, attempt, err && err.message ? err.message : String(err));
      }
      await sleep(COMMAND_RETRY_GAP_MS);
    }
    throw new Error('Manual Charge cancel could not verify HR96=0');
  }

  async bestEffortManualChargeSafeState(reason) {
    this.log.warn('Manual Charge best-effort safe-state start: reason=%s restoreFirst=HR96 automaticMutationPath=absent', reason);
    try { await this.writeManualChargeRegisterWithRetry(96, 0, 'Manual Charge best-effort HR96', 1); } catch (err) { this.log.warn('Manual Charge best-effort HR96 uncertain: %s', err && err.message ? err.message : String(err)); }
    if (this.manualChargeOriginalSlot) {
      try { await this.writeManualChargeRegisterWithRetry(94, this.manualChargeOriginalSlot.HR94, 'Manual Charge best-effort HR94', 1); } catch (err) { this.log.warn('Manual Charge best-effort HR94 uncertain: %s', err && err.message ? err.message : String(err)); }
      try { await this.writeManualChargeRegisterWithRetry(95, this.manualChargeOriginalSlot.HR95, 'Manual Charge best-effort HR95', 1); } catch (err) { this.log.warn('Manual Charge best-effort HR95 uncertain: %s', err && err.message ? err.message : String(err)); }
      try { await this.writeManualChargeRegisterWithRetry(111, this.manualChargeOriginalSlot.HR111, 'Manual Charge best-effort HR111', 1); } catch (err) { this.log.warn('Manual Charge best-effort HR111 uncertain: %s', err && err.message ? err.message : String(err)); }
      try { await this.writeManualChargeRegisterWithRetry(116, this.manualChargeOriginalSlot.HR116, 'Manual Charge best-effort HR116', 1); } catch (err) { this.log.warn('Manual Charge best-effort HR116 uncertain: %s', err && err.message ? err.message : String(err)); }
    }
  }

  async writeManualChargeRegisterWithRetry(register, value, label) {
    return this.writeManualChargeRegister(register, value, label);
  }

  async writeManualChargeRegister(register, value, label) {
    const frame = buildOfflineWriteSingleRegisterFrame({
      deviceAddress: this.deviceAddress,
      register,
      value
    });
    const frameVerification = verifyOfflineWriteFrame(frame);
    if (!frameVerification.ok) {
      throw new Error(`${label} Function 06 frame verification failed before HomeKit live write`);
    }

    const writeResponse = await sendFunction06FrameOnce({
      host: this.inverterHost,
      port: this.inverterPort,
      responseTimeoutMs: 3000,
      enablePreSendGracefulContinuity: true,
      onPreSendContinuityEvent: (event) => {
        if (event.result === 'fail') {
          this.log.warn('Manual Charge HomeKit Graceful Continuity pre-send: phase=%s label=%s opportunity=%s result=fail error=%s noPayloadSent=yes', event.phase, label, event.opportunity, event.error || 'unknown');
        } else if (event.recovered) {
          this.log.warn('Manual Charge HomeKit Graceful Continuity pre-send recovered: label=%s opportunity=%s noPayloadSent=yes', label, event.opportunity);
        }
      },
      frame
    });

    if (!writeResponse.responseReceived) {
      this.log.warn('Manual Charge HomeKit Function 06 acknowledgement uncertain: label=%s payloadSent=%s postSendError=%s readbackReconciliation=required', label, writeResponse.payloadSent ? 'yes' : 'no', writeResponse.postSendError || 'none');
    }

    const client = new DirectLocalReadOnlyClient(Object.assign({}, this.manualChargeClientOptions(), {
      onGracefulContinuityEvent: (event) => {
        if (event.result === 'fail') {
          this.log.warn('Manual Charge HomeKit Graceful Continuity readback: label=%s register=HR%s opportunity=%s result=fail error=%s', label, register, event.opportunity, event.error || 'unknown');
        } else if (event.recovered) {
          this.log.warn('Manual Charge HomeKit Graceful Continuity readback recovered: label=%s register=HR%s opportunity=%s', label, register, event.opportunity);
        }
      }
    }));
    const readback = await client.readHoldingRegisters(register, 1);
    if (readback.values[0] !== value) {
      throw new Error(`${label} post-send readback reconciliation failed: requested=${value} readback=${readback.values[0]} noBlindResend=yes`);
    }
    this.log.warn('Manual Charge HomeKit Function 06 reconciled: label=%s HR%s=%s responseReceived=%s noBlindResend=yes', label, register, value, writeResponse.responseReceived ? 'yes' : 'no');
  }





  async handleApplianceCommandSet(kind, value) {
    if (kind === COMMAND_KINDS.EVENING_EXCESS_EXPORT) return;
    const tile = getCommandTile(kind);
    if (!tile) return;
    if (!value) {
      if (tile.family === 'pause') {
        await this.cleanupManualPauseToEco(`${tile.displayName} switched off`);
        this.setPauseTileStatesFromPrestate({ HR318: 0, HR319: 0, HR320: 0 });
      } else {
        await this.cleanupApplianceCommandFamily(tile.family, `${tile.displayName} switched off`);
        this.setApplianceCommandState(kind, false);
      }
      return;
    }
    if (this.applianceCommandInFlight) {
      this.log.warn('GivHome command command rejected: %s requested while %s in flight', tile.displayName, this.applianceCommandInFlight);
      this.setApplianceCommandState(kind, false);
      return;
    }
    const featureEnabled = tile.family === 'charge' ? this.applianceControl.features.chargeTiles : (tile.family === 'export' ? this.applianceControl.features.exportTiles : this.applianceControl.features.pauseTiles);
    if (!featureEnabled) {
      this.log.warn('GivHome command command rejected: %s feature gate disabled', tile.displayName);
      this.setApplianceCommandState(kind, false);
      return;
    }
    this.applianceCommandInFlight = tile.kind;
    try {
      await this.withManualChargeTransportGate(`GivHome command ${tile.displayName}`, async () => {
        if (tile.family === 'charge') {
          await this.startTimedChargeCommand(tile);
        } else if (tile.family === 'pause') {
          await this.startManualPauseCommand(tile);
        } else {
          await this.startTimedExportCommand(tile);
        }
      });
      this.setApplianceCommandState(kind, true);
      this.clearSiblingApplianceCommandStates(kind, tile.family);
      if (tile.family !== 'pause' && Number.isFinite(Number(tile.minutes))) this.scheduleApplianceCommandCleanup(tile.kind, tile.family, tile.minutes);
    } catch (err) {
      this.log.warn('GivHome command %s failed safely: %s', tile.displayName, err && err.message ? err.message : String(err));
      this.setApplianceCommandState(kind, false);
      try { await this.cleanupApplianceCommandFamily(tile.family, `${tile.displayName} failed`); } catch (cleanupErr) { this.log.warn('GivHome command cleanup after %s failed/uncertain: %s', tile.displayName, cleanupErr && cleanupErr.message ? cleanupErr.message : String(cleanupErr)); }
    } finally {
      this.applianceCommandInFlight = null;
    }
  }

  setApplianceCommandState(kind, value) {
    this.applianceCommandTruthCache.set(kind, value === true);
    const service = this.applianceCommandServices.get(kind);
    if (service) service.updateCharacteristic(this.Characteristic.On, value === true);
  }

  clearSiblingApplianceCommandStates(activeKind, family) {
    for (const tile of COMMAND_TILES) {
      if (tile.family === family && tile.kind !== activeKind) this.setApplianceCommandState(tile.kind, false);
    }
  }

  scheduleApplianceCommandCleanup(kind, family, minutes) {
    if (this.applianceCommandTimers.has(kind)) clearTimeout(this.applianceCommandTimers.get(kind));
    const timer = setTimeout(() => {
      this.applianceCommandTimers.delete(kind);
      this.cleanupApplianceCommandFamily(family, `${kind} duration ended`).catch((err) => {
        this.log.warn('GivHome command timed cleanup failed/uncertain: kind=%s error=%s', kind, err && err.message ? err.message : String(err));
      });
    }, Math.max(1, minutes) * 60000 + 5000);
    this.applianceCommandTimers.set(kind, timer);
  }

  stateFilePath(label) {
    const serial = safeStorageName(this.inverterSerial || 'pending');
    return `${process.cwd()}/givhome_modbus_${serial}_${label}.json`;
  }

  ceAcChargeSlotStatePath() {
    return this.stateFilePath('ce_ac_charge_slot_memory');
  }

  eveningExcessExportStatePath() {
    return this.stateFilePath('evening_excess_export_state');
  }

  octopusFluxExportStatePath() {
    return this.stateFilePath('octopus_flux_export_state');
  }

  isCeAcCoupledProfile() {
    return isCeAcCoupledSerial(this.inverterSerial);
  }

  persistCeAcChargeSlotSnapshot(snapshot, reason) {
    if (!this.isCeAcCoupledProfile() || !snapshot) return;
    const payload = {
      version: '1.0.0',
      stage: 'givhome-1.0.0-ce-ac-persistent-charge-slot-memory',
      serial: this.inverterSerial,
      capturedAt: new Date().toISOString(),
      reason: reason || 'temporary-charge-prestate',
      snapshot
    };
    try {
      saveJson(this.ceAcChargeSlotStatePath(), payload);
      this.ceAcChargeSlotMemory = payload;
      this.log.warn('GivHome evidence CE/AC charge-slot memory saved: HR94=%s HR95=%s HR96=%s HR111=%s HR116=%s reason=%s source=iOS-profile-router automaticMutationPath=absent', snapshot.HR94, snapshot.HR95, snapshot.HR96, snapshot.HR111, snapshot.HR116, payload.reason);
    } catch (err) {
      this.log.warn('GivHome evidence CE/AC charge-slot memory save failed: %s', err && err.message ? err.message : String(err));
    }
  }

  loadCeAcChargeSlotMemory() {
    const payload = loadJson(this.ceAcChargeSlotStatePath(), null);
    if (payload?.snapshot && payload.serial === this.inverterSerial) {
      this.ceAcChargeSlotMemory = payload;
      this.log.warn('GivHome evidence CE/AC charge-slot memory loaded: capturedAt=%s reason=%s automaticMutationPath=absent', payload.capturedAt || 'unknown', payload.reason || 'unknown');
    }
  }

  clearCeAcChargeSlotMemory() {
    this.ceAcChargeSlotMemory = null;
    try { fs.rmSync(this.ceAcChargeSlotStatePath(), { force: true }); } catch {}
  }

  persistEveningExcessExportMemory(slot, reason) {
    if (!slot) return;
    const payload = {
      version: '1.0.0',
      stage: 'givhome-1.0.0-evening-excess-export-recovery-repair',
      serial: this.inverterSerial,
      capturedAt: new Date().toISOString(),
      reason: reason || 'evening-excess-export-start',
      slot: {
        start: slot.start instanceof Date ? slot.start.toISOString() : slot.start,
        end: slot.end instanceof Date ? slot.end.toISOString() : slot.end,
        minutes: slot.minutes || slot.forceMinutes || null,
        profileKind: slot.profileKind || null,
        powerPercent: Number.isFinite(Number(slot.powerPercent)) ? Number(slot.powerPercent) : this.applianceControl.eveningExportPowerPercent,
        powerKw: Number.isFinite(Number(slot.powerKw)) ? Number(slot.powerKw) : this.applianceControl.eveningExportPowerKw,
        requestedPowerKw: Number.isFinite(Number(slot.requestedPowerKw)) ? Number(slot.requestedPowerKw) : this.applianceControl.eveningExportPowerKw,
        expectedGridExportKw: Number.isFinite(Number(slot.expectedGridExportKw)) ? Number(slot.expectedGridExportKw) : null,
        reserveSoc: slot.reserveSoc || this.applianceControl.eveningExportReserveSoc,
        source: slot.source || 'unknown'
      }
    };
    try {
      saveJson(this.eveningExcessExportStatePath(), payload);
      this.log.warn('GivHome evidence Evening Excess Export memory saved: start=%s end=%s reason=%s recovery=yes automaticMutationPath=absent', slot.start instanceof Date ? dateToDisplayHmm(slot.start) : String(slot.start || 'unknown'), slot.end instanceof Date ? dateToDisplayHmm(slot.end) : String(slot.end || 'unknown'), payload.reason);
    } catch (err) {
      this.log.warn('GivHome evidence Evening Excess Export memory save failed: %s', err && err.message ? err.message : String(err));
    }
  }

  loadEveningExcessExportMemory() {
    const payload = loadJson(this.eveningExcessExportStatePath(), null);
    if (!payload?.slot || payload.serial !== this.inverterSerial) return;
    const start = new Date(payload.slot.start);
    const end = new Date(payload.slot.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    this.activeExcessExportSlot = { ...payload.slot, start, end, recoveredFromMemory: true };
    if (end > new Date() && this.applianceControl.features.eveningExcessExport) this.eveningExcessExportArmed = true;
    this.log.warn('GivHome evidence Evening Excess Export memory loaded: start=%s end=%s activeNow=%s automaticMutationPath=absent', dateToDisplayHmm(start), dateToDisplayHmm(end), new Date() < end ? 'yes' : 'no');
  }

  clearEveningExcessExportMemory() {
    try { fs.rmSync(this.eveningExcessExportStatePath(), { force: true }); } catch {}
  }

  persistOctopusFluxExportMemory(slot, reason) {
    if (!slot) return;
    const payload = {
      version: '4.0.0-beta.1',
      stage: 'givhome-1.1.0-octopus-flux-export-observed-power-ratio-planner',
      serial: this.inverterSerial,
      capturedAt: new Date().toISOString(),
      reason: reason || 'octopus-flux-export-start',
      slot: {
        start: slot.start instanceof Date ? slot.start.toISOString() : slot.start,
        end: slot.end instanceof Date ? slot.end.toISOString() : slot.end,
        minutes: slot.minutes,
        profileKind: slot.profileKind,
        powerPercent: Number.isFinite(Number(slot.powerPercent)) ? Number(slot.powerPercent) : this.applianceControl.octopusFluxExportPowerPercent,
        powerKw: Number.isFinite(Number(slot.powerKw)) ? Number(slot.powerKw) : this.applianceControl.octopusFluxExportPowerKw,
        requestedPowerKw: Number.isFinite(Number(slot.requestedPowerKw)) ? Number(slot.requestedPowerKw) : this.applianceControl.octopusFluxExportPowerKw,
        effectivePlanningKw: Number.isFinite(Number(slot.effectivePlanningKw)) ? Number(slot.effectivePlanningKw) : this.applianceControl.maxBatteryExportPowerKw,
        expectedBatteryKwh: Number.isFinite(Number(slot.expectedBatteryKwh)) ? Number(slot.expectedBatteryKwh) : null,
        observedBatteryKwh: Number.isFinite(Number(slot.observedBatteryKwh)) ? Number(slot.observedBatteryKwh) : 0,
        observedGridKwh: Number.isFinite(Number(slot.observedGridKwh)) ? Number(slot.observedGridKwh) : 0,
        reserveSoc: slot.reserveSoc || this.applianceControl.octopusFluxReserveSoc,
        reserveKwh: slot.reserveKwh,
        availableKwh: slot.availableKwh,
        powerRatioRegister: slot.powerRatioRegister || 'HR112',
        powerRatioAuthority: slot.powerRatioAuthority || 'write-readback-evidence-not-assumed-live-cap',
        source: slot.source || 'octopus-flux-peak-planner'
      }
    };
    try {
      saveJson(this.octopusFluxExportStatePath(), payload);
      this.log.warn('GivHome evidence Octopus Flux Export memory saved: start=%s end=%s reason=%s recovery=yes automaticMutationPath=absent', slot.start instanceof Date ? dateToDisplayHmm(slot.start) : String(slot.start || 'unknown'), slot.end instanceof Date ? dateToDisplayHmm(slot.end) : String(slot.end || 'unknown'), payload.reason);
    } catch (err) {
      this.log.warn('GivHome evidence Octopus Flux Export memory save failed: %s', err && err.message ? err.message : String(err));
    }
  }

  loadOctopusFluxExportMemory() {
    const payload = loadJson(this.octopusFluxExportStatePath(), null);
    if (!payload?.slot || payload.serial !== this.inverterSerial) return;
    const start = new Date(payload.slot.start);
    const end = new Date(payload.slot.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    this.activeOctopusFluxExportSlot = { ...payload.slot, start, end, recoveredFromMemory: true };
    this.octopusFluxExportObservedBatteryKwh = Number(payload.slot.observedBatteryKwh || 0);
    this.octopusFluxExportObservedGridKwh = Number(payload.slot.observedGridKwh || 0);
    this.octopusFluxExportLastObservedAtMs = 0;
    if (end > new Date() && this.applianceControl.features.octopusFluxExport) this.octopusFluxExportArmed = true;
    this.log.warn('GivHome evidence Octopus Flux Export memory loaded: start=%s end=%s activeNow=%s automaticMutationPath=absent', dateToDisplayHmm(start), dateToDisplayHmm(end), new Date() < end ? 'yes' : 'no');
  }

  clearOctopusFluxExportMemory() {
    this.octopusFluxExportActive = false;
    this.activeOctopusFluxExportSlot = null;
    this.octopusFluxExportObservedBatteryKwh = 0;
    this.octopusFluxExportObservedGridKwh = 0;
    this.octopusFluxExportLastObservedAtMs = 0;
    try { fs.rmSync(this.octopusFluxExportStatePath(), { force: true }); } catch {}
  }

  slotWindowFromHmm(startHmm, endHmm, now = new Date()) {
    const startMinutes = parseHmmIntegerToMinutes(startHmm);
    const endMinutes = parseHmmIntegerToMinutes(endHmm);
    if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return null;
    const start = new Date(now);
    const end = new Date(now);
    start.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
    end.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (startMinutes > endMinutes) {
      if (nowMinutes >= startMinutes) end.setDate(end.getDate() + 1);
      else start.setDate(start.getDate() - 1);
    }
    return { start, end, startMinutes, endMinutes, durationMinutes: Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000)) };
  }

  eveningExportSlotWindowFromHmm(startHmm, endHmm, now = new Date()) {
    const startMinutes = parseHmmIntegerToMinutes(startHmm);
    const endMinutes = parseHmmIntegerToMinutes(endHmm);
    const eveningStartMinutes = clockTimeStringToMinutes(this.applianceControl.eveningExportStartTime);
    const cheapStartMinutes = clockTimeStringToMinutes(this.applianceControl.cheapStart);
    if (startMinutes === null || endMinutes === null || startMinutes === endMinutes || eveningStartMinutes === null || cheapStartMinutes === null) return null;

    const start = new Date(now);
    const end = new Date(now);
    start.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
    end.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
    if (endMinutes <= startMinutes) end.setDate(end.getDate() + 1);

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const eveningWindowCrossesMidnight = eveningStartMinutes > cheapStartMinutes;
    if (!eveningWindowCrossesMidnight) {
      if (nowMinutes < eveningStartMinutes && startMinutes >= eveningStartMinutes && endMinutes <= cheapStartMinutes) {
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
      }
    } else if (nowMinutes < cheapStartMinutes && startMinutes >= eveningStartMinutes) {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
    }

    return { start, end, startMinutes, endMinutes, durationMinutes: Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000)) };
  }

  eveningExportSlotWindowFromPrestate(prestate, profileKind, now = new Date()) {
    if (profileKind === 'ch-aio') return this.eveningExportSlotWindowFromHmm(prestate?.HR291, prestate?.HR292, now);
    return this.eveningExportSlotWindowFromHmm(prestate?.HR56, prestate?.HR57, now);
  }

  sameSlotHmm(aStart, aEnd, bStart, bEnd) {
    if (!(aStart instanceof Date) || !(aEnd instanceof Date) || !(bStart instanceof Date) || !(bEnd instanceof Date)) return false;
    return dateToHmm(aStart) === dateToHmm(bStart) && dateToHmm(aEnd) === dateToHmm(bEnd);
  }

  slotWithinConfiguredEveningExportWindow(slotWindow) {
    if (!slotWindow) return false;
    const eveningStartMinutes = clockTimeStringToMinutes(this.applianceControl.eveningExportStartTime);
    const cheapStartMinutes = clockTimeStringToMinutes(this.applianceControl.cheapStart);
    if (eveningStartMinutes === null || cheapStartMinutes === null) return false;
    if (eveningStartMinutes <= cheapStartMinutes) {
      return slotWindow.startMinutes >= eveningStartMinutes && slotWindow.endMinutes <= cheapStartMinutes;
    }
    return slotWindow.startMinutes >= eveningStartMinutes || slotWindow.endMinutes <= cheapStartMinutes;
  }

  getEveningExcessExportMemorySlot() {
    const payload = loadJson(this.eveningExcessExportStatePath(), null);
    if (!payload?.slot || payload.serial !== this.inverterSerial) return null;
    const start = new Date(payload.slot.start);
    const end = new Date(payload.slot.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return { ...payload.slot, start, end, reason: payload.reason || 'unknown' };
  }

  proveEveningExcessExportOwnership(truth, now = new Date()) {
    const slotWindow = truth?.eveningExportSlotWindow || this.eveningExportSlotWindowFromPrestate(truth?.prestate, truth?.profileKind, now);
    if (!truth?.enabled || !slotWindow) return { owned: false, reason: 'no-enabled-evening-slot' };

    const expectedDecision = this.buildExportPowerDecision(
      { displayName: 'Evening Excess Export' },
      {
        label: 'Evening Excess Export',
        powerKw: this.applianceControl.eveningExportPowerKw,
        powerPercent: this.applianceControl.eveningExportPowerPercent,
        exportFamily: 'evening-excess-export',
        exportSource: 'evening-excess-export-recovery-check'
      }
    );
    const hr112Matches = this.exportPowerMatchesDecision(truth.prestate?.HR112, expectedDecision, 1);

    if (this.activeExcessExportSlot?.start instanceof Date && this.activeExcessExportSlot?.end instanceof Date && this.sameSlotHmm(slotWindow.start, slotWindow.end, this.activeExcessExportSlot.start, this.activeExcessExportSlot.end)) {
      return { owned: true, reason: 'active-memory-match', expectedDecision, hr112Matches };
    }

    const persisted = this.getEveningExcessExportMemorySlot();
    if (persisted?.start instanceof Date && persisted?.end instanceof Date && this.sameSlotHmm(slotWindow.start, slotWindow.end, persisted.start, persisted.end)) {
      return { owned: true, reason: `persistent-memory-match:${persisted.reason || 'unknown'}`, expectedDecision, hr112Matches };
    }

    const durationMatches = durationMatchesMinutes(slotWindow.durationMinutes, this.applianceControl.eveningExportSlotMinutes, 2);
    const withinWindow = this.slotWithinConfiguredEveningExportWindow(slotWindow);
    const reserveMatches = truth.profileKind === 'ch-aio' && Number(truth.prestate?.HR293) === Number(this.applianceControl.eveningExportReserveSoc);
    if (truth.profileKind === 'ch-aio' && withinWindow && durationMatches && reserveMatches && hr112Matches) {
      return { owned: true, reason: 'ch-aio-configured-window-duration-reserve-power-match', expectedDecision, hr112Matches };
    }

    return { owned: false, reason: `unproved-ownership route=${truth.profileKind} withinWindow=${withinWindow ? 'yes' : 'no'} durationMatches=${durationMatches ? 'yes' : 'no'} reserveMatches=${reserveMatches ? 'yes' : 'no'} HR112=${truth.prestate?.HR112} expectedHR112=${expectedDecision.powerPercent} powerMatches=${hr112Matches ? 'yes' : 'no'}`, expectedDecision, hr112Matches };
  }


  async enforceEveningExcessExportPowerForOwnedSlot(truth, ownership, model, now = new Date()) {
    const decision = this.buildExportPowerDecision(
      { displayName: 'Evening Excess Export' },
      {
        label: 'Evening Excess Export',
        powerKw: this.applianceControl.eveningExportPowerKw,
        powerPercent: this.applianceControl.eveningExportPowerPercent,
        exportFamily: 'evening-excess-export',
        exportSource: 'evening-excess-export-recovery-repair'
      }
    );
    const expected = validPercentOrDefault(decision.powerPercent, this.applianceControl.eveningExportPowerPercent || 100);
    const actual = Number(truth?.prestate?.HR112);
    this.logExportPowerDecision(decision, expected, 'recovery-check');
    if (Number.isFinite(actual) && Math.abs(actual - expected) <= 1) {
      this.log.warn('GivHome evidence Evening Excess Export power recovery check: ownership=%s HR112=%s expectedHR112=%s action=preserve source=evening-excess-export-recovery-repair', ownership?.reason || 'unknown', actual, expected);
      return { repaired: false, expectedHR112: expected, actualHR112: actual, decision };
    }

    this.log.warn('GivHome evidence Evening Excess Export power repair required: ownership=%s HR112=%s expectedHR112=%s requestedExportKw=%s finalBatteryExportKw=%s source=evening-excess-export-recovery-repair', ownership?.reason || 'unknown', Number.isFinite(actual) ? actual : 'unknown', expected, decision.requestedKw, decision.estimatedBatteryKw);
    await this.withManualChargeTransportGate('GivHome evidence Evening Excess Export HR112 recovery repair', async () => {
      await this.writeDirectRegister(112, expected, 'GivHome evidence EEE recovery repair HR112');
    });
    const post = await this.readExportPrestate(truth?.profileKind || (this.isCeAcCoupledProfile() ? 'ce-ac' : 'ch-aio'));
    if (Number(post.HR112) !== Number(expected)) {
      throw new Error(`Evening Excess Export HR112 repair failed: expected=${expected} actual=${post.HR112}`);
    }
    this.log.warn('GivHome evidence Evening Excess Export power repaired: HR112=%s expectedHR112=%s HR59=%s source=evening-excess-export-recovery-repair', post.HR112, expected, post.HR59);
    truth.prestate.HR112 = post.HR112;
    return { repaired: true, expectedHR112: expected, actualHR112: actual, decision };
  }



  pauseTruthFromPrestate(prestate, now = new Date()) {
    const mode = Number(prestate?.HR318 || 0);
    const active = [1, 2, 3].includes(mode);
    // GivHome 1.0.0: HR318-only pause control is retained without hidden pause timing writes.
    // HR319/HR320 are not required for Apple Home Pause tiles and are not used
    // to decide tile truth.  Apple Home automations own timing by switching the
    // tile On and Off; Off is Eco via HR318=0.
    return { mode, active, start: null, end: null, durationMinutes: active ? null : 0 };
  }

  setPauseTileStatesFromPrestate(prestate) {
    const truth = this.pauseTruthFromPrestate(prestate || { HR318: 0, HR319: 0, HR320: 0 });
    for (const tile of COMMAND_TILES.filter((t) => t.family === 'pause')) {
      this.setApplianceCommandState(tile.kind, Boolean(truth.active && Number(prestate?.HR318 || 0) === Number(tile.pauseValue)));
    }
  }

  async startManualPauseCommand(tile) {
    const pauseModeValue = Number(tile.pauseValue || 0);
    if (![1, 2, 3].includes(pauseModeValue)) throw new Error(`pause start refused: unsupported mode for ${tile.displayName}`);
    const original = await this.readPausePrestate();
    this.applianceSnapshots.set('pause', { ...original, source: tile.displayName || 'Pause tile', hr318Only: true, manual: true });
    this.manualPauseIntent = pauseModeValue;
    this.iogPauseSuppressedUntilMs = 0;
    this.log.warn('GivHome pause tile start executing: label=%s HR318=%s writePlan=HR318-only willNotWrite=HR319,HR320 previousHR318=%s previousHR319=%s previousHR320=%s offAction=Eco source=homekit-explicit', tile.displayName, pauseModeValue, original.HR318, original.HR319, original.HR320);
    await this.writeDirectRegister(318, pauseModeValue, `GivHome pause ${tile.kind} HR318 only`);
    const post = await this.readPausePrestate();
    if (Number(post.HR318) !== pauseModeValue) {
      throw new Error(`pause start readback mismatch: HR318=${post.HR318} expected=${pauseModeValue} HR319=${post.HR319} HR320=${post.HR320}`);
    }
    this.setPauseTileStatesFromPrestate(post);
    this.log.warn('GivHome pause tile active: label=%s HR318=%s HR319=%s HR320=%s timing=AppleHomeAutomation offAction=Eco writePlan=HR318-only source=homekit-explicit', tile.displayName, post.HR318, post.HR319, post.HR320);
  }

  async cleanupManualPauseToEco(reason) {
    this.log.warn('GivHome pause tile Eco restore executing: reason=%s writePlan=HR318-only target=Eco willNotWrite=HR319,HR320 source=homekit-explicit', reason);
    await this.writeDirectRegister(318, 0, 'GivHome pause Eco HR318 only');
    const post = await this.readPausePrestate();
    if (Number(post.HR318) !== 0) {
      throw new Error(`pause Eco readback mismatch: HR318=${post.HR318} expected=0 HR319=${post.HR319} HR320=${post.HR320}`);
    }
    this.applianceSnapshots.delete('pause');
    this.manualPauseIntent = 0;
    if (this.autoChargeActive && this.autoChargeLabel === 'Intelligent Octopus Go Home Battery Protection Pause') {
      this.iogPauseSuppressedUntilMs = Number(this.autoChargeProtectedUntilMs || 0);
      this.autoChargeActive = false;
      this.autoChargeLabel = '';
      this.autoChargeProtectedUntilMs = 0;
      this.log.warn('GivHome pause tile manual Eco override: Intelligent Octopus Go pause reapply suppressed until current smart/grace window ends at %s source=homekit-explicit', this.iogPauseSuppressedUntilMs ? dateToDisplayHmm(new Date(this.iogPauseSuppressedUntilMs)) : 'unknown');
    }
    this.setPauseTileStatesFromPrestate(post);
    this.log.warn('GivHome pause tile Eco restore complete: reason=%s HR318=%s HR319=%s HR320=%s writePlan=HR318-only', reason, post.HR318, post.HR319, post.HR320);
  }

  slotTruthFromPrestate(prestate, startKey, endKey, enableKey, now = new Date()) {
    const enabled = Number(prestate?.[enableKey]) === 1;
    const window = this.slotWindowFromHmm(prestate?.[startKey], prestate?.[endKey], now);
    if (!enabled || !window) return { enabled, active: false, start: null, end: null, durationMinutes: 0 };
    const toleranceMs = 5 * 60000;
    const active = now.getTime() >= window.start.getTime() - toleranceMs && now.getTime() <= window.end.getTime() + toleranceMs;
    return { enabled, active, start: window.start, end: window.end, durationMinutes: window.durationMinutes };
  }

  invalidateCommandTruthSnapshot(reason = 'live-write') {
    this.applianceCommandTruthSnapshot = null;
    this.applianceCommandTruthSnapshotAtMs = 0;
    this.log.info('GivHome evidence truth switch snapshot invalidated: reason=%s source=live-write-readback-cache-control', reason);
  }

  async readCommandTruthSnapshot(reason = 'homekit-onget', options = {}) {
    const forceFresh = options?.forceFresh === true;
    const nowMs = Date.now();
    if (!forceFresh && this.applianceCommandTruthSnapshot && nowMs - this.applianceCommandTruthSnapshotAtMs <= this.applianceCommandTruthSnapshotTtlMs) {
      return this.applianceCommandTruthSnapshot;
    }
    if (!forceFresh && this.applianceCommandTruthSnapshotInFlight) {
      return this.applianceCommandTruthSnapshotInFlight;
    }
    if (!forceFresh && (this.pollInFlight || this.capabilityDiscoveryInFlight || this.commandTransportInFlight) && this.applianceCommandTruthSnapshot) {
      this.log.info('GivHome evidence truth switch snapshot reused: reason=%s ageMs=%s pollInFlight=%s capabilityDiscoveryInFlight=%s commandTransportInFlight=%s transportFanOut=no source=single-shared-register-snapshot', reason, nowMs - this.applianceCommandTruthSnapshotAtMs, this.pollInFlight ? 'yes' : 'no', this.capabilityDiscoveryInFlight ? 'yes' : 'no', this.commandTransportInFlight ? 'yes' : 'no');
      return this.applianceCommandTruthSnapshot;
    }

    this.applianceCommandTruthSnapshotInFlight = (async () => {
      const profileKind = this.isCeAcCoupledProfile() ? 'ce-ac' : 'ch-aio';
      const chargeCore = await this.readHoldingRegisters(94, 3, 'truth-switch-charge-core');
      const exportCore = await this.readHoldingRegisters(56, 4, 'truth-switch-export-core');
      const exportPower = await this.readHoldingRegisters(112, 1, 'truth-switch-export-power');
      const pauseCore = await this.readHoldingRegisters(318, 3, 'truth-switch-pause-core');
      let slot8 = [null, null, null];
      let slot8Status = 'not-needed';
      if (profileKind === 'ch-aio') {
        try {
          slot8 = await this.readHoldingRegisters(291, 3, 'truth-switch-export-slot8');
          slot8Status = 'ok';
        } catch (err) {
          slot8Status = 'failed';
          this.log.warn('GivHome evidence truth switch slot8 snapshot unavailable: reason=%s error=%s fallback=last-known-or-off transportFanOut=no', reason, err && err.message ? err.message : String(err));
        }
      }
      const snapshot = {
        capturedAtMs: Date.now(),
        reason,
        profileKind,
        charge: { HR94: chargeCore[0], HR95: chargeCore[1], HR96: chargeCore[2] },
        export: { HR56: exportCore[0], HR57: exportCore[1], HR59: exportCore[3], HR112: exportPower[0], HR291: slot8[0], HR292: slot8[1], HR293: slot8[2], slot8Status },
        pause: { HR318: pauseCore[0], HR319: pauseCore[1], HR320: pauseCore[2] }
      };
      this.applianceCommandTruthSnapshot = snapshot;
      this.applianceCommandTruthSnapshotAtMs = snapshot.capturedAtMs;
      const chargeWindowState = snapshot.charge.HR96 === 0 && (Number(snapshot.charge.HR94) !== 0 || Number(snapshot.charge.HR95) !== 0)
        ? 'stored-window-disabled'
        : (snapshot.charge.HR96 === 0 ? 'empty-disabled' : 'enabled');
      this.log.info('GivHome truth switch snapshot read: reason=%s profile=%s HR94=%s HR95=%s HR96=%s chargeWindowState=%s HR56=%s HR57=%s HR59=%s HR112=%s HR291=%s HR292=%s HR293=%s HR318=%s HR319=%s HR320=%s slot8Status=%s transportFanOut=no source=single-shared-register-snapshot', reason, profileKind, snapshot.charge.HR94, snapshot.charge.HR95, snapshot.charge.HR96, chargeWindowState, snapshot.export.HR56, snapshot.export.HR57, snapshot.export.HR59, snapshot.export.HR112, snapshot.export.HR291, snapshot.export.HR292, snapshot.export.HR293, snapshot.pause.HR318, snapshot.pause.HR319, snapshot.pause.HR320, slot8Status);
      return snapshot;
    })();

    try {
      return await this.applianceCommandTruthSnapshotInFlight;
    } finally {
      this.applianceCommandTruthSnapshotInFlight = null;
    }
  }

  async getManualChargeTruthState() {
    try {
      const snapshot = await this.readCommandTruthSnapshot('manual-charge-onget');
      const pre = snapshot.charge;
      const truth = this.slotTruthFromPrestate(pre, 'HR94', 'HR95', 'HR96');
      const value = Boolean(truth.enabled && truth.active);
      this.applianceCommandTruthCache.set('Manual_Charge', value);
      this.setManualChargeHomeKitState(value);
      this.log.info('GivHome evidence truth switch readback: kind=Manual_Charge HR94=%s HR95=%s HR96=%s active=%s source=single-shared-register-snapshot', pre.HR94, pre.HR95, pre.HR96, value ? 'yes' : 'no');
      return value;
    } catch (err) {
      const fallback = this.applianceCommandTruthCache.get('Manual_Charge') === true;
      this.log.warn('GivHome evidence truth switch readback failed: kind=Manual_Charge fallback=%s error=%s', fallback ? 'yes' : 'no', err && err.message ? err.message : String(err));
      return fallback;
    }
  }

  async getApplianceCommandTruthState(kind) {
    if (kind === COMMAND_KINDS.EVENING_EXCESS_EXPORT) return this.getEveningExcessExportTruthState();
    if (kind === COMMAND_KINDS.OCTOPUS_AGILE_OUTGOING_EXPORT) return this.getOctopusAgileOutgoingTruthState();
    const tile = getCommandTile(kind);
    if (!tile) return false;
    try {
      const snapshot = await this.readCommandTruthSnapshot(`${kind}-onget`);
      let value = false;
      if (tile.family === 'charge') {
        const pre = snapshot.charge;
        const truth = this.slotTruthFromPrestate(pre, 'HR94', 'HR95', 'HR96');
        value = Boolean(truth.enabled && truth.active && durationMatchesMinutes(truth.durationMinutes, tile.minutes));
        this.log.info('GivHome truth switch readback: kind=%s family=charge HR94=%s HR95=%s HR96=%s duration=%s expected=%s active=%s source=single-shared-register-snapshot', kind, pre.HR94, pre.HR95, pre.HR96, truth.durationMinutes, tile.minutes, value ? 'yes' : 'no');
      } else if (tile.family === 'pause') {
        const pre = snapshot.pause || { HR318: 0, HR319: 0, HR320: 0 };
        const truth = this.pauseTruthFromPrestate(pre);
        value = Boolean(truth.active && Number(pre.HR318) === Number(tile.pauseValue));
        this.log.info('GivHome truth switch readback: kind=%s family=pause HR318=%s HR319=%s HR320=%s mode=%s active=%s source=single-shared-register-snapshot', kind, pre.HR318, pre.HR319, pre.HR320, truth.mode, value ? 'yes' : 'no');
      } else {
        const profileKind = snapshot.profileKind;
        const pre = snapshot.export;
        const truth = profileKind === 'ch-aio'
          ? this.slotTruthFromPrestate(pre, 'HR291', 'HR292', 'HR59')
          : this.slotTruthFromPrestate(pre, 'HR56', 'HR57', 'HR59');
        value = Boolean(truth.enabled && truth.active && durationMatchesMinutes(truth.durationMinutes, tile.minutes));
        this.log.info('GivHome evidence truth switch readback: kind=%s family=export route=%s start=%s end=%s HR59=%s HR112=%s duration=%s expected=%s active=%s source=single-shared-register-snapshot', kind, profileKind, profileKind === 'ch-aio' ? pre.HR291 : pre.HR56, profileKind === 'ch-aio' ? pre.HR292 : pre.HR57, pre.HR59, pre.HR112, truth.durationMinutes, tile.minutes, value ? 'yes' : 'no');
      }
      this.applianceCommandTruthCache.set(kind, value);
      return value;
    } catch (err) {
      const fallback = this.applianceCommandTruthCache.get(kind) === true;
      this.log.warn('GivHome evidence truth switch readback failed: kind=%s fallback=%s error=%s', kind, fallback ? 'yes' : 'no', err && err.message ? err.message : String(err));
      return fallback;
    }
  }

  async getEveningExcessExportTruthState() {
    if (!this.applianceControl.features.eveningExcessExport) return false;
    try {
      const snapshot = await this.readCommandTruthSnapshot('evening-excess-export-onget');
      const profileKind = snapshot.profileKind;
      const pre = snapshot.export;
      const truth = profileKind === 'ch-aio'
        ? this.slotTruthFromPrestate(pre, 'HR291', 'HR292', 'HR59')
        : this.slotTruthFromPrestate(pre, 'HR56', 'HR57', 'HR59');
      const memoryActive = Boolean(this.activeExcessExportSlot?.end instanceof Date && new Date() < this.activeExcessExportSlot.end);
      const value = Boolean(this.eveningExcessExportArmed || memoryActive || (truth.enabled && truth.active && this.activeExcessExportSlot));
      this.applianceCommandTruthCache.set(COMMAND_KINDS.EVENING_EXCESS_EXPORT, value);
      this.log.info('GivHome evidence truth switch readback: kind=Evening_Excess_Export armed=%s liveExportActive=%s memoryActive=%s HR59=%s HR112=%s value=%s source=single-shared-register-snapshot', this.eveningExcessExportArmed ? 'yes' : 'no', truth.active ? 'yes' : 'no', memoryActive ? 'yes' : 'no', pre.HR59, pre.HR112, value ? 'yes' : 'no');
      return value;
    } catch (err) {
      const fallback = this.eveningExcessExportArmed === true;
      this.log.warn('GivHome evidence truth switch readback failed: kind=Evening_Excess_Export fallback=%s error=%s', fallback ? 'yes' : 'no', err && err.message ? err.message : String(err));
      return fallback;
    }
  }

  async getOctopusFluxExportTruthState() {
    if (!this.applianceControl.features.octopusFluxExport) return false;
    try {
      const snapshot = await this.readCommandTruthSnapshot('octopus-flux-export-onget');
      const profileKind = snapshot.profileKind;
      const pre = snapshot.export;
      const truth = profileKind === 'ch-aio'
        ? this.slotTruthFromPrestate(pre, 'HR291', 'HR292', 'HR59')
        : this.slotTruthFromPrestate(pre, 'HR56', 'HR57', 'HR59');
      const memoryActive = Boolean(this.activeOctopusFluxExportSlot?.end instanceof Date && new Date() < this.activeOctopusFluxExportSlot.end);
      const value = Boolean(this.octopusFluxExportArmed || memoryActive || (truth.enabled && truth.active && this.activeOctopusFluxExportSlot));
      this.setApplianceCommandState(COMMAND_KINDS.OCTOPUS_FLUX_EXPORT, value);
      this.log.info('GivHome evidence truth switch readback: kind=Octopus_Flux_Export armed=%s liveExportActive=%s memoryActive=%s HR59=%s HR112=%s value=%s source=single-shared-register-snapshot', this.octopusFluxExportArmed ? 'yes' : 'no', truth.active ? 'yes' : 'no', memoryActive ? 'yes' : 'no', pre.HR59, pre.HR112, value ? 'yes' : 'no');
      return value;
    } catch (err) {
      const fallback = this.octopusFluxExportArmed === true;
      this.log.warn('GivHome evidence Octopus Flux Export truth readback failed: %s fallback=%s', err && err.message ? err.message : String(err), fallback ? 'armed' : 'off');
      return fallback;
    }
  }

  async getOctopusAgileOutgoingTruthState() {
    if (!this.applianceControl.features.octopusAgileOutgoingExport) return false;
    try {
      const snapshot = await this.readCommandTruthSnapshot('octopus-agile-outgoing-onget');
      const profileKind = snapshot.profileKind;
      const pre = snapshot.export;
      const truth = profileKind === 'ch-aio'
        ? this.slotTruthFromPrestate(pre, 'HR291', 'HR292', 'HR59')
        : this.slotTruthFromPrestate(pre, 'HR56', 'HR57', 'HR59');
      const memoryActive = Boolean(this.activeOctopusAgileOutgoingSlot?.end instanceof Date && new Date() < this.activeOctopusAgileOutgoingSlot.end);
      const value = Boolean(this.octopusAgileOutgoingExportArmed || memoryActive || (truth.enabled && truth.active && this.activeOctopusAgileOutgoingSlot));
      this.setApplianceCommandState(COMMAND_KINDS.OCTOPUS_AGILE_OUTGOING_EXPORT, value);
      this.log.info('GivHome evidence truth switch readback: kind=Octopus_Agile_Outgoing armed=%s liveExportActive=%s memoryActive=%s HR59=%s HR112=%s value=%s dryRun=%s mpanAudit=%s source=single-shared-register-snapshot', this.octopusAgileOutgoingExportArmed ? 'yes' : 'no', truth.active ? 'yes' : 'no', memoryActive ? 'yes' : 'no', pre.HR59, pre.HR112, value ? 'yes' : 'no', this.applianceControl.octopusAgileOutgoingDryRun ? 'yes' : 'no', this.applianceControl.octopusAgileOutgoingEnableMpanAudit ? 'yes' : 'no');
      return value;
    } catch (err) {
      const fallback = this.octopusAgileOutgoingExportArmed === true;
      this.log.warn('GivHome evidence Octopus Agile Export truth readback failed: %s fallback=%s', err && err.message ? err.message : String(err), fallback ? 'armed' : 'off');
      return fallback;
    }
  }

  async readCurrentExportTruth(now = new Date()) {
    const snapshot = await this.readCommandTruthSnapshot('evening-excess-export-recovery', { forceFresh: true });
    const profileKind = snapshot.profileKind;
    const pre = snapshot.export;
    const truth = profileKind === 'ch-aio'
      ? this.slotTruthFromPrestate(pre, 'HR291', 'HR292', 'HR59', now)
      : this.slotTruthFromPrestate(pre, 'HR56', 'HR57', 'HR59', now);
    const eveningExportSlotWindow = this.eveningExportSlotWindowFromPrestate(pre, profileKind, now);
    return { ...truth, profileKind, prestate: pre, eveningExportSlotWindow };
  }

  async recoverEveningExcessExportFromInverter(model, cheapState, now = new Date()) {
    if (!this.applianceControl.features.eveningExcessExport || !this.eveningExcessExportArmed) return null;
    if (cheapState.cheapActive || cheapState.smartActive || cheapState.graceActive) return null;

    const nowMs = Date.now();
    const memoryActive = Boolean(this.activeExcessExportSlot?.end instanceof Date && now < this.activeExcessExportSlot.end);
    if (!memoryActive && this.lastEveningExcessExportRecoveryAttemptMs && nowMs - this.lastEveningExcessExportRecoveryAttemptMs < this.eveningExcessExportRecoveryBackoffMs) {
      return null;
    }
    this.lastEveningExcessExportRecoveryAttemptMs = nowMs;

    let truth;
    try {
      truth = await this.readCurrentExportTruth(now);
      if (this.eveningExcessExportRecoveryConsecutiveFailures > 0 || this.eveningExcessExportRecoveryBackoffMs !== this.eveningExcessExportRecoveryBaseBackoffMs) {
        this.log.info('GivHome evidence Evening Excess Export recovery readback recovered: previousFailures=%s nextRetrySeconds=%s transportFanOut=no source=single-shared-register-snapshot', this.eveningExcessExportRecoveryConsecutiveFailures, Math.round(this.eveningExcessExportRecoveryBaseBackoffMs / 1000));
      }
      this.eveningExcessExportRecoveryConsecutiveFailures = 0;
      this.eveningExcessExportRecoveryBackoffMs = this.eveningExcessExportRecoveryBaseBackoffMs;
      this.eveningExcessExportRecoveryFailedLast = false;
    } catch (err) {
      this.eveningExcessExportRecoveryFailedLast = true;
      this.eveningExcessExportRecoveryConsecutiveFailures += 1;
      const nextBackoff = Math.min(
        this.eveningExcessExportRecoveryMaxBackoffMs,
        this.eveningExcessExportRecoveryBaseBackoffMs * Math.pow(2, Math.max(0, this.eveningExcessExportRecoveryConsecutiveFailures - 1))
      );
      this.eveningExcessExportRecoveryBackoffMs = nextBackoff;
      this.log.warn('GivHome evidence Evening Excess Export recovery readback deferred: error=%s retryAfterSeconds=%s consecutiveFailures=%s transportFanOut=no source=single-shared-register-snapshot backoff=adaptive', err && err.message ? err.message : String(err), Math.round(this.eveningExcessExportRecoveryBackoffMs / 1000), this.eveningExcessExportRecoveryConsecutiveFailures);
      return null;
    }

    if (!truth.enabled) {
      if (this.activeExcessExportSlot?.end instanceof Date && now >= this.activeExcessExportSlot.end) {
        this.activeExcessExportSlot = null;
        this.excessEnergyExportActive = false;
        this.clearEveningExcessExportMemory();
        this.log.warn('GivHome evidence Evening Excess Export recovery: no enabled export slot; expired memory cleared automaticMutationPath=absent');
      }
      return null;
    }

    const cheapStart = getMergedCheapState(now, [], { cheapStart: this.applianceControl.eveningExportStartTime, cheapEnd: this.applianceControl.cheapStart, graceMinutes: 0 }, {}).cheapWindowEnd;
    const ownership = this.proveEveningExcessExportOwnership(truth, now);
    const interpretedEnd = truth.eveningExportSlotWindow?.end instanceof Date ? truth.eveningExportSlotWindow.end : truth.end;
    const stale = interpretedEnd instanceof Date && now > addMinutes(interpretedEnd, 1);

    if (truth.active && truth.end instanceof Date && cheapStart instanceof Date && truth.end <= cheapStart) {
      if (!ownership.owned) {
        this.log.warn('GivHome evidence Evening Excess Export active slot observed but not claimed: start=%s end=%s route=%s HR59=%s HR112=%s ownership=%s duplicateWrite=no preserve=yes', dateToDisplayHmm(truth.start), dateToDisplayHmm(truth.end), truth.profileKind, truth.prestate?.HR59, truth.prestate?.HR112, ownership.reason);
        return null;
      }
      let powerRepair;
      try {
        powerRepair = await this.enforceEveningExcessExportPowerForOwnedSlot(truth, ownership, model, now);
      } catch (err) {
        this.log.warn('GivHome evidence Evening Excess Export active slot recovery refused: start=%s end=%s route=%s ownership=%s repairFailed=yes error=%s preserve=yes noNewExportWrites=yes', dateToDisplayHmm(truth.start), dateToDisplayHmm(truth.end), truth.profileKind, ownership.reason, err && err.message ? err.message : String(err));
        return null;
      }
      const slot = {
        start: truth.start,
        end: truth.end,
        minutes: truth.durationMinutes,
        profileKind: truth.profileKind,
        recoveredFromInverter: true,
        powerPercent: powerRepair?.expectedHR112,
        powerKw: powerRepair?.decision?.estimatedBatteryKw,
        requestedPowerKw: powerRepair?.decision?.requestedKw,
        expectedGridExportKw: powerRepair?.decision?.expectedGridExportKw,
        reserveSoc: this.applianceControl.eveningExportReserveSoc,
        source: 'inverter-truth-recovered-and-power-enforced'
      };
      this.activeExcessExportSlot = slot;
      this.excessEnergyExportActive = true;
      this.persistEveningExcessExportMemory(slot, 'recovered-active-inverter-slot-power-enforced');
      this.setApplianceCommandState(COMMAND_KINDS.EVENING_EXCESS_EXPORT, true);
      this.log.warn('GivHome evidence Evening Excess Export active slot recovered: start=%s end=%s route=%s soc=%s ownership=%s HR59=%s HR112=%s expectedHR112=%s repaired=%s source=inverter-truth automaticMutationPath=%s', dateToDisplayHmm(truth.start), dateToDisplayHmm(truth.end), truth.profileKind, Number.isFinite(model?.socPercent) ? model.socPercent : 'unknown', ownership.reason, truth.prestate?.HR59, truth.prestate?.HR112, powerRepair?.expectedHR112, powerRepair?.repaired ? 'yes' : 'no', this.applianceControl.automaticMutationPath);
      return slot;
    }

    if (stale) {
      if (!ownership.owned) {
        this.log.warn('GivHome evidence Evening Excess Export stale export slot preserved: route=%s start=%s end=%s HR59=%s ownership=%s cleanup=no preserveNonEeeSlot=yes', truth.profileKind, truth.eveningExportSlotWindow ? dateToDisplayHmm(truth.eveningExportSlotWindow.start) : dateToDisplayHmm(truth.start), truth.eveningExportSlotWindow ? dateToDisplayHmm(truth.eveningExportSlotWindow.end) : dateToDisplayHmm(truth.end), truth.prestate?.HR59, ownership.reason);
        return null;
      }
      const cleanupSnapshot = { ...truth.prestate, profileKind: truth.profileKind, source: 'Evening Excess Export stale-slot cleanup eee-managed' };
      this.log.warn('GivHome evidence Evening Excess Export stale-slot cleanup queued: route=%s start=%s end=%s HR59=%s ownership=%s currentTime=%s outsideActiveWindow=yes automaticMutationPath=%s', truth.profileKind, truth.eveningExportSlotWindow ? dateToDisplayHmm(truth.eveningExportSlotWindow.start) : dateToDisplayHmm(truth.start), truth.eveningExportSlotWindow ? dateToDisplayHmm(truth.eveningExportSlotWindow.end) : dateToDisplayHmm(truth.end), truth.prestate?.HR59, ownership.reason, dateToDisplayHmm(now), this.applianceControl.automaticMutationPath);
      await this.withManualChargeTransportGate('GivHome Evening Excess Export stale-slot cleanup', async () => {
        await this.cleanupEveningExcessExportNeutralised(cleanupSnapshot, 'Evening Excess Export stale-slot cleanup');
      });
      return { staleCleanup: true, ownership: ownership.reason };
    }

    return null;
  }

  async cleanupApplianceCommandFamily(family, reason) {
    if (!['charge', 'export', 'pause'].includes(family)) return;
    const snapshotKey = family === 'charge' ? 'charge' : family === 'export' ? 'export' : 'pause';
    const snapshot = this.applianceSnapshots.get(snapshotKey);
    await this.withManualChargeTransportGate(`GivHome command ${family} cleanup`, async () => {
      if (family === 'charge') await this.cleanupChargeFromSnapshot(snapshot, reason);
      else if (family === 'pause') { const postPause = await this.cleanupPauseFromSnapshot(snapshot, reason); this.setPauseTileStatesFromPrestate(postPause); }
      else await this.cleanupExportFromSnapshot(snapshot, reason);
    });
    this.applianceSnapshots.delete(snapshotKey);
    for (const tile of COMMAND_TILES.filter((t) => t.family === family)) {
      this.setApplianceCommandState(tile.kind, false);
      if (this.applianceCommandTimers.has(tile.kind)) {
        clearTimeout(this.applianceCommandTimers.get(tile.kind));
        this.applianceCommandTimers.delete(tile.kind);
      }
    }
    if (family === 'charge' || family === 'pause') {
      this.autoChargeActive = false;
      this.autoChargeLabel = '';
      this.autoChargeProtectedUntilMs = 0;
    }
  }

  async readHoldingRegisters(start, count, label = '') {
    const client = new DirectLocalReadOnlyClient(Object.assign({}, this.manualChargeClientOptions(), {
      onGracefulContinuityEvent: (event) => {
        if (event.result === 'fail' && this.advancedDiagnostics) {
          this.logGracefulContinuityReadbackFailure(label, event);
        }
      }
    }));
    const result = await client.readHoldingRegisters(start, count);
    return result.values;
  }

  logGracefulContinuityReadbackFailure(label, event) {
    const key = `${label || 'unlabelled'}:${event.phase || 'unknown'}:${event.opportunity || 'unknown'}:${event.error || 'unknown'}`;
    const nowMs = Date.now();
    const lastMs = this.readbackContinuityLogState.get(key) || 0;
    if (lastMs && nowMs - lastMs < this.readbackContinuityLogIntervalMs) return;
    this.readbackContinuityLogState.set(key, nowMs);
    this.log.warn('GivHome command readback Graceful Continuity: label=%s phase=%s opportunity=%s result=fail error=%s throttled=yes nextLogAfterSeconds=%s', label, event.phase, event.opportunity, event.error || 'unknown', Math.round(this.readbackContinuityLogIntervalMs / 1000));
  }

  async readChargePrestate() {
    const core = await this.readHoldingRegisters(94, 3, 'charge-core');
    const powerTarget = await this.readHoldingRegisters(111, 6, 'charge-power-target');
    return { HR94: core[0], HR95: core[1], HR96: core[2], HR111: powerTarget[0], HR116: powerTarget[5] };
  }

  async readPausePrestate() {
    const pause = await this.readHoldingRegisters(318, 3, 'pause-core');
    return { HR318: pause[0], HR319: pause[1], HR320: pause[2] };
  }

  async startIogPauseProtectionCommand(options = {}) {
    const mode = String(options.mode || this.applianceControl.iogHomeBatteryProtectionMode || 'pauseDischarge');
    const modeText = this.applianceControl.iogHomeBatteryProtectionModeText || mode;
    const pauseModeValue = Number(this.applianceControl.iogHomeBatteryProtectionPauseValue || 0);
    if (![1, 2, 3].includes(pauseModeValue)) throw new Error(`pause protection refused: unsupported pause mode ${mode}`);
    const end = options.endDate instanceof Date ? options.endDate : null;
    const original = await this.readPausePrestate();
    if ([1, 2, 3].includes(Number(original.HR318)) && Number(original.HR318) !== pauseModeValue && this.manualPauseIntent) {
      this.log.warn('GivHome Intelligent Octopus Go pause protection preserved manual pause: requestedMode=%s currentHR318=%s manualPauseIntent=%s source=iog-home-battery-protection', modeText, original.HR318, this.manualPauseIntent);
      return;
    }
    this.applianceSnapshots.set('pause', { ...original, source: options.label || 'Intelligent Octopus Go Home Battery Protection', hr318Only: true, iog: true });
    this.log.warn('GivHome Intelligent Octopus Go pause protection start executing: mode=%s HR318=%s writePlan=HR318-only willNotWrite=HR319,HR320 currentHR318=%s currentHR319=%s currentHR320=%s source=iog-home-battery-protection automaticMutationPath=%s', modeText, pauseModeValue, original.HR318, original.HR319, original.HR320, this.applianceControl.automaticMutationPath);
    await this.writeDirectRegister(318, pauseModeValue, `GivHome IOG pause HR318 only ${mode}`);
    const post = await this.readPausePrestate();
    if (post.HR318 !== pauseModeValue) {
      throw new Error(`pause protection readback mismatch: HR318=${post.HR318} expected=${pauseModeValue} HR319=${post.HR319} HR320=${post.HR320}`);
    }
    this.log.warn('GivHome Intelligent Octopus Go pause protection active: mode=%s HR318=%s HR319=%s HR320=%s protectedUntil=%s slotPolicy=reactive-live-Octopus-poll writePlan=HR318-only returnToPreviousPauseStateAfterWindow=yes', modeText, post.HR318, post.HR319, post.HR320, end ? dateToDisplayHmm(end) : 'live-poll');
  }

  async cleanupPauseFromSnapshot(snapshot, reason) {
    const restore = snapshot || { HR318: 0, HR319: 0, HR320: 0 };
    const restoreMode = Number(restore.HR318 || 0);
    this.log.warn('GivHome pause restore executing: reason=%s restoreSnapshot=%s HR318=%s writePlan=HR318-only willNotWrite=HR319,HR320 currentSavedHR319=%s currentSavedHR320=%s', reason, snapshot ? 'yes' : 'no', restoreMode, restore.HR319, restore.HR320);
    await this.writeDirectRegister(318, restoreMode, 'GivHome pause restore HR318 only');
    const post = await this.readPausePrestate();
    if (post.HR318 !== restoreMode) {
      throw new Error(`pause restore readback mismatch: HR318=${post.HR318} expected=${restoreMode} HR319=${post.HR319} HR320=${post.HR320}`);
    }
    this.log.warn('GivHome pause restore complete: reason=%s HR318=%s HR319=%s HR320=%s writePlan=HR318-only', reason, post.HR318, post.HR319, post.HR320);
    return post;
  }

  async readExportPrestate(profileKind = 'ch-aio') {
    const core = await this.readHoldingRegisters(56, 4, 'export-core');
    const power = await this.readHoldingRegisters(112, 1, 'export-power');
    const slot8 = profileKind === 'ch-aio' ? await this.readHoldingRegisters(291, 3, 'export-slot8') : [null, null, null];
    return { HR56: core[0], HR57: core[1], HR59: core[3], HR112: power[0], HR291: slot8[0], HR292: slot8[1], HR293: slot8[2] };
  }

  async writeDirectRegister(register, value, label) {
    const frame = buildOfflineWriteSingleRegisterFrame({ deviceAddress: this.deviceAddress, register, value });
    const frameVerification = verifyOfflineWriteFrame(frame);
    if (!frameVerification.ok) throw new Error(`${label} Function 06 frame verification failed before live write`);
    const writeResponse = await sendFunction06FrameOnce({
      host: this.inverterHost,
      port: this.inverterPort,
      responseTimeoutMs: 3000,
      enablePreSendGracefulContinuity: true,
      onPreSendContinuityEvent: (event) => {
        if (event.result === 'fail') this.log.warn('GivHome command Graceful Continuity pre-send: label=%s opportunity=%s result=fail error=%s noPayloadSent=yes', label, event.opportunity, event.error || 'unknown');
      },
      frame
    });
    if (!writeResponse.responseReceived) {
      this.log.warn('GivHome command Function 06 acknowledgement uncertain: label=%s payloadSent=%s postSendError=%s readbackReconciliation=required', label, writeResponse.payloadSent ? 'yes' : 'no', writeResponse.postSendError || 'none');
    }
    const valueBack = (await this.readHoldingRegisters(register, 1, label))[0];
    if (valueBack !== value) throw new Error(`${label} readback failed: requested=${value} readback=${valueBack} noBlindResend=yes`);
    this.invalidateCommandTruthSnapshot(`${label} HR${register}`);
    this.log.warn('GivHome command Function 06 reconciled: label=%s HR%s=%s responseReceived=%s noBlindResend=yes', label, register, value, writeResponse.responseReceived ? 'yes' : 'no');
  }

  async startTimedChargeCommand(tileOrPlan, options = {}) {
    const minutes = Math.max(1, Number(tileOrPlan.minutes || options.minutes || 30));
    const now = options.startDate instanceof Date ? options.startDate : new Date();
    const end = options.endDate instanceof Date ? options.endDate : addMinutes(now, minutes);
    const startHmm = dateToHmm(now);
    const endHmm = dateToHmm(end);
    const original = await this.readChargePrestate();
    if (this.isCeAcCoupledProfile()) this.persistCeAcChargeSlotSnapshot(original, options.label || tileOrPlan.displayName || 'temporary-charge');
    if (original.HR96 !== 0 && !options.automatic) throw new Error(`charge start refused: HR96 already enabled (${original.HR96})`);
    const carePlan = options.batteryCarePlan;
    const powerPercent = carePlan?.active ? carePlan.chargeRatePercent : validPercentOrDefault(options.powerPercent ?? original.HR111, 100);
    const targetSoc = validPercentOrDefault(options.targetSoc ?? this.applianceControl.targetSoc ?? original.HR116, 100);
    this.applianceSnapshots.set('charge', { ...original, source: options.label || tileOrPlan.displayName || 'Charge' });
    this.log.warn('GivHome command charge start executing: label=%s HR111=%s HR116=%s HR94=%s HR95=%s HR96=1 route=core batteryCare=%s automaticMutationPath=%s', options.label || tileOrPlan.displayName || 'Charge', powerPercent, targetSoc, startHmm, endHmm, carePlan?.active ? 'yes' : 'no', options.automatic ? this.applianceControl.automaticMutationPath : 'homekit-explicit');
    await this.writeDirectRegister(111, powerPercent, 'GivHome command charge HR111');
    await this.writeDirectRegister(116, targetSoc, 'GivHome command charge HR116');
    await this.writeDirectRegister(94, startHmm, 'GivHome command charge HR94');
    await this.writeDirectRegister(95, endHmm, 'GivHome command charge HR95');
    const pre = await this.readChargePrestate();
    if (pre.HR94 !== startHmm || pre.HR95 !== endHmm || pre.HR111 !== powerPercent || pre.HR116 !== targetSoc) throw new Error('charge pre-enable readback did not match');
    await this.writeDirectRegister(96, 1, 'GivHome command charge HR96');
    const post = await this.readChargePrestate();
    if (post.HR96 !== 1) throw new Error('charge enable readback did not confirm HR96=1');
    this.log.warn('GivHome command charge start complete: label=%s durationMinutes=%s', options.label || tileOrPlan.displayName || 'Charge', minutes);
  }

  async cleanupChargeFromSnapshot(snapshot, reason) {
    const memorySnapshot = this.isCeAcCoupledProfile() && this.ceAcChargeSlotMemory?.snapshot ? this.ceAcChargeSlotMemory.snapshot : null;
    const restore = snapshot || memorySnapshot;
    this.log.warn('GivHome command charge cleanup executing: reason=%s restoreSnapshot=%s restoreFirst=HR96 ceAcPersistentMemory=%s', reason, restore ? 'yes' : 'no', memorySnapshot ? 'yes' : 'no');
    await this.writeDirectRegister(96, 0, 'GivHome command charge cleanup HR96');
    if (restore) {
      await this.writeDirectRegister(94, restore.HR94, 'GivHome command charge restore HR94');
      await this.writeDirectRegister(95, restore.HR95, 'GivHome command charge restore HR95');
      await this.writeDirectRegister(111, restore.HR111, 'GivHome command charge restore HR111');
      await this.writeDirectRegister(116, restore.HR116, 'GivHome command charge restore HR116');
      if (this.isCeAcCoupledProfile() && Number(restore.HR96) !== 0) {
        this.log.warn('GivHome evidence CE/AC cleanup policy: original HR96=%s observed, but cleanup keeps HR96=0 after stop; stored times/power are restored without re-enabling the charge schedule.', restore.HR96);
      }
      if (this.isCeAcCoupledProfile()) this.clearCeAcChargeSlotMemory();
    }
    const post = await this.readChargePrestate();
    if (post.HR96 !== 0) throw new Error('charge cleanup did not confirm HR96=0');
    const storedWindowState = Number(post.HR94) !== 0 || Number(post.HR95) !== 0 ? 'stored-window-disabled' : 'empty-disabled';
    this.log.warn('GivHome command charge cleanup complete: reason=%s HR94=%s HR95=%s HR96=%s storedChargeWindowState=%s ceAcPersistentMemoryRestored=%s ceAcOriginalEnableRestored=no', reason, post.HR94, post.HR95, post.HR96, storedWindowState, memorySnapshot ? 'yes' : 'no');
  }

  buildExportPowerDecision(tileOrPlan = {}, options = {}) {
    const label = String(options.label || tileOrPlan.displayName || 'Export');
    const labelLower = label.toLowerCase();
    const isEvening = options.exportFamily === 'evening-excess-export' || labelLower.includes('evening excess export');
    const source = String(options.exportSource || (isEvening ? 'evening-excess-export-slider' : 'timed-export-slider'));
    const maxBatteryExportKw = Math.max(0.1, Number(this.applianceControl.maxBatteryExportPowerKw || 6));
    const maxGridExportKw = Math.max(0.1, Number(this.applianceControl.maxGridExportPowerKw || maxBatteryExportKw));
    const configuredKw = isEvening ? this.applianceControl.eveningExportPowerKw : this.applianceControl.timedExportPowerKw;
    const configuredPercent = isEvening ? this.applianceControl.eveningExportPowerPercent : this.applianceControl.timedExportPowerPercent;
    const explicitKw = Number(options.powerKw);
    const explicitPercent = Number(options.powerPercent);
    const requestedKw = Number.isFinite(explicitKw) && explicitKw > 0
      ? explicitKw
      : (Number.isFinite(configuredKw) && configuredKw > 0
        ? configuredKw
        : (Number.isFinite(explicitPercent) && explicitPercent > 0
          ? (maxBatteryExportKw * explicitPercent) / 100
          : (maxBatteryExportKw * Math.max(1, configuredPercent || 100)) / 100));

    const model = this.latestModel || {};
    const pvKw = Number.isFinite(Number(model.pvPowerW)) ? Math.max(0, Number(model.pvPowerW) / 1000) : null;
    const loadKw = Number.isFinite(Number(model.loadPowerW)) ? Math.max(0, Number(model.loadPowerW) / 1000) : null;
    const liveGridCeilingBatteryKw = pvKw !== null && loadKw !== null
      ? Math.max(0.1, maxGridExportKw + loadKw - pvKw)
      : maxGridExportKw;

    const unclampedBatteryKw = Math.max(0.1, requestedKw);
    const batteryClampedKw = Math.min(unclampedBatteryKw, maxBatteryExportKw);
    const gridClampedBatteryKw = Math.min(batteryClampedKw, liveGridCeilingBatteryKw);
    const finalBatteryKw = Math.max(0.1, gridClampedBatteryKw);
    const powerPercent = Math.max(1, Math.min(100, Math.round((finalBatteryKw / maxBatteryExportKw) * 100)));
    const estimatedBatteryKw = (maxBatteryExportKw * powerPercent) / 100;
    const expectedGridExportKw = pvKw !== null && loadKw !== null ? Math.max(0, estimatedBatteryKw + pvKw - loadKw) : null;
    const clampReasons = [];
    if (unclampedBatteryKw > maxBatteryExportKw + 0.0001) clampReasons.push('battery-ceiling');
    if (batteryClampedKw > liveGridCeilingBatteryKw + 0.0001) clampReasons.push('grid-ceiling-live-pv-load');
    if (clampReasons.length === 0) clampReasons.push('none');

    return {
      label,
      source,
      isEvening,
      requestedKw: roundOneDecimalPlace(requestedKw),
      requestedBatteryKw: roundOneDecimalPlace(requestedKw),
      finalBatteryKw: roundOneDecimalPlace(finalBatteryKw),
      estimatedBatteryKw: roundOneDecimalPlace(estimatedBatteryKw),
      maxBatteryExportKw: roundOneDecimalPlace(maxBatteryExportKw),
      maxGridExportKw: roundOneDecimalPlace(maxGridExportKw),
      pvKw: pvKw === null ? null : roundOneDecimalPlace(pvKw),
      loadKw: loadKw === null ? null : roundOneDecimalPlace(loadKw),
      liveGridCeilingBatteryKw: roundOneDecimalPlace(liveGridCeilingBatteryKw),
      expectedGridExportKw: expectedGridExportKw === null ? null : roundOneDecimalPlace(expectedGridExportKw),
      powerPercent,
      clampReason: clampReasons.join('+')
    };
  }

  logExportPowerDecision(powerDecision, powerPercent, phase = 'pre-enable') {
    this.log.warn('GivHome evidence export power decision: phase=%s label=%s requestedExportKw=%s finalBatteryExportKw=%s maxBatteryExportKw=%s maxGridExportKw=%s pvKw=%s loadKw=%s expectedGridExportKw=%s HR112=%s clamp=%s source=%s enforcement=write-readback-before-HR59', phase, powerDecision.label, powerDecision.requestedKw, powerDecision.estimatedBatteryKw, powerDecision.maxBatteryExportKw, powerDecision.maxGridExportKw, powerDecision.pvKw === null ? 'n/a' : powerDecision.pvKw, powerDecision.loadKw === null ? 'n/a' : powerDecision.loadKw, powerDecision.expectedGridExportKw === null ? 'n/a' : powerDecision.expectedGridExportKw, powerPercent, powerDecision.clampReason, powerDecision.source);
  }

  exportPowerMatchesDecision(currentHr112, decision, tolerance = 1) {
    const actual = Number(currentHr112);
    const expected = Number(decision?.powerPercent);
    return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;
  }


  async startTimedExportCommand(tileOrPlan, options = {}) {
    const profileKind = isCeAcCoupledSerial(this.inverterSerial) ? 'ce-ac' : 'ch-aio';
    if (profileKind === 'ce-ac' && !this.applianceControl.features.ceAcCoupledLiveWrites) {
      throw new Error('CE/AC-coupled export refused: GivHome command CE/AC live-write acknowledgement is not satisfied');
    }
    const minutes = Math.max(1, Number(tileOrPlan.minutes || options.minutes || 30));
    const now = options.startDate instanceof Date ? options.startDate : new Date();
    const end = options.endDate instanceof Date ? options.endDate : addMinutes(now, minutes);
    const startHmm = dateToHmm(now);
    const endHmm = dateToHmm(end);
    const label = options.label || tileOrPlan.displayName || 'Export';
    const isEvening = String(label).toLowerCase().includes('evening excess export');
    const exportTargetSoc = validPercentOrDefault(options.exportTargetSoc ?? this.applianceControl.manualExportTargetSoc, 30);
    const decisionOptions = Object.assign({}, options, {
      exportFamily: options.exportFamily || (isEvening ? 'evening-excess-export' : 'timed-export'),
      exportSource: options.exportSource || (isEvening ? 'evening-excess-export-slider' : 'timed-export-slider')
    });
    const powerDecision = this.buildExportPowerDecision(tileOrPlan, decisionOptions);
    const powerPercent = validPercentOrDefault(powerDecision.powerPercent, this.applianceControl.manualExportPowerPercent || 100);
    const original = await this.readExportPrestate(profileKind);
    if (original.HR59 !== 0) {
      throw new Error(`export start refused: HR59 already enabled (${original.HR59}); recovery/preserve path must prove ownership before any GivHome-owned export writes`);
    }
    this.applianceSnapshots.set('export', { ...original, profileKind, source: label, exportSource: powerDecision.source, expectedHR112: powerPercent });
    this.logExportPowerDecision(powerDecision, powerPercent, 'pre-write');
    this.log.warn('GivHome evidence export start executing: label=%s route=%s start=%s end=%s targetSoc=%s HR112=%s requestedKw=%s estimatedBatteryKw=%s expectedGridExportKw=%s writeOrder=slot,HR112-readback,HR59 automaticMutationPath=%s source=%s', label, profileKind === 'ch-aio' ? 'slot8' : 'core', startHmm, endHmm, exportTargetSoc, powerPercent, powerDecision.requestedKw, powerDecision.estimatedBatteryKw, powerDecision.expectedGridExportKw === null ? 'n/a' : powerDecision.expectedGridExportKw, options.automatic ? this.applianceControl.automaticMutationPath : 'homekit-explicit', powerDecision.source);
    if (profileKind === 'ch-aio') {
      await this.writeDirectRegister(291, startHmm, 'GivHome command export HR291');
      await this.writeDirectRegister(292, endHmm, 'GivHome command export HR292');
      await this.writeDirectRegister(293, exportTargetSoc, 'GivHome command export HR293');
    } else {
      await this.writeDirectRegister(56, startHmm, 'GivHome command export HR56');
      await this.writeDirectRegister(57, endHmm, 'GivHome command export HR57');
    }
    await this.writeDirectRegister(112, powerPercent, `GivHome evidence export HR112 ${powerDecision.source}`);
    const preEnable = await this.readExportPrestate(profileKind);
    const slotMatches = profileKind === 'ch-aio'
      ? Number(preEnable.HR291) === Number(startHmm) && Number(preEnable.HR292) === Number(endHmm) && Number(preEnable.HR293) === Number(exportTargetSoc)
      : Number(preEnable.HR56) === Number(startHmm) && Number(preEnable.HR57) === Number(endHmm);
    if (!slotMatches || Number(preEnable.HR112) !== Number(powerPercent)) {
      throw new Error(`export pre-enable readback failed: slotMatches=${slotMatches ? 'yes' : 'no'} HR112=${preEnable.HR112} expectedHR112=${powerPercent}; HR59 not enabled`);
    }
    this.log.warn('GivHome evidence export power enforced: label=%s source=%s HR112=%s readback=%s HR59=not-yet-enabled route=%s', label, powerDecision.source, powerPercent, preEnable.HR112, profileKind);
    await this.writeDirectRegister(59, 1, `GivHome evidence export HR59 enable after HR112 ${powerDecision.source}`);
    const post = await this.readExportPrestate(profileKind);
    if (post.HR59 !== 1) throw new Error('export enable readback did not confirm HR59=1');
    if (Number(post.HR112) !== Number(powerPercent)) throw new Error(`export post-enable HR112 mismatch: expected=${powerPercent} actual=${post.HR112}`);
    this.log.warn('GivHome evidence export start complete: label=%s durationMinutes=%s route=%s HR59=%s HR112=%s source=%s start=%s end=%s', label, minutes, profileKind, post.HR59, post.HR112, powerDecision.source, profileKind === 'ch-aio' ? post.HR291 : post.HR56, profileKind === 'ch-aio' ? post.HR292 : post.HR57);
    if (isEvening) {
      const slot = { start: now, end, minutes, profileKind, powerPercent, powerKw: powerDecision.estimatedBatteryKw, requestedPowerKw: powerDecision.requestedKw, expectedGridExportKw: powerDecision.expectedGridExportKw, reserveSoc: exportTargetSoc, source: 'started-by-givhome-modbus', exportSource: powerDecision.source };
      this.activeExcessExportSlot = slot;
      this.excessEnergyExportActive = true;
      this.persistEveningExcessExportMemory(slot, 'started');
    }
  }


  async cleanupExportFromSnapshot(snapshot, reason) {
    const isEveningExcessExportCleanup = this.isEveningExcessExportCleanupReason(reason, snapshot);
    if (isEveningExcessExportCleanup) {
      await this.cleanupEveningExcessExportNeutralised(snapshot, reason || 'Evening Excess Export cleanup');
      return;
    }

    const fluxCleanup = this.isOctopusFluxExportCleanupReason(reason, snapshot);
    const agileCleanup = this.isOctopusAgileOutgoingCleanupReason(reason, snapshot);
    const sharedAutomatedCleanup = fluxCleanup || agileCleanup;
    if (sharedAutomatedCleanup && !this.hasOtherLiveSharedExportOwner(reason)) {
      const owner = fluxCleanup ? 'Octopus Flux Export' : 'Octopus Agile Export';
      const post = await this.cleanupSharedExportRouteNeutralised(snapshot, reason || `${owner} disarmed`, owner);
      if (fluxCleanup) {
        this.clearOctopusFluxExportMemory();
        this.setApplianceCommandState(COMMAND_KINDS.OCTOPUS_FLUX_EXPORT, this.octopusFluxExportArmed);
      }
      if (agileCleanup) {
        this.clearOctopusAgileOutgoingMemory();
        this.setApplianceCommandState(COMMAND_KINDS.OCTOPUS_AGILE_OUTGOING_EXPORT, this.octopusAgileOutgoingExportArmed);
        this.log.warn('GivHome evidence Octopus Agile Export Autopilot OFF verified: reason=%s HR59=%s HR291=%s HR292=%s HR293=%s HR112=%s physicalExportStopped=pending-next-telemetry-check failClosed=yes', reason, post.HR59, post.HR291, post.HR292, post.HR293, post.HR112);
      }
      this.log.warn('GivHome command export cleanup complete: reason=%s HR59=%s HR291=%s HR292=%s HR293=%s sharedRouteNeutralised=yes eveningExcessExportMemoryCleared=no octopusFluxExportMemoryCleared=%s octopusAgileOutgoingMemoryCleared=%s', reason, post.HR59, post.HR291, post.HR292, post.HR293, fluxCleanup ? 'yes' : 'no', agileCleanup ? 'yes' : 'no');
      return;
    }

    this.log.warn('GivHome command export cleanup executing: reason=%s restoreSnapshot=%s restoreFirst=HR59 sharedRouteNeutralised=no otherLiveOwner=%s', reason, snapshot ? 'yes' : 'no', this.hasOtherLiveSharedExportOwner(reason) ? 'yes' : 'no');
    await this.writeDirectRegister(59, 0, 'GivHome command export cleanup HR59');
    if (snapshot) {
      if (snapshot.profileKind === 'ch-aio') {
        await this.writeDirectRegister(291, snapshot.HR291 || 0, 'GivHome command export restore HR291');
        await this.writeDirectRegister(292, snapshot.HR292 || 0, 'GivHome command export restore HR292');
        await this.writeDirectRegister(293, snapshot.HR293 || 0, 'GivHome command export restore HR293');
      } else {
        await this.writeDirectRegister(56, snapshot.HR56 || 0, 'GivHome command export restore HR56');
        await this.writeDirectRegister(57, snapshot.HR57 || 0, 'GivHome command export restore HR57');
      }
      await this.writeDirectRegister(112, snapshot.HR112 || 0, 'GivHome command export restore HR112');
      if (snapshot.HR59) await this.writeDirectRegister(59, snapshot.HR59, 'GivHome command export restore HR59');
    }
    const post = await this.readExportPrestate(snapshot?.profileKind || (this.isCeAcCoupledProfile() ? 'ce-ac' : 'ch-aio'));
    if (post.HR59 !== (snapshot?.HR59 || 0)) throw new Error(`export cleanup HR59 readback mismatch: expected=${snapshot?.HR59 || 0} actual=${post.HR59}`);
    this.log.warn('GivHome command export cleanup complete: reason=%s HR59=%s eveningExcessExportMemoryCleared=no octopusFluxExportMemoryCleared=%s octopusAgileOutgoingMemoryCleared=%s sharedRouteNeutralised=no', reason, post.HR59, fluxCleanup ? 'yes' : 'no', agileCleanup ? 'yes' : 'no');
  }

  hasOtherLiveSharedExportOwner(reason) {
    const text = `${reason || ''}`.toLowerCase();
    const now = new Date();
    const fluxIsThisOwner = text.includes('octopus flux') || text.includes('octopus-flux') || text.includes('flux-managed');
    const agileIsThisOwner = text.includes('octopus agile') || text.includes('agile-outgoing') || text.includes('octopus-agile');
    const eeeIsThisOwner = text.includes('evening excess export') || text.includes('evening_excess_export') || text.includes('eee-managed');
    const fluxLive = !fluxIsThisOwner && this.activeOctopusFluxExportSlot?.end instanceof Date && now < this.activeOctopusFluxExportSlot.end;
    const agileLive = !agileIsThisOwner && this.activeOctopusAgileOutgoingSlot?.end instanceof Date && now < this.activeOctopusAgileOutgoingSlot.end;
    const eeeLive = !eeeIsThisOwner && this.activeExcessExportSlot?.end instanceof Date && now < this.activeExcessExportSlot.end;
    return Boolean(fluxLive || agileLive || eeeLive);
  }

  async cleanupSharedExportRouteNeutralised(snapshot, reason, ownerLabel) {
    const profileKind = snapshot?.profileKind || (this.isCeAcCoupledProfile() ? 'ce-ac' : 'ch-aio');
    const restoreHr112 = Number.isFinite(Number(snapshot?.HR112));
    this.log.warn('GivHome evidence shared export route cleanup queued: owner=%s reason=%s route=%s strategy=neutralise-shared-route HR59=0-first clearSlot=yes restoreHr112=%s automaticMutationPath=%s', ownerLabel, reason, profileKind, restoreHr112 ? 'captured-prestate' : 'preserve-current', this.applianceControl.automaticMutationPath);
    await this.writeDirectRegister(59, 0, `GivHome ${ownerLabel} cleanup HR59 disable-first`);
    if (profileKind === 'ch-aio') {
      await this.writeDirectRegister(291, 0, `GivHome ${ownerLabel} cleanup HR291 clear`);
      await this.writeDirectRegister(292, 0, `GivHome ${ownerLabel} cleanup HR292 clear`);
      await this.writeDirectRegister(293, 0, `GivHome ${ownerLabel} cleanup HR293 clear`);
    } else {
      await this.writeDirectRegister(56, 0, `GivHome ${ownerLabel} cleanup HR56 clear`);
      await this.writeDirectRegister(57, 0, `GivHome ${ownerLabel} cleanup HR57 clear`);
    }
    if (restoreHr112) {
      await this.writeDirectRegister(112, Number(snapshot.HR112), `GivHome ${ownerLabel} cleanup HR112 restore captured prestate`);
    }
    const post = await this.readExportPrestate(profileKind);
    const slotCleared = profileKind === 'ch-aio'
      ? Number(post.HR291 || 0) === 0 && Number(post.HR292 || 0) === 0 && Number(post.HR293 || 0) === 0
      : Number(post.HR56 || 0) === 0 && Number(post.HR57 || 0) === 0;
    if (Number(post.HR59 || 0) !== 0 || !slotCleared) {
      throw new Error(`${ownerLabel} shared export cleanup readback mismatch: HR59=${post.HR59} slotCleared=${slotCleared ? 'yes' : 'no'}`);
    }
    this.log.warn('GivHome evidence shared export route cleanup complete: owner=%s reason=%s HR59=%s HR291=%s HR292=%s HR293=%s HR112=%s slotCleared=yes otherLiveOwner=no automaticMutationPath=%s', ownerLabel, reason, post.HR59, post.HR291, post.HR292, post.HR293, post.HR112, this.applianceControl.automaticMutationPath);
    return post;
  }

  isOctopusAgileOutgoingCleanupReason(reason, snapshot) {
    const text = `${reason || ''} ${snapshot?.source || ''} ${snapshot?.exportSource || ''}`.toLowerCase();
    return text.includes('octopus agile') || text.includes('agile-outgoing') || text.includes('octopus-agile');
  }

  isOctopusFluxExportCleanupReason(reason, snapshot) {
    const text = `${reason || ''} ${snapshot?.source || ''} ${snapshot?.exportSource || ''}`.toLowerCase();
    return text.includes('octopus flux') || text.includes('octopus-flux') || text.includes('flux-managed');
  }

  isEveningExcessExportCleanupReason(reason, snapshot) {
    const text = `${reason || ''} ${snapshot?.source || ''}`.toLowerCase();
    return text.includes('evening excess export') || text.includes('evening_excess_export') || text.includes('eee-managed');
  }

  async cleanupEveningExcessExportNeutralised(snapshot, reason) {
    const profileKind = snapshot?.profileKind || (this.isCeAcCoupledProfile() ? 'ce-ac' : 'ch-aio');
    this.log.warn('GivHome evidence Evening Excess Export cleanup queued: reason=%s route=%s strategy=v3.7.5-neutralise-not-restore restoreFirst=HR59 preserveNonEeeSlots=yes automaticMutationPath=%s', reason, profileKind, this.applianceControl.automaticMutationPath);
    this.log.warn('GivHome evidence Evening Excess Export cleanup started: reason=%s HR59=0-first clearSlot=yes restoreHr112=%s automaticMutationPath=%s', reason, Number.isFinite(Number(snapshot?.HR112)) ? 'captured-prestate' : 'unavailable', this.applianceControl.automaticMutationPath);

    await this.writeDirectRegister(59, 0, 'GivHome EEE cleanup HR59 disable-first');
    if (profileKind === 'ch-aio') {
      await this.writeDirectRegister(291, 0, 'GivHome EEE cleanup HR291 clear');
      await this.writeDirectRegister(292, 0, 'GivHome EEE cleanup HR292 clear');
      await this.writeDirectRegister(293, 0, 'GivHome EEE cleanup HR293 clear');
    } else {
      await this.writeDirectRegister(56, 0, 'GivHome EEE cleanup HR56 clear');
      await this.writeDirectRegister(57, 0, 'GivHome EEE cleanup HR57 clear');
    }
    if (Number.isFinite(Number(snapshot?.HR112))) {
      await this.writeDirectRegister(112, Number(snapshot.HR112), 'GivHome EEE cleanup HR112 restore captured prestate');
    }

    const post = await this.readExportPrestate(profileKind);
    const slotCleared = profileKind === 'ch-aio'
      ? Number(post.HR291 || 0) === 0 && Number(post.HR292 || 0) === 0
      : Number(post.HR56 || 0) === 0 && Number(post.HR57 || 0) === 0;
    if (Number(post.HR59 || 0) !== 0 || !slotCleared) {
      throw new Error(`Evening Excess Export cleanup readback mismatch: HR59=${post.HR59} slotCleared=${slotCleared ? 'yes' : 'no'}`);
    }

    this.excessEnergyExportActive = false;
    this.activeExcessExportSlot = null;
    this.clearEveningExcessExportMemory();
    this.setApplianceCommandState(COMMAND_KINDS.EVENING_EXCESS_EXPORT, this.eveningExcessExportArmed);
    this.log.warn('GivHome evidence Evening Excess Export cleanup complete: reason=%s HR59=%s slotCleared=yes HR112=%s memoryCleared=yes switchRemainsArmed=%s automaticMutationPath=%s', reason, post.HR59, post.HR112, this.eveningExcessExportArmed ? 'yes' : 'no', this.applianceControl.automaticMutationPath);
  }

  startApplianceAutomationLoops() {
    if (this.applianceAutomationTimer) return;
    if (this.applianceControl.features.octopusSmartWindows) {
      this.pollOctopusDispatches(true).catch((err) => this.log.warn('Intelligent Octopus Go initial poll failed: %s', err && err.message ? err.message : String(err)));
    }
    this.applianceAutomationTimer = setInterval(() => {
      this.pollOctopusDispatches(false).catch((err) => this.log.warn('Intelligent Octopus Go poll failed: %s', err && err.message ? err.message : String(err)));
      this.applyApplianceAutomation().catch((err) => this.log.warn('GivHome command appliance automation failed safely: %s', err && err.message ? err.message : String(err)));
      this.recordEveHistory(false).catch((err) => this.log.warn('GivHome command Eve history record failed safely: %s', err && err.message ? err.message : String(err)));
    }, APPLIANCE_AUTOMATION_INTERVAL_MS);
  }

  async pollOctopusDispatches(force) {
    if (!this.applianceControl.features.octopusSmartWindows) return;
    if (!this.applianceControl.octopusApiKey || !this.applianceControl.octopusAccountNumber) return;
    if (this.octopusState.polling) return;
    const nowMs = Date.now();
    if (!force && nowMs - this.octopusState.lastPollMs < this.applianceControl.octopusPollSeconds * 1000) return;
    this.octopusState.polling = true;
    try {
      const token = await this.getOctopusToken();
      const pollNow = new Date();
      const previousState = getMergedCheapState(pollNow, this.octopusState.dispatches, this.applianceControl, this.octopusState);
      const dispatches = await this.getOctopusPlannedDispatches(token);
      const stateWithoutGrace = getMergedCheapState(pollNow, dispatches, this.applianceControl, {
        ...this.octopusState,
        earlyTerminationGraceUntil: null,
        earlyTerminationDispatchStart: null,
        earlyTerminationDispatchEnd: null
      });

      if (previousState.dispatchActive && !stateWithoutGrace.dispatchActive && previousState.activeDispatchEnd instanceof Date && pollNow < previousState.activeDispatchEnd) {
        const graceUntil = earlyTerminationGraceEnd(pollNow, this.applianceControl.graceMinutes);
        if (graceUntil > pollNow) {
          this.octopusState.earlyTerminationGraceUntil = graceUntil;
          this.octopusState.earlyTerminationDispatchStart = previousState.activeDispatchStart || null;
          this.octopusState.earlyTerminationDispatchEnd = previousState.activeDispatchEnd || null;
          this.log.warn('GivHome evidence Intelligent Octopus Go early-termination grace armed: previousWindow=%s detectedAt=%s graceUntil=%s policy=ceil-to-next-half-hour-up-to-configured-cap normalDispatchEndExtended=no automaticMutationPath=%s', renderSingleDispatchWindowForLog(previousState.activeDispatchStart, previousState.activeDispatchEnd) || 'unknown', dateToDisplayHmm(pollNow), dateToDisplayHmm(graceUntil), this.applianceControl.automaticMutationPath);
        }
      } else if (stateWithoutGrace.dispatchActive || (this.octopusState.earlyTerminationGraceUntil instanceof Date && pollNow >= this.octopusState.earlyTerminationGraceUntil)) {
        this.octopusState.earlyTerminationGraceUntil = null;
        this.octopusState.earlyTerminationDispatchStart = null;
        this.octopusState.earlyTerminationDispatchEnd = null;
      }

      this.octopusState.dispatches = dispatches;
      this.octopusState.lastPollMs = nowMs;
      this.octopusState.lastPollOk = true;
      this.octopusState.lastError = '';
      const windows = renderDispatchWindowsForLog(dispatches);
      const state = getMergedCheapState(pollNow, dispatches, this.applianceControl, this.octopusState);
      this.log.warn('GivHome evidence Intelligent Octopus Go poll ok: dispatchCount=%s windows=%s smartActive=%s graceActive=%s protectedUntil=%s nextWindow=%s gracePolicy=early-termination-ceil-to-half-hour normalDispatchEndExtended=no networkCalls=yes automaticMutationPath=%s', dispatches.length, windows || 'none', state.smartActive ? 'yes' : 'no', state.graceActive ? 'yes' : 'no', state.protectedEnd ? dateToDisplayHmm(state.protectedEnd) : 'none', renderSingleDispatchWindowForLog(state.nextDispatchStart, state.nextDispatchEnd) || 'none', this.applianceControl.automaticMutationPath);
    } catch (err) {
      this.octopusState.lastPollMs = nowMs;
      this.octopusState.lastPollOk = false;
      this.octopusState.lastError = err && err.message ? err.message : String(err);
      this.octopusState.token = null;
      throw err;
    } finally {
      this.octopusState.polling = false;
    }
  }

  async getOctopusToken() {
    if (this.octopusState.token && Date.now() - this.octopusState.tokenRetrievedAt < 55 * 60 * 1000) return this.octopusState.token;
    const response = await fetch('https://api.octopus.energy/v1/graphql/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'mutation obtainKrakenToken($input: ObtainJSONWebTokenInput!) { obtainKrakenToken(input: $input) { token } }', variables: { input: { APIKey: this.applianceControl.octopusApiKey } } })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Intelligent Octopus Go token HTTP ${response.status}`);
    const token = body?.data?.obtainKrakenToken?.token;
    if (!token) throw new Error('Intelligent Octopus Go token response missing token');
    this.octopusState.token = token;
    this.octopusState.tokenRetrievedAt = Date.now();
    return token;
  }

  async getOctopusPlannedDispatches(token) {
    const response = await fetch('https://api.octopus.energy/v1/graphql/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ query: 'query getPlannedDispatches($accountNumber: String!) { plannedDispatches(accountNumber: $accountNumber) { startDt endDt } }', variables: { accountNumber: this.applianceControl.octopusAccountNumber } })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Intelligent Octopus Go dispatch HTTP ${response.status}`);
    if (body?.errors?.length) throw new Error(body.errors[0]?.message || 'Intelligent Octopus Go dispatch GraphQL error');
    const rows = Array.isArray(body?.data?.plannedDispatches) ? body.data.plannedDispatches : [];
    return rows.map((row) => ({ start: new Date(row.startDt), end: new Date(row.endDt) })).filter((row) => !Number.isNaN(row.start.getTime()) && !Number.isNaN(row.end.getTime()) && row.end > row.start).sort((a, b) => a.start - b.start);
  }

  async applyApplianceAutomation() {
    const model = this.latestModel;
    if (!model || this.health.state !== 'online') return;
    const now = new Date();
    const cheapState = getMergedCheapState(now, this.octopusState.dispatches, this.applianceControl, this.octopusState);
    // GivHome evidence: do not create grace by adding time to normal dispatch ends.
    // Early-termination grace is armed only by pollOctopusDispatches when an active dispatch disappears before its planned end.
    if (cheapState.dispatchActive && cheapState.protectedEnd) this.octopusState.lastCheapUntil = cheapState.protectedEnd;

    const batteryCarePlanForEvidence = getBatteryCarePlan({ model, cheapState, config: this.applianceControl, now });
    const signature = JSON.stringify({ cheap: cheapState.cheapActive, fallback: cheapState.fallbackActive, smart: cheapState.smartActive, grace: cheapState.graceActive, source: cheapState.source, soc: model.socPercent, auto: this.autoChargeActive, autoLabel: this.autoChargeLabel, exportArmed: this.eveningExcessExportArmed });
    const signatureChanged = signature !== this.lastAutomationSignature;
    this.lastAutomationSignature = signature;

    /*
     * GivHome evidence: do not use the signature as a command suppressor.
     * The 2026-08-21 failure audit showed the fallback cheap window was configured
     * and visible in readData, but enableCharge remained disabled all night.  A
     * cheap-window supervisor must therefore re-evaluate on every automation tick
     * and retry safely until HR96/charging is confirmed or a specific refusal is logged.
     */
    this.logBatteryCarePlan(batteryCarePlanForEvidence, cheapState, model, now, signatureChanged ? 'automation-evaluation' : 'automation-supervisor-repeat');

    const socBelowTarget = Number.isFinite(model.socPercent) && model.socPercent < this.applianceControl.targetSoc;
    const hasWindowEnd = cheapState.cheapWindowEnd instanceof Date && !Number.isNaN(cheapState.cheapWindowEnd.getTime());
    const iogProtectedEnd = cheapState.protectedEnd instanceof Date && !Number.isNaN(cheapState.protectedEnd.getTime()) ? cheapState.protectedEnd : null;
    const smartProtectionActive = Boolean(this.applianceControl.features.homeBatteryProtectionDuringSmartSlots && cheapState.smartActive && iogProtectedEnd);
    const chargeEnd = smartProtectionActive ? iogProtectedEnd : cheapState.cheapWindowEnd;
    const minutes = chargeEnd instanceof Date ? Math.max(1, Math.ceil((chargeEnd.getTime() - now.getTime()) / 60000)) : 0;
    const isIogAutoCharge = this.autoChargeActive && this.autoChargeLabel === 'Intelligent Octopus Go Home Battery Protection';
    const isIogAutoPause = this.autoChargeActive && this.autoChargeLabel === 'Intelligent Octopus Go Home Battery Protection Pause';
    const isIogAutoProtection = isIogAutoCharge || isIogAutoPause;
    const batteryDischargeW = Number.isFinite(model.batteryDischargePowerW) ? model.batteryDischargePowerW : 0;
    const evSizedLoadW = Number.isFinite(model.loadPowerW) ? model.loadPowerW : 0;
    const protectedUntilChanged = Boolean(isIogAutoProtection && iogProtectedEnd && this.autoChargeProtectedUntilMs && iogProtectedEnd.getTime() > this.autoChargeProtectedUntilMs + 60000);
    const repairBecauseDischarging = Boolean(smartProtectionActive && batteryDischargeW >= 250 && evSizedLoadW >= 2000);

    if (this.autoChargeActive) {
      if (isIogAutoProtection) {
        if (!smartProtectionActive) {
          const reason = 'Intelligent Octopus Go smart/grace window ended';
          const protectionFamily = isIogAutoPause ? 'pause' : 'charge';
          this.log.warn('GivHome evidence Intelligent Octopus Go restore queued: reason=%s protectionMode=%s family=%s automaticMutationPath=%s', reason, this.applianceControl.iogHomeBatteryProtectionModeText || 'Charge mode', protectionFamily, this.applianceControl.automaticMutationPath);
          await this.cleanupApplianceCommandFamily(protectionFamily, reason);
          this.log.warn('GivHome evidence Intelligent Octopus Go restore verified: family=%s reason=%s automaticMutationPath=%s', protectionFamily, reason, this.applianceControl.automaticMutationPath);
          return;
        }
      } else if (!cheapState.cheapActive || !socBelowTarget) {
        const reason = !cheapState.cheapActive ? 'cheap window ended' : 'target SOC reached';
        this.log.warn('GivHome evidence Cheap Overnight restore queued: reason=%s autoChargeLabel=%s automaticMutationPath=%s', reason, this.autoChargeLabel || 'unknown', this.applianceControl.automaticMutationPath);
        await this.cleanupApplianceCommandFamily('charge', reason);
        this.log.warn('GivHome evidence Cheap Overnight restore verified: HR96=0 reason=%s automaticMutationPath=%s', reason, this.applianceControl.automaticMutationPath);
        return;
      }
    }

    if (this.applianceControl.features.cheapOvernightCharging && cheapState.fallbackActive && !cheapState.smartActive && !cheapState.graceActive && socBelowTarget && hasWindowEnd && !this.autoChargeActive) {
      const carePlan = getBatteryCarePlan({ model, cheapState, config: this.applianceControl, now });
      this.logCheapOvernightPlan({ active: true, reason: 'main-overnight-cheap-window', cheapState, model, minutes, carePlan, trigger: 'fallback-cheap-window-supervisor' });
      await this.withManualChargeTransportGate('GivHome Cheap Overnight fallback charge', async () => {
        this.log.warn('GivHome evidence Cheap Overnight command started: source=fallback-cheap-window minutes=%s batteryCare=%s automaticMutationPath=%s', minutes, carePlan.active ? 'yes' : 'no', this.applianceControl.automaticMutationPath);
        await this.startTimedChargeCommand({ displayName: 'Cheap Overnight', minutes }, { automatic: true, label: 'Cheap Overnight', startDate: now, endDate: cheapState.cheapWindowEnd, targetSoc: this.applianceControl.targetSoc, batteryCarePlan: carePlan });
      });
      this.autoChargeActive = true;
      this.autoChargeLabel = 'Cheap Overnight';
      this.autoChargeProtectedUntilMs = cheapState.cheapWindowEnd.getTime();
      const verify = await this.readChargePrestate();
      this.log.warn('GivHome evidence Cheap Overnight command verified: HR94=%s HR95=%s HR96=%s HR111=%s HR116=%s minutes=%s source=fallback-cheap-window automaticMutationPath=%s', verify.HR94, verify.HR95, verify.HR96, verify.HR111, verify.HR116, minutes, this.applianceControl.automaticMutationPath);
      if (verify.HR96 !== 1) throw new Error(`Cheap Overnight verification failed: expected HR96=1 actual=${verify.HR96}`);
      this.log.warn('GivHome evidence Cheap Overnight charging requested: source=fallback-cheap-window soc=%s targetSoc=%s chargeRatePercent=%s estimatedChargeKw=%s windowEnd=%s automaticMutationPath=%s', model.socPercent, this.applianceControl.targetSoc, carePlan.active ? carePlan.chargeRatePercent : 'prestate-or-default', carePlan.active && Number.isFinite(carePlan.estimatedChargeKw) ? carePlan.estimatedChargeKw.toFixed(2) : 'n/a', cheapState.cheapWindowEnd.toISOString(), this.applianceControl.automaticMutationPath);
      return;
    }

    const iogPauseManualSuppressed = Boolean(
      this.iogPauseSuppressedUntilMs
      && iogProtectedEnd
      && now.getTime() < this.iogPauseSuppressedUntilMs
      && this.applianceControl.iogHomeBatteryProtectionMode !== 'charge'
    );

    if (smartProtectionActive && iogPauseManualSuppressed) {
      this.log.warn('GivHome Intelligent Octopus Go pause protection suppressed by manual Eco override until current smart/grace window ends: suppressedUntil=%s protectionMode=%s source=iog-home-battery-protection', dateToDisplayHmm(new Date(this.iogPauseSuppressedUntilMs)), this.applianceControl.iogHomeBatteryProtectionModeText || 'Pause mode');
      return;
    }

    if (!smartProtectionActive && this.iogPauseSuppressedUntilMs && now.getTime() >= this.iogPauseSuppressedUntilMs) {
      this.iogPauseSuppressedUntilMs = 0;
    }

    if (smartProtectionActive && (!isIogAutoProtection || protectedUntilChanged || repairBecauseDischarging)) {
      const carePlan = { active: false, reason: 'home-battery-protection-not-battery-care' };
      const trigger = !isIogAutoProtection ? 'smart-slot-home-battery-protection-start' : protectedUntilChanged ? 'smart-slot-home-battery-protection-extend' : 'smart-slot-home-battery-protection-repair-discharge';
      const protectionMode = this.applianceControl.iogHomeBatteryProtectionMode || 'charge';
      const protectionModeText = this.applianceControl.iogHomeBatteryProtectionModeText || 'Charge mode';
      this.logBatteryCarePlan(getBatteryCarePlan({ model, cheapState, config: this.applianceControl, now }), cheapState, model, now, trigger);
      this.log.warn('GivHome evidence Intelligent Octopus Go protection decision: trigger=%s protectionMode=%s smartActive=%s graceActive=%s soc=%s targetSoc=%s batteryDischargeW=%s loadW=%s protectedUntil=%s previousProtectedUntil=%s willQueue=yes reason=continuous-enforcement automaticMutationPath=%s', trigger, protectionModeText, cheapState.smartActive ? 'yes' : 'no', cheapState.graceActive ? 'yes' : 'no', model.socPercent, this.applianceControl.targetSoc, batteryDischargeW, evSizedLoadW, iogProtectedEnd ? dateToDisplayHmm(iogProtectedEnd) : 'none', this.autoChargeProtectedUntilMs ? dateToDisplayHmm(new Date(this.autoChargeProtectedUntilMs)) : 'none', this.applianceControl.automaticMutationPath);
      if (protectionMode === 'charge') {
        await this.withManualChargeTransportGate('GivHome evidence smart-slot home-battery protection charge-mode enforce', async () => {
          await this.startTimedChargeCommand({ displayName: 'Intelligent Octopus Go Home Battery Protection', minutes }, { automatic: true, label: 'Intelligent Octopus Go Home Battery Protection', startDate: now, endDate: iogProtectedEnd, targetSoc: this.applianceControl.targetSoc, powerPercent: 100, batteryCarePlan: carePlan });
        });
        this.autoChargeLabel = 'Intelligent Octopus Go Home Battery Protection';
      } else {
        await this.withManualChargeTransportGate('GivHome evidence smart-slot home-battery protection pause-mode enforce', async () => {
          await this.startIogPauseProtectionCommand({ mode: protectionMode, automatic: true, label: 'Intelligent Octopus Go Home Battery Protection', startDate: now, endDate: iogProtectedEnd, minutes });
        });
        this.autoChargeLabel = 'Intelligent Octopus Go Home Battery Protection Pause';
      }
      this.autoChargeActive = true;
      this.autoChargeProtectedUntilMs = iogProtectedEnd.getTime();
      this.log.warn('GivHome evidence Intelligent Octopus Go home-battery protection active: mins=%s source=%s protectionMode=%s protectedUntil=%s returnToPreviousStateAfterWindow=yes graceMinutes=%s enforcement=continuous', minutes, cheapState.source, protectionModeText, dateToDisplayHmm(iogProtectedEnd), this.applianceControl.graceMinutes);
      return;
    }

    if (cheapState.fallbackActive && !cheapState.smartActive && !cheapState.graceActive && !this.autoChargeActive) {
      this.logCheapOvernightPlan({ active: false, reason: !this.applianceControl.features.cheapOvernightCharging ? 'cheap-overnight-disabled' : !socBelowTarget ? 'soc-at-or-above-target' : !hasWindowEnd ? 'cheap-window-end-unavailable' : 'conditions-not-met', cheapState, model, minutes, carePlan: batteryCarePlanForEvidence, trigger: 'fallback-cheap-window-supervisor' });
    }

    const eeeRecovered = await this.recoverEveningExcessExportFromInverter(model, cheapState, now);
    if (eeeRecovered) return;

    const agileHandled = await this.applyOctopusAgileOutgoingAutoExport(model, cheapState, now);
    if (agileHandled) return;

    const flux = this.evaluateOctopusFluxExport(model, cheapState, now);
    if (flux?.stopReason) {
      this.log.warn('GivHome evidence Octopus Flux Export stop queued: reason=%s observedBatteryKwh=%s expectedBatteryKwh=%s effectivePlanningKw=%s automaticMutationPath=%s', flux.stopReason, flux.observed?.observedBatteryKwh?.toFixed ? flux.observed.observedBatteryKwh.toFixed(3) : 'unknown', Number(this.activeOctopusFluxExportSlot?.expectedBatteryKwh || 0).toFixed(3), flux.observed?.effectivePlanningKw?.toFixed ? flux.observed.effectivePlanningKw.toFixed(1) : 'unknown', this.applianceControl.automaticMutationPath);
      await this.cleanupApplianceCommandFamily('export', `Octopus Flux Export ${flux.stopReason}`);
      return;
    }
    if (flux?.start) {
      await this.withManualChargeTransportGate('GivHome Octopus Flux Export', async () => {
        await this.startTimedExportCommand({ displayName: 'Octopus Flux Export', minutes: flux.minutes }, { automatic: true, label: 'Octopus Flux Export', startDate: flux.start, endDate: flux.end, powerKw: this.applianceControl.octopusFluxExportPowerKw, powerPercent: this.applianceControl.octopusFluxExportPowerPercent, exportTargetSoc: flux.reserveSoc, exportFamily: 'octopus-flux-export', exportSource: 'octopus-flux-peak-planner' });
      });
      this.octopusFluxExportObservedBatteryKwh = 0;
      this.octopusFluxExportObservedGridKwh = 0;
      this.octopusFluxExportLastObservedAtMs = 0;
      this.activeOctopusFluxExportSlot = { start: flux.start, end: flux.end, minutes: flux.minutes, profileKind: this.isCeAcCoupledProfile() ? 'ce-ac' : 'ch-aio', powerPercent: flux.powerDecision?.powerPercent || this.applianceControl.octopusFluxExportPowerPercent, powerKw: this.applianceControl.octopusFluxExportPowerKw, requestedPowerKw: flux.requestedPowerKw, effectivePlanningKw: flux.effectivePlanningKw, expectedBatteryKwh: flux.expectedBatteryKwh, observedBatteryKwh: 0, observedGridKwh: 0, reserveSoc: flux.reserveSoc, reserveKwh: flux.reserveKwh, availableKwh: flux.availableKwh, powerRatioRegister: 'HR112', powerRatioAuthority: flux.powerRatioAuthority, source: 'octopus-flux-peak-planner' };
      this.octopusFluxExportActive = true;
      this.persistOctopusFluxExportMemory(this.activeOctopusFluxExportSlot, 'planner-started');
      this.scheduleApplianceCommandCleanup(COMMAND_KINDS.OCTOPUS_FLUX_EXPORT, 'export', flux.minutes);
      this.log.warn('GivHome evidence Octopus Flux Export command queued: start=%s end=%s minutes=%s reserveSoc=%s reserveKwh=%s availableKwh=%s requestedPowerKw=%s effectivePlanningKw=%s expectedBatteryKwh=%s memorySaved=yes automaticMutationPath=%s', dateToHmm(flux.start), dateToHmm(flux.end), flux.minutes, flux.reserveSoc, flux.reserveKwh.toFixed(2), flux.availableKwh.toFixed(2), flux.requestedPowerKw.toFixed(1), flux.effectivePlanningKw.toFixed(1), flux.expectedBatteryKwh.toFixed(2), this.applianceControl.automaticMutationPath);
      return;
    }

    const eee = this.evaluateEveningExcessExport(model, cheapState, now);
    if (eee?.start) {
      await this.withManualChargeTransportGate('GivHome Evening Excess Export', async () => {
        await this.startTimedExportCommand({ displayName: 'Evening Excess Export', minutes: eee.minutes }, { automatic: true, label: 'Evening Excess Export', startDate: eee.start, endDate: eee.end, powerKw: this.applianceControl.eveningExportPowerKw, powerPercent: this.applianceControl.eveningExportPowerPercent, exportTargetSoc: this.applianceControl.eveningExportReserveSoc, exportFamily: 'evening-excess-export', exportSource: 'evening-excess-export-slider' });
      });
      this.activeExcessExportSlot = { start: eee.start, end: eee.end, minutes: eee.minutes, profileKind: this.isCeAcCoupledProfile() ? 'ce-ac' : 'ch-aio', powerPercent: this.applianceControl.eveningExportPowerPercent, powerKw: this.applianceControl.eveningExportPowerKw, reserveSoc: this.applianceControl.eveningExportReserveSoc, source: 'planner' };
      this.excessEnergyExportActive = true;
      this.persistEveningExcessExportMemory(this.activeExcessExportSlot, 'planner-started');
      this.scheduleApplianceCommandCleanup(COMMAND_KINDS.EVENING_EXCESS_EXPORT, 'export', eee.minutes);
      this.log.warn('GivHome evidence Evening Excess Export command queued: start=%s end=%s minutes=%s memorySaved=yes automaticMutationPath=%s', dateToHmm(eee.start), dateToHmm(eee.end), eee.minutes, this.applianceControl.automaticMutationPath);
    }
  }

  logCheapOvernightPlan({ active, reason, cheapState, model, minutes, carePlan, trigger }) {
    const estimatedChargeKw = carePlan && Number.isFinite(carePlan.estimatedChargeKw) ? carePlan.estimatedChargeKw.toFixed(2) : 'n/a';
    const chargeRatePercent = carePlan && Number.isFinite(carePlan.chargeRatePercent) ? carePlan.chargeRatePercent : 'n/a';
    this.log.warn('GivHome evidence Cheap Overnight plan: trigger=%s active=%s reason=%s source=fallback-cheap-window fallbackActive=%s smartActive=%s graceActive=%s cheapStart=%s cheapEnd=%s remainingMinutes=%s soc=%s targetSoc=%s batteryCare=%s calculatedHr111Percent=%s estimatedChargeKw=%s enableCheapOvernightCharging=%s returnToEcoAfterWindow=yes automaticMutationPath=%s',
      trigger || 'unknown',
      active ? 'yes' : 'no',
      reason || 'unknown',
      cheapState?.fallbackActive ? 'yes' : 'no',
      cheapState?.smartActive ? 'yes' : 'no',
      cheapState?.graceActive ? 'yes' : 'no',
      this.applianceControl.cheapStart,
      this.applianceControl.cheapEnd,
      Number.isFinite(minutes) ? minutes : 'n/a',
      model?.socPercent ?? 'unknown',
      this.applianceControl.targetSoc,
      carePlan?.active ? 'yes' : 'no',
      chargeRatePercent,
      estimatedChargeKw,
      this.applianceControl.features.cheapOvernightCharging ? 'yes' : 'no',
      this.applianceControl.automaticMutationPath
    );
  }

  logBatteryCarePlan(plan, cheapState, model, now, trigger) {
    const batteryCareEnabled = this.applianceControl.features.batteryCare === true;
    const batteryCareActive = plan?.active === true;
    const nowMs = now instanceof Date ? now.getTime() : Date.now();
    if (!batteryCareActive) {
      const signature = [
        'disabled',
        plan?.reason || 'unknown',
        cheapState?.source || 'unknown',
        cheapState?.fallbackActive ? 'fallback' : 'no-fallback',
        cheapState?.smartActive ? 'smart' : 'no-smart',
        cheapState?.graceActive ? 'grace' : 'no-grace',
        this.applianceControl.cheapStart,
        this.applianceControl.cheapEnd,
        this.applianceControl.graceMinutes
      ].join('|');
      if (signature === this.lastBatteryCarePlanLogSignature && nowMs - this.lastBatteryCarePlanLogMs < this.batteryCareIdleLogIntervalMs) {
        return;
      }
      this.lastBatteryCarePlanLogSignature = signature;
      this.lastBatteryCarePlanLogMs = nowMs;
    } else {
      this.lastBatteryCarePlanLogSignature = '';
      this.lastBatteryCarePlanLogMs = 0;
    }

    const remainingMinutes = plan && Number.isFinite(plan.remainingMinutes) ? plan.remainingMinutes : 'n/a';
    const requiredAverageKw = plan && Number.isFinite(plan.requiredAverageKw) ? plan.requiredAverageKw.toFixed(2) : 'n/a';
    const calculatedHr111Percent = plan && Number.isFinite(plan.chargeRatePercent) ? plan.chargeRatePercent : 'n/a';
    const estimatedChargeKw = plan && Number.isFinite(plan.estimatedChargeKw) ? plan.estimatedChargeKw.toFixed(2) : 'n/a';
    const energyNeededKwh = plan && Number.isFinite(plan.energyNeededKwh) ? plan.energyNeededKwh.toFixed(2) : 'n/a';
    const socGap = plan && Number.isFinite(plan.socGap) ? plan.socGap : 'n/a';
    this.log.warn('GivHome evidence Battery Care plan: trigger=%s enabled=%s active=%s reason=%s source=%s fallbackActive=%s smartActive=%s graceActive=%s cheapStart=%s cheapEnd=%s graceMinutes=%s soc=%s targetSoc=%s socGap=%s remainingMinutes=%s batteryCapacityKwh=%s maxBatteryChargePowerKw=%s batteryCareMode=%s minimumOvernightMinutes=%s energyNeededKwh=%s requiredAverageKw=%s calculatedHr111Percent=%s estimatedChargeKw=%s route=HR111,HR116,HR94,HR95,HR96 scope=main-overnight-cheap-window-only excludes=short-IOG-dispatches,grace-periods,manual-tiles automaticMutationPath=%s',
      trigger || 'unknown',
      this.applianceControl.features.batteryCare ? 'yes' : 'no',
      plan?.active ? 'yes' : 'no',
      plan?.active ? 'active' : (plan?.reason || 'unknown'),
      cheapState?.source || 'unknown',
      cheapState?.fallbackActive ? 'yes' : 'no',
      cheapState?.smartActive ? 'yes' : 'no',
      cheapState?.graceActive ? 'yes' : 'no',
      this.applianceControl.cheapStart,
      this.applianceControl.cheapEnd,
      this.applianceControl.graceMinutes,
      Number.isFinite(model?.socPercent) ? model.socPercent : 'unknown',
      this.applianceControl.targetSoc,
      socGap,
      remainingMinutes,
      this.applianceControl.batteryCapacityKwh,
      this.applianceControl.maxBatteryChargePowerKw,
      this.applianceControl.batteryCareMode,
      this.applianceControl.batteryCareMinimumWindowMinutes,
      energyNeededKwh,
      requiredAverageKw,
      calculatedHr111Percent,
      estimatedChargeKw,
      this.applianceControl.automaticMutationPath);
  }

  octopusAgileOutgoingStatePath() {
    return this.stateFilePath('octopus_agile_outgoing_auto_export_state');
  }

  getOctopusAgileOutgoingTariffCode() {
    const configured = String(this.applianceControl.octopusAgileOutgoingTariffCode || '').trim().toUpperCase();
    if (configured) return configured;
    const product = String(this.applianceControl.octopusAgileOutgoingProductCode || 'AGILE-OUTGOING-19-05-13').trim().toUpperCase();
    const region = String(this.applianceControl.octopusAgileOutgoingRegionCode || '').trim().toUpperCase();
    const safeRegion = /^[A-P]$/.test(region) ? region : 'J';
    return `E-1R-${product}-${safeRegion}`;
  }

  isOctopusAgileOutgoingLiveEnabled() {
    if (this.applianceControl.octopusAgileOutgoingDryRun) return false;
    return String(this.applianceControl.octopusAgileOutgoingLiveAcknowledgement || '').trim() === 'ENABLE_AGILE_OUTGOING_LIVE_EXPORT';
  }

  localDayKey(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  loadOctopusAgileOutgoingState() {
    const fallback = { version: '4.0.0-beta.1', serial: this.inverterSerial, dayKey: this.localDayKey(), daily: { plannedKwh: 0, observedInverterKwh: 0, estimatedValuePence: 0 }, slots: [], activeSlot: null, suspendedReason: '' };
    const payload = loadJson(this.octopusAgileOutgoingStatePath(), fallback) || fallback;
    if (payload.serial && payload.serial !== this.inverterSerial) return fallback;
    if (payload.dayKey !== this.localDayKey()) {
      return { ...fallback, learning: payload.learning || fallback.learning || {}, previousDay: { dayKey: payload.dayKey, daily: payload.daily || {}, slots: payload.slots || [], plan: payload.plan || null } };
    }
    payload.version = payload.version || '1.1.0-beta.11';
    payload.serial = this.inverterSerial;
    payload.daily = payload.daily || { plannedKwh: 0, observedInverterKwh: 0, estimatedValuePence: 0 };
    payload.slots = Array.isArray(payload.slots) ? payload.slots : [];
    return payload;
  }

  saveOctopusAgileOutgoingState(payload) {
    const state = payload || this.loadOctopusAgileOutgoingState();
    state.version = '1.1.0-beta.11';
    state.serial = this.inverterSerial;
    state.dayKey = this.localDayKey();
    state.updatedAt = new Date().toISOString();
    saveJson(this.octopusAgileOutgoingStatePath(), state);
    return state;
  }

  persistOctopusAgileOutgoingMemory(slot, reason) {
    const state = this.loadOctopusAgileOutgoingState();
    const activeSlot = {
      start: slot.start instanceof Date ? slot.start.toISOString() : slot.start,
      end: slot.end instanceof Date ? slot.end.toISOString() : slot.end,
      minutes: slot.minutes,
      profileKind: slot.profileKind,
      powerPercent: slot.powerPercent,
      powerKw: slot.powerKw,
      reserveSoc: slot.reserveSoc,
      reserveKwh: slot.reserveKwh,
      availableKwh: slot.availableKwh,
      pricePence: slot.pricePence,
      expectedKwh: slot.expectedKwh,
      expectedValuePence: slot.expectedValuePence,
      observedInverterKwh: Number(slot.observedInverterKwh || 0),
      source: slot.source || 'octopus-agile-export-autopilot',
      reason: reason || 'agile-outgoing-export-start',
      mpanAuditStatus: 'pending'
    };
    state.activeSlot = activeSlot;
    const exists = state.slots.some((candidate) => candidate.start === activeSlot.start && candidate.end === activeSlot.end && candidate.source === activeSlot.source);
    if (!exists) state.slots.push(activeSlot);
    state.daily.plannedKwh = Number((Number(state.daily.plannedKwh || 0) + Number(activeSlot.expectedKwh || 0)).toFixed(4));
    state.daily.estimatedValuePence = Number((Number(state.daily.estimatedValuePence || 0) + Number(activeSlot.expectedValuePence || 0)).toFixed(2));
    this.saveOctopusAgileOutgoingState(state);
    this.log.warn('GivHome evidence Octopus Agile Export memory saved: start=%s end=%s pricePence=%s expectedKwh=%s expectedValuePence=%s reason=%s mpanAudit=pending automaticMutationPath=absent', activeSlot.start ? dateToDisplayHmm(new Date(activeSlot.start)) : 'unknown', activeSlot.end ? dateToDisplayHmm(new Date(activeSlot.end)) : 'unknown', activeSlot.pricePence, activeSlot.expectedKwh, activeSlot.expectedValuePence, activeSlot.reason);
  }

  loadOctopusAgileOutgoingMemory() {
    const payload = this.loadOctopusAgileOutgoingState();
    if (payload.suspendedReason) this.octopusAgileOutgoingSuspendedReason = payload.suspendedReason;
    const slot = payload.activeSlot;
    if (!slot) return;
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    this.activeOctopusAgileOutgoingSlot = { ...slot, start, end, recoveredFromMemory: true };
    this.octopusAgileOutgoingObservedExportKwh = Number(slot.observedInverterKwh || 0);
    this.octopusAgileOutgoingLastObservedAtMs = Date.now();
    if (end > new Date() && this.applianceControl.features.octopusAgileOutgoingExport) this.octopusAgileOutgoingExportArmed = true;
    this.log.warn('GivHome evidence Octopus Agile Export memory loaded: start=%s end=%s activeNow=%s observedInverterKwh=%s automaticMutationPath=absent', dateToDisplayHmm(start), dateToDisplayHmm(end), new Date() < end ? 'yes' : 'no', this.octopusAgileOutgoingObservedExportKwh.toFixed(3));
  }

  clearOctopusAgileOutgoingMemory() {
    const state = this.loadOctopusAgileOutgoingState();
    state.activeSlot = null;
    this.octopusAgileOutgoingExportActive = false;
    this.activeOctopusAgileOutgoingSlot = null;
    this.octopusAgileOutgoingObservedExportKwh = 0;
    this.octopusAgileOutgoingLastObservedAtMs = 0;
    try { this.saveOctopusAgileOutgoingState(state); } catch {}
  }

  async fetchOctopusAgileOutgoingRates(force = false, now = new Date()) {
    if (!this.applianceControl.features.octopusAgileOutgoingExport) return [];
    const productCode = String(this.applianceControl.octopusAgileOutgoingProductCode || 'AGILE-OUTGOING-19-05-13').trim().toUpperCase();
    const tariffCode = this.getOctopusAgileOutgoingTariffCode();
    const cacheAgeMs = Date.now() - Number(this.octopusAgileOutgoingPrices.fetchedAtMs || 0);
    if (!force && this.octopusAgileOutgoingPrices.productCode === productCode && this.octopusAgileOutgoingPrices.tariffCode === tariffCode && Array.isArray(this.octopusAgileOutgoingPrices.rates) && this.octopusAgileOutgoingPrices.rates.length > 0 && cacheAgeMs < 15 * 60 * 1000) {
      return this.octopusAgileOutgoingPrices.rates.map((rate) => ({ ...rate, start: new Date(rate.start), end: new Date(rate.end) }));
    }
    if (this.octopusAgileOutgoingFetchInFlight) return this.octopusAgileOutgoingFetchInFlight;

    this.octopusAgileOutgoingFetchInFlight = (async () => {
      const periodFrom = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const periodTo = new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString();
      const url = `https://api.octopus.energy/v1/products/${encodeURIComponent(productCode)}/electricity-tariffs/${encodeURIComponent(tariffCode)}/standard-unit-rates/?period_from=${encodeURIComponent(periodFrom)}&period_to=${encodeURIComponent(periodTo)}&page_size=1500`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Agile Outgoing price HTTP ${response.status}`);
      const body = await response.json();
      const rows = Array.isArray(body?.results) ? body.results : [];
      const rates = rows.map((row) => {
        const start = new Date(row.valid_from);
        const end = new Date(row.valid_to);
        const price = Number.isFinite(Number(row.value_inc_vat)) ? Number(row.value_inc_vat) : Number(row.value_exc_vat);
        return { start, end, pricePence: price };
      }).filter((rate) => rate.start instanceof Date && rate.end instanceof Date && !Number.isNaN(rate.start.getTime()) && !Number.isNaN(rate.end.getTime()) && rate.end > rate.start && Number.isFinite(rate.pricePence)).sort((a, b) => a.start - b.start);
      this.octopusAgileOutgoingPrices = { fetchedAtMs: Date.now(), productCode, tariffCode, rates: rates.map((rate) => ({ start: rate.start.toISOString(), end: rate.end.toISOString(), pricePence: rate.pricePence })), error: '' };
      this.log.warn('GivHome evidence Octopus Agile Export price poll ok: product=%s tariff=%s rates=%s periodFrom=%s periodTo=%s source=octopus-public-tariff-api', productCode, tariffCode, rates.length, periodFrom, periodTo);
      return rates;
    })();

    try {
      return await this.octopusAgileOutgoingFetchInFlight;
    } catch (err) {
      this.octopusAgileOutgoingPrices.error = err && err.message ? err.message : String(err);
      this.log.warn('GivHome evidence Octopus Agile Export price poll failed: product=%s tariff=%s error=%s failClosed=yes', productCode, tariffCode, this.octopusAgileOutgoingPrices.error);
      return [];
    } finally {
      this.octopusAgileOutgoingFetchInFlight = null;
    }
  }

  getOctopusAgileOutgoingDayCode(date = new Date()) {
    const codes = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return codes[date.getDay()] || 'unknown';
  }

  getOctopusAgileOutgoingDayLabel(date = new Date()) {
    const labels = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
    return labels[this.getOctopusAgileOutgoingDayCode(date)] || 'Unknown';
  }

  formatOctopusAgileOutgoingDaysToRun() {
    const days = Array.isArray(this.applianceControl.octopusAgileOutgoingDaysToRun) ? this.applianceControl.octopusAgileOutgoingDaysToRun : [];
    return days.length ? days.join(',') : 'none';
  }

  isOctopusAgileOutgoingRunDay(date = new Date()) {
    const days = Array.isArray(this.applianceControl.octopusAgileOutgoingDaysToRun) ? this.applianceControl.octopusAgileOutgoingDaysToRun : [];
    return days.includes(this.getOctopusAgileOutgoingDayCode(date));
  }

  formatOctopusFluxDaysToRun() {
    const days = Array.isArray(this.applianceControl.octopusFluxDaysToRun) ? this.applianceControl.octopusFluxDaysToRun : [];
    return days.length ? days.join(',') : 'none';
  }

  isOctopusFluxRunDay(date = new Date()) {
    const days = Array.isArray(this.applianceControl.octopusFluxDaysToRun) ? this.applianceControl.octopusFluxDaysToRun : [];
    return days.includes(this.getOctopusAgileOutgoingDayCode(date));
  }

  getOctopusAgileOutgoingSlotSearchMode() {
    return String(this.applianceControl.octopusAgileOutgoingSlotSearchMode || 'anyHighValue');
  }

  formatOctopusAgileOutgoingAllowedWindow() {
    const mode = this.getOctopusAgileOutgoingSlotSearchMode();
    if (mode === 'anyHighValue') return 'any-high-value-slot';
    if (mode === 'daytimeOnly') return 'daytime-only-06:00-22:00';
    if (mode === 'eveningFocus') return 'evening-focus-16:00-23:30';
    return `custom-${this.applianceControl.octopusAgileOutgoingAllowedStartTime}-${this.applianceControl.octopusAgileOutgoingAllowedEndTime}`;
  }

  isWithinClockWindow(date, startMinutes, endMinutes) {
    if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return false;
    const minutes = date.getHours() * 60 + date.getMinutes();
    if (startMinutes < endMinutes) return minutes >= startMinutes && minutes < endMinutes;
    return minutes >= startMinutes || minutes < endMinutes;
  }

  isWithinOctopusAgileAllowedWindow(date) {
    const mode = this.getOctopusAgileOutgoingSlotSearchMode();
    if (mode === 'anyHighValue') return true;
    if (mode === 'daytimeOnly') return this.isWithinClockWindow(date, 6 * 60, 22 * 60);
    if (mode === 'eveningFocus') return this.isWithinClockWindow(date, 16 * 60, 23 * 60 + 30);
    const start = clockTimeStringToMinutes(this.applianceControl.octopusAgileOutgoingAllowedStartTime);
    const end = clockTimeStringToMinutes(this.applianceControl.octopusAgileOutgoingAllowedEndTime);
    return this.isWithinClockWindow(date, start, end);
  }

  rateIsAllowedForOctopusAgile(rate) {
    if (!rate?.start || !rate?.end) return false;
    const midpoint = new Date((rate.start.getTime() + rate.end.getTime()) / 2);
    return this.isWithinOctopusAgileAllowedWindow(midpoint);
  }

  getCurrentAgileRate(rates, now = new Date()) {
    return rates.find((rate) => now >= rate.start && now < rate.end) || null;
  }

  updateOctopusAgileOutgoingLearning(model, now = new Date()) {
    if (!this.applianceControl.features.octopusAgileOutgoingExport) return null;
    if (this.applianceControl.octopusAgileOutgoingLearningMode === 'off') return null;
    if (!model) return null;
    const state = this.loadOctopusAgileOutgoingState();
    state.learning = updateAgileExportAutopilotLearningState(state.learning || {}, model, now, { alpha: 0.16 });
    state.learningMode = this.applianceControl.octopusAgileOutgoingLearningMode;
    const sinceSaveMs = Date.now() - Number(this.octopusAgileOutgoingLastLearningSaveMs || 0);
    if (sinceSaveMs > 5 * 60 * 1000 || !state.learningLastLoggedAt) {
      state.learningLastLoggedAt = now.toISOString();
      this.octopusAgileOutgoingLastLearningSaveMs = Date.now();
      try { this.saveOctopusAgileOutgoingState(state); } catch {}
      const sample = state.learning.lastSample || {};
      this.log.info('GivHome evidence Octopus Agile Export learning sample: mode=%s samples=%s halfHour=%s soc=%s pvKw=%s loadKw=%s gridExportKw=%s batteryDischargeKw=%s source=local-telemetry noInverterWrites=yes',
        this.applianceControl.octopusAgileOutgoingLearningMode,
        state.learning.samples || 0,
        state.learning && state.learning.lastSample ? dateToDisplayHmm(now) : 'unknown',
        sample.soc === null ? 'n/a' : sample.soc,
        Number.isFinite(Number(sample.pvKw)) ? Number(sample.pvKw).toFixed(3) : 'n/a',
        Number.isFinite(Number(sample.loadKw)) ? Number(sample.loadKw).toFixed(3) : 'n/a',
        Number.isFinite(Number(sample.gridExportKw)) ? Number(sample.gridExportKw).toFixed(3) : 'n/a',
        Number.isFinite(Number(sample.batteryDischargeKw)) ? Number(sample.batteryDischargeKw).toFixed(3) : 'n/a');
    }
    return state.learning;
  }

  getOctopusAgileOutgoingExecutionStage() {
    return String(this.applianceControl.octopusAgileOutgoingExecutionStage || 'plannerOnly');
  }

  octopusAgileOutgoingStageAllowsLiveExecution() {
    const stage = this.getOctopusAgileOutgoingExecutionStage();
    return stage === 'singleSlot' || stage === 'multiSlot' || stage === 'adaptive';
  }

  octopusAgileOutgoingStageAllowsMultipleSlots() {
    const stage = this.getOctopusAgileOutgoingExecutionStage();
    return stage === 'multiSlot' || stage === 'adaptive';
  }

  countOctopusAgileOutgoingExecutedSlots(state) {
    const slots = Array.isArray(state?.slots) ? state.slots : [];
    return slots.filter((slot) => slot && slot.source === 'octopus-agile-export-autopilot' && (slot.startedAt || slot.reason === 'planner-started')).length;
  }

  persistOctopusAgileOutgoingDailyPlan(plan, now = new Date()) {
    const state = this.loadOctopusAgileOutgoingState();
    const selected = Array.isArray(plan?.selected) ? plan.selected.map((slot) => ({
      start: slot.start instanceof Date ? slot.start.toISOString() : slot.start,
      end: slot.end instanceof Date ? slot.end.toISOString() : slot.end,
      pricePence: slot.pricePence,
      expectedKwh: slot.expectedKwh,
      expectedValuePence: slot.expectedValuePence,
      batteryKw: slot.batteryKw,
      expectedGridExportKw: slot.expectedGridExportKw,
      pvKw: slot.pvKw,
      loadKw: slot.loadKw,
      source: slot.source
    })) : [];
    state.plan = {
      version: '4.0.0-beta.1',
      builtAt: now.toISOString(),
      localDay: this.localDayKey(now),
      mode: 'agile-export-autopilot',
      executionStage: this.getOctopusAgileOutgoingExecutionStage(),
      slotSearchMode: this.getOctopusAgileOutgoingSlotSearchMode(),
      strategy: this.applianceControl.octopusAgileOutgoingStrategy,
      learningMode: this.applianceControl.octopusAgileOutgoingLearningMode,
      saleableKwh: plan?.saleable?.saleableKwh || 0,
      saleableConfidence: plan?.saleable?.confidence || 'unknown',
      thresholdPence: plan?.threshold || 0,
      selected,
      plannedKwh: plan?.plannedKwh || 0,
      plannedValuePence: plan?.plannedValuePence || 0,
      reason: plan?.reason || 'unknown'
    };
    this.octopusAgileOutgoingDailyPlan = state.plan;
    try { this.saveOctopusAgileOutgoingState(state); } catch {}
    return state.plan;
  }

  buildOctopusAgileOutgoingPlan(model, cheapState, rates, now = new Date()) {
    if (this.octopusAgileOutgoingSuspendedReason) return { start: false, reason: `suspended:${this.octopusAgileOutgoingSuspendedReason}` };
    if (!this.octopusAgileOutgoingExportArmed) return { start: false, reason: 'switch-off' };
    if (cheapState.cheapActive || cheapState.smartActive || cheapState.graceActive) return { start: false, reason: `protected-window cheap=${cheapState.cheapActive ? 'yes' : 'no'} smart=${cheapState.smartActive ? 'yes' : 'no'} grace=${cheapState.graceActive ? 'yes' : 'no'}` };
    if (!this.isOctopusAgileOutgoingRunDay(now)) return { start: false, reason: `day-not-enabled day=${this.getOctopusAgileOutgoingDayLabel(now)} daysToRun=${this.formatOctopusAgileOutgoingDaysToRun()} failClosed=yes` };
    if (!Number.isFinite(model.socPercent)) return { start: false, reason: 'soc-unavailable' };
    if (model.active?.batteryCharging) return { start: false, reason: `battery-charging-${Math.round(model.batteryChargePowerW || 0)}W` };

    const state = this.loadOctopusAgileOutgoingState();
    const learning = this.applianceControl.octopusAgileOutgoingLearningMode === 'off' ? {} : (state.learning || {});
    const plan = buildAgileExportAutopilotSlotPlan({
      model,
      learning,
      config: this.applianceControl,
      rates,
      now,
      isRunDay: (date) => this.isOctopusAgileOutgoingRunDay(date),
      isWithinAllowedWindow: (date) => this.isWithinOctopusAgileAllowedWindow(date)
    });
    this.persistOctopusAgileOutgoingDailyPlan(plan, now);

    const selectedTimes = (plan.selected || []).slice(0, 12).map((slot) => `${dateToDisplayHmm(slot.start)}-${dateToDisplayHmm(slot.end)}@${Number(slot.pricePence).toFixed(1)}p/${Number(slot.expectedKwh).toFixed(2)}kWh`).join(',') || 'none';
    const signature = JSON.stringify({ day: this.localDayKey(now), stage: this.getOctopusAgileOutgoingExecutionStage(), strategy: plan.strategy, selected: selectedTimes, saleable: plan.saleable?.saleableKwh, reason: plan.reason });
    const nowMs = Date.now();
    if (signature !== this.octopusAgileOutgoingLastPlannerLogSignature || (nowMs - Number(this.octopusAgileOutgoingLastPlannerLogMs || 0)) > 15 * 60 * 1000) {
      this.octopusAgileOutgoingLastPlannerLogSignature = signature;
      this.octopusAgileOutgoingLastPlannerLogMs = nowMs;
      this.log.warn('GivHome evidence Octopus Agile Export Autopilot plan: mode=slot-trader stage=%s slotSearchMode=%s allowedWindow=%s strategy=%s learningMode=%s saleableKwh=%s confidence=%s thresholdPence=%s candidateSlots=%s selectedSlots=%s selectedLocal=%s plannedKwh=%s plannedValuePence=%s reserveSoc=%s reserveKwh=%s safetyKwh=%s maxGridExportKw=%s dnoLimitBasis=pv-plus-battery-minus-load reason=%s noInverterWrites=%s',
        this.getOctopusAgileOutgoingExecutionStage(),
        this.getOctopusAgileOutgoingSlotSearchMode(),
        this.formatOctopusAgileOutgoingAllowedWindow(),
        plan.strategy,
        this.applianceControl.octopusAgileOutgoingLearningMode,
        Number(plan.saleable?.saleableKwh || 0).toFixed(2),
        plan.saleable?.confidence || 'unknown',
        Number(plan.threshold || 0).toFixed(2),
        plan.candidateCount || 0,
        Array.isArray(plan.selected) ? plan.selected.length : 0,
        selectedTimes,
        Number(plan.plannedKwh || 0).toFixed(2),
        Number(plan.plannedValuePence || 0).toFixed(1),
        plan.saleable?.reserveSoc ?? this.applianceControl.octopusAgileOutgoingReserveSoc,
        Number(plan.saleable?.reserveKwh || 0).toFixed(2),
        Number(plan.saleable?.safetyKwh || 0).toFixed(2),
        this.applianceControl.maxGridExportPowerKw,
        plan.reason || 'unknown',
        this.getOctopusAgileOutgoingExecutionStage() === 'plannerOnly' || !this.isOctopusAgileOutgoingLiveEnabled() ? 'yes' : 'no');
    }

    const currentSelected = findCurrentAgileExportAutopilotSlot(plan, now);
    if (!currentSelected) {
      const next = (plan.selected || []).find((slot) => slot.start > now);
      return { start: false, reason: `waiting-for-selected-slot saleableKwh=${Number(plan.saleable?.saleableKwh || 0).toFixed(2)} selectedSlots=${Array.isArray(plan.selected) ? plan.selected.length : 0} next=${next ? dateToDisplayHmm(next.start) : 'none'} reason=${plan.reason}` };
    }

    const stage = this.getOctopusAgileOutgoingExecutionStage();
    if (stage === 'plannerOnly') {
      return { start: false, reason: `planner-only current-slot-selected ${dateToDisplayHmm(currentSelected.start)}-${dateToDisplayHmm(currentSelected.end)} price=${currentSelected.pricePence}p expectedKwh=${currentSelected.expectedKwh} noInverterWrites=yes` };
    }
    if (!this.isOctopusAgileOutgoingLiveEnabled()) {
      return { start: false, reason: `dry-run/live-gate current-slot-selected ${dateToDisplayHmm(currentSelected.start)}-${dateToDisplayHmm(currentSelected.end)} price=${currentSelected.pricePence}p expectedKwh=${currentSelected.expectedKwh} noInverterWrites=yes` };
    }
    if (stage === 'singleSlot' && this.countOctopusAgileOutgoingExecutedSlots(state) >= 1) {
      return { start: false, reason: 'single-slot-stage-already-used-today failClosed=yes' };
    }

    const reserveSoc = Math.min(95, Math.max(5, Number(plan.saleable?.reserveSoc || this.applianceControl.octopusAgileOutgoingReserveSoc)));
    const powerDecision = this.buildExportPowerDecision({ displayName: 'Octopus Agile Export' }, { label: 'Octopus Agile Export', powerKw: currentSelected.batteryKw, exportFamily: 'octopus-agile-outgoing-export', exportSource: 'octopus-agile-export-autopilot' });
    const minutes = Math.max(1, Math.round((currentSelected.end.getTime() - now.getTime()) / 60000));
    return {
      start: true,
      startDate: now,
      endDate: currentSelected.end,
      minutes,
      reserveSoc,
      reserveKwh: plan.saleable?.reserveKwh || 0,
      safetyKwh: plan.saleable?.safetyKwh || 0,
      availableKwh: plan.saleable?.saleableKwh || 0,
      currentRate: { start: currentSelected.start, end: currentSelected.end, pricePence: currentSelected.pricePence },
      pricePence: Number(currentSelected.pricePence),
      grossMarginPence: Number(currentSelected.pricePence) - Number(this.applianceControl.octopusAgileOutgoingReferenceImportPence || 0),
      powerDecision,
      expectedKwh: Number(currentSelected.expectedKwh || 0),
      expectedValuePence: Number(currentSelected.expectedValuePence || 0),
      selectedCount: Array.isArray(plan.selected) ? plan.selected.length : 0,
      bestPricePence: Math.max(...(plan.selected || [currentSelected]).map((slot) => Number(slot.pricePence) || 0)),
      plan,
      selectedSlot: currentSelected
    };
  }

  logOctopusAgileOutgoingDecision(message, force = false) {
    const nowMs = Date.now();
    if (!force && message === this.lastOctopusAgileOutgoingDecisionSignature && (nowMs - this.lastOctopusAgileOutgoingDecisionLogMs) < 10 * 60 * 1000) return;
    this.lastOctopusAgileOutgoingDecisionSignature = message;
    this.lastOctopusAgileOutgoingDecisionLogMs = nowMs;
    this.log.info('GivHome evidence Octopus Agile Export decision: %s', message);
  }

  async applyOctopusAgileOutgoingAutoExport(model, cheapState, now = new Date()) {
    if (!this.applianceControl.features.octopusAgileOutgoingExport) return false;
    this.updateOctopusAgileOutgoingLearning(model, now);
    await this.maybeAuditOctopusAgileOutgoingMpan(now);
    if (this.activeOctopusAgileOutgoingSlot?.end instanceof Date) {
      await this.monitorOctopusAgileOutgoingExport(model, cheapState, now);
      if (this.activeOctopusAgileOutgoingSlot) return true;
    }
    const rates = await this.fetchOctopusAgileOutgoingRates(false, now);
    if (!rates.length) { this.logOctopusAgileOutgoingDecision('idle: no Agile Outgoing prices available failClosed=yes'); return false; }
    const plan = this.buildOctopusAgileOutgoingPlan(model, cheapState, rates, now);
    if (!plan.start) { this.logOctopusAgileOutgoingDecision(`idle: ${plan.reason}`); return false; }
    this.log.warn('GivHome evidence Octopus Agile Export Autopilot intent: start=%s end=%s minutes=%s pricePence=%s bestPricePence=%s selectedSlots=%s grossMarginPence=%s soc=%s availableKwh=%s reserveKwh=%s reserveSoc=%s safetyKwh=%s exportKw=%s HR112=%s expectedGridExportKw=%s expectedKwh=%s expectedValuePence=%s dryRun=%s willQueue=%s source=octopus-agile-export-autopilot', dateToDisplayHmm(plan.startDate), dateToDisplayHmm(plan.endDate), plan.minutes, plan.pricePence.toFixed(2), plan.bestPricePence.toFixed(2), plan.selectedCount, plan.grossMarginPence.toFixed(2), model.socPercent, plan.availableKwh.toFixed(2), plan.reserveKwh.toFixed(2), plan.reserveSoc, plan.safetyKwh.toFixed(2), plan.powerDecision.estimatedBatteryKw, plan.powerDecision.powerPercent, plan.powerDecision.expectedGridExportKw === null ? 'n/a' : plan.powerDecision.expectedGridExportKw, plan.expectedKwh.toFixed(2), plan.expectedValuePence.toFixed(1), this.applianceControl.octopusAgileOutgoingDryRun ? 'yes' : 'no', this.isOctopusAgileOutgoingLiveEnabled() ? 'yes' : 'no');
    if (!this.isOctopusAgileOutgoingLiveEnabled()) {
      this.logOctopusAgileOutgoingDecision('dry-run/live-gate: plan calculated but inverter writes withheld; set dryRun=false and acknowledgement=ENABLE_AGILE_OUTGOING_LIVE_EXPORT for unattended live export', true);
      return false;
    }
    await this.withManualChargeTransportGate('GivHome Octopus Agile Export Autopilot', async () => {
      await this.startTimedExportCommand({ displayName: 'Octopus Agile Export', minutes: plan.minutes }, { automatic: true, label: 'Octopus Agile Export', startDate: plan.startDate, endDate: plan.endDate, powerKw: plan.powerDecision.estimatedBatteryKw, powerPercent: plan.powerDecision.powerPercent, exportTargetSoc: plan.reserveSoc, exportFamily: 'octopus-agile-outgoing-export', exportSource: 'octopus-agile-export-autopilot' });
    });
    this.activeOctopusAgileOutgoingSlot = { start: plan.startDate, end: plan.endDate, minutes: plan.minutes, profileKind: this.isCeAcCoupledProfile() ? 'ce-ac' : 'ch-aio', powerPercent: plan.powerDecision.powerPercent, powerKw: plan.powerDecision.estimatedBatteryKw, reserveSoc: plan.reserveSoc, reserveKwh: plan.reserveKwh, availableKwh: plan.availableKwh, pricePence: plan.pricePence, expectedKwh: Number(plan.expectedKwh.toFixed(4)), expectedValuePence: Number(plan.expectedValuePence.toFixed(2)), observedInverterKwh: 0, source: 'octopus-agile-export-autopilot' };
    this.octopusAgileOutgoingExportActive = true;
    this.octopusAgileOutgoingObservedExportKwh = 0;
    this.octopusAgileOutgoingLastObservedAtMs = Date.now();
    this.persistOctopusAgileOutgoingMemory(this.activeOctopusAgileOutgoingSlot, 'planner-started');
    this.scheduleApplianceCommandCleanup(COMMAND_KINDS.OCTOPUS_AGILE_OUTGOING_EXPORT, 'export', plan.minutes);
    this.log.warn('GivHome evidence Octopus Agile Export Autopilot command queued: start=%s end=%s minutes=%s pricePence=%s reserveSoc=%s reserveKwh=%s expectedKwh=%s expectedValuePence=%s memorySaved=yes mpanAuditPending=%s automaticMutationPath=%s', dateToHmm(plan.startDate), dateToHmm(plan.endDate), plan.minutes, plan.pricePence.toFixed(2), plan.reserveSoc, plan.reserveKwh.toFixed(2), plan.expectedKwh.toFixed(2), plan.expectedValuePence.toFixed(1), this.applianceControl.octopusAgileOutgoingEnableMpanAudit ? 'yes' : 'no', this.applianceControl.automaticMutationPath);
    return true;
  }

  async monitorOctopusAgileOutgoingExport(model, cheapState, now = new Date()) {
    const slot = this.activeOctopusAgileOutgoingSlot;
    if (!slot) return false;
    this.recordOctopusAgileOutgoingObservedExport(model, now);
    const soc = Number(model?.socPercent);
    const gridExportW = Number.isFinite(Number(model?.gridExportPowerW)) ? Number(model.gridExportPowerW) : 0;
    const batteryDischargeW = Number.isFinite(Number(model?.batteryDischargePowerW)) ? Number(model.batteryDischargePowerW) : 0;
    const ageMinutes = Math.max(0, (now.getTime() - slot.start.getTime()) / 60000);
    let stopReason = '';
    if (!this.isOctopusAgileOutgoingRunDay(now)) stopReason = `configured no-run day ${this.getOctopusAgileOutgoingDayLabel(now)}`;
    else if (cheapState.cheapActive || cheapState.smartActive || cheapState.graceActive) stopReason = 'protected cheap/smart/grace window began';
    else if (slot.end instanceof Date && now >= slot.end) stopReason = 'Agile Outgoing slot ended';
    else if (Number.isFinite(soc) && soc <= Number(slot.reserveSoc || this.applianceControl.octopusAgileOutgoingReserveSoc)) stopReason = `reserve reached soc=${soc}`;
    else if (ageMinutes >= 3 && gridExportW < 250 && batteryDischargeW < 250) stopReason = `physical export not detected gridExportW=${Math.round(gridExportW)} batteryDischargeW=${Math.round(batteryDischargeW)}`;

    this.logOctopusAgileOutgoingDecision(`active: ${dateToDisplayHmm(slot.start)}-${dateToDisplayHmm(slot.end)} price=${slot.pricePence}p observedInverterKwh=${this.octopusAgileOutgoingObservedExportKwh.toFixed(3)} gridExportW=${Math.round(gridExportW)} batteryDischargeW=${Math.round(batteryDischargeW)} soc=${Number.isFinite(soc) ? soc : 'unknown'}`, false);
    if (!stopReason) return true;

    this.log.warn('GivHome evidence Octopus Agile Export stop queued: reason=%s observedInverterKwh=%s expectedKwh=%s pricePence=%s automaticMutationPath=%s', stopReason, this.octopusAgileOutgoingObservedExportKwh.toFixed(3), Number(slot.expectedKwh || 0).toFixed(3), slot.pricePence, this.applianceControl.automaticMutationPath);
    await this.cleanupApplianceCommandFamily('export', `Octopus Agile Export ${stopReason}`);
    return true;
  }

  recordOctopusAgileOutgoingObservedExport(model, now = new Date()) {
    const slot = this.activeOctopusAgileOutgoingSlot;
    if (!slot) return;
    const nowMs = now.getTime();
    if (!this.octopusAgileOutgoingLastObservedAtMs) {
      this.octopusAgileOutgoingLastObservedAtMs = nowMs;
      return;
    }
    const elapsedHours = Math.max(0, Math.min(5 * 60, (nowMs - this.octopusAgileOutgoingLastObservedAtMs) / 1000)) / 3600;
    this.octopusAgileOutgoingLastObservedAtMs = nowMs;
    const gridExportW = Number.isFinite(Number(model?.gridExportPowerW)) ? Math.max(0, Number(model.gridExportPowerW)) : 0;
    const addKwh = (gridExportW / 1000) * elapsedHours;
    this.octopusAgileOutgoingObservedExportKwh = Number((this.octopusAgileOutgoingObservedExportKwh + addKwh).toFixed(6));
    slot.observedInverterKwh = this.octopusAgileOutgoingObservedExportKwh;
    const state = this.loadOctopusAgileOutgoingState();
    state.daily.observedInverterKwh = Number((Number(state.daily.observedInverterKwh || 0) + addKwh).toFixed(6));
    if (state.activeSlot) state.activeSlot.observedInverterKwh = slot.observedInverterKwh;
    for (const candidate of state.slots || []) {
      if (candidate.start === slot.start.toISOString() && candidate.end === slot.end.toISOString()) candidate.observedInverterKwh = slot.observedInverterKwh;
    }
    try { this.saveOctopusAgileOutgoingState(state); } catch {}
  }

  async maybeAuditOctopusAgileOutgoingMpan(now = new Date()) {
    if (!this.applianceControl.features.octopusAgileOutgoingExport) return;
    if (!this.applianceControl.octopusAgileOutgoingEnableMpanAudit) return;
    if (!this.applianceControl.octopusApiKey || !this.applianceControl.octopusExportMpan || !this.applianceControl.octopusExportMeterSerial) {
      this.logOctopusAgileOutgoingDecision('mpan-audit: waiting for Octopus API key, export MPAN and export meter serial', false);
      return;
    }
    if (Date.now() - this.octopusAgileOutgoingLastAuditMs < 60 * 60 * 1000) return;
    this.octopusAgileOutgoingLastAuditMs = Date.now();
    const state = this.loadOctopusAgileOutgoingState();
    const delayMs = this.applianceControl.octopusAgileOutgoingMpanAuditDelayHours * 60 * 60 * 1000;
    const pending = (state.slots || []).filter((slot) => slot.mpanAuditStatus !== 'matched' && slot.mpanAuditStatus !== 'mismatch' && slot.end && now.getTime() - new Date(slot.end).getTime() >= delayMs);
    if (!pending.length) return;
    for (const slot of pending.slice(0, 3)) {
      try {
        const from = new Date(slot.start);
        const to = new Date(slot.end);
        const octopusKwh = await this.fetchOctopusExportMpanKwh(from, to);
        const inverterKwh = Number(slot.observedInverterKwh || 0);
        const difference = Math.abs(octopusKwh - inverterKwh);
        slot.octopusMpanKwh = Number(octopusKwh.toFixed(4));
        slot.mpanAuditAt = now.toISOString();
        slot.mpanAuditStatus = difference <= this.applianceControl.octopusAgileOutgoingMpanMismatchToleranceKwh ? 'matched' : 'mismatch';
        this.log.warn('GivHome evidence Octopus Agile Export MPAN audit: start=%s end=%s inverterKwh=%s octopusExportMpanKwh=%s differenceKwh=%s toleranceKwh=%s status=%s source=octopus-export-mpan-consumption-api', dateToDisplayHmm(from), dateToDisplayHmm(to), inverterKwh.toFixed(3), octopusKwh.toFixed(3), difference.toFixed(3), this.applianceControl.octopusAgileOutgoingMpanMismatchToleranceKwh, slot.mpanAuditStatus);
        if (slot.mpanAuditStatus === 'mismatch' && this.applianceControl.octopusAgileOutgoingSuspendOnMpanMismatch) {
          this.octopusAgileOutgoingSuspendedReason = `mpan-mismatch-${from.toISOString()}`;
          this.octopusAgileOutgoingExportArmed = false;
          state.suspendedReason = this.octopusAgileOutgoingSuspendedReason;
          this.setApplianceCommandState(COMMAND_KINDS.OCTOPUS_AGILE_OUTGOING_EXPORT, false);
          this.log.warn('GivHome evidence Octopus Agile Export suspended: reason=%s action=disarmed failClosed=yes', this.octopusAgileOutgoingSuspendedReason);
        }
      } catch (err) {
        slot.mpanAuditStatus = 'deferred';
        slot.mpanAuditError = err && err.message ? err.message : String(err);
        this.log.warn('GivHome evidence Octopus Agile Export MPAN audit deferred: start=%s end=%s error=%s retryLater=yes', slot.start, slot.end, slot.mpanAuditError);
      }
    }
    this.saveOctopusAgileOutgoingState(state);
  }

  async fetchOctopusExportMpanKwh(periodFrom, periodTo) {
    const mpan = encodeURIComponent(this.applianceControl.octopusExportMpan);
    const serial = encodeURIComponent(this.applianceControl.octopusExportMeterSerial);
    const from = encodeURIComponent(periodFrom.toISOString());
    const to = encodeURIComponent(periodTo.toISOString());
    const url = `https://api.octopus.energy/v1/electricity-meter-points/${mpan}/meters/${serial}/consumption/?period_from=${from}&period_to=${to}&page_size=250`;
    const auth = Buffer.from(`${this.applianceControl.octopusApiKey}:`).toString('base64');
    const response = await fetch(url, { headers: { Accept: 'application/json', Authorization: `Basic ${auth}` } });
    if (!response.ok) throw new Error(`Octopus export MPAN consumption HTTP ${response.status}`);
    const body = await response.json();
    const rows = Array.isArray(body?.results) ? body.results : [];
    return rows.reduce((sum, row) => sum + (Number.isFinite(Number(row.consumption)) ? Number(row.consumption) : 0), 0);
  }


  logOctopusFluxExportDecision(message, force = false) {
    const nowMs = Date.now();
    if (!force && message === this.lastOctopusFluxExportDecisionSignature && (nowMs - this.lastOctopusFluxExportDecisionLogMs) < 10 * 60 * 1000) return;
    this.lastOctopusFluxExportDecisionSignature = message;
    this.lastOctopusFluxExportDecisionLogMs = nowMs;
    this.log.info('GivHome evidence Octopus Flux Export decision: %s', message);
  }

  getOctopusFluxEffectivePlanningPowerKw(model, powerDecision = {}) {
    const requestedKw = Math.max(0.1, Number(powerDecision.estimatedBatteryKw || this.applianceControl.octopusFluxExportPowerKw || 4));
    const maxBatteryExportKw = Math.max(requestedKw, Number(this.applianceControl.maxBatteryExportPowerKw || requestedKw));
    const observedDischargeKw = Number.isFinite(Number(model?.batteryDischargePowerW)) ? Math.max(0, Number(model.batteryDischargePowerW) / 1000) : 0;
    const observedExportKw = Number.isFinite(Number(model?.gridExportPowerW)) ? Math.max(0, Number(model.gridExportPowerW) / 1000) : 0;
    const route = this.isCeAcCoupledProfile() ? 'ce-ac' : 'ch-aio';
    const observedOverRequest = observedDischargeKw > requestedKw + 0.5 || observedExportKw > requestedKw + 0.5;
    const useObservedFullPower = route === 'ch-aio';
    const observedCandidate = observedOverRequest ? observedDischargeKw : 0;
    const effectivePlanningKw = useObservedFullPower
      ? Math.max(requestedKw, observedCandidate, maxBatteryExportKw)
      : requestedKw;
    return {
      route,
      requestedKw,
      observedDischargeKw,
      observedExportKw,
      effectivePlanningKw: Math.max(0.1, effectivePlanningKw),
      powerRatioAuthority: useObservedFullPower ? 'HR112-write-readback-observed-not-live-cap-for-CH-AIO-slot-export' : 'HR112-write-readback-live-cap-assumed-for-non-CH-AIO',
      hr112Obeyed: !observedOverRequest
    };
  }

  recordOctopusFluxExportObservedEnergy(model, now = new Date()) {
    const slot = this.activeOctopusFluxExportSlot || {};
    const effective = this.getOctopusFluxEffectivePlanningPowerKw(model, { estimatedBatteryKw: Number(slot.requestedPowerKw || slot.powerKw || this.applianceControl.octopusFluxExportPowerKw), powerPercent: slot.powerPercent });
    const nowMs = now.getTime();
    if (!this.octopusFluxExportLastObservedAtMs) {
      this.octopusFluxExportLastObservedAtMs = nowMs;
      return { observedBatteryKwh: this.octopusFluxExportObservedBatteryKwh, observedGridKwh: this.octopusFluxExportObservedGridKwh, ...effective };
    }
    const elapsedHours = Math.max(0, Math.min(5 * 60, (nowMs - this.octopusFluxExportLastObservedAtMs) / 1000)) / 3600;
    this.octopusFluxExportLastObservedAtMs = nowMs;
    const batteryDischargeW = Number.isFinite(Number(model?.batteryDischargePowerW)) ? Math.max(0, Number(model.batteryDischargePowerW)) : 0;
    const gridExportW = Number.isFinite(Number(model?.gridExportPowerW)) ? Math.max(0, Number(model.gridExportPowerW)) : 0;
    this.octopusFluxExportObservedBatteryKwh = Number((this.octopusFluxExportObservedBatteryKwh + (batteryDischargeW / 1000) * elapsedHours).toFixed(6));
    this.octopusFluxExportObservedGridKwh = Number((this.octopusFluxExportObservedGridKwh + (gridExportW / 1000) * elapsedHours).toFixed(6));
    if (this.activeOctopusFluxExportSlot) {
      this.activeOctopusFluxExportSlot.observedBatteryKwh = this.octopusFluxExportObservedBatteryKwh;
      this.activeOctopusFluxExportSlot.observedGridKwh = this.octopusFluxExportObservedGridKwh;
      try { this.persistOctopusFluxExportMemory(this.activeOctopusFluxExportSlot, 'observed-running'); } catch {}
    }
    const nowLog = Date.now();
    if (!effective.hr112Obeyed && nowLog - this.lastOctopusFluxObservedPowerLogMs > 5 * 60 * 1000) {
      this.lastOctopusFluxObservedPowerLogMs = nowLog;
      this.log.warn('GivHome evidence Octopus Flux Export HR112 observed ratio: requestedKw=%s HR112=%s observedBatteryDischargeKw=%s observedGridExportKw=%s effectivePlanningKw=%s HR112PowerRatioObeyed=no action=budget-by-observed-power source=octopus-flux-peak-planner', effective.requestedKw.toFixed(1), slot.powerPercent || 'unknown', effective.observedDischargeKw.toFixed(1), effective.observedExportKw.toFixed(1), effective.effectivePlanningKw.toFixed(1));
    }
    return { observedBatteryKwh: this.octopusFluxExportObservedBatteryKwh, observedGridKwh: this.octopusFluxExportObservedGridKwh, ...effective };
  }

  evaluateOctopusFluxExport(model, cheapState, now = new Date()) {
    if (!this.applianceControl.features.octopusFluxExport) return null;
    if (!this.octopusFluxExportArmed) { this.logOctopusFluxExportDecision('idle: Octopus Flux Export switch is off'); return null; }
    if (!Number.isFinite(this.applianceControl.batteryCapacityKwh) || this.applianceControl.batteryCapacityKwh <= 0) { this.logOctopusFluxExportDecision('idle: Battery Capacity is missing or invalid'); return null; }
    if (cheapState.cheapActive || cheapState.smartActive || cheapState.graceActive) { this.logOctopusFluxExportDecision(`idle: protected cheap/smart window active cheap=${cheapState.cheapActive ? 'true' : 'false'} smart=${cheapState.smartActive ? 'true' : 'false'} grace=${cheapState.graceActive ? 'true' : 'false'}`); return null; }
    if (!this.isOctopusFluxRunDay(now)) { this.logOctopusFluxExportDecision(`idle: day-not-enabled day=${this.getOctopusAgileOutgoingDayLabel(now)} daysToRun=${this.formatOctopusFluxDaysToRun()} failClosed=yes`); return null; }
    if (!Number.isFinite(model.socPercent)) { this.logOctopusFluxExportDecision('idle: SOC unavailable'); return null; }
    if (model.active?.batteryCharging) { this.logOctopusFluxExportDecision(`idle: battery is currently charging (${Math.round(model.batteryChargePowerW || 0)}W)`); return null; }

    const fluxWindow = getMergedCheapState(now, [], { cheapStart: this.applianceControl.octopusFluxExportStartTime, cheapEnd: this.applianceControl.octopusFluxExportEndTime, graceMinutes: 0 }, {});
    if (!fluxWindow.fallbackActive || !(fluxWindow.cheapWindowEnd instanceof Date)) { this.logOctopusFluxExportDecision(`idle: outside Octopus Flux eligible peak period ${this.applianceControl.octopusFluxExportStartTime}-${this.applianceControl.octopusFluxExportEndTime}`); return null; }
    const peakEnd = fluxWindow.cheapWindowEnd;
    const minutesUntilPeakEnd = Math.max(0, Math.floor((peakEnd.getTime() - now.getTime()) / 60000));
    if (minutesUntilPeakEnd < 5) { this.logOctopusFluxExportDecision('idle: too close to Octopus Flux peak export window end'); return null; }

    const memoryActive = Boolean(this.activeOctopusFluxExportSlot?.start instanceof Date && this.activeOctopusFluxExportSlot?.end instanceof Date && now >= this.activeOctopusFluxExportSlot.start && now < this.activeOctopusFluxExportSlot.end && this.activeOctopusFluxExportSlot.end <= peakEnd);
    if (memoryActive) {
      const observed = this.recordOctopusFluxExportObservedEnergy(model, now);
      const expected = Number(this.activeOctopusFluxExportSlot.expectedBatteryKwh || 0);
      const reserveFloorSoc = Math.min(95, Number(this.activeOctopusFluxExportSlot.reserveSoc || this.applianceControl.octopusFluxReserveSoc) + Number(this.applianceControl.octopusFluxSafetyMarginSoc || 0));
      const stopByEnergy = expected > 0 && observed.observedBatteryKwh >= Math.max(0.05, expected * 0.98);
      const stopByReserve = Number.isFinite(Number(model.socPercent)) && Number(model.socPercent) <= reserveFloorSoc;
      this.logOctopusFluxExportDecision(`active: retained existing Octopus Flux Export slot ${dateToHmm(this.activeOctopusFluxExportSlot.start)}-${dateToHmm(this.activeOctopusFluxExportSlot.end)} observedBatteryKwh=${observed.observedBatteryKwh.toFixed(3)} expectedBatteryKwh=${expected ? expected.toFixed(3) : 'n/a'} effectivePlanningKw=${observed.effectivePlanningKw.toFixed(1)} requestedKw=${observed.requestedKw.toFixed(1)} HR112PowerRatioObeyed=${observed.hr112Obeyed ? 'yes' : 'no'}`, true);
      if (stopByEnergy || stopByReserve) {
        return { stopReason: stopByEnergy ? 'observed-energy-budget-reached' : 'reserve-floor-reached', observed };
      }
      return null;
    }
    if (this.activeOctopusFluxExportSlot?.end instanceof Date && now >= this.activeOctopusFluxExportSlot.end) this.clearOctopusFluxExportMemory();

    const batteryCapacityKwh = Number(this.applianceControl.batteryCapacityKwh);
    const socEnergyKwh = (Number(model.socPercent) / 100) * batteryCapacityKwh;
    const reserveFromSocKwh = (this.applianceControl.octopusFluxReserveSoc / 100) * batteryCapacityKwh;
    const reserveKwh = Math.max(reserveFromSocKwh, this.applianceControl.octopusFluxEveningReserveKwh);
    const reserveSoc = Math.min(95, Math.max(this.applianceControl.octopusFluxReserveSoc, Math.ceil((reserveKwh / batteryCapacityKwh) * 100)));
    const safetyKwh = (this.applianceControl.octopusFluxSafetyMarginSoc / 100) * batteryCapacityKwh;
    const availableKwh = Math.max(0, socEnergyKwh - reserveKwh - safetyKwh);
    const slotMinutes = Math.min(this.applianceControl.octopusFluxSlotMinutes, minutesUntilPeakEnd);
    const powerDecision = this.buildExportPowerDecision({ displayName: 'Octopus Flux Export' }, { label: 'Octopus Flux Export', powerKw: this.applianceControl.octopusFluxExportPowerKw, powerPercent: this.applianceControl.octopusFluxExportPowerPercent, exportFamily: 'octopus-flux-export', exportSource: 'octopus-flux-peak-planner' });
    const requestedKw = Math.max(0.1, Number(powerDecision.estimatedBatteryKw || this.applianceControl.octopusFluxExportPowerKw));
    const effective = this.getOctopusFluxEffectivePlanningPowerKw(model, powerDecision);
    const effectivePlanningKw = effective.effectivePlanningKw;
    const exportKwhThisSlot = effectivePlanningKw * (slotMinutes / 60);
    const minExportKwh = Math.max(this.applianceControl.octopusFluxMinimumExportKwh, Math.min(0.5, exportKwhThisSlot));

    if (availableKwh < minExportKwh) { this.logOctopusFluxExportDecision(`idle: available ${availableKwh.toFixed(2)}kWh below minimum ${minExportKwh.toFixed(2)}kWh after reserve ${reserveKwh.toFixed(2)}kWh and margin ${safetyKwh.toFixed(2)}kWh`); return null; }

    const end = addMinutes(now, Math.max(1, Math.min(slotMinutes, Math.floor((availableKwh / effectivePlanningKw) * 60))));
    if (end > peakEnd) end.setTime(peakEnd.getTime());
    const minutes = Math.max(1, Math.round((end.getTime() - now.getTime()) / 60000));
    const pvTodayRaw = model?.counters?.pvGenerationTodayRaw;
    const selectedSlotKwh = effectivePlanningKw * (minutes / 60);
    const fullBandMinutes = clockWindowDurationMinutes(this.applianceControl.octopusFluxExportStartTime, this.applianceControl.octopusFluxExportEndTime);
    const fullBandKwhAtRequestedPower = Number.isFinite(fullBandMinutes) ? (requestedKw * (fullBandMinutes / 60)).toFixed(2) : 'n/a';
    const fullBandKwhAtEffectivePower = Number.isFinite(fullBandMinutes) ? (effectivePlanningKw * (fullBandMinutes / 60)).toFixed(2) : 'n/a';
    this.log.warn('GivHome evidence Octopus Flux Export intent: eligiblePeakWindow=%s-%s selectedWindow=%s-%s plannedMinutes=%s mode=fixed-peak-window daysToRun=%s soc=%s availableKwh=%s fullBandKwhAtRequestedPower=%s fullBandKwhAtEffectivePower=%s plannedSlotKwh=%s energyBudgetBasis=observed-effective-power-not-HR112-assumption reserveKwh=%s reserveSoc=%s marginSoc=%s batteryCapacityKwh=%s maxPvKw=%s pvNowW=%s pvTodayRaw=%s requestedExportKw=%s effectivePlanningKw=%s powerRatioRegister=HR112 powerRatioValue=%s powerRatioAuthority=%s HR112PowerRatioObeyed=%s expectedGridExportKw=%s source=octopus-flux-peak-planner willQueue=yes', this.applianceControl.octopusFluxExportStartTime, this.applianceControl.octopusFluxExportEndTime, dateToHmm(now), dateToHmm(end), minutes, this.formatOctopusFluxDaysToRun(), model.socPercent, availableKwh.toFixed(2), fullBandKwhAtRequestedPower, fullBandKwhAtEffectivePower, selectedSlotKwh.toFixed(2), reserveKwh.toFixed(2), reserveSoc, this.applianceControl.octopusFluxSafetyMarginSoc, batteryCapacityKwh, this.maxPvKw || 'n/a', Number.isFinite(model.pvPowerW) ? Math.round(model.pvPowerW) : 'n/a', Number.isFinite(Number(pvTodayRaw)) ? pvTodayRaw : 'n/a', requestedKw.toFixed(1), effectivePlanningKw.toFixed(1), powerDecision.powerPercent, effective.powerRatioAuthority, effective.hr112Obeyed ? 'yes' : 'no', powerDecision.expectedGridExportKw === null ? 'n/a' : powerDecision.expectedGridExportKw);
    return { start: now, end, minutes, reserveSoc, reserveKwh, availableKwh, powerDecision, requestedPowerKw: requestedKw, effectivePlanningKw, expectedBatteryKwh: selectedSlotKwh, powerRatioAuthority: effective.powerRatioAuthority };
  }

  logEveningExcessExportDecision(message, force = false) {
    const nowMs = Date.now();
    if (!force && message === this.lastExcessExportDecisionSignature && (nowMs - this.lastExcessExportDecisionLogMs) < 10 * 60 * 1000) return;
    this.lastExcessExportDecisionSignature = message;
    this.lastExcessExportDecisionLogMs = nowMs;
    this.log.info('GivHome evidence Evening Excess Export decision: %s', message);
  }

  evaluateEveningExcessExport(model, cheapState, now = new Date()) {
    if (!this.applianceControl.features.eveningExcessExport) {
      return null;
    }
    if (!this.eveningExcessExportArmed) {
      this.logEveningExcessExportDecision('idle: Evening Excess Export switch is off');
      return null;
    }
    if (!Number.isFinite(this.applianceControl.batteryCapacityKwh) || this.applianceControl.batteryCapacityKwh <= 0) {
      this.logEveningExcessExportDecision('idle: Battery Capacity is missing or invalid');
      return null;
    }
    if (cheapState.cheapActive || cheapState.smartActive || cheapState.graceActive) {
      this.logEveningExcessExportDecision(`idle: protected cheap/smart window active cheap=${cheapState.cheapActive ? 'true' : 'false'} smart=${cheapState.smartActive ? 'true' : 'false'} grace=${cheapState.graceActive ? 'true' : 'false'}`);
      return null;
    }
    if (!Number.isFinite(model.socPercent)) {
      this.logEveningExcessExportDecision('idle: SOC unavailable');
      return null;
    }
    if (model.active?.batteryCharging) {
      this.logEveningExcessExportDecision(`idle: battery is currently charging (${Math.round(model.batteryChargePowerW || 0)}W)`);
      return null;
    }

    const startWindow = getMergedCheapState(now, [], { cheapStart: this.applianceControl.eveningExportStartTime, cheapEnd: this.applianceControl.cheapStart, graceMinutes: 0 }, {});
    if (!startWindow.cheapActive) {
      this.logEveningExcessExportDecision(`idle: outside evening sell-off window ${this.applianceControl.eveningExportStartTime}-${this.applianceControl.cheapStart}`);
      return null;
    }
    const cheapStart = startWindow.cheapWindowEnd;
    if (!(cheapStart instanceof Date)) {
      this.logEveningExcessExportDecision('idle: invalid Evening Excess Export time configuration');
      return null;
    }
    const minutesUntilCheap = Math.max(0, Math.floor((cheapStart.getTime() - now.getTime()) / 60000));
    if (minutesUntilCheap < 5) {
      this.logEveningExcessExportDecision('idle: too close to cheap window start');
      return null;
    }

    const memoryActive = Boolean(this.activeExcessExportSlot?.start instanceof Date && this.activeExcessExportSlot?.end instanceof Date && now >= this.activeExcessExportSlot.start && now < this.activeExcessExportSlot.end && this.activeExcessExportSlot.end <= cheapStart);
    if (memoryActive) {
      this.logEveningExcessExportDecision(`active: retained existing Evening Excess Export slot ${dateToHmm(this.activeExcessExportSlot.start)}-${dateToHmm(this.activeExcessExportSlot.end)}`, true);
      return null;
    }

    const slotMinutes = Math.min(this.applianceControl.eveningExportSlotMinutes, minutesUntilCheap);
    const kwhPerSlot = this.applianceControl.eveningExportPowerKw * (this.applianceControl.eveningExportSlotMinutes / 60);
    const socDropPerSlot = (kwhPerSlot / this.applianceControl.batteryCapacityKwh) * 100;
    const slotsRemaining = Math.max(1, Math.ceil(minutesUntilCheap / this.applianceControl.eveningExportSlotMinutes));
    const minSocTarget = this.applianceControl.eveningExportReserveSoc + ((slotsRemaining - 1) * socDropPerSlot);
    const triggerSoc = minSocTarget + this.applianceControl.eveningExportMarginSoc;

    if (minSocTarget >= 100) {
      this.logEveningExcessExportDecision(`idle: ladder reserve above 100% this early in window target=${minSocTarget.toFixed(1)}% minsUntilCheap=${minutesUntilCheap}`);
      return null;
    }
    if (model.socPercent <= triggerSoc) {
      this.logEveningExcessExportDecision(`idle: SOC ${Number(model.socPercent).toFixed(1)}% <= trigger ${triggerSoc.toFixed(1)}% (reserve ladder ${minSocTarget.toFixed(1)}%)`);
      return null;
    }

    const end = addMinutes(now, slotMinutes);
    if (end > cheapStart) end.setTime(cheapStart.getTime());
    this.log.warn('GivHome evidence Evening Excess Export intent: %s-%s soc=%s trigger=%s reserve=%s ladder=%s slotsRemaining=%s powerPercent=%s powerKw=%s configSection=yes willQueue=yes', dateToHmm(now), dateToHmm(end), model.socPercent, triggerSoc.toFixed(1), this.applianceControl.eveningExportReserveSoc, minSocTarget.toFixed(1), slotsRemaining, this.applianceControl.eveningExportPowerPercent, Number.isFinite(this.applianceControl.eveningExportPowerKw) ? this.applianceControl.eveningExportPowerKw : 'n/a');
    return { start: now, end, minutes: Math.max(1, Math.round((end.getTime() - now.getTime()) / 60000)), minSocTarget, triggerSoc, slotsRemaining };
  }

  eveHistoryStatePath() {
    const base = safeStorageName(this.inverterSerial || 'pending');
    return `${process.cwd()}/givhome_modbus_${base}_eve_history_totals.json`;
  }

  async recordEveHistory(force = false) {
    if (!this.applianceControl.features.eveHistory || !this.latestModel || this.health.state !== 'online') return;
    const now = Date.now();
    const modelAgeMs = this.latestModel.lastUpdatedISO ? now - new Date(this.latestModel.lastUpdatedISO).getTime() : 0;
    const maxAgeMs = Math.max(this.pollIntervalSeconds * 3 * 1000, this.applianceControl.eveHistorySampleMinutes * 60000);
    if (Number.isFinite(modelAgeMs) && modelAgeMs > maxAgeMs) {
      this.log.warn('GivHome evidence Eve history skipped: stale-telemetry ageSeconds=%s staleSamplesNotRecorded=yes', Math.round(modelAgeMs / 1000));
      return;
    }
    const minMs = this.applianceControl.eveHistorySampleMinutes * 60000;
    if (!force && now - this.eveHistoryLastRecordMs < minMs) return;
    const statePath = this.eveHistoryStatePath();
    const state = loadJson(statePath, { version: '1.0.0', totals: {}, updatedAt: null, resetTotalWritesIgnored: true });
    const elapsedHours = this.eveHistoryLastRecordMs > 0 ? Math.max(0, (now - this.eveHistoryLastRecordMs) / 3600000) : 0;
    const entries = [
      { kind: 'solar', power: Math.max(0, this.latestModel.pvPowerW || 0) },
      { kind: 'import', power: Math.max(0, this.latestModel.gridImportPowerW || 0) },
      { kind: 'export', power: Math.max(0, this.latestModel.gridExportPowerW || 0) }
    ];
    for (const entry of entries) {
      const previous = Number(state.totals[entry.kind] || 0);
      const next = previous + (elapsedHours > 0 ? (entry.power * elapsedHours / 1000) : 0);
      state.totals[entry.kind] = Number(next.toFixed(6));
      const history = this.eveHistoryServices.get(entry.kind);
      if (history && typeof history.addEntry === 'function') {
        try { history.addEntry({ time: Math.round(now / 1000), power: Math.round(entry.power), totalConsumption: Number(next.toFixed(3)) }); } catch (err) { this.log.warn('Eve history addEntry failed: kind=%s error=%s', entry.kind, err && err.message ? err.message : String(err)); }
      }
    }
    state.updatedAt = new Date(now).toISOString();
    saveJson(statePath, state);
    this.eveHistoryLastRecordMs = now;
    this.log.warn('GivHome evidence Eve history recorded: solar=%sW import=%sW export=%sW localTotalsPersisted=yes resetTotalWritesIgnored=yes activeStateFlickerSuppressed=yes fakegato=%s', Math.round(entries[0].power), Math.round(entries[1].power), Math.round(entries[2].power), this.fakeGatoHistoryService ? 'yes' : 'not-available');
  }

  configureAccessoryServices(accessory, definition) {
    const info = accessory.getService(this.Service.AccessoryInformation) || accessory.addService(this.Service.AccessoryInformation);
    info
      .setCharacteristic(this.Characteristic.Manufacturer, 'Kernowek Consulting')
      .setCharacteristic(this.Characteristic.Model, 'GivHome Direct Modbus')
      .setCharacteristic(this.Characteristic.SerialNumber, this.inverterSerial || 'unconfirmed')
      .setCharacteristic(this.Characteristic.FirmwareRevision, '1.0.0');

    // Evidence rebase: energy/status tiles use Lightbulb, matching the original
    // Homebridge plugin UX. Remove the Stage 2/5 OccupancySensor/Battery/Temperature
    // surfaces if they exist on a reused cached accessory.
    for (const legacy of [
      accessory.getService(this.Service.OccupancySensor),
      accessory.getService(this.Service.Battery),
      accessory.getService(this.Service.TemperatureSensor)
    ]) {
      if (legacy) accessory.removeService(legacy);
    }

    const service = accessory.getServiceById(this.Service.Lightbulb, definition.subtype)
      || accessory.addService(this.Service.Lightbulb, definition.displayName, definition.subtype);
    service.setCharacteristic(this.Characteristic.Name, definition.displayName);

    service.getCharacteristic(this.Characteristic.On)
      .onSet(async () => {});

    if (definition.brightnessKind) {
      service.getCharacteristic(this.Characteristic.Brightness)
        .onSet(async () => {});
    }
  }



  startManualChargeSupervisor() {
    if (!this.manualChargeSupervisorStatus.monitorEnabled) return;
    if (this.manualChargeSupervisorTimer) return;

    const intervalMs = this.manualChargeSupervisorStatus.pollSeconds * 1000;
    this.log.warn('Manual Charge always-on supervisor started: pollSeconds=%s liveRepairEnabled=%s graceMinutes=%s automaticMutationPath=%s', this.manualChargeSupervisorStatus.pollSeconds, this.manualChargeSupervisorStatus.liveRepairEnabled ? 'yes' : 'no', this.manualChargeSupervisorStatus.graceMinutes, this.manualChargeSupervisorStatus.automaticMutationPath);
    this.manualChargeSupervisorTimer = setInterval(() => {
      this.runManualChargeExpiredSlotSupervisorOnce('timer').catch((err) => {
        this.log.warn('Manual Charge always-on supervisor failed: %s', err && err.message ? err.message : String(err));
      });
    }, intervalMs);
  }

  async runManualChargeExpiredSlotSupervisorOnce(reason) {
    if (this.manualChargeSupervisorInFlight) return;
    if (this.commandTransportInFlight || this.pollInFlight || this.capabilityDiscoveryInFlight) return;

    this.manualChargeSupervisorInFlight = true;
    try {
      const registers = await this.readManualChargeCoreWithRetry(`supervisor-${reason}-snapshot`, 1);
      const evaluation = evaluateManualChargeExpiredSlot(registers, {
        graceMinutes: this.manualChargeSupervisorStatus.graceMinutes
      });

      if (this.advancedDiagnostics || evaluation.stopRequired) {
        this.log.warn('%s trigger=%s liveRepairEnabled=%s', renderManualChargeSupervisorEvaluationLine(evaluation), reason, this.manualChargeSupervisorStatus.liveRepairEnabled ? 'yes' : 'no');
      }

      if (!evaluation.stopRequired) return;

      if (!this.manualChargeSupervisorStatus.liveRepairEnabled) {
        this.log.warn('Manual Charge always-on supervisor repair suppressed: stopRequired=yes liveRepairEnabled=no automaticMutationPath=absent');
        return;
      }

      await this.withManualChargeTransportGate('Manual Charge always-on expired-slot failsafe', async () => {
        this.log.warn('Manual Charge always-on supervisor repair executing: reason=%s restoreFirst=HR96 automaticMutationPath=explicit-expired-manual-charge-failsafe', evaluation.reason);
        await this.disableManualChargeEnableWithRetries('expired-slot-failsafe');
        this.setManualChargeHomeKitState(false);
        this.log.warn('Manual Charge always-on supervisor repair complete: HR96 disabled automaticMutationPath=explicit-expired-manual-charge-failsafe');
      });
    } finally {
      this.manualChargeSupervisorInFlight = false;
    }
  }

  async runStage3CapabilityDiscovery() {
    if (this.capabilityDiscoveryInFlight || this.capabilityDiscoveryComplete) return;
    if (this.commandIntentPending || this.commandTransportInFlight) {
      this.log.warn('GivHome evidence capability discovery deferred/skipped because a command intent is pending: commandIntentPending=%s commandTransportInFlight=%s automaticMutationPath=local-command-queue', this.commandIntentPending ? 'yes' : 'no', this.commandTransportInFlight ? 'yes' : 'no');
      return;
    }

    this.capabilityDiscoveryInFlight = true;

    try {
      const waitUntil = Date.now() + 5000;
      while (this.pollInFlight && Date.now() < waitUntil) {
        await sleep(250);
      }

      if (this.pollInFlight) {
        this.log.warn('GivHome capability capability discovery skipped because a telemetry poll did not release the transport window.');
        return;
      }

      this.pollInFlight = true;
      const client = new DirectLocalReadOnlyClient({
        host: this.inverterHost,
        port: this.inverterPort,
        deviceAddress: this.deviceAddress,
        adapterSerial: DEFAULT_ADAPTER_SERIAL,
        connectTimeoutMs: GENEROUS_CONNECT_TIMEOUT_MS,
        readTimeoutMs: GENEROUS_READ_RESPONSE_TIMEOUT_MS
      });

      const report = await runCapabilityDiscovery(client, {
        expectedSerial: this.inverterSerial,
        level: this.capabilityDiscoveryLevel
      });

      for (const block of report.blocks) {
        this.log.info('%s', renderBlockLogLine(block));
      }

      this.log.info(
        'GivHome capability capability discovery complete: directInverter=%s serial=%s requiredOk=%s requiredFailed=%s advisoryOk=%s advisoryWarn=%s commandExposure=%s',
        report.directInverter ? 'yes' : 'no',
        report.serial || 'unknown',
        report.summary.okRequiredBlocks,
        report.summary.failedRequiredBlocks,
        report.summary.okAdvisoryBlocks,
        report.summary.failedAdvisoryBlocks,
        report.commandExposureAllowed ? 'candidate' : 'locked'
      );

      const acAioLimits = report.keyRegisters && report.keyRegisters.acAioPowerPercentLimits ? report.keyRegisters.acAioPowerPercentLimits : {};
      const readOrUnread = (value) => Number.isInteger(value) ? value : 'unread';
      this.log.info(
        'GivHome capability register evidence: HR313 battery_charge_limit_ac=%s HR314 battery_discharge_limit_ac=%s HR318 battery_pause_mode=%s',
        readOrUnread(acAioLimits.HR313),
        readOrUnread(acAioLimits.HR314),
        readOrUnread(acAioLimits.HR318)
      );
      this.log.info(
        'GivHome capability AC/AIO registry evidence: HR311 export_priority=%s HR313 battery_charge_limit_ac=%s HR314 battery_discharge_limit_ac=%s HR317 enable_eps=%s HR318 battery_pause_mode=%s commandExposure=locked',
        readOrUnread(acAioLimits.HR311),
        readOrUnread(acAioLimits.HR313),
        readOrUnread(acAioLimits.HR314),
        readOrUnread(acAioLimits.HR317),
        readOrUnread(acAioLimits.HR318)
      );

      const drilldown = report.capabilities && report.capabilities.dashboardDrilldownTelemetry ? report.capabilities.dashboardDrilldownTelemetry.evidence : {};
      this.log.info(
        'GivHome capability dashboard drilldown evidence: IR1 pv1VoltageRaw=%s IR8 pv1CurrentRaw=%s IR5 gridVoltageRaw=%s IR13 gridFrequencyRaw=%s IR41 inverterTempRaw=%s IR56 batteryTempRaw=%s commandExposure=locked',
        readOrUnread(drilldown.IR1),
        readOrUnread(drilldown.IR8),
        readOrUnread(drilldown.IR5),
        readOrUnread(drilldown.IR13),
        readOrUnread(drilldown.IR41),
        readOrUnread(drilldown.IR56)
      );

      const acSweep = report.keyRegisters && report.keyRegisters.acAioRegistryOpportunitySweep ? report.keyRegisters.acAioRegistryOpportunitySweep : {};
      this.log.info(
        'GivHome capability AC/AIO opportunity sweep: HR300 enable_plant_mode=%s HR301 plant_role=%s HR308 battery_nominal_power=%s HR310 battery_max_charge_pct=%s HR319 battery_pause_slot_1_start=%s HR320 battery_pause_slot_1_end=%s HR322 tariff_battery_logic=%s HR333 enable_ev_charger=%s HR343 enable_generator=%s HR351 inverter_operating_mode=%s commandExposure=locked',
        readOrUnread(acSweep.HR300),
        readOrUnread(acSweep.HR301),
        readOrUnread(acSweep.HR308),
        readOrUnread(acSweep.HR310),
        readOrUnread(acSweep.HR319),
        readOrUnread(acSweep.HR320),
        readOrUnread(acSweep.HR322),
        readOrUnread(acSweep.HR333),
        readOrUnread(acSweep.HR343),
        readOrUnread(acSweep.HR351)
      );

      this.log.info(
        'GivHome capability family guardrails: currentSerial=%s serialFamily=%s hr0Family=%s deviceKind=%s currentTargetOnly=yes familyGeneralisation=disabled presentAbsentUnreadWarnRecorded=yes commandExposure=locked',
        report.serial || 'unknown',
        report.profile && report.profile.family ? report.profile.family : 'unknown',
        report.familyFromHr0 || 'unknown',
        report.profile && report.profile.kind ? report.profile.kind : 'unknown'
      );

      const smartLoad = report.keyRegisters && report.keyRegisters.smartLoadSchedule ? report.keyRegisters.smartLoadSchedule : {};
      const rtc = report.keyRegisters && report.keyRegisters.duplicateRealTimeControl ? report.keyRegisters.duplicateRealTimeControl : {};
      const highBank = report.keyRegisters && report.keyRegisters.highBankForceChargeExport ? report.keyRegisters.highBankForceChargeExport : {};
      const ems = report.keyRegisters && report.keyRegisters.plantEmsSchedule ? report.keyRegisters.plantEmsSchedule : {};
      this.log.info(
        'GivHome capability opportunity evidence: HR554 smart_load_slot_1_start=%s HR573 smart_load_slot_10_end=%s HR166 rtc=%s HR1005 rtc_duplicate=%s HR1108 highbank_discharge_rate=%s HR1110 highbank_charge_rate=%s HR1122 force_discharge=%s HR1123 force_charge=%s HR2040 plant_ems_control=%s HR2070 ems_export_soc_3=%s commandExposure=locked',
        readOrUnread(smartLoad.HR554),
        readOrUnread(smartLoad.HR573),
        readOrUnread(rtc.HR166),
        readOrUnread(rtc.HR1005),
        readOrUnread(highBank.HR1108),
        readOrUnread(highBank.HR1110),
        readOrUnread(highBank.HR1122),
        readOrUnread(highBank.HR1123),
        readOrUnread(ems.HR2040),
        readOrUnread(ems.HR2070)
      );

      this.log.info('GivHome capability capability states: %s', capabilityStateSummaryLine(report.capabilities));
      this.log.info('GivHome capability capability safety: commandExposure=locked writes=disabled commandTiles=disabled');

      if (this.enableStage4SafetyFrameworkReadback) {
        const stage4 = buildStage4SafetyFrameworkReport(report);
        this.log.info('%s', renderStage4FrameworkLine(stage4));
        this.log.info('%s', renderStage4SnapshotLine(stage4));
        this.log.info('%s', renderStage4KeyValuesLine(stage4));
        this.log.info('%s', renderStage4GuardrailLine(stage4));
        this.log.info('%s', renderStage4LifecyclePlanLine(stage4));
        this.log.info('%s', renderStage4PlannedRegisterLine(stage4));
        this.log.info('%s', renderStage4DryRunIntentLine(stage4));
        this.log.info('%s', renderStage4DryRunWriteOrderLine(stage4));
        const stage5 = buildStage5OfflineWriteComposerReport(stage4);
        this.log.info('%s', renderStage5OfflineComposerLine(stage5));
        this.log.info('%s', renderStage5OfflineFramePlanLine(stage5));
        this.log.info('%s', renderStage5OfflineFrameVerificationLine(stage5));
      }

      if (this.advancedDiagnostics) {
        for (const [name, detail] of Object.entries(report.capabilities)) {
          this.log.info('GivHome capability capability %s=%s present=%s', name, detail.state, detail.present ? 'yes' : 'no');
        }
      }
    } catch (err) {
      this.log.warn('GivHome capability capability discovery failed: %s', err && err.message ? err.message : String(err));
    } finally {
      this.pollInFlight = false;
      this.capabilityDiscoveryInFlight = false;
      this.capabilityDiscoveryComplete = true;
    }
  }


  async pollOnce() {
    if (this.pollInFlight) return;
    if (this.manualChargeSupervisorInFlight) {
      if (this.advancedDiagnostics) {
        this.log.info('poll skipped during Manual Charge supervisor snapshot: automaticMutationPath=absent supervisorOverlapGuard=yes');
      }
      return;
    }
    if (this.commandIntentPending || this.commandTransportInFlight || Date.now() < this.commandPollHoldUntilMs) {
      if (this.advancedDiagnostics) {
        this.log.info('poll skipped during command transport quiet window: GivHome command queue/transport quiet window commandIntentPending=%s commandTransportInFlight=%s automaticMutationPath=local-command-queue', this.commandIntentPending ? 'yes' : 'no', this.commandTransportInFlight ? 'yes' : 'no');
      }
      return;
    }
    this.pollInFlight = true;

    const started = Date.now();

    try {
      const client = new DirectLocalReadOnlyClient({
        host: this.inverterHost,
        port: this.inverterPort,
        deviceAddress: this.deviceAddress,
        adapterSerial: DEFAULT_ADAPTER_SERIAL,
        connectTimeoutMs: GENEROUS_CONNECT_TIMEOUT_MS,
        readTimeoutMs: GENEROUS_READ_RESPONSE_TIMEOUT_MS
      });

      const response = await client.readInputRegisters(INPUT_REGISTER_TELEMETRY_START, INPUT_REGISTER_TELEMETRY_COUNT);
      const profile = classifySerialPrefix(response.inverterSerial);

      if (!profile.isDirectInverterCandidate) {
        throw new Error(`responder is not a direct inverter: ${response.inverterSerial} (${profile.kind})`);
      }

      if (this.inverterSerial && response.inverterSerial !== this.inverterSerial) {
        throw new Error(`serial mismatch: expected ${this.inverterSerial}, got ${response.inverterSerial}`);
      }

      const decoded = decodeInputRegisters0To60(response.values);
      const model = deriveTelemetryModel(decoded, new Date());
      this.handlePollSuccess({ response, model, durationMs: Date.now() - started });
    } catch (err) {
      this.handlePollFailure(err);
    } finally {
      this.pollInFlight = false;
    }
  }

  handlePollSuccess({ response, model, durationMs }) {
    const previousFailures = this.health.consecutiveFailures;

    this.latestModel = model;
    this.health.state = 'online';
    this.health.totalPolls += 1;
    this.health.consecutiveFailures = 0;
    this.health.lastSuccessAt = new Date();
    this.health.lastErrorReason = '';
    this.health.lastResponseMeta = response.lastUnexpectedResponse || null;

    this.updateAccessories(model);

    if (this.advancedDiagnostics || previousFailures > 0) {
      this.log.info(
        'poll ok %sms serial=%s soc=%s pv=%sW gridRaw=%sW import=%sW export=%sW load=%sW batteryRaw=%sW charge=%sW discharge=%sW%s',
        durationMs,
        response.inverterSerial,
        model.socPercent,
        model.pvPowerW,
        model.gridRawPowerW,
        model.gridImportPowerW,
        model.gridExportPowerW,
        model.loadPowerW,
        model.batteryRawPowerW,
        model.batteryChargePowerW,
        model.batteryDischargePowerW,
        previousFailures > 0 ? ` recoveredAfterFailures=${previousFailures}` : ''
      );
    }

    if (this.advancedDiagnostics && response.lastUnexpectedResponse) {
      this.log.warn('ignored non-matching frame before successful poll: %s', response.lastUnexpectedResponse.summary);
    }
  }

  handlePollFailure(err) {
    this.health.totalPolls += 1;
    this.health.totalFailures += 1;
    this.health.consecutiveFailures += 1;
    this.health.lastErrorAt = new Date();
    this.health.lastErrorReason = err && err.message ? err.message : String(err);
    this.health.lastResponseMeta = err && err.givEnergyFrameMeta ? err.givEnergyFrameMeta : null;

    const count = this.health.consecutiveFailures;
    const threshold = this.staleAfterConsecutiveFailures;
    const hasLastGoodTelemetry = this.latestModel !== null;

    if (count < threshold && hasLastGoodTelemetry) {
      this.health.state = 'retrying';
      this.log.warn(
        'read retry (%s/%s, keeping last good telemetry): %s',
        count,
        threshold,
        this.health.lastErrorReason
      );
      if (this.advancedDiagnostics && this.health.lastResponseMeta) {
        this.log.warn('last non-matching frame: %s', this.health.lastResponseMeta.summary);
      }
      return;
    }

    this.health.state = 'stale';
    this.log.warn(
      'read-only telemetry stale after %s consecutive failure%s: %s',
      count,
      count === 1 ? '' : 's',
      this.health.lastErrorReason
    );
    if (this.advancedDiagnostics && this.health.lastResponseMeta) {
      this.log.warn('last non-matching frame before stale: %s', this.health.lastResponseMeta.summary);
    }
    this.markAccessoriesInactive();
  }

  updateAccessories(model) {
    const cheapState = this.currentCheapStateForStatusTiles(new Date());
    this.latestCheapState = cheapState;

    for (const accessory of this.accessoryByUUID.values()) {
      const id = accessory.context.definitionId;
      if (!id) continue;
      if (id === MANUAL_CHARGE_ACCESSORY_ID) continue;

      const service = accessory.getService(this.Service.Lightbulb);
      if (!service) continue;

      if (id === ACCESSORY_IDS.BATTERY_LEVEL) {
        const level = batteryLevelState(model);
        service.updateCharacteristic(this.Characteristic.On, true);
        service.updateCharacteristic(this.Characteristic.Brightness, level);
        continue;
      }

      if (id === ACCESSORY_IDS.TELEMETRY_STATUS) {
        service.updateCharacteristic(this.Characteristic.On, this.health.state === 'online');
        service.updateCharacteristic(this.Characteristic.Brightness, telemetryBrightnessState(this.health));
        continue;
      }

      if (id === ACCESSORY_IDS.SOLAR_POWER) {
        const solarEvidence = solarBrightnessEvidence(model, this.maxPvKw);
        service.updateCharacteristic(this.Characteristic.On, model.active.solar);
        service.updateCharacteristic(this.Characteristic.Brightness, solarEvidence.brightness);
        if (!solarEvidence.maxPvConfigured && !this.solarCalibrationWarned) {
          this.solarCalibrationWarned = true;
          this.log.warn('Solar Generating brightness held at %s because maxPvKw is not configured; pvPowerW=%s active=%s source=%s fakeSolarBrightness100=no', solarEvidence.brightness, solarEvidence.pvPowerW, solarEvidence.active ? 'yes' : 'no', solarEvidence.source);
        }
        continue;
      }

      const state = this.lightbulbStateFor(id, model, cheapState);
      service.updateCharacteristic(this.Characteristic.On, state);
    }
  }

  markAccessoriesInactive() {
    for (const accessory of this.accessoryByUUID.values()) {
      const id = accessory.context.definitionId;
      if (!id || id === MANUAL_CHARGE_ACCESSORY_ID || id === ACCESSORY_IDS.BATTERY_LEVEL) continue;
      const service = accessory.getService(this.Service.Lightbulb);
      if (!service) continue;
      service.updateCharacteristic(this.Characteristic.On, false);
      if (id === ACCESSORY_IDS.TELEMETRY_STATUS || id === ACCESSORY_IDS.SOLAR_POWER) {
        service.updateCharacteristic(this.Characteristic.Brightness, 1);
      }
    }
  }


  lightbulbStateFor(id, model, cheapState = null) {
    switch (id) {
      case ACCESSORY_IDS.GRID_IMPORT:
        return model.active.gridImport;
      case ACCESSORY_IDS.GRID_EXPORT:
        return model.active.gridExport;
      case ACCESSORY_IDS.BATTERY_CHARGING:
        return model.active.batteryCharging;
      case ACCESSORY_IDS.BATTERY_DISCHARGING:
        return model.active.batteryDischarging;
      case ACCESSORY_IDS.ONLINE:
        return this.health.state === 'online';
      case ACCESSORY_IDS.CHEAP_RATE:
        return Boolean(cheapState && cheapState.cheapActive);
      case ACCESSORY_IDS.SMART_WINDOW:
        return Boolean(cheapState && cheapState.dispatchActive);
      case ACCESSORY_IDS.GRACE_PERIOD:
        return Boolean(cheapState && cheapState.graceActive);
      default:
        return false;
    }
  }

  powerFor(id, model) {
    switch (id) {
      case ACCESSORY_IDS.SOLAR_POWER:
        return model.pvPowerW;
      case ACCESSORY_IDS.GRID_IMPORT:
        return model.gridImportPowerW;
      case ACCESSORY_IDS.GRID_EXPORT:
        return model.gridExportPowerW;
      case ACCESSORY_IDS.BATTERY_CHARGING:
        return model.batteryChargePowerW;
      case ACCESSORY_IDS.BATTERY_DISCHARGING:
        return model.batteryDischargePowerW;
      default:
        return 0;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseCapabilityDiscoveryLevel(value) {
  const text = String(value || 'core').toLowerCase();
  if (text === 'opportunity') return 'opportunity';
  if (text === 'extended') return 'extended';
  return 'core';
}

function normalisePollInterval(value) {
  const numeric = Number.isInteger(value) ? value : DEFAULT_POLL_INTERVAL_SECONDS;
  return Math.max(MIN_POLL_INTERVAL_SECONDS, Math.min(MAX_POLL_INTERVAL_SECONDS, numeric));
}

function normaliseStaleAfterConsecutiveFailures(value) {
  const numeric = Number.isInteger(value) ? value : DEFAULT_STALE_AFTER_CONSECUTIVE_FAILURES;
  return Math.max(MIN_STALE_AFTER_CONSECUTIVE_FAILURES, Math.min(MAX_STALE_AFTER_CONSECUTIVE_FAILURES, numeric));
}


function normaliseManualChargeCommandDurationMinutes(value) {
  const numeric = Number.isInteger(value) ? value : DEFAULT_MANUAL_CHARGE_COMMAND_DURATION_MINUTES;
  return Math.max(1, Math.min(120, numeric));
}


function clockTimeStringToMinutes(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function clockWindowDurationMinutes(startText, endText) {
  const start = clockTimeStringToMinutes(startText);
  const end = clockTimeStringToMinutes(endText);
  if (start === null || end === null || start === end) return null;
  return end > start ? end - start : (24 * 60 - start) + end;
}

function parseHmmIntegerToMinutes(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.max(0, Math.round(n));
  const hours = Math.floor(rounded / 100);
  const minutes = rounded % 100;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function durationMatchesMinutes(actualMinutes, expectedMinutes, toleranceMinutes = 5) {
  if (!Number.isFinite(Number(actualMinutes)) || !Number.isFinite(Number(expectedMinutes))) return false;
  return Math.abs(Number(actualMinutes) - Number(expectedMinutes)) <= Math.max(0, Number(toleranceMinutes));
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function dateToHmm(date) {
  return date.getHours() * 100 + date.getMinutes();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function dateToDisplayHmm(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'none';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function renderSingleDispatchWindowForLog(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  return `${dateToDisplayHmm(start)}-${dateToDisplayHmm(end)}`;
}

function renderDispatchWindowsForLog(dispatches = []) {
  if (!Array.isArray(dispatches) || dispatches.length === 0) return '';
  return dispatches
    .filter((d) => d && d.start instanceof Date && d.end instanceof Date && !Number.isNaN(d.start.getTime()) && !Number.isNaN(d.end.getTime()))
    .map((d) => renderSingleDispatchWindowForLog(d.start, d.end))
    .join(',');
}

function validPercentOrDefault(value, fallback) {
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : fallback;
}

function roundOneDecimalPlace(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return numeric;
  return Math.round(numeric * 10) / 10;
}

module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, GivHomeModbusPlatform);
};

module.exports.PLUGIN_NAME = PLUGIN_NAME;
module.exports.PLATFORM_NAME = PLATFORM_NAME;
module.exports.GivHomeModbusPlatform = GivHomeModbusPlatform;
module.exports.normalisePollInterval = normalisePollInterval;
module.exports.normaliseStaleAfterConsecutiveFailures = normaliseStaleAfterConsecutiveFailures;
module.exports.normaliseManualChargeCommandDurationMinutes = normaliseManualChargeCommandDurationMinutes;
