import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  parseScrapbookAttachmentFromModelContent,
  parseUserBannerAttachmentsFromModelContent,
} from '../codemini-web/client/src/lib/message-context-parsers.js';

test('parseScrapbookAttachmentFromModelContent restores scrapbook banner metadata', () => {
  const attachment = parseScrapbookAttachmentFromModelContent([
    '<scrapbook_context>',
    'Title: Browser notes',
    'Entry ID: entry-123',
    'Source URL: https://example.com/post',
    'Summary:',
    'Useful context',
    '</scrapbook_context>',
  ].join('\n'));

  assert.equal(attachment?.id, 'scrapbook:entry-123');
  assert.equal(attachment?.name, 'Browser notes');
  assert.equal(attachment?.kind, 'scrapbook');
  assert.equal(attachment?.sourceUrl, 'https://example.com/post');
});

test('parseUserBannerAttachmentsFromModelContent keeps file and scrapbook banners', () => {
  const attachments = parseUserBannerAttachmentsFromModelContent([
    '<uploaded_attachments>',
    'Attachment 1: notes.txt',
    'Type: file',
    'Size: 42 bytes',
    '</uploaded_attachments>',
    '',
    '<scrapbook_context>',
    'Title: Saved note',
    'Entry ID: entry-456',
    '</scrapbook_context>',
  ].join('\n'));

  assert.equal(attachments.length, 2);
  assert.equal(attachments[0]?.name, 'notes.txt');
  assert.equal(attachments[1]?.kind, 'scrapbook');
});

test('server persists scrapbook banner into submit message attachments', async () => {
  const source = await fs.readFile('codemini-web/server.js', 'utf8');
  assert.match(source, /pickScrapbookAttachments\(body\.attachments\)/);
  assert.match(source, /parseScrapbookAttachmentFromModelContent\(mergedModelText\)/);
  assert.match(source, /const attachments = scrapbookAttachment/);
  assert.match(source, /dismissedAlwaysSkills: body\.dismissedAlwaysSkills,\s*attachments,/);
});

test('client submit forwards scrapbook attachments for ui transcript persistence', async () => {
  const source = await fs.readFile('codemini-web/client/src/context/app-context.jsx', 'utf8');
  assert.match(source, /pickScrapbookAttachments\(/);
  assert.match(source, /api\.submitMessage\(sessionId,/);
  assert.match(source, /attachments:\s*pickScrapbookAttachments\(/);
});

test('runtime bridge serializes user model_content for scrapbook banner recovery', async () => {
  const source = await fs.readFile('codemini-web/lib/runtime-bridge.js', 'utf8');
  assert.match(source, /model_content/);
});

test('ui transcript enrich restores missing scrapbook banners from core model_content', async () => {
  const { enrichUiMessagesWithScrapbookAttachments } = await import(
    '../codemini-web/client/src/lib/message-attachments.js'
  );
  const enriched = enrichUiMessagesWithScrapbookAttachments(
    [
      { id: 'u1', role: 'you', text: 'first', attachments: [] },
      { id: 'u2', role: 'you', text: 'second', attachments: [{ id: 'scrapbook:keep', kind: 'scrapbook', name: 'Keep' }] },
      { id: 'u3', role: 'you', text: 'third', attachments: [] },
    ],
    [
      {
        role: 'user',
        content: 'first',
        model_content: '<scrapbook_context>\nTitle: First note\nEntry ID: a1\n</scrapbook_context>',
      },
      {
        role: 'user',
        content: 'second',
        model_content: '<scrapbook_context>\nTitle: Second note\nEntry ID: a2\n</scrapbook_context>',
      },
      {
        role: 'user',
        content: 'third',
        model_content: '<scrapbook_context>\nTitle: Third note\nEntry ID: a3\n</scrapbook_context>',
      },
    ],
  );

  assert.equal(enriched[0].attachments[0]?.id, 'scrapbook:a1');
  assert.equal(enriched[1].attachments[0]?.id, 'scrapbook:keep');
  assert.equal(enriched[2].attachments[0]?.id, 'scrapbook:a3');
});
