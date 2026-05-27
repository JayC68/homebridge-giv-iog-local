# GivHome 3.6.3 Release Notes

GivHome 3.6.3 is a clarity, confidence and battery-care release.

It does not introduce new inverter-control behaviour beyond the tested 3.6.2 beta line. Instead, it productises the recent Battery Care Charging and Excess Energy Export work so normal households can understand what the features do, why they matter, and when to use them.

## Headline

**Your battery quietly does the right thing, automatically.**

## What changed

### Clearer Battery Care Charging wording

Battery Care Charging is now described as kinder overnight charging during the main cheap-rate window. The documentation makes clear that it is about reducing unnecessary battery stress when there is enough time to charge more gently.

### Clearer Excess Energy Export wording

Excess Energy Export is now explained as local evening export management for spare battery energy before the next cheap overnight charging window. It is not described as Agile export optimisation.

### Better non-technical onboarding

The README and website now focus on household outcomes rather than implementation detail:

- less day-to-day battery management
- local control
- Apple Home visibility
- battery asset care
- sensible evening export
- fewer manual automations

### Homebridge config wording review

The config descriptions now use calmer, more human wording for Battery Care Charging and Excess Energy Export, while preserving the existing settings and defaults.

### Public website refresh

The website copy has been updated to match the current feature set and project voice. Green GivHome logo assets remain the required visual identity.

## What did not change

- No Agile pricing automation was added.
- No new backend inverter-control behaviour was added after v3.6.2-beta.6.
- Standard charging, Battery Care Charging and Excess Energy Export behaviour are intended to remain unchanged from the validated beta line.

## Recommended upgrade path

Upgrade from the latest 3.6.2 beta if your system is stable and you want the documentation/config wording polish. As always, check Homebridge logs after upgrade and confirm your GivHome config values still make sense for your battery system.
