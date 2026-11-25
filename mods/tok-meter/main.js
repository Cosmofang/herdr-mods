// Tok meter: output speed (tok/s), context fill and token totals for each agent,
// read from the agent's own transcript (Claude Code and Codex).
// Publishes shared("tok-meter.v1") = { [address]: { rate, rateAt, context, contextWindow, output } }
// so other mods (the board) can show it too.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, panes, theme, run, exec, home, checking, setShared, shared } from "herdr";
import {
  claudeProjectDir, emptyStats, feedClaude, feedCodex, splitLines, snapshot,
  claudeWindow, fmtTokens,
} from "./usage.js";

const SHARED_KEY = "tok-meter.v1";
const POLL_MS = 2000;
const MAP_MS = 15000;
const FIRST_READ_MAX = 6 * 1024 * 1024; // a huge old transcript: start near its end

const kindOf = (a) => {
  const k = `${a.app ?? ""} ${a.program?.key ?? ""}`.toLowerCase();
  if (k.includes("claude")) return "claude";
  if (k.includes("codex")) return "codex";
  return null;
};

const label = (a) => a.pane_name || [a.space_name, a.title].filter(Boolean).join(" · ") || a.program.name;

async function sh(script, ...args) {
  const r = await exec("sh", ["-c", script, "sh", ...args], { timeout: 10000 });
  return r.stdout ?? "";
}

const sleep = (cx, ms) => new Promise((resolve) => cx.timer.after(ms, () => resolve()));

export default class TokMeter extends View {
  init(_props, cx) {
    this.files = new Map(); // address -> path
    this.readers = new Map(); // path -> { offset, carry, stats }
    this.error = null;
    if (checking()) return;
    cx.spawn(async (cx) => {
      let mappedAt = 0;
      for (;;) {
        try {
          if (Date.now() - mappedAt > MAP_MS) { await this.mapFiles(); mappedAt = Date.now(); }
          if (await this.poll()) { this.publish(); cx.notify(); }
          this.error = null;
        } catch (e) {
          if (String(e) !== this.error) { this.error = String(e); console.log(`tok-meter: ${e}`); cx.notify(); }
        }
        // Working agents are polled often; an idle window only now and then.
        const busy = agents().some((a) => a.status === "working");
        await sleep(cx, busy ? POLL_MS : POLL_MS * 3);
      }
    });
  }

  /** Matches each Claude/Codex agent to the transcript it is most likely writing. */
  async mapFiles() {
    const cwdOf = new Map(panes().map((p) => [p.pane, p.cwd]));
    const list = agents().filter((a) => kindOf(a) && cwdOf.get(a.pane));
    const next = new Map();

    // Claude: agents in one folder take that folder's newest transcripts, most recently active first.
    const byDir = new Map();
    for (const a of list.filter((a) => kindOf(a) === "claude")) {
      const dir = `${home()}/.claude/projects/${claudeProjectDir(cwdOf.get(a.pane))}`;
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir).push(a);
    }
    for (const [dir, group] of byDir) {
      const out = await sh('ls -t "$1"/*.jsonl 2>/dev/null | head -n "$2"', dir, String(group.length));
      const files = out.split("\n").filter(Boolean);
      group.sort((x, y) => y.seq - x.seq).forEach((a, i) => { if (files[i]) next.set(a.address, files[i]); });
    }

    // Codex: recent rollouts, matched by the cwd in their first record.
    const codex = list.filter((a) => kindOf(a) === "codex");
    if (codex.length) {
      const out = await sh(
        'find "$1" -name "rollout-*.jsonl" -mtime -3 2>/dev/null | xargs ls -t 2>/dev/null | head -n 40 | while read -r f; do printf "%s\\t" "$f"; head -c 4000 "$f" | head -n 1 | grep -o \'"cwd":"[^"]*"\' | head -n 1; echo; done',
        `${home()}/.codex/sessions`);
      const rows = out.split("\n").map((l) => l.split("\t")).filter((r) => r[1]);
      const used = new Set();
      for (const a of codex.sort((x, y) => y.seq - x.seq)) {
        const want = `"cwd":"${cwdOf.get(a.pane)}"`;
        const hit = rows.find((r) => r[1] === want && !used.has(r[0]));
        if (hit) { used.add(hit[0]); next.set(a.address, hit[0]); }
      }
    }

    this.files = next;
    const live = new Set(next.values());
    for (const path of this.readers.keys()) if (!live.has(path)) this.readers.delete(path);
  }

  /** Reads what each mapped transcript gained since last time. True if anything changed. */
  async poll() {
    let changed = false;
    for (const [address, path] of this.files) {
      const a = agents().find((x) => x.address === address);
      if (!a) continue;
      let rd = this.readers.get(path);
      const size = Number((await sh('wc -c < "$1"', path)).trim());
      if (!Number.isFinite(size)) continue;
      if (!rd) {
        const start = Math.max(0, size - FIRST_READ_MAX);
        rd = { offset: start, carry: "", stats: emptyStats(), partial: start > 0, skipFirst: start > 0 };
        this.readers.set(path, rd);
      }
      if (size < rd.offset) { rd.offset = 0; rd.carry = ""; rd.stats = emptyStats(); }
      if (size === rd.offset) continue;
      const text = await sh('tail -c +"$2" "$1" | head -c "$3"', path, String(rd.offset + 1), String(size - rd.offset));
      rd.offset = size;
      let { lines, carry } = splitLines(rd.carry, text);
      if (rd.skipFirst) { lines = lines.slice(1); rd.skipFirst = false; }
      rd.carry = carry;
      (kindOf(a) === "codex" ? feedCodex : feedClaude)(rd.stats, lines);
      changed = true;
    }
    return changed;
  }

  statsFor(address) {
    const path = this.files.get(address);
    const rd = path && this.readers.get(path);
    if (!rd) return null;
    const s = snapshot(rd.stats);
    if (s.contextWindow == null && s.kind === "claude") s.contextWindow = claudeWindow(s.model);
    return { ...s, partial: rd.partial, path };
  }

  publish() {
    const out = {};
    for (const address of this.files.keys()) {
      const s = this.statsFor(address);
      if (s) out[address] = { rate: s.rate, rateAt: s.rateAt, context: s.context, contextWindow: s.contextWindow, output: s.output, model: s.model };
    }
    const prev = shared(SHARED_KEY);
    if (JSON.stringify(prev) !== JSON.stringify(out)) setShared(SHARED_KEY, out);
  }

  renderRow(t, a) {
    const s = this.statsFor(a.address);
    const fresh = s?.rateAt && Date.now() - s.rateAt < 90_000;
    const pct = s?.contextWindow ? Math.min(1, s.context / s.contextWindow) : 0;
    const barColor = pct > 0.85 ? t.blocked : pct > 0.6 ? t.working : t.accent;
    const dot = { working: t.working, blocked: t.blocked, done: t.done, idle: t.idle }[a.status] ?? t.unknown;
    return v_flex().id(`row-${a.address}`).gap(6).px(12).py(10).rounded(8).bg(t.background).border_1().border_color(t.border)
      .cursor_pointer().hover((st) => st.border_color(t.input))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .child(h_flex().gap(8).items_center()
        .child(div().w(7).h(7).rounded(4).bg(dot))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(label(a)))
        .child(div().text_size(15).font_semibold().text_color(s?.rate != null && fresh ? t.foreground : t.dim)
          .child(s?.rate != null ? `${s.rate}` : "–"))
        .child(div().text_size(11).text_color(t.dim).child("tok/s")))
      .child(!s
        ? div().text_size(11).text_color(t.dim).child(kindOf(a) ? "没找到它的对话记录" : "只支持 Claude Code 和 Codex")
        : v_flex().gap(5)
          .child(h_flex().gap(8).text_size(11).text_color(t.muted)
            .child(div().flex_1().truncate().child(s.model ?? (s.kind === "codex" ? "codex" : "claude")))
            .child(div().child(`上下文 ${fmtTokens(s.context)}${s.contextWindow ? ` / ${fmtTokens(s.contextWindow)}` : ""}`)))
          .child(div().h(4).w_full().rounded(2).bg(t.raised)
            .child(div().h_full().rounded(2).bg(barColor).w(`${Math.round(pct * 1000) / 10}%`)))
          .child(h_flex().gap(10).text_size(11).text_color(t.dim)
            .child(div().child(`输出 ${fmtTokens(s.output)}${s.partial ? "+" : ""}`))
            .child(div().child(`缓存读 ${fmtTokens(s.cacheRead)}`))
            .child(div().child(`新输入 ${fmtTokens(s.input + s.cacheWrite)}`))));
  }

  render() {
    const t = theme();
    const list = agents();
    let total = 0;
    for (const a of list) total += this.statsFor(a.address)?.output ?? 0;
    return v_flex().id("tok-meter").size_full().bg(t.surface).text_color(t.foreground)
      .child(h_flex().px(14).py(10).gap(8).items_center()
        .child(div().text_size(14).font_semibold().child("Token"))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(`本会话输出 ${fmtTokens(total)}`)))
      .when(Boolean(this.error), (el) => el.child(div().px(14).pb(8).text_size(11).text_color(t.blocked).child(this.error)))
      .child(v_flex().id("rows").flex_1().min_h(0).overflow_y_scrollbar().px(10).pb(10).gap(8)
        .when(list.length === 0, (el) => el.child(div().p(12).text_size(12).text_color(t.dim).child("没有正在运行的 agent。")))
        .children(list.map((a) => this.renderRow(t, a))));
  }
}
