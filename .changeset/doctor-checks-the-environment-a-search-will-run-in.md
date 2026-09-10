---
"clearotron-driver": patch
---

Fixed: `clearotron doctor` now reports everything a search would be refused for, checked against the environment the search will run in. So an installation it passes is one that can run a search.

Fixed: A token set in the installation's own configuration file now reaches the engine check. A headless server set up the documented way proves its engine instead of reporting it signed out.

Fixed: When a search is refused because the installation is not configured, the message names every configuration file that reaches the run.

Fixed: The signed-out message now offers a sign-in route for a machine with no browser.
