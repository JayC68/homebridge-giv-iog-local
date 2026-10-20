# 4.0.3-beta.9 validation scope

This beta adds the revised Plugin Config flow and an upgrade-preserving custom UI wrapper. It converts historical aliases and omitted values to their existing runtime meaning before Homebridge applies current form defaults. It preserves unknown owner-managed settings and keeps established accessory and state-file identities.

The project owner requested correction, repeat migration testing, validation and beta.9 publication on 20 October 2026. The previously accepted default-on Emergency Stop and Local Learning design is retained. This approval is tied to the exact runtime fingerprint. Physical resource budgets remain unmeasured; automatic solar planning remains disabled.

## Local results

- Six historical configuration fixtures passed two saves each in an isolated Homebridge UI 5.29.0 instance. Effective behaviour, identity, saved Night Target, unrelated platforms and 66 seeded state/history artifacts were preserved. Old day lists gained an equivalent Custom label while retaining exactly the same selected weekdays.
- The complete package suite passed 290 cases: 219 charge/target/control lifecycle, 22 solar controls, 42 observation and 7 Config UI cases.
- Native HomeKit checks passed all 17 cases on Homebridge 2.4.0/HAP 2.2.2. The migration restart case reused every cached accessory UUID and read back the saved Night Target and representative Eve totals.
- Local Learning model recovery, forecast preference recovery and control-ledger restart recovery passed their existing multi-restart tests.
- Package identity, release notes, documentation links, publication contents and beta-publication safeguards passed before publication.

No Pi installation or live inverter change is part of this publication.
