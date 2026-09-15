// Public login UI: never interpolate credentials or filesystem paths into HTML.
export const loginPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>登录 · Codemini</title>
<style>
:root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#171717;background:#fafafa;--surface:#fff;--muted:#666;--border:#e5e5e5;--soft:#f5f5f5;--primary:#171717;--on-primary:#fff;--error:#b91c1c;--focus:#2563eb}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:48px 20px}main{width:100%;max-width:440px}.brand{font-size:22px;font-weight:700;letter-spacing:-.7px;margin:0 0 30px;text-align:center}.brand span{font-size:12px;font-weight:400;color:var(--muted);letter-spacing:0;margin-left:9px;padding-left:10px;border-left:1px solid var(--border)}.card{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:32px;box-shadow:0 8px 32px #00000005}.eyebrow{font-size:11px;letter-spacing:1.5px;color:var(--muted);margin:0 0 12px}h1{font-size:25px;line-height:1.3;letter-spacing:-.6px;margin:0 0 12px;font-weight:650}.intro{font-size:14px;line-height:1.8;margin:0 0 26px;color:var(--muted)}label{display:block;font-size:13px;font-weight:600;margin-bottom:9px}.input-wrap{display:flex;border:1px solid var(--border);border-radius:10px;background:var(--surface);transition:border-color .15s,box-shadow .15s}.input-wrap:focus-within{border-color:var(--focus);box-shadow:0 0 0 3px #2563eb18}.input-wrap:has([aria-invalid="true"]){border-color:var(--error)}input{min-width:0;flex:1;border:0;background:transparent;color:inherit;padding:13px 14px;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;outline:none}input::placeholder{color:#999;font-family:inherit}button{font:inherit;cursor:pointer}button:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:3px}.toggle{border:0;background:transparent;color:var(--muted);font-size:12px;padding:0 14px;border-radius:9px}.hint{font-size:12px;line-height:1.7;color:var(--muted);margin:9px 0 18px}.submit{width:100%;border:0;border-radius:10px;padding:13px 16px;font-size:14px;font-weight:600;background:var(--primary);color:var(--on-primary);transition:opacity .15s}.submit:hover{opacity:.85}button:disabled{opacity:.6;cursor:wait}#error{font-size:12px;line-height:1.7;color:var(--error);margin:12px 0 0}#error:empty{display:none}.guide{margin-top:26px;border-top:1px solid var(--border);padding-top:22px}.guide-title{font-size:13px;font-weight:600;margin:0 0 9px}.guide p{font-size:12px;line-height:1.8;color:var(--muted);margin:0}code{font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--soft);border:1px solid var(--border);border-radius:4px;padding:1px 5px;white-space:nowrap}details{margin-top:16px;font-size:12px;color:var(--muted)}summary{cursor:pointer;width:fit-content;padding:3px 0}details ol{padding-left:20px;margin-bottom:0;line-height:1.9}details li+li{margin-top:8px}.footer{text-align:center;color:var(--muted);font-size:11px;line-height:1.8;margin:20px 12px 0}
@media(max-width:480px){body{padding:28px 16px}.card{padding:26px 22px}.brand{margin-bottom:24px}h1{font-size:23px}}
@media(prefers-color-scheme:dark){:root{color:#ededed;background:#111;--surface:#191919;--muted:#a3a3a3;--border:#333;--soft:#242424;--primary:#ededed;--on-primary:#171717;--error:#fca5a5;--focus:#60a5fa}.card{box-shadow:none}}
</style></head><body><main>
<div class="brand">Codemini<span>本地工作空间</span></div>
<section class="card" aria-labelledby="title"><p class="eyebrow">LOCAL ACCESS</p>
<h1 id="title">连接你的工作空间</h1>
<p class="intro">复制启动终端中的登录 Token，<br>即可继续使用 Codemini。</p>
<form novalidate><label for="token">登录 Token</label>
<div class="input-wrap"><input id="token" type="password" name="token" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="粘贴完整 Token 或一键登录链接" required aria-describedby="token-hint error" autofocus><button class="toggle" id="toggle-token" type="button" aria-label="显示 Token" aria-pressed="false">显示</button></div>
<p class="hint" id="token-hint">粘贴终端中 <code>Token:</code> 后的内容，不是文件路径。</p>
<button class="submit" id="submit" type="submit">连接工作空间</button>
<p id="error" role="status" aria-live="polite"></p></form>
<div class="guide"><h2 class="guide-title">也可以一键登录</h2><p>在启动终端中点击 <code>Login:</code> 后的完整链接，<br>页面会自动完成登录，无需手动复制 Token。</p>
<details><summary>找不到 Token，或提示已失效？</summary><ol><li>切回启动 Codemini 的终端，查找 <code>Token:</code> 或 <code>Login:</code>。</li><li>开发模式请在 <code>codemini-web</code> 目录运行 <code>npm run dev</code>，两项内容会在启动完成后显示。</li><li>服务重启后 Token 会更新，请使用最近一次启动的内容。也可打开终端显示的 Token 文件，复制其中的完整文本。</li></ol></details></div></section>
<p class="footer">这是 Codemini 本地服务的访问凭证，不是模型 API Key。<br>只在你自己的设备上使用。</p>
</main><script>
const form = document.querySelector('form');
const input = document.getElementById('token');
const submit = document.getElementById('submit');
const toggle = document.getElementById('toggle-token');
const error = document.getElementById('error');
let busy = false;
toggle.onclick = () => {
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  toggle.textContent = visible ? '隐藏' : '显示';
  toggle.setAttribute('aria-label', visible ? '隐藏 Token' : '显示 Token');
  toggle.setAttribute('aria-pressed', String(visible));
};
input.oninput = () => { input.removeAttribute('aria-invalid'); error.textContent = ''; };
async function signIn(value) {
  if (busy) return;
  let token = String(value || '').trim();
  if (token.startsWith('http://') || token.startsWith('https://')) {
    try { token = new URLSearchParams(new URL(token).hash.slice(1)).get('token') || ''; } catch { token = ''; }
  }
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    error.textContent = '请粘贴完整的登录 Token（64 位字符），或终端中的一键登录链接。不要填写文件路径或模型 API Key。';
    input.setAttribute('aria-invalid', 'true'); input.focus(); return;
  }
  busy = true; submit.disabled = true; toggle.disabled = true; input.readOnly = true;
  form.setAttribute('aria-busy', 'true'); submit.textContent = '正在连接…'; error.textContent = '';
  try {
    const response = await fetch('/auth', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    if (response.ok) { submit.textContent = '已连接，正在进入…'; location.replace('/'); return; }
    if (response.status === 401) {
      error.textContent = 'Token 不正确或已失效。请复制终端最近一次启动时显示的 Token，再试一次。';
      input.setAttribute('aria-invalid', 'true');
    } else { error.textContent = '暂时无法登录（' + response.status + '）。请检查终端中的服务状态，稍后重试。'; }
  } catch { error.textContent = '无法连接本地服务。请确认启动终端仍在运行，再试一次。'; }
  finally {
    busy = false; submit.disabled = false; toggle.disabled = false; input.readOnly = false;
    form.setAttribute('aria-busy', 'false');
    if (error.textContent) { submit.textContent = '重新连接'; input.focus(); }
  }
}
form.onsubmit = event => { event.preventDefault(); signIn(input.value); };
const token = new URLSearchParams(location.hash.slice(1)).get('token');
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
if (token) signIn(token);
</script></body></html>`;
