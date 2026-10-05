// Final-review fixes for phase 3. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig, sanitizeChekhov } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn, preTurnFacts } from "../src/model/turn.js";
import { parseStoryTime } from "../src/model/storytime.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const bullet = (id, more = {}) => ({ id, desc: id, weight: 1, age: 0, hot: false, secret: false, lock: "", at: null, after: "", ...more });

test("a dayless 'at 09:00' loaded at 10:00 waits for the clock to pass midnight", () => {
    let s = emptyState();
    s.scene.now = "Tuesday, 10:00";
    s = postTurn(s, ch("Chekhov:\n- load: the delivery (w1, at 09:00)"), C).state;
    assert.doesNotMatch(preTurnFacts(s, C).join("\n"), /Due now/);
    s = postTurn(s, ch("Now: Tuesday, 23:00"), C).state;
    assert.doesNotMatch(preTurnFacts(s, C).join("\n"), /Due now/);
    s = postTurn(s, ch("Now: Wednesday, 01:00"), C).state;
    assert.doesNotMatch(preTurnFacts(s, C).join("\n"), /Due now/);
    s = postTurn(s, ch("Now: Wednesday, 09:15"), C).state;
    assert.match(preTurnFacts(s, C).join("\n"), /Due now: B1/);
    s = postTurn(s, ch("Now: Thursday, 00:30"), C).state;
    assert.match(preTurnFacts(s, C).join("\n"), /(Due now|Overdue): B1/, "once due it stays due until fired");
    const back = parseBlock(renderBlock(s, { rules: [], config: C, sections: {} }), { config: C }).state;
    assert.deepEqual(back.chekhov.bullets[0].at, s.chekhov.bullets[0].at);
});

test("a lock with a day is not due when the Now line has no day", () => {
    const s = emptyState();
    s.scene.now = "11:00 the lawn";
    s.chekhov.bullets = [bullet("B1", { at: { day: 4, minutes: 540 } })];
    assert.doesNotMatch(preTurnFacts(s, C).join("\n"), /Due now/);
});

test("an after-dependency is satisfied once its target is no longer an active bullet; unlock clears it", () => {
    const s = emptyState();
    s.chekhov.bullets = [bullet("B4", { age: 9, after: "B1" }), bullet("B5", { age: 9, after: "B9" }), bullet("B6", { age: 2, after: "B7" }), bullet("B7")];
    assert.match(preTurnFacts(s, C).join("\n"), /Eligible[^\n]*B4[^\n]*B5|Eligible[^\n]*B5[^\n]*B4/);
    const r = postTurn(s, ch("Chekhov:\n- unlock B6"), C).state;
    assert.equal(r.chekhov.bullets.find(b => b.id === "B6").after, "");
});

test("'at noon' and 'at midnight' parse; a bad time keeps the setup without a lock and warns", () => {
    assert.deepEqual(parseStoryTime("Day 2, noon"), { day: 2, minutes: 720 });
    assert.deepEqual(parseStoryTime("midnight"), { day: null, minutes: 0 });
    const s = emptyState();
    s.scene.now = "Day 2 — 09:00";
    const r = postTurn(s, ch("Chekhov:\n- load: the letter (w2, at noon)\n- load: the bell (w1, at sometime later)"), { ...C, sectionConfig: { ...C.sectionConfig, chekhov: { ...C.sectionConfig.chekhov, maxLoadsPerTurn: 2 } } });
    assert.deepEqual(r.state.chekhov.bullets[0].at.minutes, 720);
    assert.equal(r.state.chekhov.bullets[1].at, null);
    assert.equal(r.warnings.length, 1);
});

test("Chekhov settings: blanks keep the old value, minimums hold, prune age stays above eligible age", () => {
    const prev = resolveConfig().sectionConfig.chekhov;
    assert.deepEqual(sanitizeChekhov({ eligibleAge: "", pruneAge: "0", cap: "0", maxLoadsPerTurn: "0", firedKeep: "0", firing: "model" }, prev),
        { eligibleAge: 6, pruneAge: 7, cap: 1, maxLoadsPerTurn: 1, firedKeep: 0, firing: "model" });
    assert.equal(sanitizeChekhov({ eligibleAge: "8", pruneAge: "5" }, prev).pruneAge, 9);
});

import { rewriteNewestSection } from "../src/model/turn.js";
import { setSend } from "../src/model/sections/quests.js";

test("the Quests tab refuses to rewrite a block whose rows it cannot read, and says why", () => {
    const s = emptyState();
    s.quests = [{ id: "Q1", kind: "Main", status: "done", objective: "a", progress: "", reward: "", send: false }];
    const good = `p\n\n${renderBlock(s, { rules: [], config: C, sections: {} })}`;
    const ok = rewriteNewestSection([{ mes: good }], 1, C, "quests", st => setSend(st, ["Q1"], true));
    assert.equal(ok.status, "ok");
    assert.match(ok.mes, /done · sent/);
    const broken = good.replace("<b>Q1 Main</b> | done | Objective: a", "<b>Q1 Main</b> | done | find the dog");
    const bad = rewriteNewestSection([{ mes: broken }], 1, C, "quests", st => setSend(st, ["Q1"], true));
    assert.equal(bad.status, "unreadable");
    assert.equal(bad.errors.length, 1);
    assert.equal(rewriteNewestSection([{ mes: "no block" }], 1, C, "quests", () => {}).status, "noblock");
    const noQuests = `p\n\n${renderBlock(s, { rules: [], config: { ...C, sections: { quests: false } }, sections: { quests: false } })}`;
    assert.equal(rewriteNewestSection([{ mes: noQuests }], 1, C, "quests", () => {}).status, "nosection");
});
