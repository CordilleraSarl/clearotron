---
"clearotron-driver": patch
---

Fixed: `clearotron doctor`'s register check now tests the register your install is set up for.

A register or key kept only in your install's settings file came back as not set. The line just above it had shown it.

The check now reads the same settings as those lines, and a value set in your shell still wins.
