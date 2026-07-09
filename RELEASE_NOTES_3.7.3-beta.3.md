# GivHome v3.7.3-beta.3

Targeted beta validation build.

## Fixed

- Cleanup verification now treats a disabled schedule as safe even when the inverter still exposes stored inactive slot times.
- Stored inactive slots are reported as informational context rather than as failed cleanup.

## Preserved from v3.7.3-beta.2

- CE / AC-coupled charge slot handling keeps using slot 1.
- CE systems read and remember the existing user slot before temporary GivHome charge writes.
- CE cleanup reinstates the remembered user charge slot and enable state where readback is available.
- GivTCP write anomalies such as `AttributeError` or contradictory success text remain hard command anomalies.

## Notes

This beta does not move the npm `latest` tag. It is intended for validation via the `beta` npm tag.
