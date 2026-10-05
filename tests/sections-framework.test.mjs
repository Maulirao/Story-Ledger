// The section registry, id counters and the first registry section (Locations). Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState, nextId } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn, latestState } from "../src/model/turn.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);

test("locations round-trip through the block", () => {
    const s = emptyState();
    s.locations = { Ana: "the café | back room" };
    const out = parseBlock(renderBlock(s, { rules: [], config: C, sections: {} }), { config: C });
    assert.deepEqual(out.state.locations, { Ana: "the café | back room" });
    assert.ok(out.sections.includes("locations"));
});

test("change lines match people case-insensitively", () => {
    const s = emptyState();
    s.locations = { Ana: "home" };
    const { state } = postTurn(s, ch("Locations:\n- ana @ the café"), C);
    assert.deepEqual(state.locations, { Ana: "the café" });
});

test("lines for a disabled section are ignored, not unparsed", () => {
    const cfg = { ...C, sections: { locations: false } };
    const { state, unparsed } = postTurn(emptyState(), ch("Locations:\n- Ana @ the café"), cfg);
    assert.deepEqual(state.locations, {});
    assert.deepEqual(unparsed, []);
});

test("a junk line in an enabled section is unparsed", () => {
    const { unparsed } = postTurn(emptyState(), ch("Locations:\n- somewhere vague"), C);
    assert.deepEqual(unparsed, [{ section: "Locations", line: "somewhere vague" }]);
});

test("a disabled section is not written and does not trigger the older-block fallback", () => {
    const cfg = { ...C, sections: { locations: false } };
    const txt = renderBlock(emptyState(), { rules: [], config: cfg, sections: cfg.sections });
    assert.doesNotMatch(txt, /NPC LOCATIONS/);
    assert.equal(latestState([{ mes: txt }], 1, cfg).errors.length, 0);
});

test("ids survive their items leaving the block", () => {
    const s = emptyState();
    nextId(s, "Q");
    nextId(s, "Q");
    const back = parseBlock(renderBlock(s, { rules: [], config: C, sections: {} }), { config: C }).state;
    assert.equal(nextId(back, "Q"), "Q3");
});
