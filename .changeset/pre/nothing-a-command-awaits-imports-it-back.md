---
"clearotron-driver": patch
---

Fixed: The setup and status commands no longer load the unit renderer while starting up. That shape once made an install command refuse to run at all. A check now refuses it anywhere it appears.
