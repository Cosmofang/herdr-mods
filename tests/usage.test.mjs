import assert from "node:assert/strict";
import {
  claudeProjectDir, emptyStats, feedClaude, feedCodex, splitLines, snapshot, tokensPerSecond, fmtTokens,
} from "./.build/usage.mjs";

const j = (o) => JSON.stringify(o);
const at = (s) => `2026-11-25T10:00:${String(s).padStart(2, "0")}.000Z`;

// Claude Code's folder naming: every non-alphanumeric char (CJK too) becomes "-".
assert.equal(claudeProjectDir("/Users/me/Desktop/cosmocloud/开发项目"), "-Users-me-Desktop-cosmocloud-----");
assert.equal(claudeProjectDir("/a/b_c.d"), "-a-b-c-d");

assert.equal(tokensPerSecond(10, 5000), null, "too few tokens");
assert.equal(tokensPerSecond(100, 200), null, "too short");
assert.equal(tokensPerSecond(500, 10000), 50);

{
  // A tool result at :00, then one message in two records finishing at :10 with 400 tokens.
  const usage = (out) => ({ input_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: out });
  const s = feedClaude(emptyStats(), [
    j({ type: "user", timestamp: at(0) }),
    j({ type: "assistant", timestamp: at(4), message: { id: "m1", model: "claude-opus-5-5", usage: usage(400) } }),
    j({ type: "assistant", timestamp: at(10), message: { id: "m1", model: "claude-opus-5-5", usage: usage(400) } }),
  ]);
  // Still streaming: the snapshot counts it, the stats themselves don't yet.
  assert.equal(s.output, 0);
  const live = snapshot(s);
  assert.equal(live.output, 400);
  assert.equal(live.rate, 40);
  assert.equal(live.context, 1205);
  assert.equal(live.model, "claude-opus-5-5");
  // The next user record finishes it; a second message adds up.
  feedClaude(s, [
    j({ type: "user", timestamp: at(20) }),
    j({ type: "assistant", timestamp: at(22), message: { id: "m2", usage: usage(100) } }),
    j({ type: "user", timestamp: at(23) }),
  ]);
  assert.equal(s.output, 500);
  assert.equal(s.cacheRead, 2000);
  assert.equal(s.rate, 50, "m2: 100 tokens in 2 s");
  assert.equal(snapshot(s).output, 500, "nothing streaming: snapshot equals stats");
}

{
  const s = feedCodex(emptyStats(), [
    j({ type: "session_meta", timestamp: at(0), payload: { cwd: "/x" } }),
    j({ type: "turn_context", timestamp: at(0), payload: { model: "gpt-5.5" } }),
    j({ type: "response_item", timestamp: at(1), payload: { type: "message", role: "user" } }),
    j({ type: "event_msg", timestamp: at(11), payload: { type: "token_count", info: {
      total_token_usage: { input_tokens: 30000, cached_input_tokens: 20000, output_tokens: 900 },
      last_token_usage: { input_tokens: 30000, output_tokens: 600 },
      model_context_window: 258400 } } }),
  ]);
  assert.equal(s.model, "gpt-5.5");
  assert.equal(s.output, 900);
  assert.equal(s.input, 10000);
  assert.equal(s.context, 30000);
  assert.equal(s.contextWindow, 258400);
  assert.equal(s.rate, 60);
}

{
  let r = splitLines("", '{"a":1}\n{"b"');
  assert.deepEqual(r.lines, ['{"a":1}']);
  assert.equal(r.carry, '{"b"');
  r = splitLines(r.carry, ':2}\n');
  assert.deepEqual(r.lines, ['{"b":2}']);
  assert.equal(r.carry, "");
}

assert.equal(fmtTokens(950), "950");
assert.equal(fmtTokens(12345), "12.3k");
assert.equal(fmtTokens(2_500_000), "2.5M");

console.log("usage: ok");
