// Change lines a model really wrote on its first Story Ledger turn. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { postTurn } from "../src/model/turn.js";
import { relationsNotice } from "../src/model/relations.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const run = (s, body) => postTurn(s, ch(body), { ...C, dice: { fate: { a: 10, b: 1, c: 5 } } });

test("a faction line with several fields, written the way the state shows them, applies", () => {
    const r = run(emptyState(), "Factions:\n- Harbour Guild: intel the tax is coming | state loud, mobilizing | relations the mayor resets the feud");
    assert.deepEqual(r.state.factions["Harbour Guild"], { goal: "", intel: "the tax is coming", fibs: "", state: "loud, mobilizing", conflict: "", relations: "the mayor resets the feud" });
    assert.ok(!r.unparsed.some(u => u.section === "Factions"));
});

test("dot-separated and colon forms of several faction fields apply too", () => {
    const r = run(emptyState(), "Factions:\n- Harbour Guild: goal: the docks · state: low morale");
    assert.equal(r.state.factions["Harbour Guild"].goal, "the docks");
    assert.equal(r.state.factions["Harbour Guild"].state, "low morale");
});

test("a faction field's text may itself contain a pipe-free word like 'state'", () => {
    const r = run(emptyState(), "Factions:\n- Harbour Guild: intel the state police are watching");
    assert.equal(r.state.factions["Harbour Guild"].intel, "the state police are watching");
    assert.equal(r.state.factions["Harbour Guild"].state, "");
});

test("a World line written inside the Fate list is read as a World line", () => {
    const r = run(emptyState(), "Fate:\n- World: + LOCAL: the cousin arrives four hours early");
    assert.deepEqual(r.state.fate.world.map(w => [w.prox, w.desc]), [["LOCAL", "the cousin arrives four hours early"]]);
    assert.ok(!r.unparsed.some(u => /World/.test(u.line)));
});

test("words before the proximity are kept in the happening", () => {
    const r = run(emptyState(), "World:\n- + ARRIVAL landed LOCAL: the cousin four hours early");
    assert.deepEqual(r.state.fate.world.map(w => [w.prox, w.desc]), [["LOCAL", "ARRIVAL landed — the cousin four hours early"]]);
});

test("the relationship notice names each refused line and why", () => {
    const text = relationsNotice(
        [{ kind: "refused", text: "Mara → Jan E_acc refused: no such pair (it needs a NEW line first)." }, { kind: "tick", text: "ok" }],
        ["Mara likes Jan more"],
    );
    assert.match(text, /^2 relationship line/);
    assert.match(text, /needs a NEW line first/);
    assert.match(text, /could not read: "Mara likes Jan more"/);
    assert.equal(relationsNotice([{ kind: "tick", text: "ok" }], []), "");
});
