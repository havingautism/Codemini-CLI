export const globPresenter = {
  prelude: {
    en: ({ target }) => (target ? `I'll inspect the ${target} directory first.` : 'I\'ll inspect the relevant directory first.'),
    zh: ({ target }) => (target ? `我先查看 ${target} 目录里的内容。` : '我先查看相关目录内容。')
  },
  completion: {
    en: () => 'I have the relevant context now. Do you want me to make the change next, or summarize the findings first?',
    zh: () => '相关上下文我已经看完了。接下来你要我直接动手改，还是先把结论整理给你？'
  },
  meta: { bridgeGroup: 'inspect' }
};
