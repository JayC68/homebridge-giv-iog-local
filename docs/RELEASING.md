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
