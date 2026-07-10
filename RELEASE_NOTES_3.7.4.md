# GivHome v3.7.4

Stable corrective release following v3.7.3.

## Fixed

- Restores reliable CH/AIO charging during both the normal 23:30–05:30 cheap window and Intelligent Octopus Go bonus dispatch windows.
- Treats contradictory GivTCP success wording as a warning rather than an immediate command failure.
- Continues through the full command sequence and lets `/readData` or `/getCache` verification determine the actual inverter state.
- Preserves hard failure handling for genuine GivTCP errors such as `AttributeError`, traceback, exception, explicit failure, or error responses.
- Prevents misleading GivTCP response text from triggering fail-safe cleanup that disables and clears a valid charging command.
- Retains the v3.7.3 CE read, remember, write, clean and reinstate behaviour.
- Retains the improved cleanup verification for stored inactive slots.

## Why this matters

Some GivTCP builds can return contradictory prose such as reporting “disable” after an enable request, or “enable” after a disable request, even when the inverter state is correct. GivHome now treats that prose as advisory and trusts verified readback as the source of truth.
