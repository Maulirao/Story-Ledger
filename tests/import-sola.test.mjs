// Importing Sola's trackers. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { importForeign } from "../src/model/import/index.js";
import { SOLA_REPLY } from "./fixtures/foreign.mjs";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ai = mes => ({ is_user: false, is_system: false, mes });

test("Sola's trackers import notes, seeds, date, cast, wardrobe and inventory", () => {
    const r = importForeign([ai(SOLA_REPLY)], C);
    assert.equal(r.source, "sola");
    assert.deepEqual(r.rules, ["Ana does not know about the key."]);
    assert.deepEqual(r.state.threads, ["Race after breakfast."]);
    assert.deepEqual(r.state.chekhov.bullets.map(b => [b.id, b.desc, b.weight, b.age]), [["B1", "the gardener's ladder", 1, 0], ["B2", "a sealed letter in the drawer", 1, 0]]);
    assert.equal(r.state.scene.now, "Day 9 — Dusk | the café, back room");
    assert.deepEqual(r.state.scene.present, ["Mara", "Ana", "Bo"]);
    assert.deepEqual(r.state.cast.Mara, { position: "", wearing: "grey coat over a wool dress, boots", holding: "a mug", condition: "Soaked" });
    assert.deepEqual(r.state.inv.items, ["umbrella", "lockpicks"]);
    for (const k of ["threads", "chekhov", "scene", "cast", "inv"]) assert.ok(r.imported.includes(k), k);
    assert.ok(r.unread.some(u => /Motives|Horizon/.test(u)));
});
