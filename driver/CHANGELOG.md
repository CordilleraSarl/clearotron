# prelim-driver

## 0.1.1-beta.0

### Patch Changes

- f7c1570: Every release now carries a signed record of the commit and the build that produced it, so you can check that what you installed is what this repository holds.
- f7c1570: Removing the demo is one directory again: nothing it writes lands outside the folder it names, and running it no longer edits your copy of the repository.
- f7c1570: Your settings now live at `~/.config/clearotron/.env`, where an upgrade cannot delete them. An install set up before this keeps working and tells you once where to move the file. Before, upgrading a global install threw the settings away — credentials included — and every command still reported success.
- f7c1570: The demo offers the two example accounts it ships with. Three company names that were only ever test material are gone from the package.
- f7c1570: `clearotron doctor` now says how long the portal key has left and refuses when it has lapsed or is close to it. Before, a server stopped being able to start searches thirty days after setup, and reported it as a fault in the search engine.
