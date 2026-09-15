---
"clearotron-driver": patch
---

Fixed: `clearotron doctor --probe-engine` now tries Claude with the AWS keys in Clearotron's settings file, as a search does. It used to report a fault on an Amazon Bedrock machine whose searches worked.
