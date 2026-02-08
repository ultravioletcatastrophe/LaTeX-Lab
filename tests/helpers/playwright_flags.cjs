function flagIsSet(name) {
  const raw = process.env[name];
  if (typeof raw !== 'string') return false;
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function anyFlag(names) {
  return names.some(flagIsSet);
}

const PLAYWRIGHT_ENABLED = anyFlag([
  'LATEX_LAB_PLAYWRIGHT',
  'LATEXLAB_PLAYWRIGHT',
  'PLAYWRIGHT'
]);

const EXPORT_GOLDEN_ENABLED = PLAYWRIGHT_ENABLED || anyFlag([
  'LATEX_LAB_EXPORT_GOLDEN',
  'LATEXLAB_EXPORT_GOLDEN'
]);

const PLAYWRIGHT_HINT =
  'Set LATEX_LAB_PLAYWRIGHT=1 (or PLAYWRIGHT=1) to enable Playwright tests.';

const EXPORT_GOLDEN_HINT =
  'Set LATEX_LAB_EXPORT_GOLDEN=1 for only export golden tests, or LATEX_LAB_PLAYWRIGHT=1 / PLAYWRIGHT=1.';

module.exports = {
  PLAYWRIGHT_ENABLED,
  EXPORT_GOLDEN_ENABLED,
  PLAYWRIGHT_HINT,
  EXPORT_GOLDEN_HINT
};
