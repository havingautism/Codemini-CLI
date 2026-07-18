export async function finishInitialization({
  tasks,
  isAlive,
  update,
  connect,
}) {
  if (!isAlive()) return false;
  connect();
  await Promise.allSettled(Array.isArray(tasks) ? tasks : []);
  if (!isAlive()) return false;
  update({ initialLoading: false });
  return true;
}

export async function hydrateBeforeConnect({ hydrate, connect, isAlive = () => true }) {
  await hydrate();
  if (isAlive()) connect();
}
