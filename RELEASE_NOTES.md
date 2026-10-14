# GivHome 4.0.2 - Independent IOG charging target

Release date: 14 October 2026.

Cheap Overnight's Charge Target slider now controls Cheap Overnight only. In 4.0.1 the saved percentage was also passed to IOG, and slider changes could rewrite an active IOG charge. That unintended coupling is corrected in both paths.

With a 45% overnight target, battery at 46% and an active IOG Smart Window, IOG requests its own 100% target. Moving the slider to 95% during that IOG session saves the next overnight choice without writing IOG's target.

IOG charge-mode protection uses the independent `iogChargeTargetSoc` setting, default 100%. Existing `targetSoc` and saved Apple Home preferences are never used as an IOG target. Timed Charge tiles use the configured `targetSoc`, without the slider override. The engineering Manual Charge switch, IOG pause modes and export controls are unchanged.

Enabled Cheap Overnight retains priority throughout its configured window, including after reaching its target. At the end, verified cleanup restores the saved general settings before IOG starts with its independent target if its Smart Window remains active. A queued slider update rechecks ownership before writing.

CH/AIO, CE and ED use the established model-aware HR20/HR116 plan and fresh readback before enabling charge. HR242 remains read-only diagnostic information; a lower CH/AIO slot ceiling can still limit charging. Failed verification must not claim a successful target or enable a newly started charge. The original in-memory snapshot is retained for cleanup and same-owner extension.

Validation covers the 45% slider / 46% battery / IOG100 regression on CH/AIO, CE and ED; no IOG target writes after slider changes; overlap and end-of-window handover; saved preferences and independent configuration after restart; readback failure; unsupported profiles; queued ownership changes; and native HomeKit behavior. The release evidence records actual check results and independent review. No live inverter or Pi deployment is part of this release.

Remaining limitations from 4.0.1 still apply: original CH pre-session snapshot restoration across restart is unproved, HR242 is not automatically corrected or restored, cleanup leaves HR96 disabled, and a complete live overnight boundary and original failure-recording replay remain unverified. Offline verification does not establish every model/firmware combination.

Before a separately authorised installation, keep a verified backup of the plugin, configuration, cached accessories, Eve history and flight recorder. To return to 4.0.1, stop Homebridge, restore that verified backup (or install the exact `homebridge-giv-iog-local@4.0.1` package using the existing installation method), then restart and verify logs and telemetry. Version 4.0.1 retains the slider/IOG coupling; rollback does not correct it. Restoring plugin files cannot by itself restore inverter state from a lost in-memory snapshot.

See [Charge Target](docs/CHARGE_TARGET.md), [release preparation and rollback](docs/RELEASING.md), [safety notes](docs/SAFETY.md), and [Full Changelog](CHANGELOG.md).

**Full Changelog comparison:** [v4.0.1...v4.0.2](https://github.com/JayC68/homebridge-giv-iog-local/compare/v4.0.1...v4.0.2).
