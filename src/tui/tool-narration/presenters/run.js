export const runPresenter = {
  prelude: {
    en: ({ target }) => (target ? `I'll run ${target} first and check the result.` : `I'll run the relevant command first and check the result.`),
    zh: ({ target }) => (target ? `我先执行 ${target}，再看一下结果。` : '我先执行相关命令，再看一下结果。')
  },
  completion: {
    en: () => 'That step is finished. Do you want me to act on the result next, or summarize what it means first?',
    zh: () => '这一步已经跑完了。接下来要我根据结果继续处理，还是先把结论整理给你？'
  },
  bridges: {
    'generic-change': {
      en: () => 'I have the result I needed, so I can make the follow-up change.',
      zh: () => '结果我已经拿到了，现在继续做后续修改。'
    },
    'doc-change': {
      en: () => 'I have the result I needed, so I can make the follow-up change.',
      zh: () => '结果我已经拿到了，现在继续做后续修改。'
    },
    'readme-change': {
      en: () => 'I have the result I needed, so I can make the follow-up change.',
      zh: () => '结果我已经拿到了，现在继续做后续修改。'
    },
    'test-change': {
      en: () => 'I have the result I needed, so I can make the follow-up change.',
      zh: () => '结果我已经拿到了，现在继续做后续修改。'
    }
  },
  meta: { bridgeGroup: 'run' }
};
