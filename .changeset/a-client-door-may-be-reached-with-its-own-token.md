---
"clearotron-driver": patch
---

Fixed: The configuration check no longer reports a problem when the client connector's address is reached with its own token. Putting a single sign-on front before it is the client's choice, and running it token-based is supported. The check still says the sign-in audience was not compared against that address, so it never implies the two agree.
