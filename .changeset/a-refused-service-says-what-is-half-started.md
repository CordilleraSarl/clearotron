---
"prelim-driver": patch
---

For operators: When systemd refuses to start one of the installed services, the background install now says what systemd said. It names which service refused and which ones are already up. It also says that re-running finishes the job. It used to end in a raw crash dump.
