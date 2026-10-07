// A relationship's own description, from the model's NEW line. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { postTurn } from "../src/model/turn.js";
import { renderBlock, parseBlock } from "../src/model/block.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const run = (s, body) => postTurn(s, ch(body), { ...C, dice: { fate: { a: 10, b: 1, c: 5 } } });
const block = s => renderBlock(s, { rules: [], config: C, sections: {} });
const NEW_MARA = "NEW Mara → Jan: E 1, M 1, L 12, Er 1, Ph 19, Ec 1, Pr 10, St 2, Sg 20, Ad 1, Ag 17, Pt 1 | Φ 10 (an aunt's fond teasing | she raised him)";

test("a NEW line's reason becomes the relationship's description", () => {
    const r = run(emptyState(), `Relationships:\n- ${NEW_MARA}`);
    assert.equal(r.state.rel.pairs["Mara→Jan"].note, "an aunt's fond teasing | she raised him");
});

test("the card row shows the description instead of the computed labels, and it round-trips", () => {
    const r = run(emptyState(), `Relationships:\n- ${NEW_MARA}`);
    const html = block(r.state);
    const row = html.split("\n").find(l => l.includes("Mara → Jan"));
    assert.match(row, /an aunt's fond teasing/);
    assert.doesNotMatch(row, /romance|reads as/);
    const back = parseBlock(html, { config: C });
    assert.deepEqual(back.errors, []);
    assert.equal(back.state.rel.pairs["Mara→Jan"].note, "an aunt's fond teasing | she raised him");
    assert.deepEqual(back.state.rel.pairs["Mara→Jan"].axes, r.state.rel.pairs["Mara→Jan"].axes);
});

test("a pair without a description keeps the computed labels", () => {
    const r = run(emptyState(), "Relationships:\n- NEW Mara → Jan: E 3, M 4, L 3, Er 3, Ph 4, Ec 5, Pr 3, St 4, Sg 3, Ad 3, Ag 3, Pt 4 | Φ 2");
    const row = block(r.state).split("\n").find(l => l.includes("Mara → Jan"));
    assert.match(row, /romance locked/);
    const back = parseBlock(block(r.state), { config: C });
    assert.equal(back.state.rel.pairs["Mara→Jan"].note || "", "");
});

test("NOTE revises the description; on a missing pair it is saved", () => {
    let r = run(emptyState(), `Relationships:\n- ${NEW_MARA}`);
    r = run(r.state, "Relationships:\n- NOTE Mara → Jan: proud of him, worried about the race");
    assert.equal(r.state.rel.pairs["Mara→Jan"].note, "proud of him, worried about the race");
    assert.ok(!r.log.some(l => l.kind === "refused"));
    r = run(r.state, "Relationships:\n- NOTE Tom → Jan: a stranger");
    assert.ok(r.log.some(l => l.kind === "queued" && /Tom → Jan/.test(l.text)));
    assert.deepEqual(r.state.rel.pending, [{ ct: r.state.ct, kind: "note", from: "Tom", to: "Jan", text: "a stranger" }]);
});

test("ticks keep the description", () => {
    let r = run(emptyState(), `Relationships:\n- ${NEW_MARA}`);
    r = run(r.state, "Relationships:\n- Mara → Jan: Ph_acc +1 (helped)");
    assert.equal(r.state.rel.pairs["Mara→Jan"].note, "an aunt's fond teasing | she raised him");
});
