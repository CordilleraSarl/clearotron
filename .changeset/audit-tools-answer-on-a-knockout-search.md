---
"prelim-driver": patch
---

Fixed: The tools that show how a search reached its answer now work on a Knockout search. They previously returned nothing for one. No findings, no evidence, no record of what was searched. A delivered report was reported missing while it sat on disk. Anyone asking how a Knockout result was reached saw a blank record.

Fixed: The proof-of-search record now answers on these searches. It lists what was searched and came back empty, which is what answers a challenge to a result. Where a tool has nothing to show for this kind of search, it now says so in words. An empty list reads as "we looked and found nothing".
