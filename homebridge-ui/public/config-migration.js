(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GivHomeConfigMigration = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  function has(config, key) {
    return Object.prototype.hasOwnProperty.call(config, key)
      && config[key] !== undefined && config[key] !== null && config[key] !== '';
  }

  function first(config, keys) {
    for (const key of keys) if (has(config, key)) return config[key];
    return undefined;
  }

  function numberInRange(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
  }

  function intInRange(value, fallback, min, max) {
    return Math.round(numberInRange(value, fallback, min, max));
  }

  function copyAlias(config, canonical, aliases, normalise) {
    if (has(config, canonical)) return false;
    const value = first(config, aliases);
    if (value === undefined) return false;
    config[canonical] = normalise ? normalise(value) : value;
    return true;
  }

  function migrateDays(config, prefix, legacyKey) {
    const presetKey = `${prefix}RunDaysPreset`;
    if (has(config, presetKey) || !has(config, legacyKey)) return false;
    const selected = new Set((Array.isArray(config[legacyKey]) ? config[legacyKey] : String(config[legacyKey]).split(/[\s,;|]+/))
      .map((day) => String(day || '').trim().toLowerCase().slice(0, 3)));
    config[presetKey] = 'custom';
    for (const day of DAYS) {
      const label = day[0].toUpperCase() + day.slice(1);
      const full = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }[day];
      config[`${prefix}Run${full || label}`] = selected.has(day);
    }
    return true;
  }

  function migrateExistingConfig(input) {
    const config = { ...(input || {}) };
    const changed = [];
    const mark = (key, didChange) => { if (didChange) changed.push(key); };

    // Existing installations without a name have always run as "GivHome Modbus".
    // Materialising that fallback preserves accessory UUIDs and state-file identity.
    if (!has(config, 'name')) {
      config.name = 'GivHome Modbus';
      changed.push('name');
    }

    // The runtime historically treated an omitted country as unrestricted.
    // Keep that meaning for an existing place-name forecast; GB remains the
    // starting value for a genuinely new configuration.
    if (!Object.prototype.hasOwnProperty.call(config, 'predictedSolarCountryCode')) {
      config.predictedSolarCountryCode = '';
      changed.push('predictedSolarCountryCode');
    }

    if (!has(config, 'enableCheapOvernightCharging')) {
      config.enableCheapOvernightCharging = config.enableBatteryCareCharging === true
        || config.enableEvSmartWindowBatteryProtection === true;
      changed.push('enableCheapOvernightCharging');
    }

    // Solar 2mrw derives its display scale from total installed kWp.
    // Remove the retired override so an older saved value cannot remain active.
    if (Object.prototype.hasOwnProperty.call(config, 'predictedSolarReferenceKwh')) {
      delete config.predictedSolarReferenceKwh;
      changed.push('predictedSolarReferenceKwh');
    }

    mark('enableApplianceControl', copyAlias(config, 'enableApplianceControl', ['enableStage11ApplianceControl'], Boolean));
    mark('applianceControlAcknowledgement', copyAlias(config, 'applianceControlAcknowledgement', ['stage11ApplianceControlAcknowledgement']));
    mark('enableEveningExcessExport', copyAlias(config, 'enableEveningExcessExport', ['enableExcessEnergyExport'], Boolean));
    mark('enableOctopusFluxExport', copyAlias(config, 'enableOctopusFluxExport', ['enableFluxPeakExport'], Boolean));
    mark('enableOctopusAgileOutgoingAutoExport', copyAlias(config, 'enableOctopusAgileOutgoingAutoExport', ['enableAgileOutgoingAutoExport'], Boolean));

    const maxCharge = numberInRange(config.maxBatteryChargePowerKw, 6, 0.5, 20);
    if (!has(config, 'maxBatteryExportPowerKw') && (has(config, 'maxBatteryDischargePowerKw') || has(config, 'maxBatteryChargePowerKw'))) {
      config.maxBatteryExportPowerKw = numberInRange(first(config, ['maxBatteryDischargePowerKw', 'maxBatteryChargePowerKw']), maxCharge, 0.5, 20);
      changed.push('maxBatteryExportPowerKw');
    }
    const maxBatteryExport = numberInRange(first(config, ['maxBatteryExportPowerKw', 'maxBatteryDischargePowerKw', 'maxBatteryChargePowerKw']), maxCharge, 0.5, 20);
    if (!has(config, 'maxGridExportPowerKw') && (has(config, 'gridExportLimitKw') || has(config, 'exportLimitKw') || has(config, 'maxBatteryChargePowerKw'))) {
      config.maxGridExportPowerKw = numberInRange(first(config, ['gridExportLimitKw', 'exportLimitKw']), maxBatteryExport, 0.5, 20);
      changed.push('maxGridExportPowerKw');
    }

    const legacyPercent = has(config, 'manualExportPowerPercent')
      ? intInRange(config.manualExportPowerPercent, 30, 0, 100) : undefined;
    if (!has(config, 'timedExportPowerKw') && (has(config, 'manualExportPowerKw') || legacyPercent !== undefined || has(config, 'maxBatteryChargePowerKw'))) {
      const fallback = legacyPercent === undefined ? maxBatteryExport : Math.max(0.1, maxBatteryExport * legacyPercent / 100);
      config.timedExportPowerKw = numberInRange(first(config, ['manualExportPowerKw']), fallback, 0.1, 20);
      changed.push('timedExportPowerKw');
    }

    const aliases = [
      ['eveningExportStartTime', ['excessExportStartTime', 'excessExportStart']],
      ['eveningExportReserveSoc', ['excessExportReserveSoc']],
      ['eveningExportPowerKw', ['maxExportPowerKw', 'excessExportDischargeKw']],
      ['eveningExportSlotMinutes', ['excessExportSlotMinutes']],
      ['eveningExportMarginSoc', ['excessExportMarginSoc']],
      ['octopusFluxExportStartTime', ['fluxExportStartTime']],
      ['octopusFluxExportEndTime', ['fluxExportEndTime']],
      ['octopusFluxReserveSoc', ['fluxReserveSoc']],
      ['octopusFluxEveningReserveKwh', ['fluxEveningReserveKwh']],
      ['octopusFluxSafetyMarginSoc', ['fluxSafetyMarginSoc']],
      ['octopusFluxExportPowerKw', ['fluxExportPowerKw']],
      ['octopusFluxSlotMinutes', ['fluxSlotMinutes']],
      ['octopusFluxMinimumExportKwh', ['fluxMinimumExportKwh']],
      ['octopusFluxTariffImportPence', ['fluxImportPence']],
      ['octopusFluxTariffExportPence', ['fluxExportPence']],
      ['octopusAgileOutgoingExportPowerKw', ['agileOutgoingExportPowerKw']]
    ];
    for (const [canonical, legacy] of aliases) mark(canonical, copyAlias(config, canonical, legacy));

    for (const key of ['octopusFluxExportPowerKw', 'octopusAgileOutgoingExportPowerKw']) {
      if (!has(config, key) && (has(config, 'maxBatteryExportPowerKw') || has(config, 'maxBatteryDischargePowerKw') || has(config, 'maxBatteryChargePowerKw'))) {
        config[key] = Math.min(6, maxBatteryExport);
        changed.push(key);
      }
    }

    mark('octopusFluxRunDaysPreset', migrateDays(config, 'octopusFlux', 'octopusFluxDaysToRun'));
    mark('octopusAgileOutgoingRunDaysPreset', migrateDays(config, 'octopusAgileOutgoing', 'octopusAgileOutgoingDaysToRun'));

    return { config, changed: [...new Set(changed)] };
  }

  return { migrateExistingConfig };
}));
