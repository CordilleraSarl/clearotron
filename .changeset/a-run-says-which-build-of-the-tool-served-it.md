---
"clearotron-driver": patch
---

Fixed: A run record now says which version of the engine's command-line tool served it, so a change in results can be traced to a tool upgrade instead of guessed at. A version the tool could not report is recorded as unreadable rather than left out, which keeps "we asked and it would not say" apart from "nobody asked".
