// Reading story time for Chekhov time locks. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { parseStoryTime, lockTime, isAtOrPast } from "../src/model/storytime.js";

test("reads day and time in the usual header forms", () => {
    assert.deepEqual(parseStoryTime("Day 3 — Tuesday, 22:05 | the lawn"), { day: 3, minutes: 22 * 60 + 5 });
    assert.deepEqual(parseStoryTime("[ 🕰️ Time 9:42 PM | 🗓️ Day 12 - Tuesday ]"), { day: 12, minutes: 21 * 60 + 42 });
    assert.deepEqual(parseStoryTime("morning, the café"), null);
    assert.deepEqual(parseStoryTime("noon-ish 12 pm"), { day: null, minutes: 12 * 60 });
});

test("a time already past today locks to the next day", () => {
    const now = { day: 3, minutes: 10 * 60 };
    assert.deepEqual(lockTime("09:00", now), { day: 4, minutes: 9 * 60 });
    assert.deepEqual(lockTime("6 pm", now), { day: 3, minutes: 18 * 60 });
    assert.deepEqual(lockTime("Day 5 08:30", now), { day: 5, minutes: 8 * 60 + 30 });
    assert.deepEqual(lockTime("18:00", null), { day: null, minutes: 18 * 60 });
});

test("isAtOrPast compares day then minutes, minutes only without a day", () => {
    assert.equal(isAtOrPast({ day: 4, minutes: 60 }, { day: 3, minutes: 600 }), true);
    assert.equal(isAtOrPast({ day: 3, minutes: 599 }, { day: 3, minutes: 600 }), false);
    assert.equal(isAtOrPast({ day: null, minutes: 600 }, { day: 9, minutes: 600 }), true);
});
