import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownExcerpt } from '../codemini-web/client/src/lib/markdown-excerpt.js';

test('note excerpts show Chinese Markdown as readable single-line text', () => {
  assert.equal(markdownExcerpt('- **核心事件**：朴志效于 **10 月 21 日**在个人 Instagram 发布**手写信**，宣布结束与 JYP **21 年**的合约。'),
    '核心事件：朴志效于 10 月 21 日在个人 Instagram 发布手写信，宣布结束与 JYP 21 年的合约。');
  assert.equal(markdownExcerpt('# 标题\n\n> 一段 *强调* 与 ~~旧内容~~\n\n1. 条目\n2. 下一项'),
    '标题 一段 强调 与 旧内容 条目 下一项');
});

test('excerpts retain link labels, image descriptions and code without markup', () => {
  assert.equal(markdownExcerpt('[资料](https://example.com/a_(b)) ![配图](image.png) [参考][ref]\n\n[ref]: https://example.com'),
    '资料 配图 参考');
  assert.equal(markdownExcerpt('`file_name` 与 `a * b`\n\n```js\nconst x = 1;\n```'),
    'file_name 与 a * b const x = 1;');
  assert.equal(markdownExcerpt('file_name 与 2 * 3，转义 \\*星号\\*'), 'file_name 与 2 * 3，转义 *星号*');
});

test('research excerpts flatten task lists and tables and omit reference metadata', () => {
  assert.equal(markdownExcerpt('- [x] 已完成\n- [ ] 待研究\n\n| 项目 | 结果 |\n| --- | --- |\n| 测试 | 通过 |\n\n结论[^1]\n\n[^1]: 脚注内容'),
    '已完成 待研究 项目 结果 测试 通过 结论');
});

test('excerpts handle empty input and treat HTML as non-renderable content', () => {
  assert.equal(markdownExcerpt(null), '');
  assert.equal(markdownExcerpt(' \n\t'), '');
  assert.equal(markdownExcerpt('---'), '');
  assert.equal(markdownExcerpt('正文 <b>重点</b> &amp; 内容 <!-- hidden -->'), '正文 重点 & 内容');
  assert.equal(markdownExcerpt('<script>alert(1)</script>'), '');
});
