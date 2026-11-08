// Interjections: a reply the reader cut (LocalChar's Interject, SillyTavern's Intercede) is
// rewritten as one ledger turn that keeps the cut reply's dice.
// Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/host/core.js";

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
