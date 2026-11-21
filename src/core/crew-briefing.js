export function composeCrewBriefing({ kind = 'build', additional = '' } = {}) {
  const role = String(kind || 'build').toLowerCase();
  const fixed = role === 'survey'
    ? [
      'Crew survey mission.',
      'Read the worktree. Do not modify files and do not commit.',
      'A changed file blocks completion.',
      'Before you stop, call crew_complete (outcome ok, or blocked/failed if you cannot finish). The final message is the handoff. Handoff text alone does not submit the mission.',
    ]
    : role === 'reviewer'
      ? [
        'Crew review.',
        'Read the diff you were given. Do not modify files.',
        'Flag unexpected changes to dependency manifests or lockfiles.',
        'Submit one review verdict with submit_crew_review.',
      ]
      : [
        'Crew build mission.',
        'Implement the task in this worktree, inside your paths.',
        'This worktree is an isolated checkout (no installed dependencies from the parent). Install dependencies here with the project package manager when you need to build or test.',
        'If you add or change dependencies, commit the dependency manifest and lockfile together. Do not commit installed dependency directories or build output (such as node_modules, .venv, or target). A branch with no changes cannot be completed.',
        'If install or build fails, say so in your final handoff; static checks (syntax, imports) are fine but do not claim a build passed when it did not.',
        'Before you stop, call crew_complete. Use outcome ok when ready for review, or blocked/failed when you cannot finish. Handoff text alone does not submit the mission.',
      ];
  const extra = String(additional || '').trim();
  return extra
    ? `${fixed.join('\n')}\n\nAdditional instructions:\n${extra}`
    : fixed.join('\n');
}
