# Solar-Aware Cheap Overnight: automatic planning direction

The aim is for the household to choose an energy goal and let GivHome calculate the overnight charge. The current beta's forecast bands are a first step, not the final planner.

## What the planner needs to understand

- The solar forecast through the day, including when generation is likely to arrive, rather than only a daily total.
- Usable battery capacity, current charge, the configured reserve, charging losses and the inverter's charging limits.
- Expected household use before solar starts, during generation and later in the day. EV charging and IOG battery protection must retain their existing treatment.
- The cheap period and the time available to add energy, including whether the requested plan is physically achievable.
- Forecast uncertainty and a conservative fallback when data is missing or unreliable.

Battery capacity, PV capacity, inverter throughput and tomorrow's total forecast are useful inputs, but do not establish how much generation will be left to store after the house has used energy. Simply subtracting the daily forecast from battery capacity can leave the household short before solar generation begins.

## A household choice, followed by a calculation

Define the target clearly before implementation: a minimum reserve to protect and a desired battery level by a useful point in the day are different goals. The proposed experience should ask for one clearly labelled energy goal and reuse the existing reserve and safety settings, rather than expose forecast thresholds as routine setup.

GivHome would estimate energy needed before and after the useful solar period, allow for forecast uncertainty, and calculate the overnight charge and required charging rate. It would leave storage space only where the expected surplus can reasonably fill it. Capacity, the cheap period, inverter limits and the configured reserves constrain the plan. The Home interface should explain the result in household language—for example, how much cheap energy is planned and why room is being left for solar.

## Prove the decisions before enabling control

First record proposed plans without changing inverter behaviour, then compare them with actual solar generation, household use and battery levels. Include dull mornings followed by bright afternoons, forecast misses, high household demand, clock changes, missing data and IOG overlap. Preserve ownership, cleanup, rollback and Emergency Stop behaviour.

Implementation is a future development item. These documentation and Plugin Config corrections do not change the charging algorithm, targets, defaults or live-control behaviour.
