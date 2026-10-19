# Beta.3 validation — 17 October 2026

**Opt-in beta; physical Pi qualification remains pending.** Runtime SHA-256: `31308c447c1d5c5b42576fb1c700ad3e3319f105c8cde10397a4d108b42b2df6`. This hash covers the entry point, configuration schema, package declarations and all runtime library files. Recheck it against the qualification record before publication.

## Automated checks

- Existing charge/ownership regressions: 46 passed.
- Existing adversarial Solar-Aware/Emergency Stop cases: 52 passed.
- New local-observation cases: 41 passed, including analytical energy traces, gaps/clock changes/DST, context changes, immutable forecast revisions, corrupt/partial storage, restart/reset, queue pressure, storage backoff, privacy allowlists and network traps, plus explicit beta publication approval and rejection of stable/default-on/automatic-control misuse.
- Native HomeKit cases: 9 passed with Homebridge 2.4.0 / HAP 2.2.2; repeated with Homebridge 1.11.1 / HAP 0.14.0. Total: 148 distinct automated cases, with HomeKit exercised on both major lines.
- Source/release-note/forecast harness checks pass. Existing schema properties and UI groups are unchanged; all existing control, safety, Agile and Eve library modules are byte-identical to beta.2. Entry-point changes add isolated observer hooks and release identity. Forecast request URLs and published results are preserved in the on/off comparison.
- Node 24.19.0 on macOS arm64 used locally. Node 22/24 Linux CI passed for the foundation candidate; the final publication revision is checked again. Dependency audit: zero reported vulnerabilities. Source and packed-package checks are repeated for the final release archive.

## Accelerated retention and resource investigation

The offline replay used 200 simulated days and 576,012 observation calls, with periodic restart recovery and issued forecasts. Quota, file-count, age, model-size and queue assertions passed without reported drops/storage faults. Analytical energy accuracy is asserted independently; expired raw records cannot establish an all-history replay.

| Measurement | Accelerated desktop observation |
|---|---:|
| Maximum learner disk bytes | 5,157,048 |
| Maximum files | 2,047 |
| Maximum encoded queue bytes | 22,830 |
| Final provisional model bytes | 9,771 |
| Maximum retained heap increase after forced GC | 1.56 MiB |
| Final process RSS increase | 39.12 MiB |
| Slowest captured observation | 3.338 ms |
| Accelerated elapsed time | 13.86 seconds |

The accelerated harness includes synthetic object creation, assertions, filesystem inventories and forced garbage collection. It is not a matched enabled/disabled test or a real-time hardware soak. Its absolute event-loop readings include monitor resolution and test work; they are not the added latency budget. Process RSS increase exceeds the proposed 16 MiB budget in this unpaired desktop run. A small retained model does not clear the RSS concern. Investigate allocator/heap growth and measure the declared Pi stack under representative load before claiming resource compliance. Do not change global Node heap limits to hide it.

An earlier file-index implementation repeatedly sorted/scanned its complete directory on writes. Replacing it with bounded metadata and incremental quota counters reduced the comparable accelerated run from about 198 seconds to roughly 12–15 seconds. This is a host optimisation result, not a Pi CPU guarantee.

## Outstanding physical qualification

- Declared minimum Pi and representative busier Pi, each with paired enabled/disabled 72-hour results and stack/load details.
- Resolve the RSS investigation; satisfy retained-memory, RSS, CPU, event-loop and control-responsiveness budgets with raw supporting evidence.
- Confirm physical storage-pressure/recovery behaviour in an isolated test environment; preserve normal Homebridge controls and never test by writing to a live inverter.
- Continue privacy/resource review as the foundation gains field evidence; no automatic controller is qualified by this release.

`docs/maintainer/OBSERVATION_QUALIFICATION.json` remains pending for hardware testing. The beta publication policy is separate from hardware qualification and is limited to this default-off foundation and matching runtime. It does not establish Pi performance or automatic-control readiness. The publisher verifies the beta policy explicitly and publishes to `beta` only.
