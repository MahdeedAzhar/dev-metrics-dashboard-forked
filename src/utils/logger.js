export function log(...args) {
  // eslint-disable-next-line no-console
  console.log('[dev-metrics]', ...args);
}

export function warn(...args) {
  // eslint-disable-next-line no-console
  console.warn('[dev-metrics]', ...args);
}
