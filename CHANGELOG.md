# Changelog

What changed in each release of Clearotron, in plain English.

Install or upgrade with `npm install -g clearotron`.

## 0.1.1-beta.0

- Every release now carries a signed record of the commit and the build that produced it, so you can check that what you installed is what this repository holds.
- Removing the demo is one directory again: nothing it writes lands outside the folder it names, and running it no longer edits your copy of the repository.
- Your settings now live at `~/.config/clearotron/.env`, where an upgrade cannot delete them. An install set up before this keeps working and tells you once where to move the file. Before, upgrading a global install threw the settings away — credentials included — and every command still reported success.
- The demo offers the two example accounts it ships with. Three company names that were only ever test material are gone from the package.
- `clearotron doctor` now says how long the portal key has left and refuses when it has lapsed or is close to it. Before, a server stopped being able to start searches thirty days after setup, and reported it as a fault in the search engine.
- The health check now says when the portal screens are older than the sources they were built from, instead of reporting them as ready. Pulling an update leaves the built screens behind, and nothing used to say so.
- Asking the demo for a search it has no example of now explains what happened, that nothing was started or charged, and what to pick instead.
