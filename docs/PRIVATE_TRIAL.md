# GivHome 4.0.1 Private Trial

The `.1` private trial was installed on the owner's Pi on 2026-10-10 and its Apple Home slider was exercised. The `.2` private update corrected its unintended Off display and was installed with verified backups. The owner subsequently authorised promotion to public 4.0.1. This document retains the private installation procedure; it is not evidence of complete restart restoration. See [Charge Target](CHARGE_TARGET.md) and the [release record](RELEASING.md).

The installed 4.0.0 source matches all 42 files in the published baseline. The private package keeps the configuration, HomeKit identities and existing dependencies. Installation replaces only this plugin's directory; the Homebridge package-manager dependency declaration remains unchanged during the private trial. Do not run a plugin update or npm reinstall during the trial, as that may replace the private package.

## Before installation

The installer checks the package checksum and installed baseline, runs the offline tests on the Pi's Node 24 runtime, and prepares a replacement directory using the existing dependencies. It then stops Homebridge, backs up the original plugin, configuration, accessory/cache data, root JSON state and the complete flight recorder, and verifies the backup. Other Homebridge child bridges are unavailable while this service is stopped.

Backups are kept under `/var/lib/givhome-private-trials/` with restricted permissions, outside the Homebridge web-served directory. Old forensic bundles and unrelated software are not part of this working-state backup and are left untouched.

The inverter preflight is read-only. It verifies the configured serial and original AIO model code and refuses installation while charge, export or pause control is active. It captures the relevant registers before the plugin is replaced. The installer never sends inverter-control writes; after startup, the plugin uses the already-enabled controls and automation in the owner's configuration.

## During the trial

Keep the current 23:30-05:30 overnight period and 100% target for this test. Confirm that the existing Apple Home accessories appear without pairing again and that live data advances.

When IOG overlaps Cheap Overnight, check that Cheap Overnight remains in charge until 05:30 and the recorder reports IOG observing without new protection commands. At the overnight end, confirm the old command's cleanup occurs before IOG takes over, or charging is left disabled if IOG is inactive. Compare the saved general charging limits with the cleanup readback.

The separate `HR242` limit remains diagnostic-only. If it still holds 80%, the battery may still stop there. This trial is not proof that the reported 80% problem is fixed. Do not manually edit the register as part of this installation.

Restart recovery, complete customer schedule-enable restoration and broader model validation remain outstanding. Cleanup retains the inherited 4.0.0 policy of leaving `HR96=0`; it restores saved general targets, times and power without re-enabling a previously enabled customer charge schedule. Avoid restarting the plugin during an owned charging command in this first trial.

## Returning to 4.0.0

The installer prints the exact backup path and a rollback command after successful startup. The `rollback.sh` in that backup stops Homebridge, retains the trial plugin for inspection, restores the original installed 4.0.0 directory and starts Homebridge again.

Rollback keeps the current configuration, accessories and new flight-recorder evidence. The state archive is available separately if a wider recovery is needed; restoring it should be a reviewed action because it may replace later settings or history. Plugin rollback does not itself restore inverter registers.

## Public release

Record live startup and overnight results separately. Promote to public `4.0.1` only after reviewing those results and resolving the remaining conditions in [release preparation notes](RELEASING.md), with explicit approval to push and publish.
