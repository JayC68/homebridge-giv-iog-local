# Safety model

GivHome is designed to be cautious rather than clever at any cost.

## The basics

- It reads before writing where practical.
- It writes through a local command queue.
- It verifies important writes with readback.
- It avoids blind resends when an acknowledgement is uncertain.
- It cleans the shared CH/AIO export route after Flux, Agile or manual export use.

## Export route cleanup

For CH/AIO systems, scheduled export uses a shared route. GivHome clears the route after use:

```text
HR59=0
HR291=0
HR292=0
HR293=0
```

This avoids stale export slots hanging around after an automation has finished.

## Power ratio notes

GivHome still writes and reads back the export power-ratio register where useful.

On CH/AIO scheduled export, live evidence showed that the inverter may accept the value but still export at its own higher rate. For Flux Export, v4 therefore budgets using observed discharge power rather than assuming the requested ratio is being obeyed.

## Practical advice

Test new export features while you are at home and able to watch the system.
