import { composeExplicitSkillPrompt } from './command-loader.js';

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

export function formatSelectedSkillTurn(skillNames) {
  return ['skill:', '[', uniqueStrings(skillNames).join(','), ']'].join('');
}

export function normalizeChatSubmission(input = {}) {
  return {
    text: String(input.text || '').trim(),
    skillNames: uniqueStrings(input.skillNames),
    attachmentIds: uniqueStrings(input.attachmentIds),
    dismissedAlwaysSkills: uniqueStrings(input.dismissedAlwaysSkills)
  };
}

export function composeSelectedSkills(commands, submission, options = {}) {
  const normalized = normalizeChatSubmission(submission);
  if (normalized.skillNames.length === 0) {
    return {
      text: normalized.text,
      modelText: normalized.text,
      skillNames: []
    };
  }

  const composed = composeExplicitSkillPrompt(
    commands,
    normalized.skillNames,
    normalized.text,
    {
      isEnabled(command) {
        if (command?.metadata?.enabled === false) return false;
        return typeof options.isEnabled !== 'function' || options.isEnabled(command);
      }
    }
  );
  if (composed.error) return { error: composed.error };
  return {
    text: normalized.text || formatSelectedSkillTurn(normalized.skillNames),
    modelText: composed.prompt,
    skillNames: normalized.skillNames
  };
}

export function appendAttachmentContext(modelText, suppliedModelText) {
  const base = String(modelText || '');
  const supplied = String(suppliedModelText || '').trim();
  const attachmentStart = supplied.indexOf('<uploaded_attachments>');
  return attachmentStart >= 0
    ? `${base}\n\n${supplied.slice(attachmentStart)}`
    : base;
}
