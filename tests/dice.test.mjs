// Dice. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { rollD20s } from "../src/model/dice.js";

test("rollD20s stays within 1–20 and uses the rng", () => {
    assert.deepEqual(rollD20s(3, () => 0), [1, 1, 1]);
    assert.deepEqual(rollD20s(2, () => 0.9999), [20, 20]);
    for (const d of rollD20s(50)) assert.ok(d >= 1 && d <= 20);
});
