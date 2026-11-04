---
"clearotron-driver": patch
---

Fixed: A record whose register lookup failed or came back empty no longer counts as retrieved; the clearance fetches the record again, or says it could not.
