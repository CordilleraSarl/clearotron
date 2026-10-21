---
"clearotron-driver": patch
---

Fixed: A record whose register lookup failed, or came back empty, no longer counts as retrieved. The clearance now fetches it again, or says it could not.
