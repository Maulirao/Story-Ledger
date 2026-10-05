// 👥 SCENE CAST and 🧾 LAST. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn } from "../src/model/turn.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const who = (more = {}) => ({ position: "", wearing: "", holding: "", condition: "", ...more });

test("cast: field lines apply; people who left the scene are dropped", () => {
    const s = emptyState();
    s.scene.present = ["Mara", "Ana"];
    s.cast = { Ana: who({ position: "door" }) };
    const { state } = postTurn(s, ch("Present: Mara\nCast:\n- mara: holding: the letter"), C);
    assert.deepEqual(Object.keys(state.cast), ["Mara"]);
    assert.equal(state.cast.Mara.holding, "the letter");
});

test("last keeps the newest beats (3 by default)", () => {
    const s = emptyState();
    s.last = ["a", "b"];
    assert.deepEqual(postTurn(s, ch("Last:\n- c\n- d"), C).state.last, ["b", "c", "d"]);
    assert.equal(resolveConfig().sectionConfig.lastBeats, 3);
});

test("cast and last round-trip", () => {
    const s = emptyState();
    s.scene.present = ["Mara"];
    s.cast = { Mara: who({ position: "on the bench | left end", wearing: "<grey> coat", holding: "a & b", condition: "" }) };
    s.last = ["She said \"no\" | twice", "x"];
    const back = parseBlock(renderBlock(s, { rules: [], config: C, sections: {} }), { config: C }).state;
    assert.deepEqual(back.cast, s.cast);
    assert.deepEqual(back.last, s.last);
});
