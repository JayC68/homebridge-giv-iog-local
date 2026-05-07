# GivHome

GivHome brings Intelligent Octopus Go smart charging to your GivEnergy battery — automatically, locally, and beautifully inside Apple Home.

## What this plugin does

GivHome brings clean local control of your GivEnergy battery system into Apple Home via Homebridge.

It offers:

- Intelligent Octopus Go dispatch-aware battery charging
- Grace period handling after smart charging sessions, rounded to the end of the current `:00` or `:30` half-hour period
- Charging during your configured **Off-Peak Hours**, with a default of `23:30–05:30`
- Manual timed charge and export tiles:
  - Charge 30m / 60m / 90m / 120m
  - Export 30m / 60m / 90m / 120m
- Manual tile state synced from the live inverter schedule where GivTCP publishes schedule enable and slot start/end telemetry
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
  - Update Available

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

- **Charge 30m / 60m / 90m / 120m** — starts a timed local charge window using the GivTCP REST slot system
- **Export 30m / 60m / 90m / 120m** — starts a timed local discharge/export window using the GivTCP REST slot system
- **Automatic IOG + Off-Peak Charging** — runs in the background, opening a battery charge window during Intelligent Octopus Go smart dispatches and your configured off-peak hours

Turning any Charge tile off neutralises the charge slot and disables the local charge schedule. Turning any Export tile off neutralises the export slot and disables the local discharge schedule.

## Live manual tile state

Manual switch state is truth-based where telemetry is available. The plugin checks the live charge/discharge schedule enable state and slot 1 start/end times, then lights the matching duration tile within the configured slot tolerance.

This means:

- neutral schedules show manual tiles as off
- a live 30, 60, 90, or 120 minute charge/export slot can light the matching tile
- plugin-side command state is only used briefly as a pending overlay immediately after you press a tile

## Important notes

- All inverter control is performed locally on your network
- This plugin is intended to be the primary controller for scheduled charging and export
- Avoid overlapping control from other plugins, apps, or automations
- Energy management actions are taken at your own risk, so test carefully before relying on unattended automations

## Configuration

Most users only need:

- Battery / inverter serial number
- Maximum solar power in kW, used to scale the Solar Power tile
- Octopus account number and API key for Intelligent Octopus Go dispatch windows

The serial number can be found in the GivEnergy app: **Settings → Local Monitoring → Scan for your inverter**.

The Octopus API key can be found in your Octopus Energy online account under Developer Settings / API access.

Optional behaviour settings include:

- Target Charge %, default `100`
- Off-Peak Start and End, default `23:30–05:30`
- Grace Period, default `30` minutes, which means continue only until the end of the current half-hour period

Advanced settings for MQTT, GivTCP REST, polling, slot tolerance, activity thresholds, update checks, and telemetry thresholds are available in Homebridge but are prefilled for the standard local setup.

## Installation

Install the plugin through the Homebridge UI or via npm.

Then:

1. configure the required setup fields
2. restart Homebridge
3. add the new accessories in the Home app
4. test behaviour during a cheap period before relying on automation

## 3.4.2-beta-1

Beta readiness release.

Changes:
- adds `CHANGELOG.md` so Homebridge can display release notes during plugin updates
- improves the GivHome setup landing page logo placement
- separates intentional grid/smart charging notification threshold from lower solar-to-battery charging visibility
- keeps the internal Homebridge platform identifier unchanged for upgrade compatibility

## 3.4.2-beta-1-beta-2

Beta release for GivHome verification readiness, product assets, quieter activity sensors, and update awareness.

Changes:
- renames the public plugin display name to **GivHome**
- adds GivHome logo assets for the custom setup UI and package
- adds an **Update Available** Home sensor that checks the npm registry for newer plugin versions every 24 hours
- splits activity thresholds so brief battery-breathing events no longer trigger noisy Home notifications
- defaults Charging, Discharging, and Importing active thresholds to `250W` so solar-to-battery charging remains visible in lower UK winter generation
- defaults Exporting active threshold to `1000W` to suppress short grid overspill events
- keeps Charge/Export 30m, 60m, 90m, and 120m tile labels unchanged
- adds maintenance guidance: check Homebridge occasionally for OS, Node.js, and plugin updates

Maintenance note:
GivHome is designed to run quietly in the background. Occasionally, Homebridge may show updates for the operating system, Node.js or GivHome itself. Applying updates every few months is recommended and usually takes only a few minutes.

## 3.4.0

Production release of the new HomeKit tile and configuration experience.

Changes:
- adds simple manual duration tiles for Charge and Export: 30m, 60m, 90m, and 120m
- keeps the original `forceCharge` and `forceExport` accessory kinds as the fixed 60 minute tiles for HomeKit continuity
- syncs manual tile state from the live inverter schedule where GivTCP publishes schedule enable and slot start/end telemetry
- treats plugin-side command state as a short-lived pending overlay, not the long-term source of truth
- turning any Charge tile off neutralises the charge slot and disables the charge schedule
- turning any Export tile off neutralises the export slot and disables the discharge/export schedule
- simplifies the Homebridge config UI so most users only see the key setup fields
- moves MQTT, GivTCP REST, polling, tolerance, telemetry, and legacy compatibility settings into advanced sections
- removes unused Battery Size, Low Battery Threshold, and Maximum Battery Charge Power settings left over from earlier experiments
- keeps Off-Peak Hours as the baseline cheap window and merges Intelligent Octopus Go dispatch windows and grace periods on top

Behaviour:
- Off-Peak Hours default to `23:30–05:30`
- Grace Period defaults to continuing only until the end of the current `:00` or `:30` half-hour period
- Octopus credentials are optional; without them the plugin can still monitor, run manual tiles, and use the configured off-peak window
- all inverter control remains local via GivTCP REST

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
