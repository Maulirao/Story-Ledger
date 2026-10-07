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

test("the reported race status removals apply even when a condition is already absent", () => {
    const s = emptyState();
    s.inv.status = ["Jan arms/shoulders spent after warm-up lap (stacks with -2 legs for race)", "soaked, at dock mark, race start, dive pending"];
    const changes = ch(`Inventory:
- status - legs spent (-2 for Buoy Race)
- status - Jan arms/shoulders spent after warm-up lap (stacks with -2 legs for race)
- status + post-race spent (arms and shoulders drained, race swum honest)`);
    const first = postTurn(s, changes, C);
    assert.deepEqual(first.unparsed, []);
    assert.deepEqual(first.state.inv.status, ["soaked, at dock mark, race start, dive pending", "post-race spent (arms and shoulders drained, race swum honest)"]);
    const repeated = postTurn(first.state, changes, C);
    assert.deepEqual(repeated.unparsed, []);
    assert.deepEqual(repeated.state.inv, first.state.inv);
    assert.deepEqual(s.inv.status, ["Jan arms/shoulders spent after warm-up lap (stacks with -2 legs for race)", "soaked, at dock mark, race start, dive pending"]);
});

test("absent status removal never deletes a differently worded existing condition", () => {
    const s = emptyState();
    s.inv.status = ["legs spent (-2 stands, race penalty live)"];
    const r = postTurn(s, ch("Inventory:\n- status - legs spent (-2 for Buoy Race)"), C);
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.inv, s.inv);
});

test("tagged replies retain unknown-status warnings", () => {
    const changes = parseChanges("<Story_Ledger>\nInventory:\n- status - Unknown\n</Story_Ledger>");
    const r = postTurn(emptyState(), changes, C);
    assert.deepEqual(r.unparsed, [{ section: "Inventory", line: "status - Unknown" }]);
});
