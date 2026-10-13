import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig, sanitizeTitles } from "../src/model/config.js";

test("titles defaults", () => assert.deepEqual(resolveConfig().sectionConfig.titles, { softCap: 3, hardCap: 6, situationalMax: 2, retrofitBatch: 10 }));
test("sanitizeTitles: blanks keep, clamps and ordering", () => {
    const prev = { softCap: 3, hardCap: 6, situationalMax: 2, retrofitBatch: 10 };
    assert.deepEqual(sanitizeTitles({ softCap: "", hardCap: "99", situationalMax: "-1", retrofitBatch: "0" }, prev), { softCap: 3, hardCap: 20, situationalMax: 0, retrofitBatch: 1 });
    assert.deepEqual(sanitizeTitles({ softCap: "8", hardCap: "5" }, prev), { softCap: 5, hardCap: 5, situationalMax: 2, retrofitBatch: 10 });
});
test("saved titles overrides are sanitised by resolveConfig", () => {
    assert.equal(resolveConfig({ sectionConfig: { titles: { hardCap: 40 } } }).sectionConfig.titles.hardCap, 20);
});
