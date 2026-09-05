# prelim-driver

## 0.1.1

### Patch Changes

- 69b52a4: Fixed: The instructions for running from a clone no longer show a short command form that only a global install provides.
- 6d05f62: Fixed: A case-law sign-in that is present but no longer usable is now reported as such, instead of being counted as ready.
- 6d05f62: Fixed: The package now includes its third-party licence notices, and they list every package it bundles.
- 6d05f62: Fixed: The connection steps shown for Cowork and Perplexity now match what those apps actually ask for.
- 6d05f62: Fixed: The demo's port setting now moves every connection it opens, so a demo cannot take the ports of an installation running beside it.
- 6d05f62: Fixed: Stopping the demo now closes every connection it opened, instead of leaving some listening.
- 6d05f62: Fixed: Installing Clearotron no longer downloads an AI vendor toolkit that the product never uses.
- f7c1570: New: Releases are now signed. Each npm package carries a record of the exact source and build it came from, so an install can be verified against this repository.
- f7c1570: Fixed: Removing the demo is one folder again: nothing it writes lands outside the folder it names, and running it leaves the installed files untouched.
- 6d05f62: Fixed: Settings renamed in an earlier release are now reported at start-up and by `clearotron doctor`, so an upgrade cannot quietly ignore them.
- f7c1570: Fixed: Settings now live in `~/.config/clearotron/` and survive an upgrade — before, upgrading a global install threw them away, credentials included, while reporting success.
- 6d05f62: For operators: Updating an installation built from source now rebuilds the web interface, so it no longer serves the previous one after an update.
- 6d05f62: For operators: Stopping a backgrounded command now stops everything it started, instead of leaving the engine, client and portal connections listening.
- f7c1570: Fixed: The demo now offers only the two example accounts it ships with; three names that were only test material are gone.
- f7c1570: For operators: Server installs no longer stop accepting new clearances after 30 days. The internal key renews itself on every start, and `clearotron doctor` warns a week before it would lapse.

## 0.1.1-beta.1

### Patch Changes

- 6d05f62: A case-law sign-in that is present but no longer usable is now reported as such, instead of being counted as ready.
- 6d05f62: The third-party licence notices now list every package the product bundles.
- 6d05f62: The connection steps shown for Cowork and Perplexity now match what those apps actually ask for.
- 6d05f62: The demo's port setting now moves every connection it opens, so a demo cannot take the ports of an installation running beside it.
- 6d05f62: Stopping the demo now closes every connection it opened, instead of leaving some listening.
- 6d05f62: Installing Clearotron no longer downloads an AI vendor toolkit that the product never uses.
- 6d05f62: Settings renamed in an earlier release are now reported at start-up and by `clearotron doctor`, so an upgrade cannot quietly ignore them.
- 6d05f62: Updating an installation built from source now rebuilds the web interface, so it no longer serves the previous one after an update.
- 6d05f62: Stopping a backgrounded command now stops everything it started, instead of leaving the engine, client and portal connections listening.

## 0.1.1-beta.0

### Patch Changes

- f7c1570: Every release now carries a signed record of the commit and the build that produced it, so you can check that what you installed is what this repository holds.
- f7c1570: Removing the demo is one directory again: nothing it writes lands outside the folder it names, and running it no longer edits your copy of the repository.
- f7c1570: Your settings now live at `~/.config/clearotron/.env`, where an upgrade cannot delete them. An install set up before this keeps working and tells you once where to move the file. Before, upgrading a global install threw the settings away — credentials included — and every command still reported success.
- f7c1570: The demo offers the two example accounts it ships with. Three company names that were only ever test material are gone from the package.
- f7c1570: `clearotron doctor` now says how long the portal key has left and refuses when it has lapsed or is close to it. Before, a server stopped being able to start searches thirty days after setup, and reported it as a fault in the search engine.
