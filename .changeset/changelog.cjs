// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The changelog lines `changeset version` writes: the note, and nothing in front of it.
//
// The stock generator prefixes every line with the commit it came from — "- 2138a3c: Fixed: …". A reader
// of a changelog has no use for a hash, the release-note guide says so in its own words, and the root
// CHANGELOG was already stripping it when it assembled itself. The workspace changelogs, one of which
// ships in the package, carried the hashes anyway. This is the stock generator with the commit left out;
// everything else — the note's own line breaks, the dependency list — is as the stock one writes it.
const changelogFunctions = {
  getReleaseLine: async (changeset) => {
    const [first, ...rest] = changeset.summary.split("\n").map((l) => l.trimEnd());
    return rest.length ? `- ${first}\n${rest.map((l) => `  ${l}`).join("\n")}` : `- ${first}`;
  },
  getDependencyReleaseLine: async (changesets, dependenciesUpdated) => {
    if (dependenciesUpdated.length === 0) return "";
    return ["- Updated dependencies", ...dependenciesUpdated.map((d) => `  - ${d.name}@${d.newVersion}`)].join("\n");
  },
};
module.exports = changelogFunctions;
