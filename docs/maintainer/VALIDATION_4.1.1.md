# GivHome 4.1.1 validation

Documentation-only patch to v4.1.0. The main changelog lists stable releases only; beta history is retained in existing GitHub tags and prereleases. Release verification rejects prerelease and development headings in the main changelog and confirms every prior stable v4 release remains.

Compared index.js and lib/evidence-led-constants.js with v4.1.0: release version strings are the only runtime changes. Other runtime, configuration schema, UI, dependencies, accessory identities and saved-state formats are unchanged. The accepted 4.1.0 field evidence remains applicable; this patch makes no additional hardware claims.

Local release checks, the full 292-case test suite and 17 native HomeKit cases passed. Packed-file source comparison and digest verification are required before the tag is pushed. The publication workflow repeats tests, syntax checks, audit and the frozen package hash on Node 24 before stable npm publication.
