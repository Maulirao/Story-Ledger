// Interjections: a reply the reader cut (LocalChar's Interject, SillyTavern's Intercede) is
// rewritten as one ledger turn that keeps the cut reply's dice.
// Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/host/core.js";
import { stripForPrompt, stripPromptText } from "../src/model/prompt.js";

const settings = core.normalizeSettings({});
const INHERITED = { fate: { a: 3, b: 9, c: 14 }, world: 7, checks: [20, 3, 11] };

// ── Inherited dice ──────────────────────────────────────────────────────────

test("an interjection's turn takes the dice it inherits", () => {
    const { pending } = core.prepareTurn({
        chat: [], type: "normal", settings, chatData: core.normalizeChatData({}), rng: () => 0,
        inheritedDice: INHERITED,
    });
    assert.deepEqual(pending.dice, INHERITED);
});

test("a part the inherited dice lack is rolled fresh", () => {
    const { pending } = core.prepareTurn({
        chat: [], type: "normal", settings, chatData: core.normalizeChatData({}), rng: () => 0,
        inheritedDice: { fate: { a: 3, b: 9, c: 14 } },
    });
    assert.deepEqual(pending.dice.fate, { a: 3, b: 9, c: 14 });
    assert.equal(pending.dice.world, 1);
    assert.ok(pending.dice.checks.length > 0);
    assert.ok(pending.dice.checks.every(d => d === 1));
});

test("armed fudges still apply on top of inherited dice", () => {
    const chatData = core.normalizeChatData({ storyLedger: { fudges: { dice: { "fate.a": 20 }, appliedTo: null } } });
    const { pending } = core.prepareTurn({
        chat: [], type: "normal", settings, chatData, rng: () => 0, inheritedDice: INHERITED,
    });
    assert.equal(pending.dice.fate.a, 20);
    assert.equal(pending.dice.fate.b, 9);
});

// ── Scene notes: what Intercede (and LocalChar's Interject) hand the model ──

test("a ledger comment and block inside scene notes are removed from a system message", () => {
    const messages = [{ role: "system", content: "<scene_notes>\nShe turns.\n<!-- Story_Ledger\nNow: Day 2 08:00\n-->\n<internal_states>x</internal_states>\n</scene_notes>" }];
    stripForPrompt(messages);
    assert.match(messages[0].content, /She turns\./);
    assert.doesNotMatch(messages[0].content, /Story_Ledger/);
    assert.doesNotMatch(messages[0].content, /internal_states/);
});

test("the ledger's own injection keeps its comment template", () => {
    const content = "<story_ledger>\n<!-- Story_Ledger\nNow: Day 1\n-->\n</story_ledger>";
    const messages = [{ role: "system", content }];
    stripForPrompt(messages);
    assert.equal(messages[0].content, content);
});

test("text completion: a comment inside scene notes never becomes the kept comment", () => {
    const base = "Mara: Hello.\n<!-- Story_Ledger\nNow: Day 1\n-->";
    const notes = "\n<scene_notes>Plan.<!-- Story_Ledger\nNow: Day 9\n--></scene_notes>";
    const out = stripPromptText(base + notes);
    assert.doesNotMatch(out, /Day 9/);
    assert.match(out, /Plan\./);
    assert.ok(out.startsWith(stripPromptText(base)));
});

// ── Voices from the start of a cut reply ────────────────────────────────────

const reply = mes => ({ mes, is_user: false, is_system: false, name: "", swipe_id: 0 });
const user = mes => ({ mes, is_user: true, is_system: false, name: "Jan", swipe_id: 0 });

test("voices from the start of a cut reply are read", () => {
    const chat = [user("go"), reply('<mira>"Wait."'), user('"Stop."'), reply('<kael>"Fine."\n\n<!-- Story_Ledger\nNow: Day 1\n-->')];
    const out = core.rebuildMessage({ chat, index: 3, settings, chatData: core.normalizeChatData({}), userName: "Jan" });
    assert.match(out.mes, /<b>mira<\/b>/);
});
