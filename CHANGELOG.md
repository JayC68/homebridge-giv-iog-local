# Changelog

## 3.6.5-beta.2 - Emergency IOG reliability rollback

This beta intentionally restores the last known-good v3.6.0-beta.2 charge-control model while keeping the package version current.

- Reverts the IOG/manual charge path to the proven two-step schedule flow: enable charge schedule, then set charge slot.
- Removes the v3.6.5-beta.1 experimental charge-state repair sequence from the active path.
- Keeps Smooth/Battery Care absent from this build.
- Temporarily hard-disables Excess Energy Export in code for safety while the IOG charging regression is isolated.
- No automatic `/setChargeRate` or `/setChargeRateAC` writes are made by this build.


## 3.6.0-beta.2

- Adds UI-configured, opt-in Excess Energy Export beta settings.
- Captures Battery Capacity for reserve-ladder calculations.
- Adds conservative default behaviour: overnight load remains served by cheap grid import unless the user explicitly opts into battery-first overnight behaviour.
- Adds local-only excess export decision logging and conservative 30-minute discharge windows.
- Credits MrMessy for the original WonderWatt scheduling sheet concept.
- Preserves existing platform identity, child bridge compatibility, manual controls, Intelligent Octopus Go charging, and Eve History behaviour.

## 3.5.1-beta.2

- Verification metadata test build.
- Aligns config.schema.json pluginAlias with the existing Homebridge registered platform name.
- Keeps the runtime platform name unchanged as `GivEnergy Local + Intelligent Octopus Go` to preserve existing installs, child bridges and accessory identity.
- No runtime behaviour changes from v3.5.0.

## 3.5.0-beta

- Promotes Eve energy history from prototype to the v3.5.0 beta release line.
- Adds integrated Eve-compatible history accessories:
  - Eve Solar History
  - Eve Import History
  - Eve Export History
- Persists solar, grid import and grid export history across Homebridge restarts, child bridge restarts and system reboots.
- Suppresses active On/Off behaviour on Eve History tiles so they act as quiet data collectors rather than flickering live controls.
- Keeps real graph and measurement data flowing to Eve while avoiding misleading HomeKit activity state for history accessories.
- Confirms stable manual Charge and Export controls after soak testing.
- Refreshes README and public website wording around local control, Intelligent Octopus Go integration, Apple Home visibility and Eve history.

## 3.4.6-beta-3b.15

- Final Eve History polish build used as the source baseline for v3.5.0-beta.
- Keeps Eve Solar, Import and Export history recording real values.
- Suppresses Eve History accessory active-state flicker in Apple Home and Eve.
- Preserves existing control, automation and manual tile behaviour.

## 3.4.6-beta-3b.14

- Renames Eve history accessories for clearer user-facing intent:
  - Eve Solar History
  - Eve Import History
  - Eve Export History
- Keeps graph persistence and cumulative totals intact.
- Improves Apple Home / Eve presentation without changing automation behaviour.

## 3.4.6-beta-3b.13

- Preserves the 3b.10 Eve graphing/service changes that enabled Solar history rendering in Eve.
- Removes the reset-total characteristic from Eve Energy history services to prevent cumulative totals being reset during startup or Eve accessory initialisation.
- Keeps fakegato initialisation, history entry format, unique Eve serials, and automation/control behaviour unchanged.
- Includes final config wording polish for Extra Indicators in Apple Home and threshold descriptions.
- Ensures packaged Homebridge UI logo assets are included for the plugin icon.

## 3.4.6-beta-3b.9

- Gave each Eve Energy history accessory a unique HomeKit serial number to avoid Eve merging same-type histories.
- Updated manufacturer text to avoid slash characters in Eve accessory metadata.
- Refined Apple Home indicator wording in plugin config, including threshold descriptions and the optional extra indicators label.

## 3.4.6-beta-3b.8

- Config UI wording cleanup focused on clearer human-facing labels.
- Renames Energy History to make Eve app integration explicit.
- Moves local connection settings to the bottom of the config form.
- Renames Advanced Tuning to Personal Preference Settings.
- Changes Manual Tile Tolerance default to 5 minutes and limits the slider to 0-10 minutes.
- Clarifies that observation thresholds control Light accessories in Apple Home and that 0 disables each observation.
- Removes Manual Smart Windows JSON from the visible config form.

## 3.4.6-beta-3b.7

- Persists Eve Energy cumulative kWh totals across restarts.
- Recovers cumulative totals from existing fakegato persistence files where possible.
- Prevents Total Consumption from resetting backwards after Homebridge/plugin restarts.

## 3.4.6-beta-3b.6

- Seeds Eve Energy characteristics before FakeGato history service creation.
- Keeps the proven FakeGato initialisation path from 3b.5.
- Changes Eve Total Consumption characteristic to floating kWh and keeps it moving from sampled power.
- Adds safer history-entry logging with cumulative kWh context.

## 3.4.6-beta-3b.5

- Compatibility recovery: restored the legacy Homebridge platform registration identifier so existing config.json entries continue to load.
- Retains GivHome user-facing naming, Energy History labelling, five-year 5-minute history sizing, and the working fakegato initialisation path from earlier 3b builds.

## 3.4.6-beta-3b.1

- Adds a deliberately narrow Eve Energy history prototype behind an opt-in Homebridge config switch.
- Creates separate Eve-style energy history accessories for Solar Generated, Grid Import History, and Grid Export History.
- Feeds periodic native-style watt samples into fakegato-history so Eve can derive historical energy graphs.
- Keeps Smart Window as a live operational truth only; no Smart Window history is added in this build.
- Does not add low-value engineering telemetry or custom dashboard behaviour.

## 3.4.6-beta-3a

- Clean-and-polish release after the beta-2b observation-to-Lightbulb migration.
- Changes the default platform fallback name from `GivHome` where safe.
- Cleans internal terminology from sensor wording toward observation wording while preserving existing HomeKit accessory identifiers.
- Keeps Observations as read-only Lightbulb services and manual Charge/Export controls as Switch services.
- Keeps advanced telemetry opt-in for Cheap Rate, Grace Period, Battery Discharging, and Online.
- Adds Node 24 to the declared supported Node.js engine range.

## 3.4.6

- Adds required native Homebridge config validation for Battery Serial Number and Inverter IP Address.
- Adds IPv4 validation for Inverter IP Address.
- Adds GivEnergy-style serial validation while allowing compatible alphanumeric serials.
- Adds HH:MM validation for Off-Peak Start and Off-Peak End.
- Adds runtime setup warnings for missing/invalid serial, inverter IP, time format, or appliance MQTT port mismatch.
- Documents the `1883` to `1884` MQTT appliance port change and the upgrade requirement to populate Inverter IP Address.
- Keeps native Homebridge config UI to avoid the custom UI modal endless-scroll issue.

## 3.4.0

- Added 30, 60, 90, and 120 minute Charge and Export tiles.
- Kept original `forceCharge` and `forceExport` accessory kinds as fixed 60 minute tiles for HomeKit continuity.
- Added truth-based manual tile state from live inverter schedule telemetry where available.
- Simplified Homebridge configuration for normal users and moved local connection/tuning settings into Advanced sections.
- Removed unused Battery Size, Low Battery Threshold, and Maximum Battery Charge Power settings from earlier experiments.
