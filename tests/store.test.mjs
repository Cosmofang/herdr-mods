import assert from "node:assert";
import { reconcile, newCard, update, load } from "./.build/store.mjs";
const A = (address, status, extra = {}) => ({ address, status, tab_name: "x", ...extra });
// linked card follows status
let b = { autoFlow: true, cards: [newCard({ id: "1", agent: "t1", agentStatus: "idle" })] };
assert.deepEqual(reconcile(b, [A("t1", "working")]), [{ id: "1", agentStatus: "working", column: "doing" }]);
// blocked -> review; same status -> no change (manual drag wins)
b.cards[0].agentStatus = "working"; b.cards[0].column = "todo";
assert.deepEqual(reconcile(b, [A("t1", "working")]), []);
assert.deepEqual(reconcile(b, [A("t1", "blocked")]), [{ id: "1", agentStatus: "blocked", column: "review" }]);
// agent gone
assert.deepEqual(reconcile(b, []), [{ id: "1", agentStatus: "gone" }]);
// autoFlow off: record status, don't move
b.autoFlow = false;
assert.deepEqual(reconcile(b, [A("t1", "done")]), [{ id: "1", agentStatus: "done" }]);
// pending hand-off links the new agent, preferring the tab named after the card
b = { autoFlow: true, cards: [newCard({ id: "2", title: "修 bug", pending: { since: Date.now(), known: ["t1"] } })] };
assert.deepEqual(reconcile(b, [A("t1", "idle"), A("t5", "working"), A("t6", "working", { tab_name: "修 bug" })]), [{ id: "2", agent: "t6", pending: null }]);
// update bumps rev
update((s) => { s.cards.push(newCard({ title: "a" })); }); update((s) => false);
assert.equal(load().rev, 1); assert.equal(load().cards.length, 1);
console.log("ok");
