---
"clearotron-driver": patch
---

Fixed: Pressing "Stop now" no longer says the step in flight has ended. It says a stop was sent, and what happens if the step will not take it.

A stop is sent to the step under way. If it takes it the run ends in seconds; if it does not, the run ends at its next step. The old wording promised the first of those every time.

Fixed: The notice shown while a run is stopping no longer overlaps the elapsed time on the card.

It has its own line under the run, so "1 min so far" stays readable while a stop is in flight.
