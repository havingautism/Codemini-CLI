import crypto from 'node:crypto';

export function sha256(input) {
  return crypto.createHash('sha256').update(String(input || '')).digest('hex');
}

export function sha256Prefixed(input) {
  return `sha256:${sha256(input)}`;
}
