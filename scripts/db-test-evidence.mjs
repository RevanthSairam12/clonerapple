// Pure evidence parsing: no environment loading or database connections.
export function completedSummary(text) {
  return ['tests', 'pass', 'fail', 'skipped'].every(name =>
    new RegExp(`(?:#|ℹ) ${name} (\\d+)(?:\\r?\\n|$)`).test(text));
}

export function registrationStatus(lines, name) {
  // Include the duration boundary: a longer registration with the same prefix
  // must not supply evidence for this name.
  const marker = symbol => lines.some(line => line.trimStart().startsWith(`${symbol} ${name} (`));
  if (marker('✖')) return 'failed';
  if (marker('✔')) return 'passed';
  if (marker('﹣')) return 'skipped';
  return null;
}
