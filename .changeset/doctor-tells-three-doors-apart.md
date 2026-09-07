---
"prelim-driver": patch
---

Fixed: `doctor` no longer reports a working Cloudflare Access door as unprotected. An API-style door and a failing origin are now told apart, each with its own message. Neither is reported as a pass.
