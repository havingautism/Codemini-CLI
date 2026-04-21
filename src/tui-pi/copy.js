function normalizePiLanguage(language) {
  return String(language || '').toLowerCase().startsWith('en') ? 'en' : 'zh';
}

export function getPiCopy(language = 'zh') {
  const lang = normalizePiLanguage(language);

  return lang === 'en'
    ? {
        language: 'en',
        banner: [
          ' ██████  ██████  ██████  ███████ ███    ███ ██ ███    ██ ██ ',
          '██      ██    ██ ██   ██ ██      ████  ████ ██ ████   ██ ██ ',
          '██      ██    ██ ██   ██ █████   ██ ████ ██ ██ ██ ██  ██ ██ ',
          '██      ██    ██ ██   ██ ██      ██  ██  ██ ██ ██  ██ ██ ██ ',
          ' ██████  ██████  ██████  ███████ ██      ██ ██ ██   ████ ██ '
        ],
        bannerColors: ['magentaBright', 'redBright', 'yellowBright', 'cyanBright', 'magentaBright'],
        subtitle: 'optimized for small-model workflows',
        roleLabels: {
          you: 'YOU',
          coder: 'CODER',
          planner: 'PLANNER',
          reviewer: 'REVIEWER',
          tester: 'TESTER',
          summarizer: 'SUMMARIZER',
          system: 'SYSTEM',
          error: 'ERROR',
          pending: 'PENDING'
        },
        roleColors: {
          you: 'blueBright',
          coder: 'greenBright',
          planner: 'magentaBright',
          reviewer: 'yellowBright',
          tester: 'blueBright',
          summarizer: 'cyanBright',
          system: 'yellowBright',
          error: 'redBright',
          pending: 'cyanBright'
        },
        roleStyles: {
          you:        { accent: 'blueBright',    border: 'blue',    badgeFg: 'white',  badgeBg: 'blue' },
          coder:      { accent: 'greenBright',   border: 'cyan',    badgeFg: 'black',  badgeBg: 'cyan' },
          planner:    { accent: 'magentaBright', border: 'magenta', badgeFg: 'white',  badgeBg: 'magenta' },
          reviewer:   { accent: 'yellowBright',  border: 'yellow',  badgeFg: 'black',  badgeBg: 'yellow' },
          tester:     { accent: 'blueBright',    border: 'blue',    badgeFg: 'white',  badgeBg: 'blue' },
          summarizer: { accent: 'cyanBright',    border: 'cyan',    badgeFg: 'black',  badgeBg: 'cyan' },
          system:     { accent: 'yellowBright',  border: 'yellow',  badgeFg: 'black',  badgeBg: 'yellow' },
          error:      { accent: 'redBright',     border: 'red',     badgeFg: 'white',  badgeBg: 'red' },
          pending:    { accent: 'cyanBright',    border: 'cyan',    badgeFg: 'black',  badgeBg: 'cyan' }
        },
        toolPanel: {
          title: 'TOOLS',
          expanded: 'expanded',
          collapsed: 'collapsed',
          noActivity: 'no tool activity',
          toggleHint: 'Ctrl+T to toggle',
          scrollHint: 'Scroll with terminal scrollbar'
        },
        status: {
          idle: 'IDLE',
          sending: 'SENDING',
          thinking: 'THINKING',
          streaming: 'STREAMING',
          tooling: 'TOOLING',
          waiting: 'waiting for input'
        },
        footer: {
          sdk: 'SDK',
          model: 'MODEL',
          shell: 'SHELL',
          session: 'SESSION',
          mode: 'MODE',
          safeOn: 'SAFE',
          safeOff: 'OPEN'
        },
        commandBar: {
          title: 'COMMAND BAR',
          hint: '/view commands, Tab autocomplete, ↑↓ history, Ctrl+T tools',
          prompt: 'codemini> '
        },
        context: {
          label: 'Context'
        },
        signature: {
          developedBy: 'developed by',
          author: '@havingautism'
        },
        inputHint: 'Enter send  |  Ctrl+C exit  |  Ctrl+T toggle tools  |  ↑↓ history',
        startupHints: [
          'Use /help to view command help. Tab for slash autocomplete.',
          'Try /plan mode for complex tasks — let the AI propose a plan before coding.',
          'Use ↑↓ arrow keys to browse input history.',
          'Type !<shell command> to run local terminal commands.',
          'Ctrl+T toggles tool call detail expansion/collapse.',
          'Try /status to check current session mode, model, and token usage.'
        ],
        spinnerFrames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
      }
    : {
        language: 'zh',
        banner: [
          ' ██████  ██████  ██████  ███████ ███    ███ ██ ███    ██ ██ ',
          '██      ██    ██ ██   ██ ██      ████  ████ ██ ████   ██ ██ ',
          '██      ██    ██ ██   ██ █████   ██ ████ ██ ██ ██ ██  ██ ██ ',
          '██      ██    ██ ██   ██ ██      ██  ██  ██ ██ ██  ██ ██ ██ ',
          ' ██████  ██████  ██████  ███████ ██      ██ ██ ██   ████ ██ '
        ],
        bannerColors: ['magentaBright', 'redBright', 'yellowBright', 'cyanBright', 'magentaBright'],
        subtitle: '为小模型工作流优化',
        roleLabels: {
          you: '你',
          coder: '编码器',
          planner: '规划器',
          reviewer: '审查器',
          tester: '测试器',
          summarizer: '总结器',
          system: '系统',
          error: '错误',
          pending: '等待中'
        },
        roleColors: {
          you: 'blueBright',
          coder: 'greenBright',
          planner: 'magentaBright',
          reviewer: 'yellowBright',
          tester: 'blueBright',
          summarizer: 'cyanBright',
          system: 'yellowBright',
          error: 'redBright',
          pending: 'cyanBright'
        },
        roleStyles: {
          you:        { accent: 'blueBright',    border: 'blue',    badgeFg: 'white',  badgeBg: 'blue' },
          coder:      { accent: 'greenBright',   border: 'cyan',    badgeFg: 'black',  badgeBg: 'cyan' },
          planner:    { accent: 'magentaBright', border: 'magenta', badgeFg: 'white',  badgeBg: 'magenta' },
          reviewer:   { accent: 'yellowBright',  border: 'yellow',  badgeFg: 'black',  badgeBg: 'yellow' },
          tester:     { accent: 'blueBright',    border: 'blue',    badgeFg: 'white',  badgeBg: 'blue' },
          summarizer: { accent: 'cyanBright',    border: 'cyan',    badgeFg: 'black',  badgeBg: 'cyan' },
          system:     { accent: 'yellowBright',  border: 'yellow',  badgeFg: 'black',  badgeBg: 'yellow' },
          error:      { accent: 'redBright',     border: 'red',     badgeFg: 'white',  badgeBg: 'red' },
          pending:    { accent: 'cyanBright',    border: 'cyan',    badgeFg: 'black',  badgeBg: 'cyan' }
        },
        toolPanel: {
          title: '工具',
          expanded: '已展开',
          collapsed: '已收起',
          noActivity: '暂无工具活动',
          toggleHint: 'Ctrl+T 切换',
          scrollHint: '使用终端滚动条查看历史'
        },
        status: {
          idle: '空闲',
          sending: '发送中',
          thinking: '思考中',
          streaming: '输出中',
          tooling: '工具中',
          waiting: '等待输入'
        },
        footer: {
          sdk: 'SDK',
          model: '模型',
          shell: 'Shell',
          session: '会话',
          mode: '模式',
          safeOn: '安全',
          safeOff: '开放'
        },
        commandBar: {
          title: '命令栏',
          hint: '/查看命令，Tab 自动补全，↑↓ 历史，Ctrl+T 展开工具',
          prompt: 'codemini> '
        },
        context: {
          label: '上下文'
        },
        signature: {
          developedBy: '由',
          author: '@havingautism'
        },
        inputHint: 'Enter 发送  |  Ctrl+C 退出  |  Ctrl+T 切换工具  |  ↑↓ 历史',
        startupHints: [
          '🧭 使用 /help 可查看命令帮助。Tab 可自动补全 slash 命令。',
          '📋 试试用 /plan 模式来规划复杂任务，让 AI 先给出方案再动手。',
          '⏫ 使用 ↑↓ 键可以浏览历史输入，快速重复之前的操作。',
          '🐚 输入 !<shell命令> 可以直接执行本地终端命令。',
          '🔧 Ctrl+T 可以切换工具调用详情的展开/收起状态。',
          '📊 试试 /status 查看当前会话模式、模型和 token 用量。'
        ],
        spinnerFrames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
      };
}
