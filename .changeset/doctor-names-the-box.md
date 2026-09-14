---
"clearotron-driver": patch
---

Fixed: `doctor` now names the deployment it is checking, and refuses a name that is missing or not recognised. Before, a deployment that was misnamed — or not named at all — passed the check in silence.
