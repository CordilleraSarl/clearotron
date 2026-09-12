// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// import-cycle-check.mjs — nothing a command awaits may import that command back.
//
// THE FAILURE THIS EXISTS FOR, AND WHY NOTHING ELSE CATCHES IT.
//
// A module can be both a module and a command. When such a module carries a TOP-LEVEL await, anything it
// reaches while that await is still settling must not import it back, because the import asks for a module
// that is mid-evaluation. The request never resolves. Node prints "Detected unsettled top-level await" and
// names the line of the await — not the import that closed the loop, and not the file that added it.
//
// Measured 2026-09-12: one static `import { parseEnvFile } from "../driver/systemd/render-units.mjs"` in
// `bin/start.mjs` stopped 21 install and unit-placement arms at once. `render-units.mjs --apply` IS the
// documented server install, so the defect refused to install rather than misbehaving quietly. Lint, the
// pattern guards, the portal build and the packaged-bytes guard all passed around it; only arms that run
// the command for real caught it, on the third push.
//
// The same shape is already in the tree once: `bin/onboard.mjs` carries a top-level `await runCli()` and
// reaches `bin/start.mjs` from inside it, so a static import of onboard from start takes `doctor` down.
// That one had a bespoke arm naming one file pair. This check holds the property for the whole class.
//
// WHAT COUNTS AS AN EDGE, AND WHY THE OBVIOUS RULE IS WRONG.
//
// A static import always counts: importing a module evaluates it. A DYNAMIC import counts only where it is
// awaited on the top-level await's own call path — `writeInstallEnv`'s imports are on it; the register
// table at `bin/start.mjs` and the renderer it fetches when placing units are not, because a dynamic
// import inside a function closes no load-time loop and both are deliberate.
//
// A rule of "no command is imported by a binary" would refuse correct call sites. Following every dynamic
// import regardless of where it sits reports cycles that do not exist and would demand the repair that
// CAUSES this bug. Neither is the property. The property is the sentence at the top of this file.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["bin", "driver", "shared", "scripts"];
const SKIP = new Set(["node_modules", ".git", "dist", "coverage"]);

/**
 * Entry points that carry a top-level await must number at least this many, or the scanner has stopped
 * recognising its subject. A FLOOR ON THE POPULATION, not on the matches: an empty class reads exactly
 * like a clean one, and this class is invisible failures by definition.
 *
 * SET JUST UNDER WHAT THE TREE CARRIES, which is 18. A floor far below the real count is not a floor:
 * an earlier draft read brace depth per line, and a floor of 12 would have passed that regression
 * without a word (found in review).
 *
 * IT READ 22 BEFORE, AND THAT NUMBER WAS WRONG — do not restore it. A function whose signature carries
 * an object-literal default, `async function f(ctx, opts = {}) {`, had its body read as module scope,
 * so ordinary awaits inside four commands counted as top-level. Each departure was checked rather than
 * assumed: the awaits in `connect`, `brandowner`, `drain-preflight` and `pool-admin` all sit inside
 * named functions, and the command `pipeline.mjs` — which this check briefly accused of a cycle — exits
 * on a usage message rather than hanging. The two that must never leave are here: the unit renderer
 * (`if (APPLY) … await …`) and the wizard (`await runCli()` in a module-scope else).
 */
export const POPULATION_FLOOR = 16;

/** Reached during a top-level await and absent from every live tree. Named, never skipped in silence:
 *  `cut/` is withheld from the public repository, and `cut-archive` is deliberately not overlaid either,
 *  so this path resolves nowhere this check will ever run. An absence nobody declared is a could-not-look. */
export const KNOWN_ABSENT = Object.freeze(["cut/packed-artifact.mjs"]);

/**
 * Comments, string bodies and regex literals removed, line count preserved, so what remains is code.
 *
 * ONE LEFT-TO-RIGHT PASS, NOT A STACK OF REPLACEMENTS. This was five independent regexes, and their
 * order is what broke it: a `//` inside a string is eaten as a comment, the quote that followed then
 * pairs with the wrong one, and from there the file is read out of phase. The symptom was this very
 * scanner reporting ITSELF as awaiting at the top level, off a template in its own error output — the
 * word `await` inside a template whose opening backtick had been swallowed upstream (found in review by
 * printing the lines it claimed, rather than reasoning about which construct was to blame).
 *
 * Regex literals are blanked too: `/await\s+.../` carries the token `await` between two non-word
 * characters, and no boundary test on the word alone can tell that from code.
 */
export function blank(src) {
  const text = String(src ?? "");
  const out = new Array(text.length);
  // Where a `/` starts a regex rather than divides: after an operator, a comma, an opening bracket, or
  // nothing at all. Division follows a value — an identifier, a number, or a closing bracket.
  const regexCanStart = (prev) => prev === "" || "([{,;:=!&|?+-*%~^<>".includes(prev) || /\breturn|typeof|of|in|case\b/.test(prev);
  let i = 0, lastSignificant = "";
  const keep = (n) => { for (let k = 0; k < n; k++, i++) out[i] = text[i]; };
  const hide = (n, ch) => { for (let k = 0; k < n; k++, i++) out[i] = text[i] === "\n" ? "\n" : ch; };
  while (i < text.length) {
    const c = text[i], next = text[i + 1];
    if (c === "/" && next === "/") { let j = i; while (j < text.length && text[j] !== "\n") j++; hide(j - i, " "); continue; }
    if (c === "/" && next === "*") { let j = i + 2; while (j < text.length && !(text[j] === "*" && text[j + 1] === "/")) j++; hide(Math.min(j + 2, text.length) - i, " "); continue; }
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < text.length && text[j] !== c) { if (text[j] === "\\") j++; j++; }
      hide(Math.min(j + 1, text.length) - i, "_"); lastSignificant = "x"; continue;
    }
    if (c === "`") {
      // A template ends at its own backtick; `${ … }` may hold code, and this blanks that too — nothing
      // inside a template can open a load-time import, so losing it costs this check nothing.
      let j = i + 1, depth = 0;
      while (j < text.length) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === "$" && text[j + 1] === "{") { depth++; j += 2; continue; }
        if (text[j] === "}" && depth) { depth--; j++; continue; }
        if (text[j] === "`" && !depth) break;
        j++;
      }
      hide(Math.min(j + 1, text.length) - i, "_"); lastSignificant = "x"; continue;
    }
    if (c === "/" && regexCanStart(lastSignificant)) {
      let j = i + 1, inClass = false, closed = false;
      while (j < text.length && text[j] !== "\n") {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === "[") inClass = true;
        else if (text[j] === "]") inClass = false;
        else if (text[j] === "/" && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) { hide(j + 1 - i, "_"); lastSignificant = "x"; continue; }
    }
    if (!/\s/.test(c)) lastSignificant = c;
    keep(1);
  }
  return out.join("");
}

/**
 * Lines carrying an await with NO function-opened brace around them.
 *
 * Depth alone is not the test. `bin/onboard.mjs` awaits inside a module-scope `if`/`else`, which is a
 * genuine top-level await at brace depth one, and a depth-zero scan would miss the module that proves this
 * class exists. So each open brace remembers whether the line that opened it looked like a function.
 */
/** Blocks that are not functions, so an `await` inside one is still the module's own. */
const CONTROL = new Set(["if", "for", "while", "switch", "catch", "do", "with", "else", "try", "finally"]);

/**
 * Did a function open this brace? Read structurally, never by looking back over text.
 *
 * A TEXT WINDOW GETS THIS WRONG ON THE COMMONEST IDIOM IN THIS TREE. The first version split the
 * preceding text on `[;{}]` and asked whether the last piece said `function` — and
 * `async function runDigest(ctx, opts = {}) {` contains a brace pair IN ITS PARAMETER LIST, so the
 * window reset and the body brace saw only `) `. Every function with an object-literal default had its
 * body read as module scope, and `driver/pipeline.mjs` reported 84 top-level awaits that are ordinary
 * awaits inside functions — a cycle the check then claimed on a tree that runs perfectly (found by
 * driving the command it named: it exits 2 on a usage message, not 13 on a hang).
 *
 * So: step over the parameter list by matching parentheses, then read the name in front of it.
 */
export function opensFunction(text, at) {
  let j = at - 1;
  const skipSpace = () => { while (j >= 0 && /\s/.test(text[j])) j--; };
  skipSpace();
  if (j >= 1 && text[j] === ">" && text[j - 1] === "=") return true;          // `=> {`
  if (j >= 0 && text[j] === ")") {
    let depth = 0;
    for (; j >= 0; j--) {
      if (text[j] === ")") depth++;
      else if (text[j] === "(") { depth--; if (!depth) break; }
    }
    j--; skipSpace();
    let end = j;
    while (j >= 0 && /[\w$]/.test(text[j])) j--;
    const name = text.slice(j + 1, end + 1);
    return !CONTROL.has(name);                                                // `f(…) {` but not `if (…) {`
  }
  let k = j, word = "";
  while (k >= 0 && /[\w$]/.test(text[k])) { word = text[k] + word; k--; }
  return word === "class" || (word !== "" && !CONTROL.has(word) && /\bclass\b/.test(text.slice(Math.max(0, k - 20), k + 1)));
}

export function topLevelAwaitLines(src) {
  const text = blank(src);
  const opened = [];
  const hits = new Set();
  let line = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") { line++; continue; }
    if (ch === "{") { opened.push(opensFunction(text, i)); continue; }
    if (ch === "}") { opened.pop(); continue; }
    // THE TOKEN, NOT THE WORD. `blank()` removes comments and string bodies but not regex literals, and
    // this very file carries `/await\s+([A-Za-z_$][\w$]*)\s*\(/` — which has `await` between two
    // non-word characters, so a boundary test alone counted this scanner as awaiting at its own top
    // level (found in review by reading the population it reported). A real `await` is followed by
    // whitespace or an open parenthesis; inside that regex it is followed by a backslash.
    if (ch === "a" && text.startsWith("await", i) && !/[\w$/\\]/.test(text[i - 1] ?? " ") && /[\s(]/.test(text[i + 5] ?? "")) {
      if (!opened.some(Boolean)) hits.add(line);
    }
  }
  return [...hits];
}

/** The whole argument expression of every `import(...)`, parentheses counted rather than split on a comma. */
export function importArguments(text) {
  const src = String(text ?? "");
  const out = [];
  for (const m of src.matchAll(/\bimport\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let j = open; j < src.length; j++) {
      const c = src[j];
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (!depth) { out.push(src.slice(open + 1, j)); break; } }
    }
  }
  return out;
}

/**
 * The literal chunks of a specifier, whatever shape it is written in.
 *
 * THREE SHAPES, AND A READER THAT KNOWS ONLY THE FIRST IS BLIND TO THE CASE THAT BIT US. `bin/onboard.mjs`
 * reaches `bin/start.mjs` through `pathToFileURL(join(REPO, "bin", "start.mjs")).href` — computed, not
 * quoted. A literal-only scan finds nothing there and reports a complete walk. An argument yielding no
 * fragment at all is neither safe nor a specifier this check understood: it is reported, not assumed.
 */
export function fragmentsOf(arg) {
  const src = String(arg ?? "");
  const out = [];
  for (const m of src.matchAll(/["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of src.matchAll(/`([^`]*)`/g))
    for (const chunk of m[1].split(/\$\{[^}]*\}/)) if (chunk.trim()) out.push(chunk);
  return out;
}

/** A repo-relative module path, or null when the fragments do not spell one (a bare package, `node:`, a
 *  data URL). Only paths this repository owns can close a cycle inside it. */
export function resolveSpecifier(fragments, from) {
  if (!fragments.length) return null;
  const joined = fragments.join("/").replace(/\/+/g, "/").split("?")[0];
  if (/^node:/.test(joined)) return null;
  if (!/\.(mjs|js|cjs)$/.test(joined)) return null;
  const p = joined.startsWith(".") ? join(dirname(from), joined) : joined.replace(/^\//, "");
  return normalize(p).split(sep).join("/");
}

/**
 * Every specifier that is evaluated when this module is imported.
 *
 * TWO FORMS, AND READING ONLY THE FIRST MAKES THIS CHECK BLIND TO THE THING IT IS FOR. `import x from "y"`
 * and `export { a } from "y"` carry `from`; a SIDE-EFFECT import — `import "y";` — does not, and it
 * evaluates the module just the same. Four binaries in this tree open with one. Found in review by
 * planting `import "…/render-units.mjs";` into the leaf that renderer loads from inside its top-level
 * await: this check reported nothing and exited 0 while the command itself exited 13 on the unsettled
 * await. Same failure, same pair, silently passed.
 *
 * A dynamic `import("y")` is not matched here and must not be: the parenthesis is what distinguishes it,
 * and it is an edge only where the await reaches it.
 */
export function staticSpecifiers(src) {
  const text = String(src ?? "");
  const out = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) out.push(m[1]);
  return [...new Set(out)];
}

/** The body of a named async function or arrow, by brace matching. */
export function bodyOf(src, name) {
  const text = String(src ?? "");
  const re = new RegExp(`(?:async\\s+function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=\\s*async\\s*(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>)`, "m");
  const m = re.exec(text);
  if (!m) return null;
  const open = text.indexOf("{", m.index);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    const c = text[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (!depth) return text.slice(open, j + 1); }
  }
  return null;
}

const awaitedCalls = (text) =>
  [...String(text ?? "").matchAll(/await\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]).filter((n) => n !== "import");

/**
 * The reader, and the two answers it must keep apart.
 *
 * A FILE THAT IS NOT THERE IS A FACT; A FILE THAT WOULD NOT READ IS A COULD-NOT-LOOK. One `catch` returning
 * nothing collapses them, and then a file too large for the read buffer is filed as absent and quietly left
 * out of the walk — which is what happened while this check was being built, over a module that exists.
 */
export function makeReader(read = readFileSync) {
  const missing = [];
  const unreadable = [];
  const cache = new Map();
  const readSource = (rel) => {
    if (cache.has(rel)) return cache.get(rel);
    let out = null;
    try {
      out = read(join(ROOT, rel), "utf8");
    } catch (e) {
      if (e?.code === "ENOENT" || e?.code === "ENOTDIR") missing.push(rel);
      else unreadable.push(`${rel} (${e?.code ?? e?.message ?? "unknown"})`);
    }
    cache.set(rel, out);
    return out;
  };
  return { readSource, missing, unreadable };
}

/** Every `.mjs` under the roots this repository owns. */
export function moduleFiles(root = ROOT, roots = ROOTS, list = readdirSync, stat = statSync) {
  const out = [];
  const walk = (rel) => {
    let entries;
    try { entries = list(join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      const isDir = e.isDirectory?.() ?? stat(join(root, child)).isDirectory();
      if (isDir) walk(child);
      else if (e.name.endsWith(".mjs")) out.push(child);
    }
  };
  for (const r of roots) walk(r);
  return out.sort();
}

/** A module that decides whether it was run rather than imported. */
export const isEntryPointSource = (src) => /isEntrypoint\(|import\.meta\.url === /.test(String(src ?? ""));

/**
 * What an entry point reaches WHILE its top-level await is settling.
 *
 * Seeds are the calls awaited at the top level and any `import()` written there. From each seed we take the
 * function of that name in the same file and follow what it awaits, to a fixed point — the call path, not
 * the whole module.
 */
export function reachedDuringTopLevelAwait(entry, src) {
  const seeds = new Set();
  const args = [];
  const lines = String(src ?? "").split("\n");
  for (const i of topLevelAwaitLines(src)) {
    for (const c of awaitedCalls(lines[i])) seeds.add(c);
    for (const a of importArguments(lines[i])) args.push(a);
  }
  const walked = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const name = queue.shift();
    if (walked.has(name)) continue;
    walked.add(name);
    const body = bodyOf(src, name);
    if (!body) continue;
    for (const a of importArguments(body)) args.push(a);
    for (const c of awaitedCalls(body)) if (!walked.has(c)) queue.push(c);
  }
  const modules = new Set();
  const unresolved = [];
  for (const a of args) {
    const frags = fragmentsOf(a);
    if (!frags.length) { unresolved.push(a.trim().replace(/\s+/g, " ").slice(0, 70)); continue; }
    const r = resolveSpecifier(frags, entry);
    if (r) modules.add(r);
  }
  return { modules, unresolved, awaited: [...seeds] };
}

/** Everything evaluated when `start` is imported: itself, and the static closure beneath it. */
export function staticClosureOf(start, readSource) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    const src = readSource(p);
    if (!src) continue;
    for (const spec of staticSpecifiers(src)) {
      if (!spec.startsWith(".")) continue;
      queue.push(normalize(join(dirname(p), spec)).split(sep).join("/"));
    }
  }
  return seen;
}

/** The whole check, as data. Callers decide what to print and what to exit. */
export function scan({ read = readFileSync, list = readdirSync } = {}) {
  const { readSource, missing, unreadable } = makeReader(read);
  const files = moduleFiles(ROOT, ROOTS, list);
  const entries = files.filter((f) => isEntryPointSource(readSource(f)));
  const withTopLevelAwait = [];
  const violations = [];
  const unresolved = [];
  for (const entry of entries) {
    const src = readSource(entry);
    if (!src) continue;
    const reached = reachedDuringTopLevelAwait(entry, src);
    if (!topLevelAwaitLines(src).length) continue;
    withTopLevelAwait.push(entry);
    for (const u of reached.unresolved) unresolved.push(`${entry}: ${u}`);
    for (const mod of reached.modules) {
      for (const inClosure of staticClosureOf(mod, readSource)) {
        const src2 = readSource(inClosure);
        if (!src2) continue;
        for (const spec of staticSpecifiers(src2)) {
          if (!spec.startsWith(".")) continue;
          const target = normalize(join(dirname(inClosure), spec)).split(sep).join("/");
          if (target === entry) violations.push({ entry, importer: inClosure, reached: mod });
        }
      }
    }
  }
  const undeclaredAbsent = [...new Set(missing)].filter((m) => !KNOWN_ABSENT.includes(m));
  return { scanned: files.length, entries, withTopLevelAwait, violations, unresolved,
    missing: [...new Set(missing)], undeclaredAbsent, unreadable: [...new Set(unreadable)] };
}

if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] ?? "").endsWith("import-cycle-check.mjs")) {
  let r;
  try { r = scan(); }
  catch (e) {
    console.error(`import-cycle-check: could not read the tree (${e?.code ?? e?.message}). Nothing was checked.`);
    process.exit(2);
  }

  console.log(`import-cycle-check: ${r.scanned} modules, ${r.entries.length} of them commands, `
    + `${r.withTopLevelAwait.length} of those awaiting at the top level.`);

  // COULD NOT LOOK — never a pass, and three separate ways to get there.
  if (r.withTopLevelAwait.length < POPULATION_FLOOR) {
    console.error(`import-cycle-check: only ${r.withTopLevelAwait.length} commands await at the top level, `
      + `and ${POPULATION_FLOOR} is the floor. The scanner has stopped recognising its subject — read it `
      + "before trusting this run.");
    process.exit(2);
  }
  if (r.unreadable.length) {
    console.error("import-cycle-check: these files would not read, so the walk below is incomplete:");
    for (const u of r.unreadable) console.error(`    ${u}`);
    process.exit(2);
  }
  if (r.undeclaredAbsent.length) {
    console.error("import-cycle-check: these modules are reached during a top-level await and are not in the "
      + "tree, and nothing here declares them absent:");
    for (const m of r.undeclaredAbsent) console.error(`    ${m}`);
    console.error("\nAdd it to KNOWN_ABSENT with the reason, or fix the path. An absence nobody declared is "
      + "a module this check silently stopped following.");
    process.exit(2);
  }
  if (r.unresolved.length) {
    console.error("import-cycle-check: these dynamic imports have a specifier this check could not read, so "
      + "what they reach is unknown:");
    for (const u of r.unresolved) console.error(`    ${u}`);
    process.exit(2);
  }

  if (!r.violations.length) {
    console.log("import-cycle-check: nothing any of them awaits imports it back.");
    process.exit(0);
  }

  console.error("");
  console.error("These commands are imported back by something they reach while their top-level await is settling:");
  for (const v of r.violations) console.error(`    ${v.entry}  <=  ${v.importer}   (reached via ${v.reached})`);
  console.error("");
  console.error("Run as a command, each of these hangs: the import asks for a module that is still being");
  console.error("evaluated, so it never resolves. Node reports an unsettled top-level await naming the await,");
  console.error("not this import, and the command installs or runs nothing.");
  console.error("");
  console.error("The repair is to move what the importer wanted into a module that imports nothing, and to");
  console.error("re-export it from the command if its other readers should keep one spelling. Making the");
  console.error("import dynamic inside a function also closes the loop, but it leaves a command in a");
  console.error("binary's graph for the next reader to tidy back up.");
  process.exit(1);
}
