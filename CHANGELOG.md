# Changelog

## 4.0.0-beta.1

First v4 beta for `homebridge-giv-iog-local`.

This is the clean direct-local Modbus release line.

- Replaces the old GivTCP/MQTT control path for core local monitoring and control.
- Keeps the package identity used by existing Homebridge users.
- Adds observed-power Flux Export budgeting for CH/AIO systems.
- Keeps HR112 write/readback evidence, but does not assume HR112 is a live cap where the inverter proves otherwise.
- Keeps shared CH/AIO export-route cleanup.
- Keeps Agile Export in planner-only/dry-run mode unless deliberately live-enabled.
- Cleans the public README and published package surface.
- Changes v4 licence to `GPL-3.0-or-later`.

## 3.7.5 and earlier

Legacy GivTCP/MQTT release line.

The old v3 material should stay in Git history, tags or a legacy branch, not in the v4 npm package.
