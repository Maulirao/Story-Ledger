// Behaviour that must not change while change lines become tolerant. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { parseNotebookBlock } from "../src/model/notebook.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn } from "../src/model/turn.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ALL = { scene: true, relationships: true, notebook: true };
const tagged = body => parseChanges(`<Story_Ledger>\n${body}\n</Story_Ledger>`);
const noRel = { relations: { news: [], directs: [], ticks: [], phiTicks: [], notes: [], unparsed: [] } };

test("a <Notebook> snapshot reads as today", () => {
    const got = parseNotebookBlock("<Notebook>\nNow: Day 2\nThreads:\n- [T] fix the gate.\n- **bold thread**\nProposed rules:\n- add: Jan is left-handed.\n</Notebook>");
    assert.deepEqual(got, {
        now: "Day 2",
        threads: ["fix the gate.", "**bold thread**"],
        proposals: [{ op: "add", target: null, text: "Jan is left-handed." }],
    });
});

test("a tagged <Story_Ledger> body reads as today", () => {
    assert.deepEqual(tagged("Now: Day 3\nInventory:\n- + rope.\n* - towel"), {
        now: "Day 3", present: null, public: null,
        threads: { add: [], remove: [] },
        ...noRel,
        proposals: [],
        sections: { Inventory: ["+ rope.", "- towel"] },
        unparsed: [],
    });
});

test("a Relationships tick reason keeps its curly quotes", () => {
    const got = tagged("Relationships:\n- Emilia → Jan: E_acc +2 (he said “hello there”)");
    assert.deepEqual(got.relations.ticks, [{ from: "Emilia", to: "Jan", acc: "E", amount: 2, reason: "he said “hello there”" }]);
    const { state, unparsed } = postTurn(emptyState(), got, C);
    assert.deepEqual(state.rel, { pairs: {}, selves: {}, awaiting: { "Emilia→Jan": "" }, pending: [{ ct: 1, kind: "tick", ...got.relations.ticks[0] }] });
    assert.deepEqual(unparsed, []);
});

test("a Locations line with a leading remove marker still places the person", () => {
    const got = tagged("Locations:\n- - Mara @ kitchen");
    assert.deepEqual(got.sections, { Locations: ["- Mara @ kitchen"] });
    const prev = emptyState();
    prev.locations = { Mara: "hall" };
    const { state, unparsed } = postTurn(prev, got, C);
    assert.deepEqual(state.locations, { Mara: "kitchen" });
    assert.deepEqual(unparsed, []);
});

test("value punctuation survives a turn", () => {
    const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
    let r = postTurn(emptyState(), ch("Inventory:\n- + Dr. Who mask.\n- + folder."), C);
    r = postTurn(r.state, ch("Inventory:\n- - folder."), C);
    assert.deepEqual(r.state.inv.items, ["Dr. Who mask."]);
    assert.deepEqual(r.unparsed, []);
});

test("thread text keeps its terminal period", () => {
    const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
    let r = postTurn(emptyState(), ch("Threads:\n- + [T] Replace sign."), C);
    assert.deepEqual(r.state.threads, ["Replace sign."]);
    r = postTurn(r.state, ch("Threads:\n- - [T] Replace sign."), C);
    assert.deepEqual(r.state.threads, []);
});

test("stored blocks round-trip unchanged", () => {
    const s = emptyState();
    s.ct = 4;
    s.scene = { now: "Day 4 | the lawn", present: ["Mara", "Jan"], public: true };
    s.threads = ["Replace sign."];
    s.rel.pairs["Mara→Jan"] = {
        from: "Mara", to: "Jan",
        axes: { E: 8, M: 2, L: 6, Er: 3, Ph: 9, Ec: 3, Pr: 5, St: 3, Sg: 4, Ad: 3, Ag: 6, Pt: 3 },
        acc: { E: 0, M: 0, L: 1, Er: 0, Ph: 3, Ec: 0, Pr: 0, St: 0, Sg: 0, Ad: 0, Ag: 0, Pt: 0 },
    };
    s.rel.selves.Mara = { phi: 4, acc: -1 };
    s.cast = { Mara: { position: "door", wearing: "an apron", holding: "the letter", condition: "tired" } };
    s.agendas = { Mara: { task: "close the café", step: 1, max: 2, aware: "Jan took the key", fibs: "", circle: "", body: "" } };
    s.locations = { Mara: "the café | back room" };
    s.factions = { "Harbour Guild": { goal: "control the docks", intel: "a", fibs: "b", state: "c", conflict: "d", relations: "e" } };
    s.quests = [{ id: "Q1", kind: "Side", status: "active", objective: "find the key", progress: "checked the shed", reward: "a copy", send: false }];
    s.ids = { Q: 1 };
    s.inv = { items: ["rope.", "Dr. Who mask."], titles: [], status: [] };
    s.chekhov = { bullets: [{ id: "B1", desc: "the gardener's ladder", weight: 2, age: 0, hot: true, secret: true, lock: "", at: { day: 3, minutes: 1080 }, after: "B9" }], fired: [] };
    s.last = ["She said \"no\" | twice", "x"];
    const back = parseBlock(renderBlock(s, { rules: [], config: C, sections: ALL }), { config: C }).state;
    const { perTurn, ...expected } = s;
    const { perTurn: gotPerTurn, ...got } = back;
    assert.deepEqual(got, { ...expected, inv: { ...expected.inv, itemIds: ["I1", "I2"] }, ids: { Q: 1, I: 2 } });
});
