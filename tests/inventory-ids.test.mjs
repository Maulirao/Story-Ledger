import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { postTurn, latestState } from "../src/model/turn.js";
import { renderBlock, parseBlock, BLOCK_MARK } from "../src/model/block.js";
import { renderStatePrompt } from "../src/model/prompt.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const change = body => parseChanges(`<!-- Story_Ledger\nInventory:\n${body}\n-->`);
const turn = (state, body) => postTurn(state, change(body), C);
const block = state => renderBlock(state, { config: C, sections: {}, rules: [] });

test("old inventory blocks gain deterministic IDs without changing descriptions", () => {
    const old = `${BLOCK_MARK}\n<internal_states><details><summary>🎒 INV & SKILLS</summary>\n- <b>Inv:</b> 1 towel (on Emilia); brass key\n- <b>Titles/Skills:</b> —\n- <b>Status:</b> —\n- <b>Mods:</b> —\n</details></internal_states>`;
    const read = parseBlock(old, { config: C });
    assert.deepEqual(read.errors, []);
    assert.deepEqual(read.state.inv.items, ["1 towel (on Emilia)", "brass key"]);
    assert.deepEqual(read.state.inv.itemIds, ["I1", "I2"]);
    assert.deepEqual(parseBlock(old, { config: C }).state.inv.itemIds, ["I1", "I2"]);
    const r = turn(read.state, "- - I1 (left behind)");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.inv.items, ["brass key"]);
    assert.deepEqual(r.state.inv.itemIds, ["I2"]);
});

test("item updates preserve identity and IDs are not reused after removal", () => {
    const first = turn(emptyState(), "- + towel (on Emilia)\n- + brass key");
    const updated = turn(first.state, "- i1 update: towel (on Jan; damp)\n- - I2.\n- + lantern");
    assert.deepEqual(updated.unparsed, []);
    assert.deepEqual(updated.state.inv.items, ["towel (on Jan; damp)", "lantern"]);
    assert.deepEqual(updated.state.inv.itemIds, ["I1", "I3"]);
    const read = parseBlock(block(updated.state), { config: C });
    assert.deepEqual(read.errors, []);
    assert.deepEqual(read.state.inv, updated.state.inv);
    const next = turn(read.state, "- - I1 (lost)\n- - I3\n- + compass");
    assert.deepEqual(next.state.inv.itemIds, ["I4"]);
    assert.deepEqual(first.state.inv.items, ["towel (on Emilia)", "brass key"]);
});

test("unknown and malformed ID commands never fall back to item names", () => {
    const first = turn(emptyState(), "- + I99\n- + towel\n- + I99 (left behind)");
    const lines = ["- I99 (left behind)", "I99 update: key", "I2 update:", "- I2 stray command"];
    const r = turn(first.state, lines.map(line => `- ${line}`).join("\n"));
    assert.deepEqual(r.state.inv, first.state.inv);
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Inventory", line })));
});

test("an ID removal accepts its matching item label and leaves Money unchanged", () => {
    const s = emptyState();
    s.inv.items = ["$50 (cash carried on Jan)", "impeller"];
    s.inv.itemIds = ["I8", "I9"];
    s.inv.money = { USD: "50" };
    const r = turn(s, "- - I8 $50 (paid toward the impeller with Gilles's fifty)");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.inv.items, ["impeller"]);
    assert.deepEqual(r.state.inv.itemIds, ["I9"]);
    assert.deepEqual(r.state.inv.money, { USD: "50" });
    assert.deepEqual(s.inv.items, ["$50 (cash carried on Jan)", "impeller"]);
});

test("a labelled ID removal refuses conflicting labels and unknown IDs", () => {
    const s = emptyState();
    s.inv.items = ["$50", "impeller"];
    s.inv.itemIds = ["I8", "I9"];
    const lines = ["- I8 impeller (paid)", "- I99 $50 (paid)", "- I8 $50 stray command"];
    const r = turn(s, lines.map(line => `- ${line}`).join("\n"));
    assert.deepEqual(r.state.inv.items, s.inv.items);
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Inventory", line })));
});

test("a single-bullet spent-item line removes the bill without debiting Money", () => {
    const s = emptyState();
    s.inv.items = ["$5 bill (in Jan's wallet)", "$50 bill"];
    s.inv.itemIds = ["I8", "I9"];
    s.inv.money = { USD: "55" };
    const line = "$5 bill (settled the dealer tab, tip kept)";
    const r = turn(s, `- ${line}`);
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.inv.items, ["$50 bill"]);
    assert.deepEqual(r.state.inv.itemIds, ["I9"]);
    assert.deepEqual(r.state.inv.money, { USD: "55" });
    const tagged = postTurn(s, parseChanges(`<Story_Ledger>\nInventory:\n- ${line}\n</Story_Ledger>`), C);
    assert.deepEqual(tagged.unparsed, [{ section: "Inventory", line }]);
    assert.deepEqual(tagged.state.inv.items, s.inv.items);
});

test("single-bullet removals need an explicit disposal note and a unique saved item", () => {
    const s = emptyState();
    s.inv.items = ["$5 bill (left pocket)", "$5 bill (right pocket)", "$50 bill", "key"];
    const lines = ["$5 bill (settled the tab)", "$10 bill (paid the tab)", "$50 bill (tip kept)", "$50 bill (left pocket)", "key", "$50 bill (settled the tab", "$50 bill (settled the tab) + lantern"];
    const r = turn(s, lines.map(line => `- ${line}`).join("\n"));
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Inventory", line })));
    assert.deepEqual(r.state.inv.items, s.inv.items);
});

test("name removals ignore arbitrary trailing notes only for a unique counted base", () => {
    for (const name of ["towel (with blue stripes)", "1 towel (bathroom)", "towel (under repair)", "1 towel (on emilia)", "towel (wet (after swimming))"]) {
        const s = emptyState(); s.inv.items = [name, "key"];
        const r = turn(s, "- - 1 towel (no longer carried (left in room))");
        assert.deepEqual(r.state.inv.items, ["key"], name);
        assert.deepEqual(r.unparsed, [], name);
        assert.deepEqual(r.state.inv.itemIds, ["I2"]);
    }
    for (const items of [["towel (blue)", "1 towel (red)"], ["2 towels (bathroom)"], ["towel", "1 towel (blue)"]]) {
        const s = emptyState(); s.inv.items = items;
        const r = turn(s, "- - 1 towel (no longer carried)");
        assert.deepEqual(r.state.inv.items, items);
        assert.equal(r.unparsed.length, 1);
    }
});

test("a specific name wins while ambiguous name removals can use IDs", () => {
    const first = turn(emptyState(), "- + towel (blue)\n- + towel (red)\n- + key");
    const exact = turn(first.state, "- - towel (blue)");
    assert.deepEqual(exact.state.inv.itemIds, ["I2", "I3"]);
    const explicit = turn(first.state, "- - I2 (red towel left behind)");
    assert.deepEqual(explicit.state.inv.items, ["towel (blue)", "key"]);
    assert.deepEqual(explicit.state.inv.itemIds, ["I1", "I3"]);
    assert.deepEqual(explicit.unparsed, []);
});

test("inventory prompts show IDs that agree with the next turn without mutating inputs", () => {
    const s = emptyState(); s.inv.items = ["towel (bathroom)", "key"];
    const before = structuredClone(s);
    const prompt = renderStatePrompt(s, { notebook: { rules: [], inbox: [] }, config: C, sections: {} });
    assert.match(prompt, /I1[^\n]*towel \(bathroom\)/);
    assert.match(prompt, /I2[^\n]*key/);
    assert.deepEqual(s, before);
    const r = turn(s, "- - I1");
    assert.deepEqual(r.state.inv.items, ["key"]);
    assert.deepEqual(r.unparsed, []);
    const rendered = block(s);
    assert.deepEqual(s, before);
    assert.deepEqual(parseBlock(rendered, { config: C }).state.inv.itemIds, ["I1", "I2"]);
});

test("swipe alternatives and rebuilds allocate from their own preceding snapshot", () => {
    const previous = turn(emptyState(), "- + towel\n- + key").state;
    const chat = [{ mes: block(previous) }, { mes: block(turn(previous, "- - I1\n- + lantern").state) }];
    const base = latestState(chat, 1, C).state;
    const alternative = turn(base, "- I1 update: towel (dry)\n- + compass");
    assert.deepEqual(alternative.state.inv.items, ["towel (dry)", "key", "compass"]);
    assert.deepEqual(alternative.state.inv.itemIds, ["I1", "I2", "I3"]);
    assert.deepEqual(turn(base, "- I1 update: towel (dry)\n- + compass").state.inv, alternative.state.inv);
});

test("stored ID rows handle escaped separators and malformed IDs preserve prior inventory", () => {
    const first = turn(emptyState(), '- + rope; 10 m | "red" & blue\n- + key');
    const text = block(first.state);
    assert.deepEqual(parseBlock(text, { config: C }).state.inv, first.state.inv);
    const duplicate = text.replace(/Item I2/g, "Item I1");
    const damaged = parseBlock(duplicate, { prev: first.state, config: C });
    assert.ok(damaged.errors.length);
    assert.deepEqual(damaged.state.inv.items, first.state.inv.items);
    assert.deepEqual(damaged.state.inv.itemIds, first.state.inv.itemIds);
});

test("mixed legacy and ID rows cannot steal an explicitly assigned identity", () => {
    const previous = turn(emptyState(), "- + key").state;
    const mixed = `${BLOCK_MARK}\n<internal_states><details><summary>🎒 INV & SKILLS</summary>\n- <b>Inv:</b> key\n- <b>Item I1:</b> towel\n</details></internal_states>`;
    const read = parseBlock(mixed, { prev: previous, config: C });
    assert.deepEqual(read.errors, []);
    assert.deepEqual(read.state.inv.items, ["key", "towel"]);
    assert.deepEqual(read.state.inv.itemIds, ["I2", "I1"]);
    const r = turn(read.state, "- - I1");
    assert.deepEqual(r.state.inv.items, ["key"]);
    assert.deepEqual(r.state.inv.itemIds, ["I2"]);
});

test("recovering a damaged inventory cannot assign its corrupt row's IDs to legacy items", () => {
    const previous = emptyState(); previous.inv.items = ["key"];
    const broken = `${BLOCK_MARK}\n<internal_states><details><summary>🎒 INV & SKILLS</summary>\n- <b>Item I7:</b> towel\n- <b>Item I7:</b> lantern\n</details></internal_states>`;
    const read = parseBlock(broken, { prev: previous, config: C });
    assert.ok(read.errors.length);
    assert.deepEqual(read.state.inv.items, ["key"]);
    assert.deepEqual(read.state.inv.itemIds, ["I1"]);
});

test("an ID counter outside a saved block cannot consume IDs in its snapshot", () => {
    const previous = turn(emptyState(), "- + key").state;
    const text = block(previous) + '\n<!-- story-ledger-ids I99 -->';
    // Remove this block's own counter to exercise reconstruction from its item rows.
    const read = parseBlock(text.replace('<!-- story-ledger-ids I1 -->', ''), { config: C });
    const r = turn(read.state, "- + towel");
    assert.deepEqual(r.state.inv.itemIds, ["I1", "I2"]);
});

test("a damaged item HTML row preserves the inventory when reading the latest snapshot", () => {
    const previous = turn(emptyState(), "- + key\n- + towel").state;
    const damaged = block(previous).replace('- <b>Item I2:</b> towel', '- <b>Item I2: towel');
    const chat = [{ mes: block(previous) }, { mes: damaged }];
    const read = latestState(chat, 2, C);
    assert.ok(read.errors.length);
    assert.deepEqual(read.state.inv.items, ["key", "towel"]);
    assert.deepEqual(read.state.inv.itemIds, ["I1", "I2"]);
    const next = turn(read.state, "- - I2");
    assert.deepEqual(next.state.inv.items, ["key"]);
    assert.deepEqual(next.unparsed, []);
});

test("ID removal explanations must be balanced and cannot hide another command", () => {
    const previous = turn(emptyState(), "- + towel").state;
    const lines = ["- I1 (lost))", "- I1 ((lost)", "- I1 (lost) keep it (actually)", "- I1 ($50) (paid))", "- I1 ($50) ((paid)"];
    for (const line of lines) {
        const r = turn(previous, `- ${line}`);
        assert.deepEqual(r.state.inv, previous.inv, line);
        assert.deepEqual(r.unparsed, [{ section: "Inventory", line }]);
    }
    const nested = turn(previous, "- - I1 (left behind (after swimming)).");
    assert.deepEqual(nested.state.inv.items, []);
    assert.deepEqual(nested.unparsed, []);
});

test("the screenshot's I8 removal accepts multiple parenthetical notes without doing money arithmetic", () => {
    const previous = emptyState();
    previous.inv.items = ["$50", "key"];
    previous.inv.itemIds = ["I8", "I9"];
    for (const line of [
        "- I8 ($50) (paid Tremblay for the tin, change refused)",
        "- i8 ($50) (paid Tremblay (change refused)).",
        "- I8 ($50)(paid Tremblay)",
    ]) {
        const r = turn(previous, `- ${line}`);
        assert.deepEqual(r.unparsed, [], line);
        assert.deepEqual(r.state.inv.items, ["key"], line);
        assert.deepEqual(r.state.inv.itemIds, ["I9"], line);
    }
    const unknown = turn(previous, "- - I99 ($50) (paid Tremblay)");
    assert.deepEqual(unknown.state.inv.items, previous.inv.items);
    assert.deepEqual(unknown.state.inv.itemIds, previous.inv.itemIds);
    assert.equal(unknown.unparsed.length, 1);
    assert.deepEqual(previous.inv.items, ["$50", "key"]);
});

test("colon descriptions on ID removals do not select another item or modify a balance", () => {
    const previous = emptyState();
    previous.inv.items = ["$50", "key"];
    previous.inv.itemIds = ["I8", "I9"];
    previous.inv.money = { CAD: "12" };
    for (const line of ["- I8: $50 (Gilles's cash, spent at the dealer)", "- i8 : inaccurate description mentioning I9"]) {
        const r = turn(previous, `- ${line}`);
        assert.deepEqual(r.unparsed, [], line);
        assert.deepEqual(r.state.inv.items, ["key"], line);
        assert.deepEqual(r.state.inv.itemIds, ["I9"], line);
        assert.deepEqual(r.state.inv.money, { CAD: "12" }, line);
    }
    for (const line of ["- I99: $50 (spent)", "- I8:"]) {
        const r = turn(previous, `- ${line}`);
        assert.deepEqual(r.state.inv, previous.inv, line);
        assert.deepEqual(r.unparsed, [{ section: "Inventory", line }], line);
    }
});

test("latestState reuses retained identities when an ID snapshot contains a legacy inventory row", () => {
    const previous = turn(emptyState(), "- + key\n- + towel").state;
    const mixed = block(previous).replace('- <b>Item I1:</b> key', '- <b>Inv:</b> key');
    const read = latestState([{ mes: block(previous) }, { mes: mixed }], 2, C);
    assert.deepEqual(read.errors, []);
    assert.deepEqual(read.state.inv.items, ["key", "towel"]);
    assert.deepEqual(read.state.inv.itemIds, ["I1", "I2"]);
    const next = turn(read.state, "- - I1\n- + lantern");
    assert.deepEqual(next.state.inv.items, ["towel", "lantern"]);
    assert.deepEqual(next.state.inv.itemIds, ["I2", "I3"]);
});
