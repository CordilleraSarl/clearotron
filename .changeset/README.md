# Release notes live here

One file per user-visible change. `npx changeset` writes it for you, or you write it by hand: which
package changed, how big the change is, and one plain-English sentence about what a user can now do
that they could not before.

**Write it for someone who does not have this repository open.** A note naming a file, a function, or
describing the work as "refactor", "implement", "leverage", "optimise" or "utilise" is refused by the
release build — see `CONTRIBUTING.md` for what to write instead. The refusal names the line, so it is
quick to fix, and it is checked at release time so it holds regardless of who or what wrote the note.

These notes are consumed when a release is cut. A standing pull request — "Release: the next version,
and everything in it" — collects every pending note into the next version number and the changelog;
merging that pull request is the act of cutting the release, and the release workflow then tags it,
publishes it to npm with provenance, and writes the GitHub release page from the same words.

A pre-release goes out on its own channel and never becomes what `npm install clearotron` gives you:
`npx changeset pre enter beta` makes the next versions `x.y.z-beta.n`, which publish under the `beta`
tag, and `npx changeset pre exit` returns to stable. The build is the same either way — promotion is a
label, not a rebuild.
