---
"clearotron-driver": patch
---

Fixed: When a background service's unit and its settings file set the same value, `clearotron doctor` and `clearotron connect` take the file's, as systemd does.

Fixed: `clearotron doctor` and `clearotron connect` read a doubled percent sign (`%%`) in a background service's unit as one, as systemd does.
