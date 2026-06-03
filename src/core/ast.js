import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Parser, Language, Query } from 'web-tree-sitter';
import { LANGUAGE_ALIASES, EXTENSION_LANGUAGE_MAP, TOOL_SKIP_DIRS as SKIP_DIRS } from './constants.js';
import { sha256Prefixed as sha256 } from './crypto-utils.js';
import { BoundedCache } from './bounded-cache.js';
import { globFilesUnder } from './workspace-glob.js';

const require = createRequire(import.meta.url);

const IDENTIFIER_NODE_TYPES = new Set([
  'identifier',
  'property_identifier',
  'type_identifier',
  'word',
  'field_identifier',
  'name'
]);
const WRAPPER_NODE_TYPES = new Set([
  'declarator',
  'qualified_identifier',
  'template_function',
  'template_type'
]);
const LANGUAGE_WASM_PATHS = {
  js: require.resolve('@cursorless/tree-sitter-wasms/out/tree-sitter-javascript.wasm'),
  ts: require.resolve('@cursorless/tree-sitter-wasms/out/tree-sitter-typescript.wasm'),
  tsx: require.resolve('@cursorless/tree-sitter-wasms/out/tree-sitter-tsx.wasm'),
  python: require.resolve('@cursorless/tree-sitter-wasms/out/tree-sitter-python.wasm'),
  go: require.resolve('@cursorless/tree-sitter-wasms/out/tree-sitter-go.wasm'),
  c: require.resolve('@cursorless/tree-sitter-wasms/out/tree-sitter-c.wasm'),
  cpp: require.resolve('@cursorless/tree-sitter-wasms/out/tree-sitter-cpp.wasm'),
  bash: require.resolve('@cursorless/tree-sitter-wasms/out/tree-sitter-bash.wasm'),
  java: require.resolve('@cursorless/tree-sitter-wasms/out/tree-sitter-java.wasm'),
  rust: require.resolve('@cursorless/tree-sitter-wasms/out/tree-sitter-rust.wasm'),
  csharp: require.resolve('@cursorless/tree-sitter-wasms/out/tree-sitter-c_sharp.wasm'),
  php: require.resolve('@cursorless/tree-sitter-wasms/out/tree-sitter-php.wasm'),
  ruby: require.resolve('@cursorless/tree-sitter-wasms/out/tree-sitter-ruby.wasm')
};
const TREE_SITTER_WASM_PATH = require.resolve('web-tree-sitter/web-tree-sitter.wasm');

const parserInitPromise = Parser.init({
  locateFile(scriptName) {
    return scriptName === 'web-tree-sitter.wasm' ? TREE_SITTER_WASM_PATH : scriptName;
  }
});
const languageCache = new BoundedCache({ maxSize: 16, ttlMs: 60 * 60 * 1000 });

function clipText(text, maxLen = 220) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 3)}...`;
}

function pointFromTarget(line, column) {
  return {
    row: Math.max(0, Number(line || 1) - 1),
    column: Math.max(0, Number(column || 1) - 1)
  };
}

function pointsEqual(left, right) {
  return left.row === right.row && left.column === right.column;
}

function summarizeNode(node) {
  if (!node) return '';
  const text = clipText(node.text, 96);
  return `${node.type}${text ? `: ${text}` : ''}`;
}

function selectEditableNode(node) {
  let current = node;
  while (current?.parent) {
    if (IDENTIFIER_NODE_TYPES.has(current.type)) {
      current = current.parent;
      continue;
    }
    if (current.type.endsWith('_declarator') || WRAPPER_NODE_TYPES.has(current.type)) {
      current = current.parent;
      continue;
    }
    break;
  }
  return current;
}

function astTargetForNode(relativePath, language, node) {
  const name = String(node.childForFieldName?.('name')?.text || '').trim();
  return {
    path: relativePath,
    language,
    ...(name ? { name } : {}),
    node_type: node.type,
    start_line: node.startPosition.row + 1,
    start_column: node.startPosition.column + 1,
    end_line: node.endPosition.row + 1,
    end_column: node.endPosition.column + 1,
    range_hash: sha256(node.text)
  };
}

function astTargetForSgNode(relativePath, language, node) {
  const range = node.range();
  const text = node.text();
  const nameNode = node.field?.('name');
  const name = String(nameNode?.text?.() || '').trim();
  return {
    path: relativePath,
    language,
    ...(name ? { name } : {}),
    node_type: node.kind(),
    start_line: range.start.line + 1,
    start_column: range.start.column + 1,
    end_line: range.end.line + 1,
    end_column: range.end.column + 1,
    range_hash: sha256(text)
  };
}

function inferLanguage(filePath, explicitLanguage = '') {
  const alias = LANGUAGE_ALIASES[String(explicitLanguage || '').trim().toLowerCase()];
  if (alias) return alias;
  const ext = path.extname(String(filePath || '')).toLowerCase();
  const inferred = EXTENSION_LANGUAGE_MAP[ext];
  if (!inferred) {
    throw new Error(`No Tree-sitter language configured for file: ${filePath}`);
  }
  return inferred;
}

function inferAstGrepLanguage(filePath, explicitLanguage = '', astGrep = null) {
  const normalized = LANGUAGE_ALIASES[String(explicitLanguage || '').trim().toLowerCase()] || '';
  const language = normalized || EXTENSION_LANGUAGE_MAP[path.extname(String(filePath || '')).toLowerCase()];
  const Lang = astGrep?.Lang;
  if (!Lang) return null;
  if (language === 'js') return { language: 'js', napi: Lang.JavaScript };
  if (language === 'ts') return { language: 'ts', napi: Lang.TypeScript };
  if (language === 'tsx') return { language: 'tsx', napi: Lang.Tsx };
  if (language === 'html') return { language: 'html', napi: Lang.Html };
  if (language === 'css') return { language: 'css', napi: Lang.Css };
  return null;
}

function astGrepCandidateExtensions(language = '') {
  if (language === 'js') return new Set(['.js', '.jsx', '.mjs', '.cjs']);
  if (language === 'ts') return new Set(['.ts']);
  if (language === 'tsx') return new Set(['.tsx']);
  if (language === 'html') return new Set(['.html']);
  if (language === 'css') return new Set(['.css', '.scss']);
  return new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.html', '.css', '.scss']);
}

async function loadAstGrep() {
  try {
    return await import('@ast-grep/napi');
  } catch (error) {
    const message = String(error?.message || '');
    if (error?.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find package '@ast-grep\/napi'|Cannot find module '@ast-grep\/napi'/i.test(message)) {
      return null;
    }
    throw error;
  }
}

async function loadLanguage(language) {
  await parserInitPromise;
  if (languageCache.has(language)) return languageCache.get(language);
  const wasmPath = LANGUAGE_WASM_PATHS[language];
  if (!wasmPath) throw new Error(`Unsupported Tree-sitter language: ${language}`);
  const loadPromise = Language.load(wasmPath);
  languageCache.set(language, loadPromise);
  try {
    return await loadPromise;
  } catch (error) {
    languageCache.delete(language);
    throw error;
  }
}

async function getParser(language) {
  const loadedLanguage = await loadLanguage(language);
  const parser = new Parser();
  parser.setLanguage(loadedLanguage);
  return { parser, loadedLanguage };
}

function deleteParsed(parsed) {
  try {
    parsed?.tree?.delete?.();
  } catch {}
  try {
    parsed?.parser?.delete?.();
  } catch {}
}

async function parseContent(content, language) {
  const { parser, loadedLanguage } = await getParser(language);
  const tree = parser.parse(content);
  return { parser, tree, loadedLanguage };
}

async function parseFile(root, relativePath, explicitLanguage = '') {
  const target = path.resolve(root, relativePath);
  const content = await fs.readFile(target, 'utf8');
  const language = inferLanguage(relativePath, explicitLanguage);
  const parsed = await parseContent(content, language);
  return {
    ...parsed,
    path: relativePath,
    absolutePath: target,
    content,
    language
  };
}

function exactNodeForTarget(rootNode, target) {
  const start = pointFromTarget(target.start_line, target.start_column);
  const end = pointFromTarget(target.end_line, target.end_column);
  let current = rootNode.namedDescendantForPosition(start, end) || rootNode.descendantForPosition(start, end);
  while (current) {
    if (pointsEqual(current.startPosition, start) && pointsEqual(current.endPosition, end)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Find the enclosing named structural symbol (function, class, method, etc.)
 * for a given line range in already-parsed content. Returns null if not found
 * or if the language is unsupported.
 */
export async function findEnclosingSymbol(content, filePath, line) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  const language = EXTENSION_LANGUAGE_MAP[ext];
  if (!language) return null;
  let parser = null;
  let tree = null;
  try {
    const parsed = await parseContent(content, language);
    parser = parsed.parser;
    tree = parsed.tree;
    const row = Math.max(0, Number(line || 1) - 1);
    const node = tree.rootNode.descendantForPosition({ row, column: 0 });
    let current = node;
    while (current) {
      if (current.type === 'program' || !current.parent) break;
      const nameChild = current.childForFieldName('name');
      if (nameChild) {
        return {
          name: nameChild.text,
          kind: current.type,
          start_line: current.startPosition.row + 1,
          end_line: current.endPosition.row + 1
        };
      }
      current = current.parent;
    }
    return null;
  } catch {
    return null;
  } finally {
    deleteParsed({ tree, parser });
  }
}

export async function queryAst(root, args) {
  const relativePath = String(args?.path || '').trim();
  const querySource = String(args?.query || '').trim();
  if (!relativePath || !querySource) {
    throw new Error('ast_query requires path and query');
  }
  const captureName = String(args?.capture_name || '').trim();
  const maxResults = Math.max(1, Math.min(100, Number(args?.max_results || 12)));
  const parsed = await parseFile(root, relativePath, args?.language);
  const query = new Query(parsed.loadedLanguage, querySource);
  const captures = query.captures(parsed.tree.rootNode);
  const matches = [];

  for (const capture of captures) {
    if (captureName && capture.name !== captureName) continue;
    const targetNode = selectEditableNode(capture.node);
    matches.push({
      capture: capture.name,
      node_type: targetNode.type,
      start_line: targetNode.startPosition.row + 1,
      start_column: targetNode.startPosition.column + 1,
      end_line: targetNode.endPosition.row + 1,
      end_column: targetNode.endPosition.column + 1,
      text: clipText(targetNode.text),
      ast_target: astTargetForNode(relativePath, parsed.language, targetNode)
    });
    if (matches.length >= maxResults) break;
  }

  query.delete();
  deleteParsed(parsed);

  return {
    path: relativePath,
    language: parsed.language,
    query: querySource,
    capture_name: captureName || undefined,
    matches,
    truncated: captures.length > matches.length
  };
}

export async function queryAstGrep(root, args) {
  const patternSource = String(args?.pattern || args?.query || '').trim();
  if (!patternSource) throw new Error('ast_grep requires pattern');
  const maxResults = Math.max(1, Math.min(200, Number(args?.max_results || 50)));
  const startPath = String(args?.path || '.').trim() || '.';
  const astGrep = await loadAstGrep();
  if (!astGrep) {
    throw new Error('ast_grep requires @ast-grep/napi. Install it with npm install @ast-grep/napi.');
  }

  const absoluteStart = path.resolve(root, startPath);
  const stat = await fs.stat(absoluteStart);
  const candidateFiles = stat.isDirectory()
    ? await globFilesUnder(absoluteStart, { skipDirs: SKIP_DIRS })
    : [absoluteStart];
  const requestedLanguage = String(args?.language || '').trim();
  const allExtensions = astGrepCandidateExtensions(
    LANGUAGE_ALIASES[requestedLanguage.toLowerCase()] || requestedLanguage.toLowerCase()
  );
  const matches = [];

  for (const absolutePath of candidateFiles) {
    if (!allExtensions.has(path.extname(absolutePath).toLowerCase())) continue;
    const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
    const langInfo = inferAstGrepLanguage(relativePath, requestedLanguage, astGrep);
    if (!langInfo) continue;
    const content = await fs.readFile(absolutePath, 'utf8');
    const parsed = astGrep.parse(langInfo.napi, content);
    const nodes = parsed.root().findAll(patternSource);
    for (const node of nodes) {
      const range = node.range();
      matches.push({
        node_type: node.kind(),
        start_line: range.start.line + 1,
        start_column: range.start.column + 1,
        end_line: range.end.line + 1,
        end_column: range.end.column + 1,
        text: clipText(node.text()),
        ast_target: astTargetForSgNode(relativePath, langInfo.language, node)
      });
      if (matches.length >= maxResults) {
        return {
          path: startPath,
          pattern: patternSource,
          engine: 'ast-grep',
          matches,
          truncated: true
        };
      }
    }
  }

  return {
    path: startPath,
    pattern: patternSource,
    engine: 'ast-grep',
    matches,
    truncated: false
  };
}

export async function readAstNode(root, args) {
  const relativePath = String(args?.path || args?.ast_target?.path || '').trim();
  const astTarget = args?.ast_target;
  if (!relativePath || !astTarget) throw new Error('read_ast_node requires path and ast_target');
  const parsed = await parseFile(root, relativePath, astTarget.language || args?.language);
  const node = exactNodeForTarget(parsed.tree.rootNode, astTarget);
  if (!node) {
    throw new Error('AST target no longer matches the current file');
  }

  const result = {
    path: relativePath,
    language: parsed.language,
    node: {
      node_type: node.type,
      start_line: node.startPosition.row + 1,
      start_column: node.startPosition.column + 1,
      end_line: node.endPosition.row + 1,
      end_column: node.endPosition.column + 1
    },
    content: node.text,
    parent_summary: summarizeNode(node.parent),
    child_summaries: node.namedChildren.slice(0, 8).map((child) => summarizeNode(child))
  };

  deleteParsed(parsed);
  return result;
}

export async function resolveAstTarget(root, relativePath, astTarget) {
  if (!astTarget || typeof astTarget !== 'object') {
    throw new Error('ast_target is required for AST-scoped edit');
  }
  if (String(astTarget.path || '').trim() !== String(relativePath || '').trim()) {
    throw new Error('ast_target path does not match edit file');
  }

  const parsed = await parseFile(root, relativePath, astTarget.language);
  const node = exactNodeForTarget(parsed.tree.rootNode, astTarget);
  if (!node) {
    deleteParsed(parsed);
    throw new Error('AST target no longer matches the current file');
  }

  const currentHash = sha256(node.text);
  if (String(astTarget.range_hash || '') !== currentHash) {
    deleteParsed(parsed);
    throw new Error('ast_target range_hash mismatch; the selected node changed and is now stale');
  }

  return {
    ...parsed,
    node,
    current_hash: currentHash
  };
}
