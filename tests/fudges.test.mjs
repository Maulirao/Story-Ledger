// Turn dice and reader fudges. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { rollTurnDice, withFudges, fudgesForGeneration, diceFromBlock, parseDiceCommand, parseForceCommand } from "../src/model/dice.js";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { postTurn } from "../src/model/turn.js";
import { renderBlock } from "../src/model/block.js";

test("rollTurnDice returns three Fate dice, one World die and three check dice", () => {
    let n = 0;
    const rolls = rollTurnDice(() => [0, 0.25, 0.5, 0.75, 0.999, 0.1, 0.9][n++]);
    assert.deepEqual(rolls, { fate: { a: 1, b: 6, c: 11 }, world: 16, checks: [20, 3, 19] });
});

test("fudges hold for every generation of their reply and clear after the next user message", () => {
    let f = { tier: "MAJOR", appliedTo: null };
    let r = fudgesForGeneration(f, 7);
    assert.equal(r.active.tier, "MAJOR");
    f = r.next;
    assert.equal(f.appliedTo, 7);
    r = fudgesForGeneration(f, 7);
    assert.equal(r.active.tier, "MAJOR"); // swipe / regenerate / continue
    r = fudgesForGeneration(f, 9);
    assert.equal(r.active, null);
    assert.equal(r.next, null); // the reply after the next user message
});

test("locked dice replace rolled ones and are named", () => {
    const out = withFudges({ fate: { a: 3, b: 4, c: 5 }, world: 6, checks: [1, 2, 3] }, { dice: { "fate.a": 20, world: 7 } });
    assert.deepEqual(out.dice, { fate: { a: 20, b: 4, c: 5 }, world: 7, checks: [1, 2, 3] });
    assert.deepEqual(out.fudged, ["fate.a", "world"]);
    const checks = withFudges({ fate: { a: 3, b: 4, c: 5 }, world: 6, checks: [1, 2, 3] }, { dice: { checks: [20, 3, 11] } });
    assert.deepEqual(checks.dice.checks, [20, 3, 11]);
    assert.deepEqual(checks.fudged, ["checks"]);
});

test("diceFromBlock reads every die the block shows", () => {
    const base = resolveConfig();
    const config = { ...base, userName: "Jan", sections: {}, dice: { fate: { a: 10, b: 11, c: 12 }, world: 13, checks: [14, 15, 16] }, rolls: [14, 15, 16] };
    const { state } = postTurn(emptyState(), null, config);
    const block = renderBlock(state, { config, sections: {} });
    assert.deepEqual(diceFromBlock(block), { fate: { a: 10, b: 11, c: 12 }, world: 13, checks: [14, 15, 16] });
});

test("the dice and force commands parse and reject junk", () => {
    assert.deepEqual(parseDiceCommand("fate.a=20 fate.c=20 world=7 checks=20,3,11"), {
        dice: { "fate.a": 20, "fate.c": 20, world: 7, checks: [20, 3, 11] },
    });
    assert.deepEqual(parseForceCommand("MAJOR weighted"), { tier: "MAJOR", source: "WEIGHTED" });
    assert.deepEqual(parseForceCommand("calm"), { calm: true });
    assert.throws(() => parseDiceCommand("fate.x=21"), /fate\.x|1.*20/i);
    assert.throws(() => parseForceCommand("junk"), /force|tier|source/i);
});
