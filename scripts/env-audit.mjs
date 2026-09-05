#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// env-audit.mjs —: every environment variable this repo reads, and whether anyone wrote it down.
//
//   node scripts/env-audit.mjs             the report — BOTH directions
//   node scripts/env-audit.mjs --json      the same, machine-readable
//   node scripts/env-audit.mjs --list      just the undocumented PRODUCT names, one per line
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────
//
// `docs/architecture/05-config-governance.md` states its own maintenance rule: "adding a var anywhere
// in the repo means adding its row here". 's review found that rule has NO enforcement — the
// placeholder-default guard checks fallbacks, not existence — so it has been prose since it was
// written, and the surface has grown the whole time.
//
// A rule with no mechanism is not a weak rule, it is a rule that has stopped existing. This is the
// mechanism half: it enumerates, it classifies, and `driver/test/env-governance.test.mjs` ratchets on
// its output.
//
// ── THE CLASSIFICATION IS THE WHOLE VALUE ────────────────────────────────────────────────────────
//
// A flat count is what made this look unfixable. The tree reads 353 distinct names and 197 are absent
// from both governance documents — a number nobody can act on, because most of them are MOCK_* and
// harness switches that have no business in an operator's configuration register.
//
// So each name is classified by WHERE IT IS READ:
//
//   product    read by at least one file that ships and runs in production. These need a governance
//              row, and these are what the ratchet counts.
//   harness    read ONLY by test files, mock binaries, and the e2e/dev scripts. A governance row for
//              MOCK_CLAUDE_COST would be noise in the register an operator reads.
//
// A name read in BOTH is `product` — the stricter answer, because the operator-facing read is the one
// that matters and a test read does not excuse it.
//
// ── what it deliberately does not do ─────────────────────────────────────────────────────────────
//
// It deletes nothing. 's tier 2 (delete the dead) is explicitly not this, and the issue's own
// queue note says deleting toggles mid-verification moves the range again. This reports; a person
// decides.

import { readFileSync, existsSync, writeSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles } from "../shared/tracked-files.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");
const asList = process.argv.includes("--list");

// `process.env.NAME`, `process.env["NAME"]`, AND THE SAME TWO THROUGH AN INJECTED `env` BINDING.
// Deliberately not clever: a computed read (`process.env[someVar]`) names nothing at author time and
// cannot be governed by a document, so it is out of scope for a register of names rather than silently
// half-matched.
//
// ──: A PURE FUNCTION'S ENV READS ARE STILL ENV READS ───────────────────────────────────────
//
// `resolveAuthMode({env = process.env})` reads `env.CODEX_API_KEY`. Textually there is no
// `process.env.` before the name, so the `process.env`-only scanner recorded nothing — and this is not
// an oddity, it is the refactor this repository keeps choosing (`laneArmed(lane, env)`,
// `deriveJxSliceStatement({env})`). Every such conversion silently removed its variables from
// governance: the guard went QUIET rather than red, which is the failure class ADR-0002 exists to end.
// Seven product names were invisible, two of them deciding billing.
//
// THREE THINGS THIS PATTERN HAS TO GET RIGHT, each of which cost a measurement:
//
//   1. `(?<![.\w$])` — an `env` reached THROUGH something else is a different object. `cfg.env.FOO` and
//      `myenv.FOO` are not reads of the process environment, and without the lookbehind the second
//      alternative also re-matches the tail of `process.env.FOO` and double-counts it.
//   2. `(?![A-Z0-9_])` — WITHOUT THIS THE NAME SILENTLY TRUNCATES. `[A-Z][A-Z0-9_]*` backtracks to let
//      the assignment lookahead below succeed, so `env.CODEX_HOME =` was recorded as `CODEX_HOM`. The
//      audit stayed green and the register grew a name that does not exist. Nothing else in the suite
//      could catch that, so there is an arm for it.
//   3. `(?!\s*=[^=])` — AN ASSIGNMENT IS NOT A READ. Building a child environment is the common use of
//      a bare `env` object: `env.CODEX_HOME = codexHome` in driver/engine/openai-agent.mjs is the
//      driver SETTING a variable for a subprocess. Counting it makes `CODEX_HOME` a product name, and
//      the catalogue ratchet then demands an operator row for a value the driver overwrites — a row
//      teaching the operator to configure something they must not touch. `==`/`===` are excluded from
//      the exclusion, because a comparison is a read.
const READ_RE = /(?<![.\w$])(?:process\.)?env\.([A-Z][A-Z0-9_]*)(?![A-Z0-9_])(?!\s*=[^=])|(?<![.\w$])(?:process\.)?env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\](?!\s*=[^=])/g;
const CODE_RE = /\.(mjs|js|cjs|ts)$/;

// ── AN ACCESSOR CALL IS A READ, AND STEP 4 MADE IT THE COMMON ONE ────────────────────────────────
//
// filed the accessor family as a known gap in READ_RE. step 4 is
// what made closing it load-bearing rather than tidy: every read converted to the name in force goes
// through `envFrom(process.env, "NAME")`, because a bare `process.env.CLEAROTRON_*` resolves nothing an
// operator set under the retired spelling in a process that never ran the alias pass. READ_RE cannot
// see that shape at all — the name is a STRING ARGUMENT and never sits beside an `env` token.
//
// MEASURED ON THIS CHANGE, not assumed. An undocumented name read as
// `process.env.CLEAROTRON_KIFF_PROBE` reported "1 PRODUCT name(s) absent from both governance
// documents". The SAME read written `envFrom(process.env, "CLEAROTRON_KIFF_PROBE")` reported ZERO, and
// the product-read count fell 203 → 202. Converting a surface was quietly narrowing the guard whose job
// is to notice a surface converting — no red, no warning, one fewer name governed.
//
// PRECISION SURVIVES, which is what this direction needs (over-detecting invents a row somebody
// deletes): the name is an explicit string literal in every form matched here, so nothing is inferred
// from a variable. `pinEnv`/`pinEnvAll` are deliberately absent — they WRITE. `spellingsOf` and
// `currentName` are absent for the same reason as an assignment: naming a variable is not reading it.
//
// AND THIS DOES NOT TOUCH THE OTHER DIRECTION. The has-row-no-reader arm reads the bare NAME anywhere
// in the tracked tree precisely so it never has to know HOW a name is read — the note below says so,
// and this widening is the case it was written for.
// ADDED THE FIFTH AND SIXTH SPELLINGS, and this is exactly the case the paragraph
// above describes happening again. Converting the eight numeric getters from
// `Number(this.envValue("NAME") || d)` to `numericSetting("NAME")` moved the name out of a shape this
// scanner knew and into one it did not: the audit stopped seeing CLEAROTRON_MAX_CLAIM_AGE_MS and
// CLEAROTRON_CARD_CONCURRENCY, whose ONLY reads are accessor reads, and 's product-read arm went red.
// It went red because that arm names those two variables — which is the whole reason it names them. A
// conversion narrows this guard silently, so both spellings land in the same commit as the conversion.
const ACCESSOR_RE = /\b(?:envValue|envOn|envGateOn|numericSetting|resolveNumericSetting)\s*\(\s*["']([A-Z][A-Z0-9_]*)["']|\benvFrom\s*\(\s*[^,()]+,\s*["']([A-Z][A-Z0-9_]*)["']/g;

// ── A COMMENT THAT EXPLAINS THE CONVENTION IS NOT A READ ─────────────────────────────────────────
//
//. This scanner matched its OWN comment. `scripts/env-audit.mjs` explains itself with the words
// `process.env.NAME`, and `driver/driver.config.mjs` states the house gate spelling as
// `process.env.X !== "0"` — so the backlog carried two variables called NAME and X that no deployment
// has ever set and no code has ever read.
//
// That is worse than two wasted rows. The ratchet fails on any NEW undocumented product name, so
// writing a comment of the form `process.env.FOO` turns CI red for a variable that does not exist,
// and the fix a hurried agent reaches for is deleting the comment or the test. A guard that punishes
// documentation is a guard that gets removed.
//
// DELIBERATELY CONSERVATIVE: only a line whose FIRST non-whitespace is a comment opener is dropped.
// A trailing comment on a line of code still counts, which over-reports. That is the safe direction
// and it is this file's stated preference — over-reporting invents a row somebody deletes, while
// under-reporting hides a real gap and reads as a pass.
const COMMENT_LINE_RE = /^\s*(\/\/|\/\*|\*)/;
const stripCommentLines = (text) => text.split("\n").filter((l) => !COMMENT_LINE_RE.test(l)).join("\n");

/**
 * Every environment name one source file reads, comment lines dropped.
 *
 * EXPORTED AND PURE because READ_RE's three guards are each unfalsifiable against the real tree: a
 * truncated name, a counted assignment and a counted `cfg.env` all leave a GREEN audit with a wrong
 * register in it. `CODEX_HOM` shipped that way in this change's own drafting. The states have to be
 * constructed, so the scanner is reachable without one.
 *
 * SYSTEM_OWNED is deliberately NOT applied here — that exclusion is auditEnv's, and it has its own arm.
 */
// ── A NAME HELD IN A STRING CONSTANT ─────────────────────────────────────────
//
// `const API_KEY_ENV = "USPTO_API_KEY"` … `process.env[API_KEY_ENV]`. BOTH halves are string literals
// at the author's keyboard — the identifier is written out and so is the variable name — so this is
// not the computed read the audit deliberately excludes. Nothing here is inferred from a runtime value.
//
// It has to be a CORPUS pre-pass rather than a per-file one, because the binding and the read are
// routinely in different files: `USPTO_API_KEY` is bound in `providers/uspto-local/src/sync.js` and
// read in `bin/uspto-sync.mjs`. That is also why it stayed invisible after the injected-`env` widening
// — no `env`-prefixed regex can match a read where the name never appears beside an `env` token.
//
// THE BINDING IS SCREAMING_CASE AND THE LITERAL IS ENV-SHAPED, both required. `const label = "x"` is
// not an env binding, and neither is `const PREFIX = "prelim-"`. The pair is what makes this a
// declaration of an environment name rather than a string that happens to be uppercase.
const BINDING_RE = /(?<![.\w$])const\s+([A-Z][A-Z0-9_]*)\s*=\s*["']([A-Z][A-Z0-9_]{2,})["']/g;

/** `const IDENT = "ENV_NAME"` bindings in one file. PURE, and exported so the collision arm can plant. */
export function envNameBindings(text) {
  const out = new Map();
  const stripped = stripCommentLines(text);
  BINDING_RE.lastIndex = 0;
  for (let m; (m = BINDING_RE.exec(stripped));) {
    // A file binding one identifier twice is already ambiguous without leaving the file.
    if (out.has(m[1]) && out.get(m[1]) !== m[2]) out.set(m[1], null);
    else if (!out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

/**
 * Merge per-file bindings into the corpus map. A COLLIDING IDENTIFIER RESOLVES TO NOTHING.
 *
 * Measured on the tree when this was designed: 28 distinct bound identifiers, 0 collisions, and 0
 * collisions among the 11 actually used in a computed read. **Zero collisions today is not a property
 * to depend on** — `NAME` is bound in test files and is exactly the identifier that collides first. So
 * a collision must resolve to nothing rather than to a guess: attributing one file's variable to
 * another file's read is a wrong row in a governance register, which is worse than a missing one
 * because it reads as knowledge.
 */
export function mergeEnvNameBindings(perFile) {
  const merged = new Map();
  for (const one of perFile) {
    for (const [ident, name] of one) {
      if (!merged.has(ident)) merged.set(ident, name);
      else if (merged.get(ident) !== name) merged.set(ident, null);   // collision ⇒ resolves to nothing
    }
  }
  return merged;
}

// The computed read whose subscript is a BARE IDENTIFIER. `env["X"]` is READ_RE's; this is the one that
// needs the map. Same assignment guard as its siblings — `env[X] = v` is a write.
const CONST_READ_RE = /(?<![.\w$])(?:process\.)?env\[\s*([A-Z][A-Z0-9_]*)\s*\](?!\s*=[^=])/g;

export function namesRead(text, bindings = null) {
  const found = new Set();
  const stripped = stripCommentLines(text);
  READ_RE.lastIndex = 0;
  for (let m; (m = READ_RE.exec(stripped));) found.add(m[1] || m[2]);
  ACCESSOR_RE.lastIndex = 0;
  for (let m; (m = ACCESSOR_RE.exec(stripped));) found.add(m[1] || m[2]);
  // Resolved through the corpus map when one is supplied. Absent map ⇒ this half is simply off, which
  // is what keeps the function pure and drivable on a single string.
  if (bindings) {
    CONST_READ_RE.lastIndex = 0;
    for (let m; (m = CONST_READ_RE.exec(stripped));) {
      const name = bindings.get(m[1]);
      if (name) found.add(name);          // null (collision) and undefined (unbound) both resolve to nothing
    }
  }
  return found;
}

// ── NAMES THIS REPO DOES NOT OWN ────────────────────────────────────────────────────────────────
//
// Set by the OS, the login shell or the CI runner — never by a deployment of this product. A
// governance row for `USER` would document something nobody here configures, and freezing one into a
// backlog means someone eventually writes that row. They are excluded from the audit entirely rather
// than counted as documented, because "documented" would be a false claim about a document.
//
// This is a CLOSED list on purpose: a name that is genuinely ours must not be able to disappear from
// the audit by resembling a system name.
export const SYSTEM_OWNED = new Set([
  "USER", "HOME", "PATH", "PWD", "SHELL", "LANG", "LC_ALL", "TERM", "TMPDIR", "TZ",
  "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "NODE_ENV", "NODE_OPTIONS", "CI", "PORT",
  // — both arrived with the injected-`env` widening above, and both are set by the service
  // manager rather than by any deployment of this product: systemd sets INVOCATION_ID (which is
  // exactly what shared/env-local.mjs reads it to detect), and the session bus sets
  // DBUS_SESSION_BUS_ADDRESS. 's body asserts the audit already excluded these two. It did not —
  // they were absent from this list, and they only stayed out of the register because the scanner
  // could not see the reads at all.
  "INVOCATION_ID", "DBUS_SESSION_BUS_ADDRESS",
  // — the two colour conventions, arriving with shared/tty-style.mjs. They are
  // set by the READER's environment or by a CI runner, never by a deployment of this product: nobody
  // configures a Clearotron install by choosing its NO_COLOR. A governance row for either would document
  // a decision this product does not make, and an .env.example row would put a name in the catalogue a
  // new user must read past — the opposite of what is for.
  //
  // They belong here rather than being documented for the same reason TERM does, and the test that
  // pushed back is right to have made this an explicit decision rather than an omission: they ARE read
  // by product code, and the only honest answers were a row or this list.
  "NO_COLOR", "FORCE_COLOR",
]);

/** A file that ships and runs in production, as opposed to one that only ever runs a test. */
export function isProductFile(rel) {
  if (/(^|\/)test\//.test(rel)) return false;
  if (/(^|\/)(mock|fixtures?)[-/]/.test(rel)) return false;
  if (/\.test\.mjs$/.test(rel)) return false;
  if (/^e2e\//.test(rel)) return false;
  if (/^scripts\/(e2e|test-run|ci-)/.test(rel)) return false;
  return true;
}

/**
 * The audit, or NULL when this tree is not a git checkout.
 *
 * The corpus is what git tracks — a walk would sweep build output and a contributor's scratch files
 * into a register an operator is supposed to read. Off a checkout there is nothing honest to
 * enumerate, so this returns null, shared/tracked-files.mjs says so by name in the log, and the
 * callers decide: the ratchet in driver/test/env-governance.test.mjs skips, and the CLI below
 * refuses. Neither reports an empty audit as a clean one.
 */
/**
 * -10 — is this name catalogued in `.env.example`, given the assignment rows it carries?
 *
 * EXPORTED AND PURE because the case that matters is unreachable on this tree. The rule below differs
 * from the looser `assigned.has(n) || assigned.has(n)` in exactly one state — the old
 * spelling has a row and the current one does not — and today every current spelling has a row, so on
 * the real file the two rules agree everywhere. An arm driving the real audit therefore passes under
 * both, which is a guard that certifies nothing. Measured: two plants against the looser rule, both
 * green, before this was pulled out.
 *
 * @param {Set<string>} assigned  names with an assignment row (commented-out rows included)
 * @param {string} name           the name shipping code reads, which may be a compat-window alias
 */
export function isCatalogued(assigned, name) {
  return assigned.has(name);
}

/**
 * -12 — the closed set of effect classes, and what each one CLAIMS.
 *
 * WHY A CLOSED SET. An open-ended string satisfies "declares a class" with `# effect: yes`. The point
 * of the declaration is that a reader can sort names by what happens when one is changed, and a
 * vocabulary nobody can enumerate does not sort anything.
 *
 * WHY THESE MEMBERS. `silent-output-change` is RECOVERED, not invented — it is the string the four
 * deleted switches carried in `flag-snapshot.mjs` before -8 emptied that map, and it is the class
 * ADR-0002 was written about. The rest name the conditions that ADR calls honest: "a credential being
 * present, the product carrying the component, the territory having a lane", plus the two kinds of
 * name that do not touch the answer at all — where things live, and how hard a run tries.
 *
 * DECLARING `silent-output-change` PASSES. That is deliberate and it is the ADR's own text: "a name
 * that changes output either loses the switch OR DECLARES ITS CLASS". Two outcomes are lawful, and a
 * guard that failed on the declaration would delete the branch the ruling grants and enforce a rule
 * nobody wrote. The darkness ADR-0002 is named for is the UNDECLARED state; declaring is the cure, not
 * the offence. What the class buys a reader is that the name now appears, by name, in the one file
 * they already read — which is the whole of what "no dark functionality" asks for.
 *
 * THREE MEMBERS ARE FORWARD-DECLARED. `disclosed-gate`, `credential` and `harness` are carried by no
 * row today: all nine declarations -12 wrote are `silent-output-change`, and the other 96 names
 * are still a backlog. They are here because the backlog needs them to be classifiable at all — an
 * unused member is not evidence that nothing needs it.
 *
 * WHAT THIS GUARD DOES NOT CHECK: whether the declared class is TRUE. Nothing mechanical can compare a
 * string to what a code path does. CI enforces that a class is present and in this vocabulary; a
 * reader enforces that it is the right one. Do not read a green here as "the effect classes are
 * correct" — read it as "every name read by shipping code has answered the question".
 */
export const EFFECT_CLASSES = Object.freeze({
  "silent-output-change": "changes what a run produces, and nothing in the run's own artifacts says so",
  "disclosed-gate": "changes what a run covers, AND the run discloses the gap — name the surface that carries it",
  credential: "authentication material; absent, the run refuses at preflight by name",
  deployment: "where input and output live; the conclusion a run reaches is unchanged",
  tuning: "how long or how hard a run tries; the conclusion a run reaches is unchanged",
  harness: "read only on a fixture, replay or self-test path; no production run reaches it",
});

/**
 * The effect class declared for a name, or NULL when it has none.
 *
 * ALIAS-AWARE FOR THE SAME REASON `isCatalogued` IS, and this is not hypothetical here: 13 of the 105
 * `CLEAROTRON_*` names shipping code reads have their row spelled `CLEAROTRON_*`, so a lookup on the read
 * spelling alone would report every one of them undeclared and the backlog would be 13 names of pure
 * instrument error. ONE pair also COLLAPSES — `CLEAROTRON_AI_BILLING`/`CLEAROTRON_AI_BILLING` both reach
 * `CLEAROTRON_AI_BILLING` — so ONE declaration answers for TWO reads. That is correct while the pair
 * shares a class and it is a silent cover-up if it ever stops; the test that names the collapse is
 * what keeps it recorded.
 *
 * THE BINARY PAIR WAS THE OTHER COLLAPSE AND IT STOPPED. `CLEAROTRON_CLAUDE_PATH`/`CLEAROTRON_CODEX_PATH` are
 * two names again (owner-ruled: they are two binaries, and the test box sets both to different
 * values), so they now carry a declaration each. That is the "if it ever stops" case actually
 * arriving, which is why it is written here rather than quietly deleted.
 *
 * @param {Map<string,string>} declared  current-spelling name -> effect class
 * @param {string} name                  the name shipping code reads, possibly a compat alias
 */
export function declaredEffect(declared, name) {
  return declared.get(name) ?? null;
}

/** Every name in the catalogue that carries an effect class, keyed by the spelling its row uses. */
export function declaredEffects(rows) {
  const out = new Map();
  for (const r of rows) if (r.effect && !out.has(r.name)) out.set(r.name, r.effect);
  return out;
}

export function auditEnv(root = ROOT) {
  const tracked = trackedFiles("env-audit (#692 governance ratchet)", { root });
  if (!tracked) return null;
  const files = tracked.filter((f) => CODE_RE.test(f) && !f.startsWith("node_modules/"));

  // ── PASS ONE: the corpus's `const IDENT = "ENV_NAME"` bindings ─────────────
  //
  // Two passes because a binding and its read routinely sit in DIFFERENT files, so no single-file walk
  // can resolve one. The file text is read twice; that is the cost, and it is a governance gate that
  // runs on demand rather than a hot path.
  //
  // ATTRIBUTION IS TO THE READING FILE, NOT THE BINDING FILE. `USPTO_API_KEY` is bound in
  // `providers/uspto-local/src/sync.js` and read in `bin/uspto-sync.mjs`; the register must blame the
  // file a reader would open to find the read, and the product/harness tier follows the read too.
  const perFile = [];
  for (const rel of files) {
    try { perFile.push(envNameBindings(readFileSync(join(root, rel), "utf8"))); } catch { /* unreadable */ }
  }
  const bindings = mergeEnvNameBindings(perFile);

  const names = new Map();   // NAME -> { files: Set, product: boolean }
  for (const rel of files) {
    let text;
    try { text = readFileSync(join(root, rel), "utf8"); } catch { continue; }
    // ONE code path with the exported helper: a scanner the arms drive but the audit does not use is a
    // scanner the arms stop describing.
    for (const n of namesRead(text, bindings)) {
      if (SYSTEM_OWNED.has(n)) continue;
      if (!names.has(n)) names.set(n, { files: new Set(), product: false });
      const e = names.get(n);
      e.files.add(rel);
      if (isProductFile(rel)) e.product = true;   // one product read is enough — a test read excuses nothing
    }
  }

  // Documented = named anywhere in either governance document, ON A NAME BOUNDARY.
  //
  // Not a table parse — the register is prose with tables in it, and a stricter parser would report a
  // documented var as UNdocumented, which is the direction that gets a check switched off. But not a
  // bare substring match either: this tree has 35 names that are strict prefixes of another, including
  // `CLEAROTRON_OUTBOX_BACKOFF_CAP_SEC` under `..._CAP_SEC`-style siblings and, before `PORT` was excluded
  // as system-owned, every `PORTAL_*`. A bare `includes` marks the SHORTER name documented the moment
  // the longer one is written down — the false-DOCUMENTED direction, which hides a real gap instead of
  // inventing a fake one.
  const docs = ["docs/architecture/05-config-governance.md", "docs/architecture/04-configuration-reference.md"]
    .map((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : ""));
  // step 2 — THE CATALOGUE IS A SET OF FILES, NOT ONE FILE.
  //
  // `.env.example` used to carry all 237 rows, and a new reader met 230 variables to reach the fourteen
  // they need. The split moves the deployment and tuning populations into their own reference — and the
  // ratchet below requires EVERY product variable to have a row, with an empty backlog, so a move would
  // have red 190 names at once.
  //
  // What the ratchet MEANS is that every product variable is written down where a reader can find it.
  // That meaning is preserved by reading the whole catalogue rather than one member of it. What it must
  // NOT become is weaker: a name with a row in NEITHER file still fails, and that is planted both ways
  // in driver/test/env-governance.test.mjs.
  const example = [...CATALOGUE_FILES]
    .filter((f) => !f.endsWith(".json") && !f.endsWith(".txt"))   // the inventories are contracts, not catalogues of rows
    .map((f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), "utf8") : ""))
    .join("\n");
  // item 10 — AN ASSIGNMENT ROW, NOT A MENTION. This was `example.includes(name)`, a bare
  // substring test, so a name appearing anywhere in that file's PROSE counted as catalogued — including
  // in its own retirement notices, which name variables precisely because they are gone. Seven names
  // were flattered that way (PORTAL_STAFF_DOMAINS, CLEAROTRON_GATHER_AGENT/_SESSION_ID/_SESSION_KEY,
  // CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES, CLEAROTRON_SYNTHESIS_MODEL, CLEAROTRON_UNREACHABLE_SENIOR), so the flag
  // reported 102 missing where the true number is 109.
  //
  // A COMMENTED-OUT ROW STILL COUNTS. `# CLEAROTRON_X=` is how this file documents an optional variable
  // with no default worth shipping — it is a row a reader can uncomment, which is the thing the
  // catalogue is for. Only a name with no row at all is absent.
  const assigned = new Set([...example.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]));
  // …AND THE ROW IS OWED UNDER THE CURRENT SPELLING, NOT THE ONE THE CODE HAPPENS TO READ. The
  // CLEAROTRON_* rename runs a compat window: `applyEnvAliases` maps new to old, so shipping code still
  // READS `CLEAROTRON_REPORTS_DIR` while the name an operator should set is `CLEAROTRON_REPORTS_DIR`. Keying
  // the catalogue on the read name would have demanded 13 rows under superseded spellings — teaching a
  // new reader `CLEAROTRON_AI` in the file the install instructions tell them to copy, and undoing the
  // rename one row at a time.
  //
  // ONE-DIRECTIONAL ON PURPOSE. A name counts as catalogued only when its CURRENT spelling has a row —
  // NOT when either spelling does. A file carrying only the old row is a file teaching the old name,
  // which is a real defect and stays visible as one.
  const catalogued = (n) => isCatalogued(assigned, n);
  const documented = (n) => {
    // step 4.0 — ANY SPELLING COUNTS. The governance documents are written in retired spellings,
    // so a read converted to the name in force read as documented NOWHERE and the ratchet fired on a
    // rename rather than on a gap. It does not weaken: a genuinely new name has no alias row, so
    // `spellingsOf` returns only itself and the check is exactly what it was.
    return [n].some((sp) => {
      const re = new RegExp(`(?<![A-Z0-9_])${sp}(?![A-Z0-9_])`);
      return docs.some((d) => re.test(d));
    });
  };

  const rows = [...names.entries()].map(([name, e]) => ({
    name,
    product: e.product,
    documented: documented(name),
    inExample: catalogued(name),
    // PRODUCT files first: that is the read that obliges a governance row, and showing a test
    // file as the example sends the reader to the one place the answer is not.
    files: [...e.files].sort((x, y) => (isProductFile(y) - isProductFile(x)) || x.localeCompare(y)),
  })).sort((a, b) => a.name.localeCompare(b.name));

  return {
    total: rows.length,
    product: rows.filter((r) => r.product).length,
    harness: rows.filter((r) => !r.product).length,
    undocumentedProduct: rows.filter((r) => r.product && !r.documented).map((r) => r.name),
    undocumentedHarness: rows.filter((r) => !r.product && !r.documented).map((r) => r.name),
    rows,
  };
}

// ══ — THE CATALOGUE RATCHET TURNS THE OTHER WAY TOO ═══════════════════════════════════════
//
// Everything above answers "this variable is read — does it have a row?". Nothing answered the
// reverse, so deleting a reader left its row standing, describing a variable nothing reads. On the
// public repo that row tells an installer to set something that does nothing.
//
// ── THE TWO DIRECTIONS ARE NOT SYMMETRICAL, AND BUILDING THEM ON ONE DETECTOR IS THE BUG ─────────
//
// They have OPPOSITE costs of being wrong, so they get different evidence:
//
//   has-reader-no-row   wants PRECISION. Over-detecting invents a row somebody deletes. Bounded.
//                       Evidence: READ_RE over code files, comment lines stripped.
//
//   has-row-no-reader   wants PERMISSIVENESS. Under-detecting declares a LIVE row dead, and this
//                       guard's instruction is "delete the row". MEASURED on origin/main: driving this
//                       direction off READ_RE reports TEN rows readerless. Adjudicated one at a time:
//
//                         4  read RIGHT NOW through an idiom no `env`-prefixed regex can reach —
//                            envValue("CLEAROTRON_MAX_RETRIES") and
//                            envValue("CLEAROTRON_RATE_LIMIT_DEFAULT_BACKOFF_MS") (driver.config.mjs:486,
//                            :494), envOn("CLEAROTRON_DUMP_JSON") (gateway.mjs:1423), and
//                            `export const API_KEY_ENV = "USPTO_API_KEY"` (providers/uspto-local/src/sync.js:77).
//                            The name is a STRING LITERAL in every one; it just never sits beside an
//                            `env` token. USPTO_API_KEY is a credential.
//                         1  COURTLISTENER_TOKEN — RETIRED, and the reasoning it used to
//                            carry here is why it survived so long: "a credential, carried in
//                            bin/onboard.mjs's roster" is circular. It sat in the roster BECAUSE it
//                            read as a credential, and read as a credential BECAUSE it sat in the
//                            roster, while ADR-0003 had already ruled case-law setup an OAuth flow
//                            and not a variable at all. Evidence of a reader is not evidence of a
//                            READ: the roster is a list of names to look for, not a call site.
//                         4  the AZURE_OPENAI_* block, an external contract (below).
//                         1  CLEAROTRON_SEND_TOOL_PREFIX — genuinely dead, and this direction does not
//                            catch it either: its one surviving mention is a governance-doc line, and
//                            a mention is enough to spare a row. Under-firing is the cost of the
//                            trade, taken deliberately. It is 's prose-sweep class.
//
//                       So SIX of ten deletions would have been wrong, two of them credential rows.
//                       Evidence used instead: the bare NAME, on a name boundary, anywhere in the
//                       tracked tree. The accessor family is filed as  and does NOT belong here —
//                       see below.
//
// Chasing every read idiom until READ_RE is complete enough to drive deletions is the wrong fix, and
// is why: the accessor family alone is three spellings (envValue, envOn, envGateOn) plus a name
// held in a constant, and that is the set found by adjudicating ten rows — not by an exhaustive search.
// A guard whose safety depends on that set being complete is one unknown idiom away from deleting a
// credential row, forever. The asymmetry removes the dependency instead: this direction never has to
// know HOW a name is read, only that something in the tree still names it. Widening READ_RE for
// should therefore not change what this direction reads.
//
// COMMENTS ARE NOT STRIPPED HERE, and that is deliberate for the same reason. A name written in a
// comment is a name somebody wrote down on purpose; deleting its row on the strength of a regex that
// ignores prose is exactly the confident-and-wrong deletion this direction exists to avoid.
//
// ── AND IT IS NOT A SUPPRESSION LIST ────────────────────────────────────────────────────────────
//
// forbids one, rightly: "if a row is deliberately readerless, the row goes, not the guard."
// Applied literally that ruling deletes three rows it should not. `.env.example`'s Azure block
// documents the variables an EXTERNAL agent platform consumes — the block says so itself, ruled
// it, and `MODELS.azure` / `CLEAROTRON_AZURE_MODEL` / `jxPolicy.providerStance: "azure-only"` are live.
// There is no reader in this tree and there never was one to retire.
//
// So a row is ACCOUNTED FOR two ways, and this is one rule applied to every row rather than a list of
// exempt names: something in the tree names it, OR the row carries an inline `# external:` line
// naming who consumes it. The declaration lives AT THE ROW, where the next reader meets it, not in a
// test file nobody opens — and it is a claim about the CONSUMER, never a claim about a reader, so the
// reader set still comes only from the tree.
//
// The marker applies to the contiguous run of rows immediately below it and is ended by a blank line
// or any other comment line, so it must be the LAST comment before its rows. That fails CLOSED: a
// marker that does not reach its rows leaves them orphaned and the guard goes red.
const EXTERNAL_RE = /^#\s*external:\s*(\S.*)$/;
// -12 — THE EFFECT DECLARATION, same reach rule and the same fail-closed behaviour.
//
// ADR-0002: "Every `CLEAROTRON_*` name read by shipping code declares an effect class, and an undeclared
// new one fails CI." This is where the declaration lives, because `.env.example` is the one file that
// already has a row per name and a parser that reads them. A second list would drift from this one —
// which is the failure `isCatalogued` above exists to prevent, in the other direction.
//
// THE TWO MARKERS DO NOT CLEAR EACH OTHER. `pending` was a single slot, and any comment line that was
// not an `# external:` reset it. Adding a second marker to that shape would mean an `# effect:` line
// silently DELETED the `# external:` declaration above it — the row would go orphaned and 's
// guard would red, with the cause three lines away and invisible. Each marker carries its own slot.
const EFFECT_RE = /^#\s*effect:\s*(\S.*)$/;
// A COMMENTED-OUT ROW STILL COUNTS, the same rule `assigned` uses above and for the same reason: `# X=`
// is how this file documents an optional variable, and it is a row a reader can uncomment. `live` is
// what separates the two, because they are not interchangeable in every direction — see below.
// The leading-whitespace group is SEPARATE from the comment group on purpose. Folding them into one
// optional `(\s*#\s*)?` silently stops matching an INDENTED uncommented row, which `auditEnv`'s
// `assigned` regex above does match — and two different notions of "a row" in one file is how the two
// directions end up disagreeing about which rows exist.
const ROW_RE = /^(\s*)(#\s*)?([A-Z][A-Z0-9_]*)\s*=/;

/**
 * The catalogue's assignment rows, in file order: the name, its `# external:` declaration or null, its
 * `# effect:` class or null, and whether the row is LIVE (uncommented) or a commented-out one.
 */
export function catalogueRows(text) {
  const out = [];
  let external = null;
  let effect = null;
  for (const line of text.split("\n")) {
    const ext = EXTERNAL_RE.exec(line);
    if (ext) { external = ext[1].trim(); continue; }
    const eff = EFFECT_RE.exec(line);
    if (eff) { effect = eff[1].trim(); continue; }
    const row = ROW_RE.exec(line);
    if (row) { out.push({ name: row[3], external, effect, live: !row[2] }); continue; }
    external = null;                      // a blank line or any other comment ends BOTH runs
    effect = null;
  }
  return out;
}

/**
 * Names carrying more than one LIVE row.
 *
 * A `.env` is EXECUTED, not read: two uncommented rows for one name is a last-wins assignment, not a
 * pair of documented alternatives. `.env.example` shipped `CLEAROTRON_AI_PATH=claude` and
 * `CLEAROTRON_AI_PATH=codex` four lines apart, so anyone who copied the file got `codex` — while the
 * default `CLEAROTRON_AI=anthropic-agent` two lines above expects `claude`. (That variable has since
 * been split per engine, which removes THIS instance; the check is about two live rows for any one
 * name, and the example is kept because it is what the defect actually looked like.) Every existence check
 * passed: the name has a reader, a row and a governance entry.
 *
 * COMMENTED-OUT DUPLICATES ARE FINE and must stay fine — `# PORTAL_AUTH_MODE=auth-proxy` beside
 * `# PORTAL_AUTH_MODE=cf-access` and `# PORTAL_AUTH_MODE=local` is how this file offers a choice. That
 * one is now a TRIPLE rather than a pair ( renamed the mode and kept the old word working), which
 * is why this rule is stated as "commented rows never collide" and not as a count.
 */
export function duplicateLiveRows(rows) {
  const count = new Map();
  for (const r of rows) if (r.live) count.set(r.name, (count.get(r.name) || 0) + 1);
  return [...count].filter(([, n]) => n > 1).map(([n]) => n).sort();
}

/**
 * Rows nothing in the tree accounts for.
 *
 * PURE AND EXPORTED for the reason `isCatalogued` is: once the tree is clean this returns [] on the
 * real file forever, so an arm driven off the tree would certify nothing. The state that matters has
 * to be CONSTRUCTED.
 *
 * @param {{name: string, external: string|null}[]} rows  from catalogueRows
 * @param {Set<string>} mentioned  every NAME-shaped token appearing anywhere in the corpus
 */
export function orphanRows(rows, mentioned) {
  const seen = new Set();
  return rows
    .filter((r) => !r.external && !mentioned.has(r.name) && !seen.has(r.name) && seen.add(r.name))
    .map((r) => r.name);
}

// The catalogues describe the contract; they are not readers of it. Include them and every row is its
// own evidence, which is the circularity 's "a check cannot use its own source as evidence" names.
// — `docs/architecture/env-set-in-production.txt` joins them, and the reason is the rule this set
// exists for. It is a LIST OF NAMES, committed as step 1's production evidence because a reviewer cannot
// make that read. Left in the corpus it becomes an alibi for every catalogue row at once: each row
// appears "mentioned" somewhere in the tree, the reverse arm stops firing, and it stops silently while
// looking like a clean tree. Caught by that arm on the commit that added the file — the guard working
// on its author.
// THE RULE IS "ANY COMMITTED INVENTORY OF NAMES", not "any file called.env.example". added two —
// the production evidence list and the classification artifact — and BOTH became an alibi for every
// catalogue row the moment they landed: each row appeared "mentioned" somewhere in the tree, the reverse
// arm stopped firing, and it stopped SILENTLY while looking like a clean tree. The first was caught by
// that arm; the second was caught only because the first fix did not clear it, which is the better
// reason to state the rule as a rule rather than a list of three filenames.
export const CATALOGUE_FILES = new Set([
  ".env.example", ".env.deployment.example", ".env.dev.example", ".env.prod.example",
  "docs/architecture/env-set-in-production.txt",
  "docs/architecture/env-classification.json",
]);
const TOKEN_RE = /[A-Z][A-Z0-9_]*/g;

/**
 * The reverse audit, or NULL off a checkout — same contract as auditEnv, same reason.
 *
 * NULL MEANS "NO CORPUS", AND NOTHING ELSE. A missing `.env.example` on a real checkout THROWS rather
 * than returning null: the callers treat null as "skip, this is not a git tree", so returning it for a
 * vanished catalogue would report the disappearance of the file this whole check is about as a skip
 * with a reason that is not true. That is the failure this PR exists to close, and it was in this
 * function until review.
 */
export function auditCatalogue(root = ROOT) {
  const tracked = trackedFiles("env-audit (#1426 catalogue ratchet)", { root });
  if (!tracked) return null;
  const file = ".env.example";
  if (!existsSync(join(root, file)))
    throw new Error(`env-audit: ${file} is absent from a tracked checkout. That is the catalogue this `
      + `check reads; its disappearance is a finding, not a reason to skip.`);

  const mentioned = new Set();
  for (const rel of tracked) {
    if (CATALOGUE_FILES.has(rel) || rel.startsWith("node_modules/")) continue;
    let text;
    try { text = readFileSync(join(root, rel), "utf8"); } catch { continue; }
    for (const m of text.matchAll(TOKEN_RE)) mentioned.add(m[0]);
  }

  // step 2 — BOTH HALVES OF THE CATALOGUE. `.env.example` carries the setup population and
  // the deployment env example the operator's; a reader of either is reading the catalogue, and a check
  // that read one of them would report the other's 200 rows as absent while looking correct.
  //
  // the developer env example / the production env example are NOT read here: they are worked EXAMPLES of a filled-in
  // environment, not the contract. They are in CATALOGUE_FILES to keep them out of the mention corpus,
  // which is a different job — an alibi cannot come from them either.
  const CONTRACT_FILES = [".env.example", ".env.deployment.example"];
  // PER FILE, AND THAT IS THE POINT RATHER THAN A NICETY. This issue's acceptance is a count of rows in
  // `.env.example` specifically — "about fifteen a user sees" — and step 2 met it by MOVING rows to the
  // deployment half. A single combined total cannot state that acceptance even when the total is right.
  //
  // It also had a `file` field: the string ".env.example", left over from when this read one file, and
  // still handed to the reporter after the corpus grew to two. The report therefore printed the
  // two-file count under the one-file name — "232 row(s) in .env.example" for a file holding 42 — so
  // every progress reading on the issue said the surface had never split. The field is gone rather than
  // corrected: a label that can drift away from what was counted is the defect, not the value it held.
  // ── A CONTRACT FILE THAT IS NOT THERE IS A FINDING, NOT A SMALLER CORPUS ────────────────────────
  //
  // This filtered the corpus by `existsSync` and said nothing, so a missing half of the catalogue was
  // skipped in silence and the report read clean over the file that remained. The comment directly
  // above warns of exactly that failure — "a check that read one of them would report the other's 200
  // rows as absent while looking correct" — and the filter is what made it happen.
  //
  // It is not hypothetical: `.env.deployment.example` is withheld from the public tree by the cut, so
  // on THIS tree the audit has been reporting on one of its two contract files. That is a fine state
  // to be in and a terrible state to be in silently: every governance number this script prints is
  // computed over half the catalogue, and nothing said so.
  //
  // So the absence is carried out with the result and named by the reporter. Nothing here fails — an
  // audit that refused to run on the public tree would just stop being run.
  const absent = CONTRACT_FILES.filter((f) => !existsSync(join(root, f)));
  const perFile = CONTRACT_FILES
    .filter((f) => existsSync(join(root, f)))
    .map((f) => ({ file: f, rows: catalogueRows(readFileSync(join(root, f), "utf8")) }));
  const rows = perFile.flatMap((e) => e.rows);
  return { files: perFile.map((e) => e.file), perFile, absent, rows, mentioned, orphans: orphanRows(rows, mentioned), duplicates: duplicateLiveRows(rows) };
}

if (isEntrypoint(import.meta.url)) {
  const a = auditEnv();
  // A report that could not read the tree is not a report with nothing in it. This is the one exit
  // the "always 0" rule below does not cover: --list would print an empty line and whatever consumes
  // it would read that as "no undocumented names".
  if (!a) {
    console.error(`\nenv-audit: this tree is not a git checkout, so there is no tracked corpus to audit.\n`);
    process.exit(2);
  }
  // ── `console.log` + `process.exit` TRUNCATES AT THE PIPE BUFFER ────────────────────────────────
  //
  // stdout to a PIPE is asynchronous in node; `process.exit()` discards whatever has not drained. So
  // `node scripts/env-audit.mjs --json | jq` — the pipeline shared/tracked-files.mjs names as the
  // reason this exits 0 with clean stdout — has been silently cut at **65536 bytes** for as long as
  // the payload has been larger than that. Measured on origin/main before this change: 65536 bytes
  // piped, 101442 to a file, and the piped form does not parse. Redirect to a file and it is whole;
  // pipe it and it is not, which is the difference nobody checks.
  //
  // `writeSync` is the fix rather than dropping the exit, because the exit code is the contract here.
  const emit = (text) => { writeSync(1, text + "\n"); process.exit(0); };
  if (asList) { emit(a.undocumentedProduct.join("\n")); }
  if (asJson) {
    // "THE SAME, MACHINE-READABLE" HAS TO STAY TRUE. The report below gained a second direction; a
    // --json that carried only the first would be a narrower instrument wearing the same name, and its
    // silence about catalogue rows would read as "nothing to report" to whatever consumes it.
    // `mentioned` is deliberately reduced to its SIZE: it is ~20k tokens, and a consumer needs to know
    // the corpus was read, not to receive it.
    const c = auditCatalogue();
    const catalogue = c && { files: c.files, perFile: c.perFile.map((e) => ({ file: e.file, rows: e.rows.length })),
      rows: c.rows, corpusTokens: c.mentioned.size, orphans: c.orphans, duplicates: c.duplicates };
    emit(JSON.stringify({ ...a, catalogue }, null, 2));
  }
  console.log(`\n== env audit ==\n`);
  console.log(`  ${a.total} distinct names read by code`);
  console.log(`    ${a.product} read by product code — these need a governance row`);
  console.log(`    ${a.harness} read ONLY by tests, mocks and dev scripts — these do not`);
  console.log(`\n  ${a.undocumentedProduct.length} PRODUCT name(s) absent from both governance documents:`);
  for (const n of a.undocumentedProduct) {
    const r = a.rows.find((x) => x.name === n);
    console.log(`    ${n.padEnd(38)} ${r.files[0]}${r.files.length > 1 ? ` (+${r.files.length - 1})` : ""}${r.inExample ? "   [in .env.example]" : ""}`);
  }
  console.log(`\n  ${a.undocumentedHarness.length} harness-only name(s) undocumented, which is fine and is why they are counted separately.\n`);

  // — THE OTHER DIRECTION, in the same report. ADR-0002's closing line points a reader here for
  // the live figures; a report that answered only "which reads lack a row" left the reverse question
  // looking answered because nothing raised it.
  const c = auditCatalogue();
  if (c) {
    const declared = c.rows.filter((r) => r.external);
    const split = c.perFile.map((e) => `${e.rows.length} in ${e.file}`).join(" + ");
    console.log(`  ${split} = ${c.rows.length} catalogue row(s), of which ${declared.length} declare an external consumer.`);
    // NAMED BEFORE THE NUMBERS ARE READ, not after. Every figure below is computed over the files
    // that were present, and a reader who does not know one was missing will take them as the whole
    // catalogue — which is precisely how this went unnoticed.
    if (c.absent?.length) {
      console.log(`\n  COULD NOT READ ${c.absent.length} of ${c.absent.length + c.perFile.length} contract file(s), so every count in this section is PARTIAL:`);
      for (const f of c.absent) console.log(`    ${f} — not on this tree`);
      console.log(`  This is expected on the public tree, where the deployment half of the catalogue is`);
      console.log(`  withheld. It is stated rather than skipped: a partial audit that reads as a whole one`);
      console.log(`  is worse than no audit.`);
    }
    console.log(`  ${c.orphans.length} row(s) name a variable nothing in this tree mentions:`);
    for (const n of c.orphans) console.log(`    ${n}`);
    console.log(`  ${c.duplicates.length} name(s) carry more than one LIVE row (a last-wins assignment):`);
    for (const n of c.duplicates) console.log(`    ${n}`);
    console.log("");
  }
  // Exit 0 always: this is a REPORT. The ratchet that fails lives in the test suite, where a red is
  // actionable; a script that exits 1 on a known backlog is a script somebody stops running.
}
