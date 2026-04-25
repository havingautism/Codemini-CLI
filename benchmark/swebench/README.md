# SWE-bench Verified Runner

This directory contains a small runner for generating SWE-bench style `predictions.jsonl` files with CodeMini CLI.

## What it does

1. Reads a local JSON or JSONL file of SWE-bench instances
2. Sends each instance to `codemini run`
3. Extracts the final unified diff from the CLI output
4. Writes SWE-bench predictions plus raw transcripts

## Expected input

Provide a local file containing objects with at least:

- `instance_id`
- `problem_statement`

Recommended additional fields:

- `repo`
- `base_commit`
- `FAIL_TO_PASS`
- `PASS_TO_PASS`

You can export a small local sample from Hugging Face with something like:

```python
from datasets import load_dataset
import json

rows = load_dataset("SWE-bench/SWE-bench_Verified", split="test").select(range(5))
with open("benchmark/swebench/data/verified-smoke.jsonl", "w", encoding="utf-8") as f:
    for row in rows:
        f.write(json.dumps(row) + "\n")
```

## Run

```bash
node benchmark/swebench/run.mjs \
  --instances benchmark/swebench/data/verified-smoke.jsonl \
  --output benchmark/swebench/runs/verified-smoke/predictions.jsonl \
  --run-id verified-smoke \
  --max-steps 12
```

If you want to force a specific model:

```bash
node benchmark/swebench/run.mjs \
  --instances benchmark/swebench/data/verified-smoke.jsonl \
  --output benchmark/swebench/runs/verified-smoke/predictions.jsonl \
  --model your-model-name
```

## Run one medium/high sample and score it

This helper picks one local sample by position, runs CodeMini on it, then launches the official SWE-bench harness:

```bash
node benchmark/swebench/score.mjs --difficulty medium --index 1
node benchmark/swebench/score.mjs --difficulty high --index 2
```

Equivalent npm script:

```bash
npm run benchmark:swebench:score -- --difficulty high --index 3
```

Notes:

- `--index` is 1-based
- output goes to `benchmark/swebench/runs/<run-id>/`
- official scoring still requires `swebench` installed plus Docker available locally

## Import medium/high samples

You can import curated local sample files directly from the Hugging Face dataset viewer API:

```bash
node benchmark/swebench/import-samples.mjs \
  --difficulty medium \
  --difficulty high \
  --per-difficulty 5
```

This writes:

- `benchmark/swebench/data/verified-medium.sample.jsonl`
- `benchmark/swebench/data/verified-high.sample.jsonl`
- `benchmark/swebench/data/verified-samples.summary.json`

Current difficulty mapping:

- `medium` -> `15 min - 1 hour`
- `high` -> `1-4 hours` and `>4 hours`

## Output

- `runs/<run>/predictions.jsonl`: SWE-bench-ready predictions
- `runs/<run>/predictions.summary.json`: lightweight local summary
- `runs/<run>/transcripts/*.log`: raw CLI stdout/stderr for debugging

## Next step

Once `predictions.jsonl` looks good, feed it into the official SWE-bench harness or `sb-cli`.
