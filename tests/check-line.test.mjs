// 🎲 Verified DnD check lines: named sources, caps, total and outcome. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { postTurn } from "../src/model/turn.js";
import { parseCheckLine, verifyCheck, outcomeBand } from "../src/model/check-line.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);

const inv = { items: [], titles: [
    { name: "Got Your Nose", effects: [{ kind: "numeric", n: 1, category: "social", focus: "comedy, Emilia" }], hint: "" },
    { name: "Mon Ancre", effects: [{ kind: "numeric", n: 2, category: "social", focus: "Emilia" }], hint: "" },
    { name: "Love of Her Life", effects: [{ kind: "numeric", n: 2, category: "social", focus: "Emilia" }], hint: "" }],
    status: [{ name: "Legs spent", effects: [{ kind: "numeric", n: -2, category: "physical", focus: "running" }], hint: "" }] };
const caps = { softCap: 3, hardCap: 6, situationalMax: 2 };
const v = (line, die) => verifyCheck(parseCheckLine(line), { die, inv, user: "Jan", caps });

test("a correct capped line verifies", () => {
    const r = v("Jan, makes Emilia laugh · social · DC 8 · d20 11 + Got Your Nose +1 + Mon Ancre +2 + Love of Her Life +2 = +5 → +4 (soft cap) · total 15 · success", 11);
    assert.deepEqual(r, { ok: true, problems: [], ledgerLine: "" });
});
test("each failure kind is named", () => {
    const cases = [
        ["Jan, x · social · DC 8 · d20 12 + Mon Ancre +2 = +2 · total 14 · success", 11, /die/],
        ["Jan, x · social · DC 8 · d20 11 + Mon Ancre +1 = +1 · total 12 · success", 11, /Mon Ancre/],
        ["Jan, x · physical · DC 8 · d20 11 + Mon Ancre +2 = +2 · total 13 · success", 11, /category/],
        ["Jan, x · social · DC 8 · d20 11 + Ghost Title +2 = +2 · total 13 · success", 11, /Ghost Title/],
        ["Jan, x · social · DC 8 · d20 11 + Mon Ancre +2 = +2 · total 14 · success", 11, /total/],
        ["Jan, x · social · DC 15 · d20 11 + Mon Ancre +2 = +2 · total 13 · success", 11, /outcome/],
    ];
    for (const [line, die, re] of cases) { const r = v(line, die); assert.equal(r.ok, false, line); assert.ok(r.problems.some(p => re.test(p)), line); assert.match(r.ledgerLine, /^↳ ledger: /); }
});
test("penalties are uncapped and situational is limited", () => {
    assert.equal(v("Jan, sprints · physical · DC 10 · d20 12 + Legs spent -2 + situational +1 (tailwind) = -1 · total 11 · success", 12).ok, true);
    assert.equal(v("Jan, sprints · physical · DC 10 · d20 12 + situational +3 (x) = +3 · total 15 · success", 12).ok, false);
});
test("old unnamed +m on the user's line warns", () => {
    const r = v("Jan, picks the lock · DC 12 · d20 14 +2 · success", 14);
    assert.ok(r.problems.some(p => /no named source/.test(p)));
});
test("non-user actor lines check only die, arithmetic and outcome", () => {
    assert.equal(v("Emilia, dodges · DC 10 · d20 9 +2 · success", 9).ok, true);
    assert.equal(v("Emilia, dodges · DC 10 · d20 9 + Her Reflexes +2 = +2 · total 11 · success", 9).ok, true);
});
test("user line requires a category", () => assert.ok(v("Jan, x · DC 8 · d20 11 + Mon Ancre +2 = +2 · total 13 · success", 11).problems.some(p => /category/.test(p))));
test("through postTurn: ledger line appended and Check warning raised", () => {
    const cfg = { ...C, dice: { checks: [11] } }; const s = emptyState(); s.inv = structuredClone(inv);
    const r = postTurn(s, ch("Check:\n- Jan, x · social · DC 8 · d20 11 + Mon Ancre +1 = +1 · total 12 · success"), cfg);
    assert.equal(r.state.perTurn.checks.lines.length, 2);
    assert.match(r.state.perTurn.checks.lines[1], /^↳ ledger: /);
    assert.ok(r.warnings.some(w => w.section === "Check"));
});
test("more check lines than dice warns once per extra line", () => {
    const cfg = { ...C, dice: { checks: [11] } };
    const r = postTurn(emptyState(), ch("Check:\n- Emilia, a · DC 5 · d20 11 · total 11 · success\n- Emilia, b · DC 5 · d20 7 · total 7 · success"), cfg);
    assert.equal(r.warnings.filter(w => w.section === "Check" && /no die/.test(w.text)).length, 1);
});
test("Wind's Arrow lines are not verified", () => {
    const r = postTurn(emptyState(), ch("Check:\n- Mara, leaps · d20 11 +1 · Grazing Shot · drops her lantern"), { ...C, checkStyle: "arrow", dice: { checks: [4] } });
    assert.equal(r.warnings.filter(w => w.section === "Check").length, 0);
});

// ── beyond the brief: edges of the grammar and the arithmetic ──
test("outcome bands follow the delta and the natural die", () => {
    assert.equal(outcomeBand(10, 8), "crit success");
    assert.equal(outcomeBand(20, -10), "crit success");
    assert.equal(outcomeBand(10, 7), "success");
    assert.equal(outcomeBand(10, 0), "success");
    assert.equal(outcomeBand(10, -1), "near miss");
    assert.equal(outcomeBand(10, -3), "near miss");
    assert.equal(outcomeBand(10, -4), "failure");
    assert.equal(outcomeBand(10, -7), "failure");
    assert.equal(outcomeBand(10, -8), "crit failure");
    assert.equal(outcomeBand(1, 12), "crit failure");
});
test("the parse reads every field", () => {
    assert.deepEqual(parseCheckLine("Jan, makes Emilia laugh · social · DC 8 · d20 11 + Got Your Nose +1 + Legs spent −2 + situational +1 (her joke) = +0 · total 11 · Crit Success"), {
        actor: "Jan", action: "makes Emilia laugh", category: "social", dc: 8, d20: 11,
        sources: [{ name: "Got Your Nose", n: 1 }, { name: "Legs spent", n: -2 }], situational: { n: 1, why: "her joke" },
        legacyMod: null, raw: 0, capped: null, total: 11, outcome: "Crit Success",
    });
    const legacy = parseCheckLine("Mara, picks the lock · DC 12 · d20 14 +2 · success");
    assert.equal(legacy.legacyMod, 2); assert.equal(legacy.total, null); assert.deepEqual(legacy.sources, []);
    assert.equal(parseCheckLine("not a check"), null);
    assert.equal(parseCheckLine("Mara, leaps · d20 11 +1 · Grazing Shot · drops her lantern"), null);
});
test("a missing cap is flagged and the ledger line shows it", () => {
    const r = v("Jan, x · social · DC 8 · d20 11 + Got Your Nose +1 + Mon Ancre +2 + Love of Her Life +2 = +5 · total 16 · crit success", 11);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some(p => /cap/.test(p)));
    assert.equal(r.ledgerLine, "↳ ledger: d20 11 + Got Your Nose +1 + Mon Ancre +2 + Love of Her Life +2 = +5 → +4 (soft cap) · total 15 · success");
});
test("either cap label is accepted when the number is right", () => {
    assert.equal(v("Jan, x · social · DC 8 · d20 11 + Got Your Nose +1 + Mon Ancre +2 + Love of Her Life +2 = +5 → +4 (hard cap) · total 15 · success", 11).ok, true);
});
test("a line may omit the sum", () => {
    assert.equal(v("Jan, x · social · DC 8 · d20 11 + Mon Ancre +2 · total 13 · success", 11).ok, true);
    assert.equal(v("Jan, x · social · DC 8 · d20 11 · total 11 · success", 11).ok, true);
});
test("a wrong sum is named", () => {
    const r = v("Jan, x · social · DC 8 · d20 11 + Mon Ancre +2 = +3 · total 14 · success", 11);
    assert.ok(r.problems.some(p => /\+3/.test(p) && /\+2/.test(p)));
});
test("a title named twice counts once", () => {
    const r = v("Jan, x · social · DC 8 · d20 11 + Mon Ancre +2 + Mon Ancre +2 = +4 → +3 (soft cap) · total 14 · success", 11);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some(p => /twice/.test(p)));
    assert.match(r.ledgerLine, /total 13/);
});
test("{{user}} and case-folded names are the user", () => {
    assert.equal(v("{{user}}, x · social · DC 8 · d20 11 + mon ancre +2 = +2 · total 13 · success", 11).ok, true);
    assert.equal(v("jan, x · social · DC 8 · d20 11 + Ghost +2 = +2 · total 13 · success", 11).ok, false);
});
test("unknown category on a user line is named", () => {
    assert.ok(v("Jan, x · stealth · DC 8 · d20 11 · total 11 · success", 11).problems.some(p => /category/.test(p)));
});
test("an unread line is kept without a ledger line or warning", () => {
    const r = postTurn(emptyState(), ch("Check:\n- Jan tries something odd"), { ...C, dice: { checks: [11] } });
    assert.deepEqual(r.state.perTurn.checks.lines, ["Jan tries something odd"]);
    assert.equal(r.warnings.filter(w => w.section === "Check").length, 0);
});
test("the check rules state the configured caps", async () => {
    const { renderRules } = await import("../src/model/prompt.js");
    const cfg = resolveConfig({ sectionConfig: { titles: { softCap: 4, hardCap: 7, situationalMax: 1 } } });
    const text = renderRules(cfg);
    assert.match(text, /\+4/); assert.match(text, /\+7/); assert.match(text, /situational ±n \(why\)/); assert.match(text, /±1/);
});
