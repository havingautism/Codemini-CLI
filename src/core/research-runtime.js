import { randomUUID } from 'node:crypto';

import { runAgentLoop } from './agent-loop.js';
import { createChatCompletionStream } from './provider/index.js';
import { resolveConfiguredReasoningEffort } from './provider/reasoning-effort.js';
import { getBuiltinTools } from './tools.js';
import { runResearchInvestigation, generateResearchConclusions } from './research-investigation.js';
import {
  appendResearchTimeline,
  buildResearchDbSummary,
  buildResearchWritingPack,
  getResearchSessionDetail,
  inferResearchPlanDepth,
  normalizeResearchPlanDepth,
  researchPlanDepthLimits,
  researchDepthRuntimeLimits,
  updateResearchSession,
  getResearchSession,
  validateResearchPlanByDepth,
} from './research-store.js';
import { normalizeGeneratedSessionTitle } from './session-title.js';

const activeRuns = new Map();

/**
 * Streaming completions for research Lead/Scout.
 * Scouts force reasoning off (tools + handoff matter more than thinking stream).
 */
function makeCompletionFn(config, onEvent, { reasoningOff = false } = {}) {
  return async ({ messages, tools, model, toolChoice, signal }) => {
    let started = false;
    const startAssistantStream = () => {
      if (started || typeof onEvent !== 'function') return;
      started = true;
      onEvent({
        type: 'assistant:start',
        sdkProvider: config.sdk?.provider === 'anthropic' ? 'anthropic' : 'openai-compatible',
        model,
      });
    };

    const result = await createChatCompletionStream({
      sdkProvider: config.sdk?.provider,
      baseUrl: config.gateway.base_url,
      apiKey: config.gateway.api_key,
      model,
      messages,
      tools,
      toolChoice,
      signal,
      reasoningEffort: reasoningOff
        ? 'off'
        : resolveConfiguredReasoningEffort({
          enabled: config.model?.reasoning_enabled,
          effort: config.model?.reasoning_effort,
        }),
      timeoutMs: config.gateway.timeout_ms || 1800000,
      maxRetries: config.gateway.max_retries ?? 2,
      maxTokens: (() => {
        const configured = Number(config.model?.max_output_tokens);
        if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
        return config.sdk?.provider === 'anthropic' ? 16384 : undefined;
      })(),
      onTextDelta: (delta) => {
        startAssistantStream();
        onEvent?.({ type: 'assistant:delta', text: delta });
      },
      onReasoningDelta: (delta) => {
        if (reasoningOff) return;
        startAssistantStream();
        onEvent?.({ type: 'assistant:reasoning_delta', text: delta });
      },
      onToolCallDelta: (toolCall) => {
        startAssistantStream();
        onEvent?.({ type: 'assistant:tool_call_delta', toolCall });
      },
    });

    if (!started && !result?.incomplete && (result?.text || result?.toolCalls?.length)) {
      startAssistantStream();
    }
    return result;
  };
}

function filterToolBundle(definitions, handlers, deferredDefinitions, allowNames) {
  const allowed = new Set(allowNames);
  const defs = (Array.isArray(definitions) ? definitions : []).filter((def) =>
    allowed.has(String(def?.function?.name || def?.name || '')),
  );
  const deferred = {};
  for (const [name, def] of Object.entries(deferredDefinitions || {})) {
    if (allowed.has(name)) deferred[name] = def;
  }
  // Promote web_search into active defs so Scouts need not tool_search first.
  if (allowed.has('web_search') && deferred.web_search) {
    const already = defs.some((d) => String(d?.function?.name) === 'web_search');
    if (!already) defs.push(deferred.web_search);
  }
  const handlerEntries = Object.entries(handlers || {}).filter(([name]) => allowed.has(name));
  return {
    definitions: defs,
    handlers: Object.fromEntries(handlerEntries),
    deferredDefinitions: deferred,
  };
}

function parseToolArgs(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function buildLeadSystemPrompt(phase, session) {
  const budget = session.budget || {};
  const used = session.budgetUsed || {};
  const depth = normalizeResearchPlanDepth(session.plan?.depth, 'standard');
  const runtime = researchDepthRuntimeLimits(depth);
  const toolsCap = runtime.toolsPerCriterion || runtime.searchesPerCriterionPerWave || 10;
  const maxWaves = 1;
  const common = [
    'You are the Lead researcher for Codemini Deep Research.',
    `Main question: ${session.question}`,
    session.preferences?.goal ? `Goal: ${session.preferences.goal}` : '',
    session.preferences?.constraints ? `Constraints: ${session.preferences.constraints}` : '',
    `Budget: investigation rounds ${used.waves || 0}/${maxWaves}, searches ${used.searches || 0}/${budget.maxSearches || 25}, fetches ${used.fetches || 0}/${budget.maxFetches || 200}.`,
    `Each success criterion may use at most ${toolsCap} tool calls (web_search + web_fetch). Investigation runs a single round — gaps become report limitations, not follow-up waves.`,
    `Max parallel scouts: ${budget.maxParallelScouts || 3}.`,
  ];

  if (phase === 'planning' || phase === 'awaiting_plan_confirm') {
    const inferred = inferResearchPlanDepth({
      question: session.question,
      goal: session.preferences?.goal,
    });
    const limits = researchPlanDepthLimits(inferred);
    return [
      ...common,
      'Phase: planning.',
      'First judge the main question depth, then split only as much as that depth needs.',
      `Depth for this question is likely "${inferred}" (brief|standard|deep). Prefer this unless the user clearly asks for more depth.`,
      'Depth budgets:',
      '- brief: at most 2 sub-questions, at most 2 success criteria each (narrow / quick / "简短" asks)',
      '- standard: at most 4 sub-questions, at most 3 success criteria each',
      '- deep: at most 6 sub-questions, at most 3 success criteria each',
      `For this run stay within ${limits.maxQuestions} sub-questions and ${limits.maxCriteriaPerQuestion} criteria per question unless the user explicitly requests a deeper study.`,
      'Create a research plan. If goal is empty, invent a concise goal in the same plan.',
      'Call submit_research_plan with JSON fields: title, depth, goal, coverageChecklist, questions.',
      'title must be one relevant emoji followed by one space and a concise natural topic label, matching the configured reply language. Do not add a Title: prefix or ending punctuation.',
      'depth must be one of brief|standard|deep.',
      'Each question needs tempId, text, successCriteria, dependsOn (tempId array).',
      'Each successCriteria item should be a short string, or {"text":"..."}.',
      'Prefer fewer, sharper sub-questions over a long checklist. Merge overlapping angles.',
      'If submit_research_plan returns ok:false because the plan exceeds the depth budget, silently resubmit a smaller plan that fits — do not explain the rejection to the user.',
      'Do not search the web in this phase. Do not call run_subagent.',
    ].filter(Boolean).join('\n');
  }

  if (phase === 'writing') {
    const depthGuidance = depth === 'brief'
      ? [
        'Depth is brief: aim for about 800-2000 Chinese characters (or proportional English length).',
        'Short answers are fine; still state what remains unverified in a few sentences.',
      ]
      : depth === 'deep'
        ? [
          'Depth is deep: aim for about 4000-10000 Chinese characters when the pack supports it.',
          'Expand mechanisms, contrasts, and evidence strength; still no academic template requirement.',
        ]
        : [
          'Depth is standard: aim for about 2000-5000 Chinese characters when the pack supports it.',
          'Prefer clear subheadings; keep substance over padding.',
        ];
    return [
      ...common,
      'Phase: writing.',
      'Write the final research report from the writing pack only.',
      'Hard rules:',
      '- Use only the writing pack. Do not invent facts, dates, or sources outside it.',
      '- Affirmative claims must be supportable by accepted evidence entries in the pack.',
      '- Limitations and unverified items from conclusions/session limitations must appear in the report.',
      '- Do not write a vendor marketing checklist.',
      'Soft guidance:',
      '- Organize by theme (themes may come from sub-questions; merge/rename headings freely).',
      '- Use criterion coverage/completeness as in-section detail, not mandatory section titles.',
      '- Prefer conclusion → evidence → limitations for substantive blocks (brief may compress this).',
      ...depthGuidance,
      'Length follows the pack: a thin pack means a shorter report is correct; do not pad.',
      'Do not call run_subagent or submit_research_commit.',
      'Do not require inline citation markers.',
      'Call submit_research_report with markdown report body when finished.',
    ].filter(Boolean).join('\n');
  }

  return [
    ...common,
    'Phase: investigating.',
    'Investigation is orchestrated automatically: Scouts search/fetch per criterion, submit candidates, and verified claims become evidence.',
    'Manual submit_research_commit is unused on this path.',
  ].filter(Boolean).join('\n');
}

function researchSubmitDefinitions(phase) {
  const plan = {
    type: 'function',
    function: {
      name: 'submit_research_plan',
      description: 'Submit the research plan draft for user confirmation. Oversized plans (too many sub-questions or criteria for the chosen depth) are rejected — shrink and call again.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'One relevant emoji followed by one space and a concise research title.',
          },
          goal: { type: 'string' },
          depth: {
            type: 'string',
            description: 'Research depth: brief | standard | deep. Choose from the main question complexity.',
            enum: ['brief', 'standard', 'deep'],
          },
          coverageChecklist: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
                met: { type: 'boolean' },
              },
              required: ['id', 'text'],
            },
          },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                tempId: { type: 'string' },
                text: { type: 'string' },
                successCriteria: {
                  type: 'array',
                  description: 'Criterion strings or objects {text}.',
                },
                dependsOn: { type: 'array', items: { type: 'string' } },
              },
              required: ['tempId', 'text'],
            },
          },
        },
        required: ['title', 'depth', 'questions'],
      },
    },
  };
  const commit = {
    type: 'function',
    function: {
      name: 'submit_research_commit',
      description: 'Commit accepted evidence and update sub-question status after reviewing Scout handoffs.',
      parameters: {
        type: 'object',
        properties: {
          acceptEvidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                questionId: { type: 'string' },
                claim: { type: 'string' },
                snippet: { type: 'string' },
                url: { type: 'string' },
                sourceLabel: { type: 'string' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                createdFrom: { type: 'string' },
              },
              required: ['questionId', 'claim'],
            },
          },
          revokeEvidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' } },
            },
          },
          questionUpdates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                questionId: { type: 'string' },
                status: { type: 'string' },
                gaps: { type: 'array', items: { type: 'string' } },
                criteriaMet: { type: 'array' },
              },
              required: ['questionId'],
            },
          },
          checklistUpdates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                met: { type: 'boolean' },
              },
              required: ['id', 'met'],
            },
          },
        },
      },
    },
  };
  const report = {
    type: 'function',
    function: {
      name: 'submit_research_report',
      description: 'Submit the final research report markdown.',
      parameters: {
        type: 'object',
        properties: {
          reportMarkdown: { type: 'string' },
        },
        required: ['reportMarkdown'],
      },
    },
  };
  if (phase === 'planning' || phase === 'awaiting_plan_confirm') return [plan];
  if (phase === 'writing') return [report];
  return [commit];
}

function createResearchSubmitHandlers(sessionId, phase, emit) {
  let planRejectCount = 0;
  const MAX_PLAN_REJECTS = 3;
  return {
    submit_research_plan: async (args = {}) => {
      const parsed = parseToolArgs(args);
      const session = getResearchSession(sessionId);
      const inferred = inferResearchPlanDepth({
        question: session?.question || '',
        goal: parsed.goal || session?.preferences?.goal || '',
      });
      // Brief cues in the user question always win over an over-ambitious model depth.
      const requested = parsed.depth
        ? normalizeResearchPlanDepth(parsed.depth, inferred)
        : inferred;
      const depth = inferred === 'brief' ? 'brief' : requested;
      const draft = {
        title: normalizeGeneratedSessionTitle(parsed.title, session?.question || ''),
        goal: String(parsed.goal || '').trim(),
        depth,
        coverageChecklist: Array.isArray(parsed.coverageChecklist)
          ? parsed.coverageChecklist.map((item, index) => ({
            id: String(item?.id || `c${index + 1}`),
            text: String(item?.text || '').trim(),
            met: Boolean(item?.met),
          }))
          : [],
        questions: Array.isArray(parsed.questions)
          ? parsed.questions.map((q, index) => ({
            tempId: String(q?.tempId || `q${index + 1}`),
            text: String(q?.text || '').trim(),
            successCriteria: Array.isArray(q?.successCriteria)
              ? q.successCriteria.map((item) => {
                if (item && typeof item === 'object') {
                  return { text: String(item.text || '').trim() };
                }
                return { text: String(item || '').trim() };
              }).filter((item) => item.text)
              : [],
            dependsOn: Array.isArray(q?.dependsOn) ? q.dependsOn.map(String) : [],
          }))
          : [],
      };
      const validated = validateResearchPlanByDepth(draft, { depth });
      if (!validated.ok) {
        planRejectCount += 1;
        const payload = {
          ok: false,
          error: validated.error,
          depth: validated.depth,
          maxQuestions: validated.limits?.maxQuestions,
          maxCriteriaPerQuestion: validated.limits?.maxCriteriaPerQuestion,
          questionCount: validated.questionCount ?? draft.questions?.length ?? 0,
          criteriaCount: validated.criteriaCount,
          questionId: validated.questionId,
          rejectCount: planRejectCount,
          maxRejects: MAX_PLAN_REJECTS,
        };
        if (planRejectCount >= MAX_PLAN_REJECTS) {
          emit?.({
            type: 'error',
            error: 'Research plan exceeded depth budget too many times',
          });
          return {
            ...payload,
            fatal: true,
            error: `${validated.error} Gave up after ${MAX_PLAN_REJECTS} oversized submissions.`,
          };
        }
        return payload;
      }
      planRejectCount = 0;
      const plan = validated.plan;
      const limits = validated.limits || researchPlanDepthLimits(plan.depth);
      const updated = updateResearchSession(sessionId, {
        plan,
        phase: 'awaiting_plan_confirm',
        preferences: plan.goal ? { goal: plan.goal } : undefined,
      });
      emit?.({ type: 'plan', plan: updated?.plan, phase: updated?.phase });
      return {
        ok: true,
        phase: 'awaiting_plan_confirm',
        depth: plan.depth,
        questionCount: plan.questions.length,
        maxQuestions: limits.maxQuestions,
        maxCriteriaPerQuestion: limits.maxCriteriaPerQuestion,
      };
    },
    submit_research_commit: async () => ({
      ok: true,
      noop: true,
      message: 'Evidence is verified and committed automatically during investigation. Manual submit_research_commit is unused.',
      insertedEvidenceIds: [],
      reusedEvidenceIds: [],
      revokedEvidenceIds: [],
      updatedQuestionIds: [],
    }),
    submit_research_report: async (args = {}) => {
      const parsed = parseToolArgs(args);
      const reportMarkdown = String(parsed.reportMarkdown || parsed.report || '').trim();
      if (!reportMarkdown) return { ok: false, error: 'reportMarkdown is required' };
      const updated = updateResearchSession(sessionId, {
        reportMarkdown,
        phase: 'done',
      });
      emit?.({ type: 'report', reportMarkdown: updated?.reportMarkdown, phase: 'done' });
      return { ok: true, phase: 'done' };
    },
  };
}

export function getActiveResearchRun(sessionId) {
  return activeRuns.get(String(sessionId || '')) || null;
}

export function abortResearchRun(sessionId) {
  const run = activeRuns.get(String(sessionId || ''));
  if (!run) return false;
  run.controller.abort();
  return true;
}

/**
 * Run one Lead agent-loop for the given research phase.
 * planning | investigating | writing
 */
export async function runResearchLeadTurn({
  sessionId,
  phase,
  config,
  model,
  workspaceRoot = process.cwd(),
  userPrompt,
  onEvent,
  signal,
} = {}) {
  const detail = getResearchSessionDetail(sessionId);
  if (!detail) throw new Error('research session not found');

  const resolvedPhase = phase || detail.phase;
  if (
    resolvedPhase === 'writing'
    && !['ready_for_report', 'writing', 'done'].includes(detail.phase)
  ) {
    throw new Error('research evidence is not ready for report generation');
  }
  const emit = (evt) => {
    if (typeof onEvent === 'function') onEvent({ sessionId, at: new Date().toISOString(), ...evt });
  };

  const controller = signal ? null : new AbortController();
  const runSignal = signal || controller.signal;
  const runId = randomUUID();
  activeRuns.set(sessionId, { runId, controller: controller || { abort: () => {} }, phase: resolvedPhase });

  if (resolvedPhase === 'investigating') {
    try {
      emit({ type: 'phase', phase: resolvedPhase });
      const result = await runResearchInvestigation({
        sessionId,
        config,
        model: model || config.model?.name,
        workspaceRoot,
        signal: runSignal,
        emit,
      });
      emit({
        type: 'turn:done',
        phase: getResearchSessionDetail(sessionId)?.phase,
        readyForReport: Boolean(result?.readyForReport),
      });
      return {
        ...result,
        session: getResearchSessionDetail(sessionId),
      };
    } catch (error) {
      if (error?.name === 'AbortError' || runSignal.aborted) {
        emit({ type: 'aborted' });
        return { ok: false, aborted: true };
      }
      emit({ type: 'error', error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      const current = activeRuns.get(sessionId);
      if (current?.runId === runId) activeRuns.delete(sessionId);
    }
  }

  let allowNames;
  if (resolvedPhase === 'planning' || resolvedPhase === 'awaiting_plan_confirm') {
    allowNames = ['submit_research_plan'];
  } else if (resolvedPhase === 'writing') {
    allowNames = ['submit_research_report'];
  } else {
    allowNames = [];
  }

  const bundle = getBuiltinTools({ workspaceRoot, config });

  try {
    let writingDetail = detail;
    if (resolvedPhase === 'writing') {
      await generateResearchConclusions({
        sessionId,
        config,
        model: model || config.model?.name,
        signal: runSignal,
        emit,
      });
      writingDetail = getResearchSessionDetail(sessionId) || detail;
    }
    const filtered = filterToolBundle(
      bundle.definitions,
      bundle.handlers,
      bundle.deferredDefinitions,
      allowNames.filter((n) => !n.startsWith('submit_')),
    );
    const submitDefs = researchSubmitDefinitions(resolvedPhase);
    const submitHandlers = createResearchSubmitHandlers(sessionId, resolvedPhase, emit);
    const definitions = [...filtered.definitions, ...submitDefs];
    const handlers = { ...filtered.handlers, ...submitHandlers };

    let leadUserPrompt = userPrompt;
    if (!leadUserPrompt) {
      if (resolvedPhase === 'planning' || resolvedPhase === 'awaiting_plan_confirm') {
        const seedText = (writingDetail.seed || []).map((s) => `### ${s.label}\n${s.text}`).join('\n\n').slice(0, 6000);
        leadUserPrompt = [
          'Draft the research plan now and call submit_research_plan.',
          seedText ? `Seed material:\n${seedText}` : 'No seed material.',
        ].join('\n\n');
      } else if (resolvedPhase === 'writing') {
        leadUserPrompt = [
          'Write the final report from this writing pack, then call submit_research_report.',
          buildResearchWritingPack(writingDetail),
        ].join('\n\n');
      } else {
        leadUserPrompt = [
          'Continue the investigation. Dispatch Scouts for unfinished questions, then submit_research_commit.',
          buildResearchDbSummary(writingDetail),
        ].join('\n\n');
      }
    }

    emit({ type: 'phase', phase: resolvedPhase });

    const emitLead = (evt) => emit({ ...evt, scope: 'lead' });
    const result = await runAgentLoop({
      systemPrompt: buildLeadSystemPrompt(resolvedPhase, writingDetail),
      userPrompt: leadUserPrompt,
      model: model || config.model?.name,
      toolDefinitions: definitions,
      toolHandlers: handlers,
      deferredDefinitions: filtered.deferredDefinitions,
      toolFormatters: bundle.formatters,
      toolDisplayLabels: {
        ...(bundle.displayLabels || {}),
        submit_research_plan: 'Submit plan',
        submit_research_commit: 'Commit evidence',
        submit_research_report: 'Submit report',
      },
      executionMode: 'normal',
      approvalMode: 'auto',
      alwaysAllowTools: allowNames,
      projectIsGit: false,
      toolResultMaxChars: config.context?.tool_result_max_chars || 12000,
      config: { ...config, workspaceRoot },
      signal: runSignal,
      requestCompletion: makeCompletionFn(config, emitLead),
      onEvent: emitLead,
    });

    emit({ type: 'turn:done', text: result?.text || '', phase: getResearchSessionDetail(sessionId)?.phase });
    return {
      ok: true,
      text: result?.text || '',
      session: getResearchSessionDetail(sessionId),
    };
  } catch (error) {
    if (error?.name === 'AbortError' || runSignal.aborted) {
      emit({ type: 'aborted' });
      return { ok: false, aborted: true };
    }
    emit({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    const current = activeRuns.get(sessionId);
    if (current?.runId === runId) activeRuns.delete(sessionId);
    await bundle.dispose?.();
  }
}

export {
  buildLeadSystemPrompt,
  filterToolBundle,
  researchSubmitDefinitions,
};
