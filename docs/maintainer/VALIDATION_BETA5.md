# 4.0.3-beta.5 validation scope

This maintenance release changes repository metadata, release identity, documentation and verification tooling. Compared with beta.4, runtime library changes are limited to release identity in evidence-led-constants.js; entry-point changes are limited to version/stage labels. Control algorithms, schema, defaults and dependencies are unchanged.

The previous [control validation](VALIDATION_BETA4.md) remains the behavioural baseline. Rerun regression, native HomeKit, syntax, package, documentation and qualification checks for this candidate before publication. Verify the immutable tagged source and public npm package against the reviewed archive.

Physical Pi performance and live model/firmware qualification remain pending. The foundation remains default-off and cannot authorise automatic charging. The updated qualification digest records this exact release identity and package metadata, not new hardware results.

## Local checks

- Node 24.19.0: all 280 regression cases passed.
- Native HomeKit: 13 tests passed with the locked Homebridge 2.4.0 / HAP 2.2.2 dependencies and 13 with the separate Homebridge fixture.
- JavaScript syntax, documentation links and exact beta qualification checks passed.
- Locked dependency installation reported zero vulnerabilities.
- Two-day accelerated observation smoke passed; it does not establish physical Pi resource qualification.
- Runtime/schema comparison against beta.4 confirms release identity is the only executable-runtime difference.
