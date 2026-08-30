# GivHome for Homebridge

Local GivEnergy battery automation for Apple Home.

This is the stable v3 Homebridge plugin. It works with the established GivTCP/MQTT local setup and brings GivEnergy battery status, Octopus tariff awareness and simple Apple Home controls into Homebridge.

## Install

Use the Homebridge UI:

```text
Plugins → Search → homebridge-giv-iog-local → Install
```

Or from Terminal:

```bash
npm install -g homebridge-giv-iog-local
```

## Basic setup

You normally need:

- Your local GivTCP/MQTT setup already working
- Your GivEnergy inverter or battery details
- Optional Octopus details if you use Intelligent Octopus Go features

Most homes should leave the advanced settings alone.

## v4 beta

A new direct-local Modbus version is being tested separately as v4.

It does not replace the stable v3 release yet. Beta testers can install it deliberately with:

```bash
npm install -g homebridge-giv-iog-local@beta
```

## Help

If setup fails, check the Homebridge logs first. Most problems are caused by local network, GivTCP/MQTT or configuration issues.

When asking for help, include:

- Homebridge version
- Node.js version
- Plugin version
- Relevant Homebridge log lines
- Whether GivTCP/MQTT is working independently

## Licence

The stable v3 line is released under Apache-2.0.

The v4 beta line is released separately under GPL-3.0-or-later.

## Names and trade marks

GivHome and Kernowek Consulting names and marks are not licensed for use in derivative products without permission.

## Disclaimer

GivHome presents the energy details made available by your local setup. We cannot verify their accuracy. Use battery and export controls carefully.
