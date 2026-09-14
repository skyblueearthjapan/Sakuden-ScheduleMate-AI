// 委譲 → 判断 → 記録 → 返答（会話の中身）。index.mjs から呼ぶ。テストは偽の live を渡す。
import { config, readApiKey } from './config.mjs';
import { addDays, calendarTable, tokyoDate, tokyoTime } from './dates.mjs';
import * as dashboard from './dashboard.mjs';
import * as store from './store.mjs';
import { decide } from './agent.mjs';
import { factsBlock } from './prompts.mjs';

export const newState = () => ({ lastRaw: '', lastThinking: '', lastSpoken: '', pending: null, lastAdded: null, questions: 0 });

/** 1 件の予定につき追加の質問はここまで（聞きすぎ防止）。 */
export const MAX_QUESTIONS = 2;
const isQuestion = (t) => /[?？]\s*$/.test(t) && !/よろしい|いいですか|でいいです/.test(t);

export async function gatherFacts(state) {
  const today = tokyoDate();
  // 先月の振り返りと来月の確認に答えられるよう、先月〜3 か月先を渡す
  let events = [];
  let dashboardError = null;
  try {
    events = await dashboard.upcomingEvents(addDays(today, -45), addDays(today, 95));
  } catch (e) {
    dashboardError = String(e.message ?? e);
  }
  const lunch = store.lunchFor(addDays(today, -1), addDays(today, 14));
  const names = await dashboard.knownNames().catch(() => []);
  return {
    today,
    events,
    lunch,
    dashboardError,
    text: factsBlock({ today, now: tokyoTime(), events, lunch, pending: state?.pending ?? null, lastAdded: state?.lastAdded ?? null, names, dashboardError }),
  };
}

/** 委譲文は会話全体の累積で届く。「この回に新しく言われた部分」を差分で取り出す（受付AI と同じ）。 */
export function tailAfter(previous, current) {
  const prev = previous.trim();
  const cur = current.trim();
  if (prev === '' || cur === prev) return prev === '' ? cur : '';
  if (cur.startsWith(prev)) return cur.slice(prev.length).trim();
  const idx = cur.indexOf(prev);
  if (idx >= 0) return cur.slice(idx + prev.length).trim();
  return cur;
}

/**
 * session = { live: { recentTranscript(), reply(delegationId, {thinking, content}) }, state }
 */
export async function handleDelegation(session, delegationId, log) {
  const { live, state } = session;
  const transcript = live.recentTranscript();
  const utterance = tailAfter(state.lastRaw, transcript);
  state.lastRaw = transcript;
  if (config.debugText) log.info('VOICE_DEBUG_TEXT utterance:', utterance);

  let decision;
  try {
    const facts = await gatherFacts(state);
    decision = await decide({
      apiKey: readApiKey(),
      facts: facts.text,
      calendar: calendarTable(facts.today),
      transcript,
      utterance,
      lastSpoken: state.lastSpoken,
      previousThinking: state.lastThinking,
      questionsAsked: state.questions,
    });
  } catch (e) {
    log.error('decision failed', String(e));
    live.reply(delegationId, { thinking: state.lastThinking, content: 'すみません、いま確認できませんでした。もう一度お願いします。' });
    return null;
  }
  if (config.debugText) log.info('VOICE_DEBUG_TEXT decision:', JSON.stringify(decision));

  // 記録。失敗したら話す内容を差し替える（成功したふりをしない）
  const notes = [];
  try {
    if (decision.add_event) {
      const created = await dashboard.addEvent(decision.add_event);
      state.lastAdded = { ...decision.add_event, id: created?.id };
      notes.push(`登録済み: ${created?.date} ${created?.title}`);
      log.info('event added', created?.id);
    }
    if (decision.delete_event_id) {
      await dashboard.deleteEvent(decision.delete_event_id);
      notes.push(`削除済み: ${decision.delete_event_id}`);
      log.info('event deleted', decision.delete_event_id);
    }
    if (decision.set_lunch) {
      store.setLunch(decision.set_lunch.date, decision.set_lunch.needed);
      notes.push(`お弁当 ${decision.set_lunch.date}: ${decision.set_lunch.needed ? 'いる' : 'いらない'}`);
      log.info('lunch set', decision.set_lunch.date, decision.set_lunch.needed);
    }
  } catch (e) {
    log.error('record failed', String(e));
    decision.speak = 'すみません、ダッシュボードに書き込めませんでした。少し経ってからもう一度お願いします。';
    decision.pending_event = decision.add_event ?? decision.pending_event;
  }
  // 追加の質問の回数: 予定を聞いている途中（pending あり・登録なし）で質問文を返したら +1。予定が確定・消滅したら 0 に戻す
  if (decision.pending_event && !decision.add_event && isQuestion(decision.speak)) state.questions += 1;
  if (!decision.pending_event) state.questions = 0;
  state.pending = decision.pending_event ?? null;
  state.lastThinking = [decision.thinking, ...notes].filter(Boolean).join('\n');
  if (decision.speak) state.lastSpoken = decision.speak;
  live.reply(delegationId, { thinking: state.lastThinking, content: decision.speak });
  return decision;
}
