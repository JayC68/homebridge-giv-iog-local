# Control recovery and model limits

A verified stop ends the current action. It does not impose an additional hold to the original finishing time. An incomplete stop or partial cleanup remains guarded until fresh readback establishes a safe result; bounded retries reuse the existing automation loop rather than creating another polling service.

## Ownership and recovery

Before a new action writes, GivHome captures the supported namespace and durably records the action identity, original settings, expected settings and intended end. A refused preflight acquires no ownership and sends no cleanup writes. When borrowing an enabled namespace with future windows, GivHome disables that namespace before editing its owned route, verifies the prepared settings, then enables it. An interrupted start retains enough evidence to restore its original future eligibility. Cleanup and timer callbacks must match the action identity. A different observed setting retires stale ownership before cleanup starts; an unexpected change during an uncertain partial cleanup retains the journal and refuses speculative restoration.

The compact local journal uses an atomic replacement in Homebridge storage, keyed to inverter serial. It caps cancellation records at 256, deferred recurring windows at 64 and loaded file size at 512 KiB. Every mutation is journalled before sending and read back afterwards. A missing acknowledgement is reconciled against both possible outcomes. Corrupt/unreadable journals fail closed and are preserved for diagnosis. These records contain local control state and are not uploaded.

Shared enable flags are restored from the owned pre-state and reconciled with other future schedules. A current foreign recurring window stopped by Emergency Stop is cleared temporarily and restored after its cancelled occurrence ends; newer non-zero settings and newer owned actions take precedence. The CH slot 8 one-off route is not replayed. Cancelling Cheap Overnight does not let IOG relabel and restart it during the same overnight window; enabled IOG protection can take over afterwards. Existing manual IOG pause override and Flux single-peak completion policy remain separate safeguards.

Older export metadata does not prove ownership. On upgrade it is observed and retained as migration evidence before its logical claim is retired; it cannot authorise cancelling a foreign physical action. Older stop records require fresh reconciliation, not expiry of an unrelated deadline.

## Profile scope

| Profile | Charge/export time banks | Pause readback |
| --- | --- | --- |
| CH / All-in-One | Ten documented slots; timed manual charge uses core slot 1, export uses slot 8 | Mode and time window |
| CE / AC-coupled | Core and second slot only; existing CE live-write acknowledgement required | Mode only when the pause feature is configured |
| ED / Hybrid | Core and second slot only; timed export uses core | Mode only when the pause feature is configured |
| Unsupported/read-only | No new write authority | No speculative capability probing |

Endpoint reset/restore authority is **documented, profile-guarded and readback-required**. It does not mean every model/firmware has been tested on hardware. See [register sources](REGISTER_CONTROL_SOURCES.md). Slot target/engineering registers are not inferred from endpoint authority. HR242 remains diagnostic-only.

Inverter calendar time must be valid and within two minutes of Homebridge. Both valid instants in the repeated autumn hour are recognised. A genuine clock mismatch is reported; GivHome does not silently change the inverter clock.

## Operator checks

A momentary tile acknowledges a request while verification continues. A genuine failed result remains visible as a communication fault. Use the Homebridge log and fresh power readings to distinguish accepted, verified and physically observed outcomes.

If recovery reports conflicting newer settings or corrupt storage, preserve the Homebridge backup, logs and journal before investigation. Do not delete recovery evidence simply to clear a tile. Subsequent automatic actions remain subject to the normal model, acknowledgement, tariff, reserve and ownership checks.
