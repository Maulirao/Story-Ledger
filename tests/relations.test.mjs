// Relationship engine — one test (or more) per FrankenSIM 3.0 rule. Run: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import {
    emptyRelations, applyTurn, replayRelations, parseRelationLines, describePair, pairKey,
} from "../src/model/relations.js";

const C = resolveConfig();
const ALL = ["Emilia", "Jan", "Sofia"];
const base = { E: 3, M: 3, L: 3, Er: 3, Ph: 3, Ec: 3, Pr: 3, St: 3, Sg: 3, Ad: 3, Ag: 3, Pt: 3 };
const ev = (o = {}) => ({ news: [], directs: [], ticks: [], phiTicks: [], ...o });

// Advance a state through `n` empty turns (everyone present) — used to reach schedule turns.
function idle(state, n, present = ALL) {
    for (let i = 0; i < n; i++) state = applyTurn(state, ev(), present, C).state;
    return state;
}
function withPair(axes = {}, acc = {}, from = "Emilia", to = "Jan") {
    let s = applyTurn(emptyRelations(), ev({ news: [{ from, to, axes: { ...base, ...axes } }] }), ALL, C).state;
    s.pairs[pairKey(from, to)].acc = { ...s.pairs[pairKey(from, to)].acc, ...acc };
    return s;
}
const P = (s, from = "Emilia", to = "Jan") => s.pairs[pairKey(from, to)];

test("NEW creates a directional pair, clamped to 1..20, accumulators at 0; a second NEW is ignored and logged", () => {
    let r = applyTurn(emptyRelations(), ev({ news: [{ from: "Emilia", to: "Jan", axes: { ...base, E: 25, M: 0 } }] }), ALL, C);
    assert.equal(P(r.state).axes.E, 20);
    assert.equal(P(r.state).axes.M, 1);
    assert.equal(P(r.state).acc.E, 0);
    assert.equal(r.state.pairs[pairKey("Jan", "Emilia")], undefined, "directional: Jan → Emilia is not created");
    r = applyTurn(r.state, ev({ news: [{ from: "Emilia", to: "Jan", axes: { ...base, E: 9 } }] }), ALL, C);
    assert.equal(P(r.state).axes.E, 20);
    assert.ok(r.log.some(l => /already exists/.test(l.text)));
});

test("ticks: several in one turn sum, capped at +2 per accumulator; non-positive and unknown-pair ticks are refused", () => {
    let s = withPair();
    const r = applyTurn(s, ev({ ticks: [
        { from: "Emilia", to: "Jan", acc: "E", amount: 2 }, { from: "Emilia", to: "Jan", acc: "E", amount: 2 },
        { from: "Emilia", to: "Jan", acc: "Ph", amount: 1 }, { from: "Emilia", to: "Jan", acc: "M", amount: -1 },
        { from: "Sofia", to: "Jan", acc: "Sg", amount: 1 },
    ] }), ALL, C);
    assert.equal(P(r.state).acc.E, 2);
    assert.equal(P(r.state).acc.Ph, 1);
    assert.equal(P(r.state).acc.M, 0);
    assert.ok(r.log.some(l => /capped/.test(l.text)));
    assert.ok(r.log.some(l => /Sofia → Jan.*no such pair/.test(l.text)));
});

test("conversion happens only on the axis's schedule turn and only at threshold; the accumulator resets", () => {
    let s = withPair({}, { E: 10, L: 7 });           // ct = 1 after NEW
    s = idle(s, 3);                                   // ct = 4: nothing due
    assert.equal(P(s).axes.E, 3);
    s = idle(s, 1);                                   // ct = 5: E's period (5)
    assert.equal(P(s).axes.E, 4);
    assert.equal(P(s).acc.E, 0);
    assert.equal(P(s).axes.L, 3, "L acc 7 is below its threshold 8");
});

test("GRAVITY WELL: fondness converting while its mirror is ≥ 6 feeds the mirror's accumulator", () => {
    let s = withPair({ M: 6 }, { E: 10 });
    s = idle(s, 4);                                   // ct 5
    assert.equal(P(s).axes.E, 4);
    assert.equal(P(s).acc.M, 1);
    let t = withPair({ M: 5 }, { E: 10 });
    t = idle(t, 4);
    assert.equal(P(t).acc.M, 0, "mirror below 6: no feed");
});

test("PHILAUTIA TRANSMISSION: with Φ < 0, a +2 fondness tick also feeds its mirror +1", () => {
    let s = withPair();
    s.selves.Emilia = { phi: -3, acc: 0 };
    s = applyTurn(s, ev({ ticks: [{ from: "Emilia", to: "Jan", acc: "Ph", amount: 2 }, { from: "Emilia", to: "Jan", acc: "L", amount: 1 }] }), ALL, C).state;
    assert.equal(P(s).acc.Ec, 1, "Ph +2 → Ec +1");
    assert.equal(P(s).acc.Er, 0, "a +1 tick does not transmit");
    let t = withPair();
    t.selves.Emilia = { phi: 0, acc: 0 };
    t = applyTurn(t, ev({ ticks: [{ from: "Emilia", to: "Jan", acc: "Ph", amount: 2 }] }), ALL, C).state;
    assert.equal(P(t).acc.Ec, 0, "Φ ≥ 0 disables transmission");
});

test("Φ: accumulator clamps to ±30 and converts on turn 23 at ±12", () => {
    let s = withPair();
    s = applyTurn(s, ev({ phiTicks: [{ who: "Emilia", amount: 40 }] }), ALL, C).state;
    assert.equal(s.selves.Emilia.acc, 30);
    s = idle(s, 20);                                  // ct 22
    assert.equal(s.selves.Emilia.phi, 0);
    s = idle(s, 1);                                   // ct 23
    assert.equal(s.selves.Emilia.phi, 1);
    assert.equal(s.selves.Emilia.acc, 0);
});

test("WALL: a tied pair with both ≥ 5 neither converts nor decays; a DIRECT shift breaks it", () => {
    let s = withPair({ E: 7, M: 7 }, { E: 10 });
    s = idle(s, 4);                                   // ct 5 — E would convert
    assert.equal(P(s).axes.E, 7);
    assert.equal(P(s).acc.E, 10, "accumulator still holds");
    s = applyTurn(s, ev({ directs: [{ from: "Emilia", to: "Jan", axis: "E", amount: 1 }] }), ALL, C).state; // ct 6
    assert.equal(P(s).axes.E, 8);
    s = idle(s, 4);                                   // ct 10: E converts now (no longer tied)
    assert.equal(P(s).axes.E, 9);
});

test("DIRECT is limited to +1/+2 and clamps at 20", () => {
    let s = withPair({ Ag: 19 });
    s = applyTurn(s, ev({ directs: [{ from: "Emilia", to: "Jan", axis: "Ag", amount: 5 }] }), ALL, C).state;
    assert.equal(P(s).axes.Ag, 20);
});

test("MIRROR DECAY: on schedule, a gap ≥ 5 lowers the trailing axis, never below the floor from the leading axis", () => {
    let s = withPair({ E: 12, M: 5 });               // floor = min(4, max(1, ⌈12/4⌉)) = 3
    s = idle(s, 9);                                   // ct 10: E↔M decay turn
    assert.equal(P(s).axes.M, 4);
    s = idle(s, 10);                                  // ct 20
    assert.equal(P(s).axes.M, 3);
    s = idle(s, 10);                                  // ct 30: at floor
    assert.equal(P(s).axes.M, 3);
    let t = withPair({ E: 8, M: 4 });                // gap 4: no decay
    t = idle(t, 9);
    assert.equal(P(t).axes.M, 4);
});

test("offstage: a pair with a member offstage does not decay while the trailing axis sits on 4, 8, 12 or 15", () => {
    let s = withPair({ E: 16, M: 4 });               // floor 4 anyway → use a case above floor
    let t = withPair({ Ph: 20, Ec: 8 });             // floor 4, trailing 8 (a skip value)
    t = idle(t, 9, ["Emilia"]);                       // ct 10, Jan offstage
    assert.equal(P(t).axes.Ec, 8);
    let u = withPair({ Ph: 20, Ec: 8 });
    u = idle(u, 9, ["Emilia", "Jan"]);                // both present → decays
    assert.equal(P(u).axes.Ec, 7);
    assert.ok(s);
});

test("describePair: tiers, the romance gate, WALL flags and the matching pattern", () => {
    const s = withPair({ E: 11, M: 9, Ph: 2 });
    const d = describePair(s, "Emilia", "Jan", C);
    assert.equal(d.axes.E.tier, "Devoted");
    assert.equal(d.axes.M.tier, "Cold");
    assert.equal(d.romance, "allowed");
    assert.ok(d.patterns.includes("messy_entanglement"));
    const locked = describePair(withPair({ E: 5, L: 5 }), "Emilia", "Jan", C);
    assert.equal(locked.romance, "locked");
    assert.deepEqual(describePair(withPair({ E: 7, M: 7 }), "Emilia", "Jan", C).walls, ["E/M"]);
});

test("replay folds turns in order and applies reader corrections before the turn they are anchored to", () => {
    const turns = [
        { events: ev({ news: [{ from: "Emilia", to: "Jan", axes: base }] }), present: ALL },
        { events: ev({ ticks: [{ from: "Emilia", to: "Jan", acc: "E", amount: 2 }] }), present: ALL },
        { events: ev({ ticks: [{ from: "Emilia", to: "Jan", acc: "E", amount: 2 }] }), present: ALL },
    ];
    const plain = replayRelations(turns, [], C);
    assert.equal(P(plain.state).acc.E, 4);
    assert.equal(plain.state.ct, 3);
    const corrected = replayRelations(turns, [{ at: 2, from: "Emilia", to: "Jan", axes: { E: 15 }, acc: { E: 0 } }], C);
    assert.equal(P(corrected.state).axes.E, 15);
    assert.equal(P(corrected.state).acc.E, 2, "the correction zeroed it, then turn 3 ticked +2");
    const offset = replayRelations(turns, [], C, 309);
    assert.equal(offset.state.ct, 312, "an imported turn count keeps the schedules in phase");
});

test("parses the model's relationship lines: ticks, Φ, DIRECT and NEW, with arrows and names as written", () => {
    const got = parseRelationLines([
        "- Emilia → Jan: E_acc +2 (kissed his knuckles) | Ph_acc +1 (teased him)",
        "- Emilia: Φ_acc -1 (brushed off the compliment)",
        "- DIRECT Emilia -> Jan: E +1 (public declaration)",
        "- NEW Clarice → Jan: E 3, M 4, L 5, Er 3, Ph 4, Ec 5, Pr 3, St 4, Sg 3, Ad 4, Ag 3, Pt 4 | Φ 2 (guarded, competitive)",
        "- Sofia ↔ Emilia: Pt_acc +1 (exposed the phone calls)",
        "garbage line",
    ]);
    assert.deepEqual(got.ticks, [
        { from: "Emilia", to: "Jan", acc: "E", amount: 2, reason: "kissed his knuckles" },
        { from: "Emilia", to: "Jan", acc: "Ph", amount: 1, reason: "teased him" },
        { from: "Sofia", to: "Emilia", acc: "Pt", amount: 1, reason: "exposed the phone calls" },
    ]);
    assert.deepEqual(got.phiTicks, [{ who: "Emilia", amount: -1, reason: "brushed off the compliment" }]);
    assert.deepEqual(got.directs, [{ from: "Emilia", to: "Jan", axis: "E", amount: 1, reason: "public declaration" }]);
    assert.equal(got.news[0].from, "Clarice");
    assert.equal(got.news[0].axes.Ec, 5);
    assert.equal(got.news[0].phi, 2);
    assert.equal(got.news[0].reason, "guarded, competitive");
    assert.deepEqual(got.unparsed, ["garbage line"]);
});
