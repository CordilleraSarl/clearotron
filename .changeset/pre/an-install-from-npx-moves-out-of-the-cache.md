---
"clearotron-driver": patch
---

Fixed: `npx clearotron install` now installs Clearotron permanently under `~/.local` before setting up. The `clearotron` command and your assistants' connections keep working after npm cleans its cache. Commands the install, start and the New company screen print run as printed, from any directory.
