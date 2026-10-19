# GivHome 4.0.3-beta.5 — Repository rename and simpler documentation

This maintenance beta updates GivHome after the GitHub account moved from JayC68 to KernowekConsulting. The npm package remains `homebridge-giv-iog-local` and existing HomeKit identities are preserved.

## Easier-to-find guidance

The [user guide index](docs/README.md) links to six current guides covering Charge Target, Octopus features, Solar-Aware controls and Emergency Stop, local learning, safety and troubleshooting. Pre-v4 history, obsolete private-trial instructions and duplicate release bodies have been removed. Engineering and qualification records are grouped separately.

## Publishing and compatibility

Repository and support links use the new account. Battery-control behaviour, settings and defaults are unchanged from beta.4. This remains an opt-in beta; local observation is off by default and automatic solar planning is not enabled. HR242 remains diagnostic-only. Physical model/firmware testing and Pi resource qualification remain pending. See [safety](docs/SAFETY.md), [local learning](docs/SOLAR_OBSERVATION.md) and the [full changelog](CHANGELOG.md).

**Full Changelog comparison:** [v4.0.3-beta.4...v4.0.3-beta.5](https://github.com/KernowekConsulting/homebridge-giv-iog-local/compare/v4.0.3-beta.4...v4.0.3-beta.5).
