// ──────────────────────────────────────────────────────────────────────────────
// 👤 NPC AGENDAS — what each named person is doing with their own life. Off-screen
// agendas advance one step per turn on their own; the model is told before a reply
// when one finishes, applies its effect and gives the person a new agenda. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW, fieldsOf } from "../text.js";
import { findName, hasName } from "./people.js";
import { locationLine, setLocation } from "./locations.js";
import { commandTemplate } from "../commands.js";
import { parseStoryTime } from "../storytime.js";

const FIELDS = ["aware", "fibs", "circle", "body"];
const blank = () => ({ task: "", step: 0, max: 0, aware: "", fibs: "", circle: "", body: "" });
const show = v => (v ? esc(v) : "—");
const read = v => { const t = unesc(v); return t === "—" ? "" : t; };

function fieldLine(line, normalized) {
    return line.match(normalized
        ? /^(.+?)(?:\s*:\s*|\s+)(knows|fibs?|circle|body)\s*:\s*(.+)$/i
        : /^(.+?)\s+(knows|fibs?|circle|body)\s*:\s*(.+)$/i);
}

function fieldCommands(raw, normalized) {
    const line = String(raw).trim();
    const m = normalized && fieldLine(line, true);
    if (!m) return [line];
    // Only split an explicit command for the same person. Ordinary punctuation
    // in knowledge/body text stays intact; legacy tagged inputs keep their reading.
    const name = m[1].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return line.split(new RegExp(`\\s*[;·|]\\s*(?=${name}(?:\\s*:\\s*|\\s+)(?:knows|fibs?|circle|body)\\s*:\\s*\\S)`, "i"));
}

const COMMANDS = [
    { id: "agendas.new", form: 'Name: new "task" 0/N @ place', example: 'Ana: new "mend the nets" 0/2 @ the harbour', keywords: ["new"] },
    { id: "agendas.done", form: 'Name: done "task" → effect', example: 'Ana: done "mend the nets" → the boat can sail', keywords: ["done"] },
    { id: "agendas.knows", form: "Name knows: …", example: "Ana knows: Mara took the key", keywords: ["knows"] },
    { id: "agendas.fib", form: "Name fib: …", example: "Ana fib: says she was home all night", keywords: ["fib"] },
    { id: "agendas.circle", form: "Name circle: …", example: "Ana circle: the harbour crews", keywords: ["circle"] },
    { id: "agendas.body", form: "Name body: …", example: "Ana body: a bandaged hand", keywords: ["body"] },
];

function progressRecap(line, normalized) {
    // Bare fractions are a comment shorthand for the parenthesized recap.
    const bare = normalized && line.match(/^([^:]+?)\s*:\s*("[^"]+"|[^"\s][^"]*?)\s+(\d+)\s*\/\s*(\d+)\s*(?:\((.+)\)|[—–]\s*(.+)|(continues\b.*))?$/i);
    if (bare) {
        if (/^new\b/i.test(bare[2])) return null; // malformed command, not a recap
        const note = bare[5] || bare[6] || bare[7];
        line = `${bare[1]}: ${bare[2]} (${bare[3]}/${bare[4]})${note ? ` — ${note}` : ""}`;
    }
    const m = line.match(/^([^:]+?)\s*:\s*(\S.*?)\s+\(\s*(\d+)\s*\/\s*(\d+)\s*\)("?)\s*(?:[—–]\s*(.+)|(continues\b.*))?$/i);
    if (!m || Number(m[4]) <= 0 || Number(m[3]) > Number(m[4])) return null;
    let task = m[2].trim();
    // A model may quote the task alone or include its progress inside the quotes.
    if (m[5] && task.startsWith('"')) task = task.slice(1).trim();
    else if (task.startsWith('"') && task.endsWith('"')) task = task.slice(1, -1).trim();
    if (!task) return null;
    const note = m[6] || m[7];
    return { name: m[1], task: task + (note ? ` — ${note.trim()}` : ""), step: Number(m[3]), max: Number(m[4]) };
}

function entry(state, name) {
    const n = findName(Object.keys(state.agendas), name);
    if (!state.agendas[n]) state.agendas[n] = blank();
    return [n, state.agendas[n]];
}

const offScreen = (state, name) => !hasName(state.scene.present, name);

// "before noon", "by 8 PM", "until 14:30": a same-day deadline the task states for itself.
// Midnight is left out — on a clock that wraps it would always read as past.
const DEADLINE = /\b(?:before|by|until|till)\s+(noon|midday|\d{1,2}:\d{2}(?:\s*[ap]\.?\s*m\.?)?|\d{1,2}\s*[ap]\.?\s*m\.?)(?!\w|:\d)/i;

/** The deadline words of `task` when the story clock is at or past them, else null. */
function overdue(task, now) {
    const m = String(task).match(DEADLINE);
    const due = m && parseStoryTime(m[1]);
    const at = parseStoryTime(now);
    return due && at && at.minutes >= due.minutes ? m[1] : null;
}

export default {
    key: "agendas",
    title: "👤 NPC AGENDAS",
    match: /^NPC AGENDAS$/,
    change: "Agendas",
    aliases: ["NPC Agendas", "Agenda"],
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
        for (const raw of lines.flatMap(line => fieldCommands(line, ctx.normalizedChanges))) {
            let line = String(raw).trim();   // parseChanges already removed the list bullet
            // A comment may describe a just-completed task as new "task" → done.
            // Require an explicit completion marker; missing progress alone is not done.
            if (ctx.normalizedChanges) {
                const completed = line.match(/^(.+?)\s*:\s*new\s+"([^"\s][^"]*)"\s*→\s*done\s*(?:;\s*(\S.*))?$/i);
                if (completed) line = `${completed[1]}: done "${completed[2]}"${completed[3] ? ` → ${completed[3]}` : ""}`;
            }
            let m;
            if ((m = line.match(/^(.+?)\s*:\s*new\s+"([^"]+)"\s+(\d+)\s*\/\s*(\d+)\s*(?:@\s*(.+))?$/i))) {
                const step = Number(m[3]), max = Number(m[4]);
                if (max <= 0 || step > max) { unparsed.push(line); continue; }   // impossible progress: change nothing
                const [n, a] = entry(state, m[1]);
                Object.assign(a, { task: m[2].trim(), step, max });
                if (m[5]) setLocation(state, n, m[5].trim());
                ctx.touched.add(n.toLowerCase());
            } else if ((m = line.match(/^(.+?)\s*:\s*done\b/i))) {
                // Only the task ends: what the person knows, their lies, circle and body stay.
                // A done for someone given a new agenda in this same reply is the old one finishing.
                const n = findName(Object.keys(state.agendas), m[1]);
                if (!state.agendas[n]) {
                    // A comment may report a task completed before it was ever
                    // saved. There is nothing to clear; effects use other lines.
                    if (!ctx.normalizedChanges || !/^.+?\s*:\s*done\s+"[^"\s][^"]*"\s*(?:→\s*\S.*)?$/i.test(line)) unparsed.push(line);
                }
                else if (!ctx.touched.has(n.toLowerCase())) Object.assign(state.agendas[n], { task: "", step: 0, max: 0 });
            } else if ((m = fieldLine(line, ctx.normalizedChanges))) {
                const [, a] = entry(state, m[1]);
                const field = { knows: "aware", fib: "fibs", fibs: "fibs", circle: "circle", body: "body" }[m[2].toLowerCase()];
                const v = m[3].trim();
                a[field] = (field === "aware" || field === "fibs") && a[field] ? `${a[field]}; ${v}` : v;
            } else if ((m = progressRecap(line, ctx.normalizedChanges))) {
                // A task/progress recap is an explicit update; keep its note and do not auto-tick it again.
                const [n, a] = entry(state, m.name);
                Object.assign(a, { task: m.task, step: m.step, max: m.max });
                ctx.touched.add(n.toLowerCase());
            } else if (/@/.test(line) && locationLine(line, { normalized: ctx.normalizedChanges })) {
                const [n, place] = locationLine(line, { normalized: ctx.normalizedChanges });
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
    facts(state, ctx) {
        const out = [];
        for (const [n, a] of Object.entries(state.agendas)) {
            if (ctx.userName && hasName([ctx.userName], n)) continue;
            if (!a.task.trim()) {
                out.push(`${n} has no agenda — write an Agendas new line with a concrete goal and 1–3 steps drawn from the story.`);
            } else if (!(a.max > 0)) {
                out.push(`${n}'s agenda "${a.task}" cannot advance without steps — write an Agendas new line with valid progress, or done and a new agenda if the story already finished it.`);
            } else if (a.step >= a.max) out.push(`${n}'s agenda "${a.task}" is finished — give ${n} a new one.`);
            else if (overdue(a.task, state.scene.now)) out.push(`${n}'s agenda "${a.task}" was due by ${overdue(a.task, state.scene.now)} and the story time is past it — write done for it, or a new agenda that fits what ${n} is doing now; do not steer the scene back toward the old deadline.`);
            else if (offScreen(state, n) && a.step + 1 >= a.max) out.push(`${n} finishes "${a.task}" off-screen this turn — apply its effect and give ${n} a new agenda.`);
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
        "Write `new` for a new or replaced agenda and `done` for one that finished; knows, fib, circle and body lines only for what changed.",
        "Never name the mechanics in prose.",
    ].join("\n"),
    commands: COMMANDS,
    template: ctx => commandTemplate("Agendas", COMMANDS, ctx),
};
