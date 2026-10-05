// ──────────────────────────────────────────────────────────────────────────────
// 🎲 FATE & ROUTINE — carried pursuits, deferred beats, world happenings,
// ambitions and residue. Dice are decided once before the reply; after() applies
// their bookkeeping after the model's change lines. Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW } from "../text.js";
import { nextId } from "../state.js";
import { computeFate, reachFor } from "../fate-engine.js";

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

function oweResidue(fate, text) {
    if (text) fate.owed.push(String(text).trim());
}

function addWorld(fate, state, prox, desc, c, ctx) {
    const id = nextId(state, "W", fate.world.map(item => item.id));
    fate.world.push({ id, desc, prox, reach: reachFor(prox, c), age: 0 });
    ctx.touched.add(`fate:${id}`);
    return id;
}

function parseLastTurnRows(rows, value, errors) {
    let dice = null, turn = null;
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
    carried: true,
    empty: emptyFate,
    decide(prev, ctx) {
        const dice = ctx.config.dice?.fate;
        if (!dice) return null;
        const cfg = { ...cfgOf(ctx), chekhov: ctx.config.sectionConfig?.chekhov };
        return computeFate(prev, dice, ctx.config.fudges || null, cfg);
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
        rows.push(...value.world.map(item => `- <b>${item.id}</b> ${esc(item.desc)} | ${item.prox} · Reach ${item.reach} · age ${item.age}`));
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
        const byDeferred = id => byId(fate.deferred, id);
        for (const raw of lines) {
            const line = String(raw).trim();
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
            } else if ((m = line.match(/^defer\s+(D\d+)$/i)) && (item = byDeferred(m[1]))) {
                item.times = Math.min(2, item.times + 1);
                ctx.touched.add(`fate:${item.id}`);
            } else if ((m = line.match(/^resolve\s+(D\d+)$/i)) && (item = byDeferred(m[1]))) {
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
            } else unparsed.push(line);
        }
        for (const raw of ctx.linesUnder("World")) {
            const line = String(raw).trim();
            let m, item;
            if ((m = line.match(/^\+\s*(ELSEWHERE|REGIONAL|LOCAL)\s*:\s*(.+)$/i))) {
                const c = outcome.dice.c;
                const desc = m[2].trim().replace(/\s*\(Reach\s+\d+\)\s*$/i, "");
                addWorld(fate, state, m[1].toUpperCase(), desc, c, ctx);
            } else if ((m = line.match(/^escalate\s+(W\d+)$/i)) && (item = byId(fate.world, m[1]))) {
                item.prox = { ELSEWHERE: "REGIONAL", REGIONAL: "LOCAL", LOCAL: "LOCAL" }[item.prox];
                item.reach = Math.min(3, item.reach + 1);
            } else if ((m = line.match(/^land\s+(W\d+)\s*:\s*(.+)$/i)) && (item = byId(fate.world, m[1]))) {
                fate.world = fate.world.filter(w => w !== item);
                oweResidue(fate, `${item.id} “${item.desc}” landed: ${m[2].trim()}`);
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
                oweResidue(fate, `${entry.id} “${entry.desc}” landed; write its residue.`);
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
        for (const item of value.world) parts.push(`- ${item.id} ${item.desc} · ${item.prox} · Reach ${item.reach} · age ${item.age}`);
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
            "For world news, keep the reported channel recognizable, allow a plausible in-world distortion, and scale reactions to the event's actual reach. Keep ordinary scenes ordinary when Fate says AMBIENT.",
            `A twice-deferred item cannot be deferred again. Pursuits at ts ${cfg.pursuitLimit ?? 8} must close or park. Record a concise residue line for each owed aftermath; do not erase old residue except by the configured tail.`,
        ].join("\n");
    },
    template: () => [
        "Fate:",
        "- [pursuit: question · close: residue · park: residue · defer: desc · defer D# · resolve D# · ambition: want · ambition +1 prefix · residue: aftermath]",
        "World:",
        "- [+ ELSEWHERE|REGIONAL|LOCAL: happening · escalate W# · land W#: how it lands]",
    ],
};


