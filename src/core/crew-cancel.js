export function createCrewCancelReason() {
  return { crewCancel: true };
}

export function isCrewCancelSignal(signal) {
  const reason = signal?.reason;
  return Boolean(signal?.aborted && reason && typeof reason === 'object' && reason.crewCancel === true);
}

export function abortErrorFromSignal(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Aborted');
  error.name = 'AbortError';
  if (isCrewCancelSignal(signal)) error.crewCancel = true;
  return error;
}
