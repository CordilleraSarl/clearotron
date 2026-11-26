// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// picture-thumbnail.mjs — a web picture brought down to what its box on the report needs, on this machine.
//
// A site's preview picture is served for a social card, often 1200 pixels wide and hundreds of kilobytes, and the report
// draws it in a box of PICTURE_BOX CSS pixels. Embedded as served, the pictures of two measured clearances grew their
// reports from 316 KB to 3,765 KB and from 267 KB to 686 KB (measured in testing, 2026-11-26). So each picture is decoded
// here, scaled down by averaging every source pixel it covers, kept in proportion, laid on the white its box shows, and
// written as a JPEG. No service and no AI program is asked.
//
// THE BYTES COME FROM ANY SITE. A picture's width and height are read before it is decoded, and one above
// PICTURE_MAX_PIXELS is not decoded at all: a few megabytes can declare a picture that would take gigabytes to hold.
// JPEG, PNG and GIF (its first frame) are decoded. A WebP is not, as the engine ships no WebP decoder: it is kept as
// served only where it is already as small as SERVED_WEBP_MAX_BYTES, and is otherwise not shown. Nothing here throws.
import jpeg from "jpeg-js";
import pngjs from "pngjs";
import omggif from "omggif";
import { imageTypeOf } from "./mark-logos.mjs";

// The box a web picture is drawn in: `.rr-lg img` in the report's stylesheet, 94 by 72, less its padding and border.
export const PICTURE_BOX = Object.freeze({ width: 82, height: 60 });
export const PICTURE_PIXEL_RATIO = 3;              // pixels per CSS pixel: sharp on a phone's screen and on paper
export const PICTURE_MAX_PIXELS = 25_000_000;      // a picture larger than this is not decoded
export const SERVED_WEBP_MAX_BYTES = 48 * 1024;    // a WebP no larger than this is kept as served
const JPEG_QUALITY = 82;

/** The width and height a picture's header declares, without decoding it; null where it cannot be read. PURE. */
export function declaredSize(bytes, type) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (type === "image/png" && b.length >= 24 && b.subarray(12, 16).toString("latin1") === "IHDR") return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (type === "image/gif" && b.length >= 10) return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (type === "image/jpeg") {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      const length = b.readUInt16BE(i + 2);
      // Every start-of-frame marker but the three that are not frames (DHT, JPG, DAC) carries the size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + length;
    }
  }
  return null;
}

function decodeRgba(bytes, type) {
  if (type === "image/jpeg") {
    const img = jpeg.decode(bytes, { formatAsRGBA: true, useTArray: true, maxResolutionInMP: PICTURE_MAX_PIXELS / 1e6, maxMemoryUsageInMB: 512 });
    return { width: img.width, height: img.height, data: img.data };
  }
  if (type === "image/png") { const img = pngjs.PNG.sync.read(bytes); return { width: img.width, height: img.height, data: img.data }; }
  if (type === "image/gif") {
    const gif = new omggif.GifReader(new Uint8Array(bytes));
    const data = new Uint8Array(gif.width * gif.height * 4);
    gif.decodeAndBlitFrameRGBA(0, data);
    return { width: gif.width, height: gif.height, data };
  }
  return null;
}

/** The size a picture is drawn at: within the box at PICTURE_PIXEL_RATIO, in proportion, never enlarged. PURE. */
export function fittedSize(width, height, box = PICTURE_BOX, ratio = PICTURE_PIXEL_RATIO) {
  const scale = Math.min((box.width * ratio) / width, (box.height * ratio) / height, 1);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Each target pixel is the average of the source pixels it covers, a pixel cut by its edge counted by the part inside.
// Run along each row, then down each column. The picture is laid on white first, as its box shows it.
function spans(from, to) {
  const k = from / to, first = new Int32Array(to), count = new Int32Array(to), weights = [];
  for (let d = 0; d < to; d++) {
    const a = d * k, z = (d + 1) * k, lo = Math.floor(a), hi = Math.min(from, Math.ceil(z));
    first[d] = lo; count[d] = hi - lo;
    for (let s = lo; s < hi; s++) weights.push((Math.min(z, s + 1) - Math.max(a, s)) / k);
  }
  return { first, count, weight: Float32Array.from(weights) };
}

function downscaleOnWhite({ width: sw, height: sh, data }, dw, dh) {
  const xs = spans(sw, dw), ys = spans(sh, dh);
  const rgb = new Float32Array(sw * 3);
  const rows = new Float32Array(dw * sh * 3);
  for (let y = 0; y < sh; y++) {
    for (let x = 0, i = y * sw * 4; x < sw; x++, i += 4) {
      const a = data[i + 3] / 255, white = 255 - data[i + 3];
      rgb[x * 3] = data[i] * a + white; rgb[x * 3 + 1] = data[i + 1] * a + white; rgb[x * 3 + 2] = data[i + 2] * a + white;
    }
    for (let x = 0, w = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0;
      for (let s = xs.first[x], n = xs.count[x]; n > 0; s++, n--, w++) { const f = xs.weight[w], j = s * 3; r += rgb[j] * f; g += rgb[j + 1] * f; b += rgb[j + 2] * f; }
      const o = (y * dw + x) * 3; rows[o] = r; rows[o + 1] = g; rows[o + 2] = b;
    }
  }
  const out = new Uint8ClampedArray(dw * dh * 4);   // rounds and clamps each channel as it is written
  for (let y = 0, w = 0; y < dh; y++) {
    const acc = new Float32Array(dw * 3);
    for (let s = ys.first[y], n = ys.count[y]; n > 0; s++, n--, w++) {
      const f = ys.weight[w], base = s * dw * 3;
      for (let j = 0; j < dw * 3; j++) acc[j] += rows[base + j] * f;
    }
    for (let x = 0; x < dw; x++) { const o = (y * dw + x) * 4; out[o] = acc[x * 3]; out[o + 1] = acc[x * 3 + 1]; out[o + 2] = acc[x * 3 + 2]; out[o + 3] = 255; }
  }
  return out;
}

/**
 * The picture as the report embeds it: `{ bytes, contentType, width, height, kept }`, where `kept` is "as served" when the
 * picture already fitted its box and was no larger than a thumbnail of it, and "thumbnail" otherwise; or `{ refused }`
 * with the reason it is not shown. Never throws. PURE.
 */
export function thumbnailOf(bytes) {
  const type = imageTypeOf(bytes)?.type ?? null;
  if (!type) return { refused: "not a PNG, JPEG, GIF or WebP" };
  if (type === "image/webp") {
    return bytes.length <= SERVED_WEBP_MAX_BYTES ? { bytes, contentType: type, width: null, height: null, kept: "as served" }
      : { refused: `a WebP larger than ${SERVED_WEBP_MAX_BYTES / 1024} KB, which is not decoded here` };
  }
  const declared = declaredSize(bytes, type);
  if (!declared || !declared.width || !declared.height) return { refused: "its size cannot be read" };
  if (declared.width * declared.height > PICTURE_MAX_PIXELS) return { refused: `larger than ${PICTURE_MAX_PIXELS / 1e6} million pixels` };
  let img;
  try { img = decodeRgba(bytes, type); } catch (e) { return { refused: `it does not decode: ${String(e?.message ?? e).slice(0, 80)}` }; }
  if (!img?.width || !img?.height) return { refused: "it does not decode" };
  const size = fittedSize(img.width, img.height);
  let out;
  try { out = jpeg.encode({ width: size.width, height: size.height, data: downscaleOnWhite(img, size.width, size.height) }, JPEG_QUALITY).data; }
  catch (e) { return { refused: `it could not be written: ${String(e?.message ?? e).slice(0, 80)}` }; }
  const fits = img.width <= PICTURE_BOX.width * PICTURE_PIXEL_RATIO && img.height <= PICTURE_BOX.height * PICTURE_PIXEL_RATIO;
  if (fits && bytes.length <= out.length) return { bytes, contentType: type, width: img.width, height: img.height, kept: "as served" };
  return { bytes: out, contentType: "image/jpeg", width: size.width, height: size.height, kept: "thumbnail" };
}
