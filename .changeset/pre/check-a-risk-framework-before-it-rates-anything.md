---
"clearotron-driver": patch
---

New: `clearotron framework <your-framework.md>` reads a risk framework and its manifest, and reports what they declare.

Run `clearotron framework` before either rates a matter. It prints the ladder in the framework's own order, the company the deck names, and the shape it is. Where the deck and the manifest disagree, it names the band and says what the deck did not do. It creates nothing, rates nothing and contacts nobody, and it exits non-zero when the pair is not ready. `clearotron brandowner add --dry-run` prints the same report.

A deck whose shape is wrong used to fail quietly. The profile screen showed the framework's title and your band colours, and silently omitted the box saying what the bands mean. `clearotron framework` answers that question directly, using the screen's own read of the deck.

Fixed: When you have a configuration store set and a risk framework comes from the product's own files instead, the product now says so.

Your store is looked in first, and the product's files answer when it is silent. The product ships decks under names you may also have chosen. So a deck that went missing from your store was replaced by ours rather than reported absent. Same band words, different rubric, nothing raised anywhere. The profile screen now writes one line naming what happened, and `clearotron framework` reports it.

Fixed: The built-in triage framework's profile page explains its bands again. Its band sections stated their meanings as plain paragraphs, which the screen does not read. Every company without a framework of its own saw band colours and no explanation. The wording is unchanged.
