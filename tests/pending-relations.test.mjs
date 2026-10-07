import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { postTurn } from "../src/model/turn.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { applyTurn, emptyRelations, relationsNotice } from "../src/model/relations.js";
import { renderTurnFacts } from "../src/model/prompt.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const axes = Object.fromEntries(C.axes.map(a => [a.key, 3]));
const NEW = `NEW Bryce → Dean: ${C.axes.map(a => `${a.key} 3`).join(", ")}`;
const comment = body => parseChanges(`<!-- Story_Ledger\nRelationships:\n${body}\n-->`);
const run = (s, body) => postTurn(s, comment(body), C);

test("a tick before NEW is saved without a refusal notice, then applied exactly once", () => {
    const s = emptyState();
    const first = run(s, "- Bryce → Dean: Er_acc +1 (called the race)");
    assert.equal(relationsNotice(first.log, []), "");
    assert.deepEqual(first.state.rel.pairs, {});
    assert.deepEqual(first.state.rel.pending, [{ ct: 1, kind: "tick", from: "Bryce", to: "Dean", acc: "Er", amount: 1, reason: "called the race" }]);
    assert.deepEqual(first.state.rel.awaiting, { "Bryce→Dean": "" });
    assert.equal(s.rel.pending, undefined);
    const facts = renderTurnFacts(first.state, C);
    assert.match(facts, /Bryce → Dean/);
    assert.match(facts, /saved|queued/i);
    const created = run(first.state, `- ${NEW}`);
    assert.equal(created.state.rel.pairs["Bryce→Dean"].acc.Er, 1);
    assert.deepEqual(created.state.rel.awaiting, {});
    assert.equal(created.state.rel.pending, undefined);
    const later = run(created.state, "");
    assert.equal(later.state.rel.pairs["Bryce→Dean"].acc.Er, 1);
    assert.equal(later.state.rel.pending, undefined);
});

test("pending changes survive the state block and retain their source turn and reasons", () => {
    const first = run(emptyState(), '- Bryce → Dean: Er_acc +1 (a reason)');
    // A reader can edit saved reasons to contain characters reserved by the row grammar.
    first.state.rel.pending[0].reason = 'a | b; <tag> & "quote"';
    const block = renderBlock(first.state, { config: C, sections: {} });
    const restored = parseBlock(block, { config: C });
    assert.deepEqual(restored.errors, []);
    assert.deepEqual(restored.state.rel, first.state.rel);
    const created = run(restored.state, `- ${NEW}`);
    assert.equal(created.state.rel.pairs["Bryce→Dean"].acc.Er, 1);
    assert.equal(created.state.rel.pending, undefined);
});

test("queued tick caps are per original turn, separate from creation-turn ticks", () => {
    let s = run(emptyState(), "- Bryce → Dean: E_acc +2 (first) | E_acc +2 (second)").state;
    s = run(s, "- Bryce → Dean: E_acc +2 (third)").state;
    const r = run(s, `- ${NEW}\n- Bryce → Dean: E_acc +2 (now)`);
    assert.equal(r.state.rel.pairs["Bryce→Dean"].acc.E, 6);
    assert.equal(r.state.rel.pending, undefined);
});

test("DIRECT and NOTE changes wait for a complete baseline, then apply before current changes", () => {
    const first = run(emptyState(), '- DIRECT Bryce → Dean: Er +1 (dispute)\n- NOTE Bryce → Dean: rivals');
    assert.equal(relationsNotice(first.log, []), "");
    assert.equal(first.state.rel.pending.length, 2);
    const incomplete = run(first.state, "- NEW Bryce → Dean: Er 3");
    assert.deepEqual(incomplete.state.rel.pending, first.state.rel.pending);
    assert.equal(incomplete.state.rel.pairs["Bryce→Dean"], undefined);
    const created = run(incomplete.state, `- ${NEW}\n- NOTE Bryce → Dean: respectful rivals`);
    assert.equal(created.state.rel.pairs["Bryce→Dean"].axes.Er, 4);
    assert.equal(created.state.rel.pairs["Bryce→Dean"].note, "respectful rivals");
    assert.equal(created.state.rel.pending, undefined);
});

test("a baseline for the reverse direction cannot consume queued changes", () => {
    const first = run(emptyState(), "- Bryce → Dean: Er_acc +1 (dispute)");
    const r = run(first.state, `- ${NEW.replace("Bryce → Dean", "Dean → Bryce")}`);
    assert.deepEqual(r.state.rel.pending, first.state.rel.pending);
    assert.equal(r.state.rel.pairs["Dean→Bryce"].acc.Er, 0);
});

test("queueing is reconstructed from the preceding snapshot for swipes and rebuilds", () => {
    const prev = emptyState();
    const rejectedSwipe = run(prev, "- Bryce → Dean: Er_acc +1 (old swipe)");
    const replacement = run(prev, "- Bryce → Dean: Ph_acc +1 (replacement)");
    assert.deepEqual(prev.rel, { pairs: {}, selves: {}, awaiting: {} });
    assert.equal(rejectedSwipe.state.rel.pending[0].acc, "Er");
    assert.equal(replacement.state.rel.pending[0].acc, "Ph");
    const a = run(replacement.state, `- ${NEW}`);
    const rebuilt = run(replacement.state, `- ${NEW}`);
    assert.deepEqual(a.state.rel, rebuilt.state.rel);
    assert.equal(a.state.rel.pairs["Bryce→Dean"].acc.Er, 0);
    assert.equal(a.state.rel.pairs["Bryce→Dean"].acc.Ph, 1);
});

test("invalid ticks do not enter the pending queue", () => {
    const r = applyTurn(emptyRelations(), { ticks: [
        { from: "Bryce", to: "Dean", acc: "Bogus", amount: 1 },
        { from: "Bryce", to: "Dean", acc: "Er", amount: -1 },
    ] }, [], C);
    assert.equal(r.state.pending, undefined);
    assert.equal(r.log.filter(x => x.kind === "refused").length, 2);
    assert.equal(r.state.pairs["Bryce→Dean"], undefined);
});

test("queued short names resolve to a unique calibrated full name", () => {
    const s = run(emptyState(), "- Bryce → Dean: Er_acc +1 (dispute)").state;
    const r = run(s, `- ${NEW.replace("Bryce → Dean", "Bryce Kowal → Dean")}`);
    assert.equal(r.state.rel.pairs["Bryce Kowal→Dean"].acc.Er, 1);
    assert.equal(r.state.rel.pending, undefined);
});

test("ambiguous short names keep their pending changes until an exact baseline is supplied", () => {
    const s = run(emptyState(), "- Bryce → Dean: Er_acc +1 (dispute)").state;
    const ambiguous = run(s, `- ${NEW.replace("Bryce → Dean", "Bryce Kowal → Dean")}\n- ${NEW.replace("Bryce → Dean", "Bryce Smith → Dean")}`);
    assert.deepEqual(ambiguous.state.rel.pending, s.rel.pending);
    assert.deepEqual(ambiguous.state.rel.awaiting, { "Bryce→Dean": "" });
    assert.equal(ambiguous.state.rel.pairs["Bryce Kowal→Dean"].acc.Er, 0);
    const exact = run(ambiguous.state, `- ${NEW}`);
    assert.equal(exact.state.rel.pairs["Bryce→Dean"].acc.Er, 1);
    assert.equal(exact.state.rel.pending, undefined);
});

test("all queued command types and escaped reasons round-trip through the state block", () => {
    const first = run(emptyState(), '- NOTE Bryce → Dean: rivals & allies\n- DIRECT Bryce → Dean: E +1\n- Bryce → Dean: Er_acc +1');
    const block = renderBlock(first.state, { config: C, sections: {} });
    const restored = parseBlock(block, { config: C });
    assert.deepEqual(restored.errors, []);
    assert.deepEqual(restored.state.rel, first.state.rel);
    const r = run(restored.state, `- ${NEW}`);
    assert.equal(r.state.rel.pairs["Bryce→Dean"].note, "rivals & allies");
    assert.equal(r.state.rel.pairs["Bryce→Dean"].axes.E, 4);
    assert.equal(r.state.rel.pairs["Bryce→Dean"].acc.Er, 1);
});

test("a malformed pending row is reported and retains the previous saved changes", () => {
    const s = run(emptyState(), "- Bryce → Dean: Er_acc +1 (dispute)").state;
    const block = renderBlock(s, { config: C, sections: {} });
    for (const broken of [block.replace("Er +1", "Bogus +1"), block.replace("turn 1 | Er", "turn 999 | Er"), block.replace("Pending tick:", "Pending typo:")]) {
        const r = parseBlock(broken, { config: C, prev: s });
        assert.equal(r.errors.length, 1);
        assert.deepEqual(r.state.rel.pending, s.rel.pending);
    }
});

test("the user placeholder in a queued pair cannot match an unrelated character", () => {
    const s = run(emptyState(), "- Bryce → {{user}}: Er_acc +1 (dispute)").state;
    const unrelated = run(s, `- ${NEW}`);
    assert.deepEqual(unrelated.state.rel.pending, s.rel.pending);
    assert.equal(unrelated.state.rel.pairs["Bryce→Dean"].acc.Er, 0);
    const actual = run(unrelated.state, `- ${NEW.replace("Bryce → Dean", "Bryce → Jan")}`);
    assert.equal(actual.state.rel.pairs["Bryce→Jan"].acc.Er, 1);
    assert.equal(actual.state.rel.pending, undefined);
});
