# GivHome 4.0.3-beta.8 — Clearer overnight and Flux controls

**Night Target** replaces Charge Target in Apple Home, giving the overnight percentage slider a name that fits its tile. The configuration now makes clear that this target applies to Cheap Overnight only; IOG battery protection keeps its separate target. Your saved percentage and accessory identity are retained.

**Octopus Flux Export** now has separate configuration choices to enable the function and show its **Flux Out** tile in Apple Home. Hiding the tile leaves the enabled function following its configured rules. With the tile shown, Off stops GivHome-owned Flux export and prevents further starts; On permits eligible export again. After a Homebridge restart, Flux follows the enabled configuration again. Existing installations retain their tile unless it is explicitly hidden.

**Local Learning** now sits directly below Predicted Solar — advanced. Its description reflects that learning is enabled by default, can be switched off, keeps data locally and does not change charging.

Emergency Stop and Local Learning retain their beta.7 defaults and existing safeguards. HR242 remains diagnostic-only. See the [user guides](docs/README.md) for setup and control details.

**Full Changelog comparison:** [v4.0.3-beta.7...v4.0.3-beta.8](https://github.com/KernowekConsulting/homebridge-giv-iog-local/compare/v4.0.3-beta.7...v4.0.3-beta.8).
