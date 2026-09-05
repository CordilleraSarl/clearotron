# Changelog

What changed in each release of Clearotron, in plain English.

Install or upgrade with `npm install -g clearotron`.

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
