import test from "node:test";
import assert from "node:assert/strict";
import { headingOf, headingKey, buildHeadings, HEADINGS } from "../src/model/headings.js";
import { SECTIONS } from "../src/model/sections/registry.js";

const h = (text, bulleted = false) => headingOf({ text, bulleted });

test("known headings resolve in any framing", () => {
    for (const [text, bulleted] of [["Quests:", false], ["quests", false], ["QUEST:", false], ["### Quests", false], ["Quests :", false], ["- Quests:", true]]) {
        assert.deepEqual(h(text, bulleted), { name: "Quests", known: true }, text);
    }
});

test("aliases resolve to the canonical name", () => {
    assert.deepEqual(h("Fate & Routine:"), { name: "Fate", known: true });
    assert.deepEqual(h("Chekhov's Gun:"), { name: "Chekhov", known: true });
    assert.deepEqual(h("Thread:"), { name: "Threads", known: true });
});

test("Rules, Bonds and Physic are not headings", () => {
    assert.equal(h("Rules:").known, false);
    assert.equal(h("Bonds:").known, false);
    assert.equal(h("Physic:").known, false);
});

test("unknown and non-headings", () => {
    assert.equal(h("### Notes"), null);
    assert.equal(h("- Mara:", true), null);
    assert.deepEqual(h("Mara:"), { name: "Mara", known: false });
    assert.equal(h("Factions: goal: x"), null);
});

test("every section change resolves to itself", () => {
    for (const s of SECTIONS) assert.equal(HEADINGS.get(headingKey(s.change)), s.change);
});

test("an alias collision throws", () => {
    assert.throws(() => buildHeadings([{ change: "Quests", aliases: ["Quest"] }, { change: "Quest" }]), /heading alias collision: quest/);
});
