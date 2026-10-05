import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn, preTurnFacts } from "../src/model/turn.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const run = (s, body, dice = { a: 10, b: 1, c: 5 }, fudges = null) => postTurn(s, body ? ch(body) : null, { ...C, dice: { fate: dice }, fudges });
const deferred = (id, more = {}) => ({ id, desc: id, times: 1, age: 0, ...more });
const world = (id, more = {}) => ({ id, desc: id, prox: "REGIONAL", reach: 2, age: 0, ...more });

test("the outcome used after the reply equals the one announced before it", () => {
    const s = emptyState();
    s.fate.q = 7;
    const facts = preTurnFacts(s, { ...C, dice: { fate: { a: 17, b: 1, c: 5 } } }).join("\n");
    assert.match(facts, /MAJOR \+ TRUE/);
    const out = run(s, null, { a: 17, b: 1, c: 5 });
    assert.equal(out.state.fate.lastTurn.tier, "MAJOR");
    assert.deepEqual(out.state.fate.lastTurn.dice, { a: 17, b: 1, c: 5 });
});

test("Fate facts say when MAJOR + WEIGHTED fell back to TRUE", () => {
    const s = emptyState();
    s.fate.q = 7;
    s.chekhov.bullets = [{ id: "B1", desc: "an unripe promise", weight: 1, age: 2, hot: true, secret: false, lock: "", at: null, after: "" }];
    const facts = preTurnFacts(s, { ...C, dice: { fate: { a: 18, b: 20, c: 14 } } }).join("\n");
    assert.match(facts, /MAJOR \+ TRUE/);
    assert.match(facts, /no eligible hot bullet.*fell back to TRUE/i);
});

test("Fate facts state whether the danger ceiling lifts on this roll", () => {
    const s = emptyState();
    s.fate.q = 7;
    const lifted = preTurnFacts(s, { ...C, dice: { fate: { a: 17, b: 1, c: 20 } } }).join("\n");
    const held = preTurnFacts(s, { ...C, dice: { fate: { a: 17, b: 1, c: 19 } } }).join("\n");
    assert.match(lifted, /Danger ceiling lifts this turn/);
    assert.match(held, /Danger ceiling stays in place/);
});
test("q, sinceMajor and ts move after the turn", () => {
    const ambient = run(emptyState(), null, { a: 1, b: 1, c: 5 }).state.fate;
    assert.equal(ambient.q, 1);
    assert.equal(ambient.sinceMajor, 100);
    const minor = run(emptyState(), null, { a: 16, b: 1, c: 5 }).state.fate;
    assert.equal(minor.q, 0);
    assert.equal(minor.sinceMajor, 100);
    const majorState = emptyState();
    majorState.fate.q = 7;
    assert.equal(run(majorState, null, { a: 17, b: 1, c: 5 }).state.fate.sinceMajor, 0);
    const thread = emptyState();
    Object.assign(thread.fate, { state: "THREAD", pursuit: "find the bell", ts: 3 });
    assert.equal(run(thread, null, { a: 1, b: 1, c: 5 }).state.fate.ts, 4);
});

test("a new world entry takes its Reach from the table, never from the model", () => {
    const { state } = run(emptyState(), "World:\n- + REGIONAL: the harbour tax is raised (Reach 3)", { a: 1, b: 1, c: 5 });
    assert.deepEqual(state.fate.world.map(w => [w.id, w.prox, w.reach, w.age]), [["W1", "REGIONAL", 2, 0]]);
});

test("escalate moves one band toward LOCAL and +1 Reach", () => {
    const s = emptyState();
    s.fate.world = [world("W1", { prox: "ELSEWHERE", reach: 1 }), world("W2", { prox: "LOCAL", reach: 3 })];
    const { state } = run(s, "World:\n- escalate W1\n- escalate W2");
    assert.deepEqual(state.fate.world.map(w => [w.prox, w.reach]), [["REGIONAL", 2], ["LOCAL", 3]]);
});

test("world entries age; Reach 1 drops at 15; at most 5 kept", () => {
    const s = emptyState();
    s.fate.world = [
        world("W1", { prox: "ELSEWHERE", reach: 1, age: 14 }),
        world("W2", { reach: 2, age: 1 }),
        world("W3", { reach: 2, age: 6 }),
        world("W4", { prox: "LOCAL", reach: 3, age: 1 }),
        world("W5", { reach: 2, age: 5 }),
        world("W6", { prox: "LOCAL", reach: 3, age: 6 }),
        world("W7", { reach: 2, age: 2 }),
    ];
    const { state } = run(s, null, { a: 1, b: 1, c: 5 });
    assert.equal(state.fate.world.length, 5);
    assert.deepEqual(state.fate.world.map(w => w.id), ["W2", "W4", "W5", "W6", "W7"]);
    assert.equal(state.fate.world.find(w => w.id === "W6").age, 7);
});

test("a deferred item deferred twice cannot be deferred again and must land", () => {
    let s = run(emptyState(), "Fate:\n- defer: the storm at the pass").state;
    assert.deepEqual(s.fate.deferred.map(d => [d.id, d.times]), [["D1", 1]]);
    s = run(s, "Fate:\n- defer D1").state;
    assert.deepEqual(s.fate.deferred.map(d => [d.id, d.times]), [["D1", 2]]);
    const facts = preTurnFacts(s, { ...C, dice: { fate: { a: 1, b: 1, c: 5 } } }).join("\n");
    assert.match(facts, /D1.*must land as a MAJOR/);
});

test("an expired deferred item owes a residue line until one is written", () => {
    const s = emptyState();
    s.fate.deferred = [deferred("D1", { desc: "the storm", age: 5 })];
    const expired = run(s, null).state;
    assert.deepEqual(expired.fate.deferred, []);
    assert.match(preTurnFacts(expired, { ...C, dice: { fate: { a: 1, b: 1, c: 5 } } }).join("\n"), /Owed.*D1.*storm/);
    const paid = run(expired, "Fate:\n- residue: the pass flooded before dawn").state.fate;
    assert.deepEqual(paid.owed, []);
    assert.equal(paid.residue.at(-1), "the pass flooded before dawn");
});

test("ambition progress, and 5/5 becomes a LOCAL Reach 3 world entry", () => {
    let s = run(emptyState(), "Fate:\n- ambition: open the café").state;
    assert.deepEqual(s.fate.ambitions, [{ desc: "open the café", progress: 0 }]);
    for (let n = 0; n < 5; n++) s = run(s, "Fate:\n- ambition +1 OPEN THE").state;
    assert.deepEqual(s.fate.ambitions, []);
    assert.ok(s.fate.owed.some(text => /ambition.*open the café/i.test(text)));
    assert.ok(s.fate.world.some(w => w.prox === "LOCAL" && w.reach === 3 && w.age === 0));
});

test("pursuit, close and park", () => {
    const opened = run(emptyState(), "Fate:\n- pursuit: find the missing key").state.fate;
    assert.equal(opened.state, "THREAD");
    assert.equal(opened.pursuit, "find the missing key");
    assert.equal(opened.ts, 0);
    const closed = run({ ...emptyState(), fate: opened }, "Fate:\n- close: Mara found it in the drawer").state.fate;
    assert.equal(closed.state, "ROUTINE");
    assert.equal(closed.pursuit, "");
    assert.equal(closed.residue.at(-1), "Mara found it in the drawer");
    const parked = run({ ...emptyState(), fate: opened }, "Fate:\n- park: the search can wait").state.fate;
    assert.equal(parked.state, "ROUTINE");
    assert.equal(parked.residue.at(-1), "the search can wait");
    const overdue = emptyState();
    Object.assign(overdue.fate, { state: "THREAD", pursuit: "find the key", ts: 8 });
    assert.match(preTurnFacts(overdue, { ...C, dice: { fate: { a: 1, b: 1, c: 5 } } }).join("\n"), /must close or park/);
});

test("fate round-trips through the block", () => {
    const s = emptyState();
    Object.assign(s.fate, {
        state: "THREAD", pursuit: "find Mara's | lost key <soon>", ts: 4, q: 3, sinceMajor: 2,
        deferred: [deferred("D9", { desc: "a | b <c> & d", times: 2, age: 3 })],
        world: [world("W8", { desc: "winter | lamps <dim>", prox: "LOCAL", reach: 3, age: 11 })],
        ambitions: [{ desc: "open <the café> | soon", progress: 4 }],
        residue: ["first | line & then"], owed: ["spent W8: write its residue"],
        lastTurn: { dice: { a: 17, b: 14, c: 5 }, tier: "MINOR", source: "WEIGHTED", news: false, fire: null, warm: "B1", collision: "DEFER", fudged: ["tier"] },
    });
    const text = renderBlock(s, { rules: [], config: C, sections: {} });
    const back = parseBlock(text, { config: C }).state;
    assert.deepEqual(back.fate, s.fate);
});

test("without dice (no generation behind the reply) Fate does nothing", () => {
    const out = postTurn(emptyState(), null, C);
    assert.equal(out.state.fate.q, 0);
    assert.equal(out.state.fate.lastTurn, null);
});

