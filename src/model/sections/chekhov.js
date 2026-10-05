// ──────────────────────────────────────────────────────────────────────────────
// 🔫 CHEKHOV'S GUN — setups a reader would notice going unpaid ("bullets"). The model
// loads and fires them; the ledger ages them, unlocks them, prunes old ones and says
// before each reply which are due and which may fire. Who picks the moment is a
// setting: the model, or (phase 4) Fate. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW } from "../text.js";
import { nextId } from "../state.js";
import { parseStoryTime, lockTime, isAtOrPast } from "../storytime.js";

const cfgOf = ctx => (ctx && ctx.config && ctx.config.sectionConfig && ctx.config.sectionConfig.chekhov) || {
    eligibleAge: 6, pruneAge: 12, cap: 20, maxLoadsPerTurn: 1, firedKeep: 10, firing: "model",
};

// "·" separates a bullet's tags, so a lock reason writes its own "·" as an entity.
const escTag = v => esc(v).replace(/·/g, "&#183;");
const unescTag = v => unesc(String(v).replace(/&#183;/g, "·"));
const pad = n => String(n).padStart(2, "0");
const timeText = at => `${at.day !== null && at.day !== undefined ? `Day ${at.day} ` : ""}${pad(Math.floor(at.minutes / 60))}:${pad(at.minutes % 60)}`;
const byId = (list, id) => list.find(b => b.id.toLowerCase() === String(id).toLowerCase());

/** True while a lock, a time lock or an unfired dependency holds the bullet. */
export function isLocked(b, state) {
    if (b.lock || b.at) return true;
    return Boolean(b.after) && !state.chekhov.fired.some(f => f.id.toLowerCase() === b.after.toLowerCase());
}

/** A time-locked bullet whose hour has come (by the scene's Now line). */
export const isDue = (b, state) => Boolean(b.at) && isAtOrPast(parseStoryTime(state.scene.now), b.at);

/** May fire: unlocked, old enough, and a secret is not exposed to a crowd (more than 2 present). */
export function eligible(b, state, cfg) {
    if (isLocked(b, state) || b.age < cfg.eligibleAge) return false;
    return !(b.secret && (state.scene.present || []).length > 2);
}

/** Loaded bullets that exist because of something {{user}} said or did. */
export const hotCount = state => ((state.chekhov && state.chekhov.bullets) || []).filter(b => b.hot).length;

function toFired(state, b, how) {
    state.chekhov.bullets = state.chekhov.bullets.filter(x => x !== b);
    state.chekhov.fired.push({ id: b.id, desc: b.desc, how });
}

function parseLoad(text, state) {
    const m = text.match(/^load\s*:\s*(.+?)\s*\(([^()]*)\)\s*$/i);
    if (!m) return null;
    const b = { desc: m[1].trim(), weight: 0, age: 0, hot: false, secret: false, lock: "", at: null, after: "" };
    for (const raw of m[2].split(",").map(t => t.trim()).filter(Boolean)) {
        let o;
        if ((o = raw.match(/^w\s*([123])$/i))) b.weight = Number(o[1]);
        else if (/^hot$/i.test(raw)) b.hot = true;
        else if (/^secret$/i.test(raw)) b.secret = true;
        else if ((o = raw.match(/^at\s+(.+)$/i))) { b.at = lockTime(o[1], parseStoryTime(state.scene.now)); if (!b.at) return null; }
        else if ((o = raw.match(/^after\s+(B\d+)$/i))) b.after = o[1].toUpperCase();
        else return null;
    }
    return b.weight ? b : null;
}

export default {
    key: "chekhov",
    title: "🔫 CHEKHOV'S GUN",
    match: /^CHEKHOV S GUN$/,
    change: "Chekhov",
    carried: true,
    empty: () => ({ bullets: [], fired: [] }),
    render(value, ctx) {
        const cfg = cfgOf(ctx);
        const fakeState = { chekhov: value, scene: { now: "", present: [] } };
        return [
            ...value.bullets.map(b => {
                const tags = [`w${b.weight}`, `age ${b.age}/${cfg.pruneAge}`];
                if (b.hot) tags.push("hot");
                if (b.secret) tags.push("secret");
                if (b.lock) tags.push(`LOCKED ${escTag(b.lock)}`);
                if (b.at) tags.push(`at ${timeText(b.at)}`);
                if (b.after) tags.push(`after ${b.after}`);
                if (!isLocked(b, fakeState) && b.age >= cfg.eligibleAge) tags.push("eligible");
                return `- <b>${b.id}</b> ${esc(b.desc)} | ${tags.join(" · ")}`;
            }),
            ...value.fired.map(f => `- <b>${f.id}</b> ${esc(f.desc)} | fired: ${esc(f.how)}`),
        ];
    },
    parse(rows, prevValue) {
        const value = { bullets: [], fired: [] }, errors = [];
        for (const row of rows) {
            const m = row.match(ROW);
            const id = m && m[1].trim().match(/^B\d+$/i) ? m[1].trim().toUpperCase() : null;
            const bar = m ? m[2].indexOf("|") : -1;
            if (!id || bar < 0) { errors.push(row); continue; }
            const desc = unesc(m[2].slice(0, bar));
            const meta = m[2].slice(bar + 1).trim();
            const fired = meta.match(/^fired\s*:\s*(.*)$/i);
            if (fired) { value.fired.push({ id, desc, how: unesc(fired[1]) }); continue; }
            const b = { id, desc, weight: 0, age: 0, hot: false, secret: false, lock: "", at: null, after: "" };
            let ok = true;
            for (const tag of meta.split("·").map(t => t.trim()).filter(Boolean)) {
                let o;
                if ((o = tag.match(/^w([123])$/i))) b.weight = Number(o[1]);
                else if ((o = tag.match(/^age\s+(\d+)(?:\s*\/\s*\d+)?$/i))) b.age = Number(o[1]);
                else if (/^hot$/i.test(tag)) b.hot = true;
                else if (/^secret$/i.test(tag)) b.secret = true;
                else if (/^eligible$/i.test(tag)) { /* display only */ }
                else if ((o = tag.match(/^LOCKED\s+(.+)$/))) b.lock = unescTag(o[1]);
                else if ((o = tag.match(/^at\s+(?:Day\s+(\d+)\s+)?(\d{1,2}):(\d{2})$/i))) b.at = { day: o[1] ? Number(o[1]) : null, minutes: Number(o[2]) * 60 + Number(o[3]) };
                else if ((o = tag.match(/^after\s+(B\d+)$/i))) b.after = o[1].toUpperCase();
                else ok = false;
            }
            if (ok && b.weight) value.bullets.push(b);
            else {
                errors.push(row);
                const old = prevValue && byId(prevValue.bullets || [], id);
                if (old) value.bullets.push(old);
            }
        }
        return { value, errors };
    },
    apply(state, lines, ctx) {
        const cfg = cfgOf(ctx);
        const unparsed = [];
        let loads = 0;
        for (const raw of lines) {
            const line = String(raw).trim();   // parseChanges already removed the list bullet
            let m, b;
            if (/^load\s*:/i.test(line)) {
                const nb = parseLoad(line, state);
                if (!nb) { unparsed.push(line); continue; }
                nb.id = nextId(state, "B", [...state.chekhov.bullets, ...state.chekhov.fired].map(x => x.id));
                state.chekhov.bullets.push({ id: nb.id, desc: nb.desc, weight: nb.weight, age: 0, hot: nb.hot, secret: nb.secret, lock: "", at: nb.at, after: nb.after });
                ctx.touched.add(`chekhov:${nb.id}`);
                if (++loads > cfg.maxLoadsPerTurn) ctx.warnings.push({ section: "Chekhov", text: `More than ${cfg.maxLoadsPerTurn} setup loaded in one reply (${nb.id} "${nb.desc}" kept).` });
            } else if ((m = line.match(/^fire\s+(B\d+)\s*:\s*(.+)$/i)) && (b = byId(state.chekhov.bullets, m[1]))) {
                if (!eligible(b, state, cfg) && !isDue(b, state)) ctx.warnings.push({ section: "Chekhov", text: `${b.id} "${b.desc}" fired before it was eligible.` });
                toFired(state, b, m[2].trim());
            } else if ((m = line.match(/^lock\s+(B\d+)\s*:\s*(.+)$/i)) && (b = byId(state.chekhov.bullets, m[1]))) b.lock = m[2].trim();
            else if ((m = line.match(/^unlock\s+(B\d+)$/i)) && (b = byId(state.chekhov.bullets, m[1]))) { b.lock = ""; b.at = null; }
            else if ((m = line.match(/^prune\s+(B\d+)$/i)) && (b = byId(state.chekhov.bullets, m[1]))) toFired(state, b, "pruned");
            else unparsed.push(line);
        }
        return unparsed;
    },
    after(state, ctx) {
        const cfg = cfgOf(ctx);
        for (const b of state.chekhov.bullets) if (!isLocked(b, state) && !ctx.touched.has(`chekhov:${b.id}`)) b.age += 1;
        for (const b of [...state.chekhov.bullets]) if (!isLocked(b, state) && !isDue(b, state) && b.age >= cfg.pruneAge) toFired(state, b, "pruned");
        while (state.chekhov.bullets.length > cfg.cap) {
            const victim = [...state.chekhov.bullets].sort((a, z) => a.weight - z.weight || z.age - a.age)[0];
            toFired(state, victim, "pruned");
        }
        if (cfg.firedKeep > 0 && state.chekhov.fired.length > cfg.firedKeep) state.chekhov.fired = state.chekhov.fired.slice(-cfg.firedKeep);
    },
    facts(state, ctx) {
        const cfg = cfgOf(ctx);
        const out = [];
        for (const b of state.chekhov.bullets.filter(x => isDue(x, state))) out.push(`Due now: ${b.id} "${b.desc}" [at ${timeText(b.at)}] — fire it this turn.`);
        if (cfg.firing !== "fate") {
            const ready = state.chekhov.bullets.filter(b => eligible(b, state, cfg))
                .sort((a, z) => z.weight - a.weight || z.age - a.age)
                .map(b => `${b.id} "${b.desc}" (w${b.weight}${b.hot ? ", hot" : ""})`);
            if (ready.length) out.push(`Eligible to fire when the moment is right: ${ready.join("; ")}.`);
        }
        return out;
    },
    prompt(value, state, ctx) {
        const cfg = cfgOf(ctx);
        const rows = value.bullets.map(b => {
            const tags = [`w${b.weight}`, `age ${b.age}/${cfg.pruneAge}`];
            if (b.hot) tags.push("hot");
            if (b.secret) tags.push("secret");
            if (isDue(b, state)) tags.push("DUE");
            else if (eligible(b, state, cfg)) tags.push("eligible");
            else if (b.lock) tags.push(`locked: ${b.lock}`);
            else if (b.at) tags.push(`at ${timeText(b.at)}`);
            else if (b.after && isLocked(b, state)) tags.push(`after ${b.after}`);
            return `- ${b.id} ${b.desc} · ${tags.join(" · ")}`;
        });
        return rows.length ? ["Chekhov (narrative debt — never name it in prose):", ...rows].join("\n") : "";
    },
    rules(ctx) {
        const cfg = cfgOf(ctx);
        return [
            "Chekhov's Gun: load a setup only when the prose leaves narrative debt a reader would notice going unpaid — an unresolved setup, a promise, foreshadowing, a planted object, emotional tension. Ambient scenery, small talk and passing business load nothing.",
            `At most ${cfg.maxLoadsPerTurn} load per reply. Weight 1–3 by how much it matters. Mark it hot only when it exists because of something {{user}} said or did. A future time ("at noon", "in an hour") becomes an \`at\` lock from the story time. \`after B#\` makes it wait for another setup. A secret stays held while more than 2 people are present.`,
            cfg.firing === "fate"
                ? "Firing: a bullet fires only when the turn says so (Fate's pick), or when it is due; pay it off naturally and never narrate the mechanics."
                : "Firing: you judge the moment — fire an eligible bullet when the story offers a natural opening, never forced; a due bullet fires when its hour comes. Pay it off naturally and never narrate the mechanics.",
        ].join("\n");
    },
    template: () => ["Chekhov:", "- [load: setup (w1–3[, hot][, secret][, at HH:MM][, after B#]) · fire B#: how it paid off · lock B#: why · unlock B# · prune B#]"],
};
