// ──────────────────────────────────────────────────────────────────────────────
// Ancient Access <ledger> → Story Ledger state. KEY: lines, continued on the
// following lines until the next KEY:. SCENE and OFFSCREEN (free prose) are quoted
// to the handover; BONDS await the model's NEW lines; per-turn lines (WORLD, CHECK,
// THOUGHTS) are skipped. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { emptyState, nextId } from "../state.js";
import { importFromLegacyNotebook } from "../notebook.js";
import { lockTime, parseStoryTime } from "../storytime.js";
import { readLegacyList } from "../effects.js";
import { plain, value, listOf, headerNow, nowResolved, nowUnread, sameName, bondsOf, quoted } from "./util.js";

const PER_TURN = new Set(["WORLD", "CHECK", "THOUGHTS"]);
const TO_HANDOVER = new Set(["SCENE", "OFFSCREEN"]);

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
export function parseAa(mes, config = {}) {
    const isUser = name => sameName(name, config.userName || "");
    const s = emptyState();
    const imported = [], unread = [], rules = [];
    const body = (String(mes).match(/<ledger\b[^>]*>([\s\S]*?)(?:<\/ledger>|$)/i) || [])[1] || "";
    const f = fieldsOf(body);
    const now = headerNow(mes);
    if (now) { s.scene.now = now; if (nowResolved(now)) imported.push("scene"); else unread.push(nowUnread(now)); }
    const clock = parseStoryTime(s.scene.now);
    const mark = k => { if (!imported.includes(k)) imported.push(k); };

    for (const [key, lines] of Object.entries(f)) {
        if (PER_TURN.has(key) || key === "NOTEBOOK") continue;
        if (TO_HANDOVER.has(key)) { if (lines.some(l => value(l))) unread.push(quoted(key, lines.join("\n"))); continue; }
        let n = 0;
        if (key === "BONDS") {
            // each bond awaits the model's NEW line, carrying what AA recorded
            s.rel.awaiting = bondsOf(lines, config.userName);
            n = Object.keys(s.rel.awaiting).length;
            if (n) mark("rel");
        } else if (key === "TURN") { const t = parseInt(lines[0], 10); if (Number.isFinite(t)) { s.ct = t; mark("ct"); n++; } }
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
                const w = l.match(/weight\s*:?\s*(\d)/i), age = l.match(/age\s*:?\s*(\d+)/i);
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
            for (const d of lines.map(value).filter(Boolean)) {   // one fired setup per line; a comma is part of it
                s.chekhov.fired.push({ id: nextId(s, "B", [...s.chekhov.bullets, ...s.chekhov.fired].map(x => x.id)), desc: d, how: "fired before Story Ledger" });
                n++;
            }
            if (n) mark("chekhov");
        } else if (key === "GEAR") {
            // AA's form: "{{user}} — items · skills & titles · conditions | {{char}} — items · conditions"
            for (const part of lines.flatMap(l => plain(l).split(/\s+\|\s+/))) {
                const who = part.match(/^(.+?)\s+[—–]\s+(.*)$/);
                if (!who) { s.inv.items.push(...listOf(part)); continue; }
                const [items, titles, status] = dot(who[2]);
                if (isUser(who[1])) {
                    s.inv.items.push(...listOf(items));
                    for (const [label, text, into] of [["Titles", titles, s.inv.titles], ["Status", status, s.inv.status]]) {
                        const { entries, dropped } = readLegacyList(value(text));
                        into.push(...entries);
                        for (const d of dropped) unread.push(`${label}: "${d}" was not a title — paste your full list into the block's Titles row.`);
                    }
                } else if (value(items)) {
                    s.cast[who[1].trim()] = { position: "", wearing: "", holding: value(items), condition: value(dot(who[2])[1]) };
                    mark("cast");
                }
            }
            if (s.inv.items.length || s.inv.titles.length || s.inv.status.length) { mark("inv"); n++; }
        } else if (key === "QUESTS") {
            // "Main — objective · progress n/target · status | Side — objective · status", or one quest per line
            const statusOf = t => (/^(done|completed|complete|finished)$/i.test(t) ? "done" : /^(dropped|failed|abandoned)$/i.test(t) ? "dropped" : "");
            for (const part of lines.flatMap(l => plain(l).split(/\s+\|\s+/))) {
                const m = part.match(/^(?:(Main|Side)\s*[—–:-]\s*)?(.+)$/i);
                if (!m || !value(m[2])) continue;
                const bits = dot(m[2]);
                let status = "", progress = "";
                const rest = bits.slice(1).filter(b => {
                    const p = b.match(/^progress\s*:?\s*(\d+\s*\/\s*\d+)$/i);
                    if (p) { progress = p[1].replace(/\s+/g, ""); return false; }
                    if (statusOf(b) || /^active$/i.test(b)) { status = statusOf(b) || "active"; return false; }
                    return true;
                });
                let objective = [bits[0], ...rest].map(value).filter(Boolean).join(" · ");
                const tail = objective.match(/\s*\((done|completed|dropped|failed)\)\s*$/i);
                if (tail) { status = status || statusOf(tail[1]); objective = objective.slice(0, tail.index).trim(); }
                if (!objective) continue;
                const kind = m[1] ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : "Side";
                s.quests.push({ id: nextId(s, "Q", s.quests.map(q => q.id)), kind, status: status || "active", objective, progress, reward: "", send: false });
                n++;
            }
            if (n) mark("quests");
        } else if (key === "FACTIONS") {
            for (const l of lines) {
                const text = plain(l);
                const parts = dot(text);
                if (parts.length >= 2) {
                    // AA's form: name · goal · what they know · lies they're telling · internal state · stance toward others
                    const [name, goal, intel, fibs, state, relations] = parts;
                    s.factions[name] = { goal: value(goal), intel: value(intel), fibs: value(fibs), state: value(state), conflict: "", relations: value(relations) };
                    n++;
                    continue;
                }
                const m = text.match(/^(.+?)\s*[—–:]\s*(.+)$/);
                if (!m) continue;
                s.factions[m[1].trim()] = { goal: m[2].trim(), intel: "", fibs: "", state: "", conflict: "", relations: "" };
                n++;
            }
            if (n) mark("factions");
        }
        if (!n && lines.some(l => value(l))) unread.push(quoted(key, lines.join("\n")));
    }
    const nb = importFromLegacyNotebook([{ is_user: false, mes }]);
    if (nb.rules.length || nb.threads.length) { rules.push(...nb.rules); s.threads = nb.threads; mark("threads"); }
    return { state: s, imported, rules, unread };
}
