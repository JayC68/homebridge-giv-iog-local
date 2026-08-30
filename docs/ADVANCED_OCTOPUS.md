# Advanced Octopus features

These features are optional. Basic local monitoring works without Octopus.

## Intelligent Octopus Go

GivHome can protect the home battery during smart charging windows. It watches Octopus dispatch windows and applies local battery protection when configured.

## Octopus Flux Export

Flux Export uses the eligible peak window and your battery reserve settings to plan short export runs.

For CH/AIO systems, v4 uses observed/effective discharge power for energy budgeting. This is because the inverter may not obey the requested HR112 ratio during scheduled export, even when the register write succeeds.

## Agile Export

Agile Export can run as a planner/observer. In planner-only/dry-run mode it does not write to the inverter.

Live Agile export should only be enabled deliberately, with the acknowledgement setting, after planner evidence looks sensible.
