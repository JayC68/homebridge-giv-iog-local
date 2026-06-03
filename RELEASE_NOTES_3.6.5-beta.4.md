# GivHome v3.6.5-beta.4

Reliability beta focused on the AIO/Gateway charge and export control paths validated during live testing.

## Changes

- Uses `/setChargeRateAC` at the start of CHARGE/manual charge actions to restore the effective AIO battery charge-power limit before enabling the charge schedule.
- Uses `/setDischargeRateAC` at the start of EXPORT/manual export actions to restore the effective AIO battery discharge-power limit before enabling the discharge schedule.
- Restores AC charge and discharge limits to 100% during neutralise/stop paths so ECO and manual stop actions do not strand the inverter with charge/discharge power at zero.
- Preserves the v3.6.5-beta.3 manual duration tile persistence behaviour for Charge/Export 30, 60, 90 and 120 minute tiles.
- Keeps Smooth/Battery Care absent and keeps Evening Excess Export unchanged/withheld from stable-release consideration.

## Validation basis

Live AIO testing showed that `/setChargeRate` and `/setDischargeRate` can report success while leaving the effective AIO/Gateway charge/discharge limits at zero. `/setChargeRateAC` and `/setDischargeRateAC` were validated as the effective recovery path, restoring the cache-visible limits to full power.
