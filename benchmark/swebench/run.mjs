#!/usr/bin/env node
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

import {
  buildPredictionRecord,
  buildTaskPrompt,
  extractPatch,
  loadInstances,
  makeTranscriptPath,
  parseRunnerArgs,
  writePredictions
} from './lib.mjs';

function printUsage() {
  console.log(`Usage:
  node benchmark/swebench/run.mjs [options]

Options:
  --instances <path>     JSON or JSONL file containing SWE-bench instances
  --output <path>        Output predictions JSONL path
  --transcripts <path>   Directory for raw Codemini transcripts
  --limit <n>            Run only the first n instances
  --model <name>         Override the Codemini model for this benchmark run
  --max-steps <n>        Override Codemini max steps (default: 12)
  --codemini-bin <cmd>   Command used to invoke Codemini (default: "node bin/coder.js")
  --run-id <id>          Label stored in the run summary`);
}

function splitCommand(command) {
  const matches = String(command || '').match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return matches.map((part) => part.replace(/^['"]|['"]$/g, ''));
}

function runCodemini({ codeminiBin, prompt, model, maxSteps }) {
  const commandParts = splitCommand(codeminiBin);
  if (!commandParts.length) {
    throw new Error('codemini command is empty');
  }

  const [bin, ...baseArgs] = commandParts;
  const args = [...baseArgs, 'run', prompt, '--max-steps', String(maxSteps)];
  if (model) args.push('--model', model);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const options = parseRunnerArgs(args);
  const instances = await loadInstances(options.instancesPath, { limit: options.limit });
  await fs.mkdir(options.transcriptDir, { recursive: true });

  const predictions = [];
  const summary = {
    runId: options.runId,
    model: options.model || 'default',
    startedAt: new Date().toISOString(),
    instanceCount: instances.length,
    results: []
  };

  for (const instance of instances) {
    const prompt = buildTaskPrompt(instance);
    const result = await runCodemini({
      codeminiBin: options.codeminiBin,
      prompt,
      model: options.model,
      maxSteps: options.maxSteps
    });
    const patch = extractPatch(result.stdout);
    const record = buildPredictionRecord({
      instanceId: instance.instance_id,
      modelName: options.model || 'codemini-cli',
      patch
    });

    predictions.push(record);

    const transcriptPath = makeTranscriptPath(options.transcriptDir, instance.instance_id);
    await fs.writeFile(
      transcriptPath,
      [
        `# instance_id: ${instance.instance_id}`,
        `# exit_code: ${result.code}`,
        '',
        '[stdout]',
        result.stdout.trim(),
        '',
        '[stderr]',
        result.stderr.trim()
      ].join('\n'),
      'utf-8'
    );

    summary.results.push({
      instanceId: instance.instance_id,
      exitCode: result.code,
      transcriptPath,
      patchFound: Boolean(patch)
    });
    console.log(`[${summary.results.length}/${instances.length}] ${instance.instance_id} -> ${patch ? 'patch' : 'no-patch'}`);
  }

  summary.completedAt = new Date().toISOString();
  await writePredictions(options.outputPath, predictions);
  await fs.writeFile(
    options.outputPath.replace(/\.jsonl$/i, '.summary.json'),
    JSON.stringify(summary, null, 2),
    'utf-8'
  );

  console.log(`Predictions written to ${options.outputPath}`);
}

main().catch((error) => {
  console.error(`swebench runner error: ${error.message}`);
  process.exit(1);
});
