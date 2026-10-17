# Let GivHome begin learning your home

Two homes with the same battery and panels can use electricity very differently. Before Automatic Solar-Aware Cheap Overnight can make good decisions, it needs trustworthy observations of that particular home.

This foundation begins collecting that evidence. It does not calculate an overnight target, change your charging settings or switch automatic control on. The existing three-band Solar-Aware Cheap Overnight feature continues to use your chosen settings. Intelligent Octopus Go battery protection keeps its separate target and takes over after the overnight window if enabled. Agile learning and Eve history keep their existing files and behaviour.

## Turn local observation on or pause it

In Plugin Config, open **Automatic Solar-Aware: local learning foundation** and tick **Learn locally for future Automatic Solar-Aware Cheap Overnight**, then restart Homebridge in the usual way. The option is off by default. Existing read-only polling supplies the observations; enable and configure Predicted Solar if you also want forecast records. Learning does not need the appliance-control acknowledgement because it cannot send commands.

Untick the option and restart to pause recording. Previously collected local data is retained; a later compatible restart can resume provisional summaries. There is no new Home tile in this foundation and no automatic charging switch to enable.

## What it learns so far

- Time-weighted energy from existing verified readings, recorded in compact minute and half-hour summaries. Gaps, invalid readings, control changes and incomplete intervals are labelled.
- Provisional weekday/weekend patterns of total site load and solar output. Site load may include an EV; GivHome does not subtract a guessed EV load or call it household-only demand.
- Observed charging response during ordinary GivHome-owned charging. This is not a measurement of usable battery capacity, a proven maximum power or permission to change power limits.
- Forecast revisions captured from existing weather responses. Earlier revisions are retained as received rather than replaced with a more accurate later forecast. Receipt time is not a claim about the provider's model issue time. Hourly GTI is the mean over the preceding hour; ambiguous DST labels are left unresolved.

All models remain **provisional**. This version does not calibrate solar corrections, qualify clean days, separate EV energy, prove unclipped generation, run a shadow planner or authorise automatic charging. Those require further implementation and evidence. Missing data lowers the quality of the evidence; it never becomes zero consumption. Counts of samples or elapsed days do not grant readiness.

Control labels describe GivHome's known state. They do not prove that an external app/controller is idle or replace inverter-mode readback. Future automatic planning must qualify that evidence separately. UTC interval keys and local UTC offsets distinguish repeated daylight-saving hours; provisional time-of-day profiles deliberately group observations by weekday/weekend and local half-hour.

Solar setup changes identify new solar evidence. Battery-capacity/power settings and installation identity govern reuse of charging summaries; the Homebridge time zone governs load profiles. A materially changed fingerprint resets the affected summary. Summaries older than 28 days are not reused as current learning. Firmware/capacity qualification remains unproved and cannot be inferred from these provisional observations.

## Your observations stay with you

Observation and learning run locally on your Homebridge device. Your energy readings, usage summaries, retained forecasts and learned model are stored and processed there. **GivHome does not send this observation or learning data to the developer or to a remote learning service.** There is no analytics or automatic support-upload feature in this component.

Solar forecasting continues to contact its existing weather and location services using the location and panel information needed for a forecast. Enabled Octopus features continue to use their existing service. Observation history and learned models are not added to those requests. API keys, raw configuration, postcode, account details and panel names are excluded from the learning records. Local records still reveal energy-use patterns: treat them as personal data.

This foundation does not create a diagnostic export. If you deliberately copy local files for support, you decide whether to share them; GivHome does not upload them. Backups made by your own Homebridge or operating-system tools may copy these files according to your backup settings.

## Small, bounded and separate

The component reuses existing readings and forecast responses. It adds no inverter polls, weather requests, cloud learner, database or resident worker. It buffers small records and writes in batches, normally every five minutes or at a queue watermark. An abrupt power loss can lose the last buffered observations; restart records a gap rather than inventing missing data.

Its pending queue is capped at **128 KiB / 256 records**, individual encoded records and model files at **32 KiB**, and its own directory at **32 MiB / 2,048 files**. Caps include previous and temporary snapshots. File-count and byte limits take priority over retention targets: roughly seven days of minute summaries, up to 180 days of half-hour aggregates and up to 28 days of forecast revisions. Busy sites may retain less. No unlimited archive or per-poll observation log is created.

Profiles use bounded, gradually decaying summaries. Older raw observations expire, so they cannot all be replayed later. Stored forecasts do not imply complete UTC coverage or qualified forecasting accuracy. Retained summaries are not a substitute for a future held-out validation period.

Storage faults or pressure drop/degrade observation work and mark gaps. They cannot acquire the command transport gate or send inverter writes. Repeated storage warnings are rate limited. A corrupt, oversized, incompatible or unexpectedly modified directory may suspend observation while ordinary GivHome operation continues.

The proposed **8 MiB retained-memory**, **16 MiB added RSS**, **below 1% of one core** and latency budgets still require matched tests on a declared minimum Pi and a busier Pi. Accelerated desktop tests do not establish those results. Publication remains gated on the 72-hour hardware qualification recorded in [release preparation](RELEASING.md).

## Check or clear local learning

The store is under your Homebridge storage directory, in `givhome-solar-observation`. There is one capped store for the existing single GivHome platform, so renaming or replacing an inverter does not leave growing directories behind. Installation/setup fingerprints identify compatible evidence inside that store without recording readable serials or postcodes. Use a separate Homebridge storage directory for each independent Homebridge instance. Files use service-account permissions. `model.json` contains provisional summaries, status, counts of gaps/dropped records/storage faults and the last checkpoint time. It updates in batches, not on every reading. `qualified` and `automaticControl` remain false. No extra HTTP endpoint is exposed.

To start again, enter a new short value such as `reset-1` in **Start local learning again**, then restart with observation enabled. The new value clears only this component's local records and model once. Keep the same value or leave it blank afterwards; use a different value for another reset. An interrupted reset finishes on restart. A changed reset value cannot erase Eve history, configuration, Agile learning or Emergency Stop recovery records.

For a complete manual removal, pause observation, stop Homebridge, and remove only `givhome-solar-observation` from that Homebridge storage directory. Keep other GivHome state files. A plugin rollback does not require deleting this directory; beta.2 ignores it. Resolve any active Emergency Stop recovery hold before rolling back, as described in the existing safety documentation.
