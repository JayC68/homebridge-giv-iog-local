# GivHome 4.0.3-beta.1 — a little more choice, and a way back to Eco

This beta adds three things: the right Homebridge website link, Solar-Aware Cheap Overnight, and an optional Emergency Stop tile.

## Let tomorrow’s sunshine shape tonight’s charge

Solar-Aware Cheap Overnight can leave more room in the battery when a brighter day is forecast. Choose two forecast thresholds in kWh and three charge targets in Plugin Config. The defaults are below 10 kWh: 100%; 10–under 20 kWh: 80%; 20 kWh or more: 60%. Your normal Charge Target remains the upper limit.

Enable Predicted Solar and Cheap Overnight, then enable Solar-Aware Cheap Overnight. Its Apple Home switch lets you turn the forecast adjustment on or off. Off means ordinary Cheap Overnight. Missing, invalid, stale or wrong-day forecasts use your normal Charge Target. The saved forecast is retained across midnight and restart, for up to 24 hours. Homebridge’s local time zone must match the solar location and your cheap window.

This changes Cheap Overnight only. Intelligent Octopus Go battery protection keeps its own target and continues to take over after the overnight window. Battery Care uses the selected overnight target. Manual charging, Agile learning and Eve history retain their existing roles.

## A one-time Emergency Stop

Tick **Show Emergency Stop tile** in Plugin Config to add the momentary switch. It is off by default and uses the existing appliance-control acknowledgement and model gates.

GivHome reads the inverter’s forced-charge and export controls and schedule, disables both forced controls before clearing implicated active slots, restores Eco and verifies the settings. It preserves unrelated schedule times, reserve levels, power limits and charge limits. The recovery record is saved before writes. Queued commands and supervisors cannot restart the stopped action during the hold.

A successful recovery keeps commands held until the affected inverter or current GivHome window ends (at least one minute). Future automation preferences remain configured. A failed or incomplete recovery keeps commands held across restart: investigate the inverter or competing controller, then retry Emergency Stop. Removing the tile does not remove a saved safety hold. The switch returning to Off is not proof of success: check the PASS or FAIL result in the Homebridge log. Physical energy flow still needs fresh telemetry.

Supported single-phase profiles use their established core registers. CH/AIO also reads its ten-slot banks and its pause control; older CE/AC and hybrid profiles avoid CH slot banks and require the pause register only when GivHome uses pause controls. Only slots with validated clearing authority are changed. Other active slots are reported as incomplete after forced controls are disabled; the hold remains. Unknown, three-phase and gateway profiles have no Emergency Stop tile. Missing or invalid required readback stops the recovery before writes. There is no promise of stopping a separate controller that keeps rewriting the inverter.

## The correct website

The plugin homepage now points to [GivHome Homebridge](https://homebridge.givhome.kernowekconsulting.co.uk), as recorded in [PR #2](https://github.com/JayC68/homebridge-giv-iog-local/pull/2).

## Before trying this beta

Keep a verified backup and the exact previous package, `homebridge-giv-iog-local@4.0.2`. This release does not install anything on your Homebridge or send live inverter writes. Validation uses simulated registers and native HomeKit services; it does not establish live behaviour on every model or firmware.

The existing HR242 slot-specific limit remains diagnostic-only. Original CH pre-session restoration across restart, complete live overnight boundaries and full original failure-recording replay remain unproved. See [release preparation and rollback](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.3-beta.1/docs/RELEASING.md), [beta control details](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.3-beta.1/docs/BETA_CONTROLS.md), [safety notes](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.3-beta.1/docs/SAFETY.md) and the [Full Changelog](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.3-beta.1/CHANGELOG.md).

**Full Changelog comparison:** [v4.0.2...v4.0.3-beta.1](https://github.com/JayC68/homebridge-giv-iog-local/compare/v4.0.2...v4.0.3-beta.1).
