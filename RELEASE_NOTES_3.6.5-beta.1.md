# GivHome v3.6.5-beta.1

Emergency reliability beta focused on restoring dependable Intelligent Octopus Go battery behaviour.

## What changed

- Standard IOG charging now reasserts a safe charge state before every cheap/smart charge slot:
  - clears temporary charge pause
  - ensures battery pause mode is disabled
  - restores AC charge rate to 100%
  - then enables and writes the charge slot
- Battery Care / Smooth Charging is hard-disabled in code for this beta.
- Excess Energy Export is hard-disabled in code for this beta while we complete validation.
- The non-AC `/setChargeRate` path is no longer used by automatic IOG charging.

## Why

Real-world AIO testing showed that a prior beta state could leave normal IOG slot charging unreliable even when slot writes reported success. This beta prioritises the cornerstone behaviour: cheap/smart IOG windows must protect the home battery and charge it predictably.

## Recommended user action

Users on v3.6.4 should update to v3.6.5-beta.1 and leave Battery Care Charging and Excess Energy Export off.
