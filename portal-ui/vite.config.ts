// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The bundle is BUILD OUTPUT, served by portal-service and never committed: `portal-ui/dist` is
// gitignored. It reaches an install two ways. The published package ships it (`portal-ui/dist/` is in
// the root package.json's `files`, and the release job runs `npm run build:ui` before packing), so a
// packaged install needs no build. A source checkout builds it with `npm run build:ui`, and
// `clearotron update` and `clearotron start` rebuild it when it is older than its sources. CI builds it
// from source on every run, so there is no committed copy to fall out of step with `src/`.
//
// The build is still made repeatable: a locked dependency tree, and asset names derived from content
// rather than from build order, so two builds of the same sources give the same files.
export default defineConfig({
  // portal-service mounts the SPA under /portal/, so every asset URL must be absolute from there.
  base: '/portal/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // minify:false is load-bearing twice over, so do not flip it casually.
    //
    // 1. CSP. The pre-paint theme script is inline and admitted by sha256 computed from the source
    //    constant. Minification would rewrite it, the hash would stop matching, and the browser would
    //    block it — a failure whose only symptom is that dark-mode users first-paint light and a CSP
    //    violation lands in a console nobody is watching. `npm run tokens:check` asserts the built
    //    file still carries the script verbatim, so this is caught rather than discovered.
    // 2. Review. The bundle is committed, so it is read as a diff like any other artefact, and a
    //    minified single line makes that review worthless — you cannot see that a stray fetch()
    //    appeared. The cost is bytes over the wire, which Caddy gzips away.
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        // COMMENTS ARE OFF BECAUSE COMMENTARY IS NOT FOR THE CLIENT'S BROWSER.
        //
        // Vite 8 replaced Rollup with Rolldown, and Rolldown PRESERVES source comments where Rollup
        // dropped most of them. Measured on the bump: the shipped JS went 665 kB to 993 kB raw
        // (158 to 226 kB gzip), and its comment lines went 1,444 to 2,522 — carrying internal
        // engineering prose into every client's browser. The firm-reference guard is what caught it:
        // the bundle named the firm in six places against three declared, including a sentence about
        // which paths staff keep. Off, it was 854 kB / 175 kB and 108 comment lines, and the firm
        // mentions were back to the declared three. Measured again on 2026-11-20, with comments still
        // off, Vite reports 1,079 kB / 227 kB gzip for the same file.
        //
        // So this is not a new policy — it RESTORES what the client received under Rollup. A separate
        // arm holds it (the built bundle carries no comment line beyond the licence headers), so a
        // future bundler change cannot quietly start shipping commentary again.
        //
        // ✕ IT IS NOT `minify`, and minify stays false. That flag is load-bearing for the CSP
        // pre-paint hash and is documented above; this touches neither. The hash is computed over the
        // inline script in index.html, not over this bundle, and `npm run tokens:check` still pins it
        // unchanged.
        //
        // The "read as a diff like any other artefact" reason given for minify:false above is
        // currently MOOT on this repository: portal-ui/dist is not tracked here (0 files), so nothing
        // reviews the bundle as a diff. Recorded rather than deleted, because the reasoning becomes
        // live again the moment dist is committed.
        comments: false,
        // Content-hashed names, stable across builds of identical input.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
