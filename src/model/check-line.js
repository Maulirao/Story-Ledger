// ──────────────────────────────────────────────────────────────────────────────
// 🎲 CHECK LINE — reads a DnD check line and verifies it: the die, each named
// title or condition and its number, the caps, the total and the outcome band.
// {{user}}'s lines are checked against titles and conditions; other actors only
// for the die, the arithmetic and the outcome. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { capBonus } from "./effects.js";
import { nameMatches } from "./text.js";

const CATEGORIES = ["physical", "social", "mental"];
const SIGNED = "[+-]\\d+";
const SITUATIONAL = new RegExp(`\\+\\s*situational\\s+(${SIGNED})\\s*(?:\\(([^)]*)\\))?`, "gi");
// a source may carry a note after its number: `+ Mon Ancre +2 (Emilia)`
const SOURCE = new RegExp(`\\+\\s*(.+?)\\s+(${SIGNED})(?:\\s*\\([^)]*\\))?(?=\\s*(?:\\+\\s|=|$))`, "g");
// a captured name holding another number or `+ ` swallowed a neighbour: unread, not misverified
const SWALLOWED = /\s[+-]\d|\s\+\s/;
const SUM = new RegExp(`^(${SIGNED}|0)\\s*(?:(?:→|->)\\s*(${SIGNED}|0)\\s*(?:\\((soft cap|hard cap)\\))?)?$`, "i");

const fold = s => String(s ?? "").replace(/[−–]/g, "-");
const signed = n => (n < 0 ? `-${-n}` : `+${n}`);

/** The band for `total − DC`; a natural 20 or 1 decides on its own. */
export function outcomeBand(d20, delta) {
    if (d20 === 20) return "crit success";
    if (d20 === 1) return "crit failure";
    if (delta >= 8) return "crit success";
    if (delta <= -8) return "crit failure";
    if (delta >= 0) return "success";
    if (delta >= -3) return "near miss";
    return "failure";
}

/** The roll field after `d20 n` → sources, situational, legacy mod, sum; null when unreadable. */
function parseRoll(rest) {
    const text = fold(rest).trim();
    const out = { sources: [], situational: null, legacyMod: null, raw: null, capped: null };
    if (!text) return out;
    const legacy = text.match(new RegExp(`^(${SIGNED})$`));
    if (legacy) return { ...out, legacyMod: Number(legacy[1]) };
    const eq = text.indexOf("=");
    let body = eq < 0 ? text : text.slice(0, eq);
    if (eq >= 0) {
        const sum = text.slice(eq + 1).trim().match(SUM);
        if (!sum) return null;
        out.raw = Number(sum[1]);
        out.capped = sum[2] === undefined ? null : Number(sum[2]);
    }
    // a second situational stays a source named "situational", for the verifier to refuse
    body = body.replace(SITUATIONAL, (_, n, why) => {
        if (out.situational) out.sources.push({ name: "situational", n: Number(n) });
        else out.situational = { n: Number(n), why: String(why ?? "").trim() };
        return " ";
    });
    body = body.replace(SOURCE, (_, name, n) => { out.sources.push({ name: name.trim(), n: Number(n) }); return " "; });
    return body.trim() || out.sources.some(x => SWALLOWED.test(` ${x.name} `)) ? null : out;
}

/**
 * `Actor, action · category · DC n · d20 n [+ Source ±n]… [+ situational ±n (why)] = ±raw [→ ±capped (cap)] · total t · Outcome`
 * → the fields, or null when the line is not a DnD check line.
 */
export function parseCheckLine(line) {
    const fields = String(line ?? "").split(/\s+·\s+/).map(f => f.trim());
    if (fields.length < 4) return null;
    const head = fields[0];
    const comma = head.indexOf(",");
    const actor = (comma < 0 ? head : head.slice(0, comma)).trim();
    const action = comma < 0 ? "" : head.slice(comma + 1).trim();
    let i = 1, category = "";
    if (!/^DC\s+\d+$/i.test(fields[i])) category = fields[i++].toLowerCase();
    const dc = (fields[i++] || "").match(/^DC\s+(\d+)$/i);
    const roll = (fields[i++] || "").match(/^d20\s+(\d+)(.*)$/i);
    if (!actor || !dc || !roll) return null;
    let total = null;
    const t = fold(fields[i] || "").match(/^total\s+(-?\d+)$/i);
    if (t) { total = Number(t[1]); i++; }
    if (i !== fields.length - 1 || !fields[i]) return null;
    const r = parseRoll(roll[2]);
    if (!r) return null;
    return {
        actor, action, category, dc: Number(dc[1]), d20: Number(roll[1]),
        sources: r.sources, situational: r.situational, legacyMod: r.legacyMod,
        raw: r.raw, capped: r.capped, total, outcome: fields[i],
    };
}

// `Nat 20, critical success`, `Crit Fail`, `failed`, `successful` all name their band
const normOutcome = s => String(s ?? "").toLowerCase().replace(/[-_—–]/g, " ").replace(/\s+/g, " ").trim()
    .replace(/^nat(?:ural)?\s*\d+\s*[,:]?\s*/, "")
    .replace(/\bcritical\b/g, "crit")
    .replace(/\b(?:fail|fails|failed)\b/g, "failure")
    .replace(/\bsuccessful\b/g, "success");
/** The written outcome names `band` (anything after the band's words is ignored). */
const outcomeIs = (written, band) => {
    const w = normOutcome(written);
    return w.startsWith(band) && !/[a-z]/.test(w.charAt(band.length));
};

/** One user source against titles and conditions → { n (counted, 0 if none), problem? }. */
function checkSource(source, inv, category) {
    const entries = [...(inv?.titles || []), ...(inv?.status || [])];
    const hits = nameMatches(entries.map(e => e.name), source.name);
    if (!hits.length) return { n: 0, problem: `"${source.name}" is not a title or condition` };
    const entry = entries[hits[0]];
    const numeric = (entry.effects || []).filter(e => e.kind === "numeric" && (!CATEGORIES.includes(category) || e.category === category));
    if (numeric.some(e => e.n === source.n)) return { n: source.n, name: entry.name };
    if (!numeric.length) return { n: 0, name: entry.name, problem: `${entry.name} has no bonus in the ${category || "any"} category` };
    return { n: numeric[0].n, name: entry.name, problem: `${entry.name} is ${numeric.map(e => signed(e.n)).join(" or ")} ${category}, not ${signed(source.n)}` };
}

/**
 * A parsed line against the die it should use and the inventory →
 * { ok, problems, ledgerLine } (ledgerLine is "" when ok).
 */
export function verifyCheck(parsed, { die, inv, user, caps }) {
    // die: the n-th die; undefined when the dice ran out, null when none were rolled this turn
    const problems = [];
    const { softCap = 3, hardCap = 6, situationalMax = 2 } = caps || {};
    const isUser = parsed.actor === "{{user}}" || (Boolean(user) && parsed.actor.toLowerCase() === String(user).toLowerCase());

    if (die === undefined) problems.push("no die left for this check");
    else if (die !== null && die !== parsed.d20) problems.push(`die is ${die}, not ${parsed.d20}`);
    const d20 = die ?? parsed.d20;

    // the line's own arithmetic, and the ledger's corrected sources
    const situational = parsed.situational ? parsed.situational.n : 0;
    const legacy = parsed.sources.length ? 0 : (parsed.legacyMod || 0);
    const ownRaw = parsed.sources.reduce((a, s) => a + s.n, 0) + situational + legacy;
    let ownBonus = ownRaw, bonus, ledgerSources, ledgerSituational = parsed.situational, ledgerCap = "";

    if (isUser) {
        if (!parsed.category) problems.push("no category (physical, social or mental)");
        else if (!CATEGORIES.includes(parsed.category)) problems.push(`category "${parsed.category}" is not physical, social or mental`);
        if (legacy) problems.push(`bonus ${signed(legacy)} has no named source`);
        const seen = new Set();
        ledgerSources = [];
        for (const s of parsed.sources) {
            if (s.name.toLowerCase() === "situational") { problems.push("only one situational per check"); continue; }
            const c = checkSource(s, inv, parsed.category);
            if (c.problem) problems.push(c.problem);
            const key = (c.name || s.name).toLowerCase();
            if (c.name && seen.has(key)) { problems.push(`${c.name} is named twice`); continue; }
            seen.add(key);
            if (c.n) ledgerSources.push({ name: c.name, n: c.n });
        }
        if (Math.abs(situational) > situationalMax) {
            problems.push(`situational ${signed(situational)} is over ±${situationalMax}`);
            ledgerSituational = { ...parsed.situational, n: Math.sign(situational) * situationalMax };
        }
        const sitN = ledgerSituational ? ledgerSituational.n : 0;
        const split = list => ({ pos: list.filter(s => s.n > 0).reduce((a, s) => a + s.n, 0), neg: list.filter(s => s.n < 0).reduce((a, s) => a + s.n, 0) });
        const own = split(parsed.sources), mine = split(ledgerSources);
        ownBonus = capBonus(own.pos, { softCap, hardCap }).value + own.neg + situational + legacy;
        const capped = capBonus(mine.pos, { softCap, hardCap });
        ledgerCap = capped.cap;
        bonus = capped.value + mine.neg + sitN + legacy;
        if (parsed.raw !== null && parsed.capped === null && ownBonus !== ownRaw) problems.push(`bonus ${signed(ownRaw)} is capped: → ${signed(ownBonus)}`);
    } else {
        // no caps for other actors, but a line that caps its own bonus is not wrong either
        ledgerSources = parsed.sources;
        const pos = parsed.sources.filter(x => x.n > 0).reduce((a, x) => a + x.n, 0);
        const cappedNpc = ownRaw - pos + capBonus(pos, { softCap, hardCap }).value;
        ownBonus = parsed.capped === cappedNpc ? cappedNpc : ownRaw;
        bonus = ownBonus;
    }

    if (parsed.raw !== null && parsed.raw !== ownRaw) problems.push(`= ${signed(parsed.raw)} should be ${signed(ownRaw)}`);
    if (parsed.capped !== null && parsed.capped !== ownBonus) problems.push(`→ ${signed(parsed.capped)} should be ${signed(ownBonus)}`);
    // each written step is checked against the step before it, so one slip is named once
    const effective = parsed.capped ?? parsed.raw ?? ownBonus;
    if (parsed.total !== null && parsed.total !== parsed.d20 + effective) problems.push(`total ${parsed.total} should be ${parsed.d20 + effective}`);
    if (parsed.total === null && parsed.legacyMod === null && (parsed.sources.length || parsed.situational)) problems.push("no total");

    const total = d20 + bonus;
    const band = outcomeBand(d20, total - parsed.dc);
    if (!outcomeIs(parsed.outcome, band)) problems.push(`outcome "${parsed.outcome}" should be ${band}`);

    if (!problems.length) return { ok: true, problems: [], ledgerLine: "" };
    const parts = ledgerSources.map(s => ` + ${s.name} ${signed(s.n)}`);
    if (ledgerSituational) parts.push(` + situational ${signed(ledgerSituational.n)}${ledgerSituational.why ? ` (${ledgerSituational.why})` : ""}`);
    let roll = `d20 ${d20}${parts.join("")}`;
    if (parts.length) {
        const raw = ledgerSources.reduce((a, s) => a + s.n, 0) + (ledgerSituational ? ledgerSituational.n : 0);
        roll += ` = ${signed(raw)}${raw !== bonus ? ` → ${signed(bonus)} (${ledgerCap})` : ""}`;
    } else if (legacy) roll += ` ${signed(legacy)}`;
    return { ok: false, problems, ledgerLine: `↳ ledger: ${roll} · total ${total} · ${band}` };
}
