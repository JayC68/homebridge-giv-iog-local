# 4.0.3-beta.4 validation

Candidate validation covers production control methods with memory-backed register banks and real filesystem recovery records. Socket connections are prohibited in the control simulation suite. Native HomeKit tests use Homebridge 1 and 2 service implementations.

The previous low-level stop executor has been removed. Its tests of disable-and-hold behaviour have been replaced by production lifecycle tests covering idle preservation, supported slot routing, future namespace eligibility, recurrence, action identity, partial cleanup, stale ownership, uncertain acknowledgements, every stop read position, lying acknowledgements, restart, legacy migration, invalid journals, midnight and both autumn-hour occurrences. Solar threshold and persistence tests remain separate.

The evening-stop-to-overnight incident is reproduced with simulated CH, CE and ED controls, followed by the actual overnight supervisor. A second scenario cancels Cheap Overnight during IOG overlap, verifies that it does not restart under the IOG label, then verifies handover after the overnight window.

Simulation and native-service results do not establish live behaviour across the fleet. Physical overnight boundary testing and Pi CPU/memory qualification remain pending. The optional observation foundation remains off by default; automatic solar planning is not enabled. See [local learning](../SOLAR_OBSERVATION.md).

Final command results, package digest and publication receipts are recorded with the release evidence. The release package is validated before publication; hardware qualification is not inferred from successful packaging.

## Local results

- Node 24.19.0: all 280 regression tests passed (218 charge/target/control lifecycle, 21 solar-band/persistence, 41 observation tests).
- Native HomeKit: 13 tests passed on Homebridge 1.11.1 / HAP 0.14 and 13 on Homebridge 2.0.0 / HAP 2.1.4.
- Predicted Solar deterministic harness and release identity/document checks passed.
- Syntax checks passed for all 49 JavaScript files; dependency audit reported zero vulnerabilities.
- Two-day accelerated observation smoke: 5,761 captures; maximum disk 1,166,122 bytes; maximum queued data 22,770 bytes; model 5,200 bytes; final retained heap increase about 0.57 MiB and process RSS increase about 10.8 MiB on the desktop host. This is a retention smoke test, not Pi performance qualification.

Hardware qualification remains pending. In particular, the simulated overnight recovery and repeated-hour cases require representative live confirmation after installation.
