// Second review of the importers. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { importForeign } from "../src/model/import/index.js";
import { sameName, nowResolved } from "../src/model/import/util.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ai = mes => ({ is_user: false, is_system: false, mes });
const ff = sections => `<internal_states>\n<details><summary>🎬 INTERNAL STATES (Turn: 5)</summary>\n${sections}\n</details>\n</internal_states>`;
const chekhov = rows => ff(`<details><summary>🔫 CHEKHOV'S GUN</summary><br>${rows}<br></details>`);

test("an FF bullet keeps both its lock and its dependency", () => {
    const r = importForeign([ai(chekhov("- Active: [BULLET: the ladder] (weight: 2, age: 3/12) [LOCKED: CHAR: Mara arrives] [depends: the key]"))], C);
    const lock = r.state.chekhov.bullets[0].lock;
    assert.match(lock, /CHAR: Mara arrives/);
    assert.match(lock, /depends on the key/);
});

test("an FF Locked bullet with a dependency keeps both conditions visible", () => {
    const r = importForeign([ai(chekhov("- Locked: [BULLET: the shift] (weight: 1, age: 0/12) [depends: the key]"))], C);
    const lock = r.state.chekhov.bullets[0].lock;
    assert.match(lock, /imported lock/);
    assert.match(lock, /depends on the key/);
});

test("an imported Now counts as resolved only when it has a clock time", () => {
    assert.equal(nowResolved("Day 3 | 18:40 | the docks"), true);
    assert.equal(nowResolved("Monday 14 March | 6 pm"), true);
    assert.equal(nowResolved("Day 9 — Dusk | the inn"), false);
    assert.equal(nowResolved(""), false);
});

test("a header without a clock time is not marked imported and the handover is told", () => {
    const r = importForeign([ai(`[ 🕰️ Day 4 | Evening | the docks ]\n\nText.\n\n${chekhov("- Active: [BULLET: the ladder] (weight: 2, age: 3/12)")}`)], C);
    assert.equal(r.state.scene.now, "Day 4 | Evening | the docks");
    assert.ok(!r.imported.includes("scene"));
    assert.ok(r.unread.some(u => /Now/.test(u) && /clock/.test(u)));
});

test("a Sola date without a clock time stays unresolved", () => {
    const r = importForeign([ai("<date>\nDay: 9\nTime: Dusk\n</date>\n<scene_cast>\nLocation: the inn\n</scene_cast>")], C);
    assert.equal(r.state.scene.now, "Day 9 — Dusk | the inn");
    assert.ok(!r.imported.includes("scene"));
    assert.ok(r.unread.some(u => /Now/.test(u)));
});

test("the persona is recognised despite case, punctuation, a surname or {{user}}", () => {
    assert.equal(sameName("Jan", "Jan"), true);
    assert.equal(sameName("jan.", "Jan"), true);
    assert.equal(sameName("Jan Kowalski", "Jan"), true);
    assert.equal(sameName("Jan", "Jan Kowalski"), true);
    assert.equal(sameName("Jan (you)", "Jan"), true);
    assert.equal(sameName("{{user}}", "Jan"), true);
    assert.equal(sameName("Mara", "Jan"), false);
    assert.equal(sameName("Janine", "Jan"), false);
});

const solaInv = who => `<inventory>\n${who}:\nCarried: umbrella, spare key\nConcealed: a note\nMara:\nIn-hand: mug\n</inventory>`;

test("a Sola inventory headed with the persona's full name is the user's", () => {
    const r = importForeign([ai(solaInv("Jan Kowalski"))], C);
    assert.deepEqual(r.state.inv.items, ["umbrella", "spare key", "a note"]);
    assert.ok(!("Jan Kowalski" in r.state.cast));
});

test("when no Sola inventory entry is the user's, the handover asks for it instead of dropping it", () => {
    const r = importForeign([ai(solaInv("The Traveller"))], { ...C, userName: "Jan" });
    assert.deepEqual(r.state.inv.items, []);
    assert.ok(r.unread.some(u => /inventory/i.test(u)));
});
