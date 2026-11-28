---
"clearotron-driver": patch
---

For operators: When the engine check fails, `clearotron doctor` and setup say what to do next in Clearotron's own words, and no longer print the engine's own output. A program that stopped before it produced anything is reported as a check that could not be completed, not as a sign-in to do. When `clearotron doctor` probes the register, it says whether the register did not answer or answered with an error, without the register's own text. A parked run's reason no longer carries the engine check's words.
