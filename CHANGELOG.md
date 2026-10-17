# Changelog

This is the story of GivHome v4 and the direct-Modbus work that led to it. The [earlier v3 changelog](docs/CHANGELOG_V3.md) and [published release notes](https://github.com/JayC68/homebridge-giv-iog-local/releases) keep the earlier public history available too.

[Release notes for 4.0.3-beta.3](RELEASE_NOTES.md) explain the current features and limitations. Each older entry records what was done and proved at that point in the project's history.

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

Before the first trial, the installed Pi source matched all 42 files in the published 4.0.0 package. Recorder evidence confirms IOG command resumption after restart, but not original pre-session snapshot restoration across restart. A complete recording replay, broader model validation and live overnight results remain outstanding. The [release record](docs/RELEASING.md) describes the verified scope and limitations.

### Keeping the history available

Release notes and the full changelog are linked from the README and included in the npm package, together with the archived v3 history. A matching GitHub release body is prepared, and the published 4.0.0 history below is preserved.

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

## 1.3.1 — Fast Home, authoritative inverter truth

1.3.1 resolves a compromise we were no longer prepared to accept.

Apple Home needs switches to respond quickly. A battery controller also needs those switches ultimately to reflect what the inverter is actually doing.

Earlier authoritative HomeKit reads could wait for Modbus and make Home painfully slow when a transaction was slow. Caching the state fixed that speed problem, but created another risk: Home could continue displaying old information after the inverter had changed.

1.3.1 combines the two approaches.

HomeKit receives GivHome's latest known state immediately. Separately, a read-only background reconciler checks the inverter from one shared register snapshot and corrects HomeKit when reality differs.

During beta testing we found that a standalone HR112 export-power read was an unreliable shape for this new background check. The reconciler now obtains export-power truth from the grouped HR111-HR116 block instead. This was a surgical correction to the new reconciliation path, not a rewrite of the established Modbus architecture.

We then proved the complete lifecycle on the live system. A 30-minute export was started through Apple Home, independently confirmed as physically exporting, observed by the background reconciler and allowed to expire naturally. GivHome changed the Export 30m tile from On to Off, existing cleanup completed and the inverter returned to neutral export state. The reconciler made no inverter write.

Occasional general Modbus receive timeouts remain fail-safe: if fresh authoritative truth cannot be obtained, the existing HomeKit state is retained rather than guessed.

The result is deliberately simple: **Home opens quickly, and GivHome still goes back to the inverter for the truth.**

## 1.3.0 — Tomorrow joins the picture

1.3.0 brought **Predicted Solar** into GivHome.

The aim was not another weather display. We wanted to answer a useful household-energy question: **how much solar are we likely to have tomorrow?**

Predicted Solar uses Open-Meteo Global Tilted Irradiance together with the size, tilt, direction and shading periods of the configured PV arrays. Shading is deliberately binary and the performance factor is kept internal rather than asking users to invent engineering percentages.

The result appears in Apple Home as **Solar 2mrw**.

Predicted Solar is optional, read-only and isolated from Modbus control. A forecast or internet failure cannot intentionally prevent the local inverter platform from operating.

This release also improved the everyday Apple Home presentation while retaining the established control, Octopus and Eve architecture.

## 1.2.0 — Energy history becomes part of the home

1.2.0 promoted the proven Eve Energy implementation into production.

GivHome gained independent local histories for **Solar**, **Grid Import** and **Grid Export**, with cumulative totals surviving restarts.

Getting there took several iterations because adding a graph is easy compared with adding one without disturbing an established HomeKit home. Accessory identities, cached service shapes, rooms, favourites and automations all matter.

The final implementation therefore concentrated as much on preserving the user's existing Home as it did on recording history.

## 1.1.x — From direct Modbus to an energy controller

The 1.1 development line is where GivHome Modbus grew from local inverter communication into a useful home energy controller.

### Intelligent Octopus Go and Smart Window

One of the founding purposes of the Octopus work was simple: **when Octopus is cheaply charging the EV, do not let the home battery dump its stored energy into the car.**

To the inverter an EV charger can look like any other large household load. GivHome learned to use Intelligent Octopus Go dispatch information to recognise the cheap EV charging period — the **Smart Window** — and give the battery the context it was missing.

That also meant GivHome could recognise additional cheap periods allocated by Octopus outside the normal overnight window.

### Cheap Overnight

The dependable overnight cheap period became its own battery automation. GivHome can charge towards the configured target while owning only its designated schedule space, handling midnight correctly and leaving unrelated inverter schedules alone.

### Manual and timed battery control

Guarded manual charging, timed charging and timed export were developed progressively, with readback, command ownership and restoration around the inverter writes.

Pause controls followed the same principle: make useful battery actions simple in Apple Home without pretending the underlying inverter control is trivial.

### Evening Excess Export

Once charging and export were understood, GivHome could ask a more useful question than simply *can we export?*

**Evening Excess Export** considers whether the battery genuinely has energy available above the reserve and margin before using the evening export opportunity. The purpose is to sell excess, not blindly empty the battery.

### Octopus Flux Export

Flux introduced capacity-aware export planning around a valuable evening period.

Live AIO testing then taught us one of the project's most important lessons. The inverter could accept and read back an HR112 export-power value while physically discharging at substantially more power than that value implied.

GivHome changed its model rather than arguing with the evidence. Requested export settings and observed battery behaviour are treated separately where that distinction matters, and observed discharge can be used to protect the intended energy budget.

### Agile Outgoing

Agile added changing half-hour export prices. GivHome can obtain Octopus Agile Outgoing rates, evaluate available periods and plan around battery reserve, available energy and permitted export windows.

Live operation has deliberately remained behind explicit safety gates while the automation is proved. Where configured, Octopus export-MPAN data can also be compared with inverter-observed export, giving us supplier evidence as well as our own.

Taken together, the Octopus work marked an important change in the project. GivHome was no longer only observing **where** electricity was moving. It was beginning to understand enough about **why** it was moving to make better decisions.

## Earlier development — learning before commanding

The earliest direct-Modbus work was deliberately conservative.

Before exposing battery controls, GivHome had to learn how supported GivEnergy families identify themselves, which register ranges and capabilities apply to which systems, how to preserve existing state and how to recover safely after commands.

That work produced the capability discovery, register authority, transport gating and safety foundations that the later features rely on.

Some internal modules still carry their original Stage or beta-era names. Where those names form part of established diagnostics, tests or engineering history they have deliberately been retained rather than cosmetically renamed for this release.

## Where 1.3.1 leaves GivHome

GivHome Modbus began by asking whether Homebridge could talk directly to a GivEnergy inverter.

By 1.3.1 it brings together direct local telemetry and guarded control, Intelligent Octopus Go Smart Windows, Cheap Overnight, Evening Excess Export, Flux and Agile tariff intelligence, Eve Energy history and Predicted Solar.

The individual features matter. The bigger achievement is that they now make sense as one system.

**The inverter supplies the facts. Octopus and Open-Meteo add context. GivHome turns that complexity into something useful in the home.**
