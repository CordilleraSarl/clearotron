---
"prelim-driver": patch
---

For operators: When systemd refuses to start one of the installed services, the background install now says what systemd said, which service refused, which ones are already up, and that re-running finishes the job. It previously ended in a raw crash dump with no statement of what had happened to the install.
