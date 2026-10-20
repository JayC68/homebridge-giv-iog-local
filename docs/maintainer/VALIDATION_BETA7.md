# 4.0.3-beta.7 validation scope

Emergency Stop visibility and local observation now default to enabled; explicit false is preserved. Existing appliance-control, supported-profile and CE live-write acknowledgements still apply. No stop is triggered by exposure; unfinished recovery remains independent of tile visibility. Forecast observation follows the same local-learning default.

The 20 October owner decision explicitly accepts the existing Pi field evidence and the default-on beta.7 design. Physical resource budgets are not marked as measured or passed. This beta-specific approval is tied to the exact runtime fingerprint and does not enable automatic solar planning or authorise stable publication.

Validation results are recorded with the isolated candidate evidence.

## Local results

- Node24.19.0:282 regression cases passed (219 charge/target/control lifecycle,21 solar bands/persistence,42 observation), with zero failures.
- Native HomeKit:14 cases passed on Homebridge2.4.0 and14 on Homebridge1.11.1, with zero failures.
- New behaviour checks cover omitted/default settings, explicit opt-out, exposure without inverter reads/writes, stable identities, idle stop safety and preservation of observation files when disabled.
- Local validation did not install the candidate on the Pi. Node22 and Node24 remote checks are performed by the candidate workflow before publication.
