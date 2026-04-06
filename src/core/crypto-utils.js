/**
 * 共享加密工具函数。
 * 统一使用 sha256 作为默认哈希算法，避免在各模块中重复定义。
 */

import crypto from 'node:crypto';

/**
 * 向后兼容别名，内部已迁移到 sha256。
 * @deprecated 请使用 sha256() 替代。
 */
export function sha1(input) {
  return sha256(input);
}

export function sha256(input) {
  return crypto.createHash('sha256').update(String(input || '')).digest('hex');
}

export function sha256Prefixed(input) {
  return `sha256:${sha256(input)}`;
}
