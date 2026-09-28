# Changelog

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
