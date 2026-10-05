// The <Story_Ledger> block, turns, handover and prompt assembly. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { replayRelations, pairKey } from "../src/model/relations.js";
import {
    parseLedger, buildTurns, importFfTurn, needsHandover, renderRelationsPrompt, stripOldLedgers, correctionsToTurns,
} from "../src/model/ledger.js";

const C = resolveConfig();
const ai = mes => ({ is_user: false, is_system: false, mes });
const user = mes => ({ is_user: true, is_system: false, mes });
const ledger = body => `Prose.\n\n<Story_Ledger>\n${body}\n</Story_Ledger>`;
const NEW = "- NEW Emilia → Jan: E 8, M 3, L 6, Er 3, Ph 9, Ec 3, Pr 5, St 3, Sg 4, Ad 3, Ag 6, Pt 3 | Φ 4 (from FF BOND 18)";

test("parseLedger reads every section of the block", () => {
    const got = parseLedger(ledger(`Now: Day 3 — Tuesday, 22:10 | the lawn
Present: Emilia, Sofia
Threads:
- [T] Race after breakfast.
Relationships:
${NEW}
- Emilia → Jan: Ph_acc +1 (teased him)
Proposed rules:
- add: Ana does not know about the key.`));
    assert.equal(got.now, "Day 3 — Tuesday, 22:10 | the lawn");
    assert.deepEqual(got.present, ["Emilia", "Sofia"]);
    assert.deepEqual(got.threads, ["Race after breakfast."]);
    assert.equal(got.relations.news.length, 1);
    assert.equal(got.relations.ticks[0].acc, "Ph");
    assert.equal(got.proposals[0].op, "add");
    assert.equal(parseLedger("no block"), null);
});

test("an Ancient Access <ledger> block is not mistaken for a Story Ledger", () => {
    assert.equal(parseLedger("x\n<ledger>\nTURN: 5\nNOTEBOOK:\n- [R] a\n</ledger>"), null);
});

test("turns start at the first ledger reply; every later AI reply is a turn; the player is always present", () => {
    const chat = [ai("old FF reply"), user("a"), ai(ledger(`Present: Emilia\nRelationships:\n${NEW}`)), user("b"), ai("a reply that forgot its ledger"), user("c")];
    const { turns, firstIndex } = buildTurns(chat, "Jan");
    assert.equal(firstIndex, 2);
    assert.equal(turns.length, 2);
    assert.deepEqual(turns[0].present.sort(), ["Emilia", "Jan"]);
    assert.deepEqual(turns[1].present, ["Jan"]);
    const { state } = replayRelations(turns, [], C, 309);
    assert.equal(state.ct, 311);
    assert.equal(state.pairs[pairKey("Emilia", "Jan")].axes.Ph, 9);
});

test("reader corrections anchored to a chat length become turn indexes", () => {
    const chat = [ai(ledger("Relationships:\n" + NEW)), user("a"), ai(ledger("x")), user("b"), ai(ledger("y"))];
    const { messageIndexes } = buildTurns(chat, "Jan");
    // set while the chat had 3 messages (0–2): after the turn at message 2, before the one at message 4
    assert.deepEqual(correctionsToTurns([{ atLength: 3, from: "Emilia", to: "Jan", axes: { E: 12 } }], messageIndexes),
        [{ at: 2, from: "Emilia", to: "Jan", axes: { E: 12 } }]);
});

test("the imported FF turn number continues the schedules", () => {
    const ff = "x\n<!-- GFX_START -->\n<internal_states>\n<details>\n  <summary>🎬 INTERNAL STATES (Turn: 309) </summary>\n</details>\n</internal_states>";
    assert.equal(importFfTurn([ai("earlier (Turn: 12)"), ai(ff), user("go")]), 309);
    assert.equal(importFfTurn([user("hi")]), null);
});

test("a handover is due while the newest state comes from another preset", () => {
    const ff = ai("x\n<!-- GFX_START -->\n<internal_states>s</internal_states>\n<!-- GFX_END -->");
    const meg = ai("x\n<Blocks>\n<World_State>w</World_State>\n</Blocks>");
    const sola = ai("x\n<sola_hud digest=\"d\">\n</sola_hud>");
    const aa = ai("x\n<ledger>\nTURN: 1\n</ledger>");
    for (const foreign of [ff, meg, sola, aa]) assert.equal(needsHandover([foreign, user("go")]), true);
    assert.equal(needsHandover([ff, user("go"), ai(ledger("Now: Day 1")), user("go")]), false);
    assert.equal(needsHandover([user("hi")]), false);
});

test("the relationship prompt lists pairs involving someone present, compactly, with tiers, gate and pattern", () => {
    const chat = [ai(ledger(`Relationships:\n${NEW}\n- NEW Sofia → Bryce: E 3, M 4, L 3, Er 5, Ph 4, Ec 6, Pr 5, St 4, Sg 3, Ad 3, Ag 3, Pt 4 | Φ 1 (x)`))];
    const { turns } = buildTurns(chat, "Jan");
    const { state } = replayRelations(turns, [], C);
    const out = renderRelationsPrompt(state, ["Jan", "Emilia"], C);
    assert.match(out, /Emilia → Jan/);
    assert.doesNotMatch(out, /Sofia → Bryce/, "nobody in that pair is present");
    assert.match(out, /Ph 9 Affectionate/);
    assert.match(out, /romance allowed/);
    assert.match(out, /Φ\(Emilia\) 4/);
    assert.equal(renderRelationsPrompt(state, ["Nobody"], C), "");
});

test("old ledger blocks leave the prompt; the newest assistant message keeps its own", () => {
    const messages = [
        { role: "assistant", content: ledger("Now: Day 1") },
        { role: "user", content: "a" },
        { role: "assistant", content: ledger("Now: Day 2") },
        { role: "system", content: "the injected ledger state" },
    ];
    stripOldLedgers(messages);
    assert.equal(messages[0].content, "Prose.");
    assert.match(messages[2].content, /Day 2/);
    assert.equal(messages[3].content, "the injected ledger state");
});

test("the HTML-comment form is read, stripped from old messages, and an unfinished one still parses", () => {
    const c = `Prose.\n\n<!-- Story_Ledger\nNow: Day 4 — Wed, 08:00 | the dock\nPresent: Emilia\nThreads:\n- [T] Race.\n-->`;
    const got = parseLedger(c);
    assert.equal(got.now, "Day 4 — Wed, 08:00 | the dock");
    assert.deepEqual(got.threads, ["Race."]);
    assert.equal(parseLedger("Prose.\n\n<!-- Story_Ledger\nNow: Day 5").now, "Day 5");
    assert.equal(parseLedger("Prose. <!-- an ordinary comment -->"), null);
    const msgs = [{ role: "assistant", content: c }, { role: "user", content: "a" }, { role: "assistant", content: c.replace("Day 4", "Day 5") }];
    stripOldLedgers(msgs);
    assert.equal(msgs[0].content, "Prose.");
    assert.match(msgs[2].content, /Day 5/);
});
