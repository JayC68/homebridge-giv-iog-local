## 3.7.0-beta.3 - 2026-06-08

- Extends write/readback/verify lifecycle checks to timed charge starts as well as cleanup.
- Automatic IOG smart-window charging and the fallback 23:30-05:30 cheap window now use the same post-write readback verification path as manual timed actions.
- Verification now inspects charge/discharge slots 1-10 so hidden slot persistence is detected rather than missed.
- Treats GivTCP cache readback as the source of truth; REST success text remains logged but is not trusted as proof of state.
- Silences parked Smooth Charging timer-clear logging when Smooth Charging is disabled, with dedupe retained as a safety net if Smooth is re-enabled.
- No background polling, ping checks, port checks, GivTCP restart logic, EEE behaviour changes or platform naming changes.

# Changelog

## 3.7.0-beta.2 - 2026-06-08

### Added

- Adds gentle write/readback/verify-cleared handling for manual timed Charge and Export actions.
- When a manual timed action ends, or is switched off manually, GivHome writes the normal clear command and then reads back the existing GivTCP cache to confirm slot 1 has cleared to 00:00-00:00.
- Adds optional Homebridge UI controls for write verification delay and retry count.

### Safety and design notes

- This verification runs only after manual timed action cleanup writes. It does not add background polling, Modbus polling, ping checks, port checks or GivTCP restart behaviour.
- The existing automation command paths remain unchanged; this beta adds a protective cleanup confirmation path for manual timed actions.

## 3.7.0-beta.1 - 2026-06-08

### Added

- Adds a passive Telemetry Freshness Guard using existing GivTCP `Stats.Last_Updated_Time` telemetry.
- Adds a visible GivHome Telemetry status tile in Apple Home.
- Adds configurable fresh/offline thresholds, defaulting to 180 seconds and 600 seconds.
- Blocks manual and automatic command execution while telemetry is stale/offline, so GivHome does not act on potentially old SOC or power data.

### Safety and design notes

- This beta does not add Modbus polling, inverter reads, ping checks, port 8899 checks or GivTCP container restart logic.
- Existing automation logic is left intact; the freshness guard sits in front of command execution.
- If `Stats.Last_Updated_Time` is unavailable, GivHome falls back to MQTT receive age for compatibility, but the proper stale-cache protection requires the GivTCP timestamp.

## 3.6.4-beta.1 - 2026-05-30

### Fixed

- Fixes Excess Energy Export scheduling without setting discharge power.
- Automated evening export now writes `/setDischargeRate` using the configured Max Export Power before enabling the discharge schedule and setting the discharge slot.
- Aligns `BUILD_VERSION` with the package version so HomeKit firmware metadata reflects the installed beta.

### Added

- Adds optional Normal Discharge Power After Export (W). Leave at 0 to avoid restoring/changing normal discharge-rate behaviour after EEE; set a known value only if the system needs one.

### Notes

- This beta uses GivTCP REST abstractions, not raw inverter registers, because GivEnergy systems differ in register mapping and scaling.
- EEE still remains opt-in and reserve-led.

## 3.6.3 - 2026-05-27

### User-facing improvements

- Refreshes the README, public website wording, Homebridge config descriptions and release notes around the current GivHome feature set.
- Repositions GivHome around the clearer promise: “Your battery quietly does the right thing, automatically.”
- Explains Battery Care Charging in plain English as kinder overnight charging during the main cheap-rate window.
- Explains Excess Energy Export as local evening export management that keeps enough charge to get the home to the next cheap window.
- Clarifies that Excess Energy Export is not Agile price automation.
- Improves wording for non-technical users who want useful battery automation without day-to-day battery management.

### Battery-care and asset-protection wording

- Adds clearer guidance that Battery Care Charging is intended to reduce unnecessary high-stress charging when there is enough cheap-window time to be gentler.
- Frames battery care as useful for owners who want to look after an expensive battery asset over the long term, regardless of manufacturer support or warranty circumstances.

### Configuration wording

- Reviews Homebridge UI wording for Battery Care Charging and Excess Energy Export.
- Keeps existing config keys, defaults and behaviour intact.
- Keeps Maximum Battery Charge Power user-defined, because 100% charge rate means different kW values on different systems.

### Technical notes

- No intended backend automation changes from v3.6.2-beta.6.
- Standard charging, Battery Care Charging, Excess Energy Export, Eve History and manual tiles are intended to behave as in the validated 3.6.2 beta line.

## 3.6.2-beta.6 - 2026-05-27

- Suppressed the very large Fakegato startup `read data from ...` history dumps at normal log level.
- Eve/Fakegato history persistence is unchanged; this is a targeted log hygiene fix only.
- Battery Care Charging, Standard Charging and Excess Energy Export logic are unchanged from beta.5.


## 3.6.2-beta.5

### Fixed

- Fixes Excess Energy Export restart recovery during the Battery Care beta series.
- Recovers an already-active inverter discharge slot after Homebridge/plugin restart and preserves it instead of creating a new sliding export slot from the current minute.
- Keeps active evening export slots stable until they expire, whether held in memory or recovered from live inverter schedule telemetry.
- Preserves the v3.6.2-beta.3 fix so standard charging does not write `/setChargeRate 100`.

## 3.6.2-beta.3

### Fixed

- Fixes a Smooth Charging beta regression where ordinary non-Smooth automatic charging sent `/setChargeRate 100`.
- Standard charging now leaves the charge-rate actuator untouched, matching the v3.6.0 control model.
- Excess Energy Export is isolated again from Battery Care charge-rate writes.

### Notes

- Battery Care/Smooth Charging still uses `/setChargeRate` only when Battery Care is actively selected for the overnight cheap slot.
- Short windows, smart dispatch extensions, manual charging and normal ECO behaviour do not write charge-rate percentages.


## 3.6.2-beta.2

### Changed

- Reworks Smooth Charging beta into Battery Care Charging.
- Limits Smooth/Battery Care Charging to the main overnight cheap-rate slot only. Extra IOG dispatches, manual smart windows, grace periods and short windows continue to use standard charging.
- Replaces exposed ramp mechanics with a simpler Battery Care Mode: Gentle, Balanced or Strong.
- Calculates the requested `setChargeRate` percentage from SOC, target SOC, battery capacity, maximum charge power and remaining overnight cheap-window time.
- Re-evaluates during the overnight window instead of pre-queuing a fixed ramp.

### Notes

- Maximum Battery Charge Power remains user-defined because 100% charge rate represents different kW on different systems.
- This beta is deliberately narrow so overnight behaviour can be tested safely before expanding Smooth Charging to other smart slots.

## 3.6.2-beta.1

### Added

- Adds Smooth Charging beta behind an opt-in Homebridge config switch.
- Adds local `/setChargeRate` percentage control before and during automatic charge windows.
- Adds required user-defined Maximum Battery Charge Power (kW) for Smooth Charging so GivHome does not assume one inverter's 100% rate applies to every system.
- Adds configurable Smooth Charging minimum window length, update interval, starting rate and maximum rate.

### Changed

- Long cheap windows can now use progressive charge-rate updates when Smooth Charging is enabled and correctly configured.
- Short charge windows continue to use standard 100% charge-rate behaviour.
- Excess Energy Export, manual charge/export tiles, Eve history and HomeKit accessory identity are preserved.

### Notes

- Smooth Charging is disabled by default.
- Smooth Charging will not run if Maximum Battery Charge Power (kW) is missing or invalid.
- This beta is battery-care focused; Pro load-sensitive control is intentionally left for a later build.

## 3.6.0

### Added

- Adds Excess Energy Export: optional local evening sell-off automation for unused battery energy before the cheap overnight window.
- Adds full Homebridge UI controls for Battery Capacity, Evening Export Start Time, Max Export Power, Reserve SOC, SOC Safety Margin, Slot Duration and Serve Overnight Load From Battery.
- Adds local SOC-ladder behaviour inspired by MrMessy/WonderWatt-style evening export planning.

### Changed

- Promotes the soak-tested v3.6.0-beta.4 Excess Energy Export implementation to the public v3.6.0 release.
- Keeps Excess Energy Export disabled by default and opt-in through the Homebridge UI.
- Preserves existing Intelligent Octopus Go charging, manual tiles, Eve History, platform identity and HomeKit accessory identity behaviour.

### Notes

- Excess Energy Export uses local GivTCP REST controls only.
- No GivEnergy cloud dependency is required for the new automation.
- Daytime PV behaviour is unchanged; local battery-pause/freeze behaviour is not attempted in this release.

## 3.6.0-beta.4

- Exposes all Excess Energy Export evening sell-off controls in the Homebridge config UI.
- Renames beta config keys to clearer user-facing names: Evening Export Start Time, Max Export Power, and SOC Safety Margin.
- Keeps backwards tolerance for beta.3 config keys.
- No intended change to existing IOG, Eve History, platform identity, or accessory identity behaviour.

## 3.6.0-beta.3

- Adds the first local Excess Energy Export evening sell-off automation.
- Uses a MrMessy/WonderWatt-style SOC reserve ladder to export unused battery energy after normal evening household demand and before the cheap overnight window.
- Keeps the feature disabled by default and opt-in through the Homebridge UI.
- Adds configurable battery capacity, evening start time, reserve SOC, discharge rate, slot size and trigger margin.
- Keeps existing Intelligent Octopus Go charging, manual tiles, Eve history and HomeKit accessory identity unchanged.
- Does not attempt unsupported local battery-pause behaviour; daytime PV continues to follow the inverter's native charge-first/export-overflow behaviour.

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
