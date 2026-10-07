// Pure tests for the Rules Notebook model (local fork addition). Run: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import {
    parseNotebookBlock, latestThreads, collectProposals, applyDecision,
    renderNotebookPrompt, importFromLegacyNotebook, needsFfHandover, emptyNotebook,
    storyTime, dayRegression,
} from "../src/model/notebook.js";

const ai = mes => ({ is_user: false, is_system: false, mes });
const user = mes => ({ is_user: true, is_system: false, mes });

const BLOCK = `Prose.

<Blocks>
<World_State>x</World_State>
<Notebook>
Threads:
- [T] Race after breakfast.
- [T] Wine debt open.
Proposed rules:
- add: Ana does not know about the key.
- edit R2: Jun speaks mostly English.
- remove R3: the cabin was sold.
</Notebook>
</Blocks>`;

test("parses threads and every proposal kind from a Notebook block", () => {
    const nb = parseNotebookBlock(BLOCK);
    assert.deepEqual(nb.threads, ["Race after breakfast.", "Wine debt open."]);
    assert.deepEqual(nb.proposals, [
        { op: "add", target: null, text: "Ana does not know about the key." },
        { op: "edit", target: 2, text: "Jun speaks mostly English." },
        { op: "remove", target: 3, text: "the cabin was sold." },
    ]);
});

test("a reply without a Notebook block yields null, an empty Threads list yields []", () => {
    assert.equal(parseNotebookBlock("Just prose."), null);
    assert.deepEqual(parseNotebookBlock("<Notebook>\nThreads:\n</Notebook>").threads, []);
});

test("threads come from the newest AI reply that carries a Notebook (swipe-safe), else the stored list", () => {
    const stored = { ...emptyNotebook(), threads: ["stored thread"] };
    assert.deepEqual(latestThreads([user("hi")], stored), ["stored thread"]);
    const chat = [ai(BLOCK), user("ok"), ai("no block this turn"), user("go")];
    assert.deepEqual(latestThreads(chat, stored), ["Race after breakfast.", "Wine debt open."]);
});

test("proposals become inbox items once, and rejected or already-present ones never return", () => {
    const nb = { ...emptyNotebook(), rules: ["Speak English.", "Jun speaks French.", "Cabin is Hélène's."] };
    const first = collectProposals(nb, parseNotebookBlock(BLOCK).proposals, "m4s0");
    assert.equal(first.inbox.length, 3);
    // the same reply processed again (e.g. re-render) adds nothing
    assert.equal(collectProposals(first, parseNotebookBlock(BLOCK).proposals, "m4s0").inbox.length, 3);
    // a rule that already exists verbatim is not proposed
    const dup = collectProposals(nb, [{ op: "add", target: null, text: "speak english." }], "x");
    assert.equal(dup.inbox.length, 0);
    // rejected proposals are remembered and not re-added
    const rejected = applyDecision(first, first.inbox[0].id, "reject");
    assert.equal(rejected.inbox.length, 2);
    assert.equal(collectProposals(rejected, parseNotebookBlock(BLOCK).proposals, "m6s0").inbox.length, 2);
});

test("approving applies add/edit/remove against the rule's text, not a stale number", () => {
    let nb = { ...emptyNotebook(), rules: ["A.", "Jun speaks French.", "Cabin is Hélène's."] };
    nb = collectProposals(nb, parseNotebookBlock(BLOCK).proposals, "m4s0");
    // the reader inserts a rule at the top before deciding: numbers shift, targets must not
    nb = { ...nb, rules: ["NEW FIRST.", ...nb.rules] };
    const [add, edit, remove] = nb.inbox.map(i => i.id);
    nb = applyDecision(nb, edit, "approve");
    assert.deepEqual(nb.rules, ["NEW FIRST.", "A.", "Jun speaks mostly English.", "Cabin is Hélène's."]);
    nb = applyDecision(nb, remove, "approve");
    assert.deepEqual(nb.rules, ["NEW FIRST.", "A.", "Jun speaks mostly English."]);
    nb = applyDecision(nb, add, "approve");
    assert.equal(nb.rules.at(-1), "Ana does not know about the key.");
    assert.equal(nb.inbox.length, 0);
});

test("an edit whose target rule is gone is reported stale instead of guessing", () => {
    let nb = { ...emptyNotebook(), rules: ["A.", "B."] };
    nb = collectProposals(nb, [{ op: "edit", target: 2, text: "B2." }], "m");
    nb = { ...nb, rules: ["A."] };
    const after = applyDecision(nb, nb.inbox[0].id, "approve");
    assert.deepEqual(after.rules, ["A."]);
    assert.equal(after.inbox[0].stale, true);
});

test("renders rules verbatim and numbered, threads, and pending proposals", () => {
    const nb = collectProposals({ ...emptyNotebook(), rules: ["Keep ALL entries.", "COLORS: Emilia=gold | Jun=cyan"] },
        [{ op: "add", target: null, text: "Ana does not know." }], "m");
    const out = renderNotebookPrompt(nb, ["Race after breakfast."]);
    assert.match(out, /R1\. Keep ALL entries\./);
    assert.match(out, /R2\. COLORS: Emilia=gold \| Jun=cyan/);
    assert.match(out, /- \[T\] Race after breakfast\./);
    assert.match(out, /awaiting the reader.*\n- add: Ana does not know\./s);
    assert.equal(renderNotebookPrompt(emptyNotebook(), []), "");
});

test("imports [R]/[T] from an FF GM's Notebook, newline or <br> separated, tags stripped", () => {
    const ff = `[ 🕰️ Time 9:40 PM | 🗓️ Day 3 ]\n\nprose\n\n<!-- GFX_START -->\n<internal_states>\n<details>\n<summary>🎬 INTERNAL STATES (Turn: 309)</summary>\n<details><summary>📓 GM'S NOTEBOOK</summary>\n- [R]Keep ALL entries every turn.\n- <b>[R]</b> POV: Jan = YOU.<br>- [T] Uno tonight.\n[D] check bond cap\n</details>\n<details><summary>💚 BONDS</summary>- [R] not a notebook line</details>\n</details>\n</internal_states>\n<!-- GFX_END -->`;
    const chat = [ai("old"), ai(ff), user("next")];
    const got = importFromLegacyNotebook(chat);
    assert.deepEqual(got.rules, ["Keep ALL entries every turn.", "POV: Jan = YOU."]);
    assert.deepEqual(got.threads, ["Uno tonight."]);
});

test("imports from a Sola Story Notes Rules field and an Ancient Access ledger too", () => {
    const sola = `<sola_hud>\n<story_notes>\nRules:\n- [R] Ana does not know.\nThreads:\n- [T] Race.\n</story_notes>\n</sola_hud>`;
    assert.deepEqual(importFromLegacyNotebook([ai(sola)]).rules, ["Ana does not know."]);
    const aa = `<ledger>\nNOTEBOOK:\n- [R] Cabin is Hélène's.\n- [T] Wine debt.\nWORLD: —\n</ledger>`;
    assert.deepEqual(importFromLegacyNotebook([ai(aa)]), { rules: ["Cabin is Hélène's."], threads: ["Wine debt."] });
});

test("FF handover is pending only while the newest state is FF's and no Blocks follow it", () => {
    const ff = ai("x\n<!-- GFX_START -->\n<internal_states>s</internal_states>\n<!-- GFX_END -->");
    assert.equal(needsFfHandover([ff, user("go")]), true);
    assert.equal(needsFfHandover([ff, user("go"), ai("y\n<Blocks>\n</Blocks>"), user("go")]), false);
    assert.equal(needsFfHandover([user("hi")]), false);
});

// ── Story clock (free-text fallback to World State's structured time line) ──

const nbReply = (now, extra = "") => `Prose.\n\n<Blocks>\n<Notebook>\nNow: ${now}\nThreads:\n- [T] x${extra}\n</Notebook>\n</Blocks>`;

test("the Notebook block's Now: line is parsed and does not leak into threads", () => {
    const nb = parseNotebookBlock(nbReply("Day 12 — Tue, Mar 4, 21:44 | Lake — lawn"));
    assert.equal(nb.now, "Day 12 — Tue, Mar 4, 21:44 | Lake — lawn");
    assert.deepEqual(nb.threads, ["x"]);
    assert.equal(parseNotebookBlock("<Notebook>\nThreads:\n- [T] y\n</Notebook>").now, null);
});

test("current time comes from the newest reply: Notebook Now:, else World State, else the FF header", () => {
    const ws = "x\n<Blocks>\n<World_State>\n**📅 Time:** Tuesday, Day 12, 9:50 PM | **🌤 Loc:** Lake\n</World_State>\n</Blocks>";
    const ffh = "[ 🕰️ Time 9:42 PM | 🗓️ Day 3 - 🗓️ Tuesday | 📍 Lake - Lawn | ☀️ Clear, 70 °F ]\n\nprose";
    assert.deepEqual(storyTime([ai(nbReply("Day 12, 21:44")), user("go")], emptyNotebook()).now,
        { text: "Day 12, 21:44", source: "notebook" });
    assert.deepEqual(storyTime([ai(ws)], emptyNotebook()).now, { text: "Tuesday, Day 12, 9:50 PM", source: "world_state" });
    assert.deepEqual(storyTime([ai(ffh)], emptyNotebook()).now,
        { text: "Time 9:42 PM | 🗓️ Day 3 - 🗓️ Tuesday | 📍 Lake - Lawn | ☀️ Clear, 70 °F", source: "ff_header" });
});

test("a reader correction wins only until a newer reply carries its own time", () => {
    const chat = [ai(nbReply("Day 3, 09:00")), user("go")];
    const corrected = { ...emptyNotebook(), clockOverride: { text: "Day 3, 18:00", atLength: chat.length } };
    assert.deepEqual(storyTime(chat, corrected).now, { text: "Day 3, 18:00", source: "reader" });
    const later = [...chat, ai(nbReply("Day 3, 18:20")), user("go")];
    assert.deepEqual(storyTime(later, corrected).now, { text: "Day 3, 18:20", source: "notebook" });
});

test("the timeline is the last distinct times in story order, from the chat itself (swipe-safe)", () => {
    const chat = [ai(nbReply("Day 1, 08:00")), user("a"), ai(nbReply("Day 1, 08:00")), user("b"),
        ai(nbReply("Day 1, 21:00")), user("c"), ai("no stamp"), user("d"), ai(nbReply("Day 2, 07:30"))];
    assert.deepEqual(storyTime(chat, emptyNotebook()).timeline, ["Day 1, 08:00", "Day 1, 21:00", "Day 2, 07:30"]);
    const long = Array.from({ length: 10 }, (_, i) => ai(nbReply(`Day ${i + 1}, 08:00`)));
    assert.equal(storyTime(long, emptyNotebook(), 6).timeline.length, 6);
    assert.equal(storyTime(long, emptyNotebook(), 6).timeline.at(-1), "Day 10, 08:00");
});

test("a day counter that goes backwards is flagged; free text without a day number is accepted", () => {
    assert.deepEqual(dayRegression(["Day 12, 21:44", "Day 11, 07:00"]), { from: 12, to: 11 });
    assert.equal(dayRegression(["Day 12, 21:44", "Day 12, 23:00"]), null);
    assert.equal(dayRegression(["Tuesday evening", "Wednesday dawn"]), null);
    assert.equal(dayRegression(["Day 12", "the next morning"]), null);
});

test("the prompt carries the current time and recent timeline even with no rules or threads", () => {
    const out = renderNotebookPrompt(emptyNotebook(), [], { now: { text: "Day 2, 07:30", source: "notebook" }, timeline: ["Day 1, 21:00", "Day 2, 07:30"] });
    assert.match(out, /Current story time: Day 2, 07:30/);
    assert.match(out, /Recent timeline: Day 1, 21:00 → Day 2, 07:30/);
    assert.match(renderNotebookPrompt(emptyNotebook(), [], { now: { text: "Day 3, 18:00", source: "reader" }, timeline: [] }),
        /set by the reader/);
});

// ── proposal diagnostics ────────────────────────────────────────────────────

test("a malformed proposal is reported", () => {
    const nb = parseNotebookBlock("<!-- Story_Ledger\nProposed rules:\n- please remember Jan is tall\n-->");
    assert.deepEqual(nb.unparsed, ["please remember Jan is tall"]);
    assert.deepEqual(nb.proposals, []);
});

test("a skeleton proposal line is left to parseChanges", () => {
    const nb = parseNotebookBlock("<!-- Story_Ledger\nProposed rules:\n- [ONLY when the story sets a fact]\n-->");
    assert.deepEqual(nb.unparsed, []);
});

test("a bolded proposal reads", () => {
    const nb = parseNotebookBlock("<!-- Story_Ledger\nProposed rules:\n- **add:** Jan is tall.\n-->");
    assert.deepEqual(nb.proposals, [{ op: "add", target: null, text: "Jan is tall." }]);
});

test("an unknown rule target is diagnosed", () => {
    const nb = { ...emptyNotebook(), rules: ["Speak English."] };
    const diagnostics = [];
    const after = collectProposals(nb, [{ op: "edit", target: 9, text: "x" }], "m1s0", diagnostics);
    assert.deepEqual(diagnostics, [{ section: "Proposed rules", line: "edit R9", reason: "no rule R9" }]);
    assert.deepEqual(after.inbox, []);
});

test("<Notebook> proposals read as before", () => {
    const got = parseNotebookBlock("<Notebook>\nNow: Day 2\nThreads:\n- [T] fix the gate.\n- **bold thread**\nProposed rules:\n- add: Jan is left-handed.\n</Notebook>");
    assert.deepEqual(got, {
        now: "Day 2",
        threads: ["fix the gate.", "**bold thread**"],
        proposals: [{ op: "add", target: null, text: "Jan is left-handed." }],
    });
});
