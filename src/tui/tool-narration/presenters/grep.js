export const grepPresenter = {
  prelude: {
    en: () => `I'll search the relevant code first.`,
    zh: () => '我先搜索相关代码位置。'
  },
  completion: {
    en: () => 'I found the relevant spots. Do you want me to make the change next, or summarize the findings first?',
    zh: () => '相关位置我已经找到了。接下来你要我直接动手改，还是先把结论整理给你？'
  },
  meta: { bridgeGroup: 'search' }
};
