// 🔫 CHEKHOV'S GUN — setups loaded by the model, aged and pruned by the ledger. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn } from "../src/model/turn.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const bullet = (id, more = {}) => ({ id, desc: id, weight: 1, age: 0, hot: false, secret: false, lock: "", at: null, after: "", ...more });

test("load parses weight, flags, time and dependency; a new bullet starts at age 0 and does not age the turn it is loaded", () => {
    const s = emptyState();
    s.scene.now = "Day 3 — 10:00";
    const { state } = postTurn(s, ch("Chekhov:\n- load: the gardener's ladder (w2, hot, secret, at 18:00, after B9)"), C);
    assert.deepEqual(state.chekhov.bullets[0], { id: "B1", desc: "the gardener's ladder", weight: 2, age: 0, hot: true, secret: true, lock: "", at: { day: 3, minutes: 1080 }, after: "B9" });
});

test("unlocked bullets age each turn; locked ones are frozen", () => {
    const s = emptyState();
    s.chekhov.bullets = [bullet("B1", { age: 3 }), bullet("B2", { age: 3, lock: "CROWD" })];
    const { state } = postTurn(s, null, C);
    assert.deepEqual(state.chekhov.bullets.map(b => b.age), [4, 3]);
});

test("extra loads are kept and warned about", () => {
    const { state, warnings } = postTurn(emptyState(), ch("Chekhov:\n- load: a (w1)\n- load: b (w1)"), C);
    assert.equal(state.chekhov.bullets.length, 2);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].section, "Chekhov");
});

test("fire moves a bullet to fired with how; firing an ineligible bullet is applied and warned", () => {
    const s = emptyState();
    s.chekhov.bullets = [bullet("B1", { age: 2 })];
    const { state, warnings } = postTurn(s, ch("Chekhov:\n- fire B1: the ladder falls"), C);
    assert.deepEqual(state.chekhov.fired, [{ id: "B1", desc: "B1", how: "the ladder falls" }]);
    assert.equal(state.chekhov.bullets.length, 0);
    assert.equal(warnings.length, 1);
});

test("lock, unlock and prune lines; an unknown id is unparsed", () => {
    const s = emptyState();
    s.chekhov.bullets = [bullet("B1", { age: 2 }), bullet("B2", { at: { day: null, minutes: 60 } }), bullet("B3")];
    const { state, unparsed } = postTurn(s, ch("Chekhov:\n- lock B1: CROWD\n- unlock B2\n- prune B3\n- fire B9: x"), C);
    assert.equal(state.chekhov.bullets[0].lock, "CROWD");
    assert.equal(state.chekhov.bullets[1].at, null);
    assert.deepEqual(state.chekhov.fired.at(-1), { id: "B3", desc: "B3", how: "pruned" });
    assert.deepEqual(unparsed, [{ section: "Chekhov", line: "fire B9: x" }]);
});

test("prune at age 12 moves to fired; fired keeps the newest 10", () => {
    const s = emptyState();
    s.chekhov.bullets = [bullet("B1", { age: 11 })];
    s.chekhov.fired = Array.from({ length: 10 }, (_, k) => ({ id: `B${k + 20}`, desc: "x", how: "y" }));
    const { state } = postTurn(s, null, C);
    assert.equal(state.chekhov.bullets.length, 0);
    assert.equal(state.chekhov.fired.length, 10);
    assert.deepEqual(state.chekhov.fired.at(-1), { id: "B1", desc: "B1", how: "pruned" });
});

test("over the cap, the lowest weight then oldest is pruned", () => {
    const s = emptyState();
    s.chekhov.bullets = Array.from({ length: 21 }, (_, k) => bullet(`B${k + 1}`, { weight: k === 4 ? 1 : 2, age: k === 4 ? 1 : 0 }));
    const { state } = postTurn(s, null, C);
    assert.equal(state.chekhov.bullets.length, 20);
    assert.ok(!state.chekhov.bullets.some(b => b.id === "B5"));
});

test("firedKeep 0 keeps every fired bullet", () => {
    const cfg = { ...C, sectionConfig: { ...C.sectionConfig, chekhov: { ...C.sectionConfig.chekhov, firedKeep: 0 } } };
    const s = emptyState();
    s.chekhov.fired = Array.from({ length: 30 }, (_, k) => ({ id: `B${k + 1}`, desc: "x", how: "y" }));
    assert.equal(postTurn(s, null, cfg).state.chekhov.fired.length, 30);
});

test("a hand-added bullet id is never reused", () => {
    const s = emptyState();
    s.chekhov.bullets = [bullet("B5")];
    assert.equal(postTurn(s, ch("Chekhov:\n- load: c (w1)"), C).state.chekhov.bullets[1].id, "B6");
});

test("chekhov round-trips, awkward descriptions and locks included", () => {
    const s = emptyState();
    s.chekhov.bullets = [bullet("B1", { desc: "a | b <c> & d", weight: 3, age: 7, hot: true, secret: true, lock: "CROWD | 3 present", at: { day: 4, minutes: 1080 }, after: "B2" }),
                         bullet("B3", { at: { day: null, minutes: 9 * 60 + 5 } })];
    s.chekhov.fired = [{ id: "B2", desc: "x", how: "it rang" }];
    assert.deepEqual(parseBlock(renderBlock(s, { rules: [], config: C, sections: {} }), { config: C }).state.chekhov, s.chekhov);
});

// ── eligibility, due bullets, facts ─────────────────────────────────────────
import { preTurnFacts } from "../src/model/turn.js";
import { hotCount } from "../src/model/sections/chekhov.js";

test("eligibility: age, locks, dependencies and the crowd rule for secrets", () => {
    const s = emptyState();
    s.scene.present = ["Mara", "Ana", "Bo"];
    s.chekhov.bullets = [bullet("B1", { age: 6 }), bullet("B2", { age: 5 }), bullet("B3", { age: 9, lock: "x" }),
                         bullet("B4", { age: 9, after: "B1" }), bullet("B5", { age: 9, secret: true })];
    const facts = preTurnFacts(s, C).join("\n");
    assert.match(facts, /Eligible to fire[^\n]*B1/);
    for (const id of ["B2", "B3", "B4", "B5"]) assert.doesNotMatch(facts, new RegExp(String.raw`Eligible[^\n]*\b${id}\b`));
});

test("a dependency unlocks once its bullet has fired", () => {
    const s = emptyState();
    s.chekhov.bullets = [bullet("B4", { age: 9, after: "B1" })];
    s.chekhov.fired = [{ id: "B1", desc: "x", how: "y" }];
    assert.match(preTurnFacts(s, C).join("\n"), /Eligible[^\n]*B4/);
});

test("a due bullet is announced and never pruned", () => {
    const s = emptyState();
    s.scene.now = "Day 4 — 18:30";
    s.chekhov.bullets = [bullet("B4", { desc: "Ana's shift ends", age: 30, at: { day: 4, minutes: 1080 } })];
    assert.match(preTurnFacts(s, C).join("\n"), /Due now: B4 "Ana's shift ends"/);
    assert.equal(postTurn(s, null, C).state.chekhov.bullets.length, 1);
});

test("in fate mode the eligible list is not offered to the model", () => {
    const cfg = { ...C, sectionConfig: { ...C.sectionConfig, chekhov: { ...C.sectionConfig.chekhov, firing: "fate" } } };
    const s = emptyState();
    s.chekhov.bullets = [bullet("B1", { age: 6 })];
    assert.doesNotMatch(preTurnFacts(s, cfg).join("\n"), /Eligible/);
});

test("hotCount counts loaded hot bullets", () => {
    const s = emptyState();
    s.chekhov.bullets = [bullet("B1", { hot: true }), bullet("B2"), bullet("B3", { hot: true })];
    assert.equal(hotCount(s), 2);
});

test("the prompt lists active bullets with their state; the template offers the load/fire lines", async () => {
    const { renderStatePrompt, buildTemplate } = await import("../src/model/prompt.js");
    const { emptyNotebook } = await import("../src/model/notebook.js");
    const s = emptyState();
    s.chekhov.bullets = [bullet("B2", { desc: "the letter", weight: 2, age: 6, hot: true })];
    assert.match(renderStatePrompt(s, { notebook: emptyNotebook(), config: C, sections: {} }), /B2 the letter · w2 · age 6\/12 · hot · eligible/);
    assert.match(buildTemplate(C), /Chekhov:\n- \[load: /);
});
