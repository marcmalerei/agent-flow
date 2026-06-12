import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'media', 'agent-flow-preview.gif');
const frameDir = join(root, '.capture-preview-frames');
const vitePort = Number(process.env.AGENTFLOW_CAPTURE_VITE_PORT ?? 5187);
const chromePort = Number(process.env.AGENTFLOW_CAPTURE_CHROME_PORT ?? 9227);
const viewport = { width: 1280, height: 720 };

await rm(frameDir, { recursive: true, force: true });
await mkdir(frameDir, { recursive: true });

const vite = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'vite.webview.dev.config.mts', '--host', '127.0.0.1', '--port', String(vitePort)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe']
});
vite.stdout.on('data', (chunk) => process.stdout.write(chunk));
vite.stderr.on('data', (chunk) => process.stderr.write(chunk));

const userDataDir = join(root, '.capture-chrome-profile');
await rm(userDataDir, { recursive: true, force: true });
const chrome = spawn(chromeBinary(), [
  '--headless=new',
  `--remote-debugging-port=${chromePort}`,
  `--user-data-dir=${userDataDir}`,
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
chrome.stderr.on('data', (chunk) => process.stderr.write(chunk));

try {
  const url = `http://127.0.0.1:${vitePort}/examples/basic-flow/webview.html`;
  await waitForHttp(url);
  const target = await createChromeTarget(chromePort, url);
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
  await waitForPage(cdp);
  await setupDemoHelpers(cdp);

  let frame = 0;
  const capture = async (repeat = 8) => {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const bytes = Buffer.from(shot.data, 'base64');
    for (let index = 0; index < repeat; index += 1) {
      frame += 1;
      await writeFile(join(frameDir, `frame-${String(frame).padStart(4, '0')}.png`), bytes);
    }
  };

  await caption(cdp, 'Agent Flow Studio infers a live graph from .github Markdown files');
  await capture(12);

  await caption(cdp, 'Add a new artifact node');
  await evalPage(cdp, `document.querySelector('.add-node-menu button').click()`);
  await capture(8);
  await evalPage(cdp, `clickAddNodeType('artifact')`);
  await waitForText(cdp, 'New artifact');
  await capture(10);

  await caption(cdp, 'Rename and manage the generated node');
  await evalPage(cdp, `setConfigField('Label', 'Login Spec')`);
  await waitForText(cdp, 'Login Spec');
  await capture(10);

  await caption(cdp, 'Reference it as Router output; the graph creates the edge');
  await evalPage(cdp, `selectFlowNode('router')`);
  await waitForText(cdp, 'Routing and references');
  await evalPage(cdp, `openDetails('Routing and references')`);
  await capture(6);
  await evalPage(cdp, `toggleArtifactDirection('Login Spec', 'Output')`);
  await waitForText(cdp, 'writes');
  await capture(12);

  await caption(cdp, 'Add an instruction node');
  await evalPage(cdp, `document.querySelector('.add-node-menu button').click()`);
  await capture(6);
  await evalPage(cdp, `clickAddNodeType('instruction')`);
  await waitForText(cdp, 'New instruction');
  await evalPage(cdp, `setConfigField('Label', 'Login Guidance')`);
  await waitForText(cdp, 'Login Guidance');
  await capture(10);

  await caption(cdp, 'Select the instruction reference; the instruction edge appears immediately');
  await evalPage(cdp, `selectFlowNode('router')`);
  await waitForText(cdp, 'Routing and references');
  await evalPage(cdp, `openDetails('Routing and references')`);
  await capture(6);
  await evalPage(cdp, `toggleReferenceRow('Login Guidance')`);
  await waitForText(cdp, 'instructs');
  await capture(14);

  await cdp.close();
  await renderGif();
  console.log(output);
} finally {
  chrome.kill('SIGTERM');
  vite.kill('SIGTERM');
}

function chromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const binary = candidates.find((item) => item && existsSync(item));
  if (!binary) throw new Error('Chrome or Chromium was not found. Set CHROME_BIN to capture the preview GIF.');
  return binary;
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function createChromeTarget(port, url) {
  await waitForHttp(`http://127.0.0.1:${port}/json/version`);
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Chrome target creation failed: ${response.status}`);
  return response.json();
}

async function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolveMessage, rejectMessage } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) rejectMessage(new Error(message.error.message));
    else resolveMessage(message.result ?? {});
  });
  return {
    send(method, params = {}) {
      sequence += 1;
      const id = sequence;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolveMessage, rejectMessage) => pending.set(id, { resolveMessage, rejectMessage }));
    },
    close() {
      socket.close();
    }
  };
}

async function waitForPage(cdp) {
  await waitForCondition(async () => {
    const result = await evalPage(cdp, `document.readyState === 'complete' && Boolean(document.querySelector('.react-flow__node'))`);
    return Boolean(result);
  }, 20_000, 'webview app');
}

async function waitForText(cdp, text) {
  await waitForCondition(async () => {
    const result = await evalPage(cdp, `document.body.innerText.includes(${JSON.stringify(text)})`);
    return Boolean(result);
  }, 10_000, text);
}

async function waitForCondition(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function evalPage(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    const message = result.exceptionDetails.exception?.description ?? result.exceptionDetails.exception?.value ?? result.exceptionDetails.text;
    throw new Error(message);
  }
  return result.result?.value;
}

async function caption(cdp, text) {
  await evalPage(cdp, `window.setDemoCaption(${JSON.stringify(text)})`);
}

async function setupDemoHelpers(cdp) {
  await evalPage(cdp, String.raw`
(() => {
  let caption = document.querySelector('.demo-caption');
  if (!caption) {
    caption = document.createElement('div');
    caption.className = 'demo-caption';
    document.body.appendChild(caption);
  }
  const style = document.createElement('style');
  style.textContent = '.demo-caption{position:fixed;left:24px;bottom:24px;z-index:1000;max-width:560px;padding:10px 12px;border:1px solid var(--vscode-focusBorder);background:color-mix(in srgb,var(--vscode-editor-background) 82%,var(--vscode-focusBorder));color:var(--vscode-foreground);box-shadow:0 8px 24px rgba(0,0,0,.35);font:600 15px/1.35 var(--vscode-font-family,system-ui)}';
  document.head.appendChild(style);
  window.setDemoCaption = (text) => { caption.textContent = text; };
  window.clickAddNodeType = (type) => {
    const item = [...document.querySelectorAll('.add-node-popover button')].find((button) => button.textContent.toLowerCase().includes(type));
    if (!item) throw new Error('Missing add-node type ' + type);
    item.click();
  };
  window.selectFlowNode = (id) => {
    const node = document.querySelector('.react-flow__node[data-id="' + id + '"], [data-id="' + id + '"]')
      || [...document.querySelectorAll('.react-flow__node')].find((item) => item.textContent.toLowerCase().includes(id.toLowerCase()));
    if (!node) throw new Error('Missing flow node ' + id);
    const rect = node.getBoundingClientRect();
    const eventInit = { bubbles: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    node.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    node.dispatchEvent(new PointerEvent('pointerup', eventInit));
    node.dispatchEvent(new MouseEvent('click', eventInit));
  };
  window.openDetails = (label) => {
    const summary = [...document.querySelectorAll('.config details summary')].find((item) => item.textContent.trim() === label);
    if (!summary) throw new Error('Missing details ' + label);
    summary.closest('details').open = true;
  };
  window.setConfigField = (label, value) => {
    const field = [...document.querySelectorAll('.config label')].find((item) => item.childNodes[0]?.textContent?.trim() === label);
    const input = field?.querySelector('input, textarea');
    if (!input) throw new Error('Missing field ' + label);
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  window.toggleArtifactDirection = (rowText, direction) => {
    const row = [...document.querySelectorAll('.reference-row')].find((item) => item.textContent.includes(rowText));
    if (!row) throw new Error('Missing artifact row ' + rowText);
    const label = [...row.querySelectorAll('.direction-chips label')].find((item) => item.textContent.includes(direction));
    if (!label) throw new Error('Missing artifact direction ' + direction);
    const input = label.querySelector('input');
    if (!input.checked) input.click();
  };
  window.toggleReferenceRow = (rowText) => {
    const row = [...document.querySelectorAll('.reference-row')].find((item) => item.textContent.includes(rowText));
    if (!row) throw new Error('Missing reference row ' + rowText);
    const input = row.querySelector('.reference-check input');
    if (!input.checked) input.click();
  };
})();
`);
}

async function renderGif() {
  const palette = join(frameDir, 'palette.png');
  await execFile('ffmpeg', ['-y', '-framerate', '8', '-i', join(frameDir, 'frame-%04d.png'), '-vf', 'palettegen=stats_mode=diff', palette]);
  await execFile('ffmpeg', ['-y', '-framerate', '8', '-i', join(frameDir, 'frame-%04d.png'), '-i', palette, '-lavfi', 'paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', output]);
}

async function execFile(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolveCode) => child.on('close', resolveCode));
  if (code !== 0) throw new Error(`${command} failed with ${code}: ${stderr}`);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
