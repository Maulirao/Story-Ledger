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

// ── One normalization pass over the comment ─────────────────────────────────
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { postTurn, unreadNotices } from "../src/model/turn.js";
import { lastLedgerBlock, notebookBody } from "../src/model/notebook.js";
import { parseRelationLines } from "../src/model/relations.js";

const comment = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const tagged = body => parseChanges(`<Story_Ledger>\n${body}\n</Story_Ledger>`);
const CFG = sections => ({ ...resolveConfig(), userName: "Jan", sections });

test("a numbered, bolded comment reads like the canonical one", () => {
    assert.deepEqual(comment("**Inventory:**\n1. + rope\n2) - towel").sections.Inventory, ["+ rope", "- towel"]);
    // exactly one marker goes: the second is the removal operator
    assert.deepEqual(comment("Inventory:\n2) - - towel").sections.Inventory, ["- - towel"]);
});

test("heading aliases land under the canonical heading", () => {
    assert.deepEqual(comment("Fate & Routine:\n- pursuit: who rang?").sections.Fate, ["pursuit: who rang?"]);
});

test("lines under an unknown heading are reported", () => {
    assert.deepEqual(comment("Mood:\n- tense").unparsed, [{ section: "Mood", line: "tense", raw: "- tense" }]);
    assert.deepEqual(comment("Mood:").unparsed, [], "a heading alone is not an error");
});

test("a bare Name: line does not swallow later commands silently", () => {
    const c = comment("Cast:\n- Mara: position: door\nMara:\n- Mara: holding: cup");
    assert.deepEqual(c.sections.Cast, ["Mara: position: door"]);
    assert.deepEqual(c.unparsed, [{ section: "Mara", line: "Mara: holding: cup", raw: "- Mara: holding: cup" }]);
});

test("disabled section headings are not unknown", () => {
    const { state, unparsed } = postTurn(emptyState(), comment("Factions:\n- Guild: goal: x"), CFG({ factions: false }));
    assert.deepEqual(unparsed, []);
    assert.deepEqual(state.factions ?? {}, {});
});

test("disabled grammar diagnostics do not leak into reply notices", () => {
    const config = CFG({ factions: false, notebook: false });
    const notices = body => {
        const changes = comment(body);
        const { unparsed } = postTurn(emptyState(), changes, config);
        return unreadNotices(changes, unparsed, config.sections);
    };
    const off = "Factions:\n- [Name: goal: text]\nProposed rules:\n- frobnicate R1\nThreads:\n- rubbish";
    assert.deepEqual(notices(off), []);
    assert.deepEqual(notices(`${off}\nMood:\n- tense`), [{ section: "Mood", line: "tense", raw: "- tense" }]);
    // switched on, the same diagnostics still show
    const changes = comment(off);
    const on = postTurn(emptyState(), changes, CFG({}));
    assert.deepEqual(unreadNotices(changes, on.unparsed, {}).map(u => u.section), ["Factions", "Threads"]);
});

test("an unbulleted removal still needs its [T] tag", () => {
    const c = comment("Threads:\n- gate");
    assert.deepEqual(c.threads.remove, []);
    assert.equal(c.unparsed.length, 1);
    assert.deepEqual(comment("Threads:\n- gate\n-gate").threads.remove, []);
});

test("<-> survives tag stripping", () => {
    const c = comment("Relationships:\n- <b>Mara</b> <-> Jan: E_acc +1 (x)");
    assert.equal(c.relations.ticks[0].from, "Mara");
    assert.equal(c.relations.ticks[0].to, "Jan");
    const direct = parseRelationLines(["- <b>Mara</b> <-> Jan: E_acc +1 (x)", "- Mara ⟶ Jan: Ph_acc +1 (y)"]);
    assert.deepEqual(direct.ticks.map(t => [t.from, t.to]), [["Mara", "Jan"], ["Mara", "Jan"]]);
});

test("raw lines keep their quotes", () => {
    const c = comment("Inventory:\n- - “x” key");
    assert.deepEqual(c.raw.Inventory, ["- “x” key"]);
    assert.deepEqual(c.sections.Inventory, ['- "x" key']);
});

test("raw operation alignment survives ignored lines", () => {
    const c = comment("Inventory:\n- [item]\n- - “x” key\nThreads:\n- + [T] call “Ana”\n- - [T] “old” one");
    assert.deepEqual(c.sections.Inventory, ['- "x" key']);
    assert.deepEqual(c.raw.Inventory, ["- “x” key"]);
    assert.deepEqual(c.threads, { add: ['call "Ana"'], remove: ['"old" one'] });
    assert.deepEqual(c.rawThreads, { add: ["call “Ana”"], remove: ["“old” one"] });
});

test("the last ledger block decides the reading path", () => {
    const com = "<!-- Story_Ledger\nInventory:\n1. + a\n-->";
    const tag = "<Story_Ledger>\nInventory:\n1. + b\n</Story_Ledger>";
    assert.deepEqual(lastLedgerBlock(`${com}\n${tag}`), { body: "\nInventory:\n1. + b\n", kind: "tag" });
    assert.equal(notebookBody(`${com}\n${tag}`), "\nInventory:\n1. + b\n");
    assert.equal(lastLedgerBlock("prose"), null);
    const tagLast = parseChanges(`${com}\n${tag}`);
    assert.deepEqual(tagLast.sections, { Inventory: ["1. + b"] });
    assert.equal("raw" in tagLast || "rawThreads" in tagLast, false, "tagged replies gain no metadata");
    const comLast = parseChanges(`${tag}\n${com}`);
    assert.deepEqual(comLast.sections, { Inventory: ["+ a"] });
    assert.deepEqual(comLast.raw, { Inventory: ["+ a"] });
});

test("tagged relationships keep legacy parsing", () => {
    const got = tagged("Relationships:\n1. Mara → Jan: E_acc +1 (“hi”)\n- Mara ⟶ Jan: E_acc +1 (x)");
    assert.deepEqual(got.relations.ticks, [{ from: "1. Mara", to: "Jan", acc: "E", amount: 1, reason: "“hi”" }]);
    assert.deepEqual(got.relations.unparsed, ["Mara ⟶ Jan: E_acc +1 (x)"]);
    const legacy = parseRelationLines(["- Mara ⟶ Jan: E_acc +1 (x)"], { legacy: true });
    assert.deepEqual(legacy.unparsed, ["Mara ⟶ Jan: E_acc +1 (x)"]);
});

test("tagged locations retain historical helper behavior", () => {
    const prev = emptyState();
    prev.locations = { Mara: "hall" };
    const old = postTurn(prev, tagged("Locations:\n- - Mara @ kitchen"), CFG({}));
    assert.deepEqual(old.state.locations, { Mara: "kitchen" });
    // a normalized comment strips one marker only; the second stays part of the line
    const c = comment("Locations:\n- - Mara @ kitchen");
    assert.deepEqual(c.sections.Locations, ["- Mara @ kitchen"]);
    const now = postTurn(prev, c, CFG({}));
    assert.equal(now.state.locations.Mara, "hall");
});
