// Minimal MCP (JSON-RPC over stdio) client for `codex mcp-server`.
// 本プロジェクト独自の薄いクライアント。Codex 公式 SDK ではない。
import { spawn } from 'node:child_process';

export class CodexMcpClient {
  #proc;
  #buf = '';
  #id = 0;
  #pending = new Map();
  #notify;

  constructor({ onNotification } = {}) {
    this.#notify = onNotification;
  }

  async start() {
    // CODEX_BIN で実行ファイルを明示できる。未指定時は PATH 上の codex を使う。
    // Windows の npm ラッパーは .cmd なので shell 経由で起動する（Node 20+ は .cmd の直接 spawn を拒否する）。
    const bin = process.env.CODEX_BIN;
    const opts = { stdio: ['pipe', 'pipe', 'pipe'], env: process.env };
    this.#proc = bin
      ? spawn(bin, ['mcp-server'], opts)
      : process.platform === 'win32'
        ? spawn('codex mcp-server', { ...opts, shell: true })
        : spawn('codex', ['mcp-server'], opts);
    this.#proc.stdout.on('data', (d) => this.#onData(d.toString()));
    this.#proc.stderr.on('data', (d) => {
      const s = d.toString();
      if (!/deprecated/i.test(s)) process.stderr.write(`[codex] ${s}`);
    });
    const init = await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'reception-ai-codex-image', version: '0.1.0' },
    });
    this.notify('notifications/initialized', {});
    return init;
  }

  #onData(chunk) {
    this.#buf += chunk;
    let i;
    while ((i = this.#buf.indexOf('\n')) >= 0) {
      const line = this.#buf.slice(0, i).trim();
      this.#buf = this.#buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && this.#pending.has(msg.id)) {
        const { resolve, reject } = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.#notify?.(msg);
      }
    }
  }

  request(method, params, { timeoutMs = 20 * 60 * 1000 } = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      this.#proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method, params) {
    this.#proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async listTools() {
    return (await this.request('tools/list', {})).tools;
  }

  async callTool(name, args, opts) {
    return this.request('tools/call', { name, arguments: args }, opts);
  }

  close() {
    try {
      this.#proc?.stdin.end();
      this.#proc?.kill();
    } catch {
      /* ignore */
    }
  }
}
