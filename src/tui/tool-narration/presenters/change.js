function buildPreludeEntry() {
  return {
    en: ({ changeKind, target, verb }) => {
      if (changeKind === 'readme') return `I'll inspect the project structure first, then write the README.`;
      if (changeKind === 'doc') return `I'll inspect the existing context first, then update the document.`;
      if (target) return `I'll inspect ${target} first, then ${verb} it.`;
      return `I'll inspect the current code first, then make the change.`;
    },
    zh: ({ changeKind, target, verbZh }) => {
      if (changeKind === 'readme') return '我先看一下项目内容和结构，再开始写 README。';
      if (changeKind === 'doc') return '我先看一下现有内容，再开始整理这份文档。';
      if (target) return `我先看一下 ${target} 的上下文，再开始${verbZh}。`;
      return '我先确认当前代码上下文，再动手修改。';
    }
  };
}

function buildCompletionEntry() {
  return {
    en: ({ changeKind, target }) => {
      if (changeKind === 'readme') return 'The README is in place. If you want, I can also add a quick start, feature summary, or usage example.';
      if (changeKind === 'doc') return 'The document is updated. If you want, I can also polish the wording, structure, or add an example section.';
      if (changeKind === 'test') {
        return target
          ? `${target} is ready. If you want, I can keep going with verification, more test coverage, or a quick review of edge cases.`
          : 'That test-related change is ready. If you want, I can keep going with verification or edge-case review.';
      }
      return target
        ? `${target} is ready. If you want, I can also add tests, update docs, or do a quick edge-case pass.`
        : 'That part is ready. If you want, I can also add tests, update docs, or do a quick edge-case pass.';
    },
    zh: ({ changeKind, target }) => {
      if (changeKind === 'readme') return 'README 已经写好了。要不要我顺手再补一个快速开始、功能概览，或者使用示例？';
      if (changeKind === 'doc') return '文档已经更新好了。要不要我继续顺一下语气、结构，或者补一段示例？';
      if (changeKind === 'test') {
        return target
          ? `${target} 已经处理好了。要不要我继续补验证、扩一下测试覆盖，或者再过一遍边界情况？`
          : '这部分测试相关修改已经处理好了。要不要我继续补验证，或者再过一遍边界情况？';
      }
      return target
        ? `${target} 已经处理好了。要不要我继续补测试、更新文档，或者再检查一遍边界情况？`
        : '这部分已经处理好了。要不要我继续补测试、更新文档，或者再检查一遍边界情况？';
    }
  };
}

function buildBridgeEntry() {
  return {
    en: ({ changeKind, nextTarget, verb, hasContext }) => {
      if (changeKind === 'readme') return hasContext ? 'I have enough context now, so I can write the README.' : 'I can write the README next.';
      if (changeKind === 'doc') return hasContext ? 'I have enough context now, so I can update the document.' : 'I can update the document next.';
      if (nextTarget) return hasContext ? `I have enough context now, so I'll ${verb} ${nextTarget}.` : `I'll ${verb} ${nextTarget} next.`;
      return hasContext ? 'I have enough context now, so I can make the change.' : 'I can make the change next.';
    },
    zh: ({ changeKind, nextTarget, verbZh, hasContext }) => {
      if (changeKind === 'readme') return hasContext ? '相关内容我已经看过了，现在开始写 README。' : '现在开始写 README。';
      if (changeKind === 'doc') return hasContext ? '需要的上下文我已经看过了，现在开始整理这份文档。' : '现在开始整理这份文档。';
      if (nextTarget) return hasContext ? `需要的上下文我已经看过了，现在${verbZh} ${nextTarget}。` : `现在${verbZh} ${nextTarget}。`;
      return hasContext ? '需要的上下文我已经看过了，现在开始修改。' : '现在开始修改。';
    }
  };
}

export function inferChangeKind(target) {
  const lowerTarget = String(target || '').toLowerCase();
  if (lowerTarget.includes('readme')) return 'readme';
  if (lowerTarget.endsWith('.md')) return 'doc';
  if (/test|spec/i.test(lowerTarget)) return 'test';
  return 'generic';
}

export function createChangePresenter({ verb, verbZh }) {
  return {
    prelude: buildPreludeEntry(),
    completion: buildCompletionEntry(),
    bridges: {
      inspect: buildBridgeEntry(),
      search: {
        en: ({ changeKind, nextTarget, verb }) => {
          if (changeKind === 'readme') return 'I found what I needed, so I can write the README.';
          if (changeKind === 'doc') return 'I found what I needed, so I can update the document.';
          if (nextTarget) return `I found the right spot, so I'll ${verb} ${nextTarget}.`;
          return 'I found the right spot, so I can make the change.';
        },
        zh: ({ changeKind, nextTarget, verbZh }) => {
          if (changeKind === 'readme') return '相关位置我已经找到了，现在开始写 README。';
          if (changeKind === 'doc') return '相关位置我已经找到了，现在开始整理这份文档。';
          if (nextTarget) return `相关位置我已经找到了，现在${verbZh} ${nextTarget}。`;
          return '相关位置我已经找到了，现在开始修改。';
        }
      },
      run: {
        en: ({ changeKind, nextTarget, verb }) => {
          if (changeKind === 'readme') return 'I have the result I needed, so I can write the README next.';
          if (changeKind === 'doc') return 'I have the result I needed, so I can update the document next.';
          if (nextTarget) return `I have the result I needed, so I'll ${verb} ${nextTarget}.`;
          return 'I have the result I needed, so I can make the follow-up change.';
        },
        zh: ({ changeKind, nextTarget, verbZh }) => {
          if (changeKind === 'readme') return '结果我已经拿到了，现在开始写 README。';
          if (changeKind === 'doc') return '结果我已经拿到了，现在开始整理这份文档。';
          if (nextTarget) return `结果我已经拿到了，现在${verbZh} ${nextTarget}。`;
          return '结果我已经拿到了，现在继续做后续修改。';
        }
      }
    },
    meta: { verb, verbZh }
  };
}
