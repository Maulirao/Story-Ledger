import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { computeFate, reachFor } from "../src/model/fate-engine.js";

const F = resolveConfig().sectionConfig.fate;
const dice = { a: 10, b: 1, c: 1 };
const st = (fate = {}, more = {}) => {
    const s = emptyState();
    s.fate = { state: "ROUTINE", pursuit: "", ts: 0, q: 0, sinceMajor: 99, deferred: [], world: [], ambitions: [], residue: [], lastTurn: null, owed: [], ...fate };
    Object.assign(s, more);
    return s;
};
const d = (id = "D1", more = {}) => ({ id, desc: id, times: 0, age: 0, ...more });
const bullet = (id, more = {}) => ({ id, desc: id, weight: 1, age: 0, hot: false, secret: false, lock: "", at: null, after: "", ...more });
const hotBullets = (count = 5) => Array.from({ length: count }, (_, i) => bullet(`B${i + 1}`, { age: 6 + i, weight: i + 1, hot: true }));
const pick = o => ({ tier: o.tier, source: o.source, fire: o.fire, fudged: o.fudged });

test("Fate defaults preserve the spec tables and make Fate firing the default", () => {
    assert.deepEqual(F, {
        modifiers: { recentMajor: -3, deferred3: 4, deferred12: 2, public: 2 },
        ladder: [{ q: 0, minor: 16, major: 20 }, { q: 3, minor: 12, major: 19 }, { q: 7, minor: 8, major: 17 }],
        newsMax: 6, trueFloor: 3,
        hpLadder: [{ hp: 1, weighted: 14 }, { hp: 3, weighted: 9 }, { hp: 5, weighted: 5 }],
        collision: { minorDefer: 12, majorComplicate: 10 }, dangerC: 20, deferredExpire: 6,
        worldKeep: 5, reach1Drop: 15, minorWorld: { reach: 2, age: 4 }, majorWorld: { reach: 3, age: 8 },
        ripe: { reach: 3, age: 12 }, pursuitLimit: 8, residueKeep: 12,
    });
    assert.equal(resolveConfig().sectionConfig.chekhov.firing, "fate");
    const override = resolveConfig({ sectionConfig: { fate: { newsMax: 9, modifiers: { public: 3 } } } }).sectionConfig.fate;
    assert.equal(override.newsMax, 9);
    assert.deepEqual(override.modifiers, { recentMajor: -3, deferred3: 4, deferred12: 2, public: 3 });
});

test("the modifier takes the first matching line only", () => {
    assert.equal(computeFate(st({ sinceMajor: 1, deferred: [d(), d(), d()] }), dice, null, F).mod, -3);
    assert.equal(computeFate(st({ deferred: [d(), d(), d()] }), dice, null, F).mod, 4);
    assert.equal(computeFate(st({ deferred: [d()] }), dice, null, F).mod, 2);
    assert.equal(computeFate(st({}, { scene: { now: "", present: [], public: true } }), dice, null, F).mod, 2);
    assert.equal(computeFate(st(), dice, null, F).mod, 0);
});

test("the q ladder edges", () => {
    for (const [q, a, tier] of [[2, 15, "AMBIENT"], [2, 16, "MINOR"], [2, 20, "MAJOR"], [3, 12, "MINOR"], [6, 19, "MAJOR"], [7, 8, "MINOR"], [7, 17, "MAJOR"]]) {
        assert.equal(computeFate(st({ q }), { a, b: 1, c: 10 }, null, F).tier, tier, `q ${q} A ${a}`);
    }
});

test("news only on AMBIENT with C ≤ 6", () => {
    assert.equal(computeFate(st({ q: 0 }), { a: 1, b: 1, c: 6 }, null, F).news, true);
    assert.equal(computeFate(st({ q: 0 }), { a: 1, b: 1, c: 7 }, null, F).news, false);
    assert.equal(computeFate(st({ q: 0 }), { a: 16, b: 1, c: 1 }, null, F).news, false);
});

test("source: B ≤ 3 is always TRUE; otherwise the hp ladder", () => {
    assert.equal(computeFate(st(), { a: 1, b: 20, c: 1 }, null, F).source, "TRUE");
    const withHot = n => st({}, { chekhov: { bullets: hotBullets(n), fired: [] } });
    assert.equal(computeFate(withHot(2), { a: 1, b: 13, c: 20 }, null, F).source, "TRUE");
    assert.equal(computeFate(withHot(2), { a: 1, b: 14, c: 20 }, null, F).source, "WEIGHTED");
    assert.equal(computeFate(withHot(4), { a: 1, b: 9, c: 20 }, null, F).source, "WEIGHTED");
    assert.equal(computeFate(withHot(5), { a: 1, b: 5, c: 20 }, null, F).source, "WEIGHTED");
    assert.equal(computeFate(withHot(5), { a: 1, b: 3, c: 20 }, null, F).source, "TRUE");
});

test("MAJOR + WEIGHTED fires the eligible hot bullet with the highest weight, then the oldest", () => {
    const s = st({ q: 7 }, { chekhov: { bullets: [
        bullet("B1", { weight: 2, age: 7, hot: true }),
        bullet("B2", { weight: 3, age: 6, hot: true }),
        bullet("B3", { weight: 3, age: 9, hot: false }),
        ...Array.from({ length: 3 }, (_, i) => bullet(`B${i + 4}`, { weight: 1, age: 6, hot: true })),
    ], fired: [] } });
    const o = computeFate(s, { a: 18, b: 20, c: 5 }, null, F);
    assert.equal(o.tier, "MAJOR");
    assert.equal(o.source, "WEIGHTED");
    assert.equal(o.fire, "B2");
});

test("MAJOR + WEIGHTED without an eligible hot bullet falls back to MAJOR + TRUE", () => {
    const o = computeFate(st({ q: 7 }, { chekhov: { bullets: [bullet("B1", { age: 2, hot: true })], fired: [] } }), { a: 18, b: 20, c: 14 }, null, F);
    assert.equal(o.tier, "MAJOR");
    assert.equal(o.source, "TRUE");
    assert.equal(o.fellBack, true);
    assert.equal(o.fire, null);
});

test("a ripe LOCAL entry pre-empts the bullet on any MAJOR", () => {
    const s = st({ q: 7, world: [{ id: "W1", desc: "the old promise", prox: "LOCAL", reach: 3, age: 12 }] }, { chekhov: { bullets: hotBullets(), fired: [] } });
    const o = computeFate(s, { a: 18, b: 20, c: 20 }, null, F);
    assert.equal(o.ripe, "W1");
    assert.equal(o.fire, null);
    assert.deepEqual(o.world, { id: "W1", action: "land" });
});

test("AMBIENT + WEIGHTED warms one eligible hot bullet", () => {
    const s = st({ q: 0 }, { chekhov: { bullets: [bullet("B1", { age: 6, hot: true })], fired: [] } });
    const o = computeFate(s, { a: 1, b: 14, c: 14 }, null, F);
    assert.equal(o.tier, "AMBIENT");
    assert.equal(o.source, "WEIGHTED");
    assert.equal(o.warm, "B1");
    assert.equal(o.fire, null);
});

test("world landing on MINOR and MAJOR", () => {
    const minor = st({ q: 0, world: [
        { id: "W1", desc: "regional", prox: "REGIONAL", reach: 2, age: 8 },
        { id: "W2", desc: "local", prox: "LOCAL", reach: 3, age: 4 },
        { id: "W3", desc: "older local", prox: "LOCAL", reach: 3, age: 7 },
        { id: "W4", desc: "too young", prox: "LOCAL", reach: 3, age: 3 },
    ] });
    assert.deepEqual(computeFate(minor, { a: 16, b: 1, c: 10 }, null, F).world, { id: "W3", action: "first-effect" });
    const major = st({ q: 7, world: [{ id: "W1", desc: "landing", prox: "LOCAL", reach: 3, age: 8 }] });
    assert.deepEqual(computeFate(major, { a: 17, b: 1, c: 10 }, null, F).world, { id: "W1", action: "land" });
});

test("collision with an open pursuit", () => {
    const thread = (q, c) => computeFate(st({ state: "THREAD", pursuit: "the missing key", q }), { a: q >= 7 ? 17 : 16, b: 1, c }, null, F).collision;
    assert.equal(thread(0, 12), "DEFER");
    assert.equal(thread(0, 13), "COMPLICATE");
    assert.equal(thread(7, 10), "COMPLICATE");
    assert.equal(thread(7, 11), "DISPLACE");
    assert.equal(computeFate(st({ state: "ROUTINE", q: 0 }), { a: 16, b: 1, c: 12 }, null, F).collision, null);
});

test("deferred twice must land; ts at the limit must close; danger lifts only on MAJOR+TRUE C 20", () => {
    const s = st({ state: "THREAD", pursuit: "the key", ts: 8, q: 7, deferred: [d("D10", { times: 2 }), d("D2", { times: 2 })] });
    const majorTrue = computeFate(s, { a: 17, b: 1, c: 20 }, null, F);
    assert.equal(majorTrue.mustLand, "D2");
    assert.equal(majorTrue.mustClose, true);
    assert.equal(majorTrue.dangerLifted, true);
    assert.equal(computeFate(s, { a: 17, b: 1, c: 19 }, null, F).dangerLifted, false);
    const weighted = st({ q: 7 }, { chekhov: { bullets: hotBullets(), fired: [] } });
    assert.equal(computeFate(weighted, { a: 17, b: 20, c: 20 }, null, F).dangerLifted, false);
});

test("fudges: calm, tier, source, fire and ban, in that order, and they are listed", () => {
    const s = st({ q: 0 }, { chekhov: { bullets: [bullet("B1", { age: 2 })], fired: [] } });
    assert.deepEqual(pick(computeFate(s, { a: 1, b: 1, c: 1 }, { tier: "MAJOR", source: "WEIGHTED", fire: "B1" }, F)), { tier: "MAJOR", source: "WEIGHTED", fire: "B1", fudged: ["tier", "source", "fire"] });
    const calm = computeFate(s, { a: 20, b: 20, c: 20 }, { calm: true }, F);
    assert.equal(calm.tier, "AMBIENT");
    assert.equal(calm.source, "TRUE");
    assert.equal(calm.fire, null);
    assert.equal(calm.news, false);
    const weighted = st({ q: 7 }, { chekhov: { bullets: hotBullets(), fired: [] } });
    assert.equal(computeFate(weighted, { a: 18, b: 20, c: 14 }, { fire: "none" }, F).fire, null);
});

test("reachFor follows the proximity × C table", () => {
    for (const [prox, values] of Object.entries({ ELSEWHERE: [1, 1, 2], REGIONAL: [1, 2, 3], LOCAL: [2, 3, 3] })) {
        assert.deepEqual([4, 5, 6].map(c => reachFor(prox, c)), values, prox);
    }
});


