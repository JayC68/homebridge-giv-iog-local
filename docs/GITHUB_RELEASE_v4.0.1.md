# GivHome 4.0.1 - Taking more care with overnight charging

Released 10 October 2026. This promotes the privately tested Charge Target build to GivHome 4.0.1, with its charging controls unchanged.

Charge Target now stays On when battery readings refresh or the inverter connection becomes stale. The tile is a saved target, not a charging-status indicator; these updates must not switch it Off. Your chosen percentage and the guarded inverter controls are unchanged.

Cheap Overnight has a straightforward job: use the overnight period you have chosen to charge towards your chosen Battery Level.

Intelligent Octopus Go also needs to follow the EV's charging periods and protect the home battery. When those periods overlap, the two need to work together.

That is the focus of 4.0.1: giving Cheap Overnight its own time and checking the inverter's charging settings more carefully.

## Your target, right in Home

Tomorrow looks sunny. You may prefer to leave a little more room in the battery.

The new **Charge Target** tile brings that choice into Apple Home. Its percentage is the battery level you want GivHome's charging controls to work towards. The saved choice is shared by Cheap Overnight, IOG charge-mode protection and timed Charge tiles, and survives a restart.

Choosing a target does not start charging or change your overnight times. During a charge owned by this running GivHome instance, it checks changes to the supported general limits and keeps the original settings for cleanup. Rapid slider movements are combined into one update. The separate CH/AIO slot limit remains unchanged, so the chosen percentage is not a promise that every inverter will reach it.

## Giving Cheap Overnight its own time

During the configured overnight period, this build gives Cheap Overnight priority. Intelligent Octopus Go continues to follow its charging information, while holding back new battery-protection commands during that period.

When Cheap Overnight finishes, GivHome ends its command and puts the saved general charging settings back before handing over to Intelligent Octopus Go if a suitable Smart Window is still active. Otherwise, charging is left off. Offline tests cover both handovers; a complete overnight boundary still needs live validation.

## Checking the charging settings

An inverter can hold more than one AC charging limit. Changing the general target does not necessarily change the limit attached to an individual charging period.

Before temporary charging, this build reads the existing settings, compares the general AC charging controls with the requested Battery Level and checks any changes before enabling charging. It also saves the previous limit settings, writes them back when the temporary command ends and checks that they have been restored. Extending an IOG command keeps the original saved settings.

On CH/All-in-One systems, GivHome also reads the separate AC Charge 1 limit (`HR242`) and reports when it differs from the requested target. We have not yet established a safe way for this build to change that limit, so it leaves it alone.

**This release does not correct the separate CH/AIO slot limit.** In the owner's trial, changing HR242 from 80% to 100% through the official app restored approximately 5.7 kW of charging with the IOG schedule unchanged. This is strong evidence of that limit's effect on this inverter, not validation of automatic writes across inverter families. GivHome continues to leave HR242 unchanged, including during cleanup.

## What we have checked

The existing software checks, Predicted Solar tests and package checks have passed. New offline tests run the charge and restoration methods with a simulated inverter, including the 05:30 overnight boundary, overlaps with IOG, protection by charging or pausing, and refusal of unsupported target writes.

Charge Target also passes tests for saved choices, slider changes, active general-limit updates and recovery from failed verification. All 36 runtime and native HomeKit tests passed on the Pi, along with five private-installer safety tests. The owner exercised the Apple Home slider, and general-limit changes were confirmed by inverter readback. Charge Target stayed lit after the telemetry-display correction; its lit state represents the saved setting, not actual charging.

IOG resumed its command after two live-session restarts and used the current 15:30 dispatch end. The charge schedule was subsequently observed disabled. That does not prove restoration of the original pre-session settings across restart: the CH charge snapshot is held in memory, so resumed ownership may capture temporary settings. Cleanup deliberately leaves charging disabled rather than reinstating a previously enabled customer schedule.

These checks do not prove a whole night's charging or every model and firmware combination. Before the first trial, all 42 installed stable source files matched the published 4.0.0 package. A complete replay of the original failure remains outstanding.

The [release preparation notes](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.1/docs/RELEASING.md) record the remaining checks in detail.

## Your existing Home

This build keeps the existing accessory identities, Eve Energy history and Predicted Solar implementation from 4.0.0. Charge Target has its own new identity and appears when supported charging controls are enabled. You can hide it in Homebridge settings. Apple Home supplies the standard dimmer interface; it is a target selector, not a charging on/off switch.

Before an approved installation, keep a verified backup of the current plugin, Homebridge settings, accessories, energy history and flight recorder, with a way to return to the previous version.

If you are moving from v3, start with the [migration guide](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.1/docs/MIGRATION_V3_TO_V4.md), [safety notes](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.1/docs/SAFETY.md) and [troubleshooting guide](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.1/docs/TROUBLESHOOTING.md).

## Full Changelog

[Full Changelog](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.1/CHANGELOG.md) tells the story of v4 and the direct-Modbus work that led to it. The [earlier v3 history](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.1/docs/CHANGELOG_V3.md) and [published release notes](https://github.com/JayC68/homebridge-giv-iog-local/releases) are also available.

**Full Changelog comparison:** [v4.0.0...v4.0.1](https://github.com/JayC68/homebridge-giv-iog-local/compare/v4.0.0...v4.0.1).

The comparison links the published stable 4.0.0 source to this release.
