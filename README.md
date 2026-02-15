# LaTeX Lab

LaTeX Lab is a zero‑setup, in‑browser workspace for typing math and seeing KaTeX render it live. The multiplayer build (branded **LaTeX Salon**) is live at `https://latex.salon` and runs entirely client‑side: peer‑to‑peer sync via Trystero, no accounts, no app server.

![Single‑player view](./assets/images/screenshot.png)
![Multiplayer view](./assets/images/screenshot_trystero.png)

## Multiplayer (LaTeX Salon)
- Join a room by name; anyone using the same code appears instantly.
- Edits sync peer‑to‑peer over WebRTC via Trystero (MQTT transport in this build).
- Host is elected by earliest join timestamp; the host sends full‑state syncs, everyone else sends deltas.
- Remote carets, selections, names, and color changes are broadcast live.
- Presence pills show participants with friendly color names (xkcd color list + nearest‑match).
- Local state persists (text, layout, theme, macros, cursor, scroll), so reconnects feel seamless.

## Privacy & Threat Model
- No app backend stores your document. Single-player content stays in your browser unless you share it.
- Multiplayer rooms are collaborative by design: anyone with the same room code can read and edit the shared state.
- Room codes are not authenticated. Treat them as secrets and use hard-to-guess names for private sessions.
- Collaboration uses third-party relay infrastructure for peer discovery/signaling; network metadata (for example IP/timing) may be visible to those services and peers.
- Share links encode content and settings in the URL hash. Anyone with that link can read the encoded state.

## What It Does Well
- Mixed mode (text + `$inline$` / `$$display$$`) and Classic mode (each line is display math).
- Side‑by‑side editor + preview with synced line gutters and persistent split widths.
- High‑resolution PNG/PDF export with embedded fonts.
- Shareable links compress text, layout, theme, and macros into the URL.
- Matrix/table/cases builders and a macros manager for `\newcommand` shortcuts.
- Keyboard‑first editing: smart indent/outdent, paired delimiter insertion, Esc to close modals.

## Repo & Hosting Notes
- Entry points: `latex_lab_trystero.html` (multiplayer) and `latex_lab.html` (single‑player).
- Entry pages are generated from `templates/entry-page.template.html` via `node scripts/generate-entry-pages.mjs`.
- `_redirects` maps `/` to multiplayer and `/local` to single‑player on the hosted site.
- Runtime code lives in `assets/katex_backend.js`; vendor libs and color data live in `assets/vendor`.
- Asset paths are absolute (`/assets/...`) for static hosting. If you serve from a sub‑path, adjust paths accordingly.

## Runtime Dependencies
Static HTML that loads CDN‑hosted KaTeX, html‑to‑image, and html2canvas. No build step required; you just need a secure origin for WebRTC to enable multiplayer.

## Testing
- Run all tests with `node --test`.
- Tests live in `tests/katex_backend.test.cjs` and execute `assets/katex_backend.js` in a mocked browser environment (`tests/helpers/load-katex-backend.cjs`).
- Playwright smoke tests (browser): `LATEX_LAB_PLAYWRIGHT=1 node --test`.
- Export golden tests only (browser + downloads): `LATEX_LAB_EXPORT_GOLDEN=1 node --test tests/export_golden.test.cjs`.
- `PLAYWRIGHT=1 node --test` also enables all Playwright tests, including export goldens.
- Browser tests require `playwright` to be installed locally. Export golden tests compare generated PNG/PDF exports against baselines in `assets/images`.

## License
This project is licensed under GPL-3.0. See `LICENSE`.
