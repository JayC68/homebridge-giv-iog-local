# Solar-Aware Cheap Overnight and Emergency Stop

## Choosing an overnight battery level

The aim is to buy enough cheap electricity for a dull day while leaving more storage space when a brighter day is expected. Set up Cheap Overnight and Predicted Solar first, including the forecast location and solar panels.

Forecast amounts are daily solar energy in kWh. The three charge levels are battery percentages at the end of the cheap period. They are different quantities: do not enter the battery capacity or the panels’ kW rating as though it were the daily forecast.

With the defaults, a forecast below 10 kWh selects 100%; 10 to under 20 kWh selects 80%; 20 kWh or more selects 60%. If you change the higher boundary to 13.5 kWh, the middle band becomes 10 to under 13.5 kWh, and 13.5 kWh or more selects the high-solar level. The chosen target never exceeds your normal Charge Target: a normal target of 70% limits an 80% solar setting to 70%.

Enable the feature to add the Apple Home switch. On uses these choices; Off uses the normal Charge Target. A missing or unusable forecast also uses the normal target. Ordinary Cheap Overnight remains enabled. IOG battery protection, if enabled, retains its own target.

This beta uses the bands you choose. Automatic calculation from battery capacity, generation timing and household demand is a future development direction, not part of this beta.

## Configuration

Solar settings: `enableSolarAwareCheapOvernight` (default false), `solarAwareLowForecastKwh` (10), `solarAwareHighForecastKwh` (20), `solarAwareLowTargetSoc` (100), `solarAwareMediumTargetSoc` (80), `solarAwareHighTargetSoc` (60). Thresholds must increase; targets must not increase as the forecast improves. Invalid values fall back to the normal saved Charge Target. Threshold equality enters the higher band. The chosen target is capped by the saved Charge Target. Predicted Solar and Cheap Overnight must be configured. The Home switch only enables/disables the solar adjustment; it does not disable ordinary Cheap Overnight.

The morning date comes from the end of the configured cheap window. Use the same local timezone for Homebridge and the solar location. Only a matching forecast fetched no more than 24 hours ago is used. Future timestamps, malformed or negative values and other dates fall back. Forecast preference/cache is scoped to inverter identity and solar configuration. Provider failure can use an already cached matching fresh forecast. The active Cheap Overnight owner uses the existing target reconciliation and original cleanup snapshot. Battery Care uses the selected target; IOG protection does not.

Emergency Stop: `enableEmergencyStopTile` (default false) plus the existing appliance-control acknowledgement. CE/AC also retains its explicit live-write acknowledgement. Unsupported profiles get no tile. CE and hybrid read two core slots per family; CH reads ten per family and HR318. Older profiles also require HR318 when pause tiles, IOG pause protection or a saved pause owner is present. Required missing reads fail closed; HR242 and other target/limit banks are not required or written. Equal nonzero slot times are ambiguous and refused; 00:00–00:00 is disabled. Start is inclusive, end exclusive; overnight slots are supported.

## Recovery and reconciliation

Emergency Stop now retires the current occurrence and releases new actions after verified readback. It does not wait until the old finishing time. Nothing running in normal Eco produces no writes and preserves future schedules and ownership.

A durable action journal protects shared settings and recurring schedules. Failed communication is retried using the existing queue and automation loop, with bounded delay and readback before resending. Unknown or conflicting state remains a visible fault. Later actions retain their normal model, acknowledgement, reserve and ownership gates.

See [control recovery and model limits](CONTROL_LIFECYCLE.md) for current profile coverage, future pause windows, recurring schedule restoration, legacy migration and recovery evidence. Endpoint authority is documented/profile-guarded, not a claim of fleet-wide hardware qualification. HR242 remains diagnostic-only.

Local files include `givhome-solar-aware-*.json`, `givhome-emergency-*.json` and `givhome-controls-*.json`. Keep Homebridge storage with rollback evidence; removing a tile does not discard incomplete recovery. No observation history or learned model is sent to the developer.
