// ──────────────────────────────────────────────────────────────────────────────
// Ancient Access <ledger> → Story Ledger state. KEY: lines, continued on the
// following lines until the next KEY:. SCENE (free prose) and BONDS go to the
// handover; per-turn lines (WORLD, CHECK, THOUGHTS) are skipped. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { emptyState, nextId } from "../state.js";
import { importFromLegacyNotebook } from "../notebook.js";
import { lockTime, parseStoryTime } from "../storytime.js";
import { plain, value, listOf, headerNow } from "./util.js";

const PER_TURN = new Set(["WORLD", "CHECK", "THOUGHTS"]);
const TO_HANDOVER = new Set(["SCENE", "BONDS", "OFFSCREEN"]);

/** KEY → lines (the KEY: line's text first, then continuation lines). */
function fieldsOf(body) {
    const out = {};
    let key = null;
    for (const raw of String(body).split(/\r?\n/)) {
        const m = raw.match(/^\s*([A-Z][A-Z &]{1,20}):\s*(.*)$/);
        if (m) { key = m[1].trim(); out[key] = m[2].trim() ? [m[2].trim()] : []; continue; }
        if (key && raw.trim()) out[key].push(raw.trim().replace(/^[-*•]\s*/, ""));
    }
    return out;
}

const dot = line => line.split(/\s+·\s+/).map(p => p.trim());

/** The state an AA reply's <ledger> holds, as far as it can be read. */
export function parseAa(mes) {
    const s = emptyState();
    const imported = [], unread = [], rules = [];
    const body = (String(mes).match(/<ledger\b[^>]*>([\s\S]*?)(?:<\/ledger>|$)/i) || [])[1] || "";
    const f = fieldsOf(body);
    const now = headerNow(mes);
    if (now) { s.scene.now = now; imported.push("scene"); }
    const clock = parseStoryTime(s.scene.now);
    const mark = k => { if (!imported.includes(k)) imported.push(k); };

    for (const [key, lines] of Object.entries(f)) {
        if (PER_TURN.has(key) || key === "NOTEBOOK") continue;
        if (TO_HANDOVER.has(key)) { if (lines.some(l => value(l))) unread.push(key); continue; }
        let n = 0;
        if (key === "TURN") { const t = parseInt(lines[0], 10); if (Number.isFinite(t)) { s.ct = t; mark("ct"); n++; } }
        else if (key === "LAST") {
            s.last = lines.flatMap(l => l.split(/\s+\/\s+/)).map(value).filter(Boolean);
            if (s.last.length) { mark("last"); n++; }
        } else if (key === "AGENDAS") {
            for (const l of lines) {
                const [name, task, step, place, where] = dot(l);
                const st = (step || "").match(/step\s+(\d+)\s*\/\s*(\d+)/i);
                if (!name || !task || !st) continue;
                s.agendas[plain(name)] = { task: value(task), step: Number(st[1]), max: Number(st[2]), aware: "", fibs: "", circle: "", body: "" };
                if (value(place)) s.locations[plain(name)] = value(place);
                n++;
                void where;
            }
            if (n) { mark("agendas"); if (Object.keys(s.locations).length) mark("locations"); }
        } else if (key === "GUN") {
            for (const l of lines) {
                const parts = dot(l);
                const desc = value(parts[0]);
                const w = l.match(/weight\s*(\d)/i), age = l.match(/age\s*(\d+)/i);
                if (!desc || !w) continue;
                const b = { id: "", desc, weight: Math.min(3, Math.max(1, Number(w[1]))), age: age ? Number(age[1]) : 0,
                    hot: /\[hot\]/i.test(l), secret: /\[secret\]/i.test(l), lock: "", at: null, after: "" };
                const lock = l.match(/\[LOCKED:\s*([^\]]+)\]/i) || l.match(/\[(TIME|CHAR|PLACE|DEP)[^\]]*\]/i);
                if (lock) {
                    b.at = lock[1] && /\d{1,2}:\d{2}|\d\s*[ap]m/i.test(lock[1]) ? lockTime(lock[1], clock) : null;
                    if (!b.at) b.lock = plain(lock[0]).replace(/^\[|\]$/g, "");
                }
                b.id = nextId(s, "B", s.chekhov.bullets.map(x => x.id));
                s.chekhov.bullets.push(b);
                n++;
            }
            if (n) mark("chekhov");
        } else if (key === "FIRED") {
            for (const d of lines.flatMap(listOf)) {
                s.chekhov.fired.push({ id: nextId(s, "B", [...s.chekhov.bullets, ...s.chekhov.fired].map(x => x.id)), desc: d, how: "fired before Story Ledger" });
                n++;
            }
            if (n) mark("chekhov");
        } else if (key === "GEAR") {
            s.inv.items = lines.flatMap(listOf);
            if (s.inv.items.length) { mark("inv"); n++; }
        } else if (key === "QUESTS") {
            for (const l of lines) {
                const m = plain(l).match(/^(?:(Main|Side)\s*[—–:-]\s*)?(.+)$/i);
                if (!m || !value(m[2])) continue;
                const kind = m[1] ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : "Side";
                s.quests.push({ id: nextId(s, "Q", s.quests.map(q => q.id)), kind, status: /\b(done|completed)\b/i.test(l) ? "done" : "active",
                    objective: value(m[2]).replace(/\s*\((done|completed)\)\s*$/i, ""), progress: "", reward: "", send: false });
                n++;
            }
            if (n) mark("quests");
        } else if (key === "FACTIONS") {
            for (const l of lines) {
                const m = plain(l).match(/^(.+?)\s*[—–:]\s*(.+)$/);
                if (!m) continue;
                s.factions[m[1].trim()] = { goal: m[2].trim(), intel: "", fibs: "", state: "", conflict: "", relations: "" };
                n++;
            }
            if (n) mark("factions");
        }
        if (!n && lines.some(l => value(l))) unread.push(key);
    }
    const nb = importFromLegacyNotebook([{ is_user: false, mes }]);
    if (nb.rules.length || nb.threads.length) { rules.push(...nb.rules); s.threads = nb.threads; mark("threads"); }
    return { state: s, imported, rules, unread };
}
