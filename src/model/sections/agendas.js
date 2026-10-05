// ──────────────────────────────────────────────────────────────────────────────
// 👤 NPC AGENDAS — what each named person is doing with their own life. Off-screen
// agendas advance one step per turn on their own; the model is told before a reply
// when one finishes, applies its effect and gives the person a new agenda. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW, fieldsOf } from "../text.js";
import { findName, hasName } from "./people.js";
import { locationLine, setLocation } from "./locations.js";

const FIELDS = ["aware", "fibs", "circle", "body"];
const blank = () => ({ task: "", step: 0, max: 0, aware: "", fibs: "", circle: "", body: "" });
const show = v => (v ? esc(v) : "—");
const read = v => { const t = unesc(v); return t === "—" ? "" : t; };

function entry(state, name) {
    const n = findName(Object.keys(state.agendas), name);
    if (!state.agendas[n]) state.agendas[n] = blank();
    return [n, state.agendas[n]];
}

const offScreen = (state, name) => !hasName(state.scene.present, name);

export default {
    key: "agendas",
    title: "👤 NPC AGENDAS",
    match: /^NPC AGENDAS$/,
    change: "Agendas",
    carried: true,
    empty: () => ({}),
    render: value => Object.entries(value).map(([n, a]) =>
        `- <b>${esc(n)}</b> | Agenda: ${show(a.task)} | (Step ${a.step}/${a.max}) | Aware: ${show(a.aware)} | Fibs: ${show(a.fibs)} | Circle: ${show(a.circle)} | Body: ${show(a.body)}`),
    parse(rows, prevValue) {
        const value = {}, errors = [];
        for (const row of rows) {
            const m = row.match(ROW);
            const step = m && m[2].match(/\(\s*Step\s+(\d+)\s*\/\s*(\d+)\s*\)/i);
            const f = m && fieldsOf(m[2]);
            if (m && step && f && "agenda" in f) {
                const a = { task: read(f.agenda), step: Number(step[1]), max: Number(step[2]) };
                for (const k of FIELDS) a[k] = read(f[k] ?? "");
                value[unesc(m[1])] = a;
            } else {
                errors.push(row);
                const name = m && unesc(m[1]);
                if (name && prevValue && prevValue[name]) value[name] = prevValue[name];
            }
        }
        return { value, errors };
    },
    apply(state, lines, ctx) {
        const unparsed = [];
        for (const raw of lines) {
            const line = String(raw).trim();   // parseChanges already removed the list bullet
            let m;
            if ((m = line.match(/^(.+?)\s*:\s*new\s+"([^"]+)"\s+(\d+)\s*\/\s*(\d+)\s*(?:@\s*(.+))?$/i))) {
                const [n, a] = entry(state, m[1]);
                Object.assign(a, { task: m[2].trim(), step: Number(m[3]), max: Number(m[4]) });
                if (m[5]) setLocation(state, n, m[5].trim());
                ctx.touched.add(n.toLowerCase());
            } else if ((m = line.match(/^(.+?)\s*:\s*done\b/i))) {
                // Only the task ends: what the person knows, their lies, circle and body stay.
                // A done for someone given a new agenda in this same reply is the old one finishing.
                const n = findName(Object.keys(state.agendas), m[1]);
                if (!state.agendas[n]) unparsed.push(line);
                else if (!ctx.touched.has(n.toLowerCase())) Object.assign(state.agendas[n], { task: "", step: 0, max: 0 });
            } else if ((m = line.match(/^(.+?)\s+(knows|fibs?|circle|body)\s*:\s*(.+)$/i))) {
                const [, a] = entry(state, m[1]);
                const field = { knows: "aware", fib: "fibs", fibs: "fibs", circle: "circle", body: "body" }[m[2].toLowerCase()];
                const v = m[3].trim();
                a[field] = (field === "aware" || field === "fibs") && a[field] ? `${a[field]}; ${v}` : v;
            } else if (/@/.test(line) && locationLine(line)) {
                const [n, place] = locationLine(line);
                setLocation(state, n, place);
            } else unparsed.push(line);
        }
        return unparsed;
    },
    after(state, ctx) {
        for (const [n, a] of Object.entries(state.agendas)) {
            if (a.max > 0 && a.step < a.max && offScreen(state, n) && !ctx.touched.has(n.toLowerCase())) a.step += 1;
        }
    },
    facts(state) {
        const out = [];
        for (const [n, a] of Object.entries(state.agendas)) {
            if (!a.max || !offScreen(state, n)) continue;
            if (a.step < a.max && a.step + 1 >= a.max) out.push(`${n} finishes "${a.task}" off-screen this turn — apply its effect and give ${n} a new agenda.`);
            else if (a.step >= a.max) out.push(`${n}'s agenda "${a.task}" is finished — give ${n} a new one.`);
        }
        return out;
    },
    prompt(value, state) {
        const rows = Object.entries(value)
            .sort(([a], [b]) => offScreen(state, b) - offScreen(state, a))
            .map(([n, a]) => {
                const bits = [a.task ? `${a.task}${a.max ? ` (${a.step}/${a.max})` : ""}` : "no agenda"];
                for (const k of FIELDS) if (a[k]) bits.push(`${k}: ${a[k]}`);
                return `- ${n}${offScreen(state, n) ? " (off-screen)" : ""} — ${bits.join(" · ")}`;
            });
        return rows.length ? ["Agendas:", ...rows].join("\n") : "";
    },
    rules: () => [
        "Agendas: every named NPC has one, given on first appearance. Without a clear goal, give a mundane one of 1–3 steps drawn from the widest set that fits the person and setting (eating, cleaning, repairing, trading, training, studying, a shift, an errand, an animal, a debt, a visit, grooming, praying, gambling, drinking, arguing, resting, an idle habit); sleep and aimless wandering are last resorts.",
        "When an NPC leaves the scene, replace their agenda from personality, recent events or whim. Off-screen agendas advance on their own; the ledger tells you when one finishes.",
        "When one finishes, apply its effect through the ledger's other lines — travel: a new location; research: load a Chekhov setup and tick fondness with whoever was involved; repair/build: an item on their Body; trade/errand: move an item between people; train: a skill noted on Body; social visit: relationship ticks between the two; rest: Body improves, a little self-regard; reconcile: a DIRECT fondness shift and a subdued repair talk; confront: friction ticks. A completion never walks into {{user}}'s scene on its own.",
        "On entering the scene: unfinished — distracted, mentions what is pending; finished and mundane — neutral; finished and significant — energised, wants to share if fond of the person.",
        "Never name the mechanics in prose.",
    ].join("\n"),
    template: () => [
        "Agendas:",
        '- [Name: new "task" 0/N @ place — a new or replaced agenda]',
        '- [Name: done "task" → effect — one that finished]',
        "- [Name knows: … / Name fib: … / Name circle: … / Name body: … — only what changed]",
    ],
};
