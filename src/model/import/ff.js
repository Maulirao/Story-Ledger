// ──────────────────────────────────────────────────────────────────────────────
// Freaky / Realistic Frankenstein <internal_states> → Story Ledger state.
// Best effort: what a section's rows do not yield is reported in `unread` and
// left to the handover. Bonds are never mapped (12 axes cannot come from one
// number). Per-turn sections (thoughts, DnD, World Sim, physics) are skipped. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { emptyState, nextId } from "../state.js";
import { importFromLegacyNotebook } from "../notebook.js";
import { lockTime, parseStoryTime } from "../storytime.js";
import { plain, value, summarySections, rowsOf, rowFields, listOf, headerNow } from "./util.js";

const PER_TURN = /THOUGHTS|DND|WORLD SIM|PHYSICS|INTERNAL STATES/;

function agendas(rows, s) {
    let n = 0;
    for (const row of rows) {
        const { name, fields, rest } = rowFields(row);
        const step = rest.match(/\(?\s*Step\s+(\d+)\s*\/\s*(\d+)\s*\)?/i);
        if (!name || !("agenda" in fields)) continue;
        s.agendas[name] = {
            task: value(fields.agenda), step: step ? Number(step[1]) : 0, max: step ? Number(step[2]) : 0,
            aware: value(fields.aware), fibs: value(fields.fibs), circle: value(fields.circle), body: value(fields.body),
        };
        n++;
    }
    return n;
}

function locations(rows, s) {
    let n = 0;
    for (const row of rows) {
        const { name, fields } = rowFields(row);
        if (name && value(fields.location)) { s.locations[name] = value(fields.location); n++; }
    }
    return n;
}

function factions(rows, s) {
    let n = 0;
    for (const row of rows) {
        const { name, fields } = rowFields(row);
        if (!name || !["goal", "intel", "fibs", "state", "conflict", "relations"].some(k => k in fields)) continue;
        s.factions[name] = Object.fromEntries(["goal", "intel", "fibs", "state", "conflict", "relations"].map(k => [k, value(fields[k])]));
        n++;
    }
    return n;
}

function quests(rows, s) {
    let n = 0;
    for (const row of rows) {
        const { name, fields, rest } = rowFields(row);
        const kind = (name.match(/^(Main|Side)\b/i) || [])[1];
        if (!kind) continue;
        let objective = value(fields.objective);
        let status = /\b(completed|complete|done|finished)\b/i.test(rest) ? "done" : /\bdropped|failed|abandoned\b/i.test(rest) ? "dropped" : "active";
        if (!objective) {
            // FF form: "Main: Active — Objective | Progress: … | Reward: …"
            const head = plain(rest.split("|")[0]).replace(/^(active|completed|none)\s*[—–-]\s*/i, "");
            objective = value(head);
        }
        objective = objective.replace(/\s*\((completed|complete|done|finished|active)\)\s*$/i, "").trim();
        if (!objective || /^none$/i.test(objective)) continue;
        s.quests.push({ id: nextId(s, "Q", s.quests.map(q => q.id)), kind: kind[0].toUpperCase() + kind.slice(1).toLowerCase(), status,
            objective, progress: value(fields.progress), reward: value(fields.reward), send: false });
        n++;
    }
    return n;
}

function inventory(rows, s) {
    let n = 0;
    for (const row of rows) {
        const { name, rest } = rowFields(row);
        const label = name.toLowerCase();
        if (label === "inv" || label === "inventory") { s.inv.items = listOf(rest); n++; }
        else if (/^titles/.test(label)) { s.inv.titles = listOf(rest); n++; }
        else if (label === "status") { s.inv.status = listOf(rest); n++; }
        else if (label === "mods") { s.inv.mods = value(rest); n++; }
    }
    return n;
}

function chekhov(body, s) {
    const text = plain(body);
    const now = parseStoryTime(s.scene.now);
    const seg = name => { const m = text.match(new RegExp(`${name}\\s*:\\s*(.*?)(?=\\s·\\s(?:Active|Locked|Fired)\\s*:|$)`, "i")); return m ? m[1] : ""; };
    const bulletsIn = (part, lockedSeg) => {
        for (const m of part.matchAll(/\[BULLET:\s*([^\]]+)\]\s*\(\s*weight:\s*(\d)\s*,\s*age:\s*(\d+)(?:\s*\/\s*\d+)?\s*\)((?:\s*\[[^\]]*\])*)/gi)) {
            const flags = m[4] || "";
            const b = { id: "", desc: m[1].trim(), weight: Math.min(3, Math.max(1, Number(m[2]))), age: Number(m[3]),
                hot: /\[hot\]/i.test(flags), secret: /\[secret\]/i.test(flags), lock: "", at: null, after: "" };
            const lock = flags.match(/\[LOCKED:\s*([^\]]+)\]/i);
            if (lock) {
                const t = lock[1].replace(/^T\s*:\s*/i, "");
                b.at = lockTime(t, now);
                if (!b.at) b.lock = lock[1].trim();
            } else if (lockedSeg) b.lock = "imported lock";
            const dep = flags.match(/\[depends:\s*([^\]]+)\]/i);
            if (dep) b.lock = b.lock || `depends on ${dep[1].trim()}`;
            b.id = nextId(s, "B", s.chekhov.bullets.map(x => x.id));
            s.chekhov.bullets.push(b);
        }
    };
    bulletsIn(seg("Active"), false);
    bulletsIn(seg("Locked"), true);
    for (const f of listOf(seg("Fired").replace(/\[BULLET:\s*([^\]]+)\][^,]*/gi, "$1"))) {
        s.chekhov.fired.push({ id: nextId(s, "B", [...s.chekhov.bullets, ...s.chekhov.fired].map(x => x.id)), desc: f, how: "fired before Story Ledger" });
    }
    return s.chekhov.bullets.length + s.chekhov.fired.length;
}

function fate(rows, s) {
    const f = s.fate;
    let n = 0;
    for (const row of rows) {
        for (const part of row.split(/\s·\s(?=<b>)/)) {
            const { name, rest } = rowFields(part);
            const key = name.toLowerCase();
            if (key === "state") { if (/THREAD/i.test(rest)) f.state = "THREAD"; n++; }
            else if (key === "quiet") { const q = parseInt(rest, 10); if (Number.isFinite(q)) { f.q = q; n++; } }
            else if (key === "thread") { if (value(rest)) { f.pursuit = value(rest); n++; } }
            else if (key === "open") { const ts = parseInt(rest, 10); if (Number.isFinite(ts)) f.ts = ts; }
            else if (key === "deferred") {
                for (const m of value(rest).matchAll(/([^,(]+?)\s*\(\s*deferred\s*x\s*(\d+)\s*,\s*age\s*(\d+)\s*\)/gi)) {
                    f.deferred.push({ id: nextId(s, "D", f.deferred.map(d => d.id)), desc: m[1].trim(), times: Number(m[2]), age: Number(m[3])}); n++;
                }
            } else if (key === "world") {
                for (const m of value(rest).matchAll(/([^,(]+?)\s*\(\s*(ELSEWHERE|REGIONAL|LOCAL)\s*,\s*Reach\s*(\d)\s*,\s*age\s*(\d+)\s*\)/gi)) {
                    f.world.push({ id: nextId(s, "W", f.world.map(w => w.id)), desc: m[1].trim(), prox: m[2].toUpperCase(), reach: Number(m[3]), age: Number(m[4]) }); n++;
                }
            } else if (key === "ambitions") {
                for (const m of value(rest).matchAll(/([^,(]+?)\s*\(\s*progress\s*(\d)\s*\/\s*5\s*\)/gi)) { f.ambitions.push({ desc: m[1].trim(), progress: Number(m[2]) }); n++; }
            } else if (key === "residue") { for (const r of listOf(rest)) { f.residue.push(r); n++; } }
        }
    }
    if (f.state !== "THREAD") f.pursuit = "";
    return n;
}

/** The state an FF/RF reply's block holds, as far as it can be read. */
export function parseFf(mes) {
    const s = emptyState();
    const imported = [], unread = [], rules = [];
    const turn = String(mes).match(/INTERNAL STATES\s*\(Turn:\s*(\d+)\)/i);
    if (turn) s.ct = Number(turn[1]);
    const now = headerNow(mes);
    if (now) { s.scene.now = now; imported.push("scene"); }
    const handlers = [
        [/NPC AGENDAS/, sec => agendas(rowsOf(sec.body), s), "agendas"],
        [/NPC LOCATIONS/, sec => locations(rowsOf(sec.body), s), "locations"],
        [/^FACTIONS$/, sec => factions(rowsOf(sec.body), s), "factions"],
        [/^QUESTS$/, sec => quests(rowsOf(sec.body), s), "quests"],
        [/^INV/, sec => inventory(rowsOf(sec.body), s), "inv"],
        [/CHEKHOV/, sec => chekhov(sec.body, s), "chekhov"],
        [/FATE ROUTINE/, sec => fate(rowsOf(sec.body), s), "fate"],
    ];
    for (const sec of summarySections(String(mes))) {
        if (PER_TURN.test(sec.key) || /NOTEBOOK/.test(sec.key)) continue;
        const h = handlers.find(([re]) => re.test(sec.key));
        if (!h) { unread.push(sec.title); continue; }
        if (h[1](sec) > 0) { if (!imported.includes(h[2])) imported.push(h[2]); }
        else if (rowsOf(sec.body).some(r => value(r))) unread.push(sec.title);
    }
    const nb = importFromLegacyNotebook([{ is_user: false, mes }]);
    if (nb.rules.length || nb.threads.length) {
        rules.push(...nb.rules);
        s.threads = nb.threads;
        imported.push("threads");
    }
    if (s.ct) imported.push("ct");
    return { state: s, imported, rules, unread };
}
