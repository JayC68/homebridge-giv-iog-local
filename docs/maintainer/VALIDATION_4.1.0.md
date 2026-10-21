# 4.1.0 validation scope

GivHome 4.1.0 promotes the runtime exercised through the 4.0.3 beta series. The stable candidate adds release identity and approved public documentation without changing the battery-control implementation proven in beta.10.

The owner’s live Homebridge Pi has run the beta line successfully. Preserved evidence includes completed Cheap Overnight charging, IOG handover and verified cleanup, continued telemetry and Local Learning with no recorded storage fault. Communication retries remain handled by the existing continuity paths. This is accepted field evidence; it is not presented as formal paired incremental CPU, memory or event-loop qualification across multiple Pi models.

Local Learning remains a bounded, local foundation. It cannot calculate or change a charging target and does not enable automatic solar planning. The owner reviewed this scope and accepted the field evidence for stable 4.1.0 readiness on 21 October 2026.

Upgrade testing covered legacy setting conversion, two consecutive Config UI saves, restart readback, saved Night Target and Emergency Stop state, forecast preference, control ownership, representative Eve totals, Local Learning data, cached accessory UUIDs and unknown owner-managed settings. The beta.10 simplifications additionally remove retired solar scale, forecast interval and export-comparison settings without changing unrelated behaviour or identities.

Release preparation on 21 October 2026 passed JavaScript syntax checks, 292 lifecycle, target, control, solar, observation and Config UI cases, and 17 native HomeKit cases against Homebridge 2.4.0/HAP 2.2.2. The accelerated two-day observation stress passed, the stable-readiness gate passed against the exact runtime fingerprint, and the dependency audit reported no vulnerabilities. The beta.10 publication workflow had already exercised the same control runtime on Node 24; the local stable-candidate run used Node 20 only as a supplementary host check.

The reviewed npm tarball must match the frozen publication digest and be rechecked by the trusted-publishing workflow on supported Node 24 before npm publication. Publication and deployment require separate explicit instruction and are outside this preparation record.
