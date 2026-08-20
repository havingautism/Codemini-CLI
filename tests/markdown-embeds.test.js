import {
  extractLinksFromMarkdownText,
  isImageUrl,
  isPublicHttpUrl,
  normalizeMarkdownForDisplay,
  promoteBareImageUrls,
  promoteTableCellImageUrls,
  splitMarkdownForEmbeds,
} from '../codemini-web/client/src/lib/markdown-embeds.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('isPublicHttpUrl', () => {
  it('rejects loopback and private hosts', () => {
    assert.equal(isPublicHttpUrl('http://127.0.0.1:3002'), false);
    assert.equal(isPublicHttpUrl('http://localhost:5173'), false);
    assert.equal(isPublicHttpUrl('http://192.168.1.1/x'), false);
    assert.equal(isPublicHttpUrl('https://example.com/a'), true);
  });
});

describe('extractLinksFromMarkdownText', () => {
  it('does not promote local urls into related links', () => {
    const text =
      '前端连后端：getBackendUrl()（默认 `http://127.0.0.1:3002`）+ backendClient.js\n'
      + '参考 https://example.com/docs';
    assert.deepEqual(extractLinksFromMarkdownText(text), [
      { type: 'link', url: 'https://example.com/docs' },
    ]);
  });

  it('does not swallow fullwidth closers after a backticked local url', () => {
    const text = '默认 `http://127.0.0.1:3002`）+ backendClient.js';
    assert.deepEqual(extractLinksFromMarkdownText(text), []);
  });
});

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

describe('user question bubbles keep URLs as text', () => {
  const userPrompt = [
    'https://github.com/anthropics/skills/tree/main/skills/skill-creator',
    '介绍一下这个 skill 是如何工作的',
  ].join('\n');

  it('does not promote a pasted URL plus question into an embed card', () => {
    const parts = splitMarkdownForEmbeds(userPrompt, { includeLinks: false });
    assert.equal(parts.some((part) => part.type === 'embed'), false);
    assert.equal(
      parts.some(
        (part) =>
          part.type === 'markdown' &&
          part.text.includes('https://github.com/anthropics/skills/tree/main/skills/skill-creator'),
      ),
      true,
    );
  });

  it('UserText disables inline embed cards', async () => {
    const source = await fs.readFile(
      'codemini-web/client/src/components/MessageBubble.jsx',
      'utf8',
    );
    const userTextFn = source.match(
      /function UserText\([\s\S]*?\n\}\n\nfunction UserSkillChips/,
    )?.[0];
    assert.ok(userTextFn, 'UserText should still exist in MessageBubble');
    const renderers = [...userTextFn.matchAll(/<StreamdownRenderer[\s\S]*?\/>/g)].map(
      (match) => match[0],
    );
    assert.ok(renderers.length >= 1, 'UserText should render markdown');
    for (const renderer of renderers) {
      assert.match(renderer, /inlineEmbeds=\{false\}/);
    }
  });
});

describe('StreamdownRenderer streaming markdown', () => {
  it('keeps Streamdown parsing while tokens arrive instead of waiting for a char threshold', async () => {
    const source = await fs.readFile(
      'codemini-web/client/src/components/StreamdownRenderer.jsx',
      'utf8',
    );
    assert.doesNotMatch(
      source,
      /STREAMING_PARSE_CHUNK/,
      'streaming replies must not wait for a large char chunk before formatting',
    );
    assert.doesNotMatch(
      source,
      /lastParsedLenRef/,
      'streaming replies must not skip Streamdown between parse chunks',
    );
    assert.match(source, /parseIncompleteMarkdown/);
    assert.match(source, /const mode = streaming \? 'streaming' : 'static'/);
  });
});
