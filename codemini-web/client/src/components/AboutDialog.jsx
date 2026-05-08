import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

export function AboutDialog({ open, onOpenChange, version }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>关于 CodeMini</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-[13px] text-(--text-secondary) leading-relaxed">
          <div>
            <h3 className="text-[13px] font-semibold text-(--text-primary) mb-1.5">安装</h3>
            <pre className="bg-(--bg-secondary) rounded-lg px-3 py-2 text-[12px] font-mono overflow-x-auto">
npm install -g codemini-cli
            </pre>
          </div>

          <Separator className="bg-(--border-default)" />

          <div>
            <h3 className="text-[13px] font-semibold text-(--text-primary) mb-1.5">启动 Web UI</h3>
            <pre className="bg-(--bg-secondary) rounded-lg px-3 py-2 text-[12px] font-mono overflow-x-auto">
codemini --web
            </pre>
            <p className="mt-1.5 text-[12px] text-(--text-muted)">
              启动后浏览器会自动打开 Web 界面，也可以手动访问终端中显示的地址。
            </p>
          </div>

          <Separator className="bg-(--border-default)" />

          <div>
            <h3 className="text-[13px] font-semibold text-(--text-primary) mb-1.5">基本使用</h3>
            <ul className="space-y-1.5 text-[12px]">
              <li className="flex gap-2">
                <span className="text-(--text-muted) shrink-0">对话</span>
                <span>在输入框直接输入问题或指令，按 Enter 发送</span>
              </li>
              <li className="flex gap-2">
                <span className="text-(--text-muted) shrink-0">技能</span>
                <span>输入 <code className="bg-(--bg-tertiary) px-1 rounded text-[11px]">/</code> 触发技能选择面板</span>
              </li>
              <li className="flex gap-2">
                <span className="text-(--text-muted) shrink-0">灵魂</span>
                <span>点击输入框工具栏的灵魂按钮切换 AI 人格</span>
              </li>
              <li className="flex gap-2">
                <span className="text-(--text-muted) shrink-0">模式</span>
                <span>
                  <code className="bg-(--bg-tertiary) px-1 rounded text-[11px]">普通</code> 需确认工具调用，
                  <code className="bg-(--bg-tertiary) px-1 rounded text-[11px]">自动</code> 全自动执行
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-(--text-muted) shrink-0">工作区</span>
                <span>点击输入框的文件夹按钮切换项目目录</span>
              </li>
            </ul>
          </div>

          <Separator className="bg-(--border-default)" />

          <div>
            <h3 className="text-[13px] font-semibold text-(--text-primary) mb-1.5">配置模型</h3>
            <pre className="bg-(--bg-secondary) rounded-lg px-3 py-2 text-[12px] font-mono overflow-x-auto">
codemini config set model.name &lt;model-id&gt;
            </pre>
            <p className="mt-1.5 text-[12px] text-(--text-muted)">
              支持 OpenAI 兼容接口，可在设置中配置 API Key、Endpoint 等。
            </p>
          </div>
        </div>

        <div className="text-center text-[11px] text-(--text-muted) pt-2">
          CodeMini CLI{version ? `@${version}` : ''} — Coding assistant optimized for small-model workflows
        </div>
      </DialogContent>
    </Dialog>
  );
}
