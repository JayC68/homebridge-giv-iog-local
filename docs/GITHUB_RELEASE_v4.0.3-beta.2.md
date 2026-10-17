# GivHome 4.0.3-beta.2 — clearer choices for overnight charging

This beta makes Solar-Aware Cheap Overnight easier to set up, explains when to use Emergency Stop and clarifies the release guidance. Charging behaviour, settings and defaults are unchanged from beta-1.

## Let tomorrow’s sunshine shape tonight’s charge

On a dull day, you may want a full battery after the cheap overnight period. If plenty of sunshine is expected, you may prefer to buy less electricity overnight and leave room to store your own solar energy during the day.

Solar-Aware Cheap Overnight lets you choose those overnight battery levels. GivHome checks the solar forecast for the day ahead and selects the matching level.

**Set up Cheap Overnight first, then enable Predicted Solar and enter your location and solar-panel details.** Enable Solar-Aware Cheap Overnight to add its on/off switch to Apple Home.

There are two different measurements in the settings:

- **Solar forecast, in kWh:** how much energy your panels are expected to generate over the day. This is not your battery size or your panels’ power rating in kW.
- **Overnight battery level, in %:** how full you want the battery to be when the cheap period finishes.

The two forecast amounts divide the day-ahead forecast into low, middle and high bands. With the default settings:

| Solar expected over the day | Overnight battery level | What that means |
|---|---|---|
| Less than 10 kWh | 100% | Buy enough cheap electricity to aim for a full battery. |
| From 10 kWh to less than 20 kWh | 80% | Leave about 20% of the battery’s capacity free at the end of charging. |
| 20 kWh or more | 60% | Leave about 40% free for the coming day. |

You can change both forecast amounts and all three battery levels. The second forecast amount must be higher than the first. Choose the same or a lower overnight battery level as more solar is expected. These are your chosen bands for this beta; GivHome does not yet calculate them from battery size or predicted household use.

**Your normal Charge Target is still the maximum.** For example, if it is 70%, a solar setting of 80% results in a 70% overnight target. A solar setting of 60% results in 60%. These are charging targets, not a promise that the battery will reach a particular level or stay there as the house uses energy.

Turn the Solar-Aware Cheap Overnight switch off to use your normal Charge Target again. GivHome also uses that normal target if there is no usable, up-to-date forecast for the correct day. The saved forecast is retained across midnight and restart, for up to 24 hours. Homebridge’s local time zone must match the solar location and your cheap window.

This changes Cheap Overnight only. Intelligent Octopus Go battery protection keeps its own target and continues to take over after the overnight window if enabled. Battery Care uses the selected overnight target. Manual charging, Agile learning and Eve history retain their existing roles.

## A one-time Emergency Stop

Seen unwanted or unexpected battery charging or discharging and need a simple way to stop it?

Tick **Show Emergency Stop tile** in Plugin Config to add the switch to Apple Home. Switch it on to ask GivHome to find and stop the running forced charge or discharge, clear its active schedule where supported, and return the inverter to normal Eco operation.

This is a one-time action: the switch returns to Off afterwards. The tile is optional and is not shown by default. It uses the existing appliance-control acknowledgement and model gates.

GivHome reads the inverter’s forced-charge and export controls and schedule, disables both forced controls before clearing implicated active slots, restores Eco and verifies the settings. It preserves unrelated schedule times, reserve levels, power limits and charge limits. The recovery record is saved before writes. Queued commands and supervisors cannot restart the stopped action during the hold.

A successful recovery keeps commands held until the affected inverter or current GivHome window ends (at least one minute). Future automation preferences remain configured. A failed or incomplete recovery keeps commands held across restart: investigate the inverter or competing controller, then retry Emergency Stop. Removing the tile does not remove a saved safety hold. The switch returning to Off is not proof of success: check the PASS or FAIL result in the Homebridge log. Physical energy flow still needs fresh telemetry.

Supported single-phase profiles use their established core registers. CH/AIO also reads its ten-slot banks and its pause control; older CE/AC and hybrid profiles avoid CH slot banks and require the pause register only when GivHome uses pause controls. Only slots with validated clearing authority are changed. Other active slots are reported as incomplete after forced controls are disabled; the hold remains. Unknown, three-phase and gateway profiles have no Emergency Stop tile. Missing or invalid required readback stops the recovery before writes. There is no promise of stopping a separate controller that keeps rewriting the inverter.

## Before trying this beta

Before upgrading, keep a verified backup and the exact previous package, `homebridge-giv-iog-local@4.0.2`, so you can return to it if needed. After upgrading, check the Homebridge log and confirm that your usual schedules and any enabled IOG battery protection are working as expected. Compatibility and recovery support vary by inverter model and firmware.

The existing HR242 slot-specific limit remains diagnostic-only. Original CH pre-session restoration across restart, complete live overnight boundaries and full original failure-recording replay remain unproved. See [release preparation and rollback](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.3-beta.2/docs/RELEASING.md), [beta control details](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.3-beta.2/docs/BETA_CONTROLS.md), [safety notes](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.3-beta.2/docs/SAFETY.md) and the [Full Changelog](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.3-beta.2/CHANGELOG.md).

**Full Changelog comparison:** [v4.0.3-beta.1...v4.0.3-beta.2](https://github.com/JayC68/homebridge-giv-iog-local/compare/v4.0.3-beta.1...v4.0.3-beta.2).
