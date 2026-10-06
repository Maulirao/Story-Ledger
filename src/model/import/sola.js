// ──────────────────────────────────────────────────────────────────────────────
// Sola's trackers → Story Ledger state: <story_notes> (rules, threads, seeds),
// <date>, <scene_cast>, <wardrobe>, <inventory>. Inventory is {{user}}'s alone in
// Story Ledger, so other people's held items go to the scene cast. Motives and
// Horizon are prose for the handover. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { emptyState, nextId } from "../state.js";
import { importFromLegacyNotebook } from "../notebook.js";
import { value, listOf, nowResolved, nowUnread, sameName } from "./util.js";

const tag = (mes, name) => (String(mes).match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i")) || [])[1] || "";
const field = (body, key) => { const m = String(body).match(new RegExp(`^\\s*${key}\\s*:\\s*(.*)$`, "im")); return m ? value(m[1]) : ""; };

/** "Name:" headed groups of "Key: value" lines (wardrobe, inventory). */
function people(body) {
    const out = {};
    let who = null;
    for (const raw of String(body).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const head = line.match(/^([^:]{1,40}):\s*$/);
        if (head) { who = head[1].trim(); out[who] = {}; continue; }
        const kv = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
        if (who && kv) out[who][kv[1].toLowerCase()] = kv[2];
    }
    return out;
}

const blankCast = () => ({ position: "", wearing: "", holding: "", condition: "" });

/** The state a Sola reply's trackers hold, as far as they can be read. */
export function parseSola(mes, config = {}) {
    const s = emptyState();
    const imported = [], unread = [], rules = [];
    const mark = k => { if (!imported.includes(k)) imported.push(k); };
    const isUser = name => sameName(name, config.userName || "");

    const notes = tag(mes, "story_notes");
    const nb = importFromLegacyNotebook([{ is_user: false, mes }]);
    if (nb.rules.length || nb.threads.length) { rules.push(...nb.rules); s.threads = nb.threads; mark("threads"); }
    for (const seed of listOf(field(notes, "Seeds"))) {
        s.chekhov.bullets.push({ id: nextId(s, "B", s.chekhov.bullets.map(b => b.id)), desc: seed, weight: 1, age: 0, hot: false, secret: false, lock: "", at: null, after: "" });
        mark("chekhov");
    }
    for (const k of ["Motives", "Horizon"]) if (field(notes, k)) unread.push(`${k} (story notes)`);

    const date = tag(mes, "date"), cast = tag(mes, "scene_cast");
    const day = field(date, "Day"), time = field(date, "Time"), place = field(cast, "Location");
    const when = [day && (/^day\b/i.test(day) ? day : `Day ${day}`), time].filter(Boolean).join(" — ");
    if (when || place) {
        s.scene.now = [when, place].filter(Boolean).join(" | ");
        if (nowResolved(s.scene.now)) mark("scene"); else unread.push(nowUnread(s.scene.now));
    }
    const present = [...listOf(field(cast, "Active Speakers")), ...listOf(field(cast, "Ambient NPCs"))].filter(n => !isUser(n));
    if (present.length) { s.scene.present = [...new Set(present)]; mark("scene"); }

    for (const [who, f] of Object.entries(people(tag(mes, "wardrobe")))) {
        if (isUser(who)) continue;
        s.cast[who] = { ...(s.cast[who] || blankCast()), wearing: value(f.layers), condition: value(f.condition) };
        mark("cast");
    }
    const inventory = Object.entries(people(tag(mes, "inventory")));
    // no entry recognisably the reader's: ask the handover rather than drop their items
    if (inventory.length && !inventory.some(([who]) => isUser(who))) unread.push("Inventory — {{user}}'s entry was not recognised; restate {{user}}'s carried items");
    for (const [who, f] of inventory) {
        if (isUser(who)) {
            s.inv.items = [...listOf(f.carried), ...listOf(f.concealed)];
            if (s.inv.items.length) mark("inv");
        } else {
            s.cast[who] = { ...(s.cast[who] || blankCast()), holding: value(f["in-hand"]) };
            mark("cast");
        }
    }
    return { state: s, imported, rules, unread };
}
