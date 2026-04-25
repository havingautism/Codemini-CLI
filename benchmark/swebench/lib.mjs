import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_INSTANCES_PATH = 'benchmark/swebench/data/verified-smoke.jsonl';
const DEFAULT_OUTPUT_PATH = 'benchmark/swebench/runs/latest/predictions.jsonl';
const DEFAULT_TRANSCRIPT_DIR = 'benchmark/swebench/runs/latest/transcripts';

export function parseRunnerArgs(args) {
  const parsed = {
    instancesPath: DEFAULT_INSTANCES_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    transcriptDir: DEFAULT_TRANSCRIPT_DIR,
    limit: undefined,
    model: undefined,
    maxSteps: 12,
    codeminiBin: 'node bin/coder.js',
    runId: 'latest'
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--instances') {
      parsed.instancesPath = args[i + 1] || parsed.instancesPath;
      i += 1;
      continue;
    }
    if (arg === '--output') {
      parsed.outputPath = args[i + 1] || parsed.outputPath;
      i += 1;
      continue;
    }
    if (arg === '--transcripts') {
      parsed.transcriptDir = args[i + 1] || parsed.transcriptDir;
      i += 1;
      continue;
    }
    if (arg === '--limit') {
      parsed.limit = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--model') {
      parsed.model = args[i + 1] || undefined;
      i += 1;
      continue;
    }
    if (arg === '--max-steps') {
      parsed.maxSteps = Number(args[i + 1] || parsed.maxSteps);
      i += 1;
      continue;
    }
    if (arg === '--codemini-bin') {
      parsed.codeminiBin = args[i + 1] || parsed.codeminiBin;
      i += 1;
      continue;
    }
    if (arg === '--run-id') {
      parsed.runId = args[i + 1] || parsed.runId;
      i += 1;
      continue;
    }
  }

  if (!parsed.transcriptDir && parsed.outputPath) {
    parsed.transcriptDir = path.join(path.dirname(parsed.outputPath), 'transcripts');
  }
  if (parsed.transcriptDir === DEFAULT_TRANSCRIPT_DIR && parsed.outputPath !== DEFAULT_OUTPUT_PATH) {
    parsed.transcriptDir = path.join(path.dirname(parsed.outputPath), 'transcripts');
  }

  return parsed;
}

export function extractPatch(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';

  const fenced = raw.match(/```(?:diff|patch)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || raw).trim();
  const lines = candidate.split(/\r?\n/);
  const diffStart = lines.findIndex((line) => /^(diff --git|---\s+\S+)/.test(line));
  if (diffStart === -1) return '';

  const patchLines = [];
  for (const line of lines.slice(diffStart)) {
    if (!patchLines.length && !/^(diff --git|---\s+\S+)/.test(line)) continue;
    if (patchLines.length && /^```/.test(line)) break;
    patchLines.push(line);
  }
  return patchLines.join('\n').trim();
}

export function buildPredictionRecord({ instanceId, modelName, patch }) {
  return {
    instance_id: String(instanceId || '').trim(),
    model_name_or_path: String(modelName || 'codemini-cli').trim(),
    model_patch: String(patch || '').trim()
  };
}

export function buildTaskPrompt(instance) {
  const lines = [
    'You are solving one SWE-bench Verified task.',
    'Return only a unified git diff patch. Do not include markdown fences or explanations.',
    '',
    `Instance ID: ${instance.instance_id}`,
    `Repository: ${instance.repo || 'unknown'}`,
    `Base commit: ${instance.base_commit || 'unknown'}`,
    '',
    'Problem statement:',
    String(instance.problem_statement || '').trim()
  ];

  if (instance.FAIL_TO_PASS) {
    lines.push('', 'Fail-to-pass tests:', String(instance.FAIL_TO_PASS).trim());
  }
  if (instance.PASS_TO_PASS) {
    lines.push('', 'Pass-to-pass tests:', String(instance.PASS_TO_PASS).trim());
  }

  return lines.join('\n');
}

export async function loadInstances(instancesPath, { limit } = {}) {
  const raw = await fs.readFile(instancesPath, 'utf-8');
  const trimmed = raw.trim();
  const records = trimmed.startsWith('[')
    ? JSON.parse(trimmed)
    : trimmed
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));

  return typeof limit === 'number' && Number.isFinite(limit) ? records.slice(0, limit) : records;
}

export async function writePredictions(outputPath, records) {
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, body ? `${body}\n` : '', 'utf-8');
}

export function makeTranscriptPath(transcriptDir, instanceId) {
  const safeName = String(instanceId || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return path.join(transcriptDir, `${safeName}.log`);
}
