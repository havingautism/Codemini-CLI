export function createTowerCancelReason() {
  return { towerCancel: true };
}

export function isTowerCancelSignal(signal) {
  const reason = signal?.reason;
  return Boolean(signal?.aborted && reason && typeof reason === 'object' && reason.towerCancel === true);
}

export function abortErrorFromSignal(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Aborted');
  error.name = 'AbortError';
  if (isTowerCancelSignal(signal)) error.towerCancel = true;
  return error;
}
