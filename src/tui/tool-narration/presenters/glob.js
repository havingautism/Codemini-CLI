export const globPresenter = {
  prelude: {
    en: ({ target }) => (target ? `I'll find files matching ${target} first.` : 'I\'ll find the relevant files by pattern first.'),
    zh: ({ target }) => (target ? `我先按模式查找匹配 ${target} 的文件。` : '我先按模式查找相关文件。')
  },
  completion: {
    en: () => 'I have the relevant context now. Do you want me to make the change next, or summarize the findings first?',
    zh: () => '相关上下文我已经看完了。接下来你要我直接动手改，还是先把结论整理给你？'
  },
  meta: { bridgeGroup: 'inspect' }
};
