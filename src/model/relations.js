// ──────────────────────────────────────────────────────────────────────────────
// Relationship engine — FrankenSIM 3.0's 13-axis bond tracker, as code.
//
// The model judges and reports EVENTS (accumulator ticks, Φ ticks, DIRECT shifts,
// NEW pairs). Everything mechanical happens here, deterministically: caps, the
// turn-counted conversions and decay, floors, WALL, Gravity Well, Philautia
// transmission, clamps. Pairs are directional: "Emilia → Jan" is how Emilia feels
// about Jan. The player character's feelings are the player's, so they are never
// modelled unless the model is told to.
//
// State is never stored as truth: replayRelations() folds the chat's turns from the
// start, so a swiped, edited or deleted reply takes its events with it. Pure: no
// SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { axisByKey } from "./config.js";
import { sameName } from "./import/util.js";

export const pairKey = (from, to) => `${from}→${to}`;

export function emptyRelations() {
    return { ct: 0, pairs: {}, selves: {} };
}

const clone = s => JSON.parse(JSON.stringify(s));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const zeroAcc = config => Object.fromEntries(config.axes.map(a => [a.key, 0]));

function isWalled(pair, axisKey, config) {
    const a = axisByKey(config, axisKey);
    if (!a) return false;
    const x = pair.axes[axisKey], m = pair.axes[a.mirror];
    return x === m && x >= config.wallMin && m >= config.wallMin;
}

/**
 * One turn: the turn counter advances, then the reply's events apply, then whatever
 * is scheduled for this turn. Returns { state, log } — log entries are
 * { pair|who, text, kind } for the reader's change log.
 */
export function applyTurn(prev, events, present, config) {
    const s = clone(prev);
    const log = [];
    const here = new Set(present || []);
    s.ct += 1;
    const ev = { news: [], directs: [], ticks: [], phiTicks: [], notes: [], ...(events || {}) };
    // Pair keys are "A→B" internally; the reader's log reads "A → B".
    const say = (kind, where, text) => log.push({ kind, where, text: text.replace(/(\S)→(\S)/g, "$1 → $2"), ct: s.ct });
    // "A→B" → what the previous preset recorded ("" when nothing): imported bonds and pairs the
    // model ticked before their NEW line. The turn facts ask for them until the NEW line is written.
    s.awaiting = { ...(prev.awaiting || {}) };
    const await_ = k => { if (!(k in s.awaiting)) s.awaiting[k] = ""; };

    // NEW pairs (the model's one-time calibration from the card and the history).
    for (const n of ev.news) {
        const k = pairKey(n.from, n.to);
        if (s.pairs[k]) { say("refused", k, `NEW ${k} ignored: the pair already exists.`); continue; }
        const axes = {};
        for (const a of config.axes) axes[a.key] = clamp(Math.round(Number((n.axes || {})[a.key] ?? 3)), config.axisMin, config.axisMax);
        // the NEW line's reason is the relationship's own description (the card shows it)
        s.pairs[k] = { from: n.from, to: n.to, axes, acc: zeroAcc(config), ...(n.reason ? { note: n.reason } : {}) };
        for (const w of Object.keys(s.awaiting)) {   // tolerant: "Mara Kowal → Jan" clears "Mara→Jan"
            const [a, b] = w.split("→");
            if (sameName(a, n.from) && sameName(b, n.to)) delete s.awaiting[w];
        }
        say("new", k, `NEW ${k}${n.reason ? ` (${n.reason})` : ""}.`);
        if (n.phi !== undefined && !s.selves[n.from]) {
            s.selves[n.from] = { phi: clamp(Math.round(Number(n.phi)), config.phi.min, config.phi.max), acc: 0 };
        }
    }

    // NOTE: the model revises a relationship's description.
    for (const n of ev.notes) {
        const k = pairKey(n.from, n.to), p = s.pairs[k];
        if (!p) { say("refused", k, `NOTE ${k} refused: no such pair (it needs a NEW line first).`); continue; }
        p.note = n.text;
        say("note", k, `${k} now reads: ${n.text}`);
    }

    // DIRECT shifts: +1 or +2, the only thing that breaks a WALL.
    for (const d of ev.directs) {
        const k = pairKey(d.from, d.to), p = s.pairs[k];
        if (!p || !axisByKey(config, d.axis)) { if (!p) await_(k); say("refused", k, `DIRECT ${k} ${d.axis} refused: no such pair or axis.`); continue; }
        const amt = clamp(Math.round(Number(d.amount) || 0), 1, config.directMax);
        p.axes[d.axis] = clamp(p.axes[d.axis] + amt, config.axisMin, config.axisMax);
        say("direct", k, `${d.axis} +${amt} (direct${d.reason ? `: ${d.reason}` : ""}).`);
    }

    // Accumulator ticks, summed per accumulator and capped per turn.
    const sums = {};
    for (const t of ev.ticks) {
        const k = pairKey(t.from, t.to);
        if (!s.pairs[k]) { await_(k); say("refused", k, `${k} ${t.acc}_acc refused: no such pair (it needs a NEW line first).`); continue; }
        if (!axisByKey(config, t.acc)) { say("refused", k, `${k}: unknown accumulator ${t.acc}.`); continue; }
        const amt = Math.round(Number(t.amount) || 0);
        if (amt <= 0) { say("refused", k, `${k} ${t.acc}_acc ${amt} refused: accumulators only tick up — friction has its own axis.`); continue; }
        const id = `${k}|${t.acc}`;
        sums[id] = sums[id] || { k, acc: t.acc, amount: 0, reasons: [] };
        sums[id].amount += amt;
        if (t.reason) sums[id].reasons.push(t.reason);
    }
    for (const { k, acc, amount, reasons } of Object.values(sums)) {
        const p = s.pairs[k];
        const applied = Math.min(amount, config.tickCap);
        if (applied < amount) say("capped", k, `${acc}_acc capped at +${config.tickCap} this turn (asked +${amount}).`);
        p.acc[acc] += applied;
        say("tick", k, `${acc}_acc +${applied}${reasons.length ? ` (${reasons.join("; ")})` : ""}.`);
        // PHILAUTIA TRANSMISSION: fondness offered at full strength to someone whose
        // self-regard is negative is partly received as its mirror friction.
        const a = axisByKey(config, acc);
        const self = s.selves[p.from];
        if (a.kind === "fond" && applied === config.tickCap && self && self.phi < 0) {
            p.acc[a.mirror] += 1;
            say("transmission", k, `${a.mirror}_acc +1 (Philautia transmission: ${p.from}'s Φ is ${self.phi}).`);
        }
    }

    // Φ ticks (self-regard), clamped.
    for (const t of ev.phiTicks) {
        const self = s.selves[t.who] = s.selves[t.who] || { phi: 0, acc: 0 };
        const amt = Math.round(Number(t.amount) || 0);
        self.acc = clamp(self.acc + amt, -config.phi.accCap, config.phi.accCap);
        say("phi", t.who, `Φ_acc ${amt >= 0 ? "+" : ""}${amt}${t.reason ? ` (${t.reason})` : ""}.`);
    }

    // STAGGERED CONVERSION, then GRAVITY WELL.
    for (const [k, p] of Object.entries(s.pairs)) {
        for (const a of config.axes) {
            if (s.ct % a.period !== 0 || p.acc[a.key] < a.threshold) continue;
            if (isWalled(p, a.key, config)) { say("wall", k, `${a.key} held by WALL (${a.key} = ${a.mirror} = ${p.axes[a.key]}).`); continue; }
            p.axes[a.key] = clamp(p.axes[a.key] + 1, config.axisMin, config.axisMax);
            p.acc[a.key] = 0;
            say("convert", k, `${a.key} → ${p.axes[a.key]} (accumulator converted).`);
            if (a.kind === "fond" && p.axes[a.mirror] >= config.gravityMin) {
                p.acc[a.mirror] += 1;
                say("gravity", k, `${a.mirror}_acc +1 (Gravity Well: ${a.mirror} is ${p.axes[a.mirror]}).`);
            }
        }
    }
    if (s.ct % config.phi.period === 0) {
        for (const [who, self] of Object.entries(s.selves)) {
            if (self.acc >= config.phi.threshold) { self.phi = clamp(self.phi + 1, config.phi.min, config.phi.max); self.acc = 0; say("convert", who, `Φ → ${self.phi}.`); }
            else if (self.acc <= -config.phi.threshold) { self.phi = clamp(self.phi - 1, config.phi.min, config.phi.max); self.acc = 0; say("convert", who, `Φ → ${self.phi}.`); }
        }
    }

    // MIRROR DECAY.
    for (const rule of config.decay) {
        if (s.ct % rule.period !== 0) continue;
        const [xk, mk] = rule.pair;
        for (const [k, p] of Object.entries(s.pairs)) {
            if (isWalled(p, xk, config)) continue;
            const x = p.axes[xk], m = p.axes[mk];
            if (Math.abs(x - m) < config.decayLead) continue;
            const [leadKey, trailKey] = x > m ? [xk, mk] : [mk, xk];
            const leading = p.axes[leadKey], trailing = p.axes[trailKey];
            const floor = Math.min(config.floorMax, Math.max(1, Math.ceil(leading / config.floorDivisor)));
            const offstage = !(here.has(p.from) && here.has(p.to));
            if (offstage && config.offstageSkip.includes(trailing)) continue;
            if (trailing <= floor) continue;
            p.axes[trailKey] = trailing - 1;
            say("decay", k, `${trailKey} → ${trailing - 1} (mirror decay against ${leadKey} ${leading}).`);
        }
    }

    return { state: s, log };
}

/**
 * Fold every turn from the start. `turns` is [{ events, present }] in chat order;
 * `corrections` are the reader's edits, { at: turnIndex, from, to, axes?, acc? } or
 * { at, who, phi?, phiAcc? }, applied just before turn `at`. `ctOffset` continues an
 * imported turn count so the schedules stay in phase.
 */
export function replayRelations(turns, corrections, config, ctOffset = 0) {
    let state = { ...emptyRelations(), ct: ctOffset };
    const log = [];
    const pending = [...(corrections || [])].sort((a, b) => a.at - b.at);
    const correct = c => {
        if (c.who) {
            const self = state.selves[c.who] = state.selves[c.who] || { phi: 0, acc: 0 };
            if (c.phi !== undefined) self.phi = clamp(c.phi, config.phi.min, config.phi.max);
            if (c.phiAcc !== undefined) self.acc = clamp(c.phiAcc, -config.phi.accCap, config.phi.accCap);
            log.push({ kind: "reader", where: c.who, text: `Reader set ${c.who}'s Φ.`, ct: state.ct });
            return;
        }
        const k = pairKey(c.from, c.to);
        const p = state.pairs[k] = state.pairs[k] || { from: c.from, to: c.to, axes: Object.fromEntries(config.axes.map(a => [a.key, 3])), acc: zeroAcc(config) };
        for (const [ax, v] of Object.entries(c.axes || {})) if (ax in p.axes) p.axes[ax] = clamp(v, config.axisMin, config.axisMax);
        for (const [ax, v] of Object.entries(c.acc || {})) if (ax in p.acc) p.acc[ax] = Math.max(0, v);
        log.push({ kind: "reader", where: k, text: `Reader corrected ${k}.`, ct: state.ct });
    };
    turns.forEach((turn, i) => {
        while (pending.length && pending[0].at <= i) correct(pending.shift());
        const r = applyTurn(state, turn.events, turn.present, config);
        state = r.state;
        log.push(...r.log.map(l => ({ ...l, turn: i })));
    });
    while (pending.length) correct(pending.shift());
    return { state, log };
}

// ── What the model reads ────────────────────────────────────────────────────

const PATTERNS = [
    { id: "hookup", test: (a) => a.L >= 8 && a.E <= 3, gloss: "casual flirtation/sex, no strings" },
    { id: "fwb", test: (a) => a.L >= 6 && a.Ph >= 6 && a.E <= 4, gloss: "playful intimacy on a friendship foundation" },
    { id: "slow_burn", test: (a, phi) => a.E >= 6 && a.Ph >= 8 && a.Ag >= 5 && phi >= 6, gloss: "deep connection forming; physicality follows emotional safety" },
    { id: "comfortable_marriage", test: (a) => a.Pr >= 14 && a.Sg >= 12 && a.Ph >= 10 && a.E <= 5, gloss: "love built, not felt as heat" },
    { id: "messy_entanglement", test: (a) => a.E >= 10 && a.M >= 8, gloss: "wanting and resenting the wanting" },
    { id: "bitter_ex", test: (a) => a.Sg >= 8 && a.Ec >= 8 && a.E <= 2, gloss: "too close for strangers, too damaged for friends" },
    { id: "rival", test: (a) => a.Er >= 8 && a.Ph >= 6 && a.Ag <= 3, gloss: "the contest is the connection" },
    { id: "cold_arrangement", test: (a) => a.Pr >= 10 && a.St >= 8 && a.Ad >= 6, gloss: "the partnership works; the relationship doesn't" },
    { id: "corrosive_bond", test: (a, phi) => a.E >= 10 && phi <= -6, gloss: "love real, but the receiver can't trust it" },
    { id: "healing_pair", test: (a, phi) => phi >= 6 && a.Ag >= 8 && a.M <= 4, gloss: "doing the work; friction released, not ignored" },
];

function tierOf(value, kind, config) {
    const t = config.tiers.find(t => value >= t.min && value <= t.max);
    return t ? t[kind] : "Neutral";
}

/** Everything the model (and the reader's card) needs about one pair. */
export function describePair(state, from, to, config) {
    const p = state.pairs[pairKey(from, to)];
    if (!p) return null;
    const phi = (state.selves[from] || { phi: 0 }).phi;
    const axes = {};
    for (const a of config.axes) axes[a.key] = { value: p.axes[a.key], acc: p.acc[a.key], tier: tierOf(p.axes[a.key], a.kind, config) };
    const g = config.romanceGate;
    const romance = (p.axes.E >= g.E || p.axes.L >= g.L) ? "allowed" : "locked";
    const walls = config.axes.filter(a => a.kind === "fond" && isWalled(p, a.key, config)).map(a => `${a.key}/${a.mirror}`);
    const patterns = PATTERNS.filter(x => x.test(p.axes, phi)).map(x => x.id);
    return { from, to, phi, axes, romance, walls, patterns };
}

export const PATTERN_GLOSS = Object.fromEntries(PATTERNS.map(p => [p.id, p.gloss]));

// ── Reading the model's lines ───────────────────────────────────────────────

const ARROW = /\s*(?:→|->|↔|<->|=>)\s*/;
const AXIS_ALIASES = {
    eros: "E", misos: "M", ludus: "L", eris: "Er", philia: "Ph", echthros: "Ec", pragma: "Pr",
    stasis: "St", storge: "Sg", adiaphora: "Ad", agape: "Ag", phthonos: "Pt",
};
const AXES = ["E", "M", "L", "Er", "Ph", "Ec", "Pr", "St", "Sg", "Ad", "Ag", "Pt"];
function axisKey(raw) {
    const s = String(raw || "").replace(/_acc$/i, "").trim();
    const exact = AXES.find(a => a === s) || AXES.find(a => a.toLowerCase() === s.toLowerCase());
    return exact || AXIS_ALIASES[s.toLowerCase()] || null;
}
const reasonOf = s => { const m = String(s).match(/\(([^)]*)\)\s*$/); return m ? m[1].trim() : ""; };
const withoutReason = s => String(s).replace(/\([^)]*\)\s*$/, "").trim();
const isPhi = s => /^(?:Φ|phi|philautia)(?:_acc)?$/i.test(String(s).trim());

/** The model's relationship lines → events. Lines it cannot read come back in `unparsed`. */
export function parseRelationLines(lines) {
    const out = { news: [], directs: [], ticks: [], phiTicks: [], notes: [], unparsed: [] };
    for (const raw of lines || []) {
        const line = String(raw).replace(/<[^>]+>/g, "").replace(/^\s*[-*•]\s*/, "").trim();
        if (!line) continue;
        let m;
        // NOTE A → B: a new description of the relationship
        if ((m = line.match(/^NOTE\s+(.+?)\s*(?:→|->|↔|<->|=>)\s*(.+?)\s*:\s*(.+)$/i))) {
            out.notes.push({ from: m[1].trim(), to: m[2].trim(), text: m[3].trim() });
            continue;
        }
        // NEW A → B: E 3, M 4, … | Φ 2 (reason)
        if ((m = line.match(/^NEW\s+(.+?)\s*(?:→|->|↔|<->|=>)\s*(.+?)\s*:\s*(.+)$/i))) {
            const reason = reasonOf(m[3]);
            const [axPart, phiPart] = withoutReason(m[3]).split("|");
            const axes = {};
            for (const kv of axPart.split(/[,;]/)) {
                const mm = kv.trim().match(/^([A-Za-zΦ]+)\s*[:=]?\s*(-?\d+)$/);
                const k = mm && axisKey(mm[1]);
                if (k) axes[k] = Number(mm[2]);
            }
            const phiM = phiPart && phiPart.match(/(?:Φ|phi|philautia)\s*[:=]?\s*(-?\d+)/i);
            out.news.push({ from: m[1].trim(), to: m[2].trim(), axes, ...(phiM ? { phi: Number(phiM[1]) } : {}), reason });
            continue;
        }
        // DIRECT A → B: E +1 (reason)
        if ((m = line.match(/^DIRECT\s+(.+?)\s*(?:→|->|↔|<->|=>)\s*(.+?)\s*:\s*([A-Za-z]+)\s*\+?\s*(\d+)\s*(.*)$/i))) {
            const k = axisKey(m[3]);
            if (k) { out.directs.push({ from: m[1].trim(), to: m[2].trim(), axis: k, amount: Number(m[4]), reason: reasonOf(m[5]) }); continue; }
        }
        // A: Φ_acc ±n (reason)
        if ((m = line.match(/^([^:→↔>-][^:]*?)\s*:\s*(Φ|phi|philautia)(?:_acc)?\s*([+-]\s*\d+)\s*(.*)$/i)) && !ARROW.test(m[1])) {
            out.phiTicks.push({ who: m[1].trim(), amount: Number(m[3].replace(/\s/g, "")), reason: reasonOf(m[4]) });
            continue;
        }
        // A → B: X_acc +n (reason) | Y_acc +n (reason)
        if ((m = line.match(/^(.+?)\s*(?:→|->|↔|<->|=>)\s*(.+?)\s*:\s*(.+)$/))) {
            let any = false;
            for (const part of m[3].split("|")) {
                const mm = part.trim().match(/^([A-Za-z]+)(?:_acc)?\s*([+-]\s*\d+)\s*(.*)$/);
                const k = mm && axisKey(mm[1]);
                if (k && !isPhi(mm[1])) {
                    out.ticks.push({ from: m[1].trim(), to: m[2].trim(), acc: k, amount: Number(mm[2].replace(/\s/g, "")), reason: reasonOf(mm[3]) });
                    any = true;
                }
            }
            if (any) continue;
        }
        out.unparsed.push(line);
    }
    return out;
}

/** The reader's notice for relationship lines that did nothing: each refusal's reason and each unreadable line; "" when none. */
export function relationsNotice(log, unparsed) {
    const refused = (log || []).filter(l => l.kind === "refused").map(l => l.text);
    const unread = (unparsed || []).map(l => `could not read: "${l}"`);
    const all = [...refused, ...unread];
    return all.length ? `${all.length} relationship line(s) could not be applied: ${all.join("; ")}` : "";
}
