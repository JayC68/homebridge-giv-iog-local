# GivHome v3.7.5-beta.1 Engineering Audit

## Baseline

- Proven CH/AIO reference: v3.7.2 npm package.
- Current CE-capable reference: uploaded v3.7.4 source tree.
- Stale telemetry evidence: 15 July 2026 flight evidence archive.

## CH/AIO result

The v3.7.2 timed charge/export command lifecycle remains the baseline. CE-specific failed-start cleanup is now conditionally attached only when `isCeAcCoupledSystem()` is true. Shared discharge start behaviour no longer carries the post-v3.7.2 failed-start cleanup hook.

## CE result

CE/AC-coupled systems retain the v3.7.4 single-slot preservation feature:

1. Require fresh `Stats.Last_Updated_Time` telemetry.
2. Read and persist slot 1, target SoC and enabled state.
3. Use slot 1 temporarily.
4. Reinstate the remembered state after completion or CE-specific failed start.
5. Keep the remembered state across plugin restart until readback confirms restoration.

## GivTCP recovery result

The recovery path is optional and disabled by default. When enabled it:

- requires telemetry state `offline`;
- requires a real `Stats.Last_Updated_Time` source;
- waits at least 900 seconds by default;
- invokes only a narrowly authorised host helper;
- never calls inverter-control REST endpoints;
- retains the existing automation block;
- requires a newer fresh source timestamp before declaring recovery;
- uses a six-hour default cooldown;
- makes no second attempt during the cooldown.

## Validation

- `node --check index.js`: pass.
- JSON parse of package, lock and config schema: pass.
- Regression audit: pass.
- npm package dry-run: pass, including new release notes and helper installer.
- Self-recovery default: disabled.
