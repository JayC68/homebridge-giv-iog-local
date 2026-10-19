# Safety model

GivHome reads before writing, serialises local commands and verifies important writes. It reconciles uncertain acknowledgements before resending and retains interrupted work for bounded recovery.

Current actions have a durable identity. Cleanup restores only settings borrowed by the matching action, preserves changes made by another controller and reconciles shared enable flags with future schedules. Emergency Stop cancels the current occurrence; once verified, new actions are available immediately. Nothing running in normal Eco produces no writes.

For CH/All-in-One export, the shared slot 8 one-off times are neutralised after use. Its captured target and power settings are restored, and other eligible schedules retain their namespace enablement. Cleanup does not blindly disable every future export window.

See [control recovery and model limits](maintainer/CONTROL_LIFECYCLE.md) for two-slot profiles, pause capability, recovery journals and clock checks. HR242 remains diagnostic-only.

An accepted command or matching register value does not by itself prove physical power flow. Some CH firmware accepts an export power ratio but exports at a higher rate. Flux retains observed-discharge energy budgeting and reserve checks rather than assuming that requested power is obeyed.

Keep a verified backup and test new export features while able to watch the system.
