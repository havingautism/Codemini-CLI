export async function finishInitialization({
  tasks,
  isAlive,
  update,
  connect,
}) {
  await Promise.all(tasks);
  if (!isAlive()) return false;
  update({ initialLoading: false });
  if (!isAlive()) return false;
  connect();
  return true;
}

export async function hydrateBeforeConnect({ hydrate, connect, isAlive = () => true }) {
  await hydrate();
  if (isAlive()) connect();
}
