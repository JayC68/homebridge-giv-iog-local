# GivHome user guides

Start with the guide for what you want to do. Configure the plugin through the Homebridge UI.

| I want to… | Guide |
| --- | --- |
| Choose my overnight battery level in Apple Home | [Night Target](CHARGE_TARGET.md) |
| Use Intelligent Octopus Go, Flux or Agile | [Octopus features](ADVANCED_OCTOPUS.md) |
| Adjust overnight charging for solar or use Emergency Stop | [Solar-Aware controls and Emergency Stop](BETA_CONTROLS.md) |
| Enable, pause or reset local learning | [Local learning](SOLAR_OBSERVATION.md) |
| Understand control safeguards and limitations | [Safety](SAFETY.md) |
| Fix missing data or controls that will not start | [Troubleshooting](TROUBLESHOOTING.md) |

## Finding your settings

Plugin Config follows the setup journey: connect your inverter, choose overnight charging and IOG protection, then set up solar and export features. Battery Care sits beside Cheap Overnight. Local Learning follows Predicted Solar — advanced, and Solar-Aware Cheap Overnight follows the forecast setup.

Open the feature you want and enable it to see its settings. Custom export days and time windows appear beside their selectors. Advanced options stay with the feature they affect. Hiding these settings preserves their saved values.

Local Learning is enabled by default and can be switched off. It does not enable automatic solar planning. Read the safety guidance before trying charge or export controls.

For changes between versions, see the [release notes](../RELEASE_NOTES.md), [full changelog](../CHANGELOG.md) or [published releases](https://github.com/KernowekConsulting/homebridge-giv-iog-local/releases).

[Maintainer records](maintainer/README.md) are kept separately from these user guides.
