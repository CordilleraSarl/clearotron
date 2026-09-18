// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// SETUP PROMISES A LOGIN SHELL ONLY WHEN ONE ADDS THE DIRECTORY.
//
// Setup's closing screen said "open a new login shell, and plain `clearotron start` works from anywhere".
// On an outside install as root in a fresh ubuntu:24.04 container, `clearotron` was still not found in a
// new login shell: root's stock profile does not add ~/.local/bin, and neither does macOS's default zsh.
// The line is now printed only when a profile the user's shells read names the directory.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { aLoginShellAdds } from "../../bin/onboard.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const home = "/srv/op";
const dir = "/srv/op/.local/bin";
const profiles = (files) => ({ home, read: (p) => { if (p in files) return files[p]; throw new Error("ENOENT"); } });

test("Ubuntu's stock profile for an ordinary user adds it, in every spelling a profile uses", () => {
  for (const line of [
    'if [ -d "$HOME/.local/bin" ] ; then\n    PATH="$HOME/.local/bin:$PATH"\nfi',
    'export PATH="${HOME}/.local/bin:$PATH"',
    "path+=(~/.local/bin)",
    'export PATH="/srv/op/.local/bin:$PATH"',
  ]) assert.equal(aLoginShellAdds(dir, profiles({ [join(home, ".profile")]: line })), true, line);
  assert.equal(aLoginShellAdds(dir, profiles({ [join(home, ".zprofile")]: 'export PATH="$HOME/.local/bin:$PATH"' })), true,
    "a zsh login profile counts as well");
});

test("no profile, or one that never names it, is not a promise setup may make", () => {
  assert.equal(aLoginShellAdds(dir, profiles({})), false, "a home with no profile at all");
  assert.equal(aLoginShellAdds(dir, profiles({
    [join(home, ".profile")]: '# ~/.profile: executed by Bourne-compatible login shells.\nif [ "$BASH" ]; then\n  if [ -f ~/.bashrc ]; then\n    . ~/.bashrc\n  fi\nfi\nmesg n 2> /dev/null || true',
  })), false, "root's stock profile on ubuntu:24.04 — the reported case");
  assert.equal(aLoginShellAdds(dir, profiles({ [join(home, ".profile")]: 'PATH="$HOME/.local/binaries:$PATH"' })), false,
    "a longer directory that begins with the same name is a different directory");
  for (const off of ['# export PATH="$HOME/.local/bin:$PATH"', '  #PATH="$HOME/.local/bin:$PATH"'])
    assert.equal(aLoginShellAdds(dir, profiles({ [join(home, ".bashrc")]: off })), false, `a commented-out line adds nothing: ${off}`);
  assert.equal(aLoginShellAdds("", profiles({ [join(home, ".profile")]: "anything" })), false);
});

test("both places that made the promise now ask first", () => {
  const src = readFileSync(join(REPO, "bin", "onboard.mjs"), "utf8");
  for (const line of src.split("\n").filter((l) => /open a new login shell/.test(l) && !/^\s*(\/\/|\*)/.test(l)))
    assert.match(line, /aLoginShellAdds\(form\.dir\)/, `printed without asking whether a login shell adds the directory:\n${line.trim()}`);
});
