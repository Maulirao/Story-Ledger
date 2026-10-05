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
