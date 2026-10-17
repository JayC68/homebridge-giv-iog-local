# GivHome 4.0.3-beta.3 — Let GivHome begin learning your home

Every home uses its battery and solar differently. Good automatic overnight planning needs to understand those differences before it starts making decisions.

This beta lays the first foundation: an optional local observer that can begin learning from your installation’s existing readings and forecasts. **It does not calculate a charging target or turn automatic charging on.**

## A quiet start to local learning

Tick **Learn locally for future Automatic Solar-Aware Cheap Overnight** in Plugin Config and restart Homebridge to begin. It is off by default. Untick and restart to pause, or use the separate reset setting to start its learning again.

GivHome records compact energy summaries, provisional site-use patterns and ordinary charging response. It keeps forecast revisions as received, marks missing readings as gaps and labels control activity. EV energy is not guessed away, and constrained solar output is not automatically treated as a bad weather forecast. This foundation does not yet run the automatic or shadow planner.

Existing Solar-Aware Cheap Overnight continues to use your three chosen charge levels. Intelligent Octopus Go battery protection keeps its own target and continues to take over after the overnight window if enabled. Agile learning, Eve history and Emergency Stop retain their existing behaviour.

## Your observations stay with you

**GivHome does not send observation history or learned models to the developer or to a remote learning service.** Learning runs on your Homebridge device, with bounded local storage and no automatic diagnostic uploads. Existing weather/location and enabled Octopus requests continue; learning data is not added to them.

There are no extra inverter polls or weather requests. Queues and storage are capped, writes are batched, and observation faults degrade learning while ordinary controls keep priority. See the [local learning guide](docs/SOLAR_OBSERVATION.md) for retention, privacy, reset and the limits of provisional evidence.

## Trying this beta

This is an opt-in beta, and local observation is also off by default. Pi CPU and memory performance are still being evaluated. Accelerated desktop testing showed a small retained learning model alongside higher process-memory use; it does not establish resource usage on your Pi. If you notice extra load, turn local observation off and restart Homebridge.

Before any upgrade, keep a verified backup and the exact prior package for rollback. Existing model/firmware limitations still apply: HR242 remains diagnostic-only, and CH original pre-session restoration across restart remains unproved. Read the [release preparation](docs/RELEASING.md), [safety notes](docs/SAFETY.md) and [Full Changelog](CHANGELOG.md).

**Full Changelog comparison:** [v4.0.3-beta.2...v4.0.3-beta.3](https://github.com/JayC68/homebridge-giv-iog-local/compare/v4.0.3-beta.2...v4.0.3-beta.3).
