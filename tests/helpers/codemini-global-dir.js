let queue = Promise.resolve();

function restoreCodeminiGlobalDir(previous) {
  if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
  else process.env.CODEMINI_GLOBAL_DIR = previous;
}

/**
 * Serialize CODEMINI_GLOBAL_DIR mutations in this process.
 * Concurrent tests in one file share process.env; restoring the env while
 * another test is inside loadConfig/saveConfig can write config.json to the
 * real user global dir.
 */
export function withCodeminiGlobalDir(dir, task) {
  const run = async () => {
    const previous = process.env.CODEMINI_GLOBAL_DIR;
    process.env.CODEMINI_GLOBAL_DIR = dir;
    try {
      return await task();
    } finally {
      restoreCodeminiGlobalDir(previous);
    }
  };
  const next = queue.then(run, run);
  queue = next.then(() => undefined, () => undefined);
  return next;
}
