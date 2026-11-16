// Reading story time for Chekhov time locks. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { parseStoryTime, lockTime, isAtOrPast, elapsedMinutes, parseDuration, formatDuration } from "../src/model/storytime.js";

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

test("isAtOrPast compares day then minutes; a dayless lock by the clock; a dated lock never from a clock alone", () => {
    assert.equal(isAtOrPast({ day: 4, minutes: 60 }, { day: 3, minutes: 600 }), true);
    assert.equal(isAtOrPast({ day: 3, minutes: 599 }, { day: 3, minutes: 600 }), false);
    assert.equal(isAtOrPast({ day: null, minutes: 600 }, { day: null, minutes: 540 }), true);
    assert.equal(isAtOrPast({ day: null, minutes: 600 }, { day: 9, minutes: 600 }), false);
});

test("elapsedMinutes counts days and minutes, and never runs backwards", () => {
    assert.equal(elapsedMinutes("Day 3 — 10:00", "Day 3 — 10:20 | the lawn"), 20);
    assert.equal(elapsedMinutes("Day 3 — 23:50", "Day 4 — 00:10"), 20);
    assert.equal(elapsedMinutes("Day 3 — 10:00", "Day 5 — 09:00"), 2820);
    assert.equal(elapsedMinutes("Day 3 — 10:00", "Day 3 — 09:00"), 0);
    assert.equal(elapsedMinutes("Day 4 — 10:00", "Day 3 — 12:00"), 0);
    assert.equal(elapsedMinutes("Day 3 — 10:00", "Day 3 — 10:00"), 0);
});

test("without day numbers an earlier clock is midnight passing, unless it is a small step back", () => {
    assert.equal(elapsedMinutes("21:40", "21:55"), 15);
    assert.equal(elapsedMinutes("23:50", "00:10"), 20);
    assert.equal(elapsedMinutes("20:00", "9 am"), 780);
    assert.equal(elapsedMinutes("Day 3 — 23:50", "00:10"), 20);
    assert.equal(elapsedMinutes("10:20", "10:10"), 0);
    assert.equal(elapsedMinutes("17:00", "10:00"), 1020);
});

test("elapsedMinutes cannot tell without a time of day on both lines", () => {
    assert.equal(elapsedMinutes("morning", "Day 3 — 10:00"), null);
    assert.equal(elapsedMinutes("Day 3 — 10:00", "later"), null);
    assert.equal(elapsedMinutes("", ""), null);
});

test("lengths are read in the usual spellings and written short", () => {
    for (const [text, minutes] of [["2h", 120], ["30m", 30], ["45 min", 45], ["1h 30m", 90], ["1h30", 90], ["1.5h", 90],
        ["3 days", 4320], ["2 Weeks", 20160], ["1 day 4 hours", 1680], ["90 minutes", 90], ["2d4h", 3120]]) assert.equal(parseDuration(text), minutes, text);
    for (const text of ["a while", "", "2", "0m", "2 months", "soon, 2h"]) assert.equal(parseDuration(text), null, text);
    for (const [minutes, text] of [[20, "20m"], [60, "1h"], [90, "1h30m"], [2880, "2d"], [3120, "2d4h"], [1445, "1d5m"], [0, "0m"]]) assert.equal(formatDuration(minutes), text);
    for (const n of [1, 59, 61, 1439, 1440, 10081]) assert.equal(parseDuration(formatDuration(n)), n);
});
