// One turn on the snapshot: changes applied to the newest block's state. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock } from "../src/model/block.js";
import { postTurn, latestState, initialState, writeBlockInto } from "../src/model/turn.js";

const C = { ...resolveConfig(), userName: "Jan" };
const ALL = { scene: true, relationships: true, notebook: true };

test("postTurn applies scene, threads and relationships", () => {
    const prev = emptyState();
    prev.ct = 309;
    prev.threads = ["Race after breakfast."];
    const ch = parseChanges("<!-- Story_Ledger\nNow: Day 3\nPresent: Mara\nThreads:\n- - [T] race after breakfast.\n- + [T] Ask about the letter.\nRelationships:\n- NEW Mara → Jan: E 8, M 3, L 6, Er 3, Ph 9, Ec 3, Pr 5, St 3, Sg 4, Ad 3, Ag 6, Pt 3 | Φ 4 (x)\n-->");
    const { state } = postTurn(prev, ch, C);
    assert.equal(state.ct, 310);
    assert.equal(state.scene.now, "Day 3");
    assert.deepEqual(state.threads, ["Ask about the letter."]);
    assert.equal(state.rel.pairs["Mara→Jan"].axes.Ph, 9);
});

test("postTurn with no changes advances ct and keeps everything else", () => {
    const prev = emptyState();
    prev.ct = 5;
    prev.scene.now = "Day 1";
    const { state } = postTurn(prev, null, C);
    assert.equal(state.ct, 6);
    assert.equal(state.scene.now, "Day 1");
});

test("latestState ignores messages at or after the index", () => {
    const blk = n => { const s = emptyState(); s.ct = n; return "p\n\n" + renderBlock(s, { rules: [], config: C, sections: ALL }); };
    const chat = [{ mes: blk(1) }, { mes: "u", is_user: true }, { mes: blk(2) }];
    assert.equal(latestState(chat, 2, C).state.ct, 1);
    assert.equal(latestState(chat, 3, C).state.ct, 2);
    assert.equal(latestState(chat, 0, C), null);
});

test("writeBlockInto replaces any GFX block", () => {
    const mes = "prose\n<!-- Story_Ledger\nNow: x\n-->\n<!-- GFX_START -->\n<internal_states>old</internal_states>\n<!-- GFX_END -->";
    const out = writeBlockInto(mes, "<!-- GFX_START -->NEW<!-- GFX_END -->");
    assert.equal(out.match(/GFX_START/g).length, 1);
    assert.match(out, /NEW/);
    assert.match(out, /Story_Ledger/);
});

test("writeBlockInto moves an existing block to the end", () => {
    const out = writeBlockInto("a\n\n<!-- GFX_START -->OLD<!-- GFX_END -->\n continued text", "<!-- GFX_START -->NEW<!-- GFX_END -->");
    assert.match(out, /^a\s+continued text\n\n<!-- GFX_START -->NEW/);
});

test("initialState continues an FF turn count", () => {
    const ff = { mes: "x\n<internal_states><details><summary>🎬 INTERNAL STATES (Turn: 309)</summary></details></internal_states>" };
    assert.equal(initialState([ff, { mes: "u", is_user: true }], C).ct, 309);
});

// ── final-review fixes ──────────────────────────────────────────────────────
import { stripBlocks, generationBase } from "../src/model/turn.js";
import { parseBlock as _parseBlock } from "../src/model/block.js";

test("an unclosed foreign block never takes the prose with it", () => {
    const mes = "<!-- GFX_START -->\n<internal_states>old</internal_states>\nShe walked in.\n<!-- Story_Ledger\nNow: Day 2\n-->";
    const out = writeBlockInto(mes, "[OURS]");
    assert.match(out, /She walked in\./);
    assert.match(out, /Story_Ledger/);
    assert.doesNotMatch(out, /old/);
    const bare = "Prose here.\n<internal_states>never closed\nmore prose";
    assert.match(writeBlockInto(bare, "[OURS]"), /more prose/);
});

test("a comment finished by continue after our block is read whole", () => {
    const blk = renderBlock(emptyState(), { rules: [], config: C, sections: ALL });
    const mes = `Prose.\n<!-- Story_Ledger\nNow: Day 4\n\n${blk}\nPresent: Mara\nThreads:\n- + [T] Fix the gate.\n-->`;
    const ch = parseChanges(stripBlocks(mes));
    assert.deepEqual(ch.present, ["Mara"]);
    assert.deepEqual(ch.threads.add, ["Fix the gate."]);
});

test("a section missing from the newest block keeps the older block's value", () => {
    const s = emptyState(); s.ct = 1; s.threads = ["Keep me."];
    s.rel.pairs["A→B"] = { from: "A", to: "B", axes: Object.fromEntries(C.axes.map(a => [a.key, 5])), acc: Object.fromEntries(C.axes.map(a => [a.key, 0])) };
    const older = renderBlock(s, { rules: [], config: C, sections: ALL });
    const s2 = { ...s, ct: 2 };
    const newer = renderBlock(s2, { rules: [], config: C, sections: { scene: true, relationships: false, notebook: false } });
    const chat = [{ mes: older }, { mes: "u", is_user: true }, { mes: newer }];
    const got = latestState(chat, 3, C);
    assert.equal(got.state.ct, 2);
    assert.deepEqual(got.state.threads, ["Keep me."]);
    assert.ok(got.state.rel.pairs["A→B"]);
});

test("a broken row in the newest block keeps the older value and reports it", () => {
    const s = emptyState(); s.ct = 1;
    s.rel.pairs["A→B"] = { from: "A", to: "B", axes: Object.fromEntries(C.axes.map(a => [a.key, 5])), acc: Object.fromEntries(C.axes.map(a => [a.key, 0])) };
    const older = renderBlock(s, { rules: [], config: C, sections: ALL });
    const newer = renderBlock({ ...s, ct: 2 }, { rules: [], config: C, sections: ALL }).replace("E 5·0", "E lots");
    const got = latestState([{ mes: older }, { mes: newer }], 2, C);
    assert.equal(got.state.rel.pairs["A→B"].axes.E, 5);
    assert.equal(got.errors.length, 1);
});

test("a 0.1 chat (comments, no block) replays its relationships, turn count and corrections", () => {
    const c1 = "x\n<!-- Story_Ledger\nNow: Day 2\nPresent: Mara\nThreads:\n- [T] Old thread.\nRelationships:\n- NEW Mara → Jan: E 8, M 3, L 6, Er 3, Ph 9, Ec 3, Pr 5, St 3, Sg 4, Ad 3, Ag 6, Pt 3 | Φ 4 (x)\n-->";
    const chat = [{ mes: c1 }, { mes: "u", is_user: true }, { mes: "y\n<!-- Story_Ledger\nNow: Day 2, later\n-->" }];
    const s = initialState(chat, C, { ctOffset: 100, corrections: [{ atLength: 3, from: "Mara", to: "Jan", axes: { E: 12 } }] });
    assert.equal(s.ct, 102);
    assert.equal(s.rel.pairs["Mara→Jan"].axes.E, 12);
    assert.equal(s.scene.now, "Day 2, later");
    assert.deepEqual(s.threads, ["Old thread."]);
});

test("the state a generation starts from excludes the reply being swiped or continued", () => {
    assert.equal(generationBase(10, "normal"), 10);
    assert.equal(generationBase(10, "swipe"), 9);
    assert.equal(generationBase(10, "continue"), 9);
    assert.equal(generationBase(10, "regenerate"), 10);
});

const turnWith = (threads, body) => {
    const prev = emptyState();
    prev.threads = [...threads];
    return postTurn(prev, parseChanges(`<!-- Story_Ledger\n${body}\n-->`), C).state.threads;
};

test("thread removal uses the raw form too", () => {
    assert.deepEqual(turnWith(["fix the “gate”"], 'Threads:\n- - [T] fix the "gate"'), []);
    assert.deepEqual(turnWith(['fix the "gate"', "fix the “gate”"], "Threads:\n- - [T] fix the “gate”"), ['fix the "gate"']);
});

test("raw thread removal is aligned after additions", () => {
    const got = turnWith(['fix "gate"', "fix “gate”"], "Threads:\n- + [T] call Ana\n- - [T] fix “gate”");
    assert.deepEqual(got, ['fix "gate"', "call Ana"]);
});

test("thread removal preserves exact-match multiplicity", () => {
    const got = turnWith(["fix “gate”", 'fix "gate"', "fix “gate”"], "Threads:\n- - [T] fix “gate”\n- - [T] fix “gate”");
    assert.deepEqual(got, ['fix "gate"']);
});

test("an ambiguous quote-equivalent thread removal removes nothing", () => {
    assert.deepEqual(turnWith(["fix “gate”", "fix «gate»"], 'Threads:\n- - [T] fix "gate"'), ["fix “gate”", "fix «gate»"]);
});
