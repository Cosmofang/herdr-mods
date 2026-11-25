import assert from "node:assert/strict";
import { fromInbox, merge } from "./.build/tasks.mjs";

assert.equal(fromInbox(null), null);
assert.equal(fromInbox({ id: "a", title: "x" }), null, "prompt required");
assert.equal(fromInbox({ id: "a", title: "  ", prompt: "p" }), null, "blank title");

const t = (id, title, from = "t1", created = 1) => fromInbox({ id, title, prompt: "do it", from, created });
const a = t("a", "Fix test");
assert.equal(a.status, "pending");
assert.equal(a.reason, null);

const s = { tasks: [] };
assert.deepEqual(merge(s, [a, t("b", "Clean up", "t1", 2)]).map((x) => x.id), ["a", "b"]);
assert.deepEqual(s.tasks.map((x) => x.id), ["b", "a"], "newest first");

// The same id again, or the same pending title from the same agent, is not new.
assert.equal(merge(s, [t("a", "Fix test"), t("c", "Fix test", "t1", 3)]).length, 0);
// The same title from another agent is.
assert.equal(merge(s, [t("d", "Fix test", "t2", 4)]).length, 1);
// Once settled, the title can come back.
s.tasks.find((x) => x.id === "a").status = "dismissed";
assert.equal(merge(s, [t("e", "Fix test", "t1", 5)]).length, 1);

console.log("tasks: ok");
