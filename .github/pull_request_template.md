<!--
Never paste a run artifact, a pool path, a real mark, a real party name or a matter number into a
PR. They can carry client matter, and a PR is public and permanent. Reproduce against the repo's
synthetic fixtures instead.
-->

## What changed

<!-- The mechanism, not the file list. What does the code do now that it did not do before? -->

## Why this approach

<!-- The alternative you rejected, and the reason. This is the part reviewers read. -->

## What it does not do

<!-- The part of the problem this leaves open, if any. "Nothing" is a fine answer. -->

## How to verify

<!--
Write this as an instruction to someone else: the command to run, the file to look at, the field
that should have changed. Not "tests pass" — the command whose output proves it.
-->

```
```

## Checklist

- [ ] No run artifact, pool path, real mark, real party name, or matter number appears in this diff.
- [ ] `npm test` passes.
- [ ] Touched `portal-ui/src`? Ran `npm run build:ui` and committed `portal-ui/dist` (CI requires byte equality) and `npm run typecheck -w portal-ui` passes.
- [ ] Added an environment variable? Added its row to `docs/architecture/05-config-governance.md`.
- [ ] An empty result, a missing file, or a match that found nothing is reported as an absence, not as a pass.
- [ ] Release note added under `.changeset/`, written for a lawyer, passes `node scripts/release-notes-lint.mjs`.
