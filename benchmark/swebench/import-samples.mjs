#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const API_BASE_URL = 'https://datasets-server.huggingface.co/filter';
const DEFAULT_OUTPUT_DIR = 'benchmark/swebench/data';
const execFileAsync = promisify(execFile);

function buildNetworkEnv() {
  const env = { ...process.env };
  return env;
}

const DIFFICULTY_LABELS = {
  medium: ['15 min - 1 hour'],
  high: ['1-4 hours', '>4 hours']
};

export function getDifficultyLabels(level) {
  const normalized = String(level || '').trim().toLowerCase();
  const labels = DIFFICULTY_LABELS[normalized];
  if (!labels) {
    throw new Error(`Unknown difficulty: ${level}`);
  }
  return labels;
}

export function parseImportArgs(args) {
  const parsed = {
    difficulties: [],
    perDifficulty: 5,
    outputDir: DEFAULT_OUTPUT_DIR,
    dataset: 'SWE-bench/SWE-bench_Verified',
    config: 'default',
    split: 'test'
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--difficulty') {
      parsed.difficulties.push((args[i + 1] || '').toLowerCase());
      i += 1;
      continue;
    }
    if (arg === '--per-difficulty') {
      parsed.perDifficulty = Number(args[i + 1] || parsed.perDifficulty);
      i += 1;
      continue;
    }
    if (arg === '--output-dir') {
      parsed.outputDir = args[i + 1] || parsed.outputDir;
      i += 1;
      continue;
    }
    if (arg === '--dataset') {
      parsed.dataset = args[i + 1] || parsed.dataset;
      i += 1;
      continue;
    }
    if (arg === '--config') {
      parsed.config = args[i + 1] || parsed.config;
      i += 1;
      continue;
    }
    if (arg === '--split') {
      parsed.split = args[i + 1] || parsed.split;
      i += 1;
      continue;
    }
  }

  if (parsed.difficulties.length === 0) {
    parsed.difficulties = ['medium', 'high'];
  }
  return parsed;
}

export function buildRowsUrl({ dataset, config, split, difficultyLabel, offset, length }) {
  const url = new URL(API_BASE_URL);
  url.searchParams.set('dataset', dataset);
  url.searchParams.set('config', config);
  url.searchParams.set('split', split);
  url.searchParams.set('where', `"difficulty" = '${difficultyLabel}'`);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('length', String(length));
  return url.toString();
}

export function normalizeApiRows(rows) {
  return rows.map((entry) => {
    const row = entry?.row || {};
    return {
      instance_id: row.instance_id,
      repo: row.repo,
      base_commit: row.base_commit,
      problem_statement: row.problem_statement,
      FAIL_TO_PASS: row.FAIL_TO_PASS,
      PASS_TO_PASS: row.PASS_TO_PASS,
      hints_text: row.hints_text,
      difficulty: row.difficulty
    };
  });
}

async function fetchJson(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  } catch (error) {
    const escapedUrl = url.replace(/'/g, "'\\''");
    const { stdout } = await execFileAsync('/bin/bash', ['-lc', `curl -fsSL '${escapedUrl}'`], {
      cwd: process.cwd(),
      env: buildNetworkEnv(),
      maxBuffer: 20 * 1024 * 1024
    });
    return JSON.parse(stdout);
  }
}

async function fetchRowsForLabel({ dataset, config, split, difficultyLabel, length }) {
  const payload = await fetchJson(
    buildRowsUrl({
      dataset,
      config,
      split,
      difficultyLabel,
      offset: 0,
      length
    })
  );
  return normalizeApiRows(payload.rows || []);
}

async function writeJsonl(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.writeFile(filePath, body ? `${body}\n` : '', 'utf-8');
}

function mergeRows(lists, maxCount) {
  const merged = [];
  for (const list of lists) {
    for (const row of list) {
      if (merged.length >= maxCount) return merged;
      merged.push(row);
    }
  }
  return merged;
}

function printUsage() {
  console.log(`Usage:
  node benchmark/swebench/import-samples.mjs [options]

Options:
  --difficulty <medium|high>   Repeatable. Defaults to medium + high
  --per-difficulty <n>         Number of samples per output file (default: 5)
  --output-dir <path>          Output directory (default: benchmark/swebench/data)
  --dataset <name>             Hugging Face dataset name
  --config <name>              Dataset config (default: default)
  --split <name>               Dataset split (default: test)`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const options = parseImportArgs(args);
  await fs.mkdir(options.outputDir, { recursive: true });

  const summary = {
    dataset: options.dataset,
    config: options.config,
    split: options.split,
    perDifficulty: options.perDifficulty,
    generatedAt: new Date().toISOString(),
    files: []
  };

  for (const difficulty of options.difficulties) {
    const labels = getDifficultyLabels(difficulty);
    const labelRows = [];
    for (const label of labels) {
      const rows = await fetchRowsForLabel({
        dataset: options.dataset,
        config: options.config,
        split: options.split,
        difficultyLabel: label,
        length: options.perDifficulty
      });
      labelRows.push(rows);
    }

    const merged = mergeRows(labelRows, options.perDifficulty);
    const outputPath = path.join(options.outputDir, `verified-${difficulty}.sample.jsonl`);
    await writeJsonl(outputPath, merged);
    summary.files.push({
      difficulty,
      labels,
      count: merged.length,
      outputPath
    });
    console.log(`${difficulty}: wrote ${merged.length} rows -> ${outputPath}`);
  }

  const summaryPath = path.join(options.outputDir, 'verified-samples.summary.json');
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`summary: ${summaryPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`swebench import error: ${error.message}`);
    process.exit(1);
  });
}
