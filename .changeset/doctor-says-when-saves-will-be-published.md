---
"clearotron-driver": patch
---

For operators: `clearotron doctor` now says where a company or project saved in the portal goes once it is recorded. Sometimes the settings folder sits in a copy of a repository that other work also pulls and pushes. The next person to do that then publishes those saves. Doctor now warns about this, and counts the saves still waiting to go. Publishing your settings on purpose is still supported: this is only a warning, and it does not change doctor's result.
