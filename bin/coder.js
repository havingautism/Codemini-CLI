#!/usr/bin/env node
import { runCli } from '../src/cli.js';

runCli(process.argv.slice(2)).catch((err) => {
  console.error(`codemini error: ${err.message}`);
  process.exit(1);
});
