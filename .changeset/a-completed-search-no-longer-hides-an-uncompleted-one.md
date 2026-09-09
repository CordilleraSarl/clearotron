---
"clearotron-driver": patch
---

Fixed: A search that was planned and never run is disclosed on the report again, even when another search mentions the same word.

One row on the coverage section says a planned search never reached the register. That row was removed whenever another row's heading carried the same words. A row for a search that had run and found nothing could remove it.

So a report could mention a term in its coverage section and say nothing was left undone. The only disclosure of the gap had been dropped. A completed search no longer stands in for an uncompleted one.

Re-rendering an archived report restores the row where this had removed it.
