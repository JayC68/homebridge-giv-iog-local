# Changelog

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

