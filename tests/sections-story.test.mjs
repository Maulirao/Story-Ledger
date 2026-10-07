// 🏳️ FACTIONS and 📜 QUESTS. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn } from "../src/model/turn.js";
import { renderStatePrompt } from "../src/model/prompt.js";
import { emptyNotebook } from "../src/model/notebook.js";
import { setSend } from "../src/model/sections/quests.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const roundTrip = s => parseBlock(renderBlock(s, { rules: [], config: C, sections: {} }), { config: C }).state;
const faction = (more = {}) => ({ goal: "", intel: "", fibs: "", state: "", conflict: "", relations: "", ...more });

test("factions: field lines create and update; drop removes", () => {
    let r = postTurn(emptyState(), ch("Factions:\n- Harbour Guild: goal: control the docks"), C);
    r = postTurn(r.state, ch("Factions:\n- harbour guild: state: low morale"), C);
    assert.deepEqual(r.state.factions, { "Harbour Guild": faction({ goal: "control the docks", state: "low morale" }) });
    r = postTurn(r.state, ch("Factions:\n- drop: Harbour Guild"), C);
    assert.deepEqual(r.state.factions, {});
});

test("factions round-trip", () => {
    const s = emptyState();
    s.factions = { "Harbour Guild": faction({ goal: "docks | all of them", intel: "a", fibs: "b", state: "c", conflict: "d", relations: "e" }) };
    assert.deepEqual(roundTrip(s).factions, s.factions);
});

test("quests: + creates with the next id; progress and done apply", () => {
    const { state } = postTurn(emptyState(), ch("Quests:\n- + Side: find the spare key (a copy of it)"), C);
    assert.deepEqual(state.quests, [{ id: "Q1", kind: "Side", status: "active", objective: "find the spare key", progress: "", reward: "a copy of it", send: false }]);
    const r = postTurn(state, ch("Quests:\n- Q1 progress: checked the shed"), C);
    assert.equal(r.state.quests[0].progress, "checked the shed");
});

test("a done quest stays and its id is never reused", () => {
    let s = postTurn(emptyState(), ch("Quests:\n- + Main: a"), C).state;
    s = postTurn(s, ch("Quests:\n- done Q1"), C).state;
    s = postTurn(s, ch("Quests:\n- + Side: b"), C).state;
    assert.deepEqual(s.quests.map(q => [q.id, q.status]), [["Q1", "done"], ["Q2", "active"]]);
    assert.deepEqual(roundTrip(s).quests, s.quests);
    assert.equal(roundTrip(s).ids.Q, 2);
});

test("drop and reopen", () => {
    let s = postTurn(emptyState(), ch("Quests:\n- + Main: a\n- drop Q1"), C).state;
    assert.equal(s.quests[0].status, "dropped");
    s = postTurn(s, ch("Quests:\n- reopen Q1"), C).state;
    assert.equal(s.quests[0].status, "active");
});

test("a line naming an unknown quest id is unparsed", () => {
    const { unparsed } = postTurn(emptyState(), ch("Quests:\n- done Q9"), C);
    assert.deepEqual(unparsed, [{ section: "Quests", line: "done Q9" }]);
});

test("only finished quests marked send reach the prompt; all of them stay in the block", () => {
    const q = (id, status, send = false) => ({ id, kind: "Side", status, objective: id.toLowerCase(), progress: "", reward: "", send });
    const s = emptyState();
    s.quests = [q("Q1", "done"), q("Q2", "active"), q("Q3", "dropped", true)];
    const out = renderStatePrompt(s, { notebook: emptyNotebook(), config: C, sections: {} });
    assert.match(out, /Q2 Side — q2/);
    assert.match(out, /Finished: Q3 q3 \(dropped\)/);
    assert.doesNotMatch(out, /Q1 q1/);
    const txt = renderBlock(s, { rules: [], config: C, sections: {} });
    assert.match(txt, /<b>Q1 Side<\/b> \| done \|/);
    assert.match(txt, /<b>Q3 Side<\/b> \| dropped · sent \|/);
    assert.deepEqual(parseBlock(txt, { config: C }).state.quests, s.quests);
});

test("setSend flips one finished quest or all of them; active quests are untouched", () => {
    const s = emptyState();
    s.quests = [{ id: "Q1", kind: "Main", status: "done", objective: "a", progress: "", reward: "", send: false },
                { id: "Q2", kind: "Side", status: "active", objective: "b", progress: "", reward: "", send: false },
                { id: "Q3", kind: "Side", status: "dropped", objective: "c", progress: "", reward: "", send: false }];
    setSend(s, ["Q1"], true);
    assert.deepEqual(s.quests.map(x => x.send), [true, false, false]);
    setSend(s, "all", true);
    assert.deepEqual(s.quests.map(x => x.send), [true, false, true]);
    setSend(s, "all", false);
    assert.deepEqual(s.quests.map(x => x.send), [false, false, false]);
});

const tagged = body => parseChanges(`<Story_Ledger>\n${body}\n</Story_Ledger>`);
const bullet = (id, more = {}) => ({ id, desc: "a setup", weight: 1, age: 0, hot: false, secret: false, lock: "", at: null, after: "", ...more });
const withQuest = () => postTurn(emptyState(), ch("Quests:\n- + Main: a"), C).state;
const withItems = items => { const s = emptyState(); s.inv.items = [...items]; return s; };

test("closed-form commands accept one terminal punctuation mark", () => {
    assert.equal(postTurn(withQuest(), ch("Quests:\n- done Q1."), C).state.quests[0].status, "done");
    assert.equal(postTurn(withQuest(), ch("Quests:\n- drop Q1,"), C).state.quests[0].status, "dropped");
    const s = emptyState();
    s.chekhov = { bullets: [bullet("B1"), bullet("B2", { lock: "held" })], fired: [] };
    const r = postTurn(s, ch("Chekhov:\n- prune B1;\n- unlock B2."), C);
    assert.deepEqual(r.state.chekhov.fired, [{ id: "B1", desc: "a setup", how: "pruned" }]);
    assert.equal(r.state.chekhov.bullets[0].lock, "");
    assert.deepEqual(r.unparsed, []);
    const dots = postTurn(withQuest(), ch("Quests:\n- done Q1..."), C);
    assert.equal(dots.state.quests[0].status, "active");
    assert.deepEqual(dots.unparsed, [{ section: "Quests", line: "done Q1..." }]);
});

test("tagged replies keep closed forms and removals exact", () => {
    const q = postTurn(withQuest(), tagged("Quests:\n- done Q1."), C);
    assert.equal(q.state.quests[0].status, "active");
    assert.deepEqual(q.unparsed, [{ section: "Quests", line: "done Q1." }]);
    const r = postTurn(withItems(["“x” key"]), tagged('Inventory:\n- - "x" key'), C);
    assert.deepEqual(r.state.inv.items, ["“x” key"]);
    assert.deepEqual(r.unparsed, [{ section: "Inventory", line: '- "x" key' }]);
});

test("curly and straight duplicates are removed by their raw form", () => {
    const both = ['"x" key', "“x” key"];
    assert.deepEqual(postTurn(withItems(both), ch("Inventory:\n- - “x” key"), C).state.inv.items, ['"x" key']);
    assert.deepEqual(postTurn(withItems(both), ch('Inventory:\n- - "x" key'), C).state.inv.items, ["“x” key"]);
});

test("raw precedence survives code, bold and a filtered skeleton", () => {
    const both = ['"x" key', "“x” key"];
    for (const body of ["`- - “x” key`", "- **- “x” key**", "- [+ item]\n- - “x” key", "- - “x” key (dropped)"]) {
        const r = postTurn(withItems(both), ch(`Inventory:\n${body}`), C);
        assert.deepEqual(r.state.inv.items, ['"x" key'], body);
    }
    const s = emptyState();
    s.inv.titles = ['"Ace"', "“Ace”"];
    assert.deepEqual(postTurn(s, ch("Inventory:\n- [title - X]\n- title - “Ace”"), C).state.inv.titles, ['"Ace"']);
});

test("a unique quote-equivalent item is removed", () => {
    const r = postTurn(withItems(["“x” key"]), ch('Inventory:\n- - "x" key'), C);
    assert.deepEqual(r.state.inv.items, []);
    assert.deepEqual(r.unparsed, []);
});

test("an ambiguous quote-equivalent removal is reported", () => {
    const r = postTurn(withItems(["“x” key", "«x» key"]), ch('Inventory:\n- - "x" key'), C);
    assert.deepEqual(r.state.inv.items, ["“x” key", "«x» key"]);
    assert.equal(r.unparsed.length, 1);
});

test("status members retain raw-precedence and partial success", () => {
    const s = emptyState();
    s.inv.status = ['"rope; burn"', "“rope; burn”", '"x"', "“x”"];
    const r = postTurn(s, ch("Inventory:\n- status - “x”; “rope&#59; burn”; Unknown"), C);
    assert.deepEqual(r.state.inv.status, ['"rope; burn"', '"x"']);
    assert.deepEqual(r.unparsed, []);
    const t = emptyState();
    t.inv.status = ["“Tired; Inspired”", "Tired", "Inspired"];
    assert.deepEqual(postTurn(t, ch("Inventory:\n- status - “Tired; Inspired”"), C).state.inv.status, ["Tired", "Inspired"]);
});

test("item names keep terminal punctuation", () => {
    assert.deepEqual(postTurn(emptyState(), ch("Inventory:\n- + Dr. Who mask."), C).state.inv.items, ["Dr. Who mask."]);
});

test("Fate and World closed forms accept one terminal punctuation mark", () => {
    const F = { ...C, dice: { fate: { a: 10, b: 1, c: 5 } } };
    const s = emptyState();
    s.fate = { ...s.fate, deferred: [{ id: "D1", desc: "a", times: 1, age: 0 }, { id: "D2", desc: "b", times: 1, age: 0 }],
        world: [{ id: "W1", desc: "c", prox: "ELSEWHERE", reach: 1, age: 0 }] };
    const r = postTurn(s, ch("Fate:\n- resolve D1.\n- defer D2,\nWorld:\n- escalate W1;"), F);
    assert.deepEqual(r.state.fate.deferred.map(d => [d.id, d.times]), [["D2", 2]]);
    assert.equal(r.state.fate.world[0].prox, "REGIONAL");
    assert.deepEqual(r.unparsed, []);
});
