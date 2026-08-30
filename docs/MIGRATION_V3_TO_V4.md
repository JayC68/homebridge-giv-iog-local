# Migrating from v3 to v4

v4 is a major change. It keeps the same npm package identity, but the core control path has changed.

## What changed

- v3 used GivTCP/MQTT.
- v4 talks directly to compatible GivEnergy systems over the local network.
- GivTCP is no longer required for core local telemetry or control.
- Old helper scripts and v3 release notes are not part of the v4 package.

## Before upgrading

Take a copy of your Homebridge config.

Make a note of:

- Inverter IP address
- Inverter serial
- Any Octopus settings
- Any manual charge/export settings you actively use

## After upgrading

Open the Homebridge plugin settings and check the basics first:

- Inverter IP address
- Inverter serial
- Poll interval
- Optional Octopus settings

Leave advanced controls alone until the dashboard is reading cleanly.

## First checks

Confirm that Apple Home shows sensible values for battery level, solar, grid import/export and load.

Only test charge/export controls once the basic telemetry is stable.
