---
"clearotron-driver": minor
---

New: `clearotron brandowner framework <key> <path>` points an existing company at a risk framework.

Which framework rates a company's matters is set on the command line. Until now the only verb there was `add`, which creates a company. A company made in the browser could not be pointed at its own rubric at all.

New: The framework's deck is checked before anything is written. A path that does not resolve, or a manifest that will not load, is refused. The company is left exactly as it was.
