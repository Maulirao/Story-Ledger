// 👤 NPC AGENDAS — off-screen lives. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn, preTurnFacts } from "../src/model/turn.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const agenda = (task, step, max, more = {}) => ({ task, step, max, aware: "", fibs: "", circle: "", body: "", ...more });

test("agendas round-trip, empty fields included", () => {
    const s = emptyState();
    s.agendas = { Ana: agenda("close the café | early", 1, 2, { aware: "Mara took the key" }) };
    const back = parseBlock(renderBlock(s, { rules: [], config: C, sections: {} }), { config: C }).state;
    assert.deepEqual(back.agendas, s.agendas);
});

test("new / knows / body / @ lines apply", () => {
    const { state } = postTurn(emptyState(), ch('Present: Mara\nAgendas:\n- Ana: new "restock the pantry" 0/2 @ café\n- Mara knows: Ana took the key\n- Mara body: sprained wrist'), C);
    assert.deepEqual(state.agendas.Ana, agenda("restock the pantry", 0, 2));
    assert.equal(state.locations.Ana, "café");
    assert.equal(state.agendas.Mara.aware, "Ana took the key");
    assert.equal(state.agendas.Mara.body, "sprained wrist");
});

test("off-screen agendas advance; on-screen ones do not", () => {
    const s = emptyState();
    s.scene.present = ["Mara"];
    s.agendas = { Ana: agenda("t", 0, 2), Mara: agenda("u", 0, 2) };
    const { state } = postTurn(s, ch("Now: x"), C);
    assert.equal(state.agendas.Ana.step, 1);
    assert.equal(state.agendas.Mara.step, 0);
});

test("a new off-screen agenda does not advance the turn it is created", () => {
    const { state } = postTurn(emptyState(), ch('Agendas:\n- Ana: new "t" 0/2'), C);
    assert.equal(state.agendas.Ana.step, 0);
});

test("facts announce an off-screen agenda about to finish", () => {
    const s = emptyState();
    s.agendas = { Ana: agenda("close the café", 1, 2) };
    assert.match(preTurnFacts(s, C).join("\n"), /Ana finishes "close the café" off-screen this turn/);
});

test("done removes the agenda; knows appends", () => {
    const s = emptyState();
    s.agendas = { Ana: agenda("t", 2, 2, { aware: "a" }) };
    let r = postTurn(s, ch("Agendas:\n- ana knows: b"), C);
    assert.equal(r.state.agendas.Ana.aware, "a; b");
    r = postTurn(r.state, ch('Agendas:\n- Ana: done "t" → left the key with Mara'), C);
    assert.equal(r.state.agendas.Ana, undefined);
});

test("a junk agenda line is unparsed", () => {
    const { unparsed } = postTurn(emptyState(), ch("Agendas:\n- Ana does stuff"), C);
    assert.deepEqual(unparsed, [{ section: "Agendas", line: "Ana does stuff" }]);
});
