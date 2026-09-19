// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CONNECT LINE SAYS WHERE IT RUNS, AND RUNS WHERE IT IS PASTED.
//
// Walked on WSL, 2026-09-11. The "on this computer" lines name Linux paths, so they run in the WSL terminal,
// and nothing said so. The Claude Code line, pasted into PowerShell, failed with "missing required
// argument", because Windows PowerShell 5.1 drops a bare `--`. Run from a directory, it registered the server
// for that directory only. And a demo's line named no workspace, so the connector read the real install's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { connectOffers, WSL_STEP } from "../../shared/connect-clients.mjs";
import { stdioConnectFor, stdioConnectCommand, STDIO_SHAPES, WSL_ROW_HEADINGS } from "../../shared/stdio-connect.mjs";
import { isWsl } from "../../shared/wsl.mjs";

const routes = (o = {}) => Object.fromEntries(Object.keys(STDIO_SHAPES).map((s) => [s, stdioConnectFor(s, { workDir: "/w", ...o })]));

test("on WSL every on-this-computer route opens by saying to run it inside WSL, and no web route does", () => {
  const on = connectOffers({ stdioRoutes: routes(), publicAddress: "https://mcp.example.test", wsl: true }).filter(Boolean);
  const disk = on.filter((o) => o.served && o.route === "disk");
  assert.ok(disk.length >= 3, `too few on-this-computer routes for this to mean anything: ${disk.length}`);
  for (const o of disk) assert.equal(o.steps[0]?.text, WSL_STEP, `${o.client.id} does not open with where to run it`);
  for (const o of on.filter((x) => x.route === "public-http"))
    assert.ok(!o.steps.some((s) => s.text === WSL_STEP), `${o.client.id}'s web route was told to run inside WSL`);
  // THE CONTROL: off WSL, nobody is told about WSL.
  const off = connectOffers({ stdioRoutes: routes(), publicAddress: "https://mcp.example.test", wsl: false }).filter(Boolean);
  assert.ok(!off.some((o) => o.steps.some((s) => s.text === WSL_STEP)), "an install that is not on WSL was told to run inside it");
});

test("WSL is read from WSL_DISTRO_NAME, WSL_INTEROP or the kernel's own name, and a failed read is not WSL", () => {
  assert.equal(isWsl({ env: { WSL_DISTRO_NAME: "Ubuntu" }, procVersion: "" }), true);
  assert.equal(isWsl({ env: { WSL_INTEROP: "/run/WSL/1_interop" }, procVersion: "" }), true);
  assert.equal(isWsl({ env: {}, procVersion: "Linux version 6.6.87.2-standard-WSL2" }), true);
  assert.equal(isWsl({ env: {}, procVersion: "Linux version 6.17.0-1022-azure" }), false);
  assert.equal(isWsl({ env: {}, procVersion: "" }), false);
});

test("the Claude Code line registers for the user, and quotes its separator on Windows", () => {
  const posix = stdioConnectCommand({ workDir: "/w", platform: "linux" });
  assert.match(posix, /^claude mcp add trademark-artifacts --scope user /, "the server would be registered for one directory only");
  assert.match(posix, / -- node \S+server\.mjs$/);
  const win = stdioConnectCommand({ workDir: "C:\\w", platform: "win32" });
  assert.match(win, / "--" node /, "Windows PowerShell 5.1 drops a bare --, and the line fails there");
});

test("every shape carries the reports folder when it is known, and invents none when it is not", () => {
  for (const shape of Object.keys(STDIO_SHAPES)) {
    assert.match(stdioConnectFor(shape, { workDir: "/w", reportsDir: "/p" }).text, /CLEAROTRON_REPORTS_DIR\W+\/p/, `${shape} dropped the reports folder`);
    assert.doesNotMatch(stdioConnectFor(shape, { workDir: "/w" }).text, /CLEAROTRON_REPORTS_DIR/, `${shape} invented a reports folder`);
  }
});

// ── ON WSL THE ROW CROSSES THE BOUNDARY ITSELF ───────────────────────────────────────────────────
//
// The rows named a Linux path and left the reader to run them in the WSL terminal. For somebody whose
// product runs in WSL the assistant on WINDOWS is the normal one, and it read
// `/home/<user>/…/server.mjs` as `C:\home\<user>\…`: MODULE_NOT_FOUND, four times, then "couldn't
// start". The path was right and the interpreter was on the wrong side.
//
// Driven on the composed strings, which is what this box can see. Criterion 4 — the row pasted into
// Claude Desktop and Claude Code on a real Windows machine — is the owner's, and is not claimed here.
test("every on-this-computer shape starts the server INSIDE the distribution when the install is on WSL", async () => {
  const { STDIO_SHAPES, stdioConnectFor } = await import("../../shared/stdio-connect.mjs");
  const wsl = { distro: "Ubuntu" };
  const opts = { installRoot: "/opt/clearotron", workDir: "/srv/clearotron/work", wsl };

  for (const shape of Object.keys(STDIO_SHAPES)) {
    const text = stdioConnectFor(shape, opts).text;
    assert.match(text, /wsl\.exe/, `${shape} still hands a Windows host a Linux interpreter`);
    assert.match(text, /-d[\s",]+Ubuntu/, `${shape} does not name the distribution, so it starts whichever is default`);
    assert.ok(text.includes("/opt/clearotron/mcp-server/server.mjs"), `${shape} lost the server path`);
    // THE ENVIRONMENT HAS TO CROSS. A host on Windows sets variables for the process it starts, which
    // is wsl.exe; they stop at the boundary. Inside the command, `env` sets them where the server reads.
    assert.match(text, /env[\s",]+CLEAROTRON_WORK_DIR=\/srv\/clearotron\/work/, `${shape} sets the work directory where the server will never see it`);
  }
});

test("off WSL every shape is byte-identical to what it always was", () => {
  // THE CONTROL, and the half that says this is a new branch rather than a rewrite: every reader on
  // macOS, Linux and Windows-without-WSL must get exactly the command they got before.
  for (const shape of Object.keys(STDIO_SHAPES)) {
    const text = stdioConnectFor(shape, { installRoot: "/opt/app", workDir: "/w" }).text;
    assert.doesNotMatch(text, /wsl\.exe/, `${shape} wrapped a reader who is not on WSL`);
    assert.match(text, /node/, `${shape} stopped naming the interpreter`);
  }
});

test("the distribution is named when we know it, and left to the default when we do not", async () => {
  const { wslTarget } = await import("../../shared/wsl.mjs");
  const { stdioConnectFor } = await import("../../shared/stdio-connect.mjs");
  // A machine with more than one distribution has a default that may hold no install, so the name
  // travels wherever the environment carries it.
  assert.deepEqual(wslTarget({ env: { WSL_DISTRO_NAME: "Ubuntu" } }), { distro: "Ubuntu" });
  assert.deepEqual(wslTarget({ env: { WSL_INTEROP: "/run/WSL/8_interop" } }), { distro: null },
    "WSL with no name is still WSL — the wrapper is right, the -d is what cannot be guessed");
  assert.equal(wslTarget({ env: {}, procVersion: "Linux 6.17.0-1022-azure", interopEntry: false }), null,
    "a plain Linux box must not be handed a Windows wrapper");

  // NEVER BLANK (owner, 2026-09-19): with no name to read, the name's place carries a placeholder and the
  // Windows side says plainly to fill it in, instead of dropping -d and starting whichever is default.
  const { WSL_DISTRO_PLACEHOLDER, WSL_DISTRO_FILL_IN } = await import("../../shared/stdio-connect.mjs");
  const unnamedOffer = stdioConnectFor("claude-cli", { installRoot: "/opt/clearotron", wsl: { distro: null } });
  assert.match(unnamedOffer.text, new RegExp(`wsl\\.exe -d ${WSL_DISTRO_PLACEHOLDER} -e node`), "with no name, the name's place is left blank");
  assert.equal(unnamedOffer.variants[0].hint, WSL_DISTRO_FILL_IN, "and nothing tells the reader to fill it in");
  assert.match(WSL_DISTRO_FILL_IN, new RegExp(`Replace ${WSL_DISTRO_PLACEHOLDER} with`));
  const named = stdioConnectFor("claude-cli", { installRoot: "/opt/clearotron", wsl: { distro: "Ubuntu" } });
  assert.match(named.text, /wsl\.exe -d Ubuntu -e node/, "the name travels when WSL gives it");
  assert.equal(named.variants[0].hint, null, "a named row needs nothing filled in");
  assert.equal(named.variants[1].hint, undefined, "the inside-WSL row is untouched");
});

test("the WSL step says the install is in WSL and nothing the rows now say — and still invites no bad paste", () => {
  // THREE SPELLINGS THIS STEP HAS HAD, and each was true only while the rows underneath it were what
  // they were. It read "paste it where your assistant lives, on Windows or in the WSL terminal,
  // whichever it is" — an invitation to paste it inside the distribution, where it did not work, and
  // somebody took it and got CONNECTION_CLOSED (measured 2026-09-16 on 0.3.2-beta.1). It then named the
  // Windows side and said an assistant inside WSL could not use the command and should start the server
  // itself — true of one launcher, false the moment the second row existed, and drawn directly above it.
  //
  // What is left is the clause that survives both: the rows name Linux paths, and the reader is told why.
  assert.match(WSL_STEP, /\bWSL\b/, "the step no longer says the install is inside WSL, which is why the rows name Linux paths");

  // THE ORIGINAL DEFECT STAYS REFUSED. This is the claim that sent a reader into a closed connection,
  // and it is refused by name rather than trusted to the arm above.
  assert.doesNotMatch(WSL_STEP, /whichever it is/i, "the step invites a paste on either side again");
  assert.ok(!/on Windows or in the WSL terminal/i.test(WSL_STEP),
    "the step offers both sides for a command that works on one");

  // AND SO DOES THE ONE THAT REPLACED IT. An assistant inside the distribution has a row of its own now;
  // a step telling it to start the server itself contradicts the row two lines below it.
  assert.doesNotMatch(WSL_STEP, /cannot use it|yourself instead/i,
    "the step still refuses an assistant the page now serves");
  // Nor does it speak of ONE command while two are offered.
  assert.doesNotMatch(WSL_STEP, /the command below/i, "the step names a single command where the page draws two");
});
// ── AND UNDER WSL IT IS TWO LINES, EACH HEADED WITH THE SIDE IT IS FOR ───────────────────────────
//
// The Windows-side row is a real fix and half an answer: an assistant running INSIDE the distribution —
// Claude Code in the Ubuntu window, which is where the owner was — needs the plain `node` line, and had
// no row at all. Both sides now ride every on-this-computer route, headed, on the page and in the
// terminal the line was actually read from.
test("under WSL every on-this-computer route offers BOTH sides, each headed, and off WSL neither heading appears", () => {
  const disk = (wsl) => connectOffers({ stdioRoutes: routes(wsl ? { wsl: { distro: "Ubuntu" } } : {}),
    publicAddress: "https://mcp.example.test", wsl }).filter(Boolean).filter((o) => o.served && o.route === "disk");

  const on = disk(true);
  assert.ok(on.length >= 3, `too few on-this-computer routes for this to mean anything: ${on.length}`);
  for (const o of on) {
    const copies = o.steps.filter((s) => s.copy);
    assert.equal(copies.length, 2, `${o.client.id} offers ${copies.length} launcher(s) under WSL, not both sides`);
    assert.deepEqual(copies.map((s) => s.text), [WSL_ROW_HEADINGS.fromWindows, WSL_ROW_HEADINGS.insideWsl],
      `${o.client.id}'s rows do not say which side each command is for`);
    // EACH HEADING OVER ITS OWN SIDE'S COMMAND, not two rows of the same thing — which is what a
    // spread that forgot to swap the text in would produce, headed and wrong.
    assert.match(copies[0].copy.text, /wsl\.exe/, `${o.client.id}'s Windows row does not cross into the distribution`);
    assert.doesNotMatch(copies[1].copy.text, /wsl\.exe/, `${o.client.id}'s inside-WSL row wraps a reader who is already inside`);
    // THE TERMINAL'S OWN FIELDS RIDE THE WINDOWS-SIDE ROW, as they always have.
    assert.equal(o.command, copies[0].copy.text, `${o.client.id}'s command stopped being the row that leads`);
  }

  // THE CONTROL: off WSL there is one row, and neither heading is drawn over it.
  for (const o of disk(false)) {
    assert.equal(o.steps.filter((s) => s.copy).length, 1, `${o.client.id} grew a second launcher off WSL`);
    for (const h of Object.values(WSL_ROW_HEADINGS))
      assert.ok(!o.steps.some((s) => s.text === h), `${o.client.id} heads a row "${h}" on an install that is not on WSL`);
  }
});

test("the inside-WSL launcher IS the plain node line — the one an assistant in the distribution can run", () => {
  const wsl = { distro: "Ubuntu" };
  for (const shape of Object.keys(STDIO_SHAPES)) {
    const both = stdioConnectFor(shape, { installRoot: "/opt/clearotron", workDir: "/w", reportsDir: "/p", wsl });
    const inside = both.variants.find((v) => v.heading === WSL_ROW_HEADINGS.insideWsl)?.text;
    assert.ok(inside, `${shape} offers no inside-WSL launcher`);
    assert.doesNotMatch(inside, /wsl\.exe/, `${shape} hands an assistant already inside the distribution a wrapper into it`);
    // NOT MERELY "no wsl.exe" — the same string an install that is not under WSL at all would be given,
    // which is the one every other arm in this file already covers.
    assert.equal(inside, stdioConnectFor(shape, { installRoot: "/opt/clearotron", workDir: "/w", reportsDir: "/p" }).text,
      `${shape}'s inside-WSL line is composed a second time and has drifted from the plain one`);
    // The environment still has to reach the server: inside the distribution it rides the shape's own
    // idiom rather than the wrapper's `env`, and dropping it is how runs read the wrong workspace.
    assert.match(inside, /CLEAROTRON_WORK_DIR\W+\/w/, `${shape}'s inside-WSL line loses the workspace`);
  }
  // Off WSL there is no pair at all, and `variants: null` says so rather than an empty list.
  assert.equal(stdioConnectFor("claude-cli", { installRoot: "/opt/clearotron" }).variants, null);
});

test("the page and the terminal take the two headings from ONE author, and neither spells them itself", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join } = await import("node:path");
  const ROOT = fileURLToPath(new URL("../../", import.meta.url));
  const read = (f) => readFileSync(join(ROOT, f), "utf8");

  // THE TERMINAL PRINTS THE PAIR. `clearotron demo` and `clearotron start` are where the owner read
  // the line from, so a page-only fix leaves the defect where he actually met it.
  const start = read("bin/start.mjs");
  assert.match(start, /stdioConnectOffer\(\{[^;]*wsl: wslTarget\(\)/, "the terminal asks for a connect line without saying which side it is on");
  assert.match(start, /connect\.variants[\s\S]{0,400}?v\.heading[\s\S]{0,120}?v\.text/, "the terminal no longer prints both sides under their headings");
  // ONE CALL SITE, WHICH IS WHAT MAKES ONE DRIVE COVER TWO VERBS. `clearotron demo` and `clearotron
  // start` print this block from the same place; a second composer call is how one of them keeps
  // printing the old single line while the other is driven green.
  assert.equal(start.match(/stdioConnectOffer\(/g).length, 1,
    "start.mjs composes the connect line in more than one place, so demo and start can print different lines");

  // ONE AUTHOR. The words live in `shared/stdio-connect.mjs` and nowhere else; a surface that spells
  // them itself is a surface that keeps its old wording when the ruling changes.
  for (const f of ["bin/start.mjs", "shared/connect-clients.mjs", "driver/portal-service.mjs", "bin/connect.mjs"]) {
    for (const h of Object.values(WSL_ROW_HEADINGS))
      assert.ok(!read(f).includes(`"${h}"`), `${f} spells the heading "${h}" itself instead of taking it from the composer`);
  }
  const author = read("shared/stdio-connect.mjs");
  for (const h of Object.values(WSL_ROW_HEADINGS))
    assert.equal(author.split(`"${h}"`).length - 1, 1, `"${h}" is written more than once even in the file that owns it`);
});
