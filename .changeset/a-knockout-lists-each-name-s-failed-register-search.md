---
"clearotron-driver": patch
---

Fixed: A Knockout report now lists, under "Left open" on a name's page, a register search for that name that got no answer. Before, the failure showed only as "not available" in the counts table, and a name whose other searches found filings read as if it had been searched in full. A register count that gets no answer is now asked once more before it is left open, so a dropped connection no longer leaves a gap on its own.
