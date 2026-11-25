// Token usage from the agents' own transcripts. Pure: no Herdr, no files.
// Claude Code: ~/.claude/projects/<cwd with every non-alphanumeric char as "-">/<session>.jsonl,
//   one record per content block, assistant records carry message.id and message.usage.
// Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, first record session_meta {cwd},
//   event_msg token_count records carry running totals.

/** Claude Code's project folder name for a working directory. */
export function claudeProjectDir(cwd) {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

/** T3's rule: requests too short to time report nothing. */
export function tokensPerSecond(outputTokens, elapsedMs) {
  if (!(outputTokens >= 20) || !(elapsedMs >= 500)) return null;
  return Math.round((outputTokens * 1000) / elapsedMs);
}

export function emptyStats() {
  return {
    kind: null,
    model: null,
    output: 0, // all output tokens this session
    input: 0, // uncached input
    cacheRead: 0,
    cacheWrite: 0,
    context: 0, // tokens in the last request
    contextWindow: null,
    rate: null, // tok/s of the last timed request
    rateAt: null, // ms
    lastAt: null, // ms of the last record
    // Claude bookkeeping: the message being streamed, and when its request started.
    cur: null, // { id, start, end, out, usage }
    inputAt: null,
  };
}

const ms = (ts) => {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
};

function finishClaude(s) {
  const m = s.cur;
  if (!m) return;
  s.cur = null;
  const u = m.usage ?? {};
  s.output += u.output_tokens ?? 0;
  s.input += u.input_tokens ?? 0;
  s.cacheRead += u.cache_read_input_tokens ?? 0;
  s.cacheWrite += u.cache_creation_input_tokens ?? 0;
  s.context = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const r = m.start != null && m.end != null ? tokensPerSecond(u.output_tokens ?? 0, m.end - m.start) : null;
  if (r != null) { s.rate = r; s.rateAt = m.end; }
}

/** Live view of stats: the message still streaming counts too. */
export function snapshot(s) {
  if (!s.cur) return { ...s };
  const copy = { ...s, cur: { ...s.cur } };
  finishClaude(copy);
  return copy;
}

/** Feeds complete JSONL lines of a Claude Code transcript into stats (mutates and returns it). */
export function feedClaude(s, lines) {
  s.kind = "claude";
  for (const line of lines) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    const at = ms(r.timestamp);
    if (at != null) s.lastAt = at;
    const msg = r.message;
    if (r.type === "assistant" && msg?.id && msg.usage) {
      if (s.cur && s.cur.id !== msg.id) finishClaude(s);
      if (!s.cur) s.cur = { id: msg.id, start: s.inputAt ?? at, end: at, usage: msg.usage };
      s.cur.end = at ?? s.cur.end;
      // Later records of one message carry the fuller usage.
      if ((msg.usage.output_tokens ?? 0) >= (s.cur.usage.output_tokens ?? 0)) s.cur.usage = msg.usage;
      if (msg.model && msg.model !== "<synthetic>") s.model = msg.model;
    } else if (r.type === "user" || r.type === "system") {
      finishClaude(s);
      if (at != null) s.inputAt = at;
    }
  }
  return s;
}

/** Feeds complete JSONL lines of a Codex rollout into stats. */
export function feedCodex(s, lines) {
  s.kind = "codex";
  for (const line of lines) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    const at = ms(r.timestamp);
    if (at != null) s.lastAt = at;
    const p = r.payload ?? {};
    if (r.type === "turn_context" && p.model) s.model = p.model;
    if (r.type === "response_item" && (p.type === "function_call_output" || (p.type === "message" && p.role === "user"))) {
      if (at != null) s.inputAt = at;
    }
    if (r.type === "event_msg" && p.type === "token_count" && p.info) {
      const tot = p.info.total_token_usage ?? {};
      const last = p.info.last_token_usage ?? {};
      s.output = tot.output_tokens ?? s.output;
      s.cacheRead = tot.cached_input_tokens ?? s.cacheRead;
      s.input = Math.max(0, (tot.input_tokens ?? 0) - (tot.cached_input_tokens ?? 0));
      s.context = last.input_tokens ?? s.context;
      s.contextWindow = p.info.model_context_window ?? s.contextWindow;
      const rt = s.inputAt != null && at != null ? tokensPerSecond(last.output_tokens ?? 0, at - s.inputAt) : null;
      if (rt != null) { s.rate = rt; s.rateAt = at; }
      if (at != null) s.inputAt = at;
    }
  }
  return s;
}

/** Splits new text into complete lines and the unfinished tail. */
export function splitLines(carry, text) {
  const all = carry + text;
  const cut = all.lastIndexOf("\n");
  if (cut < 0) return { lines: [], carry: all };
  return { lines: all.slice(0, cut).split("\n"), carry: all.slice(cut + 1) };
}

/** Context windows Claude Code runs with, by model id prefix. */
export function claudeWindow(model) {
  if (!model) return null;
  if (/\[1m\]/.test(model)) return 1_000_000;
  return 200_000;
}

export function fmtTokens(n) {
  if (n == null) return "–";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}
