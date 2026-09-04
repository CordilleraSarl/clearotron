// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// suite-census.mjs —: counting a test file, once, so minting and checking cannot disagree.
//
// A GUARD CAN STOP GUARDING WITHOUT BEING DELETED. measured five ways this suite fails to notice:
// a file DELETED, a file RENAMED out of the collection glob, a file GUTTED (names stay, assertions
// leave), a SKIPPED arm, and a GATED arm that never ran. Collection is `test/*.test.mjs` — a glob sees
// what is there and can say nothing about what should have been.
//
// ── WHY THE COUNTER LIVES HERE AND NOT IN THE GUARD ────────────────────────────────────────────────
//
// The census is minted by this function and checked by this function. A second implementation for the
// minting side would drift, and the drift would read as a gutting — a census tool that manufactures its
// own findings is worse than no census.
//
// ── `.test(` IS NOT COUNTED, AND THAT IS THE WHOLE CALIBRATION ─────────────────────────────────────
//
// 's own thread records the miscount: 177 `RegExp.prototype.test` calls counted as subtests,
// genuine subtests ZERO. So this counts `assert.<something>` and a `test(` at the START of a line, and
// nothing else. Two independent checks that it is calibrated: on the tree it was minted from, the
// counted test sites match the EXECUTED totals at 415/415 for portal-ui, 382 against 386 for
// mcp-server, and 6022 against 6054 for driver — and the driver gap of 32 is exactly the
// loop-generated count e2e measured independently on that issue.
//
// ── THE DIRECTION THAT MAKES A COARSE COUNT SAFE ───────────────────────────────────────────────────
//
// 93% of assert sites are one-site-one-execution, so a static census UNDERSTATES HOW BAD A GUTTING IS
// AND NEVER WHETHER ONE HAPPENED. A check that under-reports severity but never misses occurrence is
// usable; the reverse is not. Nobody should later "fix" this into a tight count — a tight count would
// have to model loops, and a census that fails on a refactor gets deleted.

/** The workspaces `npm run test:full` actually collects, and the extension each collects. */
export const CENSUS_WORKSPACES = Object.freeze([
  Object.freeze({ ws: "driver", ext: "mjs" }),
  Object.freeze({ ws: "mcp-server", ext: "mjs" }),
  Object.freeze({ ws: "portal-ui", ext: "ts" }),
]);

// ── — THE FOURTH POPULATION, AND WHY IT IS NOT A FOURTH WORKSPACE ROW ───────────────────────
//
// MEASURED (eggie/Jerry, 2026-08-24): `npm run test:providers` on the control tree ran 59 files / 624
// tests; on the cut tree, 47 files / 426 tests. **198 tests disappeared and the command exited 0.** No
// failure, no warning, no line saying a file was not picked up.
//
// The census above could not see it, and the reason is structural rather than an oversight: `providers`
// IS NOT AN NPM WORKSPACE. The root manifest lists `providers/oauth-mcp-bridge` and nothing else under
// that directory, and `collectionFromManifests` walks `root.workspaces`. The whole population is
// collected by ONE ROOT SCRIPT with a two-level glob, which no per-workspace `test/*.test.<ext>` shape
// can express. Forcing a fourth row would have meant widening the workspace walk, the `want`
// computation and the declared literal together — three edits to make one population look like
// something it is not.
//
// So the declared thing joins the declared list rather than deforming it: a ROOT SCRIPT, its globs
// written down, checked against what the root manifest actually runs. Same doctrine as the workspace
// rows above — the literal is the expectation, the manifest read is the measurement, the guard is that
// they match — so narrowing `test:providers`' glob still reds, exactly as narrowing a workspace's does.
//
// WHY A FLOOR FROM `git ls-files` CANNOT DO THIS, in the issue's own words: after the cut the withheld
// files are gone from `git ls-files` too, so both sides shrink together and agree. Only a record that
// SURVIVES the cut can tell a file deliberately withheld from one that quietly stopped being collected.
export const CENSUS_ROOT_SCRIPTS = Object.freeze([
  Object.freeze({
    script: "test:providers",
    globs: Object.freeze(["providers/_shared/test/*.test.mjs", "providers/*/test/*.test.mjs"]),
  }),
]);

/**
 * Does a declared root script still collect what the census says it does?
 *
 * The same both-directions question `censusDisagreements` asks of workspaces, over a script in the ROOT
 * manifest. A script that lost a glob is the shape that reads as fine: the runner collects less and
 * exits 0.
 *
 * PURE: `readManifest` is injected, so the canary drives every branch over a planted manifest.
 */
export function rootScriptDisagreements(readManifest, declared = CENSUS_ROOT_SCRIPTS) {
  const root = readManifest("package.json");
  if (!root) return ["the root package.json could not be read, so what the root scripts collect is unknown"];
  const scripts = root.scripts ?? {};
  const out = [];
  for (const { script, globs } of declared) {
    const line = scripts[script];
    if (typeof line !== "string" || !line.trim()) {
      out.push(`the census claims the root script \`${script}\`, and the root manifest has no such script`);
      continue;
    }
    for (const g of globs) {
      if (!line.includes(g)) {
        out.push(`\`${script}\` is censused as collecting ${g} and its command is: ${line.trim()}`);
      }
    }
  }
  return out;
}

// ── ITEM 1 — WHAT THE RUNNER COLLECTS, READ FROM THE MANIFESTS RATHER THAN DECLARED ──────────
//
// THE DEFECT THIS CLOSES, measured twice on this repo and re-proved at 93556eec. Narrow the driver
// workspace's own collection glob — `test/*.test.mjs` becomes `test/s*.test.mjs`, a one-line edit
// nobody would notice in review — and:
//
//     mint-suite-census --check    exit 0
//     suite-census.test.mjs        9 pass / 0 fail
//
// while 581 of 639 driver test files stop being collected. Both sides agreed because both sides
// enumerate through the list ABOVE, and nothing in this repository opened a package.json. The census
// was move-proof about the tests and blind to itself being pointed somewhere else, which is 's own
// doctrine line: an enumerated check is blind to the thing moving; a discovered check is blind to
// ITSELF moving.
//
// SO THE DECLARED LIST STAYS AND A DERIVED ONE JOINS IT. Making the list derived and deleting the
// literal is the elegant version and it is wrong: two derived sides have nothing to disagree about,
// which is how this got here. The literal above is the expectation; what follows is the measurement;
// the guard is that they match.
//
// PURE AND INJECTABLE. `readManifest` is passed in, so the canary drives every branch over planted
// manifests without touching the tree — the same rule the rest of this module follows.

/** `npm run <name>` inside a script, so an indirection resolves within its own manifest. */
const NPM_RUN = /^\s*npm\s+run\s+([A-Za-z0-9:_-]+)\s*$/;

/**
 * The glob(s) a test script hands to `node --test`, or null when the script does not run node --test.
 *
 * `&&` CHAINS ARE SPLIT, because portal-ui's script is `npm run typecheck && node … --test test/*.test.ts`
 * and reading the whole string would find the collection behind an unrelated command. Only the segment
 * that actually invokes `--test` is the collection.
 *
 * NULL IS NOT AN EMPTY COLLECTION. A script this cannot parse is a REFUSAL — the caller has to say so
 * rather than record zero files, because "collects nothing" and "I could not tell" are the two answers
 * this whole issue is about telling apart.
 */
export function globsFromScript(script, resolve = () => null, depth = 0) {
  const text = String(script ?? "").trim();
  if (!text || depth > 4) return null;
  for (const seg of text.split("&&")) {
    const s = seg.trim();
    const indirect = NPM_RUN.exec(s);
    if (indirect) {
      const next = globsFromScript(resolve(indirect[1]), resolve, depth + 1);
      if (next) return next;
      continue;
    }
    const at = s.split(/\s+/).indexOf("--test");
    if (at === -1) continue;
    const globs = s.split(/\s+/).slice(at + 1).filter((a) => !a.startsWith("-"));
    if (globs.length) return globs;
  }
  return null;
}

/**
 * What `npm run test:full` collects, per workspace, derived from the manifests alone.
 *
 * `--if-present` is why a workspace with no test script is absent rather than an error: that is exactly
 * what the root script does with it (`providers/oauth-mcp-bridge` carries no scripts at all today).
 *
 * @param {(rel: string) => object|null} readManifest  repo-relative path -> parsed package.json, or null
 * @returns {{ws: string, globs: string[]}[]|null}  null when the ROOT manifest cannot be read — an
 *          absence, never an empty collection.
 */
export function collectionFromManifests(readManifest) {
  const root = readManifest("package.json");
  if (!root || !Array.isArray(root.workspaces)) return null;
  const out = [];
  for (const ws of root.workspaces) {
    const pkg = readManifest(`${ws}/package.json`);
    const scripts = pkg?.scripts;
    if (!scripts) continue;                                   // --if-present skips it
    const globs = globsFromScript(scripts["test:full"] ?? scripts.test, (n) => scripts[n]);
    if (globs) out.push({ ws, globs });
  }
  return out;
}

/**
 * Does the declared census agree with what the runner collects? Returns the disagreements, in words.
 *
 * BOTH DIRECTIONS. A workspace the runner collects and the census does not is an unwatched suite; one
 * the census claims and the runner does not is a census reporting on files nothing runs. The second is
 * the shape the plant produces and the one that reads as fine.
 */
export function censusDisagreements(collected, declared = CENSUS_WORKSPACES) {
  if (!collected) return ["the root package.json could not be read, so what the runner collects is unknown"];
  const out = [];
  const byWs = new Map(collected.map((c) => [c.ws, c.globs]));
  for (const { ws, ext } of declared) {
    const globs = byWs.get(ws);
    if (!globs) { out.push(`the census claims ${ws}, and \`npm run test:full\` collects nothing there`); continue; }
    const want = `test/*.test.${ext}`;
    if (!globs.includes(want)) out.push(`${ws} is censused as ${want} and its runner collects ${globs.join(" ")}`);
  }
  for (const { ws } of collected) {
    if (!declared.some((d) => d.ws === ws)) out.push(`\`npm run test:full\` collects ${ws} and the census does not cover it`);
  }
  return out;
}

/**
 * The two LOSS shapes between a census on disk and one freshly built: a file GONE from the census, and
 * one that SHRANK inside it.
 *
 * ONE DEFINITION, because the printing side and the refusing side must not be able to disagree. The
 * minter printed `SHRANK` from a filter written at the print site and then wrote the file anyway; a
 * second filter for the refusal could drift from the first and refuse over a different set than it
 * named. This is the same property the census already claims for minting against checking.
 *
 * GROWTH IS NOT LOSS and is deliberately not reported here — adding a test is the routine case, and a
 * refusal the routine case trips is a refusal somebody removes.
 */
export function lossBetween(prevPerFile, nextPerFile) {
  const a = prevPerFile ?? {};
  const b = nextPerFile ?? {};
  return {
    gone: Object.keys(a).filter((k) => !(k in b)).sort(),
    shrunk: Object.keys(b)
      .filter((k) => k in a && (b[k].tests < a[k].tests || b[k].asserts < a[k].asserts))
      .sort(),
    // item 3 — A NEW SKIP IS A LOSS, NOT GROWTH, and this is the direction that matters. A skip is
    // visible and never blocking: the runner prints `# skipped n` and exits 0, so an arm that stopped
    // running looks exactly like one that passed. Counting it beside tests and asserts would file it
    // under "grew" and say nothing. Here it lands with REMOVED and SHRANK, where it needs the same
    // `--apply --allow-loss` and the same sentence in the PR body saying what stopped running and why.
    //
    // Absent fields read as 0 so a census written before this field existed does not report every file
    // as having gained skips the moment it lands.
    // ABSENT IS NOT ZERO. A census written before this field existed carries no `skips` at all, and
    // reading that as a measured zero makes every file with a pre-existing skip look like it just gained
    // one — the first `--apply` after this lands then refuses the whole tree and the operator learns to
    // pass --allow-loss reflexively, which is the refusal being trained away. No baseline, no gain.
    skipped: Object.keys(b)
      .filter((k) => k in a && a[k].skips !== undefined
        && (b[k].skips > a[k].skips || (b[k].todos ?? 0) > (a[k].todos ?? 0)))
      .sort(),
  };
}

/**
 * Test sites and assert sites in one test file's source.
 *
 * Comment lines are dropped first: these files argue about `assert` and `test(` at length in prose, and
 * counting a comment would make a gutted file look intact — the inversion this repo keeps paying for.
 */
/**
 * Lines declaring a SKIP, by either shape this corpus uses. item 3.
 *
 * WHY THE CENSUS CARRIES IT. A skip is visible and never blocking: the runner exits 0 and prints
 * `# skipped n`, so an arm that stopped running looks exactly like an arm that passed. Pinning the count
 * per file makes a NEW skip a number somebody has to re-stamp — which is the breadth control the
 * declaration tables were missing, applied at the file level rather than as a second mechanism.
 *
 * TWO SHAPES, MEASURED IN THE TREE RATHER THAN GUESSED (2026-08-24): `t.skip(reason)` inside a body,
 * 14 files; and the `{ skip: <expr> }` option, 25 files. No `todo` anywhere, so `todo` is counted for
 * the day someone adds the first one and not because any exists.
 *
 * IT COUNTS SITES, NOT SKIPS THAT FIRED. Most of these are conditional — `process.getuid?.() === 0 &&
 * "root writes through a 0o500 directory"` — so the number is what the file DECLARES, which is the thing
 * a diff can be read against. A count of what fired would move with the machine and pin nothing.
 *
 * It is deliberately as blunt as its siblings: comment lines are dropped, string literals are not, so a
 * test whose assertion quotes `t.skip(` counts one. That over-counts by a fixed amount and stays stable,
 * which is what a change detector needs; precision here would cost a parser and buy nothing.
 */
export function skipSiteLines(text) {
  const out = [];
  String(text ?? "").split("\n").forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
    for (const _ of l.matchAll(/\b[a-zA-Z_$][\w$]*\s*\.\s*skip\s*\(|(?:^|[,{(\s])skip\s*:/g)) out.push(i + 1);
  });
  return out;
}

/** Lines declaring a TODO. Same shapes, same bluntness. */
export function todoSiteLines(text) {
  const out = [];
  String(text ?? "").split("\n").forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
    for (const _ of l.matchAll(/\b[a-zA-Z_$][\w$]*\s*\.\s*todo\s*\(|(?:^|[,{(\s])todo\s*:/g)) out.push(i + 1);
  });
  return out;
}

export function countTestSites(text) {
  const lines = String(text ?? "").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  let tests = 0;
  for (const l of lines) if (/^\s*(?:await\s+)?test\s*\(/.test(l)) tests++;
  return { tests, asserts: assertSiteLines(text).length,
           skips: skipSiteLines(text).length, todos: todoSiteLines(text).length };
}

/**
 * The 1-based LINE of every assert site, in source order. One site per `assert.<x>` occurrence, so a
 * line carrying two of them appears twice — the same arithmetic `countTestSites` reports.
 *
 * 's fifth member needs the LINES, not just the total: a GATED arm — `if (!process.env.X) return;`
 * at the top of a test body — leaves every token in place, so a count cannot see it and only "did this
 * line ever run" can. That question is answered by a coverage pass, and the two sides must ask it of the
 * SAME sites, so the rule lives here once rather than being re-typed against the same file.
 *
 * COMMENT LINES ARE DROPPED FIRST, exactly as above and for the same reason: these files argue about
 * `assert` in prose at length, and counting a comment makes a gutted file look intact.
 */
export function assertSiteLines(text) {
  const out = [];
  String(text ?? "").split("\n").forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
    for (const _ of l.matchAll(/\bassert\s*\.\s*[a-zA-Z]/g)) out.push(i + 1);
  });
  return out;
}
