# GivHome v3.7.0-beta.1

Platform reliability beta: passive telemetry freshness guard.

## Highlights

- Adds a GivHome Telemetry status tile in Apple Home.
- Watches GivTCP `Stats.Last_Updated_Time` already received through MQTT.
- Marks telemetry fresh, stale or offline/critical.
- Blocks manual and automatic actions when telemetry is stale/offline.
- Protects Intelligent Octopus charging, Battery Care Charging, Evening Excess Export and manual Charge/Export controls from acting on old SOC or power data.

## Important design note

This beta is deliberately passive. It does not add Modbus polling, extra inverter reads, ping loops, port checks, GivTCP restarts or raw register writes. It carries the safety logic inside the Homebridge plugin using telemetry that is already flowing.

## Defaults

- Fresh below 180 seconds.
- Stale from 180 seconds.
- Offline/critical from 600 seconds.

Recommended for beta testers who want to validate telemetry freshness behaviour without increasing inverter traffic.
