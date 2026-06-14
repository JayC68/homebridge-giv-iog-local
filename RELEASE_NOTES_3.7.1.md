# GivHome v3.7.1

Small reliability and usability release.

Highlights:
- Fixes HomeKit firmware/build metadata so the plugin reports the stable v3.7.x build correctly.
- Standardises user-facing wording on Evening Excess Export throughout docs, schema, release notes and logs.
- Adds a GivHome Evening Excess Export switch in Apple Home so configured users can arm or disarm the feature day to day without opening the Homebridge UI.
- Keeps Homebridge UI as the setup area for battery size, reserve SOC, export power, start time, slot length and safety margin.
- Clears Evening Excess Export in-memory state if export start verification fails and fail-safe cleanup is issued.
- When the Apple Home switch disarms an active Evening Excess Export session, GivHome issues and verifies discharge cleanup.
- No platform rename, no background polling, no GivTCP restart logic and no additional Modbus probing.
