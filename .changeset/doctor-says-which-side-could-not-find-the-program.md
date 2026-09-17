---
"clearotron-driver": patch
---

Fixed: When the background services found the reasoning program and this machine cannot, `clearotron doctor` now suggests installing it here with setup. It used to suggest installing it where the services could already see it.

New: If a restart does not help the background services find the reasoning program, `clearotron doctor` says how to point them at it.
