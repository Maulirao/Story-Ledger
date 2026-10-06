// Imported bonds are carried until the model writes their NEW lines. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { postTurn, initialState } from "../src/model/turn.js";
import { importForeign } from "../src/model/import/index.js";
import { renderTurnFacts, buildHandover } from "../src/model/prompt.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { FF_FULL } from "./fixtures/foreign.mjs";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ai = mes => ({ is_user: false, is_system: false, mes });
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const run = (s, body) => postTurn(s, ch(body), { ...C, dice: { fate: { a: 10, b: 1, c: 5 } } });
const roundTrip = s => parseBlock(renderBlock(s, { rules: [], config: C, sections: {} }), { config: C });
const NEW_MARA = "NEW Mara → Jan: E 3, M 4, L 3, Er 3, Ph 4, Ec 5, Pr 3, St 4, Sg 3, Ad 3, Ag 3, Pt 4 | Φ 2 (old friends)";

test("FF bonds import as relationships awaiting NEW, with what FF recorded", () => {
    const r = importForeign([ai(FF_FULL)], C);
    assert.deepEqual(Object.keys(r.state.rel.awaiting), ["Mara→Jan"]);
    assert.match(r.state.rel.awaiting["Mara→Jan"], /BOND: 18/);
    assert.match(r.state.rel.awaiting["Mara→Jan"], /Sparks: 3/);
    assert.ok(!r.unread.some(u => /BONDS/.test(u)));
});

test("a bond between two other characters awaits both directions", () => {
    const ff = `<internal_states>\n<details><summary>🎬 INTERNAL STATES (Turn: 5)</summary>\n<details><summary>💚 BONDS</summary><br>- <b>Mara</b> ↔ <b>Tom</b> · BOND: 4 · Sparks: 0 · Grudge: 2<br></details>\n</details>\n</internal_states>`;
    const r = importForeign([ai(ff)], C);
    assert.deepEqual(Object.keys(r.state.rel.awaiting).sort(), ["Mara→Tom", "Tom→Mara"]);
});

test("AA bonds import the same way", () => {
    const r = importForeign([ai("<ledger>\nTURN: 3\nBONDS: Mara ↔ Jan: 18\nTom → Mara: wary, 6\n</ledger>")], C);
    assert.deepEqual(Object.keys(r.state.rel.awaiting).sort(), ["Mara→Jan", "Tom→Mara"]);
    assert.match(r.state.rel.awaiting["Tom→Mara"], /wary, 6/);
    assert.ok(!r.unread.includes("BONDS"));
});

test("the starting state carries the imported bonds, and the turn facts quote them", () => {
    const s = initialState([ai(FF_FULL)], C);
    assert.match(s.rel.awaiting["Mara→Jan"], /BOND: 18/);
    const facts = renderTurnFacts(s, { ...C, dice: { fate: { a: 10, b: 1, c: 5 } } });
    assert.match(facts, /Mara → Jan/);
    assert.match(facts, /BOND: 18/);
});

test("the carried record survives turns without a NEW line and the block round-trip", () => {
    const s = initialState([ai(FF_FULL)], C);
    let r = run(s, "Relationships:\n- Mara → Jan: E_acc +1 (helped)");
    r = run(r.state, "Now: Day 2 18:00");
    const back = roundTrip(r.state);
    assert.deepEqual(back.errors, []);
    assert.match(back.state.rel.awaiting["Mara→Jan"], /BOND: 18/);
});

test("the NEW line clears it", () => {
    const s = initialState([ai(FF_FULL)], C);
    const r = run(s, `Relationships:\n- ${NEW_MARA}`);
    assert.deepEqual(r.state.rel.awaiting, {});
    assert.ok(r.state.rel.pairs["Mara→Jan"]);
});

test("the handover quotes the text of what it could not read, since the old block is stripped from the prompt", () => {
    const r = importForeign([ai("<ledger>\nTURN: 3\nSCENE: Mara by the window, holding a mug\n</ledger>")], C);
    const h = buildHandover(r.imported, { hasNow: true, unread: r.unread });
    assert.match(h, /Mara by the window, holding a mug/);
});
