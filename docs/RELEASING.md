# GivHome 4.0.3-beta.2 release gates

Wording-only follow-up to beta-1 commit `98a8facd1b59a5c2577580fc31daf4755e3a92d0`. Clarifies release notes, the changelog and Plugin Config guidance. Solar controls are grouped into three setup steps. Configuration keys, types, defaults and limits, accessory identities, charging decisions and Emergency Stop behaviour remain unchanged. Runtime identity advances to 4.0.3-beta.2.

Run the release checks and native HomeKit suites, verify source and packed package, compare the control logic with beta-1, audit dependencies and freeze the package hash before pushing the beta-2 tag. Trusted publishing must check the reviewed hash and use `beta`; leave `latest` at 4.0.2. Verify the public npm tarball against the reviewed package after npm processing completes. Correct beta-1's public GitHub release body separately; do not move its tag or replace its published package.

Keep the beta-1 package and source for rollback evidence, alongside the production 4.0.2 package already retained. No installation is part of the release operation. The existing rollback procedure and model/firmware limitations below continue to apply.

## Earlier release record

# GivHome 4.0.3-beta.1 release gates

Baseline: freshly cloned `release/v4.0.2` / `v4.0.2`, commit `28b781eaa647e7e96e8229cb007e41c28c311abc`. The default branch is legacy v3. PR #2 confirms the homepage. Preserve the established npm package name, platform alias and accessory identifiers. npm requires the valid prerelease version `4.0.3-beta.1` (displayed as beta-1).

Before publication: syntax checks for all JavaScript; full regression suite; adversarial simulated controls; native HAP checks; dependency audit; package manifest review; tests against the packed package; source diff review. Verify branch, tag and registry state have not changed. Publish only the reviewed SHA-256 tarball through trusted publishing, with the `beta` tag. Keep `latest` at 4.0.2. Verify the remote commit/tag, workflow, GitHub prerelease and registry tarball integrity; report each independently.

## Rollback first

This task authorises no installation or live inverter writes. Before any separately authorised installation, stop Homebridge and make a verified backup of plugin files, configuration, cached accessories, Eve history, flight recorder and the new solar/recovery state files. Retain the exact 4.0.2 npm package and record current inverter settings with the established read-only procedure.

For a separately authorised rollback, stop Homebridge and restore the verified backup or exact `homebridge-giv-iog-local@4.0.2` package through the existing installation method. Restore associated data only as appropriate, restart and inspect logs, telemetry and settings. A package rollback does not restore inverter registers and 4.0.2 cannot enforce the new Emergency Stop hold. Resolve any active recovery failure before rollback; do not delete its evidence to bypass a hold. Do not improvise inverter writes.

HR242 stays diagnostic-only. Original CH pre-session restoration across restart, complete live overnight boundaries and original failure-recording replay remain unproved.

## Earlier release record

# GivHome 4.0.2 release record

The owner authorises design, implementation, regression testing, independent audit, GitHub push and npm publication. No live Pi deployment or inverter writes are authorised. Baseline is canonical `release/v4.0.1` commit `39681e6e0ffa7594b0c951a0003304d9d39407fc`; legacy main is outdated.

Build `release/v4.0.2` and tag `v4.0.2` only after syntax, runtime, native HAP, documentation, package and dependency audit checks pass and independent review is resolved. The trusted-publishing workflow reruns checks and verifies the exact reviewed tarball SHA-256 before npm publication. Verify the remote commit/tag, workflow success, registry version/latest, and byte-identical public tarball. GitHub publication alone does not establish npm publication.

The evidence bundle records design, test output, independent review, source diff, package manifest and integrity. Retain baseline and source archives without secrets, dependencies or live recordings.

## Rollback for a separately authorised installation

Before installing, stop Homebridge and make a verified backup of plugin files, configuration, cached accessories, Eve history and flight recorder. Record inverter settings using the established read-only procedure. Keep the exact previous npm package or backup accessible. Installation is a separate task.

If rollback is needed, stop Homebridge, restore the verified previous plugin and associated backup as required, or install exact `homebridge-giv-iog-local@4.0.1` via the existing installation method. Restart and inspect logs, telemetry and settings. Preserve evidence before replacing files. Do not assume a package rollback restores an inverter snapshot lost at restart; do not improvise register writes. 4.0.1 still contains the slider/IOG coupling.

HR242 remains diagnostic-only. Original CH pre-session restoration across restart, full live overnight boundary and complete failure-recording replay remain unproved. Cleanup keeps HR96 disabled.

## Previous 4.0.1 release record

# GivHome 4.0.1 release record

The owner authorised promotion of the privately tested Charge Target correction, GitHub publication and npm publication on 10 October 2026. Version 4.0.1 changes runtime identity and release documentation from the tested private build; it does not add HR242 writes or change charge ownership policy. Publication does not authorise another Pi installation.

## Source and history

Release branch: `release/v4.0.1`, based on the published `v4.0.0` tag. The default branch remains the legacy v3 line. Stable v4.0.0 source matched all 42 then-installed package files on the Pi. The originally requested source ZIP was unavailable; no beta package is the release baseline.

Root release notes and full changelog are included in GitHub and npm. Earlier v3 history remains in `docs/CHANGELOG_V3.md`. README links expose both documents. The GitHub body is generated from root release notes with links into the tagged `v4.0.1` tree and the complete `v4.0.0...v4.0.1` comparison.

## Verified scope and limitations

The private Pi trial passed 32 charge runtime tests, four native HomeKit tests and five installer safety tests. The owner exercised the Apple Home slider and verified its corrected always-On presentation. Active general-limit changes were read back. IOG resumed after two live-session restarts with the latest dispatch end of 15:30. Subsequent readback confirmed HR96 disabled.

Original pre-session snapshot restoration across CH restart is unproved: the snapshot is in memory. Cleanup intentionally keeps HR96 disabled instead of reinstating a previously enabled schedule. A full live overnight boundary, complete failure recording replay and all model/firmware combinations remain unverified. Do not describe them as resolved.

HR242 remains diagnostic-only in configured workflows. Changing it from 80% to 100% through the official app restored approximately 5.7 kW charging on the owner's CH inverter with the schedule unchanged. This release does not automatically correct that limit or guarantee a selected target when limits conflict. Generic engineering transport helpers must not be invoked speculatively.

## Voice and documents

Use calm household language, British spelling and established feature names. Lead with the practical choice in Home, then explain verified behaviour and limitations. Preserve historical changelog entries. Do not call the retained 80% limit fixed or promise complete restoration across restart.

## Publication and verification

Run syntax checks, npm tests, native HAP tests and package-manifest checks before tagging. Record the Git commit, tag and package SHA-256. The canonical `publish-npm.yml` workflow uses trusted publishing for the approved `v4.0.1` tag, reruns checks and publishes only 4.0.1.

Create the GitHub release with the reviewed `docs/GITHUB_RELEASE_v4.0.1.md` body. Verify tagged documentation and comparison links. Confirm npm version, latest dist-tag and package integrity against the reviewed tarball. A failed publish must be reported; GitHub publication alone is not npm publication.
