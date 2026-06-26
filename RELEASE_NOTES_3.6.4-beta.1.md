# GivHome v3.6.4-beta.1

Targeted Evening Excess Export beta fix.

## Fixed

- Evening Excess Export now explicitly sets discharge power before starting an automated evening export slot.
- Uses GivTCP `/setDischargeRate` with the configured Max Export Power value.
- Fixes a release metadata mismatch by aligning `BUILD_VERSION` with `package.json`.

## Added

- Optional Normal Discharge Power After Export (W), default 0 / leave unchanged.

## Notes

This build deliberately uses GivTCP REST endpoints rather than raw registers because GivEnergy devices vary across product generations and firmware families.
