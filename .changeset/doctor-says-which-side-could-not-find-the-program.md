---
"clearotron-driver": patch
---

Fixed: When the background services found the reasoning program at their last start and this machine cannot, `clearotron doctor` no longer tells you to install it where the services can see it. Doctor now says which side could not find the program, and what reaches the services: a restart, the program's full path in the file they read, or setup, which installs the program where none is found.
