# GivHome v3.7.3-beta.2

v3.7.3-beta.2 is a targeted CE / AC-coupled schedule-safety beta.

## Changed

- Adds CE / AC-coupled read-remember-write-clean-reinstate handling for temporary charge-slot use.
- Before a temporary charge slot is written on CE systems, GivHome reads charge slot 1, remembers the user's existing start/end, enable state and target SoC where available, then writes the temporary command.
- When the temporary command ends or fails, GivHome cleans the temporary command and reinstates the remembered charge slot 1 state instead of clearing it to `00:00-00:00` or forcing a default baseline.
- Keeps CE systems on charge slot 1; no unsupported extended schedule banks or slot-2 assumptions are introduced.
- Treats GivTCP command anomalies such as `AttributeError`, `failed`, contradictory enable/disable responses, and non-clear slots reported back as `00:00-00:00` as hard command failures.

## Notes

- This beta still depends on GivTCP returning usable `/readData` or `/getCache` data for readback. If both endpoints return `{"Result":"Error, no data available"}`, GivHome cannot safely remember or verify CE schedules.
- Non-CE behaviour is intended to remain unchanged from v3.7.2.
