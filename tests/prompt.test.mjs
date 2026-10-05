// What the model reads, and keeping blocks out of the prompt. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { renderBlock } from "../src/model/block.js";
import { postTurn } from "../src/model/turn.js";
import { parseChanges } from "../src/model/changes.js";
import { emptyNotebook } from "../src/model/notebook.js";
import { renderStatePrompt, needsHandover, stripForPrompt, LEDGER_TEMPLATE } from "../src/model/prompt.js";

const C = { ...resolveConfig(), userName: "Jan" };
const ALL = { scene: true, relationships: true, notebook: true };
const ai = mes => ({ is_user: false, is_system: false, mes });
const user = mes => ({ is_user: true, is_system: false, mes });
const comment = body => `Prose.\n\n<!-- Story_Ledger\n${body}\n-->`;
const NEW = "- NEW Emilia → Jan: E 8, M 3, L 6, Er 3, Ph 9, Ec 3, Pr 5, St 3, Sg 4, Ad 3, Ag 6, Pt 3 | Φ 4 (x)";

test("a handover is due while the newest state comes from another preset", () => {
    const ff = ai("x\n<!-- GFX_START -->\n<internal_states>s</internal_states>\n<!-- GFX_END -->");
    const meg = ai("x\n<Blocks>\n<World_State>w</World_State>\n</Blocks>");
    const sola = ai("x\n<sola_hud digest=\"d\">\n</sola_hud>");
    const aa = ai("x\n<ledger>\nTURN: 1\n</ledger>");
    for (const foreign of [ff, meg, sola, aa]) assert.equal(needsHandover([foreign, user("go")]), true);
    assert.equal(needsHandover([ff, user("go"), ai(comment("Now: Day 1")), user("go")]), false);
    assert.equal(needsHandover([user("hi")]), false);
});

test("our own block is not a foreign state", () => {
    const ours = ai("p\n" + renderBlock(emptyState(), { rules: [], config: C, sections: ALL }));
    assert.equal(needsHandover([ours, user("go")]), false);
});

test("the state prompt lists pairs involving someone present, with tiers, gate and pattern", () => {
    const ch = parseChanges(comment(`Present: Emilia\nRelationships:\n${NEW}\n- NEW Sofia → Bryce: E 3, M 4, L 3, Er 5, Ph 4, Ec 6, Pr 5, St 4, Sg 3, Ad 3, Ag 3, Pt 4 | Φ 1 (x)`));
    const { state } = postTurn(emptyState(), ch, C);
    const out = renderStatePrompt(state, { notebook: emptyNotebook(), config: C, sections: ALL });
    assert.match(out, /Emilia → Jan/);
    assert.doesNotMatch(out, /Sofia → Bryce/, "nobody in that pair is present");
    assert.match(out, /Ph 9 Affectionate/);
    assert.match(out, /romance allowed/);
});

test("the state prompt carries the threads and the story time from the block", () => {
    const s = emptyState();
    s.threads = ["Ask about the letter."];
    s.scene.now = "Day 3 — Tue, 22:05";
    const out = renderStatePrompt(s, { notebook: emptyNotebook(), config: C, sections: ALL });
    assert.match(out, /\[T\] Ask about the letter\./);
    assert.match(out, /Current story time: Day 3 — Tue, 22:05/);
});

test("stripForPrompt removes every block, keeps only the newest comment", () => {
    const blk = renderBlock(emptyState(), { rules: [], config: C, sections: ALL });
    const m = [
        { role: "assistant", content: `a\n<!-- Story_Ledger\nNow: 1\n-->\n${blk}` },
        { role: "user", content: "u" },
        { role: "assistant", content: `b\n<!-- Story_Ledger\nNow: 2\n-->\n${blk}` },
        { role: "system", content: "the injected state" },
    ];
    stripForPrompt(m);
    assert.equal(m[0].content, "a");
    assert.doesNotMatch(m[2].content, /GFX_START/);
    assert.match(m[2].content, /Now: 2/);
    assert.equal(m[3].content, "the injected state");
});

test("the template asks for changes only", () => {
    assert.match(LEDGER_TEMPLATE, /\+ \[T\]/);
    assert.match(LEDGER_TEMPLATE, /only what changed/i);
});

import { stripPromptText } from "../src/model/prompt.js";

test("text completion: blocks go, only the newest reply's comment stays, the injected template is untouched", () => {
    const blk = renderBlock(emptyState(), { rules: [], config: C, sections: ALL });
    const text = [
        `A: one\n<!-- Story_Ledger\nNow: 1\n-->\n${blk}`,
        `U: hi`,
        `A: two\n<!-- Story_Ledger\nNow: 2\n-->\n${blk}`,
        `<story_ledger>\n${LEDGER_TEMPLATE}\n</story_ledger>`,
        `U: go on`,
    ].join("\n");
    const out = stripPromptText(text);
    assert.doesNotMatch(out, /GFX_START|story-ledger-state/);
    assert.doesNotMatch(out, /Now: 1\b/);
    assert.match(out, /Now: 2\b/);
    assert.ok(out.includes(LEDGER_TEMPLATE), "the template inside <story_ledger> is kept whole");
});

test("text completion continue: the continued reply's block is removed from the end of the prompt", () => {
    const blk = renderBlock(emptyState(), { rules: [], config: C, sections: ALL });
    const out = stripPromptText(`U: go\nA: Prose so far.\n<!-- Story_Ledger\nNow: 3\n-->\n\n${blk}`);
    assert.match(out, /Now: 3\n-->$/);
});

// ── phase 2: template, rules and turn facts built from the sections ─────────
import { buildTemplate, renderRules, renderTurnFacts } from "../src/model/prompt.js";

test("the template lists only enabled sections", () => {
    assert.match(buildTemplate({ sections: {} }), /Agendas:[\s\S]*Quests:[\s\S]*Check:/);
    assert.doesNotMatch(buildTemplate({ sections: { quests: false } }), /Quests:/);
    assert.match(buildTemplate({ sections: {} }), /^[\s\S]*<!-- Story_Ledger[\s\S]*-->$/);
});

test("turn facts carry the announcements and the dice", () => {
    const s = emptyState();
    s.ct = 311;
    s.scene.now = "Day 3";
    s.agendas = { Ana: { task: "t", step: 1, max: 2, aware: "", fibs: "", circle: "", body: "" } };
    const out = renderTurnFacts(s, { ...C, sections: {}, rolls: [14, 7, 19] });
    assert.match(out, /^<story_ledger_turn>\nTurn 312 · Day 3/);
    assert.match(out, /Ana finishes/);
    assert.match(out, /14, 7, 19/);
    assert.equal(renderTurnFacts(emptyState(), { ...C, sections: {} }), "");
});

test("rules include only enabled sections' rules", () => {
    assert.match(renderRules({ ...C, sections: {} }), /Agendas: every named NPC/);
    assert.doesNotMatch(renderRules({ ...C, sections: { agendas: false } }), /Agendas: every named NPC/);
    assert.match(renderRules({ ...C, sections: {} }), /^<ledger_rules>[\s\S]*<\/ledger_rules>$/);
});
