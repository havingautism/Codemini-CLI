import { h } from '../utils/dom.js';
import { t } from '../i18n/index.js';

const ROLE_PILLS = {
  planner: 'pill-purple',
  coder: 'pill-green',
  reviewer: 'pill-orange',
  tester: 'pill-blue',
  advisor: 'pill-blue',
  summarizer: 'pill-cyan'
};

export function createPlanProgress(container) {
  let steps = [];
  let stepsEl = null;
  let barFill = null;
  let header = null;

  function setSteps(planSteps) {
    steps = planSteps.map((s, i) => ({
      index: s.index ?? i,
      title: s.title,
      role: s.role,
      status: 'pending'
    }));
    render();
  }

  function updateProgress(event) {
    const { step, status } = event;
    const idx = step - 1;
    if (idx >= 0 && idx < steps.length) {
      steps[idx].status = status;
    }
    render();
  }

  function render() {
    container.innerHTML = '';
    container.classList.remove('hidden');
    if (!steps.length) return;

    const done = steps.filter(s => s.status === 'done').length;
    const failed = steps.filter(s => s.status === 'failed').length;
    const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
    const allDone = done === steps.length;

    const card = h('div', { className: 'plan-card' });

    header = h('div', { className: 'plan-header' },
      h('span', {}, t('planTitle')),
      h('span', { className: `status-pill ${allDone ? 'pill-green' : 'pill-blue'}` },
        allDone ? t('planDone') : `${done}/${steps.length}`
      )
    );
    card.appendChild(header);

    barFill = h('div', { className: 'plan-bar' },
      h('div', { className: 'plan-bar-fill', style: { width: pct + '%' } })
    );
    card.appendChild(barFill);

    stepsEl = h('div', { className: 'plan-steps' });
    for (const step of steps) {
      const pillClass = ROLE_PILLS[step.role] || 'pill-gray';
      const iconClass = step.status;
      stepsEl.appendChild(h('div', { className: 'plan-step' },
        h('span', { className: `plan-step-icon ${iconClass}` },
          step.status === 'done' ? '✓' : step.status === 'failed' ? '✗' : step.status === 'running' ? '▶' : String(step.index + 1)
        ),
        h('span', { className: `plan-step-role ${pillClass}` }, step.role),
        h('span', { className: 'plan-step-title' }, step.title)
      ));
    }
    card.appendChild(stepsEl);
    container.appendChild(card);
  }

  function hide() {
    container.classList.add('hidden');
    container.innerHTML = '';
    steps = [];
  }

  return { setSteps, updateProgress, hide };
}
