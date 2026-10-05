// Follow-up fixes before phase 4. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, replaceSectionRows } from "../src/model/block.js";
import { postTurn, preTurnFacts, withClockOverride } from "../src/model/turn.js";
import { lockTime } from "../src/model/storytime.js";
import { buildTemplate } from "../src/model/prompt.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const off = sections => ({ ...C, sections });
const bullet = (id, more = {}) => ({ id, desc: id, weight: 1, age: 0, hot: false, secret: false, lock: "", at: null, after: "", ...more });

test("switched-off core sections ignore their lines; the turn still advances", () => {
    const s = emptyState();
    s.scene.now = "Day 1";
    s.threads = ["keep"];
    const body = "Now: Day 9\nPublic: yes\nThreads:\n- + [T] new one\nRelationships:\n- NEW Mara → Jan: E 8, M 3, L 6, Er 3, Ph 9, Ec 3, Pr 5, St 3, Sg 4, Ad 3, Ag 6, Pt 3 | Φ 4 (x)";
    const { state } = postTurn(s, ch(body), off({ scene: false, notebook: false, relationships: false }));
    assert.equal(state.scene.now, "Day 1");
    assert.equal(state.scene.public, false);
    assert.deepEqual(state.threads, ["keep"]);
    assert.deepEqual(state.rel.pairs, {});
    assert.equal(state.ct, 1);
});

test("a reader's clock correction newer than the block is the time due checks use", () => {
    const s = emptyState();
    s.scene.now = "Day 1 — 17:00";
    s.chekhov.bullets = [bullet("B1", { at: { day: 1, minutes: 18 * 60 } })];
    const corrected = withClockOverride(s, { text: "Day 1 — 19:00", atLength: 5 }, 3);
    assert.equal(corrected.scene.now, "Day 1 — 19:00");
    assert.match(preTurnFacts(corrected, C).join("\n"), /Due now: B1/);
    assert.equal(withClockOverride(s, { text: "x", atLength: 2 }, 3).scene.now, "Day 1 — 17:00", "an older correction is superseded by the block");
    assert.equal(withClockOverride(s, null, 3), s);
});

test("Chekhov keeps Present in the block and template even with Scene, Cast, Agendas and Locations off", () => {
    const cfg = off({ scene: false, cast: false, agendas: false, locations: false });
    assert.match(buildTemplate(cfg), /\nPresent:/);
    const s = emptyState();
    s.scene.present = ["Mara", "Ana", "Bo"];
    assert.match(renderBlock(s, { rules: [], config: cfg, sections: cfg.sections }), /<b>Present:<\/b> Mara, Ana, Bo/);
});

test("the block's eligible tag respects the crowd rule for secrets", () => {
    const s = emptyState();
    s.scene.present = ["Mara", "Ana", "Bo"];
    s.chekhov.bullets = [bullet("B1", { age: 9, secret: true }), bullet("B2", { age: 9 })];
    const txt = renderBlock(s, { rules: [], config: C, sections: {} });
    assert.doesNotMatch(txt, /<b>B1<\/b>[^\n]*eligible/);
    assert.match(txt, /<b>B2<\/b>[^\n]*eligible/);
});

test("capacity pruning never takes a due or locked setup; it warns when those alone exceed the cap", () => {
    const cfg = { ...C, sectionConfig: { ...C.sectionConfig, chekhov: { ...C.sectionConfig.chekhov, cap: 2 } } };
    const s = emptyState();
    s.scene.now = "Day 1 — 20:00";
    s.chekhov.bullets = [bullet("B1", { lock: "x" }), bullet("B2", { at: { day: 1, minutes: 60 } }), bullet("B3", { age: 5, weight: 3 })];
    let r = postTurn(s, null, cfg);
    assert.deepEqual(r.state.chekhov.bullets.map(b => b.id), ["B1", "B2"]);
    s.chekhov.bullets.push(bullet("B4", { lock: "y" }));
    r = postTurn(s, null, cfg);
    assert.equal(r.state.chekhov.bullets.filter(b => b.lock || b.at).length, 3);
    assert.ok(r.warnings.some(w => /cap/i.test(w.text)));
});

test("holds win over due: a manual lock, a dependency or a crowd keeps a reached setup from being due", () => {
    const s = emptyState();
    s.scene.now = "Day 1 — 20:00";
    s.scene.present = ["Mara", "Ana", "Bo"];
    const at = { day: 1, minutes: 18 * 60 };
    s.chekhov.bullets = [bullet("B1", { at, lock: "x" }), bullet("B2", { at, after: "B9" }), bullet("B9"), bullet("B3", { at, secret: true }), bullet("B4", { at })];
    const facts = preTurnFacts(s, C).join("\n");
    assert.match(facts, /Due now: B4/);
    for (const id of ["B1", "B2", "B3"]) assert.doesNotMatch(facts, new RegExp(String.raw`(Due now|Overdue): ${id}\b`));
});

test("a setup's first due turn is an instruction; after that it is a softer overdue reminder", () => {
    let s = emptyState();
    s.scene.now = "Day 1 — 20:00";
    s.chekhov.bullets = [bullet("B4", { desc: "the shift ends", at: { day: 1, minutes: 18 * 60 } })];
    assert.match(preTurnFacts(s, C).join("\n"), /Due now: B4 "the shift ends"[^\n]*fire it this turn/);
    s = postTurn(s, null, C).state;
    const again = preTurnFacts(s, C).join("\n");
    assert.match(again, /Overdue: B4 "the shift ends"/);
    assert.doesNotMatch(again, /fire it this turn/);
});

test("firing before eligibility names the actual hold", () => {
    const s = emptyState();
    s.scene.present = ["Mara", "Ana", "Bo"];
    s.chekhov.bullets = [bullet("B1", { age: 2 }), bullet("B2", { age: 9, lock: "CROWD" }), bullet("B3", { age: 9, secret: true }), bullet("B4", { age: 9, after: "B5" }), bullet("B5", { age: 9 })];
    const { warnings } = postTurn(s, ch("Chekhov:\n- fire B1: a\n- fire B2: b\n- fire B3: c\n- fire B4: d"), C);
    const text = warnings.map(w => w.text).join("\n");
    assert.match(text, /B1[^\n]*age 2/);
    assert.match(text, /B2[^\n]*held: CROWD/);
    assert.match(text, /B3[^\n]*secret[^\n]*crowd/i);
    assert.match(text, /B4[^\n]*waits for B5/);
});

test("a time equal to now is now; 'tomorrow' and 'today' win", () => {
    const now = { day: 3, minutes: 10 * 60 };
    assert.deepEqual(lockTime("10:00", now), { day: 3, minutes: 600 });
    assert.deepEqual(lockTime("6 pm tomorrow", now), { day: 4, minutes: 1080 });
    assert.deepEqual(lockTime("tomorrow at 9:00", now), { day: 4, minutes: 540 });
    assert.deepEqual(lockTime("09:00 today", now), { day: 3, minutes: 540 });
    assert.deepEqual(lockTime("6 pm tomorrow", { day: null, minutes: 600 }), { day: null, minutes: 1080, wait: true });
});

test("rewriting quests stays inside the block and keeps CRLF line endings", () => {
    const s = emptyState();
    s.quests = [{ id: "Q1", kind: "Main", status: "done", objective: "a", progress: "", reward: "", send: false }];
    const blk = renderBlock(s, { rules: [], config: C, sections: {} }).replace(/\n/g, "\r\n");
    const mes = `prose\r\n\r\n${blk}`;
    const out = replaceSectionRows(mes, /^QUESTS$/, ["- <b>Q1 Main</b> | done · sent | Objective: a | Progress: — | Reward: —"]);
    assert.doesNotMatch(out.replace(/\r\n/g, ""), /\n/);
    const noQuests = renderBlock(s, { rules: [], config: { ...C, sections: { quests: false } }, sections: { quests: false } });
    const after = `${noQuests}\n<details><summary>📜 QUESTS</summary>\n- not ours\n</details>`;
    assert.equal(replaceSectionRows(after, /^QUESTS$/, ["x"]), null);
});

test("Chekhov overrides are allowlisted and validated", () => {
    const c = resolveConfig({ sectionConfig: { chekhov: { cap: "abc", pruneAge: -4, firing: "chaos", bogus: 1, firedKeep: 0 } } });
    assert.deepEqual(c.sectionConfig.chekhov, { eligibleAge: 6, pruneAge: 12, cap: 20, maxLoadsPerTurn: 1, firedKeep: 0, firing: "model" });
});
