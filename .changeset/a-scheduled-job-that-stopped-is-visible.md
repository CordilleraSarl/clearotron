---
"clearotron-driver": patch
---

Fixed: The deployment check now says whether each scheduled job's timer is still armed. A timer-driven service reads "inactive" between runs and when its timer has been stopped. So a check that asked only about the service could report nothing wrong while the scheduled work had quietly stopped happening.
