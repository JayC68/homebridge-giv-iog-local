# 4.0.0 release provenance

## Provenance

Functional baseline: hash-validated installed `homebridge-givhome-modbus` 1.3.1 source acquired from `/var/lib/homebridge/node_modules/homebridge-givhome-modbus`.

v4 identity/legal/publication reference: hash-validated installed `homebridge-giv-iog-local` 4.0.0-beta.2 source acquired from `/var/lib/homebridge/node_modules/homebridge-giv-iog-local`.

Parent evidence bundle SHA-256: `d7b81d268be7f42994d7a4f23857b1935768d5b0cfbf7c16c1c380ff279c0e5f`.

## Construction rule

1. Retain the 1.3.1 functional implementation, including mature Eve Energy, Predicted Solar, fast cached HomeKit command state, authoritative background inverter reconciliation, Flux requested-energy budgeting/observed-discharge stop/active-route recovery/single-peak completion, Agile, IOG and guarded direct-Modbus controls.
2. Promote package identity to `homebridge-giv-iog-local` 4.0.0 while preserving `PLATFORM_NAME` / `pluginAlias` = `GivHomeModbus`.
3. Preserve all pre-existing v4 UUID seed recipes and configured-name fallback. Predicted Solar is the only deliberately new accessory family.
4. Retain the 1.3.1 Smart Window improvement: the Smart Window tile follows `cheapActive`.
5. Restore the v4 GPL-3.0-or-later legal, security, support, trademark, migration and publication layer.
6. Use the mature 1.3.1 README/CHANGELOG as the editorial basis, adapted truthfully for v4.
7. Do not publish historical Modbus `EVIDENCE.md` or stale beta verification clutter.
8. The 4.0.0 release was prepared without switching the production Homebridge instance away from the live 1.3.1 controller. This avoids concurrent ownership of the same inverter and HomeKit surfaces. Any later production switchover should use a fresh verified rollback and a single-controller transition.
