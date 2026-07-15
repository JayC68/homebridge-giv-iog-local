# GivHome v3.7.5-beta.1

This beta combines the proven CH/AIO charge lifecycle from v3.7.2 with isolated support for CE/AC-coupled single-slot systems.

## CH/AIO protection

- CH and other normal multi-slot systems retain the v3.7.2 timed charge and export command order.
- CE-specific remember/reinstate behaviour is not used on CH systems.
- Failed-start cleanup remains CE-only, avoiding the shared lifecycle regression introduced after v3.7.2.

## CE single-slot support

- Reads and remembers the existing CE charge slot before temporary use.
- Restores the remembered slot, target SoC and enabled state after charging.
- Refuses to overwrite the CE slot when its pre-state cannot be read from fresh telemetry.
- Never writes charge slots 2–10 on CE systems.

## GivTCP stale-telemetry recovery

- Optional and disabled by default.
- After sustained stale `Stats.Last_Updated_Time`, GivHome can request one controlled restart of the local `givtcp` container.
- Automation remains blocked throughout recovery.
- No inverter-control REST commands are sent by the recovery path.
- Fresh `Last_Updated_Time` must be observed before recovery is declared successful.
- A six-hour default cooldown prevents restart loops.
- Requires the included narrow sudo helper to be installed and verified separately.

## GivTCP write responses

- Genuine GivTCP errors remain hard failures.
- Contradictory success wording is treated as advisory and passed to readback verification.
