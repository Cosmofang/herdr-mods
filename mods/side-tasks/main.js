// Side tasks: work an agent noticed outside its current task, offered with
// `herdr-suggest-task`. Each one can go on the board, start in a new tab,
// go back to the agent that found it, or be dismissed.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, theme, run, exec, knownAgents, notify, checking, watchFolder, nextCommand } from "herdr";
import * as fs from "fs/promises";
import { load, update, fromInbox, merge, setStatus, inboxDir, addBoardCard } from "./tasks.js";

const STATUS_TEXT = { started: "已开新标签", carded: "已上看板", returned: "已交还", dismissed: "已忽略" };

const label = (a) => a.pane_name || [a.space_name, a.title].filter(Boolean).join(" · ") || a.program.name;
const basename = (p) => (p ? p.replace(/\/+$/, "").split("/").pop() || p : "");
const sleep = (cx, ms) => new Promise((resolve) => cx.timer.after(ms, () => resolve()));

/** Moves every inbox file into state, then removes it. */
async function ingest() {
  const dir = inboxDir();
  let names = [];
  try { names = await fs.readdir(dir); } catch { return []; }
  const files = names.filter((n) => n.endsWith(".json") && !n.startsWith("."));
  const incoming = [];
  for (const n of files) {
    try { incoming.push(fromInbox(JSON.parse(await fs.readFile(`${dir}/${n}`, "utf8")))); } catch (e) {
      console.log(`side-tasks: skipping ${n}: ${e}`);
    }
  }
  let added = [];
  if (incoming.some(Boolean)) update((s) => { added = merge(s, incoming); return added.length > 0; });
  for (const n of files) {
    try { await fs.unlink(`${dir}/${n}`); } catch { try { await fs.rm(`${dir}/${n}`); } catch { /* dedup by id covers it */ } }
  }
  return added;
}

async function startInTab(t) {
  let list = [];
  try { list = await knownAgents(); } catch { /* fall through */ }
  const agent = list.find((a) => a.installed);
  if (!agent) {
    notify({ title: "没有可用的 agent", body: "programs.json 里没有已安装的 agent。", level: "warning" });
    return;
  }
  run("tab.new", { name: t.title, folder: t.cwd ?? undefined, argv: agent.run, task: t.prompt });
  setStatus(t.id, "started");
}

function toBoard(t) {
  addBoardCard({ title: t.title, notes: [t.prompt, t.reason && `\n> ${t.reason}`].filter(Boolean).join("\n"), folder: t.cwd });
  setStatus(t.id, "carded");
}

async function handBack(t) {
  const a = agents().find((x) => x.address === t.from);
  if (!a) {
    notify({ title: "那个 agent 已经不在了", body: "可以开新标签来做。", level: "warning" });
    return;
  }
  try {
    const r = await exec("hc", ["send", t.from, t.prompt], { timeout: 15000 });
    if (r.code !== 0) throw new Error(r.stderr || `hc send exited ${r.code}`);
    setStatus(t.id, "returned");
  } catch (e) {
    notify({ title: "没能发给它", body: String(e), level: "error" });
  }
}

export default class SideTasks extends View {
  init(_props, cx) {
    this.showSettled = false;
    this.open = null; // id whose prompt is expanded
    if (checking()) return;
    const tick = async () => {
      const added = await ingest();
      if (added.length === 1) notify({ title: "新的旁支任务", body: added[0].title });
      else if (added.length > 1) notify({ title: `${added.length} 个新的旁支任务`, body: added.map((t) => t.title).join("\n") });
    };
    // A watch for promptness, a slow poll in case the watch is reclaimed or not set up yet.
    cx.spawn(async (cx) => {
      for (;;) {
        await tick();
        try { await fs.mkdir(inboxDir(), { recursive: true }); } catch { /* ignore */ }
        try { await Promise.race([watchFolder(inboxDir()), sleep(cx, 10000)]); } catch { await sleep(cx, 10000); }
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "clear") update((s) => { s.tasks = s.tasks.filter((t) => t.status === "pending"); });
        cx.notify();
      }
    });
  }

  renderTask(t, task, byAddr) {
    const from = task.from ? byAddr.get(task.from) : null;
    const pending = task.status === "pending";
    const expanded = this.open === task.id;
    const button = (id, text, primary, action) => h_flex().id(`${id}-${task.id}`).h(26).px(10).items_center().rounded(6).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(11.5)
      .cursor_pointer().hover((s) => s.opacity(0.85))
      .on_click((_e, cx) => { cx.stop_propagation(); action(); }).child(text);
    return v_flex().id(`task-${task.id}`).gap(6).p(10).rounded(8).bg(t.background).border_1().border_color(t.border)
      .opacity(pending ? 1 : 0.6)
      .child(div().id(`title-${task.id}`).cursor_pointer().text_size(12.5).font_semibold().text_color(t.foreground)
        .on_click((_e, cx) => { this.open = expanded ? null : task.id; cx.notify(); })
        .child(task.title))
      .when(Boolean(task.reason), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(task.reason)))
      .when(expanded, (el) => el.child(div().p(8).rounded(6).bg(t.raised).text_size(11.5).text_color(t.foreground).child(task.prompt)))
      .child(h_flex().gap(8).text_size(11).text_color(t.dim)
        .child(div().truncate().child(from ? label(from) : task.from ? `${task.from}（已结束）` : "未知来源"))
        .when(Boolean(task.cwd), (el) => el.child(div().truncate().child(basename(task.cwd))))
        .when(!pending, (el) => el.child(div().ml_auto().child(STATUS_TEXT[task.status] ?? task.status))))
      .when(pending, (el) => el.child(h_flex().gap(6).pt(2).flex_wrap()
        .child(button("board", "放上看板", true, () => toBoard(task)))
        .child(button("tab", "新标签去做", false, () => startInTab(task)))
        .when(Boolean(from), (el) => el.child(button("back", "交还给它", false, () => handBack(task))))
        .child(button("drop", "忽略", false, () => setStatus(task.id, "dismissed")))));
  }

  render() {
    const t = theme();
    const all = load().tasks;
    const pending = all.filter((x) => x.status === "pending");
    const shown = this.showSettled ? all : pending;
    const byAddr = new Map(agents().map((a) => [a.address, a]));
    return v_flex().id("side-tasks").size_full().bg(t.surface).text_color(t.foreground)
      .child(h_flex().px(14).py(10).gap(8).items_center()
        .child(div().text_size(14).font_semibold().child("旁支任务"))
        .when(pending.length > 0, (el) => el.child(div().px(6).rounded(8).bg(t.accent).text_color(t.background).text_size(11).child(String(pending.length))))
        .child(div().flex_1())
        .child(div().id("settled").px(8).h(24).flex().items_center().rounded(6).text_size(11.5)
          .text_color(this.showSettled ? t.foreground : t.muted).bg(this.showSettled ? t.selected : t.canvas)
          .hover((s) => s.bg(t.hover)).cursor_pointer()
          .on_click((_e, cx) => { this.showSettled = !this.showSettled; cx.notify(); })
          .child("已处理")))
      .child(v_flex().id("tasks").flex_1().min_h(0).overflow_y_scrollbar().px(10).pb(10).gap(8)
        .when(shown.length === 0, (el) => el.child(v_flex().p(12).gap(6).text_size(12).text_color(t.dim)
          .child(div().child("还没有旁支任务。"))
          .child(div().child("agent 发现当前任务之外值得做的事时，运行 herdr-suggest-task --title … --prompt …，它就会出现在这里。"))))
        .children(shown.map((task) => this.renderTask(t, task, byAddr))));
  }
}
