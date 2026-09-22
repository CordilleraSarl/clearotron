// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-strings.mjs — every string the portal can put in front of a reader, read out of the source.
//
//   node scripts/portal-strings.mjs                        TSV on stdout: file, line, kind, string
//   node scripts/portal-strings.mjs --json                 the same as JSON
//   node scripts/portal-strings.mjs --check <approved>     refuse any string neither list carries
//   node scripts/portal-strings.mjs --backlog-shrinks --base <ref>   refuse a backlog line the base lacks
//
// ── WHY THE SOURCE IS PARSED, NOT GREPPED ───────────────────────────────────────────────────────────
//
// A line-by-line read cannot see the strings that matter most. A sentence in JSX is usually text with a
// value in the middle of it (`Searching {count} registers`), and a reader that skips any line carrying a
// brace, to avoid quoting half an expression, drops exactly those. Measured 2026-09-18: a line-based
// extractor missed a connector sentence on the New clearance screen for that reason, and it was one of
// the sentences an owner review then found by eye.
//
// So each file is parsed with the parser the portal's own build uses, and a sentence is read the way a
// reader meets it: the text of an element, with inline formatting joined in and every interpolated value
// shown as `{…}`. Strings built with `+` are joined the same way.
//
// ── WHAT COUNTS AS A STRING A READER SEES ───────────────────────────────────────────────────────────
//
//   text          an element's text, and any literal an expression in its children can resolve to
//   attr:<name>   a literal given to an attribute a reader meets: title, aria-label, placeholder, alt,
//                 and the label/heading/hint family on the portal's own components
//   prop:<key>    a literal under an object key of the same family — navigation labels, menu items
//   code          any other literal that reads as prose: two words or more, not a path, URL, class
//                 list or style value
//
// Never read: comments, imports, types, class names and ids, comparisons (`status === 'queued'` is a
// token, not a sentence), and arguments to DOM, storage and string methods. A token that slips through
// is a line a reviewer skips; a sentence that is missed is one nobody reviews, so the rules lean toward
// reading too much.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// THE PARSER IS LOADED ONLY WHEN SOMETHING IS PARSED, and that is not tidiness. `--backlog-shrinks`
// compares two committed JSON files and reads no source at all, and the job that runs it installs
// nothing on purpose — it answers in seconds off git. Imported at the top, rolldown made that step die
// with ERR_MODULE_NOT_FOUND on the runner. Measured on beta-9, 2026-09-18, on the first run that ever
// reached the step: an earlier guard in the same job had refused first every time before it.
//
// `createRequire` and not `await import`, because the extractor is called from synchronous code and from
// tests that read its rows directly; making it async would turn that into a different function.
let parse = null;
function parser() {
  if (parse) return parse;
  try { ({ parseAst: parse } = createRequire(import.meta.url)("rolldown/parseAst")); }
  catch (e) {
    // COULD NOT LOOK, never a pass: reading the portal with no parser finds no strings, which is exactly
    // what an approved tree looks like.
    console.error("portal-strings: reading the portal's source needs its build dependencies — run `npm ci`"
      + ` first.\n  ${String(e.message).split("\n")[0]}`);
    process.exit(2);
  }
  return parse;
}
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = "portal-ui/src";

/** What an interpolated value is shown as. Never a character the portal itself writes. */
export const HOLE = "{…}";

const INLINE = new Set(["a", "abbr", "b", "bdi", "cite", "code", "em", "i", "kbd", "mark", "q", "s", "small",
  "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "br"]);

/** Attributes and object keys whose value a reader meets as words. */
const READ = new Set(["title", "aria-label", "aria-description", "aria-placeholder", "aria-roledescription",
  "aria-valuetext", "placeholder", "alt", "label", "heading", "lede", "hint", "help", "description", "caption",
  "message", "text", "body", "summary", "subtitle", "sub", "note", "tooltip", "legend", "prompt", "question",
  "empty", "emptyText", "confirmLabel", "cancelLabel", "submitLabel", "actionLabel", "buttonLabel", "cta",
  "reason", "detail", "headline", "eyebrow", "verb", "noun", "line"]);

/** Attributes and keys whose value is machinery, whatever it looks like. */
const MACHINE = new Set(["className", "class", "id", "key", "href", "src", "type", "role", "name", "htmlFor",
  "to", "style", "rel", "target", "method", "action", "form", "lang", "dir", "tabIndex", "autoComplete",
  "inputMode", "pattern", "variant", "size", "icon", "kind", "tone", "slug", "path", "route", "status",
  "state", "code", "testId", "aria-hidden", "aria-controls", "aria-describedby", "aria-labelledby",
  "aria-expanded", "aria-current", "aria-live", "aria-haspopup", "aria-modal", "aria-selected",
  "aria-checked", "aria-pressed", "aria-disabled", "aria-invalid", "aria-required", "aria-busy",
  "aria-orientation", "aria-sort", "aria-atomic", "aria-owns", "aria-activedescendant", "xmlns",
  "viewBox", "d", "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "points", "transform"]);

/** Calls whose string arguments are tokens: selectors, storage keys, events, string operations. */
const TOKEN_CALLS = new Set(["querySelector", "querySelectorAll", "getElementById", "getElementsByClassName",
  "addEventListener", "removeEventListener", "setAttribute", "getAttribute", "removeAttribute",
  "hasAttribute", "getItem", "setItem", "removeItem", "split", "join", "replace", "replaceAll", "match",
  "matchAll", "startsWith", "endsWith", "includes", "indexOf", "lastIndexOf", "padStart", "padEnd",
  "toLocaleDateString", "toLocaleTimeString", "toLocaleString", "DateTimeFormat", "NumberFormat",
  "RegExp", "encodeURIComponent", "decodeURIComponent", "has", "get", "set", "delete", "createElement",
  "matchMedia", "postMessage", "log", "warn", "error", "info", "debug", "trace", "assign", "fetch",
  "URL", "URLSearchParams", "append", "keys", "localeCompare"]);

const COMPARE = new Set(["===", "!==", "==", "!=", "in", "instanceof"]);

const tidy = (s) => s.replace(/\s+/g, " ").trim();

/** JSX decodes HTML entities in element text and in attribute strings, so a reader sees `’`, not `&rsquo;`. */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…", middot: "·", rarr: "→", larr: "←", times: "×",
  copy: "©", reg: "®", trade: "™", bull: "•", rsaquo: "›", lsaquo: "‹", eacute: "é", egrave: "è", agrave: "à" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e.toLowerCase()] ?? m;
});

/**
 * JSX's own whitespace rule, which React applies: whitespace that touches a line break is dropped, lines
 * left empty go, and the rest join with one space. So `search variant⏎{plural}` renders "search variants"
 * with nothing between the word and the value, where collapsing every break to a space would not.
 */
export function jsxText(value) {
  const lines = value.split(/\r\n|\n|\r/);
  const kept = [];
  lines.forEach((l, i) => {
    let x = l.replace(/\t/g, " ");
    if (i > 0) x = x.replace(/^ +/, "");
    if (i < lines.length - 1) x = x.replace(/ +$/, "");
    if (x) kept.push(x);
  });
  return kept.join(" ");
}

/** A value in a reader-facing slot that is still a token: `reason="notFound"`, `tone="warn-soft"`. */
const token = (s) => !/\s/.test(s) && (/^[a-z]+[A-Z]\w*$/.test(s) || /^[a-z0-9]+(?:[-_.:][a-z0-9]+)+$/.test(s));
const letters = (s) => s.split(HOLE).join(" ").replace(/[^\p{L}]+/gu, "");

/**
 * Whether a literal found in ordinary code reads as prose rather than as a token.
 *
 * Two words or more, and none of the shapes machinery takes. Only `code` strings are held to this; text
 * and the reader-facing attributes count at any length, because "Save" is a word a reader meets.
 */
export function readsAsProse(s) {
  const bare = s.split(HOLE).join(" ").trim();
  if ((bare.match(/\p{L}{2,}/gu) ?? []).length < 2) return false;
  if (!/\s/.test(bare)) return false;
  if (/:\/\/|^[./~]|^#|\.(?:mjs|js|ts|tsx|css|json|html|md|svg|png)\b/.test(bare)) return false;
  if (/;\s*$|\b\d+(?:px|rem|em|vh|vw|ms)\b|\bvar\(--|\brgba?\(|^@media\b/.test(bare)) return false;
  const words = bare.split(/\s+/);
  if (words.every((w) => /^[a-z0-9]+(?:[-_:][a-z0-9]+)*$/.test(w)) && words.some((w) => /[-_:]/.test(w))) return false;
  if (/^[a-z]+\/[a-z0-9.+-]+$/i.test(bare)) return false;                      // a media type
  return true;
}

const keyName = (k) => (k?.type === "Identifier" ? k.name : k?.type === "Literal" ? String(k.value) : null);
const attrName = (n) => (n?.type === "JSXNamespacedName" ? `${n.namespace.name}:${n.name.name}` : n?.name);
const isStr = (n) => n?.type === "Literal" && typeof n.value === "string";

/** A string-valued expression as the reader would see it, holes marked, or null if it is not one. */
function compose(n) {
  if (!n) return null;
  if (isStr(n)) return n.value;
  if (n.type === "TemplateLiteral") {
    return n.quasis.map((q, i) => q.value.cooked + (i < n.expressions.length ? HOLE : "")).join("");
  }
  if (n.type === "BinaryExpression" && n.operator === "+") {
    const l = compose(n.left), r = compose(n.right);
    if (l == null && r == null) return null;
    return (l ?? HOLE) + (r ?? HOLE);
  }
  if (n.type === "TSAsExpression" || n.type === "TSSatisfiesExpression" || n.type === "TSNonNullExpression"
    || n.type === "ParenthesizedExpression") return compose(n.expression);
  return null;
}

/** Every string an expression can evaluate to through ?:, && and ||, for a slot a reader meets. */
function outcomes(n, out = []) {
  if (!n) return out;
  const s = compose(n);
  if (s != null) { out.push([n, s]); return out; }
  if (n.type === "ConditionalExpression") { outcomes(n.consequent, out); outcomes(n.alternate, out); }
  else if (n.type === "LogicalExpression") { outcomes(n.left, out); outcomes(n.right, out); }
  else if (n.type === "ParenthesizedExpression" || n.type === "TSAsExpression") outcomes(n.expression, out);
  return out;
}

const SKIP_TYPES = new Set(["ImportDeclaration", "ExportAllDeclaration", "TSTypeAnnotation", "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration", "TSTypeParameterInstantiation", "TSTypeParameterDeclaration", "TSDeclareFunction",
  "TSModuleDeclaration", "TSImportType", "TSEnumDeclaration"]);

/** Every reader-facing string in one source text. `file` is only carried into the rows. */
export function stringsIn(source, file) {
  const lang = file.endsWith(".tsx") ? "tsx" : file.endsWith(".ts") ? "ts" : file.endsWith(".jsx") ? "jsx" : "js";
  const ast = parser()(source, { lang });
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) if (source[i] === "\n") starts.push(i + 1);
  const lineOf = (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= off) lo = m; else hi = m - 1; } return lo + 1; };
  const rows = [];
  let where = null;
  const add = (node, kind, raw) => {
    const text = tidy(kind === "text" || node.jsxAttr ? decode(raw) : raw);
    // FEWER THAN TWO LETTERS IS NOT A STRING A READER MEETS ON ITS OWN: it is the `s` a plural picks.
    if (letters(text).length < 2) return;
    if (kind === "code" && !readsAsProse(text)) return;
    if (kind !== "text" && kind !== "code" && token(text)) return;
    rows.push({ file, line: lineOf(node.start), kind, text, where });
  };
  const addOutcomes = (expr, kind) => { for (const [n, s] of outcomes(expr)) add(n, kind, s); };

  function children(kids) {
    let run = [], at = null;
    const flush = () => { if (run.length) add({ start: at }, "text", run.join("")); run = []; at = null; };
    const into = (list) => {
      for (const c of list) {
        if (c.type === "JSXText") { at ??= c.start; run.push(decode(jsxText(c.value))); continue; }
        if (c.type === "JSXExpressionContainer") {
          if (c.expression.type === "JSXEmptyExpression") continue;
          const s = compose(c.expression);
          at ??= c.start;
          if (s != null) { run.push(s); visitNonString(c.expression); continue; }
          run.push(HOLE);
          // A value in the middle of a sentence can itself be a choice of words: `{busy ? 'Saving' : 'Save'}`.
          for (const [n, v] of outcomes(c.expression)) add(n, "text", v);
          visitNonString(c.expression);
          continue;
        }
        if (c.type === "JSXElement" && c.openingElement.name.type === "JSXIdentifier" && INLINE.has(c.openingElement.name.name)) {
          for (const a of c.openingElement.attributes) visit(a);
          if (c.openingElement.name.name === "br") { run.push(" "); continue; }
          at ??= c.start;
          into(c.children);
          continue;
        }
        flush();
        visit(c);
      }
    };
    into(kids);
    flush();
  }

  function visit(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) visit(x); return; }
    if (typeof n.type !== "string") return;
    if (SKIP_TYPES.has(n.type)) return;
    switch (n.type) {
      case "ExportNamedDeclaration": visit(n.declaration); return;
      case "TSAsExpression": case "TSSatisfiesExpression": case "TSNonNullExpression": visit(n.expression); return;
      case "JSXElement": visit(n.openingElement.attributes); children(n.children); return;
      case "JSXFragment": children(n.children); return;
      case "JSXAttribute": {
        const name = attrName(n.name);
        if (!n.value || MACHINE.has(name) || /^data-/.test(name)) return;
        const expr = n.value.type === "JSXExpressionContainer" ? n.value.expression : n.value;
        if (expr === n.value && isStr(expr)) expr.jsxAttr = true;
        if (READ.has(name)) { addOutcomes(expr, `attr:${name}`); visitNonString(expr); return; }
        visit(expr);
        return;
      }
      case "Property": {
        const k = keyName(n.key);
        if (k != null && MACHINE.has(k)) return;
        if (n.computed) visit(n.key);
        if (k != null && READ.has(k)) { addOutcomes(n.value, `prop:${k}`); visitNonString(n.value); return; }
        visit(n.value);
        return;
      }
      case "BinaryExpression": {
        if (COMPARE.has(n.operator)) { if (!isStr(n.left)) visit(n.left); if (!isStr(n.right)) visit(n.right); return; }
        const s = compose(n);
        if (s != null) { add(n, "code", s); visitNonString(n.left); visitNonString(n.right); return; }
        break;
      }
      case "SwitchCase": visit(n.consequent); return;
      case "MemberExpression": visit(n.object); if (n.computed && !isStr(n.property)) visit(n.property); return;
      case "CallExpression": case "NewExpression": {
        const c = n.callee;
        const name = c?.type === "Identifier" ? c.name : c?.type === "MemberExpression" ? keyName(c.property) : null;
        visit(c);
        if (name && TOKEN_CALLS.has(name)) { for (const a of n.arguments) if (!isStr(a) && a.type !== "TemplateLiteral") visit(a); return; }
        visit(n.arguments);
        return;
      }
      case "TaggedTemplateExpression": return;
      case "Literal": if (typeof n.value === "string") add(n, "code", n.value); return;
      case "TemplateLiteral": add(n, "code", compose(n)); visit(n.expressions); return;
      default: break;
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === "type" || k === "start" || k === "end" || k === "range" || k === "loc") continue;
      if (v && typeof v === "object") visit(v);
    }
  }
  /** Visit what is not itself a string: the literals were already read as a whole. */
  function visitNonString(x) {
    if (!x || compose(x) != null && x.type !== "TemplateLiteral" && x.type !== "BinaryExpression") return;
    if (x.type === "TemplateLiteral") { visit(x.expressions); return; }
    if (x.type === "BinaryExpression" && x.operator === "+") { visitNonString(x.left); visitNonString(x.right); return; }
    if (x.type === "ConditionalExpression") { visit(x.test); visitNonString(x.consequent); visitNonString(x.alternate); return; }
    if (x.type === "LogicalExpression") { visitNonString(x.left); visitNonString(x.right); return; }
    visit(x);
  }

  // WHERE each string sits: the top-level declaration that holds it, so a table of reference data
  // (`COUNTRIES`, `NICE_CLASSES`) can be told apart from a sentence without guessing from its shape.
  const declName = (st) => {
    const d = st.type === "ExportNamedDeclaration" || st.type === "ExportDefaultDeclaration" ? st.declaration : st;
    if (!d) return null;
    if (d.type === "VariableDeclaration") return d.declarations.map((x) => x.id?.name).filter(Boolean).join(",") || null;
    return d.id?.name ?? null;
  };
  for (const st of ast.body) { where = declName(st); visit(st); }
  const seen = new Set();
  return rows.filter((r) => { const k = `${r.kind}\t${r.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The portal's source files, excluding type declarations. Sorted, so two runs print the same order. */
export function sourceFiles(root = ROOT) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
    }
  };
  walk(join(root, SOURCE));
  return out.map((p) => relative(root, p));
}

/** Every reader-facing string in the portal source. */
export function portalStrings(root = ROOT) {
  return sourceFiles(root).flatMap((f) => stringsIn(readFileSync(join(root, f), "utf8"), f));
}

// ── THE PAGES THE PORTAL SERVER BUILDS ITSELF ───────────────────────────────────────────────────────
//
// The sign-in page is not a React screen. `loginPage()` in driver/portal-service.mjs builds it on the
// server as HTML inside template literals, with more HTML in the conditional values, so the reader above
// never saw it, and a changed sentence on it passed the check. It is read AS SERVED: the page is rendered
// in each state the server can send (signed out, signed in, a session set aside, an error), and the
// sentences are read out of the HTML the way a browser shows them. The product's name therefore arrives
// as the name, which is how the approved list writes it.
//
// Every value the page is handed arrives as a marker and is shown as `{…}`, and so does anything in
// `<code>`: a command is not a sentence, and the approved list writes one as a hole. The error sentences
// are the handler's own literals, passed in at its call sites, so they are read from there, each with its
// own line.
export const SERVER_PAGES = "driver/portal-service.mjs";

/** The character a value handed to the page arrives as. Private use: never written by the page itself. */
const SLOT = "";

/** Attributes a reader meets on a server-built page. */
const HTML_READ = ["title", "aria-label", "placeholder", "alt"];

/**
 * The sentences a reader meets on one served HTML page: the text of each block, inline elements joined in,
 * and the reader-facing attributes. `{kind, text}` rows, in page order.
 */
export function htmlSentences(html) {
  const rows = [];
  const clean = (s) => decode(s).split(SLOT).join(HOLE).replace(/\s+/g, " ").trim();
  const push = (kind, s) => { const text = clean(s); if (/\p{L}/u.test(text.split(HOLE).join(""))) rows.push({ kind, text }); };
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (title) push("title", title[1]);
  // STRIPPED UNTIL NOTHING CHANGES. One pass over `<scr<script>…</script>ipt>` removes the inner element
  // and joins the outer one back together, so the page would still carry a `<script` it then read as text.
  let body = html;
  for (let before = null; before !== body;) {
    before = body;
    body = body.replace(/<head>[\s\S]*?<\/head>/gi, "").replace(/<(style|script|svg)\b[\s\S]*?<\/\1\s*>/gi, "");
  }
  body = body.replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, SLOT);
  let text = "";
  for (const part of body.split(/(<[^>]+>)/)) {
    if (!part.startsWith("<")) { text += part; continue; }
    for (const a of HTML_READ) {
      const m = new RegExp(`\\s${a}="([^"]*)"`, "i").exec(part);
      if (m) push(`attr:${a}`, m[1]);
    }
    const name = /^<\/?\s*([a-z0-9-]+)/i.exec(part)?.[1]?.toLowerCase();
    if (name && INLINE.has(name)) continue;
    push("text", text);
    text = "";
  }
  push("text", text);
  return rows;
}

/** The error sentences the handler passes to `loginPage`, each with the line of its literal. */
export function loginErrors(src) {
  const lineOf = (i) => src.slice(0, i).split("\n").length;
  const out = [];
  for (const m of src.matchAll(/loginPage\(\{[^\n]*?\berror:\s*("(?:[^"\\]|\\.)*"|[A-Z_][A-Z0-9_]*)/g)) {
    const at = m.index + m[0].length - m[1].length;
    if (m[1].startsWith('"')) { out.push({ text: JSON.parse(m[1]), line: lineOf(at) }); continue; }
    const def = new RegExp(`const ${m[1]} = ("(?:[^"\\\\]|\\\\.)*");`).exec(src);
    // COULD NOT LOOK, never a skip: an error handed over by a name this cannot resolve is a sentence a
    // reader meets that nothing would check.
    if (!def) throw new Error(`${SERVER_PAGES}: the sign-in error ${m[1]} is not a string constant this reader can resolve`);
    out.push({ text: JSON.parse(def[1]), line: lineOf(def.index + def[0].indexOf('"')) });
  }
  return out;
}

/**
 * The line where `text` is written inside `src[from, to)`, from its longest literal fragment, or `fallback`.
 * A sentence is split at its values, at the product's name and at sentence ends, since markup can sit
 * between any two of those in the source.
 */
function lineIn(src, text, from, to, fallback) {
  const body = src.slice(0, to);
  const frags = text.split(HOLE).flatMap((f) => f.split(/Clearotron/)).flatMap((f) => f.split(/(?<=[.?!])\s+/))
    .map((f) => f.trim()).filter((f) => /\p{L}/u.test(f)).sort((a, b) => b.length - a.length);
  for (const f of frags) {
    const i = body.indexOf(f, from);
    if (i >= 0) return src.slice(0, i).split("\n").length;
  }
  return fallback;
}

/**
 * Every reader-facing string on the pages the portal server builds: the sign-in page, in every state it
 * is served in. Empty for a tree that carries no portal server (a fixture with only screens).
 */
export async function serverPageStrings(root = ROOT) {
  const path = join(root, SERVER_PAGES);
  if (!existsSync(path)) return [];
  const src = readFileSync(path, "utf8");
  const { loginPage } = await import(pathToFileURL(path).href);
  if (typeof loginPage !== "function") throw new Error(`${SERVER_PAGES} no longer exports loginPage — the sign-in page could not be read`);
  const start = src.indexOf("export function loginPage(");
  const startLine = src.slice(0, start).split("\n").length;
  const end = src.indexOf("\n}\n", start);
  const seen = new Set();
  const rows = [];
  const add = (r) => { const k = `${r.kind}\t${r.text}`; if (!seen.has(k)) { seen.add(k); rows.push({ file: SERVER_PAGES, ...r }); } };
  for (const state of [
    { email: SLOT, resetCommand: SLOT },
    { email: SLOT, resetCommand: SLOT, discarded: true },
    { email: SLOT, resetCommand: SLOT, error: SLOT },
    { email: SLOT, signedIn: true },
  ]) {
    for (const r of htmlSentences(loginPage(state))) add({ line: lineIn(src, r.text, start, end, startLine), ...r });
  }
  for (const e of loginErrors(src)) add({ line: e.line, kind: "text", text: e.text.replace(/\s+/g, " ").trim() });
  return rows;
}

/** Every reader-facing string the portal can show: its screens, and the pages its server builds. */
export async function allPortalStrings(root = ROOT) {
  return [...portalStrings(root), ...(await serverPageStrings(root))];
}

// ── THE CHECK: EVERY STRING ON A SCREEN IS APPROVED, OR IN A BACKLOG THAT ONLY SHRINKS ─────────────
//
//   node scripts/portal-strings.mjs --check <approved.json>
//   node scripts/portal-strings.mjs --backlog-shrinks --base <ref>
//
// Every sentence a client reads is copied from an approved design, never written by whoever builds the
// screen. Two lists decide it:
//
//   approved   string → the board or specification that carries it. It lives OUTSIDE this repository,
//              beside the designs it is checked against, so a string cannot be approved by the change
//              that adds it.
//   backlog    `portal-ui/strings-backlog.json`, committed HERE: what was on a screen without approval
//              when the check arrived, each with its class. It may lose lines and may not gain them.
//
// `--check` refuses a string on a screen that is in neither, by file, line and string, and names every
// backlog line no screen shows any more so it can be deleted. Matching is exact once whitespace is
// collapsed: a changed word is a new string. `--backlog-shrinks` refuses a backlog line the base did
// not have, which is how the backlog is held to falling rather than trusted to.
//
// Exit 0 clean, 1 on a refusal, 2 when a list could not be read. An empty approved list is could-not-
// look: it would refuse nothing it had not been told about.

export const BACKLOG = "portal-ui/strings-backlog.json";

const mapOf = (o) => new Map(Object.entries(o).map(([k, v]) => [tidy(k), v]));

/** The approved list, or throw saying why it cannot be used. */
export function readApproved(path) {
  let j;
  try { j = JSON.parse(readFileSync(path, "utf8")); } catch (e) { throw new Error(`cannot read ${path}: ${e.message}`); }
  const approved = j?.approved;
  if (!approved || typeof approved !== "object" || Array.isArray(approved) || !Object.keys(approved).length) {
    throw new Error(`${path} carries no \`approved\` map of strings — a list that approves nothing checks nothing`);
  }
  return mapOf(approved);
}

/** The committed backlog as a map of string → class, from a file's text. */
export function backlogFrom(text, where) {
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error(`cannot read ${where}: ${e.message}`); }
  if (!j?.backlog || typeof j.backlog !== "object" || Array.isArray(j.backlog)) throw new Error(`${where} carries no \`backlog\` map`);
  return mapOf(j.backlog);
}

/** The strings in `rows` that neither list carries, and the backlog lines no screen shows any more. */
export function checkStrings(rows, { approved, backlog }) {
  const refused = rows.filter((r) => !approved.has(r.text) && !backlog.has(r.text));
  const onScreen = new Set(rows.map((r) => r.text));
  const gone = [...backlog.keys()].filter((k) => !onScreen.has(k));
  return { refused, gone };
}

async function check(path, root) {
  let approved, backlog;
  try {
    approved = readApproved(path);
    backlog = backlogFrom(readFileSync(join(root, BACKLOG), "utf8"), BACKLOG);
  } catch (e) {
    console.error(`portal-strings: COULD NOT LOOK — ${e.message}. This is not a pass.`);
    return 2;
  }
  let rows;
  try { rows = await allPortalStrings(root); }
  catch (e) { console.error(`portal-strings: COULD NOT LOOK — ${e.message}. This is not a pass.`); return 2; }
  const { refused, gone } = checkStrings(rows, { approved, backlog });
  console.log(`portal-strings: ${rows.length} strings on the portal's screens and server-built pages; ${approved.size} approved in ${path}, `
    + `${backlog.size} in the backlog`);
  if (gone.length) {
    console.log(`portal-strings: ${gone.length} backlog line(s) no screen shows any more — delete them from ${BACKLOG}:`);
    for (const k of gone) console.log(`  ${JSON.stringify(k)}`);
  }
  if (!refused.length) { console.log("portal-strings: every string on a screen is approved or in the backlog."); return 0; }
  console.error(`portal-strings: ${refused.length} string(s) on a screen that no board or specification approves:`);
  for (const r of refused) console.error(`  ${r.file}:${r.line}  ${r.kind}  ${JSON.stringify(r.text)}`);
  console.error("A client reads these. Copy the wording from its board or specification and add the string to the "
    + "approved list with the board that carries it. If no board carries it, it is a design question, not a code one; "
    + "the backlog does not take new lines.");
  return 1;
}

/** Backlog lines present now and absent at `base`. A base with no backlog is the one that introduces it. */
export function backlogGrowth(root, base, { run = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) } = {}) {
  const now = backlogFrom(readFileSync(join(root, BACKLOG), "utf8"), BACKLOG);
  let before;
  try { before = run(["show", `${base}:${BACKLOG}`]); } catch (e) {
    if (/does not exist|exists on disk, but not in/.test(`${e.stderr ?? ""}${e.message}`)) return { introduced: true, added: [] };
    throw new Error(`cannot read ${BACKLOG} at ${base}: ${String(e.stderr || e.message).trim().split("\n")[0]}`);
  }
  const prior = backlogFrom(before, `${base}:${BACKLOG}`);
  return { introduced: false, added: [...now.keys()].filter((k) => !prior.has(k)), size: { before: prior.size, now: now.size } };
}

function shrinks(base, root) {
  let g;
  try { g = backlogGrowth(root, base); } catch (e) { console.error(`portal-strings: COULD NOT LOOK — ${e.message}. This is not a pass.`); return 2; }
  if (g.introduced) { console.log(`portal-strings: ${base} has no ${BACKLOG}; this change introduces it.`); return 0; }
  console.log(`portal-strings: backlog ${g.size.before} line(s) at ${base}, ${g.size.now} now.`);
  if (!g.added.length) return 0;
  console.error(`portal-strings: ${g.added.length} line(s) added to ${BACKLOG}. It only shrinks: a string new to a screen `
    + "goes on the approved list with the board behind it, or does not ship.");
  for (const k of g.added) console.error(`  ${JSON.stringify(k)}`);
  return 1;
}

if (isEntrypoint(import.meta.url)) {
  const argAt = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
  const root = argAt("--root") ?? ROOT;
  if (process.argv.includes("--check")) {
    const path = argAt("--check");
    if (!path || path.startsWith("--")) { console.error("portal-strings: --check needs the path of the approved list. COULD NOT LOOK."); process.exit(2); }
    process.exit(await check(path, root));
  }
  if (process.argv.includes("--backlog-shrinks")) {
    const base = argAt("--base");
    if (!base || base.startsWith("--")) { console.error("portal-strings: --backlog-shrinks needs --base <ref>. COULD NOT LOOK."); process.exit(2); }
    process.exit(shrinks(base, root));
  }
  const rows = await allPortalStrings(root);
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 1));
  else for (const r of rows) console.log([r.file, r.line, r.kind, r.text].join("\t"));
}
