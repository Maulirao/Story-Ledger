// ──────────────────────────────────────────────────────────────────────────────
// 👤 NPC LOCATIONS — where each named person is. Set by "Name @ place" lines
// (under Locations, or inside Agendas). Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW, fieldsOf, unbullet } from "../text.js";
import { findName, hasName } from "./people.js";
import { commandTemplate } from "../commands.js";

const COMMANDS = [
    { id: "locations.move", form: "Name @ place", example: "Ana @ the harbour", keywords: [] },
];

/**
 * "Ana @ the café" or "Ana: the café" → [name, place], or null. A normalized comment
 * line already lost its one list marker (`normalized: true` only trims); otherwise the
 * historical helper strips a bullet.
 */
export function locationLine(line, { normalized = false } = {}) {
    const m = (normalized ? String(line).trim() : unbullet(line)).match(/^([^@:]+?)\s*(?:@|:)\s*(.+)$/);
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
    aliases: ["NPC Locations", "Location"],
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
    apply(state, lines, ctx) {
        const normalized = Boolean(ctx && ctx.normalizedChanges);
        const unparsed = [];
        for (const l of lines) {
            const hit = locationLine(l, { normalized });
            if (hit) setLocation(state, hit[0], hit[1]);
            else unparsed.push(normalized ? String(l).trim() : unbullet(l));
        }
        return unparsed;
    },
    prompt(value, state) {
        const away = Object.entries(value).filter(([n]) => !hasName(state.scene.present, n));
        return away.length ? `Where people are: ${away.map(([n, p]) => `${n} — ${p}`).join("; ")}` : "";
    },
    rules: () => "Locations: write a line only when someone moved.",
    commands: COMMANDS,
    template: ctx => commandTemplate("Locations", COMMANDS, ctx),
};
