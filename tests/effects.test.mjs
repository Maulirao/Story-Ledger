import test from "node:test";
import assert from "node:assert/strict";
import { parseEffects, formatEffects, readLegacyList, capBonus } from "../src/model/effects.js";

test("numeric, proficiency and narrative effects", () => {
    const r = parseEffects("+2 social: Emilia; proficiency: diving; holds breath for three minutes");
    assert.deepEqual(r.effects, [
        { kind: "numeric", n: 2, category: "social", focus: "Emilia" },
        { kind: "proficiency", skill: "diving" },
        { kind: "narrative", text: "holds breath for three minutes" }]);
    assert.deepEqual(r.warnings, []);
});
test("colonless and capitalised categories are numeric", () => {
    assert.deepEqual(parseEffects("+2 Social Emilia").effects, [{ kind: "numeric", n: 2, category: "social", focus: "Emilia" }]);
    assert.deepEqual(parseEffects("−2 physical: running, swimming").effects, [{ kind: "numeric", n: -2, category: "physical", focus: "running, swimming" }]);
});
test("out-of-range numbers are refused and unknown categories warn", () => {
    const big = parseEffects("+3 social: Emilia; proficiency: x");
    assert.deepEqual(big.effects, [{ kind: "proficiency", skill: "x" }]);
    assert.equal(big.warnings.length, 1);
    const odd = parseEffects("+1 magic Emilia");
    assert.deepEqual(odd.effects, [{ kind: "narrative", text: "+1 magic Emilia" }]);
    assert.match(odd.warnings[0], /unknown category/);
});

test("emotional, comedy and trust bonuses normalize to social with their focus retained", () => {
    const r = parseEffects("+2 Emotional: Emilia; −1 comedy Gilles; +1 trust; +1 social: friends");
    assert.deepEqual(r.effects, [
        { kind: "numeric", n: 2, category: "social", focus: "emotional, Emilia" },
        { kind: "numeric", n: -1, category: "social", focus: "comedy, Gilles" },
        { kind: "numeric", n: 1, category: "social", focus: "trust" },
        { kind: "numeric", n: 1, category: "social", focus: "friends" },
    ]);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.complete, true);
    assert.equal(formatEffects(r.effects), "+2 social: emotional, Emilia; -1 social: comedy, Gilles; +1 social: trust; +1 social: friends");
});

test("social aliases obey the same numeric limits as canonical categories", () => {
    const r = parseEffects("+3 comedy: Emilia; +0 trust; -4 emotional");
    assert.deepEqual(r.effects, []);
    assert.equal(r.warnings.length, 3);
    assert.ok(r.warnings.every(w => /out of range/.test(w)));
});

test("intimacy bonuses use social checks and preserve their focus", () => {
    const r = parseEffects("+2 intimacy: Emilia; -1 INTIMACY; +3 intimacy: Gilles");
    assert.deepEqual(r.effects, [
        { kind: "numeric", n: 2, category: "social", focus: "intimacy, Emilia" },
        { kind: "numeric", n: -1, category: "social", focus: "intimacy" },
    ]);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /out of range/);
});
test("formatEffects writes the canonical form", () => {
    assert.equal(formatEffects(parseEffects("+2 social Emilia;+1 mental").effects), "+2 social: Emilia; +1 mental");
});
test("a literal semicolon round-trips as &#59;", () => {
    const r = parseEffects("a&#59; b; +1 mental");
    assert.equal(r.effects[0].text, "a; b");
    assert.equal(formatEffects(r.effects), "a&#59; b; +1 mental");
});
test("complete is true only for numeric/proficiency pieces", () => {
    assert.equal(parseEffects("+1 mental; proficiency: x").complete, true);
    assert.equal(parseEffects("+1 mental; flavour").complete, false);
});
test("legacy list: FF commas, parenthetical effects, hints, names", () => {
    const { entries } = readLegacyList("Mon Ancre (+2 social Emilia), Bon Garçon (+1 social Sofia, +1 social Gilles), Got Your Nose (+1 comedy Emilia), Bitten (First), Daily Brusher (contracted)");
    assert.deepEqual(entries.map(e => [e.name, formatEffects(e.effects), e.hint]), [
        ["Mon Ancre", "+2 social: Emilia", ""],
        ["Bon Garçon", "+1 social: Sofia; +1 social: Gilles", ""],
        ["Got Your Nose", "+1 social: comedy, Emilia", ""],
        ["Bitten (First)", "", ""],
        ["Daily Brusher (contracted)", "", ""]]);
});
test("legacy list: Story Ledger semicolons keep commas in names", () => {
    assert.deepEqual(readLegacyList("Bruised, left arm; Tired").entries.map(e => e.name), ["Bruised, left arm", "Tired"]);
});
test("legacy list: junk dropped and duplicates merged (the user's real paste)", () => {
    const r = readLegacyList("Royal Chariot, Chief of Staff, + NEW: Undefeated Charioteer (passive +1 to all carry momentum checks), Undefeated Charioteer (twice verified), + Casino Architect (earned — constructed a bet that cannot be won), all prior, The Forklift, The Forklift");
    assert.deepEqual(r.entries.map(e => [e.name, e.hint]), [
        ["Royal Chariot", ""], ["Chief of Staff", ""],
        ["Undefeated Charioteer", "passive +1 to all carry momentum checks"],
        ["Casino Architect (earned — constructed a bet that cannot be won)", ""],
        ["The Forklift", ""]]);
    assert.deepEqual(r.dropped, ["all prior"]);
});
test("legacy list: a plain name absorbs a parenthesised duplicate", () => {
    assert.deepEqual(readLegacyList("Casino Architect, Casino Architect (earned — x)").entries.map(e => e.name), ["Casino Architect"]);
});
test("legacy list: prefix, pipe and label junk", () => {
    const r = readLegacyList("all prior + Casino Architect | Status: Fed (crêpes)");
    assert.deepEqual(r.entries.map(e => e.name), ["Casino Architect"]);
    assert.deepEqual(r.dropped, ["all prior", "Status: Fed (crêpes)"]);
});
test("legacy list: Mods label and 'all previous' prefix", () => {
    const r = readLegacyList("all previous + A, Mods: +1 Emilia");
    assert.deepEqual(r.entries.map(e => e.name), ["A"]);
    assert.deepEqual(r.dropped, ["all previous", "Mods: +1 Emilia"]);
});
test("capBonus: soft then hard cap", () => {
    const c = { softCap: 3, hardCap: 6 };
    assert.deepEqual([3, 4, 5, 7, 30].map(n => capBonus(n, c)), [
        { value: 3, cap: "" }, { value: 3, cap: "soft cap" }, { value: 4, cap: "soft cap" },
        { value: 5, cap: "soft cap" }, { value: 6, cap: "hard cap" }]);
});
test("zero bonuses are refused with a warning", () => {
    const r = parseEffects("+0 social: x; proficiency: y");
    assert.deepEqual(r.effects, [{ kind: "proficiency", skill: "y" }]);
    assert.equal(r.warnings.length, 1);
    assert.equal(parseEffects("-0 mental").effects.length, 0);
});

// ── final review fixes ──
import { mergeEntries } from "../src/model/effects.js";
const E = (name, extra = {}) => ({ name, effects: [], hint: "", ...extra });
const ONE = [{ kind: "numeric", n: 1, category: "physical", focus: "" }];
test("mergeEntries: exact names merge; base names only when loose and one side is the base", () => {
    assert.deepEqual(mergeEntries([E("The Forklift"), E("the forklift")]).map(e => e.name), ["The Forklift"]);
    assert.deepEqual(mergeEntries([E("Casino Architect"), E("Casino Architect (earned)")]).map(e => e.name), ["Casino Architect", "Casino Architect (earned)"]);
    assert.deepEqual(mergeEntries([E("Casino Architect"), E("Casino Architect (earned)")], { loose: () => true }).map(e => e.name), ["Casino Architect"]);
    assert.deepEqual(mergeEntries([E("Casino Architect (earned)"), E("Casino Architect", { effects: ONE })], { loose: () => true }),
        [{ name: "Casino Architect", effects: ONE, hint: "" }]);
    assert.deepEqual(mergeEntries([E("Bitten (First)"), E("Bitten (Second)", { effects: ONE })], { loose: () => true }).map(e => e.name), ["Bitten (First)", "Bitten (Second)"]);
});
test("legacy list: parenthetical-only siblings stay apart", () => {
    assert.deepEqual(readLegacyList("Bitten (First), Bitten (Second), Bitten (First)").entries.map(e => e.name), ["Bitten (First)", "Bitten (Second)"]);
});
test("legacy list: everything after a Status: or Mods: piece is dropped", () => {
    const r = readLegacyList("Casino Architect | Status: Fed; legs spent (-2 for Buoy Race); bite marks");
    assert.deepEqual(r.entries.map(e => e.name), ["Casino Architect"]);
    assert.deepEqual(r.dropped, ["Status: Fed", "legs spent (-2 for Buoy Race)", "bite marks"]);
    const p = readLegacyList("A, + Status: x, B");
    assert.deepEqual(p.entries.map(e => e.name), ["A"]);
    assert.deepEqual(p.dropped, ["Status: x", "B"]);
});
