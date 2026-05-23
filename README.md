# GivHome

Local-first Apple Home integration of your GivEnergy battery with optional Intelligent Octopus Go automation.

A clean Apple Home experience focused on stability, visibility, and predictable behaviour.

Designed for users who want reliable local control of their GivEnergy system without dependence on the GivEnergy cloud.

---

## Core Philosophy

### Local first

GivHome communicates locally with your inverter via GivTCP/REST.

Core automation and control continue operating even if external cloud services become unavailable.

### Predictable behaviour

Battery behaviour should be understandable.

GivHome prioritises deterministic scheduling and observed inverter state over aggressive automation complexity.

### Apple Home native experience

The project is designed around Apple Home and HomeKit behaviour:

- clean tile layout
- useful observability
- stable automations
- child bridge support
- Siri compatibility
- Eve app history integration

### Intelligent Octopus Go integration

GivHome fulfils:

- Off-Peak windows
- Intelligent Octopus smart dispatch windows
- grace periods
- prevents battery to EV drain

into a unified charging strategy.

---

## Key Features

### Intelligent Octopus Go automation

Automatically responds to:

- cheap-rate windows
- smart charging windows
- tariff transitions
- inverter schedule state

while maintaining stable overnight charging behaviour.

### Manual Charge and Export controls

Simple HomeKit switches for:

- Charge 30m
- Charge 60m
- Charge 90m
- Charge 120m
- Export 30m
- Export 60m
- Export 90m
- Export 120m

Manual controls reflect real inverter state.

### Real-time battery visibility

Observe:

- battery level (SOC)
- solar generation (PV power)
- grid import/export
- charge/discharge activity
- inverter operating state

all inside Apple Home app.

### Eve History integration

GivHome includes integrated historical energy tracking compatible with the Eve app.

Included history accessories:

- Eve Solar History
- Eve Import History
- Eve Export History

These accessories provide:

- historical graphs
- cumulative energy totals
- long-term trend visibility
- persisted history across restarts

while remaining lightweight and fully local.

---

## Installation

### Recommended image

The easiest installation method is the prebuilt GivHome Homebridge image for Raspberry Pi from:

https://givhome.kernowekconsulting.co.uk/

Features include:

- Homebridge preinstalled
- GivTCP preconfigured
- MQTT configured
- Apple Home ready
- local web management

---

## After Initial Installation to Setup

Open your browser and go to:

```text
givhome-pi.local
```

Create your own Homebridge username and password, or leave the default as `admin` / `admin`.

### Configure GivHome

Navigate to:

```text
Plugins → GivHome → Plugin Config
```

Enter:

- GivEnergy inverter IP
- inverter serial number
- Octopus account details
- Intelligent Octopus settings

Save and restart.

### Enable Child Bridge

For best HomeKit stability:

1. Open GivHome in Homebridge.
2. Press the purple bridge icon.
3. Enable Child Bridge.
4. Save and restart.

### Pair with Apple Home

Use the QR code shown on the GivHome accessory card inside Homebridge.

---

## Apple Home Notes

### Home View

Apple Home includes a summary area called Home View.

Many users prefer to exclude historical accessories from Home View to reduce clutter.

For the Eve History accessories:

1. Hold the tile.
2. Open Accessory Settings.
3. Turn off: **Include in Home View**.

### Tile organisation

Apple Home allows manual tile ordering.

To rearrange tiles:

1. Hold a tile.
2. Select **Edit Room**.
3. Reorder to suit your layout.

### Siri behaviour

GivHome functional tiles intentionally behave like HomeKit controls.

Be mindful when using broad Siri commands such as:

- “Turn off all lights” if you have not yet turned off **Include in Home View**

as this may affect active manual charge/export sessions.

---

## Eve App Support

The Eve app provides advanced graphing and historical visualisation for the Eve History accessories.

### Eve Solar History

Tracks:

- solar generation power
- cumulative solar generation
- historical generation trends

### Eve Import History

Tracks:

- grid import power
- cumulative imported energy
- overnight charging behaviour

### Eve Export History

Tracks:

- grid export power
- cumulative exported energy
- export session visibility

History persists across:

- Homebridge restarts
- child bridge restarts
- system reboots

---

## Stability

GivHome prioritises reliability.

The project deliberately avoids:

- cloud dependence
- excessive automation layers
- aggressive inverter manipulation
- hidden scheduling logic

The goal is a system that behaves consistently day after day.

---

## Advanced Notes

### GivTCP integration

GivHome uses:

- GivTCP MQTT telemetry
- GivTCP REST control
- local inverter communication

### MQTT

MQTT telemetry is used as the primary real-time observability source.

### REST control validation

Some upstream inverter or GivTCP REST acknowledgements may occasionally report unexpected slot values despite the inverter applying the correct behaviour.

Where possible, GivHome prioritises observed telemetry and resulting inverter behaviour rather than relying solely on REST response text.

---

## Supported Hardware

Tested primarily with:

- GivEnergy All In One
- Intelligent Octopus Go
- Raspberry Pi 4
- Apple Home
- Eve app

---

## Credits

Built on top of the excellent work from:

- Homebridge
- GivTCP
- Eve Systems / Matthias Hochgatterer (Fakegato history)
- MQTT ecosystem contributors
- Apple Home community
- Intelligent Octopus user community

---

## Disclaimer

GivHome is an independent community project and is not affiliated with:

- GivEnergy
- Octopus Energy
- Apple
- Homebridge

Use at your own discretion.


## Excess Energy Export beta

`3.6.0-beta.3` introduces an optional local Excess Energy Export beta. It is disabled by default. When enabled, GivHome can run an evening sell-off of unused battery energy after normal evening household demand and before the next cheap overnight window.

The logic uses a MrMessy/WonderWatt-style SOC ladder: the closer the system gets to the cheap-rate start, the lower the required reserve can be. This is intended for Intelligent Octopus Go users with fixed export where the battery was filled cheaply overnight and still has surplus energy after cooking, hot water and normal evening use.

GivHome does not currently attempt to pause the battery during the day using local REST controls. Daytime solar therefore continues to follow normal inverter behaviour: house load first, then battery charging, then export overflow once the battery is full. Future builds may probe for additional local REST options if they prove safe.


## 3.6.0-beta.4 Excess Energy Export beta

This beta exposes the full local evening sell-off control set in the Homebridge UI: Enable Excess Energy Export, Battery Capacity, Evening Export Start Time, Max Export Power, Reserve SOC, SOC Safety Margin, Slot Duration, and Serve Overnight Load From Battery. The feature remains opt-in and is designed to use local GivTCP controls only.
