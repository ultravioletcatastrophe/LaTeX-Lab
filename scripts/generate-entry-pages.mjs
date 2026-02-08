import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const templatePath = resolve(rootDir, 'templates/entry-page.template.html');
const template = readFileSync(templatePath, 'utf8');

const variants = [
  {
    output: 'latex_lab.html',
    values: {
      TITLE: 'LaTeX Lab',
      FAVICON_EMOJI: '🧪',
      COLLAB_VENDOR_SCRIPTS: '',
      BODY_CLASS: '',
      DATA_COLLAB: 'false',
      DATA_WELCOME: 'corner',
      TOOLBAR_BEFORE_MACROS: '    <button id="shareBtn" class="menu-button">🔗 Share link</button>',
      TOOLBAR_AFTER_MACROS: '',
      CENTER_CONTROLS: '',
      JOIN_WARNING_MODAL: '',
      WELCOME_BACKDROP: '',
      WELCOME_TITLE: '👋 Welcome to LaTeX Lab',
      WELCOME_CONTENT: `      <p>
        This is an in-browser LaTeX playground with live KaTeX rendering.
        Type plain text and math, switch between <b>Mixed</b> mode (text + $inline$ / $$display$$ math)
        or <b>Classic</b> mode (every line renders as math), and export high-resolution PNG/PDF files.
        Dark mode and custom shortcuts are supported too.
      </p>`,
      WELCOME_BUTTON: 'Got it',
      CONFIG_COLLAB: 'false',
      CONFIG_SHARE_STATE_LINK: 'true',
      CONFIG_STORAGE_PREFIX: 'latexlab'
    }
  },
  {
    output: 'latex_lab_trystero.html',
    values: {
      TITLE: 'LaTeX Salon',
      FAVICON_EMOJI: '☕',
      COLLAB_VENDOR_SCRIPTS: `  <script src="/assets/vendor/tinycolor-min.js"></script>
  <script src="/assets/vendor/nearestColor.js"></script>`,
      BODY_CLASS: ' class="collab"',
      DATA_COLLAB: 'true',
      DATA_WELCOME: 'modal',
      TOOLBAR_BEFORE_MACROS: '',
      TOOLBAR_AFTER_MACROS: `    <span class="fill"></span>
    <div class="collab-controls" role="group" aria-label="Collaboration">
      <button id="shareRoomBtn" style="display:none;">📋 Share Room</button>
      <input id="displayNameInput" type="text" maxlength="15" placeholder="Your name" autocomplete="off" spellcheck="false" aria-label="Display name">
      <input id="roomNameInput" type="text" placeholder="Room code" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" aria-label="Room name">
      <button id="roomJoinBtn">Connect</button>
      <span id="collabStatus" class="collab-status">Offline</span>
    </div>`,
      CENTER_CONTROLS: `    <div class="center-controls">
      <div id="presenceList" class="presence-list" aria-live="polite" aria-label="Participants"></div>
    </div>`,
      JOIN_WARNING_MODAL: `  <div id="joinPop" class="welcome-pop" role="dialog" aria-modal="false" aria-labelledby="joinPopTitle" style="display:none">
    <div class="welcome-content">
      <h3 id="joinPopTitle">⚠️ Warning: Joining an Existing Room</h3>
      <p>If the room you are trying to join is already populated, joining will replace your editor's contents with the room's shared text.</p>
      <label class="join-pop-option"><input id="joinPopDontShow" type="checkbox"> Don't show this again</label>
      <div class="join-pop-actions">
        <button id="joinPopCancel">❌ Cancel</button>
        <button id="joinPopDismiss">✅ Got it</button>
      </div>
    </div>
  </div>`,
      WELCOME_BACKDROP: '  <div id="welcomeBackdrop" class="welcome-backdrop" hidden></div>',
      WELCOME_TITLE: '👋 Welcome to LaTeX Salon',
      WELCOME_CONTENT: `      <p>This is an in-browser multiplayer LaTeX playground with live KaTeX rendering.</p>
      <ul>
        <li><strong>Join or create rooms:</strong> pop a room name in the toolbar and anyone using it appears instantly.</li>
        <li><strong>Live updates:</strong> edits sync peer‑to‑peer using the Trystero protocol.</li>
        <li><strong>Other features:</strong> Mixed mode supports plain text with math, while Classic mode renders every line as math. Dark mode, PNG/PDF exports, and custom shortcuts are supported too.</li>
      </ul>`,
      WELCOME_BUTTON: 'Let’s collaborate',
      CONFIG_COLLAB: 'true',
      CONFIG_SHARE_STATE_LINK: 'false',
      CONFIG_STORAGE_PREFIX: 'latexlab.trystero'
    }
  }
];

function renderEntry(values){
  let out = template;
  for (const [key, value] of Object.entries(values)){
    out = out.split(`{{${key}}}`).join(value);
  }
  out = out.replace(/\n{3,}/g, '\n\n');
  const leftovers = Array.from(new Set(out.match(/{{[A-Z0-9_]+}}/g) || []));
  if (leftovers.length){
    throw new Error(`Unreplaced template tokens: ${leftovers.join(', ')}`);
  }
  return out;
}

for (const variant of variants){
  const outputPath = resolve(rootDir, variant.output);
  const rendered = renderEntry(variant.values);
  writeFileSync(outputPath, rendered);
  console.log(`Generated ${variant.output}`);
}
