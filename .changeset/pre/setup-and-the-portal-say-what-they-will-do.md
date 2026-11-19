---
"clearotron-driver": patch
---

Fixed: Setup now picks the one AI it finds ready on the machine as the default. When the free tier's EU credential is skipped, it offers the US-only register instead of leaving none. It asks for the USPTO download key before offering to build the US index, and says a US index not built yet is only present, not that its check passed. It says nothing about the EU register when the chosen register has no EU half. `clearotron run` with nothing after it, or with `--help`, now says how to run a clearance from a job file. In the portal, a suggested search names the project when the places came from the project, and removing all of a company's places shows Worldwide. A project that lists fewer marketplaces than its company can now be saved; the company's marketplaces are still searched. A company's run limits read "Runs a day" and "Waiting at once".
