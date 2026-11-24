import {
  createVisualFeedbackController,
  formatVisualFeedbackMessage,
} from '../../src/core/browser/visual-feedback.js';
import { visualFeedbackUserMessageFields } from '../client/src/lib/visual-feedback-message.js';

const controllers = new Map();

function controllerFor(bridge, sessionId) {
  const id = String(sessionId || '').trim();
  const existing = controllers.get(id);
  if (existing?.bridge === bridge) return existing.controller;
  const controller = createVisualFeedbackController({
    getSession: () => bridge.getBrowserSession?.(),
    workspaceRoot: bridge.getWorkspaceRoot?.() || process.cwd(),
    onSubmit: async (payload) => {
      const message = formatVisualFeedbackMessage(payload);
      const result = bridge.handleSubmitMessage({
        text: message.text,
        modelText: message.modelText,
        modelImages: message.modelImages,
        attachments: message.attachments,
        ...visualFeedbackUserMessageFields(message.modelText),
      });
      if (result?.accepted === false) {
        return {
          ok: false,
          code: 'BUSY',
          error: result.message || 'Codemini is busy. Submit again after the current turn finishes.',
        };
      }
      return { ok: true };
    },
  });
  controllers.set(id, { bridge, controller });
  return controller;
}

export function getVisualFeedbackController(bridge, sessionId) {
  return controllerFor(bridge, sessionId);
}

export async function openVisualFeedbackSession(bridge, sessionId, options = {}) {
  return controllerFor(bridge, sessionId).open(options);
}

export async function visualFeedbackStatus(bridge, sessionId, options = {}) {
  const id = String(sessionId || '').trim();
  if (controllers.has(id)) return controllers.get(id).controller.status(options);
  return controllerFor(bridge, sessionId).status(options);
}

export async function closeVisualFeedbackSession(bridge, sessionId, options = {}) {
  const id = String(sessionId || '').trim();
  const entry = controllers.get(id);
  if (!entry) return { ok: true, open: false };
  const result = await entry.controller.close(options);
  controllers.delete(id);
  return result;
}
