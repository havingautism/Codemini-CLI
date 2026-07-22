import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isImageUrl,
  normalizeMarkdownForDisplay,
  promoteBareImageUrls,
  promoteTableCellImageUrls,
  splitMarkdownForEmbeds,
} from '../codemini-web/client/src/lib/markdown-embeds.js';

describe('isImageUrl', () => {
  it('matches common image extensions and ignores query/hash', () => {
    assert.equal(isImageUrl('https://cdn.example.com/a.jpg'), true);
    assert.equal(isImageUrl('https://cdn.example.com/a.JPEG?w=800'), true);
    assert.equal(isImageUrl('https://cdn.example.com/a.png#frag'), true);
    assert.equal(isImageUrl('https://cdn.example.com/a.webp'), true);
  });

  it('rejects non-image urls', () => {
    assert.equal(isImageUrl('https://example.com/article'), false);
    assert.equal(isImageUrl('https://example.com/photo.jpg.html'), false);
    assert.equal(isImageUrl('ftp://cdn.example.com/a.jpg'), false);
  });
});

describe('splitMarkdownForEmbeds standalone image urls', () => {
  it('turns whole-line image urls into image parts', () => {
    const parts = splitMarkdownForEmbeds(
      [
        '看这些图：',
        'https://cdn.example.com/one.jpg',
        'https://cdn.example.com/two.png?size=large',
        'https://example.com/article',
      ].join('\n'),
    );

    assert.deepEqual(
      parts.filter((part) => part.type !== 'markdown'),
      [
        { type: 'image', alt: '', url: 'https://cdn.example.com/one.jpg' },
        {
          type: 'image',
          alt: '',
          url: 'https://cdn.example.com/two.png?size=large',
        },
        { type: 'embed', url: 'https://example.com/article' },
      ],
    );
  });

  it('still promotes image urls when link embeds are disabled', () => {
    const parts = splitMarkdownForEmbeds(
      [
        '看这些图：',
        'https://cdn.example.com/one.jpg',
        'https://example.com/article',
      ].join('\n'),
      { includeLinks: false },
    );

    assert.equal(
      parts.some(
        (part) =>
          part.type === 'image' &&
          part.url === 'https://cdn.example.com/one.jpg',
      ),
      true,
    );
    assert.equal(parts.some((part) => part.type === 'embed'), false);
    assert.equal(
      parts.some(
        (part) =>
          part.type === 'markdown' &&
          part.text.includes('https://example.com/article'),
      ),
      true,
    );
  });

  it('leaves inline image urls as embeds, not images', () => {
    const parts = splitMarkdownForEmbeds(
      '看这张 https://cdn.example.com/inline.jpg 哈哈',
    );
    assert.equal(parts.some((part) => part.type === 'image'), false);
    assert.equal(
      parts.some(
        (part) =>
          part.type === 'embed' &&
          part.url === 'https://cdn.example.com/inline.jpg',
      ),
      true,
    );
  });
});

describe('promoteBareImageUrls', () => {
  it('promotes prefixed and labeled bare image urls from real sessions', () => {
    const input = [
      '👉 https://cdn.kpopping.com/kpics/2026/07/a.jpg',
      '**NAYEON D1** 👉 https://cdn.kpopping.com/kpics/2026/07/b.jpg',
      '👉 https://kpopping.com/kpics/album-page',
    ].join('\n');

    const output = promoteBareImageUrls(input);
    assert.match(
      output,
      /👉 !\[\]\(https:\/\/cdn\.kpopping\.com\/kpics\/2026\/07\/a\.jpg\)/,
    );
    assert.match(
      output,
      /\*\*NAYEON D1\*\* 👉 !\[\]\(https:\/\/cdn\.kpopping\.com\/kpics\/2026\/07\/b\.jpg\)/,
    );
    assert.match(output, /👉 https:\/\/kpopping\.com\/kpics\/album-page/);
  });

  it('does not double-wrap markdown images or links', () => {
    const input = [
      '![](https://cdn.example.com/a.jpg)',
      '[cover](https://cdn.example.com/b.jpg)',
    ].join('\n');
    assert.equal(promoteBareImageUrls(input), input);
  });
});

describe('promoteTableCellImageUrls', () => {
  it('converts whole-cell image urls inside tables', () => {
    const input = [
      '| 场景 | 链接 |',
      '| --- | --- |',
      '| 舞台 | https://cdn.example.com/stage.jpg?w=800 |',
      '| 官网 | https://example.com/tour |',
    ].join('\n');

    const output = promoteTableCellImageUrls(input);
    assert.match(output, /\| !\[\]\(https:\/\/cdn\.example\.com\/stage\.jpg\?w=800\) \|/);
    assert.match(output, /\| https:\/\/example\.com\/tour \|/);
    assert.equal(output.includes('| --- | --- |'), true);
  });

  it('converts whole-cell markdown links that point to images', () => {
    const input = [
      '| 场次 | 直接看 |',
      '| --- | --- |',
      '| Orlando | [缩略图](https://cdn.example.com/orlando.jpg) |',
    ].join('\n');

    const output = promoteTableCellImageUrls(input);
    assert.match(
      output,
      /\| !\[缩略图\]\(https:\/\/cdn\.example\.com\/orlando\.jpg\) \|/,
    );
  });

  it('does not touch image urls inside fenced code', () => {
    const input = [
      '```md',
      '| pic | https://cdn.example.com/a.jpg |',
      '```',
    ].join('\n');
    assert.equal(promoteTableCellImageUrls(input), input);
  });

  it('runs during display normalization', () => {
    const normalized = normalizeMarkdownForDisplay(
      '| 图 | https://cdn.example.com/a.png |\n| --- | --- |',
    );
    assert.match(normalized, /!\[Image\]\(https:\/\/cdn\.example\.com\/a\.png\)/);
  });

  it('turns image markdown links into images and keeps other link titles', () => {
    const normalized = normalizeMarkdownForDisplay(
      [
        '| 场次 | 直接看 |',
        '| --- | --- |',
        '| Orlando | [👉 点我立刻看 Momo](https://cdn.example.com/orlando.jpg) |',
        '',
        '[👉 点我立刻看图](https://example.com/article)',
      ].join('\n'),
      { linkFallback: '链接', imageFallback: '图片' },
    );

    assert.match(
      normalized,
      /!\[👉 点我立刻看 Momo\]\(https:\/\/cdn\.example\.com\/orlando\.jpg\)/,
    );
    assert.match(
      normalized,
      /\[👉 点我立刻看图\]\(https:\/\/example\.com\/article\)/,
    );
  });

  it('normalizes real session style prefixed jpg urls into images', () => {
    const normalized = normalizeMarkdownForDisplay(
      '**MOMO D2** 👉 https://cdn.kpopping.com/kpics/2026/07/photo.jpg',
      { imageFallback: '图片' },
    );
    assert.match(
      normalized,
      /\*\*MOMO D2\*\* 👉 !\[图片\]\(https:\/\/cdn\.kpopping\.com\/kpics\/2026\/07\/photo\.jpg\)/,
    );
  });

  it('softens HN-style list meta after the title', () => {
    const normalized = normalizeMarkdownForDisplay(
      "19. France's Anssi Will Block PQC — 40 points · 7 comments postquantum.com · 1h ago",
    );
    assert.equal(
      normalized,
      "19. France's Anssi Will Block PQC *— 40 points · 7 comments postquantum.com · 1h ago*",
    );
  });
});
