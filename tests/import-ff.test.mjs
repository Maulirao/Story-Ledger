// Importing a Freaky/Realistic Frankenstein <internal_states> block. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { renderBlock } from "../src/model/block.js";
import { initialState } from "../src/model/turn.js";
import { importForeign } from "../src/model/import/index.js";
import { FF_FULL, FF_PARTIAL } from "./fixtures/foreign.mjs";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ai = mes => ({ is_user: false, is_system: false, mes });
const user = mes => ({ is_user: true, is_system: false, mes });

test("an FF block imports every section it carries", () => {
    const r = importForeign([ai(FF_FULL), user("go")], C);
    assert.equal(r.source, "ff");
    assert.equal(r.state.ct, 309);
    assert.deepEqual(r.state.agendas.Ana, { task: "close the café", step: 1, max: 2, aware: "Mara took the key", fibs: "", circle: "", body: "tired" });
    assert.equal(r.state.locations.Ana, "the café, wiping tables");
    assert.equal(r.state.factions["Harbour Guild"].goal, "control the docks");
    assert.deepEqual(r.state.quests.map(q => [q.id, q.kind, q.status, q.objective]), [["Q1", "Main", "active", "find the spare key"], ["Q2", "Side", "done", "fix the gate"]]);
    assert.deepEqual(r.state.inv.items, ["umbrella", "spare key"]);
    assert.deepEqual(r.state.inv.titles, ["Charmer"]);
    assert.deepEqual(r.state.chekhov.bullets.map(b => [b.id, b.weight, b.age, b.hot, Boolean(b.at)]), [["B1", 2, 7, true, false], ["B2", 1, 0, false, true]]);
    assert.equal(r.state.chekhov.fired.length, 1);
    assert.deepEqual(r.rules, ["Ana does not know about the key."]);
    assert.deepEqual(r.state.threads, ["Race after breakfast."]);
    assert.equal(r.state.fate.state, "THREAD");
    assert.equal(r.state.fate.pursuit, "find who took the key");
    assert.equal(r.state.fate.q, 3);
    assert.deepEqual(r.state.fate.world.map(w => [w.id, w.prox, w.reach, w.age]), [["W1", "REGIONAL", 2, 3]]);
    assert.deepEqual(r.state.fate.deferred.map(d => [d.id, d.times, d.age]), [["D1", 1, 2]]);
    assert.deepEqual(r.state.fate.ambitions, [{ desc: "open the café", progress: 1 }]);
    assert.match(r.state.scene.now, /Day 3/);
    for (const k of ["agendas", "locations", "factions", "quests", "inv", "chekhov", "fate", "threads", "scene"]) assert.ok(r.imported.includes(k), k);
    assert.deepEqual(r.state.rel.pairs, {}, "bonds never become relationships by code");
    assert.ok(Object.keys(r.state.rel.awaiting).length, "BONDS are carried as relationships awaiting NEW");
});

test("a partial FF block imports what it can and reports the rest", () => {
    const r = importForeign([ai(FF_PARTIAL)], C);
    assert.equal(r.source, "ff");
    assert.ok(r.imported.includes("agendas"));
    assert.ok(!r.imported.includes("quests"));
    assert.ok(r.unread.some(u => /QUESTS/.test(u)));
});

test("import only runs before the first Story Ledger block", () => {
    const ours = ai("p\n" + renderBlock(emptyState(), { rules: [], config: C, sections: {} }));
    assert.equal(importForeign([ours, user("x"), ai(FF_FULL)], C).source, null);
    assert.equal(importForeign([ai(FF_FULL), user("x"), ours], C).source, null, "a chat with a block never imports");
    assert.equal(importForeign([user("hi")], C).source, null);
});

test("initialState starts from the import", () => {
    const s = initialState([ai(FF_FULL), user("go")], C);
    assert.equal(s.ct, 309);
    assert.equal(s.agendas.Ana.step, 1);
    assert.equal(s.chekhov.bullets.length, 2);
    assert.deepEqual(s.threads, ["Race after breakfast."]);
});
