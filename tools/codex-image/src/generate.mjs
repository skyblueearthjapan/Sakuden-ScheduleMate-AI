// 画像アセットを Codex MCP（codex mcp-server）経由で GPT-Image に生成させる。
// 使い方: node tools/codex-image/src/generate.mjs [--only <id>] [--force]
import { readFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexMcpClient } from './mcp-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const manifest = JSON.parse(await readFile(path.resolve(here, '../manifest.json'), 'utf8'));
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const force = args.includes('--force');
const outRoot = path.resolve(repoRoot, manifest.outputDir);
await mkdir(outRoot, { recursive: true });

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

function buildPrompt(item) {
  const target = path.join(manifest.outputDir, item.file).replace(/\\/g, '/');
  return [
    'You are generating an image asset for a small Japanese company\'s conversational scheduling assistant web app.',
    `Use your built-in image generation capability (GPT-Image, latest available model such as gpt-image-2.5 if selectable) to create ONE image and save it to exactly this path relative to the current working directory: ${target}`,
    `Requested size: ${item.size}. Format: PNG${item.transparent ? ' with transparent background' : ''}.`,
    'Style for the whole asset set: warm, homely, friendly; cream / peach / soft wood palette; no text or letters inside the image; no watermark; no real company logos.',
    `Subject: ${item.prompt}`,
    `After the file is written, verify it exists at ${target} and reply with a single line: DONE ${target}`,
    'Do not create any other files. Do not modify source code.',
  ].join('\n');
}

const client = new CodexMcpClient({
  onNotification: (m) => {
    if (m.method !== 'codex/event') return;
    const ev = m.params?.msg ?? m.params;
    const type = ev?.type;
    const noisy = new Set(['agent_message_delta', 'agent_message_content_delta', 'agent_reasoning_delta', 'agent_reasoning_raw_content_delta', 'token_count', 'raw_response_item', 'raw_response_completed', 'exec_command_output_delta', 'item_started', 'item_completed']);
    if (!type || noisy.has(type)) return;
    console.log(`  · ${type}${type === 'agent_message' ? ' ' + String(ev.message ?? '').slice(0, 120) : ''}`);
  },
});

console.log('starting codex mcp-server ...');
const init = await client.start();
console.log(`connected: ${init.serverInfo?.name} ${init.serverInfo?.version}`);
const tools = await client.listTools();
if (!tools.some((t) => t.name === 'codex')) throw new Error('codex tool not exposed by MCP server');

let failed = false;
for (const item of manifest.images) {
  if (only && item.id !== only) continue;
  const outFile = path.join(outRoot, item.file);
  if (!force && (await exists(outFile))) { console.log(`skip (exists): ${item.file}`); continue; }
  console.log(`generating ${item.id} -> ${item.file}`);
  const started = Date.now();
  try {
    const res = await client.callTool('codex', { prompt: buildPrompt(item), cwd: repoRoot, sandbox: 'workspace-write', 'approval-policy': 'never' }, { timeoutMs: 20 * 60 * 1000 });
    const text = res?.structuredContent?.content ?? res?.content?.map((c) => c.text).join('\n') ?? '';
    const ok = await exists(outFile);
    console.log(`${ok ? 'OK' : 'MISSING'} ${item.id} (${Math.round((Date.now() - started) / 1000)}s) ${text.trim().split('\n').slice(-1)[0] ?? ''}`);
    if (!ok) failed = true;
  } catch (e) { console.log(`ERROR ${item.id}: ${e.message}`); failed = true; }
}
client.close();
process.exit(failed ? 1 : 0);
