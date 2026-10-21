# GivHome 4.0.3-beta.10 — Simpler solar setup

Solar 2mrw now takes care of its own display scale. It calculates the scale automatically from the combined capacity of all solar arrays entered during setup. Each array’s direction, tilt and shading remain part of its individual forecast.

GivHome now checks tomorrow’s forecast every 90 minutes. This replaces the previous user setting, including saved six-hour intervals, so forecasts can respond better to changeable conditions without another choice to manage. Each GivHome instance begins its interval when it starts, helping to spread forecast requests rather than tying them to fixed clock times.

The Predicted Solar advanced section has been removed. Older scale and refresh settings are ignored immediately and cleared when Plugin Config is next saved. Other settings, accessory identities and saved data retain their established continuity.

The inaccessible Compare export meter readings feature has also been removed. It produced no result in Apple Home, Eve or Plugin Config and could silently turn Agile Export off. Agile Export planning, its Apple Home switch and local export measurement remain available.

The Homebridge plugin now uses the updated GivHome logo.

Charging and export control rules are otherwise unchanged. HR242 remains diagnostic-only. See the [user guides](docs/README.md) for setup and control details.

**Full Changelog comparison:** [v4.0.3-beta.9...v4.0.3-beta.10](https://github.com/KernowekConsulting/homebridge-giv-iog-local/compare/v4.0.3-beta.9...v4.0.3-beta.10).
