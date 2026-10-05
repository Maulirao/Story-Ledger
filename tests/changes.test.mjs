// The model's Story_Ledger comment → per-section change lists. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { parseChanges } from "../src/model/changes.js";

test("reads scene lines", () => {
    const c = parseChanges("x\n<!-- Story_Ledger\nNow: Day 3 — Tue, 22:05 | lawn\nPresent: Mara, Jan\nPublic: yes\n-->");
    assert.equal(c.now, "Day 3 — Tue, 22:05 | lawn");
    assert.deepEqual(c.present, ["Mara", "Jan"]);
    assert.equal(c.public, true);
});

test("threads are +/- changes", () => {
    const c = parseChanges("<!-- Story_Ledger\nThreads:\n- + [T] Ask about the letter.\n- - [T] Race after breakfast.\n-->");
    assert.deepEqual(c.threads, { add: ["Ask about the letter."], remove: ["Race after breakfast."] });
});

test("relationships and proposals still parse", () => {
    const c = parseChanges("<!-- Story_Ledger\nRelationships:\n- Mara → Jan: Ph_acc +1 (x)\nProposed rules:\n- add: Ana has the key.\n-->");
    assert.equal(c.relations.ticks[0].acc, "Ph");
    assert.equal(c.proposals[0].op, "add");
});

test("omitted sections are null or empty, never throw", () => {
    const c = parseChanges("<!-- Story_Ledger\nNow: Day 1\n-->");
    assert.equal(c.present, null);
    assert.equal(c.public, null);
    assert.deepEqual(c.threads, { add: [], remove: [] });
});

test("unknown sections are kept raw for later phases; junk thread lines are unparsed", () => {
    const c = parseChanges("<!-- Story_Ledger\nThreads:\n- rubbish\nChekhov:\n- load: a ladder (w1)\n-->");
    assert.deepEqual(c.sections.Chekhov, ["load: a ladder (w1)"]);
    assert.deepEqual(c.unparsed, [{ section: "Threads", line: "rubbish" }]);
});

test("no comment → null", () => assert.equal(parseChanges("just prose"), null));
