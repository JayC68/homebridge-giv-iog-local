# 4.0.3-beta.10 validation scope

This beta removes configuration that GivHome can determine safely for itself. Solar 2mrw derives its display scale from the combined capacity of every configured array while retaining each array’s direction, tilt and shading in its individual forecast. Forecast refresh is fixed at 90 minutes for all installations; older scale and refresh settings are ignored at runtime and removed on the next Config UI save.

The inaccessible export-meter comparison is retired with its configuration, network request and silent Agile Export suspension path. Existing audit suspension metadata is no longer consulted. Agile Export planning, its Apple Home switch, observed local export, state-file identity and other control behaviour remain unchanged. The package logo is replaced with the approved 512 px GivHome artwork.

The project owner requested build, validation and beta.10 publication on 21 October 2026. The previously accepted default-on Emergency Stop and Local Learning design is retained. This approval is tied to the exact runtime fingerprint. Physical resource budgets remain unmeasured; automatic solar planning remains disabled.

## Local results

- The complete package suite passed 291 cases: 219 charge/target/control lifecycle, 22 solar controls, 42 observation and 8 Config UI cases. The Predicted Solar harness separately confirmed the fixed 90-minute interval, automatic combined-array scale and retained per-array forecast processing.
- Migration checks confirmed that retired solar and export-comparison settings are removed while unrelated settings, unknown owner-managed values, accessory identities and saved-state continuity are retained.
- Native HomeKit checks passed all 17 cases on Homebridge 2.4.0/HAP 2.2.2.
- Package identity, release notes, documentation links, logo inclusion, publication contents and beta-publication safeguards passed before publication.

No Pi installation or live inverter change is part of this publication.
