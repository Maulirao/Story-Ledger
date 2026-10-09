// Ledger fix-up: detection, extraction, acceptance and splicing. Run: node --test --test-isolation=none tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { needsFixup, extractComment, validThoughts, fixupConfigInputs, acceptFixup, spliceMissing, spliceThoughts } from "../src/model/fixup.js";
import { writeBlockInto, postTurn } from "../src/model/turn.js";
import { parseChanges } from "../src/model/changes.js";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const OFF = { ...C, sections: { thoughts: false } };
const ctx = (config = C) => ({ sections: config.sections, prev: emptyState(), config });
const wrap = body => `<!-- Story_Ledger\n${body}\n-->`;

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

test("acceptFixup missing: rejects absent, empty and garbage comments", () => {
    assert.deepEqual(acceptFixup("just prose", "missing", ctx()), { ok: false, reason: "no ledger comment" });
    assert.deepEqual(acceptFixup(wrap(""), "missing", ctx(OFF)), { ok: false, reason: "no readable changes" });
    assert.deepEqual(acceptFixup(wrap("garbage words"), "missing", ctx(OFF)), { ok: false, reason: "no readable changes" });
});

test("acceptFixup missing: Thoughts on requires a valid Thought", () => {
    assert.deepEqual(acceptFixup(wrap("Now: Day 2"), "missing", ctx()), { ok: false, reason: "no valid Thoughts" });
    const good = wrap("Now: Day 2\nThoughts:\n- Mara: hi");
    assert.deepEqual(acceptFixup(`Sure!\n${good}`, "missing", ctx()), { ok: true, comment: good });
});

test("acceptFixup missing: Thoughts off accepts a real change", () => {
    const comment = wrap("Now: Day 2");
    assert.deepEqual(acceptFixup(comment, "missing", ctx(OFF)), { ok: true, comment });
});

test("acceptFixup thoughts: returns only the valid lines", () => {
    const out = wrap("Inventory:\n+ rope\nThoughts:\n- Mara: hi\n- nonsense");
    assert.deepEqual(acceptFixup(out, "thoughts", ctx()), { ok: true, thoughts: ["Mara: hi"] });
    assert.deepEqual(acceptFixup("prose", "thoughts", ctx()), { ok: false, reason: "no ledger comment" });
    assert.deepEqual(acceptFixup(wrap("Thoughts:\n- nonsense"), "thoughts", ctx()), { ok: false, reason: "no valid Thoughts" });
});

test("acceptance agrees with what postTurn applies as Thoughts", () => {
    for (const body of ["Thoughts:\n- Mara: hi", "Thoughts:\n* **Mara:** hi", "Thought:\n- Mara: hi", "Thoughts:\n- nonsense", "Thoughts:\n- Mara:"]) {
        const comment = wrap(body);
        const applied = postTurn(emptyState(), parseChanges(comment), C).state.perTurn.thoughts.length > 0;
        assert.equal(acceptFixup(comment, "thoughts", ctx()).ok, applied, body);
    }
});

test("spliceMissing keeps the prose bytes as a prefix", () => {
    const comment = wrap("Now: Day 2");
    assert.equal(spliceMissing("a\r\nb  \n", comment), "a\r\nb" + "\n\n" + comment);
});

const INSERT = "\nThoughts:\n- Mara: hi\n";

test("spliceThoughts only inserts", () => {
    const cases = [
        ["p\n<!-- Story_Ledger\nNow: Day 1\n-->", s => s.replace("-->", INSERT + "-->")],
        ["p\n<!-- Story_Ledger\nNow: Day 1\n", s => s + INSERT + "-->"],
        ["p\n<!-- Story_Ledger\nThoughts:\n- nonsense\n-->", s => s.replace("-->", INSERT + "-->")],
    ];
    for (const [input, expected] of cases) {
        const out = spliceThoughts(input, ["Mara: hi"]);
        assert.equal(out, expected(input));
        assert.equal(needsFixup(out, {}), null, input);
    }
});

test("spliceThoughts keeps the comment's other changes in order", () => {
    const prose = "p\n";
    const comment = wrap("Inventory:\n- + rope\n- + lamp\nRelationships:\n- NEW Mara → Jan: E 8, M 3, L 6, Er 3, Ph 9, Ec 3, Pr 5, St 3, Sg 4, Ad 3, Ag 6, Pt 3 | Φ 4 (x)\nQuests:\n- + Main: find the key");
    const result = text => postTurn(emptyState(), parseChanges(text), C).state;
    const before = result(prose + comment), after = result(spliceThoughts(prose + comment, ["Mara: hi"]));
    assert.deepEqual(after.inv, before.inv);
    assert.deepEqual(after.rel, before.rel);
    assert.deepEqual(after.quests, before.quests);
    assert.deepEqual(after.perTurn.thoughts, [{ name: "Mara", text: "hi" }]);
    assert.ok(JSON.stringify(before.inv).includes("rope"));
});

test("spliceThoughts targets the Story_Ledger comment among other comments", () => {
    const lead = "a --> b <!-- other ext --> c\n";
    const out = spliceThoughts(lead + "<!-- Story_Ledger\nNow: Day 1\n-->", ["Mara: hi"]);
    assert.equal(out, lead + "<!-- Story_Ledger\nNow: Day 1\n" + INSERT + "-->");
});
