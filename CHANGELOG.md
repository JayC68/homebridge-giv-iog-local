# Changelog

This changelog covers GivHome v4. See [published releases](https://github.com/JayC68/homebridge-giv-iog-local/releases) for release downloads.

[Release notes for 4.0.3-beta.4](RELEASE_NOTES.md) explain the current features and limitations. Each older entry records what was done and proved at that point in the project's history.

## 4.0.3-beta.4 — Stop this action, keep the next one (18 October 2026)

- Make Emergency Stop acknowledge promptly in Apple Home and release new actions as soon as inverter readback verifies the stop. Remove the wait to an old action’s finishing time.
- Treat nothing running as a no-change result when Eco is normal. Preserve armed future schedules, unrelated settings and cleanup ownership.
- Persist stop and cleanup progress; retry interrupted communication with bounded backoff and reconcile uncertain writes before resending. Resume recovery after restart and migrate older stop records using fresh evidence.
- Add durable action ownership and timer tokens for charge, export and pause. Restore borrowed settings only for a matching action; preserve external changes, refuse conflicting starts safely, and make unrelated Off presses harmless.
- Reconcile shared charge/export enable flags with future schedules. Cancel only the current automation occurrence, restore recurring hardware windows after it ends, and retain Cheap Overnight priority and later IOG handover if enabled.
- Cover documented two-slot CE/AC and ED/Hybrid routes as well as CH/All-in-One; route ED export through its core bank. Read supported pause capabilities and verify inverter time, including the repeated autumn hour. Keep HR242 diagnostic-only.
- Retain reserve limits, Flux single-peak protection, Agile learning, Eve history and the optional local observation foundation. Local learning data stays on the device and is not sent to the developer.

## 4.0.3-beta.3 — Local learning foundation (17 October 2026)

- Add optional, off-by-default local observation for future Automatic Solar-Aware Cheap Overnight. Reuse verified polls and existing forecasts, with minute/half-hour energy summaries, provisional weekday/weekend site-load profiles and observed charging response.
- Preserve forecast revisions as received; label unresolved DST times, missing values, gaps and control context. Do not claim EV separation, solar correction, battery capacity or automatic-planning readiness.
- Bound queues, records, model dimensions, files and storage; batch asynchronous writes, rotate old records, recover compatible snapshots and isolate observation failures from telemetry and controls.
- Add pause and one-time local reset settings, installation/setup fingerprints, service-account file permissions and explicit local-data privacy documentation. No observation or learning data is sent to the developer.
- Retain existing charging decisions, IOG battery protection, Agile learning, Emergency Stop and Eve history. No new HomeKit service or automatic controller is added.
- Local observation is off by default in this opt-in Homebridge beta. Pi CPU and memory performance are still being evaluated; automatic planning is not enabled.

## 4.0.3-beta.2 - 2026-10-17

Clearer guidance for the choices introduced in beta-1. Charging behaviour, configuration values and defaults are unchanged.

- Reorganised Solar-Aware Cheap Overnight setup into three steps: add the Home switch, choose the daily solar forecast bands, then choose the overnight battery levels. Explained kWh versus battery %, prerequisites, the normal Charge Target cap and fallback, with a worked example.
- Introduced Emergency Stop by the problem it addresses: an unwanted or unexpected forced battery charge or discharge. Kept the approved Plugin Config description and existing safety controls.
- Clarified that IOG protection takes over after the overnight window if enabled. Reworked the upgrade guidance and removed internal build-process wording from the release notes.

## 4.0.3-beta.1 - 2026-10-17

Solar-Aware Cheap Overnight and Emergency Stop, with the existing IOG protection, Agile learning and Eve history retained:

- Added optional Solar-Aware Cheap Overnight: two editable forecast thresholds, three charge targets, normal-target fallback and a persisted Apple Home on/off switch. Retained the morning forecast across midnight and restart. The normal Charge Target caps the selected target; IOG retains its own target.
- Added opt-in Emergency Stop with the approved Plugin Config description. Fresh profile-aware reads precede disable-first cancellation, clearing only validated implicated slots, Eco restoration and readback. A durable hold blocks queued commands and supervisors through the affected window; failed verification keeps the hold across restart. Unvalidated active slots report incomplete rather than receiving speculative writes.

Existing HR242 and CH restart-restoration limitations remain. See the release notes for setup guidance and the recovery limitations to understand before upgrading.

## 4.0.2 - 2026-10-14

Corrected the unintended sharing of Cheap Overnight's saved Charge Target with IOG. IOG now uses independent `iogChargeTargetSoc` (default 100%) for command resolution and decision logging. Slider reconciliation requires an active Cheap Overnight owner and rechecks ownership on the transport queue. Timed Charge uses configured `targetSoc`; engineering Manual Charge and export remain unchanged.

Retained Cheap Overnight window priority, verified cleanup before IOG handover, original snapshots and model-aware HR20/HR116 readback. HR242 stays diagnostic-only. Added regressions for slider45/SOC46/IOG100, slider edits during IOG, queued handover, distinct targets at the overnight boundary, configuration/reload isolation, timed Charge and failed IOG readback. No live Pi deployment or inverter changes are authorised by this release task. Existing restart-restoration and live-boundary limitations remain.

## 4.0.1 - 2026-10-10

4.0.1 starts with an everyday expectation: when you choose an overnight charging period and a Battery Level, GivHome should work towards that plan and take care of the settings it borrows.

Two problems brought us here. The general AC charge target and the limit for an individual charging slot can disagree. Intelligent Octopus Go can also need to protect the battery while Cheap Overnight is using the same overnight period.

This release promotes the privately tested Charge Target update, based on the exact published `homebridge-giv-iog-local@4.0.0` package. The separate HR242 ceiling is diagnosed but remains unchanged by GivHome.

Charge Target no longer appears Off after routine telemetry updates or a stale connection. A native HomeKit regression test covers both paths and confirms the selected percentage is retained. Its lit state represents a saved setting, not charging activity.

The owner's CH trial confirmed active target readback and IOG command resumption after two live-session restarts. The 15:30 session subsequently left HR96 disabled. Raising HR242 from 80% to 100% in the official app restored approximately 5.7 kW charging with the schedule unchanged. GivHome does not write or restore HR242. Original pre-session restoration across restart, a complete live overnight boundary and a full recording replay remain unproved. Cleanup keeps HR96 disabled even if a captured schedule was enabled.

### Choosing a charging target in Home

Charge Target adds a percentage slider alongside the existing Home tiles. You can look at Solar 2mrw and choose how much room to leave in the battery without opening Homebridge settings.

The saved target is shared by Cheap Overnight, IOG charge-mode protection and timed Charge tiles. It does not enable charging, alter a charging period, change an export reserve or constrain solar charging. Its 4-100% range follows the validated general AC-charge control. Configuration now uses that same minimum.

The preference is saved atomically in a per-inverter local file, with restricted permissions. It survives restart; a changed configured target takes precedence. Hiding the tile returns to the configured target after restart. The file is separate from Homebridge's configuration, which is left untouched.

During a charge owned by this running instance, target changes use the shared command queue, fresh ownership checks, read-compare-correct-verify and only HR20/HR116 writes. Times, power, charge enable and the original cleanup snapshot remain unchanged. Rapid slider movements are combined, failed verification retains the requested target for retry, and a communication fault is published instead of claiming verified success. The percentage represents the requested target; HR242 remains diagnostic-only.

The tile has a new stable identity. Its exposure requires the existing control gates, a supported target profile and a charging feature; CE/AC also requires its explicit live-write gate. Invalid slider values and on/off attempts are refused without inverter writes. Existing accessories are not recreated.

### Giving Cheap Overnight its own time

This build gives enabled Cheap Overnight priority during the configured overnight period. Intelligent Octopus Go continues to follow its charging information, while holding back new battery-protection commands during that time.

The Cheap Overnight command uses the end of the overnight period you chose. When that period ends, the aim is to finish the command, put the borrowed settings back and hand over to IOG if a suitable Smart Window remains active. Otherwise, GivHome should return to Eco.

Offline tests cover that complete handover, including an IOG period continuing beyond the overnight end. Cheap Overnight uses its own configured end time rather than the combined cheap-period end. A full overnight boundary still needs live validation.

### Looking at the charging limits together

Before temporary charging, the build reads the existing AC charging settings and compares the general controls with the requested Battery Level. It changes differing values and checks them before enabling charging.

The saved settings now include the AC charge limit's enable setting, as well as the existing times, charge enable, power and general target. The build writes the saved general limits, times and power back when the temporary command ends and checks the complete restored set. As in 4.0.0, cleanup leaves charging disabled; it does not re-enable a previously enabled customer schedule.

Extending the same IOG command keeps the original snapshot. A new owner must finish the old command's cleanup before taking over. Unsupported target profiles and incomplete or invalid fresh settings are refused before charge writes. Requested general targets below 4% are refused, matching the compared command definitions.

On CH/All-in-One systems, it also reads the separate AC Charge 1 upper limit and reports a disagreement with the requested target. That limit is left unchanged until we establish a safe model-specific way to write it.

**The reported charging stop at 80% has not yet been proved fixed.** The separate limit may still affect AC charging. Reading back the requested general target is not proof that the battery will reach it.

For readers following the register investigation:

| Control | What this build does |
| --- | --- |
| `HR20` - AC charge upper-limit enable | Saves the existing value, compares it with the requested target setting and writes it back during restoration. |
| `HR116` - General AC charge upper SOC limit | Compares and checks the requested target before enabling charging; writes back the saved value afterwards. |
| General target settings | Requests `HR20=0`, `HR116=100` for 100%; requests `HR20=1`, `HR116=<target>` for a lower target. |
| `HR242` - CH/AIO AC Charge 1 upper SOC limit | Reads and reports a mismatch. This build does not automatically write it. |

### What we have checked, and what remains

The existing software checks, Predicted Solar tests and package checks pass. Twelve new offline tests exercise the charge and automation methods with a simulated inverter. They cover unsupported and invalid starts, general-limit restoration for CH2344G083, CE2225G298 and ED2151G182, restoration failure, command extensions, different owners, the overnight end, and handovers to or from IOG charge and pause protection.

Charge Target adds 20 setting and runtime tests, plus four tests using real Homebridge 2.4.0/HAP services and platform construction. These cover persistence, configuration precedence, native percentage handlers, control gates, burst updates, active changes across CH/CE/ED, failed verification, ownership, window boundaries and telemetry/stale-connection publication. All 36 runtime/native tests passed on the Pi's Node 24.21.0. The owner also exercised the Apple Home slider and observed active general-limit readback and the corrected tile presentation.

Before the first trial, the installed Pi source matched all 42 files in the published 4.0.0 package. Recorder evidence confirms IOG command resumption after restart, but not original pre-session snapshot restoration across restart. A complete recording replay, broader model validation and live overnight results remain outstanding. The [release record](docs/maintainer/RELEASING.md) describes the verified scope and limitations.

### Keeping the history available

Release notes and the full changelog are linked from the README and included in the npm package. A matching GitHub release body is prepared, and the published 4.0.0 history below is preserved.

Full Changelog comparison: [v4.0.0...v4.0.1](https://github.com/JayC68/homebridge-giv-iog-local/compare/v4.0.0...v4.0.1).

## 4.0.0 — Direct-local GivHome

4.0.0 promotes the validated 4.0.0-beta.3 direct-local implementation to the first stable v4 release. It retains the mature direct local GivEnergy telemetry and guarded control baseline, Intelligent Octopus Go / Smart Window behaviour, Cheap Overnight, Evening Excess Export, Flux and Agile export intelligence, Eve Energy history, Predicted Solar, fast cached Apple Home command state and background authoritative inverter reconciliation.

The public product remains `homebridge-giv-iog-local` / GivHome. The compatibility platform alias `GivHomeModbus` and established accessory identity recipes are deliberately retained to protect Homebridge/HomeKit continuity. Core local telemetry and control do not require GivTCP, MQTT or GivEnergy Cloud.

Release validation covers source/build integrity, Config UI parity against the mature 1.3.1 functional baseline, JavaScript syntax, release verification, Predicted Solar harness and npm publication contents. A production switchover from the live 1.3.1 controller was deliberately not performed as part of release preparation, to avoid placing two controllers in contention for the same inverter and HomeKit surfaces.

# GivHome — Changelog

## 4.0.0-beta.3 — Direct-local v4 convergence candidate

4.0.0-beta.3 uses the validated `homebridge-givhome-modbus` 1.3.1 implementation as its functional baseline and converts it into the established `homebridge-giv-iog-local` v4 product identity.

It retains the mature 1.3.1 behaviour: fast cached Apple Home command state with background authoritative inverter reconciliation, Eve Energy history, Predicted Solar, requested-energy-budgeted Flux export with observed-discharge stopping and single-peak protection, active Flux route recovery, Agile export intelligence, Intelligent Octopus Go / Smart Window behaviour, guarded manual controls and direct local GivEnergy Modbus telemetry.

The v4 conversion preserves the `GivHomeModbus` platform alias and existing v4 accessory UUID recipes, restores the GPL-3.0-or-later legal/support/publication layer, and keeps the 1.3.1 Smart Window improvement where the tile follows `cheapActive`.

This is an isolated build candidate. Live deployment requires offline validation followed by a fresh verified rollback of the currently running installation.

## Direct-Modbus development lineage incorporated into v4

The narrative below is retained because it documents how the implementation now used by v4 matured. Version numbers in this section refer to the earlier `homebridge-givhome-modbus` development line.

GivHome Modbus did not begin as a list of features. It began with ordinary problems we wanted to solve in our own energy system.

We wanted Homebridge to talk directly to the inverter instead of relying on layers of GivTCP and MQTT. We wanted Intelligent Octopus Go to charge the EV from cheap grid electricity without the home battery quietly helping it. And we wanted the result to feel at home in Apple Home rather than like an engineering console.

The releases below are the main steps from that beginning to the product we have now.
