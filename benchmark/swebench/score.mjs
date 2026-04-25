#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { loadInstances, writePredictions } from './lib.mjs';

const SAMPLE_PATHS = {
  medium: 'benchmark/swebench/data/verified-medium.sample.jsonl',
  high: 'benchmark/swebench/data/verified-high.sample.jsonl'
};

export function resolveSamplePath(difficulty) {
  const normalized = String(difficulty || '').trim().toLowerCase();
  const filePath = SAMPLE_PATHS[normalized];
  if (!filePath) {
    throw new Error(`Unknown difficulty: ${difficulty}`);
  }
  return filePath;
}

export function parseScoreArgs(args) {
  const parsed = {
    difficulty: 'medium',
    index: 1,
    runId: undefined,
    maxWorkers: 1,
    pythonBin: 'python',
    datasetName: 'princeton-nlp/SWE-bench_Verified',
    codeminiBin: 'node bin/coder.js',
    model: undefined,
    maxSteps: 12
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--difficulty') {
      parsed.difficulty = (args[i + 1] || parsed.difficulty).toLowerCase();
      i += 1;
      continue;
    }
    if (arg === '--index') {
      parsed.index = Number(args[i + 1] || parsed.index);
      i += 1;
      continue;
    }
    if (arg === '--run-id') {
      parsed.runId = args[i + 1] || parsed.runId;
      i += 1;
      continue;
    }
    if (arg === '--max-workers') {
      parsed.maxWorkers = Number(args[i + 1] || parsed.maxWorkers);
      i += 1;
      continue;
    }
    if (arg === '--python-bin') {
      parsed.pythonBin = args[i + 1] || parsed.pythonBin;
      i += 1;
      continue;
    }
    if (arg === '--dataset-name') {
      parsed.datasetName = args[i + 1] || parsed.datasetName;
      i += 1;
      continue;
    }
    if (arg === '--codemini-bin') {
      parsed.codeminiBin = args[i + 1] || parsed.codeminiBin;
      i += 1;
      continue;
    }
    if (arg === '--model') {
      parsed.model = args[i + 1] || parsed.model;
      i += 1;
      continue;
    }
    if (arg === '--max-steps') {
      parsed.maxSteps = Number(args[i + 1] || parsed.maxSteps);
      i += 1;
      continue;
    }
  }

  return parsed;
}

export function selectInstanceByIndex(instances, index) {
  const selected = instances[index - 1];
  if (!selected) {
    throw new Error(`Index out of range: ${index}. Available instances: ${instances.length}`);
  }
  return selected;
}

export function buildHarnessArgs({ datasetName, predictionsPath, instanceId, maxWorkers, runId }) {
  return [
    '-m',
    'swebench.harness.run_evaluation',
    '--dataset_name',
    datasetName,
    '--predictions_path',
    predictionsPath,
    '--instance_ids',
    instanceId,
    '--max_workers',
    String(maxWorkers),
    '--run_id',
    runId
  ];
}

function splitCommand(command) {
  const matches = String(command || '').match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return matches.map((part) => part.replace(/^['"]|['"]$/g, ''));
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? 1}`));
    });
  });
}

function defaultRunId({ difficulty, index }) {
  return `${difficulty}-${index}`;
}

function printUsage() {
  console.log(`Usage:
  node benchmark/swebench/score.mjs [options]

Options:
  --difficulty <medium|high>   Sample set to use (default: medium)
  --index <n>                  One-based sample index inside the chosen set
  --run-id <id>                Output/evaluation run label (default: <difficulty>-<index>)
  --max-workers <n>            SWE-bench harness workers (default: 1)
  --python-bin <cmd>           Python executable for official harness (default: python)
  --dataset-name <name>        SWE-bench dataset name (default: princeton-nlp/SWE-bench_Verified)
  --codemini-bin <cmd>         Command used to invoke CodeMini (default: "node bin/coder.js")
  --model <name>               Optional CodeMini model override
  --max-steps <n>              Optional CodeMini max steps override`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const options = parseScoreArgs(args);
  const samplePath = resolveSamplePath(options.difficulty);
  const instances = await loadInstances(samplePath);
  const selected = selectInstanceByIndex(instances, options.index);
  const runId = options.runId || defaultRunId(options);
  const runDir = path.join('benchmark/swebench/runs', runId);
  const selectedPath = path.join(runDir, 'selected-instance.jsonl');
  const predictionsPath = path.join(runDir, 'predictions.jsonl');

  await fs.mkdir(runDir, { recursive: true });
  await writePredictions(selectedPath, [selected]);

  const runnerArgs = [
    'benchmark/swebench/run.mjs',
    '--instances',
    selectedPath,
    '--output',
    predictionsPath,
    '--run-id',
    runId,
    '--codemini-bin',
    options.codeminiBin,
    '--max-steps',
    String(options.maxSteps)
  ];
  if (options.model) {
    runnerArgs.push('--model', options.model);
  }

  console.log(`Selected instance: ${selected.instance_id}`);
  console.log(`Generating prediction in ${predictionsPath}`);
  await runCommand('node', runnerArgs);

  console.log(`Running official SWE-bench harness for ${selected.instance_id}`);
  await runCommand(
    options.pythonBin,
    buildHarnessArgs({
      datasetName: options.datasetName,
      predictionsPath,
      instanceId: selected.instance_id,
      maxWorkers: options.maxWorkers,
      runId
    })
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`swebench score error: ${error.message}`);
    process.exit(1);
  });
}
