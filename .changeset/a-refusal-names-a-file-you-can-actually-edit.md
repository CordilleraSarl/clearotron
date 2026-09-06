---
"prelim-driver": patch
---

For operators: When a background install stops because engine settings are missing, it now names the files to put them in. It previously pointed only at the setup wizard, which refuses to run outside a terminal — so a scripted or hosted install was being sent somewhere it could not go. The same applies to the missing report-pool setting.
