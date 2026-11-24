---
"clearotron-driver": patch
---

Fixed: A Knockout of the same order now asks the market the same questions every time it runs. Each name is searched as written, with its words joined, and with its words hyphenated, together with one use phrase taken from the request. A name the client gives a different use keeps its own phrase. Before, the spellings and the use words were chosen afresh on every run, so a listing found only under the hyphenated spelling could be missed.
