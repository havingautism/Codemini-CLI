/**
 * 共享加密工具函数。
 * 统一 sha1 / sha256 的实现，避免在各模块中重复定义。
 */

import crypto from 'node:crypto';

export function sha1(input) {
  return crypto.createHash('sha1').update(String(input || '')).digest('hex');
}

export function sha256(input) {
  return crypto.createHash('sha256').update(String(input || '')).digest('hex');
}

export function sha256Prefixed(input) {
  return `sha256:${sha256(input)}`;
}
