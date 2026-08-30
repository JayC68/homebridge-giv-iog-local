# GivHome for Homebridge

Direct local GivEnergy integration for Apple Home.

GivHome talks to compatible GivEnergy systems over your local network. For v4, core monitoring and local control no longer need GivTCP, MQTT or GivEnergy Cloud.

## What v4 does

- Local GivEnergy telemetry in Apple Home
- Battery, solar, grid import/export and load status
- Optional manual battery controls
- Intelligent Octopus Go home-battery protection
- Octopus Flux Export planning
- Agile Export planner/observer mode
- Eve energy history, where supported

## Install

Use the Homebridge UI:

```text
Plugins → Search → homebridge-giv-iog-local → Install
```

For this beta:

```bash
npm install -g homebridge-giv-iog-local@beta
```

## Basic setup

You normally need:

- The local IP address of your GivEnergy inverter or gateway
- The inverter serial number
- Optional Octopus details if you want Intelligent Octopus Go, Flux or Agile features

Most homes should leave the advanced settings alone.

## Upgrading from v3

v3 used the older GivTCP/MQTT path. v4 is a direct local Modbus release.

Read [`docs/MIGRATION_V3_TO_V4.md`](docs/MIGRATION_V3_TO_V4.md) before upgrading a working v3 setup.

## Safety model

GivHome is deliberately cautious. It uses local readback, staged command queues and export-route cleanup rather than blind writes.

For the plain-English version, see [`docs/SAFETY.md`](docs/SAFETY.md).

## Help

Start with [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## Licence

GivHome v4 is released under `GPL-3.0-or-later`.

Commercial use is allowed under the licence, but redistributed modified versions must follow the same licence terms. Commercial licensing for proprietary products or managed integrations is available by agreement with the author.

## Names and trade marks

GivHome and Kernowek Consulting names and marks are not licensed for use in derivative products without permission. See [`TRADEMARKS.md`](TRADEMARKS.md).

## Disclaimer

GivHome presents the energy details held by your inverter. We cannot verify their accuracy. Use battery and export controls carefully.
