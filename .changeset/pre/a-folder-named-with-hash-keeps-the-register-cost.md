---
"clearotron-driver": patch
---

Fixed: Installed under a folder named with `#` or `%`, setup's register check now reads the provider's cost instead of calling it unknown. It built the address of the provider's own declaration by hand, and those characters broke it. It now uses the address Node builds, which is also what Windows needs.
