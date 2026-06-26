# GivHome v3.7.0-beta.3

Reliability beta.

## Highlights

- Extends write/readback/verify lifecycle checks to timed charge start and cleanup.
- Applies verification to manual timed Charge/Export, Intelligent Octopus Go smart-window charging, and the fallback 23:30-05:30 cheap charging window.
- Verifies observed GivTCP cache state rather than trusting REST success text alone.
- Clear verification inspects charge/discharge slots 1-10 to detect hidden schedule persistence.
- Silences parked Smooth Charging timer-clear logging when Smooth Charging is disabled.

## Safety notes

- No background polling loops.
- No additional Modbus polling.
- No ping/port checks.
- No GivTCP restart logic.
- No EEE behaviour changes.
- No Homebridge platform naming changes.
