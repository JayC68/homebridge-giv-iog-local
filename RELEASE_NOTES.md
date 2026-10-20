# GivHome 4.0.3-beta.9 — Safer upgrades, clearer setup

Plugin Config now prepares existing GivHome settings before showing the revised form. Long-standing installations keep their established identity and behaviour when older names, export choices or omitted settings are encountered. Saved Night Target, forecast preference, Emergency Stop state, action ownership, Eve history and Local Learning data continue to use their existing files and accessory identities.

The Config UI has a clearer flow and more direct explanations in the GivHome voice. Related features now sit together, advanced choices explain what they change, Solar Now describes its live generation percentage accurately, and new users receive clearer guidance for Advanced charging. Existing owner-managed settings that GivHome does not recognise are carried through a save instead of being removed.

**Night Target** remains the Cheap Overnight percentage slider. IOG battery protection keeps its separate target. **Flux Out** remains an optional Apple Home tile for an independently enabled Octopus Flux Export function. Emergency Stop and Local Learning remain enabled by default and can be disabled in Plugin Config.

Charging and export control rules are unchanged. HR242 remains diagnostic-only. See the [user guides](docs/README.md) for setup and control details.

**Full Changelog comparison:** [v4.0.3-beta.8...v4.0.3-beta.9](https://github.com/KernowekConsulting/homebridge-giv-iog-local/compare/v4.0.3-beta.8...v4.0.3-beta.9).
