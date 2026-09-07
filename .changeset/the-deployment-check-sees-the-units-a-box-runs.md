---
"prelim-driver": patch
---

Fixed: The deployment check now reports the services a box is actually running. It had been asking systemd about unit names left behind by a rename, so a healthy box reported nothing running.
