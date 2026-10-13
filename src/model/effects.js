// ──────────────────────────────────────────────────────────────────────────────
// ✨ EFFECTS — what a title or condition does: numeric roll bonuses, proficiencies
// and narrative notes. Reads and writes the effect grammar, reads old hand-pasted
// title lists, merges duplicate entries, and applies the per-roll bonus caps. Pure.
// ──────────────────────────────────────────────────────────────────────────────

const CATEGORIES = ["physical", "social", "mental"];
const SOCIAL_ALIASES = new Set(["emotional", "comedy", "trust", "intimacy"]);
const NUMERIC = /^([+-])(\d+)\s+(physical|social|mental|emotional|comedy|trust|intimacy)\b\s*:?\s*(.*)$/i;
const SIGNED_WORD = /^[+-]\d+\s+([^\s:;,()]+)/;
const PROFICIENCY = /^proficiency\s*:\s*(.+)$/i;
const JUNK = /^(all prior|all previous|—)$/i;
const HAS_SIGNED_NUMBER = /(?<!\w)[+-]\d/;

const fold = s => String(s ?? "").replace(/[−–]/g, "-");
const unescSemi = s => s.replace(/&#59;/g, ";");
const escSemi = s => s.replace(/;/g, "&#59;");

/** Split on any character of `seps` that sits outside parentheses. */
function splitTop(text, seps) {
    const out = [];
    let depth = 0, cur = "";
    for (const ch of String(text ?? "")) {
        if (ch === "(") depth++;
        else if (ch === ")") depth = Math.max(0, depth - 1);
        if (depth === 0 && seps.includes(ch) && !(ch === ";" && cur.endsWith("&#59"))) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out;
}

/** One piece → { effect, warning? }; effect is null when a number is out of range. */
function parsePiece(piece) {
    const text = fold(piece).trim();
    const prof = text.match(PROFICIENCY);
    if (prof) return { effect: { kind: "proficiency", skill: unescSemi(prof[1].trim()) } };
    const num = text.match(NUMERIC);
    if (num) {
        const n = Number(num[2]) * (num[1] === "-" ? -1 : 1);
        if (n === 0 || Math.abs(n) > 2) return { effect: null, warning: `"${text}" is out of range (use ±1 or ±2)` };
        const label = num[3].toLowerCase(), social = SOCIAL_ALIASES.has(label);
        const focus = unescSemi(num[4].trim());
        return { effect: { kind: "numeric", n, category: social ? "social" : label, focus: social ? [label, focus].filter(Boolean).join(", ") : focus } };
    }
    const odd = text.match(SIGNED_WORD);
    const narrative = { kind: "narrative", text: unescSemi(String(piece).trim()) };
    return odd && !CATEGORIES.includes(odd[1].toLowerCase())
        ? { effect: narrative, warning: `unknown category "${odd[1]}"` }
        : { effect: narrative };
}

const isStructured = r => r.effect && r.effect.kind !== "narrative";

/**
 * Read an effect list. `legacy` also splits on `,`, but only where every comma-piece
 * is numeric or proficiency. `complete` is true when every piece was numeric or proficiency.
 */
export function parseEffects(text, { legacy = false } = {}) {
    const effects = [], warnings = [];
    let complete = true, any = false;
    for (const raw of splitTop(text, ";")) {
        if (!raw.trim()) continue;
        let pieces = [raw];
        if (legacy) {
            const commas = splitTop(raw, ",").filter(p => p.trim());
            if (commas.length > 1 && commas.every(p => isStructured(parsePiece(p)))) pieces = commas;
        }
        for (const p of pieces) {
            any = true;
            const r = parsePiece(p);
            if (r.warning) warnings.push(r.warning);
            if (r.effect) effects.push(r.effect);
            if (!isStructured(r)) complete = false;
        }
    }
    return { effects, warnings, complete: any && complete };
}

/** Effects back to canonical text, joined with "; ". */
export function formatEffects(effects) {
    return (effects || []).map(e => {
        if (e.kind === "numeric") {
            return `${e.n < 0 ? "-" : "+"}${Math.abs(e.n)} ${e.category}${e.focus ? `: ${escSemi(e.focus)}` : ""}`;
        }
        if (e.kind === "proficiency") return `proficiency: ${escSemi(e.skill)}`;
        return escSemi(e.text);
    }).join("; ");
}

/** A balanced trailing parenthetical → { name, inner }, or null (also when no name precedes it). */
function trailingParen(piece) {
    if (!piece.endsWith(")")) return null;
    let depth = 0;
    for (let i = piece.length - 1; i >= 0; i--) {
        if (piece[i] === ")") depth++;
        else if (piece[i] === "(" && --depth === 0) {
            const name = piece.slice(0, i).trim();
            return name ? { name, inner: piece.slice(i + 1, -1).trim() } : null;
        }
    }
    return null;
}

const baseName = name => trailingParen(name)?.name ?? name;

/** Strip list noise from one piece → { text, dropped, label } (label: it was a Status:/Mods: piece). */
function cleanPiece(raw) {
    let text = raw.trim();
    const dropped = [];
    const prior = text.match(/^(all prior|all previous)\s*\+\s*/i);
    if (prior) { dropped.push(prior[1]); text = text.slice(prior[0].length); }
    for (let prev = ""; prev !== text;) {
        prev = text;
        text = text.replace(/^\+\s*/, "").replace(/^NEW\s*:\s*/i, "").trim();
    }
    if (/^(status|mods)\s*:/i.test(text)) return { text: "", dropped: [...dropped, text], label: true };
    if (!text || JUNK.test(text)) {
        if (text) dropped.push(text);
        return { text: "", dropped };
    }
    return { text, dropped };
}

/**
 * Merge duplicate entries. Names equal ignoring case always merge. When `loose(entry)` holds for
 * either side (entries from the legacy reader), two names also merge when they share a base name
 * (a trailing parenthetical ignored) and one of them IS that base name: "Casino Architect" absorbs
 * "Casino Architect (earned …)", but "Bitten (First)" and "Bitten (Second)" stay apart. The merged
 * entry keeps effects, or else a hint, from whichever side has them.
 */
export function mergeEntries(list, { loose = () => false } = {}) {
    const out = [], looseOut = new Set();
    const lower = s => String(s).toLowerCase();
    for (const e of list || []) {
        const name = lower(e.name), base = lower(baseName(e.name)), isLoose = loose(e);
        let have = out.find(h => lower(h.name) === name);
        if (!have) {
            const near = out.filter(h => (isLoose || looseOut.has(h)) && lower(baseName(h.name)) === base && (name === base || lower(h.name) === base));
            if (near.length === 1) have = near[0];
        }
        if (!have) {
            const copy = { name: e.name, effects: [...(e.effects || [])], hint: e.hint || "" };
            if (isLoose) looseOut.add(copy);
            out.push(copy);
            continue;
        }
        if (isLoose) looseOut.add(have);
        if (lower(have.name) !== name) have.name = baseName(have.name);
        if (!have.effects.length && e.effects?.length) { have.effects = [...e.effects]; have.hint = ""; }
        else if (!have.effects.length && !have.hint && e.hint) have.hint = e.hint;
    }
    return out;
}

/**
 * Read an older or hand-pasted Titles/Status list. Splits outside parentheses (on `;`
 * if any, else `,`; `|` always), drops list noise, reads a trailing parenthetical as
 * effects, a hint, or part of the name, and merges duplicates.
 */
export function readLegacyList(text) {
    const flat = String(text ?? "");
    const seps = splitTop(flat, ";").length > 1 ? ";|" : ",|";
    const entries = [], dropped = [];
    let leaked = false;   // after a Status:/Mods: piece, the rest of the row is status, not titles
    for (const raw of splitTop(flat, seps)) {
        if (leaked) { if (raw.trim()) dropped.push(raw.trim()); continue; }
        const c = cleanPiece(raw);
        leaked = Boolean(c.label);
        dropped.push(...c.dropped);
        if (!c.text) continue;
        const paren = trailingParen(c.text);
        if (paren) {
            const parsed = parseEffects(paren.inner, { legacy: true });
            if (parsed.complete && parsed.effects.length) {
                entries.push({ name: paren.name, effects: parsed.effects, hint: "" });
                continue;
            }
            if (HAS_SIGNED_NUMBER.test(fold(paren.inner))) {
                entries.push({ name: paren.name, effects: [], hint: paren.inner });
                continue;
            }
        }
        entries.push({ name: c.text, effects: [], hint: "" });
    }
    return { entries: mergeEntries(entries, { loose: () => true }), dropped };
}

/** A raw bonus under the soft cap (half the excess, rounded down) and the hard cap. */
export function capBonus(raw, { softCap, hardCap }) {
    if (raw <= softCap) return { value: raw, cap: "" };
    const reduced = softCap + Math.floor((raw - softCap) / 2);
    if (reduced > hardCap) return { value: hardCap, cap: "hard cap" };
    return { value: reduced, cap: "soft cap" };
}
