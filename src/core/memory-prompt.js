import { listMemories } from './memory-store.js';
import { budgetRetrievedMemoryItems, compactMemoryHit, retrieveMemories, renderRetrievedMemory } from './memory-retriever.js';
import { fitMemoryItemsToTokenBudget } from './memory-token-budget.js';

function renderScope(title, items = []) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const lines = items.map((item) => {
    const family = item.family ? ` family=${item.family}` : '';
    const lifecycle = item.lifecycle ? ` lifecycle=${item.lifecycle}` : '';
    return [
      `- [${item.kind}]${family}${lifecycle} summary=${JSON.stringify(String(item.summary || item.content || ''))}`,
      `  exact_text=${JSON.stringify(String(item.content || ''))}`
    ].join('\n');
  });
  return `${title}\n${lines.join('\n')}`;
}

function takeItems(items = [], { max, seen, pred } = {}) {
  const selected = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id) || selected.length >= max) continue;
    if (item.lifecycle === 'archived') continue;
    if (pred && !pred(item)) continue;
    seen.add(item.id);
    selected.push(item);
  }
  return selected;
}

function pickProfile(items = [], { max = 6, personal = false, conventions = false, seen = new Set() } = {}) {
  const selected = [];
  const take = (pred) => {
    selected.push(...takeItems(items, { max: max - selected.length, seen, pred }));
  };
  take((item) => item.pinned);
  if (personal) take((item) => item.family === 'personal' || item.kind === 'preference');
  if (conventions) take((item) => item.kind === 'convention' || item.family === 'procedure');
  return selected;
}

const GUARANTEE_TAG_PATTERN = /^(user_correction|critical_project_rule|security_constraint|safety|critical)$/i;

function hasGuaranteeTag(item) {
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  return tags.some((tag) => GUARANTEE_TAG_PATTERN.test(String(tag)));
}

// Guaranteed = pinned + user correction / critical rule / safety constraint
// tags (design §13/§62). These always inject, independent of BM25 recall.
function pickGuaranteed(items = [], { max = 6 } = {}) {
  return takeItems(items, {
    max,
    seen: new Set(),
    pred: (item) => item.pinned === true || hasGuaranteeTag(item)
  });
}

function bootstrapEnabled(config = {}) {
  if (config?.memory?.enabled === false) return false;
  if (config?.memory?.bootstrap?.enabled === false) return false;
  if (config?.memory?.bootstrap?.enabled === true) return true;
  return config?.memory?.inject_on_session_start !== false;
}

function renderBootstrapRecords(records = []) {
  if (!records.length) return '';
  const bucketItems = (bucket) => records.filter((entry) => entry.bucket === bucket).map((entry) => entry.item);
  const user = bucketItems('user');
  const globalItems = bucketItems('global');
  const project = bucketItems('project');
  const guaranteed = bucketItems('guaranteed');
  const profileSections = [
    renderScope('User Memory (preferences / interests / habits):', user),
    renderScope('Global Memory (cross-project tools / environment):', globalItems),
    renderScope('Project Memory (this repository only):', project)
  ].filter(Boolean);
  const guaranteedBlock = guaranteed.length
    ? `<guaranteed_memory>\n${renderScope('Must follow:', guaranteed)}\n</guaranteed_memory>`
    : '';
  return [
    '<relevant_memory>',
    'Use these durable notes only as stable guidance. Prefer fresh reads when code or files can verify the answer.',
    'When recalling memory, preserve command names, file paths, identifiers, and punctuation exactly. Do not rewrite exact_text values.',
    'Actively notice lasting user preferences and interests; save them with save_memory(scope="user", kind="preference"). Write new memory content/summary in the active reply language from the system prompt.',
    profileSections.length ? `<memory_profile>\n${profileSections.join('\n\n')}\n</memory_profile>` : '',
    guaranteedBlock,
    '</relevant_memory>'
  ].filter(Boolean).join('\n\n');
}

export async function composeMemorySnapshot({
  config = {},
  workspaceRoot = process.cwd(),
  query = '',
  includeBootstrap = bootstrapEnabled(config)
} = {}) {
  const emptyInject = {
    query: String(query || ''),
    mode: 'turn',
    profile: [],
    guaranteed: [],
    retrieved: []
  };
  if (config?.memory?.enabled === false) return { text: '', retrievedText: '', inject: null };

  const bootstrap = includeBootstrap && bootstrapEnabled(config);
  const retrieval = config?.memory?.retrieval?.enabled !== false && String(query || '').trim();
  if (!bootstrap && !retrieval) return { text: '', retrievedText: '', inject: emptyInject };
  const [user, globalItems, project, retrieved] = await Promise.all([
    bootstrap ? listMemories({ scope: 'user', workspaceRoot }) : Promise.resolve([]),
    bootstrap ? listMemories({ scope: 'global', workspaceRoot }) : Promise.resolve([]),
    bootstrap ? listMemories({ scope: 'project', workspaceRoot }) : Promise.resolve([]),
    retrieval
      ? retrieveMemories({
          query,
          workspaceRoot,
          config,
          mode: 'turn',
          family: ['repo', 'coding', 'procedure']
        }).catch(() => [])
      : Promise.resolve([])
  ]);

  const guaranteed = pickGuaranteed([...user, ...globalItems, ...project]);
  const guaranteedIds = new Set(guaranteed.map((item) => item.id));
  const seen = new Set(guaranteedIds);
  const userProfile = pickProfile(user, { max: 6, personal: true, seen });
  const globalProfile = pickProfile(globalItems, { max: 4, conventions: true, seen });
  const projectProfile = pickProfile(project, { max: 6, conventions: true, seen });
  const retrievedHits = retrieved.filter((item) => item?.id && !guaranteedIds.has(item.id) && !seen.has(item.id));
  const visibleRetrievedHits = budgetRetrievedMemoryItems(
    retrievedHits,
    config?.memory?.retrieval?.max_tokens ?? 1000
  );
  const retrievedBlock = renderRetrievedMemory(visibleRetrievedHits);
  const bootstrapRecords = [
    ...guaranteed.map((item) => ({ bucket: 'guaranteed', item })),
    ...userProfile.map((item) => ({ bucket: 'user', item })),
    ...globalProfile.map((item) => ({ bucket: 'global', item })),
    ...projectProfile.map((item) => ({ bucket: 'project', item }))
  ];
  const visibleBootstrapRecords = bootstrap
    ? fitMemoryItemsToTokenBudget(bootstrapRecords, {
        maxTokens: config?.memory?.bootstrap?.max_tokens ?? 600,
        render: renderBootstrapRecords
      })
    : [];
  const visibleGuaranteed = visibleBootstrapRecords
    .filter((entry) => entry.bucket === 'guaranteed')
    .map((entry) => entry.item);
  const visibleProfile = visibleBootstrapRecords
    .filter((entry) => entry.bucket !== 'guaranteed')
    .map((entry) => entry.item);
  const inject = {
    ...emptyInject,
    profile: visibleProfile.map(compactMemoryHit),
    guaranteed: visibleGuaranteed.map(compactMemoryHit),
    retrieved: visibleRetrievedHits.map(compactMemoryHit)
  };

  if (visibleBootstrapRecords.length === 0 && !retrievedBlock) {
    return { text: '', retrievedText: '', inject };
  }

  return { text: renderBootstrapRecords(visibleBootstrapRecords), retrievedText: retrievedBlock, inject };
}

export async function buildMemorySnapshot(opts = {}) {
  const composed = await composeMemorySnapshot(opts);
  return composed.text;
}
