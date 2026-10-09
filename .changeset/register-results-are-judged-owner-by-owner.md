---
"clearotron-driver": minor
---

New: Judging register results owner by owner.

This release changes how a clearance reads what its register searches return. Until now the engine chose a shortlist first, then read the shortlist in batches and wrote its findings. On saved test matters, that approach dropped seven of the 43 lawyer-listed marks the searches had found, five without a recorded reason.

Now every owner the searches found is laid out in one table, closest marks first. Two independent reviews then judge it as a lawyer would, opening records where they need to, and answer on a fixed form. The engine checks both answers and combines them.

What you will notice:
- An owner is set aside only when both reviews set it aside.
- Each owner's rating comes from the two reviews: the rating they agree on, or the higher where they differ.
- The report's overall rating is the reviews' overall rating, taken the same way.
- How alike the marks are, and how close the goods are, come from the review whose rating was taken.
- A name the reviews set aside is listed under "Also considered" with their reason.
- A judged clearance lists no awareness-only items, because every owner the reviews carry is rated.
- Whether each part of the search was fully covered is now decided by fixed rules, not by the model.
- Reports keep their layout. A repeated search may name a different set of owners, and some coverage lines may read differently.

For operators: every owner a search found now has a recorded outcome in the run's own files, including owners neither review mentioned.

For operators: the third step of a run now runs two reviews side by side. A review that fails is tried up to three times; if one still fails, the run continues on the other.

For operators: there is no setting to return to the earlier method. Reinstalling the previous version restores it.
