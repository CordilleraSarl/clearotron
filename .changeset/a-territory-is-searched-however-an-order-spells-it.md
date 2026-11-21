---
"clearotron-driver": patch
---

Fixed: An order now searches the same register office however it spells a territory, on Signa, Corsearch and Clarivate. "UK" searches the UK register as "GB" and "United Kingdom" do, "INT" searches WIPO's international register, and "EM" searches the EU register on Signa as it already did on the other two. Names such as "England", "Holland" and "Czech Republic" are recognised instead of being reported as an unknown territory. Before, a Signa installation reported a "UK" or "EM" order as not searched, a Corsearch installation sent "UK" where the other spellings sent "GB", and a Clarivate search could refuse a name such as "Singapore".
