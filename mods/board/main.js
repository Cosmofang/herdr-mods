// Board: a task board whose cards follow Herdr's agents.
// Opened as a tab (palette: "Board"); with props {card} it is that card's detail dialog.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import {
  agents, panes, spaces, focused, theme, run, props, openOverlay, closeOverlay,
  knownAgents, pickFolder, notify, checking, nextCommand, shared,
} from "herdr";
import {
  COLUMNS, load, update, newCard, reconcile, sortCards, today, basename,
  restoreFromFile, mirrorToFile,
} from "./store.js";

/** How an agent reads to a person: its pane's name, else its space and terminal title. */
function agentLabel(a) {
  return a.pane_name || [a.space_name, a.title].filter(Boolean).join(" · ") || a.program.name;
}

/** Narrower than this (px), the board is one list of rows, as in a pane beside a terminal. */
const NARROW = 640;

const STATUS_TEXT = { working: "运行中", blocked: "等你处理", done: "已完成", idle: "空闲", gone: "已结束" };

function statusColor(t, s) {
  return { working: t.working, blocked: t.blocked, done: t.done, idle: t.idle }[s] ?? t.unknown;
}

/** " · 60 tok/s" from the tok-meter mod while one is open and the speed is recent, else "". */
function speed(address) {
  const s = shared("tok-meter.v1")?.[address];
  return s?.rate != null && Date.now() - (s.rateAt ?? 0) < 90_000 ? ` · ${s.rate} tok/s` : "";
}

function columnColor(t, col) {
  return { todo: t.muted, doing: t.working, review: t.blocked, done: t.done }[col] ?? t.dim;
}

function currentFolder() {
  const f = focused();
  if (f?.cwd) return f.cwd;
  const sp = spaces().find((s) => s.active);
  return sp?.folder || null;
}

/** Starts an agent in the card's folder with the card as its first message. */
async function handToAgent(card) {
  let list = [];
  try { list = await knownAgents(); } catch (e) { /* fall through */ }
  const agent = list.find((a) => a.installed);
  if (!agent) {
    notify({ title: "没有可用的 agent", body: "programs.json 里没有已安装的 agent。", level: "warning" });
    return;
  }
  const folder = card.folder || currentFolder();
  const task = card.notes?.trim() ? `${card.title}\n\n${card.notes.trim()}` : card.title;
  const known = agents().map((a) => a.address);
  update((b) => {
    const c = b.cards.find((x) => x.id === card.id);
    if (!c) return false;
    Object.assign(c, { agent: null, agentStatus: null, pending: { since: Date.now(), known }, folder: c.folder || folder, updated: Date.now() });
  });
  run("tab.new", { name: card.title, folder: folder ?? undefined, argv: agent.run, task });
}

function patchCard(id, fields) {
  update((b) => {
    const c = b.cards.find((x) => x.id === id);
    if (!c) return false;
    Object.assign(c, fields, { updated: Date.now() });
  });
}

export default class Board extends View {
  init(_props, cx) {
    this.detail = Boolean(props()?.card);
    if (this.detail) return this.initDetail(cx);

    this.drag = null; // { kind: "card", id } | { kind: "agent", address }, moved
    this.hoverCol = null;
    this.showArchived = false;
    this.width = null; // from on_size_change; below NARROW the columns stack
    // "rows" or "columns" from props (the right-side palette entry asks for rows); null: by width.
    this.view = props()?.view ?? null;
    this.filter = "open"; // narrow only: "open" (all but done) or a column id
    this.input = InputState.new({ placeholder: "新卡片，回车添加" });
    this.input.on("submit", (_e, cx) => this.addCard(cx));

    if (checking()) return;
    cx.spawn(async (cx) => { await restoreFromFile(); cx.notify(); });
    cx.timer.every(3000, () => { mirrorToFile(); });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "add") this.input.focus();
        cx.notify();
      }
    });
  }

  // ---------- board ----------

  addCard(cx) {
    const title = this.input.value().trim();
    if (!title) return;
    update((b) => { b.cards.push(newCard({ title, folder: currentFolder() })); });
    this.input.set_value("");
    cx.notify();
  }

  drop(column) {
    const d = this.drag;
    this.drag = null;
    this.hoverCol = null;
    if (!d?.moved) return;
    if (d.kind === "card") {
      patchCard(d.id, { column, archived: false });
    } else if (d.kind === "agent") {
      const a = agents().find((x) => x.address === d.address);
      if (!a) return;
      update((b) => {
        const existing = b.cards.find((c) => c.agent === a.address);
        if (existing) {
          Object.assign(existing, { column, archived: false, updated: Date.now() });
          return;
        }
        const cwd = panes().find((p) => p.pane === a.pane)?.cwd ?? null;
        b.cards.push(newCard({
          title: agentLabel(a),
          column,
          agent: a.address,
          agentStatus: a.status, // the drop wins over auto-flow until the next change
          folder: cwd,
          due: today(),
        }));
      });
    }
  }

  openCard(id) {
    openOverlay({ mod: "board", props: { card: id }, kind: "dialog", width: 600, height: 560 });
  }

  /** Auto-flow: run after render, never inside it. */
  scheduleReconcile(cx) {
    const changes = reconcile(load(), agents());
    if (!changes.length || this.reconciling) return;
    this.reconciling = true;
    cx.spawn(async () => {
      this.reconciling = false;
      update((b) => {
        let any = false;
        for (const ch of changes) {
          const c = b.cards.find((x) => x.id === ch.id);
          if (!c) continue;
          const { id, ...fields } = ch;
          Object.assign(c, fields, { updated: Date.now() });
          any = true;
        }
        return any;
      });
    });
  }

  renderCard(t, c, agentByAddr) {
    const a = c.agent ? agentByAddr.get(c.agent) : null;
    const status = c.pending && !c.agent ? "pending" : c.agent ? (a ? a.status : "gone") : null;
    const overdue = c.due && c.due < today() && c.column !== "done";
    const dragging = this.drag?.moved && this.drag.kind === "card" && this.drag.id === c.id;
    const meta = [];
    if (c.due) meta.push(div().text_color(overdue ? t.blocked : t.dim).child(c.due.slice(5)));
    if (c.folder) meta.push(div().text_color(t.dim).truncate().child(basename(c.folder)));
    return v_flex().id(`card-${c.id}`).gap(6).p(10).rounded(8).border_1()
      .border_color(c.pinned ? t.accent : t.border).bg(t.background)
      .opacity(dragging ? 0.4 : c.archived ? 0.6 : 1)
      .cursor_grab().hover((s) => s.border_color(t.input))
      .on_mouse_down("left", () => { this.drag = { kind: "card", id: c.id, moved: false }; })
      .on_click((e) => { if (!this.drag?.moved) this.openCard(c.id); })
      .child(h_flex().gap(6).items_start()
        .when(c.pinned, (el) => el.child(div().text_color(t.accent).text_size(11).child("●")))
        .child(div().flex_1().text_size(12.5).text_color(t.foreground).child(c.title || "(无标题)")))
      .when(Boolean(status), (el) => el.child(h_flex().gap(6).items_center().text_size(11)
        .child(div().w(7).h(7).rounded(4).bg(status === "pending" ? t.dim : statusColor(t, status)))
        .child(div().text_color(t.muted).child(status === "pending" ? "启动中…" : `${a?.program?.name ?? "agent"} · ${STATUS_TEXT[status]}${speed(c.agent)}`))
        .when(Boolean(a), (el) => el.child(div().id(`go-${c.id}`).ml_auto().px(6).rounded(4).text_color(t.accent)
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); run("pane.focus", { pane: a.pane }); })
          .child("打开")))))
      .when(meta.length > 0, (el) => el.child(h_flex().gap(8).text_size(11).children(meta)));
  }

  renderColumn(t, col, cards, agentByAddr) {
    const target = this.drag?.moved && this.hoverCol === col.id;
    return v_flex().id(`col-${col.id}`).flex_1().min_w(180).h_full().rounded(10)
      .bg(target ? t.selected : t.canvas).border_1().border_color(target ? t.accent : t.border)
      .on_mouse_move((_e, cx) => { if (this.drag?.moved && this.hoverCol !== col.id) { this.hoverCol = col.id; cx.notify(); } })
      .on_mouse_up("left", (_e, cx) => { this.drop(col.id); cx.notify(); })
      .child(h_flex().px(12).py(10).gap(8).items_center()
        .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child(col.title))
        .child(div().text_size(11).text_color(t.dim).child(String(cards.length))))
      .when(col.id === "todo", (el) => el.child(div().px(10).pb(8).child(this.renderInput(t))))
      .child(v_flex().id(`list-${col.id}`).flex_1().min_h(0).overflow_y_scrollbar().px(10).pb(10).gap(8)
        .children(cards.map((c) => this.renderCard(t, c, agentByAddr))));
  }

  renderInput(t) {
    return Input.new(this.input).h(30).px(8).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground);
  }

  /** One line per card, for a pane beside a terminal. */
  renderRow(t, c, agentByAddr) {
    const a = c.agent ? agentByAddr.get(c.agent) : null;
    const status = c.pending && !c.agent ? "pending" : c.agent ? (a ? a.status : "gone") : null;
    const overdue = c.due && c.due < today() && c.column !== "done";
    const dragging = this.drag?.moved && this.drag.kind === "card" && this.drag.id === c.id;
    const col = COLUMNS.find((x) => x.id === c.column);
    const tag = columnColor(t, c.column);
    const sp = speed(c.agent).replace(/^ · /, "");
    return h_flex().id(`row-${c.id}`).h(34).px(10).gap(8).items_center().rounded(7).border_1()
      .border_color(c.pinned ? t.accent : t.border).bg(t.background)
      .opacity(dragging ? 0.4 : c.column === "done" || c.archived ? 0.6 : 1)
      .cursor_grab().hover((s) => s.border_color(t.input))
      .on_mouse_down("left", () => { this.drag = { kind: "card", id: c.id, moved: false }; })
      .on_click(() => { if (!this.drag?.moved) this.openCard(c.id); })
      .child(div().w(7).h(7).rounded(4).flex_none()
        .bg(status === "pending" ? t.dim : status ? statusColor(t, status) : t.border))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground)
        .child(`${c.pinned ? "★ " : ""}${c.title || "(无标题)"}`))
      .when(Boolean(sp), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(sp)))
      .when(Boolean(c.due), (el) => el.child(div().flex_none().text_size(11).text_color(overdue ? t.blocked : t.dim).child(c.due.slice(5))))
      .child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).text_size(10.5)
        .border_1().border_color(tag).text_color(tag).child(col?.title ?? c.column))
      .when(Boolean(a), (el) => el.child(div().id(`go-${c.id}`).flex_none().px(4).rounded(4).text_size(11).text_color(t.accent)
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); run("pane.focus", { pane: a.pane }); })
        .child("打开")));
  }

  /** Narrow: filter chips (also drop targets) over one list of rows. */
  renderRows(t, visible, agentByAddr) {
    const count = (id) => visible.filter((c) => c.column === id).length;
    const shown = this.filter === "open"
      ? visible.filter((c) => c.column !== "done")
      : visible.filter((c) => c.column === this.filter);
    // Unfinished: what needs you first, then what runs, then what waits.
    const rows = this.filter === "open"
      ? ["review", "doing", "todo"].flatMap((id) => sortCards(shown.filter((c) => c.column === id)))
      : sortCards(shown);
    const chip = (id, title, n) => {
      const target = this.drag?.moved && this.hoverCol === id && id !== "open";
      const on = this.filter === id;
      return div().id(`f-${id}`).px(8).h(24).flex().items_center().gap(4).rounded(6).text_size(11.5).cursor_pointer()
        .border_1().border_color(target ? t.accent : on ? t.selected : t.canvas)
        .bg(target ? t.selected : on ? t.selected : t.canvas).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_mouse_move((_e, cx) => { if (this.drag?.moved && id !== "open" && this.hoverCol !== id) { this.hoverCol = id; cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => { if (this.drag?.moved && id !== "open") { this.drop(id); cx.notify(); } })
        .on_click((_e, cx) => { if (!this.drag?.moved) { this.filter = id; cx.notify(); } })
        .child(title).child(div().text_color(t.dim).child(String(n)));
    };
    return v_flex().flex_1().min_h(0)
      .child(h_flex().px(10).pb(8).gap(4).flex_wrap()
        .child(chip("open", "未完成", visible.filter((c) => c.column !== "done").length))
        .children(COLUMNS.map((col) => chip(col.id, col.title, count(col.id)))))
      .child(div().px(10).pb(8).child(this.renderInput(t)))
      .child(v_flex().id("rows").flex_1().min_h(0).overflow_y_scrollbar().px(10).pb(10).gap(6)
        .when(rows.length === 0, (el) => el.child(div().p(10).text_size(12).text_color(t.dim).child("没有卡片。")))
        .children(rows.map((c) => this.renderRow(t, c, agentByAddr))));
  }

  renderAgentStrip(t, board) {
    const linked = new Set(board.cards.filter((c) => !c.archived).map((c) => c.agent).filter(Boolean));
    const free = agents().filter((a) => !linked.has(a.address));
    if (!free.length) return null;
    return h_flex().id("agent-strip").gap(6).px(14).pb(10).items_center().flex_wrap()
      .child(div().text_size(11).text_color(t.dim).mr(4).child("拖到列上："))
      .children(free.map((a) => h_flex().id(`agent-${a.address}`).gap(6).items_center().px(8).h(24).rounded(12)
        .border_1().border_color(t.border).bg(t.raised).cursor_grab().text_size(11.5)
        .opacity(this.drag?.moved && this.drag.address === a.address ? 0.4 : 1)
        .on_mouse_down("left", () => { this.drag = { kind: "agent", address: a.address, moved: false }; })
        .child(div().w(7).h(7).rounded(4).bg(statusColor(t, a.status)))
        .child(div().text_color(t.foreground).max_w(220).truncate().child(agentLabel(a)))));
  }

  renderBoard(cx) {
    const t = theme();
    const board = load();
    // render reruns whenever agents or the board change: that is when auto-flow looks.
    this.scheduleReconcile(cx);
    const agentByAddr = new Map(agents().map((a) => [a.address, a]));
    const visible = board.cards.filter((c) => c.archived === this.showArchived);
    const toggle = (id, label, on, action) => div().id(id).px(8).h(24).flex().items_center().rounded(6).text_size(11.5)
      .text_color(on ? t.foreground : t.muted).bg(on ? t.selected : t.canvas).hover((s) => s.bg(t.hover))
      .cursor_pointer().on_click(action).child(label);
    const review = board.cards.filter((c) => !c.archived && c.column === "review").length;
    const narrow = this.view ? this.view === "rows" : this.width != null && this.width < NARROW;

    return v_flex().id("board").size_full()
      .on_size_change((size, cx) => {
        if ((this.width != null && this.width < NARROW) !== (size.width < NARROW) || this.width == null) { this.width = size.width; cx.notify(); }
        else this.width = size.width;
      }).bg(t.surface).text_color(t.foreground)
      .on_window_mouse_move((e, cx) => {
        if (!this.drag) return;
        if (e.pressed_button !== "left") { this.drag = null; this.hoverCol = null; cx.notify(); return; }
        if (!this.drag.moved) { this.drag.moved = true; cx.notify(); }
      })
      .on_window_mouse_up("left", (_e, cx) => {
        // Columns handle the drop first; this only ends a drag released elsewhere.
        cx.timer.after(30, (cx) => { if (this.drag) { this.drag = null; this.hoverCol = null; cx.notify(); } });
      })
      .child(h_flex().px(14).py(10).gap(8).items_center()
        .child(div().text_size(14).font_semibold().child("看板"))
        .when(review > 0, (el) => el.child(div().px(6).rounded(8).bg(t.blocked).text_color(t.background).text_size(11).child(`${review} 待确认`)))
        .child(div().flex_1())
        .child(toggle("auto", narrow ? "自动移动" : "随 agent 自动移动", board.autoFlow, () => update((b) => { b.autoFlow = !b.autoFlow; })))
        .child(toggle("view", narrow ? "列" : "行", false, (_e, cx) => { this.view = narrow ? "columns" : "rows"; cx.notify(); }))
        .child(toggle("archived", "已归档", this.showArchived, (_e, cx) => { this.showArchived = !this.showArchived; cx.notify(); })))
      .child(this.renderAgentStrip(t, board) ?? div())
      .child(narrow
        ? this.renderRows(t, visible, agentByAddr)
        : h_flex().flex_1().min_h(0).gap(10).px(14).pb(14).children(COLUMNS.map((col) => this.renderColumn(t, col,
          sortCards(visible.filter((c) => c.column === col.id)), agentByAddr))));
  }

  // ---------- card detail (dialog) ----------

  initDetail(cx) {
    const c = load().cards.find((x) => x.id === props().card);
    this.cardId = props().card;
    this.title = InputState.new({ value: c?.title ?? "", placeholder: "标题" });
    this.notes = TextareaState.new({ value: c?.notes ?? "", placeholder: "细节（Markdown），交给 AI 时会一起发过去", rows: 10 });
    this.due = InputState.new({ value: c?.due ?? "", placeholder: "YYYY-MM-DD" });
    this.handle = cx.focus_handle();
  }

  saveDetail() {
    const due = this.due.value().trim();
    patchCard(this.cardId, {
      title: this.title.value().trim(),
      notes: this.notes.value(),
      due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    });
  }

  close() {
    if (this.detail) {
      for (const s of [this.title, this.notes, this.due]) s?.release();
    } else {
      this.input?.release();
    }
  }

  renderDetail() {
    const t = theme();
    const p = props();
    const c = load().cards.find((x) => x.id === this.cardId);
    const done = () => closeOverlay(p.overlay);
    if (!c) return v_flex().size_full().p(18).bg(t.popover).child("这张卡片已被删除。");

    const label = (text) => div().pt(12).pb(6).text_size(11.5).text_color(t.dim).child(text);
    const field = (el) => el.px(10).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground);
    const button = (id, text, kind, action) => h_flex().id(id).h(30).px(12).items_center().rounded(7).border_1()
      .border_color(kind === "primary" ? t.solid : kind === "danger" ? t.blocked : t.input)
      .bg(kind === "primary" ? t.solid : t.raised)
      .text_color(kind === "primary" ? t.solid_foreground : kind === "danger" ? t.blocked : t.foreground)
      .text_size(12).cursor_pointer().hover((s) => s.opacity(0.85)).on_click(action).child(text);
    const chip = (col) => div().id(`mv-${col.id}`).px(10).h(26).flex().items_center().rounded(6).text_size(12)
      .bg(c.column === col.id ? t.selected : t.raised).text_color(c.column === col.id ? t.foreground : t.muted)
      .cursor_pointer().on_click(() => patchCard(c.id, { column: col.id })).child(col.title);

    return v_flex().id("card-detail").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.saveDetail(); done(); cx.stop_propagation(); } })
      .size_full().p(18).bg(t.popover).text_color(t.foreground).overflow_y_scrollbar()
      .child(field(Input.new(this.title)).h(36).text_size(14))
      .child(label("列"))
      .child(h_flex().gap(6).children(COLUMNS.map(chip)))
      .child(label("细节"))
      .child(field(Textarea.new(this.notes)).py(8))
      .child(h_flex().gap(16).items_end()
        .child(v_flex().w(150).child(label("截止日期")).child(field(Input.new(this.due)).h(30)))
        .child(v_flex().flex_1().min_w(0).child(label("工作目录"))
          .child(h_flex().gap(6).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(c.folder ? t.foreground : t.dim).child(c.folder ?? "未设置（用当前空间的目录）"))
            .child(button("pick", "选择…", "", () => {
              pickFolder({ prompt: "设为工作目录" }).then((f) => { if (f) patchCard(c.id, { folder: f }); });
            })))))
      .child(h_flex().pt(20).gap(8).items_center()
        .child(button("ai", c.agent ? "再交给 AI" : "交给 AI", "", () => { this.saveDetail(); handToAgent(load().cards.find((x) => x.id === c.id) ?? c); done(); }))
        .child(button("pin", c.pinned ? "取消置顶" : "置顶", "", () => patchCard(c.id, { pinned: !c.pinned })))
        .child(button("arch", c.archived ? "恢复" : "归档", "", () => { this.saveDetail(); patchCard(c.id, { archived: !c.archived }); done(); }))
        .when(Boolean(c.agent), (el) => el.child(button("unlink", "解除关联", "", () => patchCard(c.id, { agent: null, agentStatus: null, pending: null }))))
        .child(button("del", "删除", "danger", () => { update((b) => { b.cards = b.cards.filter((x) => x.id !== c.id); }); done(); }))
        .child(div().flex_1())
        .child(button("save", "保存", "primary", () => { this.saveDetail(); done(); })));
  }

  render(cx) {
    return this.detail ? this.renderDetail(cx) : this.renderBoard(cx);
  }
}
