# Register control sources

Endpoint reset/restore capability uses documented mappings, supported profile selection and fresh readback. This is distinct from live model/firmware qualification.

References retrieved 18 October 2026 at pinned commits:

- [GivEnergy/givenergy-modbus2: givenergy_modbus/model/register.py](https://github.com/GivEnergy/givenergy-modbus2/blob/c0a1f8337cf5cfc3519e77f088850148a595a56d/givenergy_modbus/model/register.py)
  SHA-256: `856c7a454ab28e95a9b4ad062abf38a195b830236e1780543dbdf2bb764dad64`.
- [GivEnergy/givenergy-modbus2: givenergy_modbus/client/commands.py](https://github.com/GivEnergy/givenergy-modbus2/blob/c0a1f8337cf5cfc3519e77f088850148a595a56d/givenergy_modbus/client/commands.py)
  SHA-256: `e7da5011e31d718051244409915cec9c81f3c18882ca4b972c9dfb9fa7da5f03`.
- [dewet22/givenergy-modbus: givenergy_modbus/client/commands.py](https://github.com/dewet22/givenergy-modbus/blob/f7d8ff5f1844017f4032b461e64e268990ac89af/givenergy_modbus/client/commands.py)
  SHA-256: `5edb65cb46ba8aa9f7402249f1b0e28d44ba2a621a1f67d5288edc3ea62ac7ab`.

GivEnergy core commands explicitly reset both charge-slot endpoints to zero; the register model marks the core and second time pairs write-safe. The dewet22 command module maps ten charge/discharge slot endpoints, documents endpoint reset, and defines pause mode/timing setters. GivHome restricts CE/AC and ED/Hybrid to two slots and CH to its ten-slot namespace; it requires complete valid readback before mutation.

This capability authorises time endpoints only. It does not promote engineering limits or HR242 to writable targets. Existing CE acknowledgement, master control gate, queue, clock checks, uncertain-write reconciliation and final verification still apply.

See [control lifecycle](CONTROL_LIFECYCLE.md) and [validation scope](VALIDATION_BETA4.md).
