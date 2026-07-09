# GivHome v3.7.3

Stable release promoted from v3.7.3-beta.3.

## Fixes and improvements

- Adds safer CE / AC-coupled charge-slot handling.
- For CE systems, GivHome now treats charge slot 1 as a user-owned resource:
  - read the existing slot,
  - remember it,
  - temporarily write the GivHome command window,
  - clean up when finished,
  - reinstate the remembered user slot.
- Improves cleanup verification so a disabled schedule is treated as safe even if inactive stored slot times remain visible in GivTCP readback.
- Reports inactive stored slots as informational rather than a failed cleanup.
- Adds stricter GivTCP command anomaly detection for contradictory or failed REST responses.
- Preserves normal CH / AIO behaviour while avoiding misleading cleanup verification warnings.

## Notes

This release does not move users to a new control model. It tightens schedule safety and verification behaviour around existing GivTCP REST control.
