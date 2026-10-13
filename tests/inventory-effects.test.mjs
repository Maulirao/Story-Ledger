// 🎒 Titles and conditions as entries with effect rows. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { entryNames, normalizeInv } from "../src/model/sections/inventory.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const S = () => { const s = emptyState(); s.inv.titles = [{ name: "Mon Ancre", effects: [{ kind: "numeric", n: 2, category: "social", focus: "Emilia" }], hint: "" }, { name: "Undefeated Charioteer", effects: [], hint: "passive +1 to all carry momentum checks" }]; s.inv.status = [{ name: "Soaked", effects: [], hint: "" }]; return s; };
const block = s => renderBlock(s, { rules: [], config: C, sections: {} });
// The empty-inventory rows of a block replaced by `rows`.
const withRows = rows => block(emptyState()).replace(/- <b>Inv:<\/b>[^\n]*\n[\s\S]*?- <b>Mods:<\/b>[^\n]*/, `- <b>Inv:</b> —\n${rows}`);

test("title and condition rows render", () => {
    const out = block(S());
    assert.match(out, /<b>Title:<\/b> Mon Ancre \| \+2 social: Emilia/);
    assert.match(out, /<b>Title:<\/b> Undefeated Charioteer \| needs effect — old: passive \+1 to all carry momentum checks/);
    assert.match(out, /<b>Condition:<\/b> Soaked\n/);
    assert.match(out, /<b>Mods:<\/b> physical — · social \+2 · mental —/);
});
test("rows round-trip", () => assert.deepEqual(parseBlock(block(S()), { config: C }).state.inv, S().inv));
test("names with parentheses and pipes round-trip", () => {
    const s = emptyState(); s.inv.titles = [{ name: "Bitten (First)", effects: [], hint: "" }, { name: "a | b", effects: [{ kind: "proficiency", skill: "x" }], hint: "" }];
    assert.deepEqual(parseBlock(block(s), { config: C }).state.inv.titles, s.inv.titles);
});
test("effects with semicolons and markup round-trip", () => {
    const s = emptyState();
    s.inv.titles = [{ name: "Diver <b>", effects: [{ kind: "numeric", n: 1, category: "physical", focus: "swimming; diving" }, { kind: "narrative", text: "holds breath & waits" }], hint: "" }];
    s.inv.status = [{ name: "Legs spent", effects: [{ kind: "numeric", n: -2, category: "physical", focus: "running" }], hint: "" }];
    const out = block(s);
    assert.match(out, /<b>Title:<\/b> Diver &lt;b&gt; \| \+1 physical: swimming&#59; diving; holds breath &amp; waits/);
    assert.match(out, /<b>Mods:<\/b> physical \+1 · social — · mental —/);   // penalties not summed
    assert.deepEqual(parseBlock(out, { config: C }).state.inv, s.inv);
});
test("a sum over the hard cap notes the cap", () => {
    const s = emptyState();
    s.inv.titles = ["A", "B", "C", "D"].map(name => ({ name, effects: [{ kind: "numeric", n: 2, category: "social", focus: "" }], hint: "" }));
    assert.match(block(s), /<b>Mods:<\/b> physical — · social \+8 raw \(capped \+6 per roll\) · mental —/);
});
test("legacy Titles/Skills and Status rows still read; Mods row ignored", () => {
    const inv = parseBlock(withRows("- <b>Titles/Skills:</b> Charmer; Harbour Friend\n- <b>Status:</b> Tired\n- <b>Mods:</b> +30 Emilia (capped)"), { config: C }).state.inv;
    assert.deepEqual(entryNames(inv.titles), ["Charmer", "Harbour Friend"]);
    assert.deepEqual(entryNames(inv.status), ["Tired"]);
    assert.equal("mods" in inv, false);
});
test("mixed new rows and legacy paste merge", () => {
    const r = parseBlock(withRows("- <b>Title:</b> Mon Ancre | +2 social: Emilia\n- <b>Titles/Skills:</b> Mon Ancre, Royal Chariot"), { config: C });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.state.inv.titles, [
        { name: "Mon Ancre", effects: [{ kind: "numeric", n: 2, category: "social", focus: "Emilia" }], hint: "" },
        { name: "Royal Chariot", effects: [], hint: "" },
    ]);
});
test("older string state normalises", () => {
    const inv = normalizeInv({ items: [], titles: ["Charmer"], status: ["Tired"], mods: "+1 social" });
    assert.deepEqual(inv, { items: [], titles: [{ name: "Charmer", effects: [], hint: "" }], status: [{ name: "Tired", effects: [], hint: "" }] });
});
test("an older string state renders as entry rows", () => {
    const s = emptyState(); s.inv = { items: [], titles: ["Charmer"], status: ["Tired"], mods: "+1 social" };
    const out = block(s);
    assert.match(out, /<b>Title:<\/b> Charmer \| needs effect\n/);
    assert.match(out, /<b>Condition:<\/b> Tired\n/);
    assert.doesNotMatch(out, /\+1 social/);
});

// ── Task 4: commands carry effects
import { postTurn } from "../src/model/turn.js";
import { parseChanges } from "../src/model/changes.js";
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const run = (s, body) => postTurn(s, ch(`Inventory:\n${body}`), C);
const invWarnings = r => r.warnings.filter(w => w.section === "Inventory");
test("title: Name | effects adds, and replaces effects on an existing title", () => {
    let r = run(emptyState(), "- title: Strong Swimmer | +2 physical: swimming");
    r = run(r.state, "- title: strong swimmer | +1 physical: swimming; proficiency: diving");
    assert.deepEqual(r.state.inv.titles, [{ name: "Strong Swimmer", effects: [{ kind: "numeric", n: 1, category: "physical", focus: "swimming" }, { kind: "proficiency", skill: "diving" }], hint: "" }]);
});
test("filling a needs-effect title clears its hint", () => {
    const s = emptyState(); s.inv.titles = [{ name: "Undefeated Charioteer", effects: [], hint: "passive +1" }];
    assert.deepEqual(run(s, "- title: Undefeated Charioteer | +1 physical: carrying").state.inv.titles[0].hint, "");
});
test("title without effects is accepted with a warning", () => {
    const r = run(emptyState(), "- title: Charmer");
    assert.deepEqual(entryNames(r.state.inv.titles), ["Charmer"]);
    assert.match(invWarnings(r)[0].text, /needs an effect/);
});
test("a refused number warns and keeps the other effects", () => {
    const r = run(emptyState(), "- title: X | +5 social: Emilia; proficiency: y");
    assert.deepEqual(r.state.inv.titles[0].effects, [{ kind: "proficiency", skill: "y" }]);
    assert.equal(invWarnings(r).length, 1);
});
test("status + with effects; semicolon recap still adds several without |", () => {
    let r = run(emptyState(), "- status + Legs spent | -2 physical: running, swimming");
    assert.deepEqual(r.state.inv.status[0].effects, [{ kind: "numeric", n: -2, category: "physical", focus: "running, swimming" }]);
    r = run(r.state, "- status + Tired; Hungry");
    assert.deepEqual(entryNames(r.state.inv.status), ["Legs spent", "Tired", "Hungry"]);
});
test("mods: changes nothing and explains why", () => {
    const r = run(emptyState(), "- mods: +1 social");
    assert.equal("mods" in r.state.inv, false);
    assert.match(invWarnings(r)[0].text, /computed from title and condition effects/);
});
test("duplicate Condition rows merge on parse", () => {
    const r = parseBlock(withRows("- <b>Condition:</b> Soaked\n- <b>Condition:</b> Soaked | -1 physical: running"), { config: C });
    assert.deepEqual(r.state.inv.status, [{ name: "Soaked", effects: [{ kind: "numeric", n: -1, category: "physical", focus: "running" }], hint: "" }]);
});
test("an empty Title or Condition row is a silent no-op", () => {
    const base = emptyState(); base.inv.items = ["key"]; base.inv.money = { USD: "5" };
    const r = parseBlock(withRows("- <b>Item I1:</b> key\n- <b>Title:</b>\n- <b>Condition:</b> "), { config: C });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.state.inv.titles, []);
    assert.deepEqual(r.state.inv.status, []);
});
