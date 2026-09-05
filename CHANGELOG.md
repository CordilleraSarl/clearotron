# Changelog

What changed in each release of Clearotron, in plain English.

Install or upgrade with `npm install -g clearotron`.

## 0.1.1-beta.1

- A case-law sign-in that is present but no longer usable is now reported as such, instead of being counted as ready.
- The third-party licence notices now list every package the product bundles.
- The connection steps shown for Cowork and Perplexity now match what those apps actually ask for.
- The demo's port setting now moves every connection it opens, so a demo cannot take the ports of an installation running beside it.
- Stopping the demo now closes every connection it opened, instead of leaving some listening.
- Installing Clearotron no longer downloads an AI vendor toolkit that the product never uses.
- Settings renamed in an earlier release are now reported at start-up and by `clearotron doctor`, so an upgrade cannot quietly ignore them.
- Updating an installation built from source now rebuilds the web interface, so it no longer serves the previous one after an update.
- Stopping a backgrounded command now stops everything it started, instead of leaving the engine, client and portal connections listening.
- An assistant connected to Clearotron no longer asks permission before reading; it still asks before starting or stopping a search.

## 0.1.1-beta.0

- Every release now carries a signed record of the commit and the build that produced it, so you can check that what you installed is what this repository holds.
- Removing the demo is one directory again: nothing it writes lands outside the folder it names, and running it no longer edits your copy of the repository.
- Your settings now live at `~/.config/clearotron/.env`, where an upgrade cannot delete them. An install set up before this keeps working and tells you once where to move the file. Before, upgrading a global install threw the settings away — credentials included — and every command still reported success.
- The demo offers the two example accounts it ships with. Three company names that were only ever test material are gone from the package.
- `clearotron doctor` now says how long the portal key has left and refuses when it has lapsed or is close to it. Before, a server stopped being able to start searches thirty days after setup, and reported it as a fault in the search engine.
- The health check now says when the portal screens are older than the sources they were built from, instead of reporting them as ready. Pulling an update leaves the built screens behind, and nothing used to say so.
- Asking the demo for a search it has no example of now explains what happened, that nothing was started or charged, and what to pick instead.
