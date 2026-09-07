---
"clearotron-driver": patch
---

Fixed: The configuration audit now refuses when one of the files it reads is missing, instead of reporting that nothing sets the variables that file records. Its answer decides which settings look unused, so a file it could not read was being counted as a file with nothing in it.
