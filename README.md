# GivHome for Homebridge

GivHome brings compatible GivEnergy battery and inverter systems directly into Apple Home.

It talks locally to the inverter over Modbus TCP, brings Octopus Energy information into the decisions that matter, keeps local energy history and can forecast tomorrow's solar generation.

That is where the project is now. It started with a much simpler problem.

## Why we built it

Our earlier GivHome work proved that Homebridge could make a GivEnergy system much nicer to live with, using GivTCP and MQTT between Homebridge and the inverter.

The direct-local v4 work began by asking whether we could remove those extra layers and talk safely to the inverter ourselves.

At about the same time, Intelligent Octopus Go exposed another very practical problem: when Octopus starts a cheap EV charge, the home battery can see the car as just another large household load and discharge into it.

That is exactly what we did not want. Cheap grid electricity should charge the EV; stored battery energy should stay in the battery for the house.

Those two ideas shaped GivHome v4: **understand what the inverter is really doing, and understand enough about why energy is moving to do something useful about it.**

## v4 beta identity and installation

This package is `homebridge-giv-iog-local` **4.0.0**. It keeps the established `GivHomeModbus` Homebridge platform alias and existing accessory UUID recipes so a v4 upgrade can reuse cached accessories rather than creating replacements.

For a normal release, install through the Homebridge UI. For this beta, use only a validated package and follow the v3-to-v4 migration and safety notes in `docs/`.

Core monitoring and local control use direct local Modbus TCP; GivTCP, MQTT and GivEnergy Cloud are not required for the v4 local-control path.

## Intelligent Octopus Go and Smart Window

One of the founding jobs of the Octopus integration was protecting the home battery while the EV was charging.

GivHome uses Intelligent Octopus Go dispatch information to recognise when Octopus has scheduled a cheap charging period. In Apple Home we call that a **Smart Window**.

That means GivHome does not have to treat a sudden EV load as ordinary household demand. It knows that Octopus is deliberately charging the car and can protect the home battery accordingly.

It also means GivHome can recognise extra cheap periods that Octopus schedules outside the normal overnight tariff window.

What began as *don't let the battery charge the car* became the foundation of GivHome's wider tariff awareness.

## Cheap Overnight

There is still a dependable cheap overnight period, and GivHome can use it to charge the battery towards the chosen target Battery Level.

This sounds simple, but doing it safely means respecting schedule ownership. GivHome keeps its own overnight schedule space, handles the midnight boundary properly and does not assume that every schedule already in the inverter belongs to us.

The user sees **Cheap Overnight**. The awkward scheduling details stay inside GivHome where they belong.

## Battery control from Apple Home

GivHome provides practical controls for the things we actually want to do with a home battery: timed charging, timed export, and charge or discharge pause controls.

A timed command is not intended to be a HomeKit switch that simply remembers the last tap. GivHome issues the inverter command through guarded control paths, observes the resulting state and manages the end of the command.

The 4.0.0 direct-local baseline improves this further. Apple Home now gets the latest known state immediately, so Home opens quickly. In the background, GivHome goes back to the inverter and checks the authoritative state. If reality has changed, HomeKit is corrected.

We proved that through a real 30-minute export: the command started, the inverter physically exported, GivHome independently observed it, the period expired naturally and the Apple Home tile returned to Off.

**Fast Home. Inverter truth. We no longer have to choose between them.**

## Evening Excess Export

Once GivHome could charge intelligently and control export safely, the next question was obvious: when is stored energy genuinely spare?

**Evening Excess Export** is about selling energy that the household can afford to give up, rather than simply emptying the battery because an export period has arrived.

GivHome considers the available battery energy, reserve, margin and permitted export window before acting. If the conditions are not right, it does nothing.

The important word is **Excess**.

## Octopus Flux Export

Flux took the export work further. A valuable evening export period is useful, but only if the battery can use it without sacrificing the energy the household wants to keep.

GivHome's Flux work became capacity-aware: how much energy is available, what must remain in reserve, how long is the useful window and how much do we actually intend to sell?

Live testing also taught us an important lesson. On our AIO evidence, the inverter could accept an export-power setting and read the requested value back while physically discharging at considerably more power than that setting suggested.

So GivHome stopped treating a successful register readback as proof of physical behaviour. Where it matters, requested settings and observed battery behaviour are treated as different things.

That lesson captures much of this project: **what the inverter actually does outranks what we hoped a register would mean.**

## Agile Outgoing

Agile Outgoing adds changing half-hour export prices to the picture.

GivHome can obtain Agile Outgoing rates from Octopus, examine the available periods and plan around battery reserve, available energy and the permitted export window.

The Agile work has deliberately been cautious. Planning, observed export and live control have been separated by explicit safety gates while the behaviour is proved.

Where the required Octopus account information is configured, GivHome can also compare export recorded by Octopus for the export MPAN with export observed at the inverter. That gives us two independent views of what happened rather than simply assuming our own measurement must be right.

## One Octopus story

Smart Window, Cheap Overnight, Evening Excess Export, Flux and Agile are not a collection of unrelated tariff switches.

Together they are GivHome learning the context around the energy system.

The inverter knows about the battery. Octopus knows about cheap periods, EV dispatches and export prices. GivHome brings those pieces together locally and turns them into a few understandable choices in Apple Home.

Cheap electricity can become stored energy. An EV Smart Window can protect that stored energy. Genuine excess can be sold. A valuable export period can be planned rather than guessed.

The complexity belongs in GivHome, not in the user's evening routine.

## Eve Energy — what happened before now?

Apple Home is good at showing what is happening now. Energy systems also need history.

GivHome provides separate local Eve Energy histories for:

- Solar
- Grid Import
- Grid Export

The history is stored locally and cumulative totals survive restarts, giving useful Eve graphs without sending household telemetry to another cloud service.

This work also reinforced an important rule: existing HomeKit accessories belong to the user's home, not to our development process. We put considerable effort into adding Eve history without casually changing accessory identities and disrupting established rooms, favourites and automations.

## Predicted Solar — what about tomorrow?

After *now* and *history*, the next useful question was tomorrow.

**Predicted Solar** uses Open-Meteo Global Tilted Irradiance together with the physical details of the PV installation to estimate the following day's generation.

It can model more than one array, each with its own capacity, tilt, direction and shading period.

Shading is deliberately simple: during a configured period the array is shaded or it is not. We did not want to ask normal users to invent a reassuring-looking percentage for how much a tree, chimney or neighbouring building reduces production.

The forecast is condensed into **Solar 2mrw** in Apple Home.

Predicted Solar is optional, read-only and separate from inverter control. Losing an internet forecast must not stop the local battery system from working.

## Local first, but not blindly local

The core relationship remains direct local Modbus communication with the inverter. Everyday telemetry and supported controls do not need a manufacturer's cloud service in the middle.

But GivHome is not dogmatic about avoiding useful external information. Octopus APIs tell us things the inverter cannot know. Open-Meteo tells us something about tomorrow. Those services add context; they do not replace local inverter control.

## Safety grew with the product

Battery control deserves more care than an ordinary light switch.

GivHome has grown around a few straightforward rules:

- discover capabilities rather than assuming every inverter is the same;
- preserve existing state before changing it;
- know which commands and schedules belong to GivHome;
- verify important writes and restore state when controlled operations finish;
- distinguish requested settings from observed physical behaviour;
- do not let one automation claim an unrelated command;
- when fresh truth cannot be obtained, do not invent it; and
- change our assumptions when real inverter evidence proves them wrong.

Occasional Modbus receive timeouts have existed throughout the wider GivHome work. GivHome uses retry and continuity mechanisms and fails safely when a fresh read cannot be obtained. A failed read is not permission to make a corrective inverter write.

Different GivEnergy families also expose different capabilities. GivHome therefore uses family and capability evidence rather than assuming that something proved on one model is automatically safe on another.

## Where we are now

GivHome started with a narrow ambition: **talk directly to the inverter.**

It has become much more than that.

4.0.0 brings together direct local telemetry, guarded battery control, Intelligent Octopus Go Smart Windows, Cheap Overnight charging, Evening Excess Export, Flux and Agile tariff intelligence, Eve Energy history and tomorrow's solar forecast.

Those features matter individually. What we are proud of is that they now belong to one coherent system.

A normal user should not need to understand Modbus registers, GraphQL, tariff endpoints, MPAN data, irradiance models or HomeKit caching to make sensible use of a battery and EV.

**That complexity is our problem. GivHome's job is to make the result feel simple.**

## A note about the data

GivHome presents the energy details held by your inverter. We cannot verify their accuracy.

Forecasts are forecasts, tariff information can change, and different inverter families expose different capabilities. GivHome uses safeguards and evidence-led capability decisions, but users remain responsible for ensuring their inverter, battery, tariff and installation are configured appropriately.

## About GivHome

GivHome is developed by Kernowek Consulting as part of the wider GivHome project.

It was born from wanting our own home energy system to work better: keep the battery out of an EV charge when cheap grid energy is available, make useful battery controls available in Apple Home, and remove unnecessary layers between the home and its inverter.

It has grown by repeatedly asking three simple questions:

**What is the inverter really doing?**

**Why is the energy moving?**

**How much of that complexity should the person living in the house have to see?**

For the last one, the answer is still: **as little as possible.**

## Support, safety and licence

See `docs/SAFETY.md`, `docs/TROUBLESHOOTING.md`, `SUPPORT.md`, `SECURITY.md`, `NOTICE` and `TRADEMARKS.md`.

GivHome v4 is released under `GPL-3.0-or-later`.

GivHome presents the energy details held by your inverter. We cannot verify their accuracy. Use battery and export controls carefully.
