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
