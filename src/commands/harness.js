import { createHarnessSqliteStore } from '../core/harness/audit/harness-sqlite-store.js';
import { summarizeHarnessMetrics } from '../core/harness/metrics.js';
import fs from 'node:fs/promises';
import { calculateCalibrationMetrics, calculateDriftMetrics, calibrationDatasetHash, parseCalibrationJsonl } from '../core/harness/calibration.js';
import { extractCalibrationRows } from '../core/harness/eval/history-labels.js';
import { createCalibrationVersion, fitBinaryPriors, fitNetworkCpts } from '../core/harness/eval/cpt-trainer.js';

function usage() {
  console.log('Usage:\n  codemini harness replay <episode-id>\n  codemini harness metrics [--limit <n>]');
  console.log('  codemini harness calibrate <jsonl> [--out <json>]\n  codemini harness drift <jsonl>');
  console.log('  codemini harness calibrate-history [--limit <n>] [--out <json>]');
}

async function writeReportIfRequested(args, report) {
  const index = args.indexOf('--out');
  if (index < 0 || !args[index + 1]) return;
  const outputPath = args[index + 1];
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`已写入校准报告：${outputPath}`);
}

export async function handleHarness(args = []) {
  const [sub, value] = args;
  if (sub === 'replay' && value) {
    const store = createHarnessSqliteStore();
    const episodes = store.listEpisodes({ limit: 1000 }).filter((episode) => episode.id === value);
    if (!episodes.length) throw new Error(`Episode not found: ${value}`);
    console.log(JSON.stringify({ episode: episodes[0], events: store.listEpisodeEvents(value) }, null, 2));
    return;
  }
  if (sub === 'metrics') {
    const store = createHarnessSqliteStore();
    const limitIndex = args.indexOf('--limit');
    const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 100;
    const episodes = store.listEpisodes({ limit });
    const events = episodes.flatMap((episode) => store.listEpisodeEvents(episode.id));
    console.log(JSON.stringify(summarizeHarnessMetrics({ episodes, events }), null, 2));
    return;
  }
  if ((sub === 'calibrate' || sub === 'drift') && value) {
    const rows = parseCalibrationJsonl(await fs.readFile(value, 'utf8'));
    const report = sub === 'calibrate'
      ? {
        datasetHash: calibrationDatasetHash(rows),
        generatedAt: new Date().toISOString(),
        calibration: fitBinaryPriors(rows),
        cpts: fitNetworkCpts(rows),
        version: createCalibrationVersion({ datasetHash: calibrationDatasetHash(rows), params: { method: 'dirichlet-laplace' } }),
        ...calculateCalibrationMetrics(rows),
      }
      : { datasetHash: calibrationDatasetHash(rows), generatedAt: new Date().toISOString(), drift: calculateDriftMetrics(rows) };
    await writeReportIfRequested(args, report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (sub === 'calibrate-history') {
    const store = createHarnessSqliteStore();
    const limitIndex = args.indexOf('--limit');
    const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 1000;
    const episodes = store.listEpisodes({ limit });
    const eventsByEpisode = new Map(episodes.map((episode) => [episode.id, store.listEpisodeEvents(episode.id)]));
    const rows = extractCalibrationRows(episodes, eventsByEpisode);
    const datasetHash = calibrationDatasetHash(rows);
    const report = {
      datasetHash,
      generatedAt: new Date().toISOString(),
      source: 'harness-history',
      calibration: fitBinaryPriors(rows),
      cpts: fitNetworkCpts(rows),
      version: createCalibrationVersion({ datasetHash, params: { method: 'dirichlet-laplace', source: 'history' } }),
      ...calculateCalibrationMetrics(rows),
    };
    await writeReportIfRequested(args, report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  usage();
}
