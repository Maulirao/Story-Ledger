// Ledger fix-up: detection and extraction. Run: node --test --test-isolation=none tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { needsFixup, extractComment, validThoughts, fixupConfigInputs } from "../src/model/fixup.js";
import { writeBlockInto } from "../src/model/turn.js";

const BLOCK = "<!-- GFX_START --><!-- story-ledger-state v1 --><internal_states><details><summary>x</summary></details></internal_states><!-- GFX_END -->";

test("needsFixup finds a reply with no comment", () => {
    assert.equal(needsFixup("prose", {}), "missing");
});

test("needsFixup finds a comment without valid Thoughts", () => {
    for (const mes of [
        "p\n<!-- Story_Ledger\nNow: Day 1\n-->",
        "p\n<!-- Story_Ledger\nThoughts:\n- nonsense\n-->",
        "p\n<!-- Story_Ledger\nNow: Day 1\n",
    ]) assert.equal(needsFixup(mes, {}), "thoughts", mes);
});

test("needsFixup is satisfied by a valid Thought, complete or unfinished", () => {
    const done = "p\n<!-- Story_Ledger\nThoughts:\n- Mara: hi\n-->";
    assert.equal(needsFixup(done, {}), null);
    assert.equal(needsFixup(done.replace("\n-->", ""), {}), null);
});

test("needsFixup ignores Thoughts when the section is off", () => {
    assert.equal(needsFixup("p\n<!-- Story_Ledger\nNow: Day 1\n-->", { thoughts: false }), null);
});

test("needsFixup ignores a reply's stored block", () => {
    assert.equal(needsFixup(writeBlockInto("prose", BLOCK), {}), "missing");
});

test("needsFixup leaves tag-form ledgers alone", () => {
    assert.equal(needsFixup("p\n<Story_Ledger>Now: Day 1</Story_Ledger>", {}), null);
});

test("validThoughts keeps only lines the Thoughts section would read", () => {
    assert.deepEqual(validThoughts(["  Mara: hi ", "nonsense", "Jan : ok"]), ["Mara: hi", "Jan : ok"]);
    assert.deepEqual(validThoughts(), []);
});

test("extractComment ignores fences and lead-in text", () => {
    const out = "Here is the comment:\n```html\n<!-- Story_Ledger\nThoughts:\n- Mara: hi\n-->\n```";
    assert.equal(extractComment(out), "<!-- Story_Ledger\nThoughts:\n- Mara: hi\n-->");
});

test("extractComment takes the first complete comment only", () => {
    const a = "<!-- Story_Ledger\nNow: A\n-->", b = "<!-- Story_Ledger\nNow: B\n-->";
    assert.equal(extractComment(`${a}\n${b}`), a);
    assert.equal(extractComment("<!-- Story_Ledger\nNow: A\n"), null);
    assert.equal(extractComment(BLOCK), null);
});

test("fixupConfigInputs reads shown dice and only this reply's fudges", () => {
    const mes = writeBlockInto("prose", "<!-- GFX_START --><!-- story-ledger-state v1 --><internal_states><details><summary>🎲 WORLD SIM</summary>\n- <b>Roll:</b> 7\n</details></internal_states><!-- GFX_END -->");
    const fudges = { dice: { world: 20 }, appliedTo: 3 };
    const r = fixupConfigInputs(mes, fudges, 3);
    assert.equal(r.dice.world, 7);
    assert.deepEqual(r.fudges, fudges);
    for (const applied of [2, null, undefined]) assert.equal(fixupConfigInputs(mes, { ...fudges, appliedTo: applied }, 3).fudges, null);
    assert.equal(fixupConfigInputs(mes, null, 3).fudges, null);
});
