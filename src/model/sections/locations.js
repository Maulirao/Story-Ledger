// ──────────────────────────────────────────────────────────────────────────────
// 👤 NPC LOCATIONS — where each named person is. Set by "Name @ place" lines
// (under Locations, or inside Agendas). Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW, fieldsOf, unbullet } from "../text.js";
import { findName, hasName } from "./people.js";

/** "Ana @ the café" or "Ana: the café" → [name, place], or null. */
export function locationLine(line) {
    const m = unbullet(line).match(/^([^@:]+?)\s*(?:@|:)\s*(.+)$/);
    return m ? [m[1].trim(), m[2].trim()] : null;
}

export function setLocation(state, name, place) {
    state.locations = state.locations || {};
    state.locations[findName(Object.keys(state.locations), name)] = place;
}

export default {
    key: "locations",
    title: "👤 NPC LOCATIONS",
    match: /^NPC LOCATIONS$/,
    change: "Locations",
    carried: true,
    empty: () => ({}),
    render: value => Object.entries(value).map(([n, place]) => `- <b>${esc(n)}</b> | Location: ${esc(place)}`),
    parse(rows, prevValue) {
        const value = {}, errors = [];
        for (const row of rows) {
            const m = row.match(ROW);
            const f = m && fieldsOf(m[2]);
            if (m && f && "location" in f) value[unesc(m[1])] = unesc(f.location);
            else {
                errors.push(row);
                const name = m && unesc(m[1]);
                if (name && prevValue && name in prevValue) value[name] = prevValue[name];
            }
        }
        return { value, errors };
    },
    apply(state, lines) {
        const unparsed = [];
        for (const l of lines) {
            const hit = locationLine(l);
            if (hit) setLocation(state, hit[0], hit[1]);
            else unparsed.push(unbullet(l));
        }
        return unparsed;
    },
    prompt(value, state) {
        const away = Object.entries(value).filter(([n]) => !hasName(state.scene.present, n));
        return away.length ? `Where people are: ${away.map(([n, p]) => `${n} — ${p}`).join("; ")}` : "";
    },
    rules: () => "",
    template: () => ["Locations:", "- [Name @ place — only when someone moved]"],
};
