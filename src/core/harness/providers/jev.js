import { createHttpDecisionProvider } from './http.js';

export function createJevProvider(options = {}) {
  return createHttpDecisionProvider({ ...options, name: 'jev', path: options.path || '/decide' });
}
