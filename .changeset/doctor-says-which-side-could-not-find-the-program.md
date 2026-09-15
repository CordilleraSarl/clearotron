---
"clearotron-driver": patch
---

Fixed: When this machine cannot find the reasoning program the background services found, `clearotron doctor` says so, instead of advising an install the services can see.

New: When the background services could not find the reasoning program, `clearotron doctor` suggests a restart, then setup or the program's full path in the file the services read.
