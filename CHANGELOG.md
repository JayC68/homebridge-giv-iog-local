# Changelog

## 3.5.1-beta

- Aligns the Homebridge registered platform name with `config.schema.json` `pluginAlias` for Homebridge verification.
- Keeps the npm package name as `homebridge-giv-iog-local`.
- No functional control, automation, Eve history, or HomeKit accessory behaviour changes from v3.5.0.

## 3.4.6-beta-3b.13

- Preserves the 3b.10 Eve graphing/service changes that enabled Solar history rendering in Eve.
- Removes the reset-total characteristic from Eve Energy history services to prevent cumulative totals being reset during startup or Eve accessory initialisation.
- Keeps fakegato initialisation, history entry format, unique Eve serials, and automation/control behaviour unchanged.
- Includes final config wording polish for Extra Indicators in Apple Home and threshold descriptions.
- Ensures packaged Homebridge UI logo assets are included for the plugin icon.

## 3.4.6-beta-3b.8

## 3.4.6-beta-3b.9

- Gave each Eve Energy history accessory a unique HomeKit serial number to avoid Eve merging same-type histories.
- Updated manufacturer text to `JayC68 Vibed` to avoid slash characters in Eve accessory metadata.
- Refined Apple Home indicator wording in plugin config, including threshold descriptions and the optional extra indicators label.


- Config UI wording cleanup only, focused on clearer human-facing labels.
- Renames Energy History to make Eve app integration explicit.
- Moves local connection settings to the bottom of the config form.
- Renames Advanced Tuning to Personal Preference Settings.
- Changes Manual Tile Tolerance default to 5 minutes and limits the slider to 0-10 minutes.
- Clarifies that observation thresholds control Light accessories in Apple Home and that 0 disables each observation.
- Removes Manual Smart Windows JSON from the visible config form.

## 3.4.6-beta-3b.7

- Persist Eve Energy cumulative kWh totals across restarts.
- Recover cumulative totals from existing fakegato persistence files where possible.
- Prevent Total Consumption from resetting backwards after Homebridge/plugin restarts.

# 3.4.6-beta-3b.6

- Seed Eve Energy characteristics before FakeGato history service creation.
- Keep the proven FakeGato initialisation path from 3b.5.
- Change Eve Total Consumption characteristic to floating kWh and keep it moving from sampled power.
- Add safer history-entry logging with cumulative kWh context.

# Changelog

## 3.4.6-beta-3b.5
- Compatibility recovery: restored the legacy Homebridge platform registration identifier so existing config.json entries continue to load.
- Retains GivHome user-facing naming, Energy History labelling, five-year 5-minute history sizing, and the working fakegato initialisation path from 3b.1-style builds.


## 3.4.6-beta-3b.1

- Adds a deliberately narrow Eve Energy history prototype behind an opt-in Homebridge config switch.
- Creates separate Eve-style energy history accessories for Solar Generated, Grid Import History, and Grid Export History.
- Feeds periodic native-style watt samples into fakegato-history so Eve can derive historical energy graphs rather than GivHome inventing its own graph layer.
- Keeps Smart Window as a live operational truth only; no Smart Window history is added in this build.
- Does not add low-value engineering telemetry or custom dashboard behaviour.

## 3.4.6-beta-3a

- Clean-and-polish release after the beta-2b observation-to-Lightbulb migration.
- Changes the default platform fallback name from `GivEnergy IOG` to `GivHome`.
- Cleans internal terminology from sensor wording toward observation wording while preserving existing HomeKit accessory identifiers.
- Keeps Observations as read-only Lightbulb services and manual Charge/Export controls as Switch services.
- Keeps advanced telemetry opt-in for Cheap Rate, Grace Period, Battery Discharging, and Online.
- Keeps the failed accessory renaming UI removed; recommended names apply only to newly created accessories.
- Adds Node 24 to the declared supported Node.js engine range.

## 3.4.6-beta-2b

- Migrated GivHome observation tiles from HomeKit OccupancySensor services to read-only Lightbulb services.
- Preserves existing accessory identities while removing the misleading Apple Home occupancy/presence notification model.
- Core observations remain Smart Window, Battery Charging, Grid Import, and Grid Export.
- Optional advanced telemetry observations, when enabled, also use Lightbulb services.
- Manual Charge/Export controls remain Switch services.

## 3.4.6-beta-2a.2

- Removes the accessory renaming control from the Homebridge UI after the beta-2a/2a.1 save issue.
- Preserves existing HomeKit names by default; recommended names are applied only to newly created accessories.
- Keeps split power thresholds, advanced telemetry exposure, Smart Window, Battery Level, Battery Charging, Grid Import, Grid Export, and Solar Generating.
- No HomeKit service-type migration in this release.

## 3.4.6-beta-2a.1

- Replaces the beta-2a `Apply Recommended Accessory Names` checkbox in the Homebridge UI with an `Accessory Naming` selector to avoid the observed save failure when the checkbox was enabled.
- Keeps the old `applyRecommendedNames` config key tolerated internally for compatibility, but removes it from the visible form.
- Preserves beta-2a naming decisions: Smart Window, Battery Level, Battery Charging, Grid Import, Grid Export, and Solar Generating.
- No HomeKit service-type migration in this release. Occupancy-to-Lightbulb migration remains deferred to beta-2b.

## 3.4.6-beta-2a

- Refines recommended observation names after live Apple Home testing.
- Renames the smart dispatch observation from IOG Slot to Smart Window for friendlier Octopus-aligned language while keeping the same underlying `smartWindow` accessory identifier for HomeKit continuity.
- Renames Battery SOC to Battery Level for more Apple-native, user-friendly wording while keeping the same underlying `batterySoc` accessory identifier.
- Keeps the beta-2 operational-state foundation: curated observations, optional advanced telemetry, separate power thresholds, and deferred OccupancySensor-to-Lightbulb service migration.

## 3.4.6-beta-2

- Adds the beta-2 operational-state UX foundation: observations are treated separately from manual action switches.
- Renames the smart dispatch observation from IOG Charging to IOG Slot to avoid implying that the battery itself is always charging during an Octopus dispatch.
- Renames the Solar observation to Solar Generating for fact-based wording.
- Hides lower-value/diagnostic telemetry accessories by default: Cheap Rate, Grace Period, Battery Discharging, and Online. Adds `exposeAdvancedTelemetry` so users can deliberately opt back in.
- Splits the old shared power-active threshold into separate Battery Charging, Battery Discharging, Grid Import, and Grid Export thresholds. Existing `powerActiveThreshold` configs are still tolerated as fallback values.
- Deliberately keeps existing OccupancySensor service types in this beta to avoid combining telemetry-tier changes with higher-risk HomeKit service migration.

## 3.4.6-beta-1

- Updates recommended HomeKit accessory names for clearer fact-based UX: IOG Charging, Battery Charging, Battery Discharging, Grid Import, Grid Export, Solar, and Cheap Rate.
- Adds optional `applyRecommendedNames` config switch so existing users can choose whether to apply the new recommended names instead of forcing changes over manual Apple Home renames.
- Makes the Solar accessory conditional on configured Maximum Solar Power, so non-PV battery systems can leave the value blank or set to 0 and avoid an unnecessary Solar tile.
- Removes legacy `forceChargeMinutes` and `forceExportMinutes` config options because fixed 30, 60, 90, and 120 minute Charge/Export tiles are now present.
- Keeps the existing manual tile accessory identifiers for HomeKit continuity while simplifying user-facing action labels from Force Charge/Force Export to Charge/Export.

## 3.4.6

- Adds required native Homebridge config validation for Battery Serial Number and Inverter IP Address.
- Adds IPv4 validation for Inverter IP Address.
- Adds GivEnergy-style serial validation while allowing compatible alphanumeric serials.
- Adds HH:MM validation for Off-Peak Start and Off-Peak End.
- Adds runtime setup warnings for missing/invalid serial, inverter IP, time format, or appliance MQTT port mismatch.
- Documents the `1883` to `1884` MQTT appliance port change and the upgrade requirement to populate Inverter IP Address.
- Keeps native Homebridge config UI to avoid the custom UI modal endless-scroll issue.

## 3.4.5

- Restores the public-facing Homebridge UI name to GivHome while preserving the internal platform identifier for compatibility.
- Returns configuration to Homebridge's native schema UI to avoid the custom modal endless-scroll issue.
- Adds native Inverter IP Address setup field, found in the same GivEnergy app scan screen as the Battery Serial Number.
- Changes the standard appliance MQTT default to `mqtt://127.0.0.1:1884`.
- Removes the unused custom UI server path from the published package.

## 3.4.4

- Attempted to contain the custom setup UI inside a fixed-height shell.
- Kept the 3.4.3 GivTCP/Mosquitto backend direction, but was superseded by 3.4.5 because the Homebridge modal endless-scroll issue persisted.

## 3.4.3

- Added the Inverter IP Address concept for appliance setup.
- Added GivTCP/Mosquitto appliance configuration work following the MQTT/GivTCP recovery investigation.
- Standardised the appliance MQTT path around host port `1884`.
- Superseded by 3.4.5/3.4.6 native configuration because the larger custom UI was not stable inside the Homebridge plugin modal.

## 3.4.5

- Restores the public-facing Homebridge UI name to GivHome while preserving the internal platform identifier for compatibility.
- Returns configuration to Homebridge's native schema UI to avoid the custom modal endless-scroll issue.
- Adds native Inverter IP Address setup field, found in the same GivEnergy app scan screen as the Battery Serial Number.
- Changes the standard appliance MQTT default to `mqtt://127.0.0.1:1884`.
- Keeps the stable 3.4.x inverter-control and HomeKit tile behaviour.

## 3.4.2-beta-2

- Reworked the GivHome setup UI save flow to avoid hanging inside the Homebridge modal.
- Removed the sticky internal footer that could interact badly with Homebridge modal scrolling.
- Save now updates plugin config, triggers Homebridge save without waiting on a modal-destroying promise, and shows immediate user feedback.

## 3.4.2-beta-1

- Rebuilds the GivHome setup UI with its own visible **Save settings** button.
- Saves setup details through the Homebridge custom UI API rather than relying on the outer modal footer.
- Reduces modal scroll friction on first-run setup and updates Step 5 wording.
- No automation or inverter-control changes from 3.4.1.

## 3.4.1-beta-5

- Fixes timed manual Charge/Export tile persistence so the active duration tile remains On for the running session.
- Adds persistent manual session state so users can still cancel an active timed export/charge after a child-bridge restart.
- Keeps manual Charge/Export cancellation available by turning the active tile Off.


## 3.4.1-beta-5

- Fixes beta-3 crash loop caused by missing `getChargingActiveThresholdW()` helper.
- Preserves split Charging/Solar Charge threshold behaviour.

## 3.4.1-beta-3

- Added `CHANGELOG.md` so Homebridge can show release notes during plugin updates.
- Improved the GivHome setup landing page logo placement.
- Changed Charging threshold behaviour so intentional grid/smart charging uses a higher default threshold while solar-to-battery charging remains visible at lower winter-friendly levels.
- Preserved the internal Homebridge platform identifier for upgrade compatibility.

## 3.4.1-beta-2

- Added Update Available Home sensor using npm registry checks.
- Added split activity thresholds for quieter Home notifications.
- Updated Homebridge 2 stable compatibility metadata.
- Improved GivHome setup UI and maintenance wording.

## 3.4.1-beta-1

- Added GivHome logo assets and funding metadata.
- Prepared package metadata for Homebridge verification readiness.
- Updated image landing page and website assets.

## 3.4.1-beta-0

- Introduced GivHome branding across package metadata and setup assets.
- Added first Update Available sensor implementation.
- Added quieter activity threshold configuration.

## 3.4.0

- Added 30, 60, 90, and 120 minute Charge and Export tiles.
- Kept original `forceCharge` and `forceExport` accessory kinds as fixed 60 minute tiles for HomeKit continuity.
- Added truth-based manual tile state from live inverter schedule telemetry where available.
- Simplified Homebridge configuration for normal users and moved local connection/tuning settings into Advanced sections.
- Removed unused Battery Size, Low Battery Threshold, and Maximum Battery Charge Power settings from earlier experiments.
