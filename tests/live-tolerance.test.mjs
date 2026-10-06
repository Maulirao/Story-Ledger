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

// ── second live turn ──
import { renderTurnFacts } from "../src/model/prompt.js";
import { renderBlock, parseBlock } from "../src/model/block.js";

const NEW_LINE = "NEW Mara → Jan: E 3, M 4, L 3, Er 3, Ph 4, Ec 5, Pr 3, St 4, Sg 3, Ad 3, Ag 3, Pt 4 | Φ 2 (old friends)";

test("ticks on a relationship that does not exist yet are remembered as awaiting a NEW line", () => {
    const r = run(emptyState(), "Relationships:\n- Mara → Jan: E_acc +1 (helped) | L_acc +1 (joked)\n- Tom → Jan: Ph_acc +1 (shared work)");
    assert.deepEqual(r.state.rel.awaiting, ["Mara→Jan", "Tom→Jan"]);
});

test("the next turn asks for the awaited NEW lines, and the block keeps the list", () => {
    const r = run(emptyState(), "Relationships:\n- Mara → Jan: E_acc +1 (helped)");
    const facts = renderTurnFacts(r.state, { ...C, dice: { fate: { a: 10, b: 1, c: 5 } } });
    assert.match(facts, /Mara → Jan/);
    assert.match(facts, /NEW/);
    const back = parseBlock(renderBlock(r.state, { rules: [], config: C, sections: {} }), { config: C });
    assert.deepEqual(back.errors, []);
    assert.deepEqual(back.state.rel.awaiting, ["Mara→Jan"]);
});

test("a NEW line clears the pair from the awaiting list", () => {
    let r = run(emptyState(), "Relationships:\n- Mara → Jan: E_acc +1 (helped)");
    r = run(r.state, `Relationships:\n- ${NEW_LINE}`);
    assert.deepEqual(r.state.rel.awaiting, []);
    assert.ok(r.state.rel.pairs["Mara→Jan"]);
});

test("a quest progress line with the quest's kind in it applies", () => {
    const s = emptyState();
    s.quests = [{ id: "Q1", kind: "Main", status: "active", objective: "win the race", progress: "", reward: "", send: false }];
    let r = run(s, "Quests:\n- Q1 Main progress: the declaration is ratified");
    assert.equal(r.state.quests[0].progress, "the declaration is ratified");
    r = run(r.state, "Quests:\n- Q1: progress: race tomorrow");
    assert.equal(r.state.quests[0].progress, "race tomorrow");
    assert.ok(!r.unparsed.some(u => u.section === "Quests"));
});
