---
"clearotron-driver": patch
---

Fixed: The portal now tells your browser not to store the data its screens read. Those responses carry people's names, company access and run lists, and nothing previously said how long a browser could keep them.

For operators: every JSON response from the portal now sends `Cache-Control: no-store` and `Vary: Accept`. A route that sets a stricter policy of its own keeps it.
