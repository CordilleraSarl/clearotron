---
"clearotron-driver": patch
---

Fixed: When the background services found the reasoning program and this machine cannot, `clearotron doctor` now suggests running setup to install it again. It used to suggest restarting the services.

New: If a restart does not help the background services find the reasoning program, `clearotron doctor` says how to point them at it.
