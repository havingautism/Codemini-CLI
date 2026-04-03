export const listPresenter = {
  prelude: {
    en: ({ target }) => (target ? `I'll list the contents of ${target} first.` : 'I\'ll list the relevant directory contents first.'),
    zh: ({ target }) => (target ? `我先列出 ${target} 目录内容。` : '我先列出相关目录内容。')
  },
  completion: {
    en: () => 'I have the relevant context now. Do you want me to make the change next, or summarize the findings first?',
    zh: () => '相关上下文我已经看完了。接下来你要我直接动手改，还是先把结论整理给你？'
  },
  meta: { bridgeGroup: 'inspect' }
};
