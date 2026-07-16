# GivHome v3.7.5

GivHome v3.7.5 is a compatibility, safety and reliability release.

It preserves the proven CH/All-in-One charging behaviour from v3.7.2, while adding isolated support for CE and other AC-coupled systems that expose only one usable charge schedule slot.

## Highlights

### Proven CH and All-in-One behaviour

- Restores and preserves the v3.7.2 timed charge and export lifecycle for CH and other normal multi-slot systems.
- Keeps baseline cheap-rate charging, Intelligent Octopus Go bonus windows and manual timed actions on the proven command sequence.
- Prevents CE-specific schedule preservation logic from changing CH behaviour.

### CE and AC-coupled single-slot compatibility

- Reads and remembers the existing user charge schedule before temporary use of slot 1.
- Restores the original slot times, target state of charge and schedule enable state when temporary charging ends.
- Refuses destructive overwrite when the existing slot state cannot be obtained from fresh telemetry.
- Avoids writing unsupported charge slots 2–10 on single-slot systems.

### Safer command handling

- Genuine GivTCP write errors remain hard failures.
- Contradictory success wording is treated as advisory and passed to inverter readback verification.
- Disabled schedules are treated as safe even when inactive historical slot times remain stored in the inverter.

### Telemetry protection

- Retains the stale-telemetry guard that blocks automation and Eve history writes when inverter data is out of date.
- Includes optional guarded GivTCP recovery for sustained stale telemetry.
- Recovery performs no inverter-control writes and requires a fresh `Last_Updated_Time` before success is declared.
- Automatic GivTCP recovery remains disabled by default and requires deliberate installation of the supplied host helper.

## Validation

The stable CH/All-in-One path completed an overnight health validation with:

- fresh and advancing GivTCP telemetry;
- matching REST and MQTT state of charge;
- no blocked automation;
- no uncleared schedule reports;
- no REST write timeouts;
- no write-verification failures;
- no GivTCP connection failures.

## Upgrade notes

No configuration changes are required when upgrading from another v3.7.x release.

Users who do not explicitly enable the optional GivTCP recovery feature will see no container-management changes.

Thank you to the users and testers who supplied inverter evidence and real-world logs for both multi-slot and single-slot systems.
