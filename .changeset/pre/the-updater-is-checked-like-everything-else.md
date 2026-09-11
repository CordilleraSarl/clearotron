---
"clearotron-driver": patch
---

For operators: The deployment health check now reports whether the component that updates an installation is itself up to date. It was the one part of a deployment the check could not identify. An installation kept current by an out-of-date updater could report healthy while serving stale code.

For operators: An updater that cannot be identified is now reported as a failure rather than passed over. A copy old enough to predate this reporting writes nothing at all. That silence is the case worth knowing about, so it is treated as a finding.
