# GivHome 4.0.3-beta.7 — Emergency Stop ready, local learning enabled

Emergency Stop is now shown by default on supported systems with appliance control enabled. You can hide it in Plugin Config; its existing compatibility and safety checks remain in place. Showing the tile does not issue a stop command.

Local learning is also enabled by default, using readings and forecasts GivHome already receives. You can disable it in Plugin Config. Explicitly saved disabled settings remain disabled after upgrading; an omitted setting uses the new default.

Learning stays on your Homebridge device, uses bounded storage and does not calculate or change charging targets. Solar-Aware Cheap Overnight remains a separate optional control with its existing forecast choices and normal-target fallback.

Existing unfinished recovery is retained when the Emergency Stop tile is hidden. HR242 remains diagnostic-only. See the [user guides](docs/README.md) for setup and control details.

**Full Changelog comparison:** [v4.0.3-beta.6...v4.0.3-beta.7](https://github.com/KernowekConsulting/homebridge-giv-iog-local/compare/v4.0.3-beta.6...v4.0.3-beta.7).
