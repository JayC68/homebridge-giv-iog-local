# GivHome v3.7.0-beta.4

Reliability beta for timed Charge/Export command verification.

## Highlights

- Patient start verification for Charge and Export starts: 10 GivTCP cache readbacks by default, over roughly 80 seconds.
- Applies to manual Charge/Export, IOG smart-window charging, fallback 23:30-05:30 cheap-window charging, and Evening Excess Export when enabled.
- Strict cleanup verification remains separate: schedule disabled plus slots 1-10 clear.
- If start verification fails, GivHome performs fail-safe cleanup and verifies the cleanup state.
- REST success text is not trusted as proof; GivTCP readback is the source of truth.
- No background polling, Modbus polling, GivTCP restart logic, EEE decision changes, or platform renaming.
