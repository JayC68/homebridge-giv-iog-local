# Night Target

Night Target is a percentage selector in Apple Home. Look at Solar 2mrw, then choose the battery level you want Cheap Overnight to work towards. Apple Home supplies its native dimmer detail screen; the plugin cannot customise that screen or promise a direct swipe on the compact tile. HomeKit will classify it as a light, so broad lighting scenes may also address it.

## One saved choice

The supported range is 4-100%, in whole percentages. The saved target controls Cheap Overnight only. IOG charge-mode battery protection uses `iogChargeTargetSoc` (default 100%). Timed Charge tiles use configured `targetSoc` and ignore the saved slider override. It is not the current Battery Level, an export reserve or a limit on PV charging. It does not start charging, change the overnight times, enable disabled automations or alter IOG pause modes. The older engineering Manual Charge switch remains outside this setting's scope.

The tile stays On because it represents a setting. Off requests are refused; they do not select 0%, disable an automation or stop charging. Apple Home's exact presentation needs testing on the owner's phone before installation is considered complete.

## Homebridge settings

The configured `targetSoc` is the starting target. A choice saved from Home overrides it and survives restart. Changing the configured target supersedes that choice on restart. Setting `enableChargeTargetTile` to false hides the tile and returns to the configured target after restart. Re-enabling it can restore the earlier Home choice if the configured target is unchanged.

The preference is stored in a `givhome-charge-target-<identity>.json` file under Homebridge storage. It is scoped to the platform name and inverter serial, replaced atomically and created with mode 0600. Homebridge's config.json is not edited. A missing or invalid preference falls back to the configured target, with a warning for invalid data.

## Taking care of the detail

Outside an owned charge session, a slider change saves the next target without inverter writes. Offline changes can be saved too. A future eligible charge uses that target through the existing guarded command lifecycle.

During a Cheap Overnight charge owned by this running GivHome instance, changes are combined for 750 ms and placed on the shared command queue. Ownership, fresh register values, automation-window boundaries and online health are checked again before updating the validated general controls HR20/HR116. Readback checks the target and unchanged times, power and enable state. The first customer snapshot is retained for normal cleanup. A failed update retains the desired target for a later retry and exposes a HomeKit communication error rather than claiming success.

The regular automation loop retries target updates. No target correction is attempted for a charge whose ownership cannot be established, including a session left over from before restart. This does not solve the existing restart-recovery limitation.

On CH/AIO, HR242 is still read and left unchanged. If it remains 80%, selecting 100% does not establish that charging will pass 80%. The displayed percentage is the requested target, not proof of the effective slot-specific ceiling. A model-specific HR242 write requires separate validation.

## Release status

Version 4.0.2 corrects the unintended IOG sharing introduced in 4.0.1. Both new IOG commands and active-session reconciliation are isolated from the slider. It retains the stable accessory identity and saved-preference file format. HR242 remains diagnostic-only, and restart does not establish the original CH pre-session snapshot. See [release notes](../RELEASE_NOTES.md) for validation and limitations.
