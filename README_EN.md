<p align="center">
  <img src="assets/hero.svg" alt="dsh-themes hero" width="100%">
</p>

# dsh-themes

English | [中文](README.md)

[![npm version](https://img.shields.io/npm/v/dsh-themes.svg)](https://www.npmjs.com/package/dsh-themes)
[![license](https://img.shields.io/npm/l/dsh-themes.svg)](https://github.com/MangMax/dsh-themes)

A **look & theme** plugin for DSH (DeepSeek Harness): built-in palettes, light / dark / follow-system appearance modes, Open VSX search & install, VS Code theme import, persisted theme library.

> The theme engine (semantic role mapping, dual-seed generation, contrast solving, OKLCH perceptual import mapping) is architecturally inspired by [t3code](https://github.com/pingdotgg/t3code).

![screenshot](assets/screenshot.png)

## Compatibility

<!-- The list below (up to the blockquote) is the single source of truth for compatibility facts:
     versions come from package.json's peerDependencies and dshCompat fields.
     scripts/install.sh generates the packaged README from the same facts and validates this
     section line by line, so editing it requires editing package.json too — otherwise
     `bash scripts/install.sh --pack-only` fails. -->
- Requires DSH `^0.1.5-rc.1 || ^0.2.0-rc.1` (declared through `peerDependencies`, which DSH's plugin compatibility gate evaluates)
- Verified on **0.2.0-rc.2** (current latest), 0.1.7-rc.2, and 0.1.5-rc.2
- Full coverage of the **86 semantic tokens** DSH 0.2.0's UI actually consumes (including `--dsw-alias-state-idle-primary`), so no native DSH colors leak through
- Client toasts use the DSH platform seed-word module `@deepseek-ai/dsh-client-ui-primitives` (nothing extra to install)
- The Host half registers the exact Fetch route `/api/dsh-themes` through `connection.fetch.register`, so DSH's own `/api` prefix route forwards it with the trusted-host fence and browser-session authentication attached
- The old `inject: [webRuntime, webServer]` addition on the `connection` row in a profile's `cordis.patch.yml` is **no longer needed** and can be removed since 0.1.9
- The build-time guard `scripts/check-dsh-compat.mjs` (wired into `pnpm check`) validates the core token set, semantic-token coverage and the `peerDependencies` range so this can't silently drift again

> In detail: the Host half no longer uses `connection.rpc.handle`; it registers the exact Fetch route
> `/api/dsh-themes` through `connection.fetch.register`, so DSH's own `/api` prefix route forwards it
> with the trusted-host fence and browser-session authentication attached — no consumer-side `webServer`
> injection required. Since 0.1.7, `connection.rpc.handle` attaches the route to Connection's own fiber
> (`owner.effect(() => owner.webServer.register(…))`), so a consumer call throws
> `cannot get property "webServer" without inject` — which is why the bullet above holds.

## 0.2.0: import fixes & speedups

This release fixes "importing Tokyo Night reports *contributes no color themes*". The cause was **not** the
extension — it was this plugin's parser:

1. **VS Code themes are JSONC.** All three theme files in `enkia.tokyo-night` contain `//` comments
   (a whole block of commented-out keys from line 87), while the old host used strict `JSON.parse` — all
   three failed, the host returned an empty theme list, and the UI wrongly reported "contributes no color
   themes". Everything now goes through `jsonc-parser`, the same approach
   [t3code](https://github.com/pingdotgg/t3code) takes
   (`parse(text, errors, { allowTrailingComma: true })`): comments, trailing commas and a BOM all parse,
   consistently across the local-scan, URL, paste and VSIX paths.
2. **The light variant was classified dark.** Tokyo Night Light's theme file says `"type": "dark"` (an
   upstream typo); only the extension manifest's `uiTheme: "vs"` is right. Following t3code, the manifest
   `uiTheme` now **overrides** the file's `type`, so the light variant finally lands in the light slot.
3. **Faster imports:**
   - **On-demand unzip** — the bulk of a VSIX is readme / changelog / icons / `.itermcolors`, while theme
     files are always `.json`. `fflate`'s `filter` now inflates only JSON instead of everything.
   - **Compact payloads** — only the 44 workbench color keys the palette mapper actually reads are kept;
     `tokenColors` / `semanticTokenColors` are dropped. Measured on Tokyo Night's three themes:
     **117,679 → 4,412 bytes (-96.25%)** of RPC payload. (Basis of comparison: the summed minified
     `JSON.stringify` of the three theme files — i.e. what a client would receive without compaction.)
   - **One batched detail call** — author/license enrichment after a search went from N RPCs to a single
     `open-vsx-details`.
   - **Search cache + short timeout** — the same query hits an in-memory 60 s cache; a slow Open VSX fails
     after 10 s instead of leaving the UI waiting for 90 s.
4. **Toasts instead of inline text** — success/failure now uses DSH's native `Toast`
   (the `@deepseek-ai/dsh-client-ui-primitives` seed-word module): top-center, slide-in/fade-out built in,
   `z-index: 1100` above every panel. No longer rendered at the bottom of the settings page, where nobody
   could see it.
5. **Animated search** — 350 ms input debounce, Enter searches immediately (IME composition aware), an
   inline spinner in the field, a loading state in the results area, and rows that fade in, all honoring
   `prefers-reduced-motion`.
6. **Regression tests** — `node scripts/e2e-import.mjs` drives the whole pipeline against the real Tokyo
   Night VSIX (52 assertions, including the cold-cache download path that was once missed); `node scripts/check-vs-keys.mjs` keeps the color whitelist covering every key
   the mapper reads.

<!-- npm-readme:start — the region below is extracted into the packaged npm README by scripts/install.sh (keep repo-development content out of it) -->

## Features

- **Theme card model**: each theme has light/dark variant slots aggregating all variants of that side; imported extensions become one theme card
- **Default theme fallback**: the DSH native appearance is itself a selectable theme; deleting the in-use imported theme or clicking "Restore default theme" falls back to it
- **Variant selector**: blended color-ball list (like t3code's ThemePreviewCircle); selected ball enlarges in a fixed slot, overflow arrows navigate, active variants show a selection outline
- **Appearance modes**: system / light / dark; light and dark sides can belong to different themes independently
- **Color editor (second-level page)**: rename, light/dark tabs, grouped token color pickers + hex inputs with instant effect, and "Reset edits"
- **Open VSX search & install**: one-request search (60 s TTL cache, 10 s timeout) with icon/author/license/rating, description inline on cards and details batched into one call; debounced input, inline spinner and fade-in results; one-click import downloads, **unzips on demand**, parses (JSONC + `include` merge) and aggregates, with a versioned cache for instant repeats
- **VS Code import**: local extension scan, URL fetch, paste JSON — all four paths accept **JSONC** (comments / trailing commas / BOM); the manifest `uiTheme` overrides a file's `type` so light variants are no longer misclassified; OKLCH-aware engine derives surfaces, workbench-specified values are contrast-gated
- **Toast feedback**: success / failure reports use DSH's native `Toast` (top-center, animated, above every panel) instead of inline text at the bottom of the page
- **Full token coverage**: all 95 color tokens of the DSH design platform (surface layers bg-layer-1~3 / overlays / masks, label layers primary~caption, interactive feedback, buttons, Markdown, status extras, scrollbars, toast/tooltip, sidebar & menu specifics) follow the theme; the "Edit" editor groups them semantically
- **Settings nav icon**: the "Themes" entry in the settings panel gets a palette icon from the reicon icon set (https://github.com/dqev/reicon)
- **Bilingual UI**: settings copy follows the DSH language preference (**Settings → General → Language**), switching live; persisted theme-library data stays language-neutral and is localized at render time
- **Persistence**: theme library saved to `~/.dsh/dsh-themes.json` and restored on restart
- **Cross-platform (Windows / macOS / Linux)**: networking and local files run entirely inside the host process (global `fetch` + node builtins + `fflate` in-memory unzip) — no dependence on shell commands like curl/mkdir/unzip, so it works under Windows (pwsh) too

<!-- npm-readme:end -->
<!-- end of the region: everything below is repo development / build / CI / release material and is kept out of the packaged npm README -->

## Development

Source is modular **TypeScript** bundled by **VitePlus (`vp`)** into DSH plugin function bodies (see the `pack` block in `vite.config.ts`).

```bash
pnpm install             # deps (vite-plus is declared as a devDependency — no global vp needed)
pnpm build               # vp pack → dist/client/index.cjs & dist/host/index.cjs
pnpm verify              # ★ full gate = build + check + test (what CI and releases run)

pnpm check               # source-level: color-whitelist coverage + locale dictionary parity + DSH compatibility (no build)
pnpm test                # artifact-level: bundle shape + real-VSIX end-to-end (build first)

bash scripts/install.sh              # one-click: build → assemble npm package → install into a DSH profile
bash scripts/install.sh --pack-only  # build & pack only, no install (used by CI releases)
DSH_PLUGIN_PROFILE=desktop bash scripts/install.sh   # install into another profile (default: web)
```

> `scripts/install.sh` prefers `./node_modules/.bin/vp` (CI has no global `vp`) and reads the version
> from `package.json`, so there is no second version to keep in sync.
> Note: `vp`'s native addon fails to load under some Electron-bundled node builds with a code-signature
> Team ID mismatch — use your system / nvm node locally
> (e.g. `PATH=$HOME/.nvm/versions/node/vXX/bin:$PATH vp pack`).
> **`vite` is an alias**: `package.json` declares
> `"vite": "npm:@voidzero-dev/vite-plus-core@<same version as vite-plus>"`.
> vite-plus 0.3+ validates that alias (otherwise it fails with
> `Expected @voidzero-dev/vite-plus-core@x, but found vite@y`), so **bumping `vite-plus` requires
> bumping the alias to the same version** — then run `pnpm verify`.
> Currently: `vite-plus` **1.0.0-rc.0** (bundling vite 8.3.x), Node `^22.19.0 || ^24.11.0 || >=26.0.0`.

> `pnpm check` now also runs the DSH compatibility guard `node scripts/check-dsh-compat.mjs`: it locates
> the real DSH runtime and validates the core token set, semantic-token coverage and the
> `peerDependencies` range. Contract drift after an upstream release fails here instead of surfacing as
> native DSH colors to users. The packaged README's compatibility lines are generated by
> `scripts/install.sh` from `package.json`'s `peerDependencies` + `dshCompat`, validated line by line
> against the root README, so the two can no longer be written independently.

### Structure

```
shared/            # Used by both halves (bundled into each artifact)
  jsonc.ts         #   tolerant JSONC parsing (jsonc-parser + trailing commas + BOM)
  vs-colors.ts     #   VS Code color-key whitelist + compact payload (the only theme shape sent to the client)
client/src/        # Browser half (settings UI, palette engine)
  color-utils.ts   #   RGB/HSL/WCAG contrast, dual-seed palettes
  oklch.ts         #   OKLCH perceptual engine (import derivation)
  chat.ts          #   t3 chat palette (colors taken from t3.chat as-is)
  vs-import.ts     #   VS Code theme parsing & mapping
  toast.ts         #   notice queue built on DSH's native Toast
  palette.ts       #   token list, default appearance, built-in themes
  styles.ts        #   settings page styles (incl. search/loading animations)
  index.ts         #   entry: state / override layer / settings page / editor / registration
host/src/          # Node half (RPC)
  util.ts          #   cross-platform network/file helpers (configurable timeout & retries)
  index.ts         #   entry: scan / read / search / detail / install / persist
scripts/
  install.sh       #   one-click build + assemble npm package + install
  e2e-import.mjs   #   end-to-end import regression (real Tokyo Night VSIX)
  check-vs-keys.mjs#   color-whitelist coverage guard
  check-dsh-compat.mjs # DSH compatibility guard (core token set / semantic-token coverage / peer range)
```

## Releasing (automatic npm publish)

One command: bump → commit → tag → push; CI then gates, publishes to npm and writes a Release
with a generated changelog.

```bash
pnpm release     # bumpp (antfu): pick a version → update package.json → commit → tag vX.Y.Z → push
```

A pushed tag makes [`.github/workflows/release.yml`](.github/workflows/release.yml) run:

| Step | What it does |
|---|---|
| Tag vs `package.json` version | Fails fast when they disagree (no "tagged v0.3.0, published 0.2.0") |
| `pnpm verify` | The full gate (build + source checks + artifact checks + real-VSIX end-to-end) |
| Assemble + `npm publish` | Signed with `--provenance`; **idempotent** — skips if that version is already on npm, so re-runs never fail on a version conflict |
| `changelogithub` | Creates the GitHub Release with a changelog grouped from conventional commits / PRs, and attaches the `.tgz` |

`dsh plugin add <the .tgz URL from the Release>` then installs exactly that version.

You can still **Draft a new release** manually (the workflow also listens for `release: published`),
or re-run it via `workflow_dispatch` with a tag.

**Authentication is a one-time setup (either works; the workflow supports both):**

- **A. npm Trusted Publishing (OIDC — recommended, no secret at all):** on npmjs.com → package
  `dsh-themes` → Settings → Trusted Publisher → GitHub Actions, with `MangMax` / `dsh-themes` /
  `release.yml` and an empty Environment. Provenance is then signed automatically.
- **B. `NPM_TOKEN`:** add a repo secret named `NPM_TOKEN` (Settings → Secrets and variables →
  Actions) whose value is a **Granular Access Token** (Read and write, with *Bypass 2FA* enabled).
  When present it takes precedence.

A prerelease (version containing `-`, or a Release marked *prerelease*) is published under npm's
`next` dist-tag so it never replaces `latest`.

## Install

Via npm registry (after publish):

```bash
dsh plugin --profile web add dsh-themes
```

Local one-click build (for development iteration):

```bash
bash scripts/install.sh
```

Either way, **restart dsh web**, then use it under **Settings → Themes**.

## Usage

- **Appearance modes**: system / light / dark; unspecified sides fall back to the DSH default theme
- **Independent light/dark owners**: clicking a variant only sets that side's theme without switching the appearance mode; light and dark can come from different themes; clicking a card name assigns the theme to both sides
- **Color editor**: click "Edit" on a theme card — rename, light/dark tabs, grouped token color pickers + hex inputs (instant), and reset
- **Copy for built-in themes**: built-in themes cannot be edited directly; use "Copy" to create a custom copy first
- **VS Code import**: scan local extensions (`~/.vscode/extensions`, `~/.vscode-insiders/extensions`, `~/.cursor/extensions`), fetch from URL, or paste JSON; imported themes can be renamed/deleted
- **Open VSX search**: search, read inline descriptions and links, one-click import (cached)

## Uninstall

```bash
dsh plugin --profile web remove dsh-themes
```

Or remove the dependency from the profile and restart dsh web. On removal the palette override layer is disposed automatically and the appearance returns to default.
