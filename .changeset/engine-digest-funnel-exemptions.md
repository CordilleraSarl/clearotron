---
"clearotron": patch
---

Declare the three digest passes that run outside the re-digest queue, and census them

The digest funnel's header claimed the queue was the only path to a re-digest while
three mechanisms had always dispatched their own. All three are legitimate; the
defect was that nothing said so, so the next reader trusted a rule the code did not
follow. The reasons are now recorded next to the queue and checked by a test that
fails both when an undeclared pass appears and when a declared one disappears.
