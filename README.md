# GivHome

**Your battery quietly does the right thing, automatically.**

GivHome brings local GivEnergy battery automation into Apple Home. It is built for households that want their battery to behave sensibly without having to manage charge slots, export rules, state of charge and tariff windows every day.

GivHome is local-first, Apple Home friendly, and designed around Intelligent Octopus Go.

It helps your system:

- charge during cheap Intelligent Octopus Go windows
- avoid EV charging unexpectedly draining the home battery
- expose useful battery, solar, import and export information in Apple Home
- provide simple manual Charge and Export controls
- record local energy history for the Eve app
- optionally export excess evening energy before the overnight cheap window
- optionally charge more gently overnight with Battery Care Charging
- warn and block automation when GivTCP telemetry becomes stale

GivHome is an independent community project. It is not affiliated with GivEnergy, Octopus Energy, Apple or Homebridge.

---

## Why GivHome exists

Home batteries are valuable. They should not need constant attention.

GivHome started because Intelligent Octopus Go EV charging sessions could unintentionally drain a GivEnergy home battery. The original goal was simple: protect the battery during smart charging and make the system easier to understand inside Apple Home.

The project has grown from there, but the principle is unchanged:

> keep battery automation local, visible and predictable.

That matters even more when owners are thinking about long-term battery health, warranty uncertainty, cloud availability, or manufacturer support. GivHome cannot make warranty promises, but it can help owners run their battery in a calmer, more considered way.

---

## What GivHome does

### Intelligent Octopus Go automation

GivHome watches your normal overnight cheap period and Intelligent Octopus Go smart dispatch windows, then uses local GivTCP controls to schedule battery charging.

It understands:

- the main off-peak window, usually 23:30-05:30
- Octopus smart dispatch windows
- short grace periods at tariff boundaries
- battery target SOC
- local inverter state

The aim is simple: charge the home battery when electricity is cheap and stop the EV from pulling energy out of it unnecessarily.

### Telemetry Freshness Guard

From v3.7.0-beta.1, GivHome includes a passive telemetry freshness guard.

This does **not** add inverter polling, Modbus reads or extra GivTCP traffic. It watches the `Stats.Last_Updated_Time` value already published by GivTCP and decides whether the cached telemetry is still fresh enough to trust.

If telemetry becomes stale, GivHome can still display the last known values, but it will mark the system as degraded and block automation from acting on potentially old SOC or power data.

In plain English:

> stale but believable battery data is more dangerous than clearly unavailable data.

The guard protects:

- Intelligent Octopus automatic charging
- Battery Care Charging
- Excess Energy Export
- manual Charge controls
- manual Export controls
- future automation features using SOC or power telemetry

A new `GivHome Telemetry` tile is shown in Apple Home. It is on/bright when telemetry is fresh, dimmed when stale, and effectively off when offline/critical.

Default thresholds are deliberately conservative:

- Fresh: under 180 seconds
- Stale: 180-599 seconds
- Offline/Critical: 600 seconds or more

The feature is designed as a safety layer. It does not restart GivTCP, ping the inverter, test port 8899 or write raw registers.

### Battery Care Charging

Battery Care Charging is optional and disabled by default.

It is GivHome's first Smooth Charging feature. During the main overnight cheap window, where there is usually enough time to be gentle, GivHome can reduce unnecessary high-rate charging and use a kinder local charge-rate percentage instead.

In plain English:

> If there is time to charge more gently overnight, GivHome can do that for you.

Battery Care Charging is not about charging slowly at all costs. It still aims to reach your configured target by the end of the overnight cheap window. The point is to avoid hammering the battery at maximum charge rate when there is no need.

This may help with:

- quieter overnight operation
- less abrupt grid import
- less avoidable battery stress
- calmer long-window charging
- better long-term treatment of an expensive battery asset

Battery Care Charging only runs during the main overnight cheap slot. Extra Intelligent Octopus smart slots, short windows, grace periods and manual charge sessions continue to use standard charging.

#### Maximum Battery Charge Power

GivHome must know your system's maximum battery charge power before Battery Care Charging can run.

That value is required because GivTCP's local `setChargeRate` control is a percentage. 100% means different things on different systems.

Examples:

- on a 6kW system, 50% is about 3kW
- on a 2.6kW system, 50% is about 1.3kW

Enter the real maximum for your system, or a deliberate lower maximum if you want GivHome to treat that as your safe working limit.

#### Battery Care modes

- **Gentle** — lower charge rates where practical
- **Balanced** — recommended starting point
- **Strong** — more headroom to reach target

Start with **Balanced** unless you have a clear reason to do otherwise.

### Excess Energy Export

Excess Energy Export is optional and disabled by default.

From v3.6.4, automated evening export also sets the requested discharge power through GivTCP before creating the export slot. This matters because some GivEnergy systems will not export meaningfully from a timed discharge slot unless a discharge rate is explicitly set. GivHome uses the public GivTCP `/setDischargeRate` REST abstraction rather than writing raw inverter registers directly.


It is designed for homes that sometimes reach the evening with more battery energy than they need before the next cheap charging window.

When enabled, GivHome can create a short local export slot later in the evening, after normal household demand has usually settled, while keeping enough charge for your home to get you to the cheap overnight window.

In plain English:

> GivHome can sell some spare battery energy in the evening, but keeps a sensible reserve so the house is not left short before cheap electricity returns.

It is not Agile export optimisation. It does not chase live Agile prices. It is local Intelligent Octopus Go-aware evening export management.

Excess Energy Export can:

- start from a configurable evening time
- check battery SOC before exporting
- keep a reserve for the rest of the evening
- stop before the cheap overnight window
- avoid running during cheap, smart or grace windows
- return the system to normal ECO behaviour afterwards

It replaces the need for stacks of manual Apple Home export automations.

### Manual Charge and Export controls

GivHome creates simple Apple Home controls for common manual actions:

- Charge 30m
- Charge 60m
- Charge 90m
- Charge 120m
- Export 30m
- Export 60m
- Export 90m
- Export 120m

The manual tiles are truth-based: they reflect live inverter schedule state rather than only remembering what the plugin last requested.

From v3.7.0-beta.3, timed Charge and Export actions include a gentle write/readback/verify lifecycle. This applies to manual timed Charge/Export actions, Intelligent Octopus Go smart-window charging, and the fallback 23:30-05:30 cheap charging window. After GivHome writes a start or clear command, it reads back the existing GivTCP cache and verifies the observed inverter schedule state. Clear verification checks charge/discharge slots 1-10 so hidden slot persistence is detected rather than missed. This is designed to make unwanted persistent charge/export state less likely without adding background polling or extra Modbus traffic.

### Apple Home visibility

GivHome brings useful battery information into Apple Home, including:

- battery level
- solar generation
- grid import/export
- charging and discharging state
- manual charge/export controls
- optional extra indicators

Apple Home does not provide native battery-management tile types, so GivHome uses reliable HomeKit accessory types to make states visible and controllable.

### Eve energy history

GivHome can create Eve-compatible history accessories for:

- solar generation
- grid import
- grid export

These are local history records, useful for seeing patterns over time in the Eve app. The history persists across Homebridge restarts and system reboots.

For a cleaner Apple Home dashboard, many users set Eve history accessories to **Exclude from Home View**.

---

## Recommended installation

The easiest route is the prebuilt GivHome Homebridge image for Raspberry Pi:

https://givhome.kernowekconsulting.co.uk/

The image includes:

- Homebridge
- GivTCP
- MQTT
- GivHome
- local web management

After first boot, open:

```text
givhome-pi.local
```

If that does not open, check your router or network app for the Raspberry Pi IP address and open that instead.

---

## First setup

### 1. Sign in to Homebridge

Open `givhome-pi.local` and create a Homebridge username and password.

### 2. Configure GivHome

Go to:

```text
Plugins → GivHome → Plugin Config
```

Enter the required details:

- Battery Serial Number
- Inverter IP Address
- Octopus Account Number
- Octopus API Key

For most users, the defaults are suitable for Intelligent Octopus Go.

### 3. Enable the Child Bridge

For the cleanest Apple Home experience:

1. Open the GivHome plugin card in Homebridge.
2. Press the purple bridge icon.
3. Enable Child Bridge.
4. Save and restart.

### 4. Pair with Apple Home

Use the QR code shown on the GivHome card in Homebridge, or enter the 7-digit pairing code in the Apple Home app.

---

## Recommended first settings

### Battery Care Charging

Start with:

- Battery Care Charging: off until the rest of the system is stable
- Battery Care Mode: Balanced
- Minimum Overnight Time Remaining: 90 minutes
- Maximum Battery Charge Power: your system's real maximum battery charge power

Only enable Battery Care Charging after you are confident that normal GivHome charging is working correctly.

### Excess Energy Export

Start conservatively:

- Excess Energy Export: off until you understand the behaviour
- Evening Export Start Time: 19:30 or 20:00
- Reserve SOC: 20%
- SOC Safety Margin: 2%
- Slot Size: 30 minutes
- Serve Overnight Load From Battery: off

Then adjust based on your home, battery size and evening use.

### Telemetry Freshness Guard

Leave this enabled unless you are deliberately diagnosing an unusual GivTCP installation.

Recommended starting values:

- Telemetry Freshness Guard: on
- Fresh Threshold: 180 seconds
- Offline Threshold: 600 seconds

These settings add no inverter traffic. They only inspect freshness information already supplied by GivTCP.

### Timed Action Write Verification

Leave this enabled unless diagnosing an unusual GivTCP installation. GivHome uses it only after a manual timed Charge or Export cleanup write.

Recommended starting values:

- Verify Timed Action Clears: on
- Write Verification Delay: 8 seconds
- Write Verification Attempts: 2

The verification reads GivTCP's existing cache after the clear command. It does not poll the inverter continuously and does not add a new Modbus loop.

---

## Apple Home notes

### Keep the dashboard calm

Apple Home can become busy. For tiles you do not use every day, open the accessory settings and turn off:

```text
Include in Home View
```

This is especially useful for Eve history accessories and advanced indicators.

### Siri caution

Some functional GivHome controls may appear as switches or lights because Apple Home does not have native battery automation controls.

Be careful with broad Siri commands such as:

```text
Turn off all lights
```

unless you have excluded non-daily GivHome tiles from Home View and Siri routines.

---

## Known GivTCP behaviour

Some GivTCP REST acknowledgements can occasionally report surprising human-readable slot text, even when the requested behaviour is applied correctly.

GivHome therefore treats REST response text as a low-trust acknowledgement and prioritises:

- live MQTT telemetry
- observed SOC
- charge/discharge power
- live schedule state where available
- actual inverter behaviour over time

This is intentional.

---

## Supported environment

GivHome is primarily tested with:

- GivEnergy All In One
- GivTCP local control
- Intelligent Octopus Go
- Raspberry Pi / Homebridge OS
- Apple Home
- Eve app

Parallel AIO / GivGateway systems are expected to work where the gateway presents the system as one combined battery, but this remains newer territory and should be approached carefully.

---

## Stability philosophy

GivHome favours calm, predictable automation over clever-looking behaviour that is hard to trust.

The project deliberately avoids:

- dependence on the GivEnergy cloud for core control
- hidden cloud automation platforms
- unnecessary inverter writes
- aggressive behaviour during short windows
- changing standard charging when a beta feature is not active

The goal is simple:

> set it up, understand the behaviour, then let it quietly get on with the job.

---

## Credits

Built on top of excellent work from:

- Homebridge
- GivTCP
- fakegato-history / Eve history community work
- MQTT ecosystem contributors
- Apple Home users and testers
- Intelligent Octopus Go users sharing real-world behaviour

Special thanks to the GivEnergy and Octopus user communities whose practical testing has shaped GivHome's behaviour.

---

## Disclaimer

GivHome is an independent community project and is not affiliated with GivEnergy, Octopus Energy, Apple or Homebridge.

Use at your own discretion. Battery and inverter behaviour can vary by model, firmware, configuration and installation. Always use settings that make sense for your own system.
