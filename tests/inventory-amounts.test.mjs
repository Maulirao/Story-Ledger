import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { postTurn, latestState } from "../src/model/turn.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { renderStatePrompt } from "../src/model/prompt.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const turn = (s, body) => postTurn(s, parseChanges(`<!-- Story_Ledger\nInventory:\n${body}\n-->`), C);
const block = s => renderBlock(s, { config: C, sections: {}, rules: [] });

test("money balances have no item IDs and spending preserves the remainder", () => {
    const first = turn(emptyState(), "- money: 50 USD\n- money: 20 CAD\n- + noteworthy $50 bill (serial ABC)");
    assert.deepEqual(first.unparsed, []);
    assert.deepEqual(first.state.inv.money, { USD: "50", CAD: "20" });
    assert.deepEqual(first.state.inv.itemIds, ["I1"]);
    const paid = turn(first.state, "- money - 18 USD (paid Tremblay)\n- money + 5 CAD (refund)");
    assert.deepEqual(paid.unparsed, []);
    assert.deepEqual(paid.state.inv.money, { USD: "32", CAD: "25" });
    assert.deepEqual(paid.state.inv.items, ["noteworthy $50 bill (serial ABC)"]);
    assert.deepEqual(first.state.inv.money, { USD: "50", CAD: "20" });
});

test("decimal balances and measured supplies use exact arithmetic", () => {
    const first = turn(emptyState(), "- money: $0.10\n- supply: 0.1 litres | drinking water");
    const next = turn(first.state, "- money + 0.2 $\n- I1 adjust: +0.2 (refilled)\n- money - 0.3 $\n- I1 adjust: -0.3 (drank)");
    assert.deepEqual(next.unparsed, []);
    assert.deepEqual(next.state.inv.money, { $: "0" });
    assert.deepEqual(next.state.inv.supplies, { I1: { amount: "0", unit: "litres" } });
    const refilled = turn(next.state, "- money + 1 $\n- I1 adjust: +1.25");
    assert.deepEqual(refilled.state.inv.money, { $: "1" });
    assert.deepEqual(refilled.state.inv.supplies, { I1: { amount: "1.25", unit: "litres" } });
});

test("money can omit the currency only when the balance is unambiguous", () => {
    const first = turn(emptyState(), "- money: 50\n- money - 18 (purchase)");
    assert.deepEqual(first.unparsed, []);
    assert.deepEqual(first.state.inv.money, { "": "32" });
    const one = turn(emptyState(), "- money: 50 USD\n- money - 18");
    assert.deepEqual(one.state.inv.money, { USD: "32" });
    const two = turn(emptyState(), "- money: 50 USD\n- money: 20 CAD").state;
    const ambiguous = turn(two, "- money - 18\n- money: 10");
    assert.deepEqual(ambiguous.state.inv.money, { USD: "50", CAD: "20" });
    assert.equal(ambiguous.unparsed.length, 2);
});

test("counted supplies preserve IDs through partial use, description changes, and replenishment", () => {
    const first = turn(emptyState(), "- supply: 12 rounds | 9mm ammunition\n- supply: 4 batteries | AA batteries");
    assert.deepEqual(first.unparsed, []);
    assert.deepEqual(first.state.inv.items, ["9mm ammunition", "AA batteries"]);
    assert.deepEqual(first.state.inv.itemIds, ["I1", "I2"]);
    const next = turn(first.state, "- I1 adjust: -3 (fired)\n- I2 adjust: -4 (used)\n- I1 update: 9mm ammunition (in backpack)");
    assert.deepEqual(next.unparsed, []);
    assert.deepEqual(next.state.inv.supplies, { I1: { amount: "9", unit: "rounds" }, I2: { amount: "0", unit: "batteries" } });
    const restock = turn(next.state, "- I2 adjust: +2 (bought)");
    assert.deepEqual(restock.state.inv.itemIds, ["I1", "I2"]);
    assert.deepEqual(restock.state.inv.supplies.I2, { amount: "2", unit: "batteries" });
});

test("existing items become counted supplies only with an explicit quantity", () => {
    const first = turn(emptyState(), "- + ammunition box\n- + $50 bill");
    assert.equal(first.state.inv.money, undefined);
    assert.equal(first.state.inv.supplies, undefined);
    const counted = turn(first.state, "- I1 quantity: 12 rounds\n- I1 adjust: -3");
    assert.deepEqual(counted.unparsed, []);
    assert.deepEqual(counted.state.inv.supplies, { I1: { amount: "9", unit: "rounds" } });
    assert.equal(counted.state.inv.money, undefined);
    const removed = turn(counted.state, "- - I1 (box lost)");
    assert.deepEqual(removed.state.inv.items, ["$50 bill"]);
    assert.equal(removed.state.inv.supplies, undefined);
});

test("unknown, overdrawn, and malformed adjustments leave balances and counts unchanged", () => {
    const first = turn(emptyState(), "- money: 5 USD\n- supply: 2 rounds | ammunition\n- + key").state;
    const lines = ["money - 6 USD", "money + 2 EUR", "money: -5 USD", "money - 1 USD (paid))", "I1 adjust: -3", "I1 adjust: +2 rounds", "I2 adjust: -1", "I99 adjust: -1", "I1 quantity: -3 rounds", "supply: 2 | ammo", "I1 adjust: +2 (found) extra"];
    const r = turn(first, lines.map(line => `- ${line}`).join("\n"));
    assert.deepEqual(r.state.inv, first.inv);
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Inventory", line })));
});

test("money and supplies survive escaped descriptions and are shown separately in the prompt", () => {
    const first = turn(emptyState(), '- money: 50 USD\n- supply: 12 rounds | ammo; brass | "special" & marked');
    const read = parseBlock(block(first.state), { config: C });
    assert.deepEqual(read.errors, []);
    assert.deepEqual(read.state.inv, first.state.inv);
    const prompt = renderStatePrompt(read.state, { notebook: { rules: [], inbox: [] }, config: C, sections: {} });
    assert.match(prompt, /Money:.*50 USD/);
    assert.match(prompt, /Supplies:.*I1.*12 rounds.*ammo/);
    const next = turn(read.state, "- money - 18 USD\n- I1 adjust: -3");
    assert.deepEqual(next.state.inv.money, { USD: "32" });
    assert.deepEqual(next.state.inv.supplies.I1, { amount: "9", unit: "rounds" });
});

test("damaged numeric rows preserve the previous balances and counted inventory", () => {
    const first = turn(emptyState(), "- money: 50 USD\n- supply: 12 rounds | ammunition").state;
    const text = block(first);
    const badMoney = text.replace('Money USD:</b> 50', 'Money USD:</b> nonsense');
    const badSupply = text.replace('amount: 12', 'amount: -12');
    assert.notEqual(badMoney, text);
    assert.notEqual(badSupply, text);
    for (const bad of [badMoney, badSupply]) {
        const read = latestState([{ mes: text }, { mes: bad }], 2, C);
        assert.ok(read.errors.length);
        assert.deepEqual(read.state.inv.money, { USD: "50" });
        assert.deepEqual(read.state.inv.supplies, { I1: { amount: "12", unit: "rounds" } });
    }
});

test("swipes and rebuilds spend and consume from their own preceding snapshot", () => {
    const first = turn(emptyState(), "- money: 50 USD\n- supply: 12 rounds | ammunition").state;
    const rejected = turn(first, "- money - 18 USD\n- I1 adjust: -3").state;
    const base = latestState([{ mes: block(first) }, { mes: block(rejected) }], 1, C).state;
    const alternative = turn(base, "- money - 5 USD\n- I1 adjust: -1");
    assert.deepEqual(alternative.state.inv.money, { USD: "45" });
    assert.deepEqual(alternative.state.inv.supplies.I1, { amount: "11", unit: "rounds" });
    assert.deepEqual(turn(base, "- money - 5 USD\n- I1 adjust: -1").state.inv, alternative.state.inv);
});

test("mixed ordinary and supply entries keep descriptions aligned with IDs through persistence", () => {
    const first = turn(emptyState(), "- + noteworthy $50 bill\n- supply: 12 rounds | ammunition\n- + key").state;
    const read = parseBlock(block(first), { config: C });
    assert.deepEqual(read.errors, []);
    assert.deepEqual(read.state.inv, first.inv);
    const r = turn(read.state, "- I2 adjust: -3\n- - I1");
    assert.deepEqual(r.state.inv.items, ["ammunition", "key"]);
    assert.deepEqual(r.state.inv.itemIds, ["I2", "I3"]);
    assert.deepEqual(r.state.inv.supplies, { I2: { amount: "9", unit: "rounds" } });
});

test("ordinary names beginning with supply still use the normal item addition command", () => {
    const r = turn(emptyState(), "- + supply bag\n- + supply");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.inv.items, ["supply bag", "supply"]);
    assert.equal(r.state.inv.supplies, undefined);
});

test("malformed numeric prefixes cannot become quantities with invented units or currencies", () => {
    const first = turn(emptyState(), "- money: 50 USD\n- supply: 12 rounds | ammunition").state;
    const lines = ["supply: 12.5.5 litres | water", "supply: 1,000 rounds | ammo", "supply: 1..5 litres | water", "supply: 1, 000 rounds | ammo", "I1 quantity: 1..5 litres", "I1 quantity: 1, 000 rounds", "I1 quantity: 1,000 rounds", "I1 quantity: 1e3 rounds", "I1 quantity: 1/2 rounds", "money: 1e3"];
    const r = turn(first, lines.map(line => `- ${line}`).join("\n"));
    assert.deepEqual(r.state.inv, first.inv);
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Inventory", line })));
});

test("misspelled numeric row labels cannot silently drop balances or supply entries", () => {
    const first = turn(emptyState(), "- money: 50 USD\n- money: 3 CAD\n- supply: 12 rounds | ammunition\n- + key").state;
    const text = block(first);
    for (const bad of [text.replace('Money USD:', 'Mone USD:'), text.replace('Supply I1:', 'Suplly I1:')]) {
        assert.notEqual(bad, text);
        const read = latestState([{ mes: text }, { mes: bad }], 2, C);
        assert.ok(read.errors.length);
        assert.deepEqual(read.state.inv, first.inv);
    }
});
