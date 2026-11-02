import { createHttpDecisionProvider } from './http.js';

export function createLayaProvider(options = {}) {
  return createHttpDecisionProvider({ ...options, name: 'laya', path: options.path || '/decide' });
}
