# Changelog

What changed in each release of Clearotron, in plain English.

Install or upgrade with `npm install -g clearotron`.

## 0.1.4

### Fixed

- A report now says a case-law source could not be confirmed, rather than saying this installation does not have it.
- Connecting an assistant now says what went wrong when it stops part-way, and what it had already changed.
- Checking a settings file now reports on the file you named, not the one this machine happens to use.
- The portal now runs on the current React, TypeScript and Vite, and its download is smaller because build comments no longer ship to the browser.
- The case-law sign-in instructions now produce a credential that survives its first renewal, and verify that it does.

### For operators

- The live-surface check no longer calls a healthy installation broken over a service file the product never shipped.
- The end-to-end harness now recognises the worker draining queues here, instead of offering to start a second one.

## 0.1.3

### For operators

- The engine's HTTP client moves to its current major version, which needs Node 22.19 or newer. Installs on an older Node 22 must upgrade Node first.

## 0.1.2

### New

- A finished report can now be asked what changes under a stated assumption, answered by a short memo over the evidence already gathered. Nothing is searched again and the report is not altered.

### Fixed

- A clearance no longer fails part-way because a section heading was worded differently. The report is accepted on what it contains.
- A zone with too many results to work through is now recorded, not left blank where it could read as searched and clean.
- A clearance stopped by a provider's usage limit now waits for that limit to reset, instead of giving up and reporting a failed run.
- A what-if about a finished report is answered under the same risk framework as the original run, or declines rather than switching.
- Reports can no longer say a territory was searched when it was not. The wording is corrected before the report reaches the client.

## 0.1.1

### New

- Releases are now signed. Each npm package carries a record of the exact source and build it came from, so an install can be verified against this repository.

### Fixed

- The instructions for running from a clone no longer show a short command form that only a global install provides.
- A case-law sign-in that is present but no longer usable is now reported as such, instead of being counted as ready.
- The package now includes its third-party licence notices, and they list every package it bundles.
- The connection steps shown for Cowork and Perplexity now match what those apps actually ask for.
- The demo's port setting now moves every connection it opens, so a demo cannot take the ports of an installation running beside it.
- Stopping the demo now closes every connection it opened, instead of leaving some listening.
- Installing Clearotron no longer downloads an AI vendor toolkit that the product never uses.
- Removing the demo is one folder again: nothing it writes lands outside the folder it names, and running it leaves the installed files untouched.
- Settings renamed in an earlier release are now reported at start-up and by `clearotron doctor`, so an upgrade cannot quietly ignore them.
- Settings now live in `~/.config/clearotron/` and survive an upgrade — before, upgrading a global install threw them away, credentials included, while reporting success.
- The demo now offers only the two example accounts it ships with; three names that were only test material are gone.
- An assistant connected to Clearotron no longer asks permission before reading; it still asks before starting or stopping a search.
- The demo now says plainly when a search type has no sample run, and lists the ones it has. Nothing is started and nothing is charged.

### For operators

- Updating an installation built from source now rebuilds the web interface, so it no longer serves the previous one after an update.
- Stopping a backgrounded command now stops everything it started, instead of leaving the engine, client and portal connections listening.
- Server installs no longer stop accepting new clearances after 30 days. The internal key renews itself on every start, and `clearotron doctor` warns a week before it would lapse.
- The portal now reports its screens as out of date when they are older than the sources they were built from, instead of ready.

## 0.1.1-beta.1

### Fixed

- A case-law sign-in that is present but no longer usable is now reported as such, instead of being counted as ready.
- The package now includes its third-party licence notices, and they list every package it bundles.
- The connection steps shown for Cowork and Perplexity now match what those apps actually ask for.
- The demo's port setting now moves every connection it opens, so a demo cannot take the ports of an installation running beside it.
- Stopping the demo now closes every connection it opened, instead of leaving some listening.
- Installing Clearotron no longer downloads an AI vendor toolkit that the product never uses.
- Settings renamed in an earlier release are now reported at start-up and by `clearotron doctor`, so an upgrade cannot quietly ignore them.
- An assistant connected to Clearotron no longer asks permission before reading; it still asks before starting or stopping a search.

### For operators

- Updating an installation built from source now rebuilds the web interface, so it no longer serves the previous one after an update.
- Stopping a backgrounded command now stops everything it started, instead of leaving the engine, client and portal connections listening.

## 0.1.1-beta.0

### New

- Releases are now signed. Each npm package carries a record of the exact source and build it came from, so an install can be verified against this repository.

### Fixed

- Removing the demo is one folder again: nothing it writes lands outside the folder it names, and running it leaves the installed files untouched.
- Settings now live in `~/.config/clearotron/` and survive an upgrade — before, upgrading a global install threw them away, credentials included, while reporting success.
- The demo now offers only the two example accounts it ships with; three names that were only test material are gone.
- The demo now says plainly when a search type has no sample run, and lists the ones it has. Nothing is started and nothing is charged.

### For operators

- The portal now reports its screens as out of date when they are older than the sources they were built from, instead of ready.
- Server installs no longer stop accepting new clearances after 30 days. The internal key renews itself on every start, and `clearotron doctor` warns a week before it would lapse.
