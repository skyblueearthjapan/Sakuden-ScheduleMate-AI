// 判断担当: Responses API（strict JSON Schema）で「話す内容」と「行う操作」を決める。
// 受付AI の adapters/agent/openai.ts と同じ形。会話全文は保存しない。
import { OpenAI } from 'openai';
import { config } from './config.mjs';
import { DECISION_SCHEMA, decisionInput } from './prompts.mjs';

const TIMEOUT_MS = 20_000;

export async function decide({ apiKey, facts, calendar, transcript, utterance, lastSpoken, previousThinking, questionsAsked = 0 }) {
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: TIMEOUT_MS });
  const response = await client.responses.create({
    model: config.agentModel,
    input: decisionInput({ facts, calendar, transcript, utterance, lastSpoken, previousThinking, questionsAsked }),
    reasoning: { effort: 'low' },
    text: {
      format: { type: 'json_schema', name: 'schedule_decision', strict: true, schema: DECISION_SCHEMA },
    },
  });
  const parsed = JSON.parse(response.output_text);
  return {
    speak: String(parsed.speak ?? '').trim(),
    thinking: String(parsed.thinking ?? '').trim(),
    pending_event: parsed.pending_event ?? null,
    add_event: parsed.add_event ?? null,
    delete_event_id: parsed.delete_event_id ?? null,
    set_lunch: parsed.set_lunch ?? null,
  };
}
