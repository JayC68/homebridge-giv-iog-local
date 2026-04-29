# GivEnergy Local + Intelligent Octopus Go

A local-first Homebridge plugin for GivEnergy inverters, bringing reliable battery control and Intelligent Octopus Go optimisation into Apple Home.

## What this plugin does

This plugin brings clean local control of your GivEnergy battery system into Apple Home via Homebridge.

It offers:

- Intelligent Octopus Go dispatch-aware battery charging
- Grace period handling after smart charging sessions
- Charging during your configured **Off-Peak Hours**, with a default of `23:30–05:30`
- Manual **Force Charge** and **Force Export** with configurable durations
- Battery SoC shown as a clear percentage tile
- Solar generation shown in Home, including **Off** at night
- Useful status sensors for:
  - Cheap Rate
  - Grace Period
  - Smart Window
  - Charging
  - Discharging
  - Importing
  - Exporting
  - Online

All inverter control commands are sent over your local network. The plugin does not rely on GivEnergy cloud control.

## Architecture

The plugin is designed to work with:

- **GivTCP** — local inverter telemetry via MQTT and local inverter control via REST
- **Mosquitto** or another MQTT broker
- **Octopus Energy API** — only for retrieving Intelligent Octopus Go dispatch windows

In practice:

- **Reading telemetry** → MQTT from GivTCP
- **Writing control commands** → local GivTCP REST API
- **Smart charging logic** → Octopus API polling for cheap-rate windows

## Requirements

You will need the following running on your local network:

- GivTCP
- an MQTT broker, such as Mosquitto
- Homebridge

Disable any other plugins or automations that may send conflicting commands to the inverter.

## Main controls in Apple Home

- **Force Charge** — starts a timed local charge window using the REST slot system
- **Force Export** — starts a timed local discharge/export window using the REST slot system
- **Automatic IOG Charging** — opens a battery charge window during Intelligent Octopus Go cheap periods and handles the grace period cleanly
- **Off-Peak Hours Charging** — charges during your configured off-peak hours when no smart dispatch is active

Turning a manual switch off, or letting its timer expire, automatically clears the temporary slot and returns the inverter to normal operation.

## Important notes

- All inverter control is performed locally on your network
- This plugin is intended to be the primary controller for scheduled charging and export
- Avoid overlapping control from other plugins, apps, or automations
- Energy management actions are taken at your own risk, so test carefully before relying on unattended automations

## Configuration

Key settings include:

- MQTT broker details and root topic
- inverter serial number
- GivTCP REST URL, default `http://127.0.0.1:6345`
- Octopus Energy API key and account number for IOG
- off-peak hours start and end
- grace minutes after smart sessions
- Force Charge and Force Export durations
- battery usable capacity, maximum charge power, and related tuning values

Full configuration options are available in Homebridge.

## Installation

Install the plugin through the Homebridge UI or via npm.

Then:

1. configure the required fields, especially MQTT, GivTCP REST URL, and Octopus details if using IOG
2. restart Homebridge
3. add the new accessories in the Home app
4. test behaviour during a cheap period before relying on automation


## 3.2.5

Critical fix release.

Changes:
- corrects Off-Peak Hours charging logic so the default `23:30–05:30` baseline window continues to run even when Octopus polling is healthy
- keeps Smart Charging and Grace Period additive on top of the baseline cheap window, rather than replacing it
- removes stale internal Smooth Charging references from the active automation path

Behaviour:
- Off-Peak Hours remain the always-available default cheap window unless the user changes those settings
- Smart Charging can overlap, extend before, continue through, or finish after Off-Peak Hours
- charging now activates whenever either Off-Peak Hours or Smart Charging makes the period cheap
