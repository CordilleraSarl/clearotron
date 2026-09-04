// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The licence-header guard, checked the only way a guard is worth anything: by planting the fault it
// exists to catch and watching it fail.
//
// asks for exactly this — "the header test fails on a planted headerless file, then passes once
// fixed" — and the reason is that this guard has no other witness. The header is a comment. It changes
// no behaviour, satisfies no type, and breaks no test if it goes missing, so a `--check` that silently
// stopped enumerating files would read as a permanent pass. The tests below therefore never assert
// "the check returned OK"; they assert it returns NOT-OK on a specific fault, which is the only
// direction that can distinguish a working check from one that has stopped looking.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { SPDX, COPYRIGHT, TERMS_TEXT, withHeader, hasHeader, isExcluded, authoredFiles }
  from "../../scripts/spdx-headers.mjs";

// A throwaway git repository, because authoredFiles() reads `git ls-files` on purpose: an untracked
// file is not shipped, and a guard that walked the filesystem would report on scratch nobody publishes.
function repo() {
  const root = mkdtempSync(join(tmpdir(), "spdx-"));
  execFileSync("git", ["init", "-b", "main", root]);
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "spdx test"], { cwd: root });
  const add = (path, body) => {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
    execFileSync("git", ["add", path], { cwd: root });
    return full;
  };
  return { root, add, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("#854 a planted headerless source file is CAUGHT", () => {
  const r = repo();
  try {
    r.add("src/headed.mjs", `${SPDX}\n${COPYRIGHT}\nexport const a = 1;\n`);
    r.add("src/bare.mjs", "export const b = 2;\n");
    const files = authoredFiles(r.root);
    assert.ok(files.includes("src/bare.mjs"), "the guard must see the file at all before it can judge it");
    const missing = files.filter((f) => !hasHeader(
      execFileSync("cat", [join(r.root, f)], { encoding: "utf8" })));
    assert.deepEqual(missing, ["src/bare.mjs"],
      "exactly the headerless file, and NOT the headed one — a check that flags everything is as "
      + "useless as one that flags nothing");
  } finally { r.cleanup(); }
});

test("#854 …and passes once the header is added — the same file, the same check", () => {
  const r = repo();
  try {
    const p = r.add("src/bare.mjs", "export const b = 2;\n");
    writeFileSync(p, withHeader("export const b = 2;\n"));
    assert.ok(hasHeader(execFileSync("cat", [p], { encoding: "utf8" })));
  } finally { r.cleanup(); }
});

test("#854 the header goes AFTER a shebang, never above it", () => {
  // A comment above `#!/usr/bin/env node` stops the kernel finding the interpreter. 70 files in this
  // repository start with one, so getting this backwards would break every executable script at once
  // — and it would break them at RUN time, not at test time.
  const out = withHeader("#!/usr/bin/env node\nconsole.log(1);\n");
  const lines = out.split("\n");
  assert.equal(lines[0], "#!/usr/bin/env node", "the shebang stays on line 1");
  assert.equal(lines[1], SPDX);
  // The second line is the copyright line CARRYING the additional-terms notice.
  // Asserted as prefix-plus-content rather than as one literal, so this arm keeps testing the thing it
  // was written for — where the header sits relative to the shebang — instead of becoming a second copy
  // of the header string that has to be edited whenever the notice wording is touched.
  assert.ok(lines[2].startsWith(COPYRIGHT), "the copyright line follows the SPDX line");
  assert.ok(lines[2].includes(TERMS_TEXT), "and it carries the additional-terms notice");
});

test("#854 it is idempotent — running the sweep twice does not stack headers", () => {
  const once = withHeader("export const a = 1;\n");
  assert.equal(withHeader(once), null, "already headed ⇒ no second write");
  assert.equal((once.match(/SPDX-License-Identifier/g) ?? []).length, 1);
});

test("#854 the header is recognised by its SPDX line alone, so the copyright YEAR can move", () => {
  // Deliberate: the licence does not require the copyright line to be any particular text, and a check
  // keyed on "2026" starts failing every January over a line nobody needs to have changed.
  assert.ok(hasHeader(`${SPDX}\n// Copyright 2031 Cordillera Sàrl\nexport const a = 1;\n`));
});

test("#854 the generated bundle is excluded, and the exclusion is NARROW", () => {
  // portal-ui/dist is committed on purpose but nobody wrote it, and vite rewrites it wholesale on every
  // build — any header added there is gone at the next `npm run build`.
  assert.ok(isExcluded("portal-ui/dist/assets/index-P_3D0Lp1.js"));
  // The exclusion must not reach real source that happens to sit near it. This is the assertion that
  // stops the prefix being widened to "portal-ui/" the next time somebody is in a hurry.
  assert.ok(!isExcluded("portal-ui/src/main.ts"));
  assert.ok(!isExcluded("portal-ui/vite.config.ts"));
});

// 'S GENERATED-FILE ARM WENT WITH brand-art.ts. It asserted that `brandArtTs` emitted
// its own licence header, because a header pasted in by the sweep would vanish at the next
// regeneration and `tokens:check` would then call the file stale. There is no generated TypeScript
// module in the tree now — tokens.css is generated too but carries no SPDX header, being CSS the
// sweep does not claim. Restore this arm the day something regenerates a tracked source file again.


test("#854 the guard sees the whole tree, not one directory", () => {
  // 's lesson, one seam along: a repo-wide walk found four tracked units living outside
  // driver/systemd/, and any conclusion drawn from listing one directory was wrong by construction.
  // The same trap applies here — the authored source is spread across driver, providers, portal-ui,
  // mcp-server, scripts, shared, bin and docs.
  const roots = new Set(authoredFiles(process.cwd().replace(/\/driver$/, "")).map((f) => f.split("/")[0]));
  for (const expected of ["driver", "providers", "portal-ui", "mcp-server", "scripts", "shared", "bin"]) {
    assert.ok(roots.has(expected), `${expected}/ has authored source and the guard must cover it`);
  }
});
