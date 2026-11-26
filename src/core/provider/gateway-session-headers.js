import { randomUUID } from 'node:crypto';
import { getTokenUsageSession } from '../token-usage-context.js';

export function gatewaySessionHeaders(baseUrl) {
  const endpoint = URL.parse(baseUrl);
  if (endpoint?.origin !== 'https://opencode.ai'
    || !/^\/(?:inference|zen)\/go(?:\/|$)/.test(endpoint.pathname)) return {};
  const sessionId = getTokenUsageSession();
  return { 'x-opencode-session': /^[\w-]+$/.test(sessionId) ? sessionId : `ses_${randomUUID()}` };
}
