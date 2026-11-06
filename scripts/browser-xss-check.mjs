#!/usr/bin/env node
/**
 * Browser-level XSS check for the two stored-value render paths.
 *
 * The unit tests prove the strings are escaped in the generated HTML. This
 * script goes one step further: it renders the *real* components, loads the
 * result in a real browser engine, and asks the browser whether any script ran.
 *
 *   A. `MessageBody` with `<img src=x onerror=window.__xss=1>` — the browser
 *      must report `window.__xss === undefined` and show the string as text.
 *   B. The root-layout style block built from
 *      `"red;}</style><script>window.__xss=1</script>"` — the hostile value
 *      must never reach the document, and the coded fallback token must stand.
 *
 * A positive control renders a deliberately unsafe element first. If the control
 * does not fire, the browser or the extraction is broken and the run fails —
 * a check that cannot fail proves nothing.
 *
 * No dependency is installed. The script uses a local Chrome, Edge or Chromium
 * through `--headless --dump-dom`; set BROWSER_PATH to override the lookup.
 * Everything it writes goes to a fresh directory under the OS temp dir.
 *
 * Usage:  node scripts/browser-xss-check.mjs
 * Exit:   0 all assertions hold · 1 an assertion failed · 2 no browser found
 */
import { spawnSync } from 'node:child_process';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const jiti = createJiti(import.meta.url, {
  alias: { '@': path.join(root, 'src') },
});

const { MessageBody } = await jiti.import(
  path.join(root, 'src', 'components', 'account', 'MessageBody.ts'),
);
const { safeThemeColor, THEME_COLOR_KEYS } = await jiti.import(
  path.join(root, 'src', 'lib', 'website', 'theme-rules.ts'),
);

/* ------------------------------------------------------- the payloads */

const HOSTILE_BODY = '<img src=x onerror=window.__xss=1>';
const HOSTILE_COLOUR = 'red;}</style><script>window.__xss=1</script>';
const FALLBACK_COLOUR = '#006D2E';

/* --------------------------------------------------------- the browser */

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function findBrowser() {
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'msedge']) {
    const probe = spawnSync(name, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return name;
  }
  return null;
}

/**
 * Load one HTML file and return whatever the page put in
 * `<pre id="result">`. `--dump-dom` prints the DOM after scripts run.
 */
function evaluate(browser, html, workDir, name) {
  const file = path.join(workDir, `${name}.html`);
  writeFileSync(file, html, 'utf8');

  const run = spawnSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--disable-extensions',
      '--virtual-time-budget=2000',
      '--dump-dom',
      `file:///${file.replace(/\\/g, '/').replace(/^\//, '')}`,
    ],
    { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
  );

  if (run.status !== 0) {
    return { error: (run.stderr || '').split('\n')[0] || `browser exited ${run.status}` };
  }

  const dom = run.stdout;
  const match = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/);
  if (!match) return { error: 'the page produced no result element' };

  const decode = (text) =>
    text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');

  try {
    return { value: JSON.parse(decode(match[1])) };
  } catch {
    return { error: 'the result element did not hold JSON' };
  }
}

/** A page shell: a body fragment, then a script that reports what happened. */
function page(bodyHtml, styleBlock, probeExpression) {
  return `<!doctype html>
<html class="oppo-root oppo-root">
<head>
<meta charset="utf-8">
<style>${styleBlock}</style>
<style>.oppo-root{--oppo-green: ${FALLBACK_COLOUR}; --oppo-green-dark: #005524;}</style>
</head>
<body>
${bodyHtml}
<pre id="result">PENDING</pre>
<script>
  // Report after a settle delay: an image error handler is asynchronous, so a
  // synchronous report would miss it — which is exactly what the positive
  // control is there to catch.
  setTimeout(function () {
    var probe = document.getElementById('probe-text');
    var report = {
      xss: typeof window.__xss === 'undefined' ? 'undefined' : String(window.__xss),
      text: probe ? probe.textContent : '',
      html: probe ? probe.innerHTML : '',
      computed: getComputedStyle(document.documentElement).getPropertyValue('--oppo-green').trim(),
      scriptNodes: document.querySelectorAll('script').length,
      custom: (function () { ${probeExpression || 'return null;'} })()
    };
    document.getElementById('result').textContent = JSON.stringify(report);
  }, 300);
</script>
</body>
</html>`;
}

/* --------------------------------------------------------- assertions */

const results = [];
function check(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
}

/** Build the root-layout style block exactly the way `src/app/layout.tsx` does. */
function layoutStyleBlock(storedValue) {
  const overrides = [];
  const primary = safeThemeColor(storedValue);
  if (primary) overrides.push(`--oppo-green: ${primary}`);
  overrides.push('--oppo-font: var(--font-site), Arial');
  return `.oppo-root.oppo-root{${overrides.join(';')}}`;
}

function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error(
      'No Chrome, Edge or Chromium was found. Install one, or set BROWSER_PATH to its executable.\n' +
        'The manual procedure is in docs/browser-xss-manual-20261107.md.',
    );
    process.exitCode = 2;
    return;
  }

  const workDir = mkdtempSync(path.join(os.tmpdir(), 'gadzio-xss-'));
  try {
    console.log(`Browser: ${browser}\n`);

    /* ------------------------------------------------ positive control */
    const controlHtml = page(
      `<div id="probe-text"><img src=x onerror="window.__xss=1"></div>`,
      '',
    );
    const control = evaluate(browser, controlHtml, workDir, 'control');
    check(
      'CONTROL',
      !control.error && control.value?.xss === '1',
      control.error
        ? `harness could not run: ${control.error}`
        : control.value?.xss === '1'
          ? 'a deliberately unsafe element sets the flag, so this harness can detect XSS'
          : 'a deliberately unsafe element did NOT set the flag — the harness is broken',
    );

    /* ---------------------------------------- A. MessageBody as text */
    const bodyHtml = renderToStaticMarkup(createElement(MessageBody, { body: HOSTILE_BODY }));
    const bodyPage = page(
      `<div id="probe-text">${bodyHtml}</div>`,
      '<style>.whitespace-pre-wrap{white-space:pre-wrap}</style>',
    );
    const body = evaluate(browser, bodyPage, workDir, 'message-body');
    check(
      'BODY-1',
      !body.error && body.value?.xss === 'undefined',
      body.error
        ? body.error
        : body.value?.xss === 'undefined'
          ? 'the hostile message did not execute script'
          : `script executed: window.__xss = ${body.value?.xss}`,
    );
    check(
      'BODY-2',
      !body.error && body.value?.text === HOSTILE_BODY,
      body.error
        ? body.error
        : body.value?.text === HOSTILE_BODY
          ? 'the string is shown literally as text'
          : `text content was ${JSON.stringify(body.value?.text)}`,
    );
    check(
      'BODY-3',
      !body.error && !/<img/i.test(body.value?.html ?? ''),
      body.error
        ? body.error
        : !/<img/i.test(body.value?.html ?? '')
          ? 'no <img> node was created'
          : 'an <img> element was created from the stored body',
    );

    /* ------------------------------------- B. hostile theme colour */
    const hostileBlock = layoutStyleBlock(HOSTILE_COLOUR);
    const themePage = page(
      '<div id="probe-text">theme</div>',
      // Only the first <style> is the block under test; the second holds the
      // coded token, exactly as the layout emits it.
      `<style>${hostileBlock}</style>`,
      // The page has exactly one <script> (this reporter). A breakout would
      // have added another.
      'return document.querySelectorAll("script").length;',
    );
    const theme = evaluate(browser, themePage, workDir, 'theme-colour');
    check(
      'THEME-1',
      !theme.error && theme.value?.xss === 'undefined',
      theme.error
        ? theme.error
        : theme.value?.xss === 'undefined'
          ? 'the hostile colour did not execute script'
          : `script executed: window.__xss = ${theme.value?.xss}`,
    );
    check(
      'THEME-2',
      !hostileBlock.includes('</style>') && !hostileBlock.includes('<script'),
      hostileBlock.includes('</style>') || hostileBlock.includes('<script')
        ? `the hostile value reached the style block: ${hostileBlock}`
        : 'the hostile value never reached the style block',
    );
    check(
      'THEME-3',
      !theme.error && theme.value?.computed === FALLBACK_COLOUR,
      theme.error
        ? theme.error
        : theme.value?.computed === FALLBACK_COLOUR
          ? `the coded fallback ${FALLBACK_COLOUR} is in effect`
          : `computed --oppo-green was ${JSON.stringify(theme.value?.computed)}`,
    );
    check(
      'THEME-4',
      !theme.error && theme.value?.custom === 1,
      theme.error
        ? theme.error
        : theme.value?.custom === 1
          ? 'the page still has exactly its one reporter script; the value added none'
          : `the page has ${theme.value?.custom} script element(s); the hostile value injected markup`,
    );
    check(
      'THEME-5',
      safeThemeColor(HOSTILE_COLOUR) === null && THEME_COLOR_KEYS.size === 3,
      'safeThemeColor() rejects the hostile value and the guarded key set is unchanged',
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed: ${failures.map((f) => f.id).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${results.length} browser checks passed.`);
  }
}

main();
