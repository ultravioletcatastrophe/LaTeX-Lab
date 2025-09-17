# LaTeX Lab

LaTeX Lab is a playful, zero-setup workspace for typesetting math right in your browser. Open the page, start typing, and watch KaTeX render your work the instant you press a key.

## Quick start
1. Open `latex_lab.html` in any modern desktop browser (Chrome, Edge, Firefox, Safari).
2. Begin typing in the left editor. Use inline `$...$` or display `$$...$$` math in Mixed mode.
3. Flip the **Mixed / Classic** switch if you want every line rendered as display math.
4. Drag the center divider to resize panes; double-click it to snap back to a balanced view.

Everything you write, along with your layout, theme, and macros, is saved locally so you can close the tab and pick up later.

## Why you'll like it
- **Mixed or Classic flow** – stay in text-first mode with inline math or flip the switch so every line becomes display equations.
- **Side-by-side focus** – resize the editor and preview panes, double-click to recenter, and keep wrapping line numbers in sync.
- **Dark mode on tap** – match your lighting instantly while the preview keeps its polish.
- **Sticks with you** – text, macros, layout, cursor, and scroll position are restored each time you return.

## Key features
- **Live KaTeX preview** with line-aware gutters that mirror wrapping so long derivations stay readable.
- **Mixed + Classic modes** for switching between text-first notes and equation-only workflows.
- **High-resolution PNG export** that bakes in fonts for crisp slides and handouts.
- **Shareable links** that compress the current text, layout, theme, and macros into the URL for easy collaboration.
- **Dark mode toggle** to match your workspace lighting instantly.
- **Matrix, table, and cases builders** that drop ready-to-edit snippets into the editor.
- **Custom shortcut manager** for pasting and saving your favourite `\newcommand` definitions with instant rendering.
- **Keyboard-friendly editing** including smart Tab indent/outdent, paired bracket and dollar insertion, and Escape-to-close modals.
- **Resizable split view** with persistent panel widths and scroll-synced gutters.
- **Auto-save everywhere** so text, cursor position, scroll offset, and layout are restored on reload.

## Tips & tricks
- Use the **Shortcuts** button to paste multiple `\newcommand` lines at once. Saved macros apply immediately to the preview and exports.
- Click **Insert ▾** to launch the matrix/table builders; adjust rows, columns, and borders before inserting.
- Hit **PNG** after your fonts finish loading for the cleanest export. If clipboard access is blocked when sharing a link, LaTeX Lab will fall back to a prompt so you can copy it manually.
- Want a fresh start? The **Clear** button wipes the editor and local save (with a confirmation step so nothing disappears by accident).

## Requirements
LaTeX Lab is a single HTML file backed by CDN-hosted KaTeX, html-to-image, and html2canvas. No build step, server, or installation is needed—just open the file while connected to the internet so the assets can load.

Enjoy the lab bench! It’s built for quick experiments—tweak the HTML, refresh, and your changes appear immediately.
