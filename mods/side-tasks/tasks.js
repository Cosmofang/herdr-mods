// Side tasks: suggestions agents drop into an inbox folder with `herdr-suggest-task`.
// Pure helpers here; the view does the file reading.
import { shared, setShared, appHome } from "herdr";

const KEY = "herdr-side-tasks.v1";
const KEEP = 300; // newest first; settled ones beyond this are dropped

export const inboxDir = () => `${appHome()}/data/herdr-side-tasks/inbox`;

export function load() {
  const s = shared(KEY);
  return s && Array.isArray(s.tasks) ? s : { tasks: [] };
}

/** Applies fn to a copy and publishes it; fn may return false to skip. */
export function update(fn) {
  const next = JSON.parse(JSON.stringify(load()));
  if (fn(next) === false) return;
  setShared(KEY, next);
}

/** A parsed inbox file as a task, or null if it isn't one. */
export function fromInbox(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title ?? "").trim().slice(0, 200);
  const prompt = String(raw.prompt ?? "").trim();
  if (!title || !prompt || !raw.id) return null;
  return {
    id: String(raw.id),
    title,
    prompt,
    reason: raw.reason ? String(raw.reason).trim() : null,
    cwd: raw.cwd ? String(raw.cwd) : null,
    from: raw.from ? String(raw.from) : null, // terminal address of the agent that suggested it
    created: Number(raw.created) || Date.now(),
    status: "pending", // pending | started | carded | returned | dismissed
    updated: Date.now(),
  };
}

/**
 * Merges new tasks into state. A pending task with the same title from the same agent
 * is the same suggestion (T3's rule), so repeats are dropped. Returns the ones added.
 */
export function merge(state, incoming) {
  const ids = new Set(state.tasks.map((t) => t.id));
  const pendingKey = new Set(state.tasks.filter((t) => t.status === "pending").map((t) => `${t.from}|${t.title}`));
  const added = [];
  for (const t of incoming) {
    if (!t || ids.has(t.id) || pendingKey.has(`${t.from}|${t.title}`)) continue;
    ids.add(t.id);
    pendingKey.add(`${t.from}|${t.title}`);
    added.push(t);
  }
  state.tasks = [...added, ...state.tasks].sort((a, b) => b.created - a.created);
  if (state.tasks.length > KEEP) {
    const pending = state.tasks.filter((t) => t.status === "pending");
    const settled = state.tasks.filter((t) => t.status !== "pending").slice(0, Math.max(0, KEEP - pending.length));
    state.tasks = [...pending, ...settled].sort((a, b) => b.created - a.created);
  }
  return added;
}

/**
 * Puts a card on the board mod's board. Mods can't import each other's files, so this
 * writes the board's shared value directly; keep it in step with mods/board/store.js.
 */
export function addBoardCard(fields) {
  const BOARD = "herdr-board.v1";
  const cur = shared(BOARD);
  const board = cur && Array.isArray(cur.cards) ? JSON.parse(JSON.stringify(cur)) : { cards: [], autoFlow: true, rev: 0 };
  const now = Date.now();
  board.cards.push({
    id: `c${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: "", notes: "", column: "todo", due: null, pinned: false, archived: false,
    folder: null, agent: null, agentStatus: null, pending: null, created: now, updated: now,
    ...fields,
  });
  board.rev = (board.rev ?? 0) + 1;
  setShared(BOARD, board);
}

export function setStatus(id, status, extra = {}) {
  update((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return false;
    Object.assign(t, extra, { status, updated: Date.now() });
  });
}
