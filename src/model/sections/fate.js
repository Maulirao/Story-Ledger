// ──────────────────────────────────────────────────────────────────────────────
// 🎲 FATE & ROUTINE — carried pursuits, deferred beats, world happenings,
// ambitions and residue. Dice are decided once before the reply; after() applies
// their bookkeeping after the model's change lines. Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW, closedForm } from "../text.js";
import { nextId } from "../state.js";
import { computeFate, reachFor } from "../fate-engine.js";
import { commandTemplate } from "../commands.js";
import { DEFAULT_SECTION_CONFIG } from "../config.js";

// W# entries are displayed in Fate, but World declares their command forms only once.
// The reader still accepts update/escalate under either Fate: or World:.
const FATE_COMMANDS = [
    { id: "fate.pursuit", form: "pursuit: question", example: "pursuit: who set the boathouse fire?", keywords: ["pursuit"] },
    { id: "fate.close", form: "close: aftermath", example: "close: the arsonist fled town; the guild blames the union", keywords: ["close"] },
    { id: "fate.park", form: "park: aftermath", example: "park: the fire is old news; nobody talks of it", keywords: ["park"] },
    { id: "fate.defer-new", form: "defer: desc", example: "defer: the guild's audit of the docks", keywords: ["defer"] },
    { id: "fate.defer", form: "defer D#", example: "defer D1", keywords: ["defer"] },
    { id: "fate.resolve", form: "resolve D#", example: "resolve D1", keywords: ["resolve"] },
    { id: "fate.ambition", form: "ambition: want", example: "ambition: Mara wants her own boat", keywords: ["ambition"] },
    { id: "fate.ambition-progress", form: "ambition +1 prefix", example: "ambition +1 Mara wants", keywords: ["ambition"] },
    { id: "fate.residue", form: "residue: owed aftermath", example: "residue: the burnt pier is fenced off", keywords: ["residue"] },
    { id: "fate.consequence-landed", form: "World CONSEQUENCE landed as aftermath", example: "World CONSEQUENCE landed as the buoy broke during the race", keywords: ["World", "CONSEQUENCE", "landed", "as"] },
    { id: "fate.world-landed", form: "World EVENT landed as aftermath", example: "World ARRIVAL landed as a cousin turns up four hours early", keywords: ["World", "landed", "as"] },
];

const WORLD_COMMANDS = [
    { id: "world.add-elsewhere", form: "+ ELSEWHERE: …", example: "+ ELSEWHERE: a war breaks out across the sea", keywords: ["ELSEWHERE"] },
    { id: "world.add-regional", form: "+ REGIONAL: …", example: "+ REGIONAL: the river road is flooded", keywords: ["REGIONAL"] },
    { id: "world.add-local", form: "+ LOCAL: …", example: "+ LOCAL: the bakery closes for a funeral", keywords: ["LOCAL"] },
    { id: "world.escalate", form: "escalate W#", example: "escalate W1", keywords: ["escalate"] },
    { id: "world.update", form: "update W#: new development", example: "update W1: repair part sourced; Thursday earliest", keywords: ["update"] },
    { id: "world.escalate-note", form: "escalate W#: new development", example: "escalate W1: fuel shortage reaches the neighbouring town", keywords: ["escalate"] },
    { id: "world.land", form: "land W#: how it lands", example: "land W1: refugees reach the harbour", keywords: ["land"] },
];

const clone = value => JSON.parse(JSON.stringify(value));
const cfgOf = ctx => ctx?.config?.sectionConfig?.fate || {};
const byId = (list, id) => list.find(item => item.id.toLowerCase() === String(id).toLowerCase());
const idNumber = id => Number(String(id || "").match(/\d+$/)?.[0] || Number.MAX_SAFE_INTEGER);
const emptyFate = () => ({ state: "ROUTINE", pursuit: "", ts: 0, q: 0, sinceMajor: 99, deferred: [], world: [], ambitions: [], residue: [], lastTurn: null, owed: [] });

function outcomeSummary(outcome) {
    return {
        dice: { ...outcome.dice }, tier: outcome.tier, source: outcome.source,
        news: Boolean(outcome.news), fire: outcome.fire || null, warm: outcome.warm || null,
        collision: outcome.collision || null, fudged: [...(outcome.fudged || [])],
    };
}

function appendResidue(fate, text, ctx) {
    if (!text) return;
    fate.residue.push(String(text).trim());
    const keep = cfgOf(ctx).residueKeep ?? 12;
    if (keep >= 0 && fate.residue.length > keep) fate.residue = keep ? fate.residue.slice(-keep) : [];
}

// Preserve the initial report. New developments are chronological, not replacements.
function appendWorldUpdate(entry, raw) {
    const note = String(raw || "").trim();
    if (!note) return;
    const updates = Array.isArray(entry.updates) ? entry.updates : [];
    if (!updates.some(previous => previous.toLowerCase() === note.toLowerCase()))
        entry.updates = [...updates, note];
}

const worldHistory = item => [item.desc, ...(item.updates || [])].join("; ");

function oweResidue(fate, text) {
    if (text) fate.owed.push(String(text).trim());
}

function realizedWorldAftermath(line, eventName, normalized) {
    if (!eventName) return null;
    // A copied template label is harmless only when its payload identifies the rolled event.
    const labelled = normalized && line.match(/^World\s+EVENT\s+landed\s+as\s+aftermath\s*:\s*(.+)$/i);
    if (labelled) {
        const payload = labelled[1];
        if (payload.slice(0, eventName.length).toLowerCase() !== eventName.toLowerCase()) return null;
        return payload.slice(eventName.length).match(/^\s+[—–-]\s+(\S.*)$/)?.[1].trim() || null;
    }
    const m = line.match(/^World\s+(.+?)\s+landed\s+as\s+(\S.*)$/i);
    return m && m[1].trim().toLowerCase() === eventName.trim().toLowerCase() ? m[2].trim() : null;
}

function addWorld(fate, state, prox, desc, c, ctx) {
    const id = nextId(state, "W", fate.world.map(item => item.id));
    fate.world.push({ id, desc, prox, reach: reachFor(prox, c), age: 0 });
    ctx.touched.add(`fate:${id}`);
    return id;
}

function parseLastTurnRows(rows, value, errors) {
    let dice = null, turn = null;
    const updateRows = new Map();
    for (const row of rows) {
        const m = row.match(ROW);
        if (!m) { errors.push(row); continue; }
        const field = m[1].replace(/:\s*$/, "").trim().toLowerCase();
        const rest = m[2].trim();
        if (field === "rolls") {
            const hit = rest.match(/^A\s+(\d+)\s+·\s+B\s+(\d+)\s+·\s+C\s+(\d+)(?:\s+\(fudged:\s*(.+)\))?$/i);
            if (!hit) { errors.push(row); continue; }
            dice = { a: Number(hit[1]), b: Number(hit[2]), c: Number(hit[3]) };
            if (turn) turn.fudged = hit[4] ? hit[4].split(/,\s*/) : [];
            else value._fudged = hit[4] ? hit[4].split(/,\s*/) : [];
        } else if (field === "this turn") {
            const parts = rest.split(/\s+·\s+/);
            const lead = parts.shift().match(/^(AMBIENT|MINOR|MAJOR)\s+\+\s+(TRUE|WEIGHTED)$/i);
            if (!lead) { errors.push(row); continue; }
            turn = { tier: lead[1].toUpperCase(), source: lead[2].toUpperCase(), news: false, fire: null, warm: null, collision: null, fudged: value._fudged || [] };
            for (const part of parts) {
                if (/^news$/i.test(part)) turn.news = true;
                else if (/^fired\s+B\d+$/i.test(part)) turn.fire = part.match(/B\d+/i)[0].toUpperCase();
                else if (/^warmed\s+B\d+$/i.test(part)) turn.warm = part.match(/B\d+/i)[0].toUpperCase();
                else if (/^(DEFER|COMPLICATE|DISPLACE)$/i.test(part)) turn.collision = part.toUpperCase();
                else errors.push(row);
            }
        } else if (field === "state") {
            const hit = rest.match(/^(ROUTINE|THREAD)(?:\s+"([\s\S]*?)"\s+\(ts\s+(\d+)\))?\s+·\s+<b>Quiet:<\/b>\s*(\d+)\s+·\s+<b>Since MAJOR:<\/b>\s*(\d+)$/i);
            if (!hit) { errors.push(row); continue; }
            value.state = hit[1].toUpperCase();
            value.pursuit = hit[2] ? unesc(hit[2]) : "";
            value.ts = hit[3] ? Number(hit[3]) : 0;
            value.q = Number(hit[4]);
            value.sinceMajor = Number(hit[5]);
        } else if (/^D\d+$/i.test(field)) {
            const hit = rest.match(/^([\s\S]*?)\s+\|\s+deferred\s+×(\d+)\s+·\s+age\s+(\d+)$/i);
            if (!hit) { errors.push(row); continue; }
            value.deferred.push({ id: field.toUpperCase(), desc: unesc(hit[1]), times: Number(hit[2]), age: Number(hit[3]) });
        } else if (/^W\d+ update$/i.test(field)) {
            if (!rest) { errors.push(row); continue; }
            const id = field.match(/^W\d+/i)[0].toUpperCase();
            const notes = updateRows.get(id) || [];
            notes.push({ row, text: unesc(rest) });
            updateRows.set(id, notes);
        } else if (/^W\d+$/i.test(field)) {
            const hit = rest.match(/^([\s\S]*?)\s+\|\s+(ELSEWHERE|REGIONAL|LOCAL)\s+·\s+Reach\s+(\d+)\s+·\s+age\s+(\d+)$/i);
            if (!hit) { errors.push(row); continue; }
            value.world.push({ id: field.toUpperCase(), desc: unesc(hit[1]), prox: hit[2].toUpperCase(), reach: Number(hit[3]), age: Number(hit[4]) });
        } else if (field === "ambition") {
            const hit = rest.match(/^([\s\S]*?)\s+\|\s+(\d+)\/5$/);
            if (!hit) { errors.push(row); continue; }
            value.ambitions.push({ desc: unesc(hit[1]), progress: Number(hit[2]) });
        } else if (field === "residue") value.residue.push(unesc(rest));
        else if (field === "owed") value.owed.push(unesc(rest));
        else errors.push(row);
    }
    for (const [id, notes] of updateRows) {
        const entry = byId(value.world, id);
        if (entry) entry.updates = notes.map(note => note.text);
        else errors.push(...notes.map(note => note.row));
    }
    delete value._fudged;
    value.lastTurn = turn ? { dice, ...turn, fudged: turn.fudged || value._fudged || [] } : null;
    if (turn && !dice) errors.push("This turn row has no Rolls row");
}

function compareWorldDrop(a, b) {
    return a.reach - b.reach || b.age - a.age || idNumber(a.id) - idNumber(b.id);
}

export default {
    key: "fate",
    title: "🎲 FATE & ROUTINE",
    match: /^FATE ROUTINE$/,
    change: "Fate",
    aliases: ["Fate & Routine", "Fate and Routine"],
    carried: true,
    empty: emptyFate,
    decide(prev, ctx) {
        const dice = ctx.config.dice?.fate;
        if (!dice) return null;
        const cfg = { ...cfgOf(ctx), chekhov: ctx.config.sectionConfig?.chekhov };
        const outcome = computeFate(prev, dice, ctx.config.fudges || null, cfg);
        outcome.fudged = [
            ...(ctx.config.fudgedDice || []).filter(name => /^fate\.[abc]$/i.test(name)),
            ...outcome.fudged,
        ];
        return outcome;
    },
    render(value) {
        const rows = [];
        const last = value.lastTurn;
        if (last?.dice) {
            const mark = last.fudged?.length ? ` (fudged: ${last.fudged.join(", ")})` : "";
            rows.push(`- <b>Rolls:</b> A ${last.dice.a} · B ${last.dice.b} · C ${last.dice.c}${mark}`);
            const notes = [];
            if (last.news) notes.push("news");
            if (last.fire) notes.push(`fired ${last.fire}`);
            if (last.warm) notes.push(`warmed ${last.warm}`);
            if (last.collision) notes.push(last.collision);
            rows.push(`- <b>This turn:</b> ${last.tier} + ${last.source}${notes.map(note => ` · ${note}`).join("")}`);
        }
        const state = value.state === "THREAD" ? `THREAD "${esc(value.pursuit)}" (ts ${value.ts})` : "ROUTINE";
        rows.push(`- <b>State:</b> ${state} · <b>Quiet:</b> ${value.q} · <b>Since MAJOR:</b> ${value.sinceMajor}`);
        rows.push(...value.deferred.map(item => `- <b>${item.id}</b> ${esc(item.desc)} | deferred ×${item.times} · age ${item.age}`));
        for (const item of value.world) {
            rows.push(`- <b>${item.id}</b> ${esc(item.desc)} | ${item.prox} · Reach ${item.reach} · age ${item.age}`);
            for (const update of item.updates || []) rows.push(`- <b>${item.id} update:</b> ${esc(update)}`);
        }
        rows.push(...value.ambitions.map(item => `- <b>Ambition:</b> ${esc(item.desc)} | ${item.progress}/5`));
        rows.push(...value.residue.map(item => `- <b>Residue:</b> ${esc(item)}`));
        rows.push(...value.owed.map(item => `- <b>Owed:</b> ${esc(item)}`));
        return rows;
    },
    parse(rows) {
        const value = emptyFate(), errors = [];
        parseLastTurnRows(rows, value, errors);
        value.deferred.sort((a, b) => idNumber(a.id) - idNumber(b.id));
        value.world.sort((a, b) => idNumber(a.id) - idNumber(b.id));
        return { value, errors };
    },
    apply(state, lines, ctx) {
        const fate = state.fate;
        const unparsed = [];
        const outcome = ctx.turn.fate;
        if (!outcome) return unparsed;
        const tables = ctx.config?.sectionConfig?.worldsim || DEFAULT_SECTION_CONFIG.worldsim;
        const eventNames = [...new Set([ctx.turn.worldsim?.name, ...["duo", "standard"].flatMap(k => (tables[k] || DEFAULT_SECTION_CONFIG.worldsim[k]).map(e => e.name))].filter(Boolean))];
        const byDeferred = id => byId(fate.deferred, id);
        const worldLines = [];
        const records = ctx.linesAcross?.(["World", "Fate"]) || [
            ...ctx.linesUnder("World").map(line => ({ section: "World", line })),
            ...lines.map(line => ({ section: "Fate", line })),
        ];
        // the comment path accepts one terminal punctuation mark on a closed form
        const closed = ctx.normalizedChanges ? closedForm : s => s;
        for (const record of records) {
            const line = String(record.line).trim();
            const consequence = line.match(/^World\s+(CONSEQUENCE|BACKGROUND_INCIDENT|GOSSIP_SURGE)\s+landed\s+as\s+(\S.*)$/i);
            if (consequence && (consequence[1].toUpperCase() === "CONSEQUENCE" || ctx.normalizedChanges)) {
                // Generic story aftermath, independent of the rolled World Sim event and its source.
                // It records what happened without changing the roll or paying unrelated residue debt.
                appendResidue(fate, `${consequence[1].toUpperCase()} — ${consequence[2].trim()}`, ctx);
                continue;
            }
            const reported = eventNames.map(name => ({ name, aftermath: realizedWorldAftermath(line, name, ctx.normalizedChanges) })).find(event => event.aftermath !== null);
            if (reported) {
                // Save a recognizable narrative event; its report never overrides the rolled event or Fate source.
                appendResidue(fate, `${reported.name} — ${reported.aftermath}`, ctx);
                continue;
            }
            if (record.section === "World") { worldLines.push(line); continue; }
            let m, item;
            if ((m = line.match(/^pursuit\s*:\s*(.+)$/i))) {
                fate.state = "THREAD"; fate.pursuit = m[1].trim(); fate.ts = 0;
                ctx.touched.add("fate:pursuit");
            } else if ((m = line.match(/^(close|park)\s*:\s*(.+)$/i))) {
                fate.state = "ROUTINE"; fate.pursuit = ""; fate.ts = 0;
                ctx.touched.add("fate:pursuit");
                appendResidue(fate, m[2].trim(), ctx);
            } else if ((m = line.match(/^defer\s*:\s*(.+)$/i))) {
                const id = nextId(state, "D", fate.deferred.map(d => d.id));
                fate.deferred.push({ id, desc: m[1].trim(), times: 1, age: 0 });
                ctx.touched.add(`fate:${id}`);
            } else if ((m = closed(line).match(/^defer\s+(D\d+)$/i)) && (item = byDeferred(m[1]))) {
                item.times = Math.min(2, item.times + 1);
                ctx.touched.add(`fate:${item.id}`);
            } else if ((m = closed(line).match(/^resolve\s+(D\d+)$/i)) && (item = byDeferred(m[1]))) {
                fate.deferred = fate.deferred.filter(d => d !== item);
            } else if ((m = line.match(/^ambition\s*:\s*(.+)$/i))) {
                fate.ambitions.push({ desc: m[1].trim(), progress: 0 });
            } else if ((m = line.match(/^ambition\s+\+1\s+(.+)$/i)) && m[1].trim()) {
                const prefix = m[1].trim().toLowerCase();
                const ambition = fate.ambitions.find(a => a.desc.toLowerCase().startsWith(prefix));
                if (ambition) ambition.progress = Math.min(5, ambition.progress + 1);
                else unparsed.push(line);
            } else if ((m = line.match(/^residue\s*:\s*(.+)$/i))) {
                appendResidue(fate, m[1].trim(), ctx);
                if (fate.owed.length) fate.owed.shift();
            } else if ((m = line.match(/^World\s*:\s*(.+)$/i))) {
                worldLines.push(m[1]);   // a World line written inside the Fate list
            } else if (/^(?:update|escalate)\b/i.test(line)) {
                worldLines.push(line);   // W# entries are displayed in Fate; accept both headings
            } else if (/^(ELSEWHERE|REGIONAL|LOCAL)\s*:/i.test(line)) {
                worldLines.push(line);   // proximity recaps sometimes appear under Fate
            } else if ((m = line.match(/^(MINOR|MAJOR)\s+(?:consequence\s+)?landed\s*:\s*(.+)$/i)) && m[1].toUpperCase() === outcome.tier) {
                // A landed consequence is aftermath, not a tier override or payment of unrelated owed residue.
                appendResidue(fate, m[2].trim(), ctx);
            } else if ((m = line.match(/^(AMBIENT|MINOR|MAJOR)(?:\s*\+\s*(TRUE|WEIGHTED))?\s*:\s*(.+)$/i))
                && m[1].toUpperCase() === outcome.tier && (!m[2] || m[2].toUpperCase() === outcome.source)) {
                // A matching recap is informational. The engine still owns the tier and source.
            } else unparsed.push(line);
        }
        for (const raw of worldLines) {
            const line = String(raw).trim();
            let m, item;
            // "+ LOCAL: happening"; words before the band ("+ ARRIVAL landed LOCAL: …") stay in the happening
            if ((m = line.match(/^\+\s*(?:(.+?)\s+)?(ELSEWHERE|REGIONAL|LOCAL)\s*:\s*(.+)$/i))) {
                const c = outcome.dice.c;
                const what = m[3].trim().replace(/\s*\(Reach\s+\d+\)\s*$/i, "");
                const desc = m[1] ? `${m[1].trim()} — ${what}` : what;
                addWorld(fate, state, m[2].toUpperCase(), desc, c, ctx);
            } else if ((m = line.match(/^update\s+(W\d+)\s*:\s*(\S.*)$/i)) && (item = byId(fate.world, m[1]))) {
                appendWorldUpdate(item, m[2]);
            } else if ((m = line.match(/^escalate\s+(W\d+)(?:\s*:\s*(\S.*))?$/i) || closed(line).match(/^escalate\s+(W\d+)$/i))
                && (item = byId(fate.world, m[1]))) {
                item.prox = { ELSEWHERE: "REGIONAL", REGIONAL: "LOCAL", LOCAL: "LOCAL" }[item.prox];
                item.reach = Math.min(3, item.reach + 1);
                if (m[2]) appendWorldUpdate(item, m[2]);
            } else if ((m = line.match(/^land\s+(W\d+)\s*:\s*(.+)$/i)) && (item = byId(fate.world, m[1]))) {
                fate.world = fate.world.filter(w => w !== item);
                oweResidue(fate, `${item.id} “${worldHistory(item)}” landed: ${m[2].trim()}`);
            } else if ((m = line.match(/^(ELSEWHERE|REGIONAL|LOCAL)\s*:\s*(\S.*?)\s+\((W\d+)\s+unchanged\)$/i))
                && (item = byId(fate.world, m[3])) && item.prox === m[1].toUpperCase() && outcome.world?.id !== item.id) {
                // A matching recap is informational; aging and scheduled world effects still belong to the engine.
            } else unparsed.push(line);
        }
        return unparsed;
    },
    after(state, ctx) {
        const outcome = ctx.turn.fate;
        if (!outcome) return;
        const fate = state.fate, cfg = cfgOf(ctx);
        fate.q = outcome.tier === "AMBIENT" ? fate.q + 1 : 0;
        fate.sinceMajor = outcome.tier === "MAJOR" ? 0 : fate.sinceMajor + 1;
        if (fate.state === "THREAD" && !ctx.touched.has("fate:pursuit")) fate.ts += 1;

        for (const ambition of [...fate.ambitions]) {
            if (ambition.progress < 5) continue;
            fate.ambitions = fate.ambitions.filter(a => a !== ambition);
            oweResidue(fate, `Ambition “${ambition.desc}” reached 5/5; write its residue.`);
            addWorld(fate, state, "LOCAL", ambition.desc, 6, ctx);
        }

        if (outcome.world) {
            const entry = byId(fate.world, outcome.world.id);
            if (entry && outcome.world.action === "first-effect") entry.reach = Math.min(3, entry.reach + 1);
            else if (entry && outcome.world.action === "land") {
                fate.world = fate.world.filter(w => w !== entry);
                oweResidue(fate, `${entry.id} “${worldHistory(entry)}” landed; write its residue.`);
            }
        }

        for (const entry of fate.world) if (!ctx.touched.has(`fate:${entry.id}`)) entry.age += 1;
        const reach1Drop = cfg.reach1Drop ?? 15;
        fate.world = fate.world.filter(entry => !(entry.reach === 1 && entry.age >= reach1Drop));
        const worldKeep = cfg.worldKeep ?? 5;
        while (fate.world.length > worldKeep) {
            const victim = [...fate.world].sort(compareWorldDrop)[0];
            fate.world = fate.world.filter(entry => entry !== victim);
        }

        for (const item of fate.deferred) if (!ctx.touched.has(`fate:${item.id}`)) item.age += 1;
        const expired = fate.deferred.filter(item => item.age >= (cfg.deferredExpire ?? 6));
        for (const item of expired) {
            oweResidue(fate, `${item.id} “${item.desc}” expired; write its residue.`);
            fate.deferred = fate.deferred.filter(d => d !== item);
        }
        const keep = cfg.residueKeep ?? 12;
        if (fate.residue.length > keep) fate.residue = keep ? fate.residue.slice(-keep) : [];
        fate.lastTurn = outcomeSummary(outcome);
    },
    facts(state, ctx) {
        const outcome = ctx.turn.fate;
        if (!outcome) return [];
        const fate = state.fate, cfg = cfgOf(ctx);
        const cell = {
            "AMBIENT+TRUE": "Keep the beat ordinary and close to the current scene.",
            "AMBIENT+WEIGHTED": "Keep the beat ordinary; give the selected hot setup one extra beat to warm.",
            "MINOR+TRUE": "Let one small, concrete consequence change the scene.",
            "MINOR+WEIGHTED": "Let one small consequence surface through existing narrative debt.",
            "MAJOR+TRUE": "Let a major outside force alter the story; apply the Life Gate to the event.",
            "MAJOR+WEIGHTED": "Pay off the selected hot setup as the major turn.",
        }[`${outcome.tier}+${outcome.source}`];
        const facts = [`Fate: ${outcome.tier} + ${outcome.source} — ${cell}`];
        facts.push(`Fate dice: A ${outcome.dice.a} · B ${outcome.dice.b} · C ${outcome.dice.c}`);
        facts.push("Fate is already resolved by the ledger with its configured rules; do not reroll or recalculate it using preset tables or previous-turn dice. Follow this turn's resolved tier, source and bullet instructions.");
        if (outcome.fellBack) facts.push("No eligible hot bullet could fire, so MAJOR + WEIGHTED fell back to TRUE.");
        if (outcome.news) facts.push("This turn's ambient content is world news; adapt it to the setting and react in proportion to its real impact.");
        if (outcome.collision) facts.push(`Collision with THREAD “${fate.pursuit}”: ${outcome.collision}. Let this result change the pursuit's direction.`);
        if (outcome.fire) facts.push(`Fire ${outcome.fire} this turn — pay it off naturally.`);
        if (outcome.warm) facts.push(`Warm ${outcome.warm} this turn; give its setup one extra beat.`);
        if (outcome.world?.action === "first-effect") facts.push(`World ${outcome.world.id} reaches its first effect; show one concrete consequence.`);
        else if (outcome.world?.action === "land") facts.push(`World ${outcome.world.id} lands now; realize it and write “World: land ${outcome.world.id}: how”.`);
        if (outcome.mustLand) facts.push(`Deferred ${outcome.mustLand} has been deferred twice; if it comes up, it must land as a MAJOR.`);
        if (outcome.mustClose) facts.push(`THREAD “${fate.pursuit}” has reached its pursuit limit; it must close or park this turn.`);
        for (const owed of fate.owed) facts.push(`Owed residue: ${owed} — write a Fate: residue: line this turn.`);
        facts.push(outcome.dangerLifted
            ? `Danger ceiling lifts this turn (MAJOR + TRUE, C = ${cfg.dangerC ?? 20}).`
            : `Danger ceiling stays in place; it lifts only on MAJOR + TRUE with C = ${cfg.dangerC ?? 20}.`);
        return facts;
    },
    prompt(value) {
        const parts = [`Fate & Routine: ${value.state === "THREAD" ? `THREAD “${value.pursuit}” (ts ${value.ts})` : "ROUTINE"} · quiet ${value.q} · since MAJOR ${value.sinceMajor}`];
        for (const item of value.deferred) parts.push(`- ${item.id} ${item.desc} · deferred ×${item.times} · age ${item.age}`);
        for (const item of value.world) {
            parts.push(`- ${item.id} ${item.desc} · ${item.prox} · Reach ${item.reach} · age ${item.age}`);
            for (const update of item.updates || []) parts.push(`  ${item.id} update: ${update}`);
        }
        for (const item of value.ambitions) parts.push(`- Ambition ${item.desc} · ${item.progress}/5`);
        if (value.residue.length) parts.push(`Residue: ${value.residue.join("; ")}`);
        if (value.owed.length) parts.push(`Owed: ${value.owed.join("; ")}`);
        return parts.join("\n");
    },
    rules(ctx) {
        const cfg = cfgOf(ctx);
        return [
            "Fate & Routine: open a THREAD pursuit for a story-bearing question; close or park it with the consequence when answered or set aside. Defer a pursuit only when its result cannot land yet; `resolve D#` records that it was paid off.",
            "A WILL is a concrete thing someone wants. Track meaningful progress with `ambition +1`; progress never falls from Fate, and 5/5 becomes a LOCAL happening with residue owed.",
            "World W# entries are displayed inside Fate & Routine. Under either Fate: or World:, use `update W#: new development` for changed facts without a change in scope, or `escalate W#: new development` when the event truly spreads (LOCAL and Reach 3 are the caps). Bare `escalate W#` is also valid. Both annotated commands APPEND a chronological update; they never replace the original description or earlier updates. Report only what is new, one command per line; preserve important previous facts without copying them into the new note. Say explicitly when a new estimate supersedes an old one. A repair status alone is not a reason to escalate.",
            "For a generic consequence that actually occurred in the story, `World CONSEQUENCE landed as aftermath` is valid under Fate: or World:. Replace aftermath with the concrete result. CONSEQUENCE is a generic report label, independent of the rolled World Sim event; it is valid on TRUE or WEIGHTED turns and records residue without changing the rolled event, tier, source, World entries or unrelated owed aftermath. Use it to record an observed result, never to force an event to occur.",
            "For world news, keep the reported channel recognizable, allow a plausible in-world distortion, and scale reactions to the event's actual reach. Keep ordinary scenes ordinary when Fate says AMBIENT. The ledger already records the turn's tier and source; omit Fate when no pursuit, deferred item, ambition or residue changed, rather than writing an AMBIENT/MINOR/MAJOR recap. Omit unchanged World entries instead of repeating their proximity or W#. Use the selected World Sim event only when this turn's source is TRUE. For its realized aftermath, write `World EVENT landed as aftermath`, replacing EVENT with the announced name and aftermath with the actual consequence. For an independent story consequence, prefer `World CONSEQUENCE landed as aftermath`. A recognized landed event label also records observed narrative aftermath even when it differs from the selected World Sim event; this bookkeeping never changes the roll, tier, source or World entries and never clears unrelated owed residue. Never use a landed report to force an event to happen. For a separate consequence of story actions at MINOR or MAJOR, use `MINOR consequence landed: aftermath` or `MAJOR consequence landed: aftermath`, matching this turn's tier.",
            `A twice-deferred item cannot be deferred again. Pursuits at ts ${cfg.pursuitLimit ?? 8} must close or park. Record a concise residue line for each owed aftermath; do not erase old residue except by the configured tail.`,
        ].join("\n");
    },
    // commands covers both headings; worldCommands are the ones written under World:
    commands: [...FATE_COMMANDS, ...WORLD_COMMANDS],
    worldCommands: WORLD_COMMANDS,
    template: ctx => [...commandTemplate("Fate", FATE_COMMANDS, ctx), ...commandTemplate("World", WORLD_COMMANDS, ctx)],
};


