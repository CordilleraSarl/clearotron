// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A clean-room `buffers` — a list of Buffers presented as one contiguous byte range.
//
// WHY THIS EXISTS. `buffers@0.1.1` reaches production through driver → exceljs → unzipper → binary,
// and it carries NO licence: no `license` field, no LICENSE file, no header in its source. An
// unlicensed package is not permissively licensed, it is all-rights-reserved by default, and this
// repository ships AGPL-3.0-only. Nothing about the code is hard; the problem was entirely the paper.
//
// CLEAN-ROOM, AND THAT WORD IS DOING WORK. This was written from the CONSUMER's requirements, not from
// the original's source: `node_modules/binary/index.js` uses exactly five members — `length`, `push`,
// `slice`, `splice` and `indexOf` — and each one's contract is fixed by how binary uses the result.
// The semantics below were derived from those call sites and then verified against the real thing:
//
// The call sites are named by SYMBOL rather than by line, and that is a correction rather than a style
// choice. They were written in the `index.js:<line>` form, which READS as a citation of a file in this
// tree and is not one — the consumer is the `binary` package, whose line numbers move with its version.
// A second tracked `index.js` made the reference ambiguous, so the citation checker reported it and did
// not fail it; the day that other file was deleted the same citation resolved HERE and overran this
// file's length. It was wrong the whole time and only became visible when the ambiguity went.
//
//   buffers.length                 total bytes across the list          binary: the chunk-accounting in tap()
//   buffers.push(buf)              append                               binary: the stream's data handler
//   buffers.slice(i, j)            a Buffer COPY of [i, j), non-destructive   binary: getBytes / peek
//   buffers.splice(0, n)           removes [0, n) and returns a Buffers, because
//                                  binary then calls `.slice()` on the result binary: getBytes
//   buffers.indexOf(needle, from)  byte-sequence search, -1 when absent  binary: scan
//
// `splice` returning a Buffers rather than a Buffer is the one that a plausible-looking implementation
// gets wrong: `buf = buffers.splice(0, bytes); buf = buf.slice();` at binary/index.js:59-61 throws on a
// plain Buffer only for some inputs, so the mistake survives a smoke test and fails on real data.
//
// Substituted by an `overrides` entry in the root package.json, so `buffers` leaves the dependency tree
// rather than being shadowed. `npm ls buffers` is the check.

"use strict";

function Buffers(bufs) {
  if (!(this instanceof Buffers)) return new Buffers(bufs);
  this.buffers = Array.isArray(bufs) ? bufs.slice() : bufs ? [bufs] : [];
  this.length = this.buffers.reduce((n, b) => n + b.length, 0);
}

// Array.push semantics, and it REFUSES a non-Buffer rather than corrupting `length` silently — a bad
// push otherwise shows up much later as a short read with no explanation.
Buffers.prototype.push = function push() {
  for (let i = 0; i < arguments.length; i++) {
    const b = arguments[i];
    if (!Buffer.isBuffer(b)) throw new TypeError("Tried to push a non-Buffer onto a Buffers");
    if (b.length === 0) continue;
    this.buffers.push(b);
    this.length += b.length;
  }
  return this.length;
};

Buffers.prototype.unshift = function unshift() {
  for (let i = arguments.length - 1; i >= 0; i--) {
    const b = arguments[i];
    if (!Buffer.isBuffer(b)) throw new TypeError("Tried to unshift a non-Buffer onto a Buffers");
    if (b.length === 0) continue;
    this.buffers.unshift(b);
    this.length += b.length;
  }
  return this.length;
};

// A COPY, deliberately. binary hands the result to a caller that keeps it while the stream moves on;
// a view over buffers this list is about to splice away would read as corruption later, far from here.
Buffers.prototype.slice = function slice(i, j) {
  const len = this.length;
  if (i === undefined || i === null) i = 0;
  if (j === undefined || j === null) j = len;
  if (i < 0) i = Math.max(len + i, 0);
  if (j < 0) j = Math.max(len + j, 0);
  if (j > len) j = len;
  if (i > len) i = len;
  if (j <= i) return Buffer.alloc(0);

  const out = Buffer.alloc(j - i);
  let written = 0;
  let pos = 0;
  for (const b of this.buffers) {
    const start = pos;
    const end = pos + b.length;
    pos = end;
    if (end <= i) continue;
    if (start >= j) break;
    const from = Math.max(i - start, 0);
    const to = Math.min(j - start, b.length);
    b.copy(out, written, from, to);
    written += to - from;
  }
  return out;
};

// Returns a Buffers, not a Buffer — binary calls `.slice()` on what comes back.
//
// The front case (`splice(0, n)`, the only one binary ever asks for) is done by moving whole buffers
// and sub-arraying at most one of them: no bytes are copied. A general splice would have to rebuild the
// list, which is O(total) per call and turns a streamed read into quadratic work.
Buffers.prototype.splice = function splice(i, howMany) {
  const len = this.length;
  if (i === undefined) i = 0;
  if (i < 0) i = Math.max(len + i, 0);
  if (i > len) i = len;
  if (howMany === undefined) howMany = len - i;
  howMany = Math.max(Math.min(howMany, len - i), 0);
  const replacements = Array.prototype.slice.call(arguments, 2);

  if (i === 0 && replacements.length === 0) {
    const removed = [];
    let need = howMany;
    while (need > 0) {
      const b = this.buffers[0];
      if (b.length <= need) {
        removed.push(b);
        this.buffers.shift();
        need -= b.length;
      } else {
        removed.push(b.subarray(0, need));
        this.buffers[0] = b.subarray(need);
        need = 0;
      }
    }
    this.length -= howMany;
    return new Buffers(removed);
  }

  const removed = this.slice(i, i + howMany);
  const head = this.slice(0, i);
  const tail = this.slice(i + howMany, len);
  this.buffers = [];
  this.length = 0;
  if (head.length) this.push(head);
  for (const r of replacements) this.push(r);
  if (tail.length) this.push(tail);
  return new Buffers(removed.length ? [removed] : []);
};

// Searches the CONCATENATED view, so a needle straddling two buffers is found — which is the whole
// reason this method cannot just be delegated to Buffer.indexOf per buffer. Each buffer is searched
// joined to the first (needle.length - 1) bytes of what follows, and only matches that START in that
// buffer are reported, so no position is returned twice.
Buffers.prototype.indexOf = function indexOf(needle, offset) {
  if (typeof needle === "string") needle = Buffer.from(needle);
  else if (!Buffer.isBuffer(needle)) throw new TypeError("Search must be a string or a Buffer");

  const nlen = needle.length;
  const from = Math.max(Number(offset) || 0, 0);
  if (nlen === 0) return from <= this.length ? from : -1;
  if (nlen > this.length - from) return -1;

  let base = 0;
  for (let bi = 0; bi < this.buffers.length; bi++) {
    const b = this.buffers[bi];
    if (base + b.length <= from) { base += b.length; continue; }

    let window = b;
    let need = nlen - 1;
    const extra = [];
    for (let k = bi + 1; k < this.buffers.length && need > 0; k++) {
      const nb = this.buffers[k];
      const take = Math.min(need, nb.length);
      extra.push(nb.subarray(0, take));
      need -= take;
    }
    if (extra.length) window = Buffer.concat([b, ...extra]);

    const start = Math.max(from - base, 0);
    const hit = window.indexOf(needle, start);
    if (hit !== -1 && hit < b.length) return base + hit;
    base += b.length;
  }
  return -1;
};

Buffers.prototype.toBuffer = function toBuffer() { return this.slice(0, this.length); };
Buffers.prototype.toString = function toString(enc, i, j) { return this.slice(i, j).toString(enc); };
Buffers.prototype.get = function get(i) { return this.slice(i, i + 1)[0]; };

module.exports = Buffers;
module.exports.Buffers = Buffers;
