# GivHome v3.7.2-beta.1

Troubleshooting hotfix build based on v3.7.1.

## Fixed

- Eve/Fakegato energy history is now gated by the same telemetry freshness guard used by automation.
- When GivTCP telemetry is stale/offline, Eve history samples are skipped instead of writing frozen solar/import/export values.
- Manual Charge/Export cleanup now continues through cleanup steps even if one REST write reports a timeout/unknown success.
- Manual cleanup now performs a final schedule-disable write after clearing the slot, reducing the chance of a persistent discharge/export schedule.
- Live schedule detection now recognises current GivTCP `Control/Enable_*_Schedule` and `Timeslots/*_time_slot_1` paths.

## Diagnostic log added

When stale telemetry blocks history recording, GivHome logs a throttled line:

```text
[EveHistory] skipped: stale telemetry | state=<state> | age=<seconds>s | source=<source>
```
