export function shouldCaptureEscapeSequence(value, currentSequence = '') {
  if (value === '\u001b') return true;
  if (!currentSequence) return false;

  if (currentSequence === '\u001b') {
    return value === '[';
  }
  if (currentSequence === '\u001b[') {
    return value === '3';
  }
  if (currentSequence === '\u001b[3') {
    return value === '~' || value === ';';
  }
  if (currentSequence === '\u001b[3;') {
    return value === '2' || value === '5';
  }
  if (currentSequence === '\u001b[3;2' || currentSequence === '\u001b[3;5') {
    return value === '~';
  }
  return false;
}
