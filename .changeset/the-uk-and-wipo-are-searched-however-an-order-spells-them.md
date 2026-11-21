---
"clearotron-driver": patch
---

Fixed: An order that names the United Kingdom as "UK" now searches the UK register on Signa, Corsearch and Clarivate, as "GB" and "United Kingdom" already did. Before, a Signa installation reported the UK as not searched, and a Corsearch installation sent "UK" where the other spellings sent "GB". An order that names WIPO's international register as "INT" is now searched there on all three, where before it was reported as not covered.
