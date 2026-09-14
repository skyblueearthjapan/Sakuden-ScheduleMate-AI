// GPT-Live の接続だけを閉じ込めた層（受付AI の adapters/voice/gpt-live.ts の縮約版）。
// - セッション作成はサーバーだけ。API キーはブラウザへ渡さない
// - 判断と commentary は sideband（サーバー）から送る
// - 文字起こしはメモリだけ。保存しない
import { randomUUID } from 'node:crypto';
import { OpenAI } from 'openai';
import { SidebandWS } from 'openai/resources/live/sideband/ws';

const TRANSCRIPT_BUFFER_CHARS = 4000;
const MAX_COMMENTARY_CHARS = 400;
const CLOSE_WAIT_MS = 15_000;
const MAX_RECONNECTS = 3;

export class LiveSession {
  constructor({ apiKey, log }) {
    this.client = new OpenAI({ apiKey, maxRetries: 0 });
    this.log = log;
    this.id = randomUUID();
    this.providerId = null;
    this.socket = null;
    this.closed = false;
    this.closing = false;
    this.started = false;
    this.usageSeconds = 0;
    this.input = ''; // 会長の発話（文字起こし）
    this.reconnects = 0;
    this.handlers = {};
    this.closeWaiters = [];
  }

  /** WebRTC の offer を渡してセッションを作り、sideband を張る。answer を返す。 */
  async create({ sdp, model, voice, instructions }) {
    const created = await this.client.live.create({
      session: { model, instructions, audio: { output: { voice } }, delegation: { type: 'client' }, store: false },
      transport: { type: 'webrtc', sdp },
    });
    this.providerId = created.session.id;
    this.attach();
    return created.transport.sdp;
  }

  on(handlers) {
    this.handlers = handlers;
  }

  attach() {
    let socket;
    try {
      socket = new SidebandWS(this.client, { session_id: this.providerId }, { reconnect: null });
    } catch (e) {
      this.log.error('sideband attach failed', String(e));
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.on('event', (event) => {
      try {
        this.handleEvent(event);
      } catch (e) {
        this.log.error('event handling failed', String(e));
      }
    });
    socket.on('error', (e) => this.log.warn('sideband error', String(e?.message ?? e)));
    socket.on('close', (code) => {
      this.socket = null;
      if (this.closed || this.closing) return;
      this.log.warn(`sideband closed (${code})`);
      this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.closed || this.closing) return;
    if (this.reconnects >= MAX_RECONNECTS) {
      this.finish('connection_lost');
      return;
    }
    this.reconnects += 1;
    setTimeout(() => this.attach(), 500 * 2 ** (this.reconnects - 1)).unref?.();
  }

  handleEvent(event) {
    switch (event.type) {
      case 'session.input_audio.append':
      case 'session.output_audio.delta':
        return; // 音声のコピー。読み捨てる
      case 'session.started':
        this.started = true;
        this.log.info('live session started');
        this.handlers.onStarted?.();
        return;
      case 'session.input_transcript.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (!delta) return;
        this.input = (this.input + delta).slice(-TRANSCRIPT_BUFFER_CHARS);
        return;
      }
      case 'session.delegation.created': {
        const id = event.delegation?.id;
        if (typeof id !== 'string') return;
        this.handlers.onDelegation?.(id);
        return;
      }
      case 'session.usage.updated':
        if (typeof event.usage?.seconds === 'number') this.usageSeconds = event.usage.seconds;
        return;
      case 'session.closed':
        if (typeof event.usage?.seconds === 'number') this.usageSeconds = event.usage.seconds;
        this.closing = true;
        this.finish(typeof event.reason === 'string' ? event.reason : 'unknown');
        return;
      case 'error':
        this.log.warn('live error', event.error?.code ?? 'unknown', event.error?.param ?? '');
        return;
      default:
        return;
    }
  }

  recentTranscript(maxChars = 1200) {
    return this.input.length <= maxChars ? this.input : this.input.slice(-maxChars);
  }

  send(event) {
    if (!this.socket) {
      this.log.warn('dropped client event (no sideband)', event.type);
      return;
    }
    this.socket.send({ ...event, event_id: randomUUID() });
  }

  /** 内部メモ → 発話内容の順で注入。content が空なら thinking だけ。 */
  reply(delegationId, { thinking, content }) {
    if (thinking) this.send({ type: 'session.thinking.append', delegation_id: delegationId, content: thinking.slice(0, MAX_COMMENTARY_CHARS) });
    if (content) this.send({ type: 'session.commentary.append', delegation_id: delegationId, content: content.slice(0, MAX_COMMENTARY_CHARS) });
  }

  async close() {
    if (this.closed) return this.usageSeconds;
    this.closing = true;
    if (!this.socket) {
      this.finish('connection_lost');
      return this.usageSeconds;
    }
    const settled = new Promise((resolve) => this.closeWaiters.push(resolve));
    this.send({ type: 'session.close' });
    const timer = setTimeout(() => this.finish('unknown'), CLOSE_WAIT_MS);
    timer.unref?.();
    await settled;
    clearTimeout(timer);
    return this.usageSeconds;
  }

  finish(reason) {
    if (this.closed) return;
    this.closed = true;
    this.input = '';
    try {
      this.socket?.close();
    } catch {
      /* already closed */
    }
    this.socket = null;
    this.log.info(`live session closed (${reason}, ${this.usageSeconds}s)`);
    const waiters = this.closeWaiters;
    this.closeWaiters = [];
    for (const w of waiters) w();
    this.handlers.onClosed?.(reason, this.usageSeconds);
  }
}
