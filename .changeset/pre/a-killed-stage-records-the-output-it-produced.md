---
"clearotron-driver": patch
---

Fixed: A stage stopped at its time limit now records the output it actually produced. It used to record a small fraction, so a stage that was working read as one that had stalled.

The token totals `clearotron tokens` reports for runs with a stopped stage now include that output.
