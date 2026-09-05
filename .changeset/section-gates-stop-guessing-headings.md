---
"clearotron": patch
---

Stop rejecting a finished report because the model worded a heading differently

A validator checked for required sections by matching the wording of their headings.
When the model wrote "Negative-results matrix" instead of "Negative results" the check
reported the section missing and killed the run — on work that was complete and
correct. Sections now carry an invisible marker the validator reads instead, so wording
is free. Documents without the marker are judged exactly as before, so nothing already
delivered changes.
