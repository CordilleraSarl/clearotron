# Example per-customer worked examples — zephyr (synthetic)

Synthetic placeholder demonstrating a profile's `workedExamplesPath` hook. Real per-customer worked
examples are a customer-config-store artifact, not repo code.

**Convention (P6):** a per-customer file ADDS CALIBRATION and never replaces the voice. The before/after
voice pairs live in [`worked-examples.md`](worked-examples.md) → *Voice — worked before / after pairs*, and
a customer artifact that omits them leaves this customer's runs without the examples the house voice is
learned from. The house prose contract itself is carried unconditionally by the stage message, so the RULES
reach every run regardless of profile — it is the worked pairs that a replacement file can silently drop.
