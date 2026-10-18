# GivHome 4.0.3-beta.4 — Stop this action, keep the next one

Stopping an unwanted charge or discharge should not stop tonight’s Cheap Overnight, leave tomorrow’s schedules disabled, or make you wait for an old action’s finishing time before starting something else.

This beta corrects those control and recovery paths, including two-slot CE/AC and ED/Hybrid profiles alongside CH/All-in-One.

## A one-time Emergency Stop

Seen unwanted or unexpected charging or discharging? Switch on **Emergency Stop** in Apple Home to ask GivHome to find and stop the current forced operation and return to Eco.

The tile acknowledges the request promptly while GivHome checks and verifies the inverter. Once the stop is verified, it returns to Off and new deliberate actions are available immediately. There is no extra wait until the stopped action’s former finishing time.

If nothing is running and Eco is already normal, GivHome reports **nothing running** and leaves controls and future schedules alone.

Tick **Show Emergency Stop tile** in Plugin Config to add it. It remains off by default and uses the existing appliance-control acknowledgement and model gates.

## A dropped connection should be recoverable

If communication is interrupted, GivHome keeps its recovery record and retries with bounded delays. It reads back what actually happened before deciding whether another write is needed. Recovery can continue after a Homebridge restart.

A genuine unresolved fault still appears in Apple Home and the Homebridge log. A quick request acknowledgement is not proof that the inverter stopped; check the logged result and fresh power readings.

## Looking after the next action

GivHome now records which action owns borrowed settings. Ending an action restores its captured settings and reconciles the shared enable flag with future schedules. Old timers, unrelated Off presses and refused starts cannot cancel a newer action or an operation belonging to another controller.

Emergency Stop cancels the current occurrence. A cancelled recurring hardware window is temporarily cleared, then restored after that occurrence ends, unless newer settings have replaced it. The known CH slot 8 one-off route is cleared rather than replayed. GivHome also remembers a cancelled automation occurrence so its supervisor does not immediately restart the same action under another label. Later eligible windows can run normally, subject to their usual settings and safety gates.

Cheap Overnight retains priority during its configured window. Intelligent Octopus Go battery protection keeps its own target and continues to take over after the overnight window if enabled. Existing reserve limits, Flux single-peak protection, Agile learning and Eve history remain in place.

## Upgrading

Keep a Homebridge backup and the exact previous package for rollback. This is an opt-in beta on the **beta** channel; **latest** remains 4.0.2. Older Emergency Stop records are reconciled against fresh inverter evidence rather than simply waiting for an old deadline.

Register simulations and native HomeKit tests cover interrupted reads and writes, restart recovery, idle stops, future schedules, two-slot profiles and clock-change boundaries. They do not establish behaviour on every inverter or firmware. **HR242 remains diagnostic-only.** See [control recovery and model limits](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.3-beta.4/docs/CONTROL_LIFECYCLE.md) and [validation details](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.3-beta.4/docs/VALIDATION_BETA4.md).

The optional local learning foundation is unchanged and remains off by default. **Observation history and learned models stay on your Homebridge device; none is sent to the developer.** Physical Pi resource qualification remains pending. See the [local learning guide](https://github.com/JayC68/homebridge-giv-iog-local/blob/v4.0.3-beta.4/docs/SOLAR_OBSERVATION.md).

**Full Changelog comparison:** [v4.0.3-beta.3...v4.0.3-beta.4](https://github.com/JayC68/homebridge-giv-iog-local/compare/v4.0.3-beta.3...v4.0.3-beta.4).
