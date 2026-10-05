// State shape and id allocation. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, nextId } from "../src/model/state.js";

test("nextId never reuses an id", () => {
    const s = emptyState();
    assert.equal(nextId(s, "B"), "B1");
    assert.equal(nextId(s, "B"), "B2");
    s.ids.B = ["B1", "B2", "B5"];
    assert.equal(nextId(s, "B"), "B3");
});
