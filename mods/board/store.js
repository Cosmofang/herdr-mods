// Board data: one shared value every copy of the mod sees and re-renders on,
// mirrored to a JSON file so it survives a reset and can be backed up.
import { shared, setShared, appHome, checking } from "herdr";
import * as fs from "fs/promises";

const KEY = "herdr-board.v1";

export const COLUMNS = [
  { id: "todo", title: "待办" },
  { id: "doing", title: "进行中" },
  { id: "review", title: "待确认" },
  { id: "done", title: "完成" },
];

export function dataDir() {
  return `${appHome()}/data/herdr-board`;
}

export function dataFile() {
  return `${dataDir()}/board.json`;
}

const empty = () => ({ cards: [], autoFlow: true, rev: 0 });

export function load() {
  const s = shared(KEY);
  return s && Array.isArray(s.cards) ? s : empty();
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Applies fn to a copy of the board and publishes it. fn may return false to skip. */
export function update(fn) {
  const next = clone(load());
  if (fn(next) === false) return;
  next.rev = (next.rev ?? 0) + 1;
  setShared(KEY, next);
}

/** On first start (or after a reset) take the board back from the file. */
export async function restoreFromFile() {
  if (checking()) return;
  if (load().rev > 0) return;
  try {
    if (!(await fs.exists(dataFile()))) return;
    const s = JSON.parse(await fs.readFile(dataFile(), "utf8"));
    if (Array.isArray(s?.cards) && s.cards.length) setShared(KEY, { ...empty(), ...s });
  } catch (e) {
    console.log(`board: could not read ${dataFile()}: ${e}`);
  }
}

let written = -1;
export async function mirrorToFile() {
  if (checking()) return;
  const s = load();
  if (s.rev === written) return;
  written = s.rev;
  try {
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(dataFile(), JSON.stringify(s, null, 2));
  } catch (e) {
    console.log(`board: could not write ${dataFile()}: ${e}`);
  }
}

export function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newCard(fields) {
  const now = Date.now();
  return {
    id: newId(),
    title: "",
    notes: "",
    column: "todo",
    due: null, // "YYYY-MM-DD"
    pinned: false,
    archived: false,
    folder: null,
    agent: null, // terminal address of the linked agent
    agentStatus: null, // last status auto-flow acted on
    pending: null, // { since, known: [...] } while waiting for a handed-off agent to appear
    created: now,
    updated: now,
    ...fields,
  };
}

/** Where auto-flow sends a card when its agent reaches this status, or null. */
export function columnFor(status) {
  if (status === "working") return "doing";
  if (status === "blocked" || status === "done") return "review";
  return null;
}

/**
 * Links handed-off agents and moves cards whose agent changed status.
 * Pure: returns a list of changes, applied by the caller outside render.
 */
export function reconcile(board, agents) {
  const byAddr = new Map(agents.map((a) => [a.address, a]));
  const linked = new Set(board.cards.map((c) => c.agent).filter(Boolean));
  const changes = [];
  for (const c of board.cards) {
    if (c.archived) continue;
    if (!c.agent && c.pending) {
      const known = new Set(c.pending.known);
      const fresh = agents.filter((a) => !known.has(a.address) && !linked.has(a.address));
      const hit = fresh.find((a) => a.tab_name === c.title) ?? fresh[0];
      if (hit) {
        linked.add(hit.address);
        changes.push({ id: c.id, agent: hit.address, pending: null });
      } else if (Date.now() - c.pending.since > 120000) {
        changes.push({ id: c.id, pending: null });
      }
      continue;
    }
    if (!c.agent) continue;
    const a = byAddr.get(c.agent);
    const status = a ? a.status : "gone";
    if (status === c.agentStatus) continue;
    const change = { id: c.id, agentStatus: status };
    const col = board.autoFlow ? columnFor(status) : null;
    if (col && col !== c.column) change.column = col;
    changes.push(change);
  }
  return changes;
}

export function sortCards(cards) {
  return [...cards].sort((a, b) =>
    (b.pinned - a.pinned) ||
    ((a.due ?? "9999") < (b.due ?? "9999") ? -1 : (a.due ?? "9999") > (b.due ?? "9999") ? 1 : 0) ||
    (b.updated - a.updated));
}

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function basename(path) {
  if (!path) return "";
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}
