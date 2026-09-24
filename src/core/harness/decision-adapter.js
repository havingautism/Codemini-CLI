import { createDecisionRequest, createDecisionResponse } from './contracts.js';
import { createRulesProvider } from './providers/rules.js';
import { createJevProvider } from './providers/jev.js';
import { createLayaProvider } from './providers/laya.js';

export function createDecisionAdapter({ providers = {}, provider = 'rules', shadowProviders = [] } = {}) {
  const registry = { rules: createRulesProvider(), ...Object.fromEntries(Object.entries(providers).filter(([, value]) => value)) };
  const shadows = Array.isArray(shadowProviders) ? shadowProviders.filter((name) => registry[name]) : [];
  return {
    async ask(input = {}) {
      const request = createDecisionRequest({ ...input, providerHint: input.providerHint || provider });
      const selected = registry[request.providerHint] || registry.rules;
      try {
        return await selected.ask(request);
      } catch (error) {
        return createDecisionResponse({
          provider: selected.name || request.providerHint,
          errors: [error?.message || String(error)],
          answers: request.questions.map((question) => ({ id: question.id, type: question.type, abstain: true })),
        });
      }
    },
    async askShadow(input = {}) {
      const names = [input.providerHint || provider, ...shadows].filter((name, index, all) => all.indexOf(name) === index);
      const results = await Promise.all(names.map(async (name) => {
        const selected = registry[name] || registry.rules;
        try { return await selected.ask({ ...input, providerHint: name }); }
        catch (error) { return createDecisionResponse({ provider: name, errors: [error?.message || String(error)] }); }
      }));
      return results;
    }
  };
}

export function createConfiguredDecisionProviders(config = {}) {
  const timeoutMs = config.timeoutMs || 1500;
  const jev = config.jev?.enabled && config.jev.baseUrl
    ? createJevProvider({ baseUrl: config.jev.baseUrl, apiKey: config.jev.apiKey, model: config.jev.model, timeoutMs })
    : null;
  const laya = config.laya?.enabled && config.laya.baseUrl
    ? createLayaProvider({ baseUrl: config.laya.baseUrl, model: config.laya.model, timeoutMs })
    : null;
  return { jev, laya };
}
