# 4.0.3-beta.8 validation scope

This beta changes the Night Target display wording, separates Flux feature enablement from optional Apple Home tile exposure, and relocates the local-learning configuration section. Existing config keys, target accessory identity and stored percentage are preserved. Flux starts armed when its feature is enabled, as before; hiding its tile does not disarm it. Existing planner, ownership, cleanup and restart rules are unchanged.

The project owner explicitly requested build, validation and beta publication on 20 October 2026. The previously accepted default-on Emergency Stop and local-learning design is retained. This approval is tied to the exact runtime fingerprint. Physical resource budgets remain unmeasured; automatic solar planning remains disabled.

Validation evidence is recorded with the isolated candidate receipt. No Pi installation is part of this publication.

## Local results

- Node 24.19.0: all 282 regression cases passed (219 charge/target/control lifecycle, 21 solar controls, 42 observation).
- Native HomeKit: all 16 cases passed on Homebridge 1.11.1 and all 16 on Homebridge 2.4.0. Flux checks cover independent enable/exposure settings, legacy defaults, hiding an existing tile, and owned-only cleanup on Off.
- Package identity, release notes, documentation links and release assertions passed.
- Remote Node 22 and 24 validation is required before tagging publication.
