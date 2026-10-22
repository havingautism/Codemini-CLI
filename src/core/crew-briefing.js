export function composeCrewBriefing({ kind = 'build', additional = '' } = {}) {
  const role = String(kind || 'build').toLowerCase();
  const fixed = role === 'survey'
    ? [
      'Crew survey mission.',
      'Read the worktree. Do not modify files and do not commit.',
      'A changed file blocks completion.',
      'Before you stop, call crew_complete with the survey report (outcome ok, or blocked/failed if you cannot finish).',
    ]
    : role === 'reviewer'
      ? [
        'Crew review.',
        'Read the diff you were given. Do not modify files.',
        'Submit one review verdict with submit_crew_review.',
      ]
      : [
        'Crew build mission.',
        'Implement the task in this worktree, inside your paths.',
        'Run the project\'s existing build or test if it has one, then commit the source changes on this branch.',
        'Do not commit dependencies or build output. A branch with no changes cannot be completed.',
        'Before you stop, call crew_complete with a report. Use outcome ok when ready for review, or blocked/failed when you cannot finish. Handoff text alone does not submit the mission.',
      ];
  const extra = String(additional || '').trim();
  return extra
    ? `${fixed.join('\n')}\n\nAdditional instructions:\n${extra}`
    : fixed.join('\n');
}
