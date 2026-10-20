# Release procedure

Use the active v4 release branch as the baseline; the default `main` branch is the legacy v3 line. Preserve the npm package name, platform alias and existing accessory identities.

## Prepare and validate

1. Update package/runtime identity, root release notes and changelog together. Keep current user guidance in the top-level user guides; keep engineering records here.
2. Run syntax checks, `npm test`, `npm run test:hap`, dependency audit and source/package review. Run the relevant observation and control simulations. Validate the packed package as well as the source.
3. Review [validation scope](VALIDATION_BETA4.md), [control lifecycle](CONTROL_LIFECYCLE.md) and the [qualification record](OBSERVATION_QUALIFICATION.json). Physical Pi performance and live overnight testing remain pending. Desktop simulations do not establish those results.
4. Check the runtime hash with `node tools/verify-observation-qualification.js --runtime-hash`. The qualification record must match the runtime and release. The explicit `--beta-publication` policy permits only the recorded foundation beta with its explicitly approved defaults; it does not qualify hardware or automatic control.
5. Generate the GitHub release body from the single source with `node tools/verify-release-notes.js --github-body`. Do not retain duplicate release bodies in docs. Publish from the immutable reviewed release tag so its generated links resolve correctly.

## Publish and verify

Freeze the reviewed tarball SHA-256 and update the trusted-publishing workflow for the new version, tag and digest. Do not move an existing tag or replace an existing published package. Documentation changes also change the package digest and require a new release before publication.

For an opt-in beta, publish the reviewed tarball to `beta`, leaving the stable `latest` channel unchanged. Verify the remote commit/tag, workflow, GitHub prerelease, registry version/channel and byte-identical public npm tarball independently. GitHub publication alone does not establish npm publication.

## Installation and rollback

Before installation, stop Homebridge and verify backups of the plugin, configuration, accessory cache, Eve/Agile history, flight recorder, charging/recovery state and observation directory. Keep the exact previous package available.

For rollback, stop Homebridge, restore the previous package through the established installation method, restore associated data only where appropriate, then restart and inspect logs, telemetry and settings. A package rollback cannot restore inverter registers. Resolve an incomplete recovery before rolling back; preserve its journal and evidence rather than deleting them to clear a fault. See [control recovery](CONTROL_LIFECYCLE.md).

HR242 remains diagnostic-only. Do not infer live model/firmware validation from documented register authority or successful automated checks. Release preparation does not include deployment or live inverter testing.

Historical release context is available in the [changelog](../../CHANGELOG.md), [provenance record](RELEASE_PROVENANCE.md) and [published releases](https://github.com/KernowekConsulting/homebridge-giv-iog-local/releases). Earlier tagged source retains the old release and private-trial procedures.
