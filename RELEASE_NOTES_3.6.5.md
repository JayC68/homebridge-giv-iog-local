# GivHome v3.6.5

Stable release of the v3.6.5 reliability phase.

## Highlights

- Manual Force Charge and Force Export controls are now validated for 30 minute operation and early cancellation.
- Duration tiles are designed to remain ON for their active window and can be switched OFF to cancel cleanly.
- AIO/Gateway rate restore uses the validated AC percentage control path.
- Schedule and slot cleanup is strengthened after manual charge/export operations.

## AIO/Gateway note

For AIO/Gateway systems, GivHome uses the AC percentage rate controls as the source of truth for charge/discharge rate guards. In GivTCP cache output, `Battery_Charge_Rate` and `Battery_Discharge_Rate` may remain at `0` while `Battery_Charge_Rate_AC` and `Battery_Discharge_Rate_AC` correctly show the effective percentage value. This is expected on the validated AIO path and is not treated as a failure by GivHome.

## Known GivTCP behaviour

Some REST responses can report stale wording from the previous setting even when the cache and inverter state update correctly. GivHome therefore relies on the subsequent cache/control state and physical behaviour rather than REST response text alone.

## Out of scope for this stable release

- Evening Excess Export is unchanged and will be re-tested in v3.6.6-beta.1.
- Smooth Charging remains deferred to v3.6.7-beta.1.
