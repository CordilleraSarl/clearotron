// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real setup wizard in a terminal five times, with stand-in programs only
//
// A CANCELLED SETUP SAYS WHAT STAYS ON THE MACHINE.
//
// Measured on a stranger install of 0.5.1-beta.0, 2026-11-07: Ctrl-C in setup printed "setup: cancelled.
// Nothing was written." By then setup had put its own copy under `~/.local`, and, after a yes, the AI's
// program into the engines folder. A test turn also leaves the AI program's own files. The settings file is
// only ever written at the end, so "No settings were written" is true; the rest of the line now names what
// stays, in the owner's words. "Nothing was written." is kept for
// the cancel where it is still true.
//
// DRIVEN AS A READER MEETS IT: the real wizard, in a terminal of its own (Python's `pty`, since Node has
// none), in a home of its own, on a PATH holding only stand-ins and the system's tools. Ctrl-C is the byte
// a terminal sends, so the cancel takes the path a reader's does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cancelledLine } from "../../bin/onboard.mjs";
import { ownVersion } from "../../shared/permanent-install.mjs";
import { ENGINE_BINARIES } from "../driver.config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ONBOARD = join(HERE, "..", "..", "bin", "onboard.mjs");
const MOCK = join(HERE, "mock-claude.mjs");
const CLAUDE = ENGINE_BINARIES["anthropic-agent"];
const SKIP = (process.platform === "win32" && "a terminal is driven through Python's pty, which Windows lacks")
  || (spawnSync("python3", ["--version"]).status !== 0 && "python3 is not on this machine, and it drives the terminal");

test("the cancel line names what setup left, in the owner's words", () => {
  const copy = { version: "0.5.1-beta.1", prefix: "/home/r/.local" };
  const engine = { vendor: "Anthropic", dir: "/home/r/.local/share/clearotron/engines" };
  assert.equal(cancelledLine({}), "cancelled. Nothing was written.");
  assert.equal(cancelledLine({ turnRan: true }), "cancelled. Clearotron wrote nothing; the AI program's test turn keeps its own files.");
  assert.equal(cancelledLine({ copy }), "cancelled. No settings were written. clearotron 0.5.1-beta.1 stays installed in /home/r/.local.");
  assert.equal(cancelledLine({ engine }), "cancelled. No settings were written. Anthropic's CLI stays installed in /home/r/.local/share/clearotron/engines.");
  assert.equal(cancelledLine({ copy, engine }), "cancelled. No settings were written. clearotron 0.5.1-beta.1 stays installed in /home/r/.local, and Anthropic's CLI in /home/r/.local/share/clearotron/engines.");
  assert.equal(cancelledLine({ copy, engine, turnRan: true }), "cancelled. No settings were written. clearotron 0.5.1-beta.1 stays installed in /home/r/.local, and Anthropic's CLI in /home/r/.local/share/clearotron/engines. The AI program's test turn keeps its own files.");
});

// The terminal: spawn the command on a pty, wait for each pattern in what it printed since the last one, send
// the answer, and print everything it wrote, colour codes taken out, then its exit code.
const DRIVE = String.raw`
import fcntl, json, os, pty, re, select, struct, sys, termios, time
cmd, steps, env = (json.loads(a) for a in sys.argv[1:4])
pid, fd = pty.fork()
if pid == 0:
    os.execve(cmd[0], cmd, env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')
buf, seen, alive = b'', 0, True
def text(): return ANSI.sub('', buf.decode('utf-8', 'replace'))
def pump(t):
    global buf
    if not select.select([fd], [], [], t)[0]: return True
    try: d = os.read(fd, 65536)
    except OSError: return False
    buf += d
    return bool(d)
for pat, send in steps:
    end, m = time.time() + 90, None
    while alive and time.time() < end:
        m = re.compile(pat).search(text(), seen)
        if m: break
        alive = pump(0.2)
    if not m:
        os.kill(pid, 9); os.waitpid(pid, 0)
        sys.stdout.write(text() + '\n__TIMEOUT__ waiting for %r\n' % pat); sys.exit(3)
    seen = m.end(); time.sleep(0.3); os.write(fd, send.encode())
end = time.time() + 90
while alive and time.time() < end: alive = pump(0.2)
st = os.waitpid(pid, 0)[1]
sys.stdout.write(text() + '\n__EXIT__ %d\n' % os.waitstatus_to_exitcode(st))
`;
const MENU = "1-\\d+ \\[\\d+\\] $";        // a numbered question, as `choose` asks it
const ANY = "\\[[^\\]]*\\] $";             // whatever question comes next
const CTRL_C = "\u0003";

/**
 * A machine of its own: a home, an empty engines folder, and a PATH of stand-ins. `claude: true` puts a
 * stand-in Claude program on PATH; otherwise a stand-in `npm` installs one into the engines folder the way
 * npm lays a package out, so setup finds the copy it installed.
 */
function machine({ claude = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "setup-cancel-"));
  const engines = join(home, "engines");
  const bin = join(home, "programs");
  mkdirSync(engines);
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "node"));
  const program = `#!/bin/sh\nexec "${process.execPath}" "${MOCK}" "$@"\n`;
  if (claude) {
    writeFileSync(join(bin, CLAUDE.fallback), program);
    chmodSync(join(bin, CLAUDE.fallback), 0o755);
  } else {
    const pkg = JSON.stringify({ name: CLAUDE.package, version: CLAUDE.floor, bin: { [CLAUDE.fallback]: "cli.js" } });
    writeFileSync(join(bin, "npm"), [
      "#!/bin/sh",
      'prefix=""; while [ $# -gt 0 ]; do [ "$1" = "--prefix" ] && prefix="$2"; shift; done',
      `d="$prefix/node_modules/${CLAUDE.package}"; mkdir -p "$d"`,
      `printf '%s' '${pkg}' > "$d/package.json"`,
      `cat > "$d/cli.js" <<'PROGRAM'\n${program}PROGRAM`,
      'chmod 755 "$d/cli.js"',
    ].join("\n") + "\n");
    chmodSync(join(bin, "npm"), 0o755);
  }
  return {
    home, engines,
    setup: (steps, extra = {}) => {
      const env = { HOME: home, USERPROFILE: home, PATH: `${bin}:/usr/bin:/bin`, TERM: "xterm",
        CLEAROTRON_ENGINES_DIR: engines, ...extra };
      const r = spawnSync("python3", ["-I", "-c", DRIVE, JSON.stringify([process.execPath, ONBOARD]),
        JSON.stringify(steps), JSON.stringify(env)], { encoding: "utf8", timeout: 300000 });
      if (r.error || r.status !== 0) throw new Error(`the terminal did not come back (status=${r.status} error=${r.error?.message}):\n${r.stdout}${r.stderr}`);
      return r.stdout;
    },
    done: () => rmSync(home, { recursive: true, force: true }),
  };
}

/** The line setup printed after the cancel, and its exit code. */
const cancelled = (out) => ({ line: /^setup: cancelled\..*$/m.exec(out)?.[0] ?? null, exit: /__EXIT__ (\d+)/.exec(out)?.[1] });

test("cancelled at the first question, with nothing installed and no turn, setup still says nothing was written", { skip: SKIP }, () => {
  const m = machine();
  try {
    const out = m.setup([[MENU, CTRL_C]]);
    assert.deepEqual(cancelled(out), { line: "setup: cancelled. Nothing was written.", exit: "2" }, out);
  } finally { m.done(); }
});

test("run from the copy setup installed from npx, a cancel names that copy and where it is", { skip: SKIP }, () => {
  const m = machine();
  try {
    const out = m.setup([[MENU, CTRL_C]], { CLEAROTRON_RELOCATED: "1" });
    assert.deepEqual(cancelled(out), {
      line: `setup: cancelled. No settings were written. clearotron ${ownVersion()} stays installed in ${join(m.home, ".local")}.`, exit: "2" }, out);
  } finally { m.done(); }
});

test("after setup installed the AI's program, a cancel names the program and its folder", { skip: SKIP }, () => {
  const m = machine();
  try {
    const out = m.setup([[MENU, "1\r"], ["now\\? \\[y/N\\] $", "y\r"], [MENU, CTRL_C]]);
    assert.match(out, /✓ installed: /, `the stand-in npm did not install the program, so this arm proves nothing:\n${out}`);
    assert.deepEqual(cancelled(out), {
      line: `setup: cancelled. No settings were written. ${CLAUDE.vendor}'s CLI stays installed in ${m.engines}.`, exit: "2" }, out);
  } finally { m.done(); }
});

test("after a test turn, with nothing installed, a cancel says the turn's files stay", { skip: SKIP }, () => {
  const m = machine({ claude: true });
  try {
    const out = m.setup([[MENU, "1\r"], [MENU, "\r"], ["\\[Y/n\\] $", "\r"], [ANY, CTRL_C]]);
    assert.match(out, /completed a turn/, `no turn ran, so this arm proves nothing:\n${out}`);
    assert.deepEqual(cancelled(out), {
      line: "setup: cancelled. Clearotron wrote nothing; the AI program's test turn keeps its own files.", exit: "2" }, out);
  } finally { m.done(); }
});

test("with setup's copy, the AI's program and a test turn, a cancel names all three", { skip: SKIP }, () => {
  const m = machine();
  try {
    const out = m.setup([[MENU, "1\r"], ["now\\? \\[y/N\\] $", "y\r"], [MENU, "\r"], ["\\[Y/n\\] $", "\r"], [ANY, CTRL_C]],
      { CLEAROTRON_RELOCATED: "1" });
    assert.match(out, /completed a turn/, `no turn ran, so this arm proves nothing:\n${out}`);
    assert.deepEqual(cancelled(out), {
      line: `setup: cancelled. No settings were written. clearotron ${ownVersion()} stays installed in ${join(m.home, ".local")}, `
        + `and ${CLAUDE.vendor}'s CLI in ${m.engines}. The AI program's test turn keeps its own files.`, exit: "2" }, out);
  } finally { m.done(); }
});
