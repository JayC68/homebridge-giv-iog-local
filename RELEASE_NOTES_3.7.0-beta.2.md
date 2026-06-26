# GivHome v3.7.0-beta.2

Write verification beta for manual timed actions.

## Highlights

- Adds gentle write/readback/verify-cleared handling for manual timed Charge and Export actions.
- When a manual timed action ends, or is switched off manually, GivHome writes the normal clear command, reads back the existing GivTCP cache, and verifies slot 1 has cleared to `00:00-00:00`.
- Adds Homebridge UI controls for write verification delay and retry count.
- Retains the passive Telemetry Freshness Guard introduced in `3.7.0-beta.1`.

## Safety notes

- This does not add background polling.
- This does not add Modbus polling.
- This does not ping the inverter, test port 8899, or restart GivTCP.
- Verification runs only after manual timed action cleanup writes.
- Existing automatic charging, Battery Care Charging and Evening Excess Export command paths are left unchanged.

## Purpose

This beta is intended to reduce the chance of unwanted persistent Charge or Export state after timed manual actions, while keeping the inverter traffic profile quiet and conservative.
