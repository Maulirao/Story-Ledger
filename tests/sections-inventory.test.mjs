// 🎒 INV & SKILLS — {{user}}'s things, titles, conditions. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn } from "../src/model/turn.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);

test("items with separators round-trip", () => {
    const s = emptyState();
    s.inv = { items: ["rope; 10 m", "key, brass", "a | b"], titles: ["Charmer"], status: [], mods: "+1 social" };
    assert.deepEqual(parseBlock(renderBlock(s, { rules: [], config: C, sections: {} }), { config: C }).state.inv, s.inv);
});

test("+ / - / title / status / mods lines apply; removing an unknown item is unparsed", () => {
    let r = postTurn(emptyState(), ch("Inventory:\n- + spare key\n- title: Charmer\n- status + Tired\n- mods: +1 social"), C);
    assert.deepEqual(r.state.inv, { items: ["spare key"], titles: ["Charmer"], status: ["Tired"], mods: "+1 social" });
    r = postTurn(r.state, ch("Inventory:\n- - Spare Key\n- status - tired\n- - lantern\n- title - charmer"), C);
    assert.deepEqual(r.state.inv.items, []);
    assert.deepEqual(r.state.inv.status, []);
    assert.deepEqual(r.state.inv.titles, []);
    assert.deepEqual(r.unparsed, [{ section: "Inventory", line: "- lantern" }]);
});
