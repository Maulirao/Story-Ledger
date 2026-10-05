// 🏳️ FACTIONS and 📜 QUESTS. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn } from "../src/model/turn.js";

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
    assert.deepEqual(state.quests, [{ id: "Q1", kind: "Side", status: "active", objective: "find the spare key", progress: "", reward: "a copy of it" }]);
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
