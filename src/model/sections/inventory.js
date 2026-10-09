// ──────────────────────────────────────────────────────────────────────────────
// 🎒 INV & SKILLS — {{user}}'s items, titles, conditions and roll modifiers.
// Tracked for {{user}} only. Items have I# rows; titles and conditions remain
// "; "-separated, with a literal ";" escaped as &#59;. Old item lists still read. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { esc, unesc, ROW, removeByName, nameMatches, closedForm } from "../text.js";
import { commandTemplate } from "../commands.js";
import { foldQuotes } from "../normalize.js";
import { nextId } from "../state.js";
import { decimal, adjustDecimal } from "../decimal.js";

const COMMANDS = [
    { id: "inv.add", form: "+ item", example: "+ brass key", keywords: [] },
    { id: "inv.remove", form: "- item", example: "- brass key", keywords: [] },
    { id: "inv.remove-id", form: "- I# (why)", example: "- I1 (left behind)", keywords: [] },
    { id: "inv.update", form: "I# update: description", example: "I1 update: brass key (on Jan)", keywords: ["update"] },
    { id: "inv.money-set", form: "money: amount currency", example: "money: 50 USD", keywords: ["money"] },
    { id: "inv.money-add", form: "money + amount currency (why)", example: "money + 5 USD (refund)", keywords: ["money"] },
    { id: "inv.money-spend", form: "money - amount currency (why)", example: "money - 18 USD (purchase)", keywords: ["money"] },
    { id: "inv.supply", form: "supply: amount unit | item", example: "supply: 12 rounds | 9mm ammunition", keywords: ["supply"] },
    { id: "inv.quantity", form: "I# quantity: amount unit", example: "I1 quantity: 12 rounds", keywords: ["quantity"] },
    { id: "inv.adjust", form: "I# adjust: delta (why)", example: "I1 adjust: -3 (fired)", keywords: ["adjust"] },
    { id: "inv.title-add", form: "title: name", example: "title: Harbour Friend", keywords: ["title"] },
    { id: "inv.title-remove", form: "title - name", example: "title - Harbour Friend", keywords: ["title"] },
    { id: "inv.status-add", form: "status + condition", example: "status + Tired", keywords: ["status"] },
    { id: "inv.status-remove", form: "status - condition", example: "status - Tired", keywords: ["status"] },
    { id: "inv.mods", form: "mods: text", example: "mods: +1 Stealth (soft boots)", keywords: ["mods"] },
];

const ROWS = [["items", "Inv"], ["titles", "Titles/Skills"], ["status", "Status"]];
const writeList = list => list.map(v => esc(v).replace(/;/g, "&#59;")).join("; ") || "—";
// split on ";" that is not the end of an entity such as &amp; or &#124;
const readList = text => {
    const t = String(text || "").trim();
    if (!t || t === "—") return [];
    return t.split(/(?<!&(?:amp|lt|gt|#\d+));\s*/).map(v => unesc(v.replace(/&#59;/g, ";"))).filter(Boolean);
};
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const remove = (list, v) => { const i = list.findIndex(x => same(x, v)); if (i < 0) return false; list.splice(i, 1); return true; };

// Legacy tagged replies recognize removal explanations; other qualifiers stay literal.
const EXPLAINED = /\s+\((?:dropped|lost|used|left|given|consumed|discarded|spent|handed)\b[^()]*\)\s*$/i;
const itemKey = text => foldQuotes(text).trim().replace(/^1\s+/, "").toLowerCase();
const validId = id => /^I[1-9]\d*$/i.test(String(id)) && Number.isSafeInteger(Number(String(id).slice(1)));

/** Add persistent identities alongside the string list, including older/imported inventories. Mutates. */
export function ensureItemIds(state, prevInv) {
    const inv = state.inv;
    if (!inv || (!inv.items.length && !inv.itemIds)) return;
    const rawIds = inv.itemIds || [];
    const claimed = new Set(rawIds.filter(validId).map(id => id.toUpperCase()));
    const reserved = [...rawIds, ...(prevInv?.itemIds || [])].filter(validId).map(id => id.toUpperCase());
    if (reserved.length) {
        state.ids = state.ids || {};
        state.ids.I = Math.max(state.ids.I || 0, ...reserved.map(id => Number(id.slice(1))));
    }
    const used = new Set();
    inv.itemIds = inv.items.map((item, i) => {
        let id = validId(rawIds[i]) ? rawIds[i].toUpperCase() : null;
        if (!id && prevInv?.itemIds) {
            const old = prevInv.items.findIndex((value, j) => same(value, item) && validId(prevInv.itemIds[j]) && !used.has(prevInv.itemIds[j].toUpperCase()) && !claimed.has(prevInv.itemIds[j].toUpperCase()));
            if (old >= 0) id = prevInv.itemIds[old].toUpperCase();
        }
        if (!id || used.has(id)) id = nextId(state, "I", reserved);
        used.add(id);
        return id;
    });
}

// Only trailing, whitespace-separated parentheticals are notes; embedded parentheses stay literal.
function baseItem(text) {
    let value = text.trim();
    while (value.endsWith(")")) {
        let depth = 0, start = -1;
        for (let i = value.length - 1; i >= 0; i--) {
            if (value[i] === ")") depth++;
            else if (value[i] === "(" && --depth === 0) { start = i; break; }
        }
        if (start <= 0 || !/\s/.test(value[start - 1])) break;
        value = value.slice(0, start).trimEnd();
    }
    return itemKey(value);
}

function removalNote(text) {
    const note = text.trim();
    if (!note) return true;
    if (note[0] !== "(") return false;
    let depth = 0;
    for (let i = 0; i < note.length; i++) {
        if (note[i] === "(") depth++;
        else if (note[i] === ")") depth--;
        else if (depth === 0 && !/\s/.test(note[i])) return false;
        if (depth < 0) return false;
    }
    return depth === 0;
}

const NUMBER = /^(\d+(?:\.\d+)?|\.\d+)([\s\S]*)$/;
const CURRENCY = /^(?:[\p{L}][\p{L}\p{N}_-]*|[$€£¥₹₽₩₿])$/u;
function measured(text, money = false) {
    const source = text.trim();
    const prefix = money && source.match(/^([$€£¥₹₽₩₿])\s*(.*)$/u);
    const number = (prefix ? prefix[2] : source).match(NUMBER);
    if (!number) return null;
    // A malformed numeric suffix is not a unit or currency (1,000, 1e3, 1/2).
    if (/^(?:[.,/+-]|[eE][+-]?\d)/.test(number[2])) return null;
    const rest = number[2].trim(), noteAt = rest.indexOf("(");
    const unit = (noteAt < 0 ? rest : rest.slice(0, noteAt)).trim();
    if (!removalNote(noteAt < 0 ? "" : rest.slice(noteAt))) return null;
    if (prefix && unit) return null;
    const label = prefix ? prefix[1] : unit;
    if (money ? (label && !CURRENCY.test(label)) : (!label || /[|]/.test(label))) return null;
    return { amount: decimal(number[1]), unit: money ? label.toUpperCase() : label };
}

function moneyChange(inv, line) {
    const command = closedForm(line).match(/^money\s*(:|[+-])\s*(.*)$/i);
    if (!command) return false;
    const value = measured(command[2], true);
    if (!value) return false;
    const keys = Object.keys(inv.money || {});
    const currency = value.unit || (keys.length === 1 ? keys[0] : keys.length === 0 && command[1] === ":" ? "" : null);
    if (currency === null) return false;
    if (command[1] === ":") {
        inv.money = { ...(inv.money || {}), [currency]: value.amount };
        return true;
    }
    if (!Object.hasOwn(inv.money || {}, currency)) return false;
    const next = adjustDecimal(inv.money[currency], command[1] + value.amount);
    if (next === null) return false;
    inv.money[currency] = next;
    return true;
}

function removeEntry(inv, at) {
    const id = inv.itemIds[at];
    inv.items.splice(at, 1); inv.itemIds.splice(at, 1);
    if (inv.supplies) {
        delete inv.supplies[id];
        if (!Object.keys(inv.supplies).length) delete inv.supplies;
    }
}

function itemIndex(list, text, rawText, normalized) {
    if (normalized) {
        const hits = nameMatches(list, text, rawText);
        if (hits.length) return hits[0];
        if (hasFoldedName(list, text)) return -1;
        const base = baseItem(text);
        const candidates = list.flatMap((value, i) => base && baseItem(value) === base ? [i] : []);
        return candidates.length === 1 ? candidates[0] : -1;
    }
    // Preserve the old tagged-reply matching behavior.
    let at = list.findIndex(value => same(value, text));
    if (at >= 0) return at;
    const item = text.replace(EXPLAINED, "").trim();
    at = list.findIndex(value => same(value, item));
    if (at >= 0) return at;
    const single = item.match(/^1\s+(.+)$/);
    return single ? list.findIndex(value => same(value, single[1])) : -1;
}

// A conversion annotation describes why the old condition ended; it does not add the new one.
const hasFoldedName = (list, text) => list.some(value => same(foldQuotes(value), foldQuotes(text)));
function removeStatus(list, text, rawText, del, normalized) {
    if (del(list, text, rawText)) return true;
    // A failed removal with quote-equivalent candidates is ambiguous, not an annotation.
    if (!normalized || hasFoldedName(list, text)) return false;
    const converted = /\s+converted\s+to\s+\S.*$/i;
    const name = text.replace(converted, "").trim();
    const rawName = rawText === undefined ? undefined : rawText.replace(converted, "").trim();
    if (name !== text) {
        if (del(list, name, rawName)) return true;
        if (hasFoldedName(list, name)) return false;
    }
    // Clearing an absent condition already has the requested result. No fuzzy deletion.
    return true;
}

export default {
    key: "inv",
    title: "🎒 INV & SKILLS",
    match: /^INV SKILLS$/,
    change: "Inventory",
    aliases: ["Inv", "Inv & Skills"],
    carried: true,
    empty: () => ({ items: [], titles: [], status: [], mods: "" }),
    render: value => [
        ...Object.entries(value.money || {}).map(([currency, amount]) => `- <b>Money${currency ? ` ${esc(currency)}` : ""}:</b> ${amount}`),
        ...(value.items.length ? value.items.map((item, i) => {
            const id = value.itemIds[i], supply = value.supplies?.[id];
            return supply ? `- <b>Supply ${id}:</b> amount: ${supply.amount} | unit: ${esc(supply.unit)} | item: ${esc(item)}` : `- <b>Item ${id}:</b> ${esc(item)}`;
        }) : ["- <b>Inv:</b> —"]),
        ...ROWS.filter(([k]) => k !== "items").map(([k, label]) => `- <b>${label}:</b> ${writeList(value[k])}`),
        `- <b>Mods:</b> ${value.mods ? esc(value.mods) : "—"}`,
    ],
    parse(rows, prevValue) {
        const value = { items: [], titles: [], status: [], mods: "" }, errors = [];
        const itemIds = [], seen = new Set();
        let itemError = false, moneyError = false;
        for (const row of rows) {
            const m = row.match(ROW);
            const label = m && m[1].replace(/:\s*$/, "").trim().toLowerCase();
            const hit = m && ROWS.find(([, l]) => l.toLowerCase() === label);
            const item = m && m[1].match(/^Item\s+(I\d+)\s*:?\s*$/i);
            const money = m && m[1].match(/^Money(?:\s+([^:]+))?\s*:?\s*$/i);
            const supply = m && m[1].match(/^Supply\s+(I\d+)\s*:?\s*$/i);
            if (money) {
                const currency = unesc(money[1] || "").toUpperCase(), amount = decimal(unesc(m[2]));
                if ((currency && !CURRENCY.test(currency)) || amount === null || Object.hasOwn(value.money || {}, currency)) { errors.push(row); moneyError = true; }
                else value.money = { ...(value.money || {}), [currency]: amount };
            }
            else if (supply) {
                const fields = m[2].match(/^amount:\s*([^|]+)\|\s*unit:\s*([^|]+)\|\s*item:\s*(\S.*)$/);
                const id = supply[1].toUpperCase(), amount = fields && decimal(fields[1]);
                if (!validId(id) || !fields || amount === null || !unesc(fields[2]) || seen.has(id)) { errors.push(row); itemError = true; }
                else {
                    value.items.push(unesc(fields[3])); itemIds.push(id); seen.add(id);
                    value.supplies = value.supplies || {};
                    value.supplies[id] = { amount, unit: unesc(fields[2]) };
                }
            }
            else if (item && validId(item[1]) && unesc(m[2]) && !seen.has(item[1].toUpperCase())) {
                value.items.push(unesc(m[2])); itemIds.push(item[1].toUpperCase()); seen.add(item[1].toUpperCase());
            }
            else if (m && /^Item\b/i.test(m[1])) { errors.push(row); itemError = true; }
            else if (hit && hit[0] === "items") {
                const items = readList(m[2]); value.items.push(...items); itemIds.push(...items.map(() => null));
            }
            else if (hit) value[hit[0]] = readList(m[2]);
            else if (label === "mods") { const t = unesc(m[2]); value.mods = t === "—" ? "" : t; }
            else {
                errors.push(row);
                // Unknown labels may be damaged money or supply rows. Preserve
                // both collections rather than silently accepting partial data.
                itemError = true;
                moneyError = true;
            }
        }
        if (itemIds.length) value.itemIds = itemIds;
        if (errors.length && prevValue) for (const k of ["items", "titles", "status"]) if (!value[k].length || (k === "items" && itemError)) {
            value[k] = [...prevValue[k]];
            if (k === "items") {
                if (prevValue.itemIds) value.itemIds = [...prevValue.itemIds];
                else delete value.itemIds;
                if (prevValue.supplies) value.supplies = structuredClone(prevValue.supplies);
                else delete value.supplies;
            }
        }
        if (moneyError && prevValue) {
            if (prevValue.money) value.money = { ...prevValue.money };
            else delete value.money;
        }
        return { value, errors };
    },
    apply(state, lines, ctx) {
        const inv = state.inv;
        ensureItemIds(state);
        const unparsed = [];
        // the comment path removes by raw name with a quote fallback; tagged replies stay exact
        const normalized = Boolean(ctx && ctx.normalizedChanges);
        const raws = normalized ? ctx.rawLinesUnder("Inventory") : [];
        const del = normalized ? removeByName : (list, v) => remove(list, v);
        lines.forEach((text, i) => {
            const line = String(text).trim();   // parseChanges already removed the list bullet
            const rawLine = normalized && raws[i] !== undefined ? String(raws[i]).trim() : null;
            // the same capture from the unfolded line
            const rawOf = re => { const r = rawLine && rawLine.match(re); return r ? r[1] : undefined; };
            let m;
            if (normalized && /^money\b/i.test(line)) {
                if (!moneyChange(inv, line)) unparsed.push(line);
            }
            else if (normalized && /^(?:supply\b|\+\s*supply\s*:)/i.test(line)) {
                m = line.match(/^(?:\+\s*)?supply\s*:\s*(.*?)\s*\|\s*(\S[\s\S]*)$/i);
                const quantity = m && measured(m[1]);
                if (!quantity) unparsed.push(line);
                else {
                    const id = nextId(state, "I", inv.itemIds || []);
                    inv.items.push(m[2].trim()); inv.itemIds = inv.itemIds || []; inv.itemIds.push(id);
                    inv.supplies = { ...(inv.supplies || {}), [id]: quantity };
                }
            }
            else if (normalized && (m = line.match(/^(I\d+)\s+(quantity|adjust)\s*:\s*(.*)$/i))) {
                const id = m[1].toUpperCase(), at = (inv.itemIds || []).indexOf(id);
                if (m[2].toLowerCase() === "quantity") {
                    const quantity = measured(m[3]);
                    if (at < 0 || !quantity) unparsed.push(line);
                    else inv.supplies = { ...(inv.supplies || {}), [id]: quantity };
                } else {
                    const adjustment = closedForm(m[3]).match(/^([+-])\s*(\d+(?:\.\d+)?|\.\d+)([\s\S]*)$/);
                    const supply = inv.supplies?.[id];
                    const next = supply && adjustment && removalNote(adjustment[3]) ? adjustDecimal(supply.amount, adjustment[1] + adjustment[2]) : null;
                    if (at < 0 || next === null) unparsed.push(line);
                    else supply.amount = next;
                }
            }
            else if (normalized && (m = line.match(/^(I\d+)\s+update\s*:\s*(.*)$/i))) {
                const at = (inv.itemIds || []).indexOf(m[1].toUpperCase());
                if (at < 0 || !m[2].trim()) unparsed.push(line);
                else inv.items[at] = m[2].trim();
            }
            else if (normalized && /^-\s*I\d+\b/i.test(line)) {
                m = closedForm(line).match(/^-\s*(I\d+)\b([\s\S]*)$/i);
                const at = m && removalNote(m[2]) ? (inv.itemIds || []).indexOf(m[1].toUpperCase()) : -1;
                if (at < 0) unparsed.push(line);
                else removeEntry(inv, at);
            }
            else if ((m = line.match(/^title\s*:\s*(.+)$/i))) { if (!inv.titles.some(t => same(t, m[1]))) inv.titles.push(m[1].trim()); }
            else if ((m = line.match(/^title\s*-\s*(.+)$/i))) { if (!del(inv.titles, m[1], rawOf(/^title\s*-\s*(.+)$/i))) unparsed.push(line); }
            else if ((m = line.match(/^status\s*[:+]\s*(.+)$/i))) {
                // A model's semicolon-separated status recap adds conditions; only status - removes one.
                const conditions = readList(m[1]);
                if (!conditions.length) unparsed.push(line);
                for (const condition of conditions) if (!inv.status.some(t => same(t, condition))) inv.status.push(condition);
            }
            else if ((m = line.match(/^status\s*-\s*(.+)$/i))) {
                // Keep literal legacy values containing semicolons removable by their exact name.
                const rawValue = rawOf(/^status\s*-\s*(.+)$/i);
                if (del(inv.status, m[1], rawValue)) return;
                if (normalized && hasFoldedName(inv.status, m[1])) { unparsed.push(line); return; }
                const conditions = readList(m[1]);
                // folding never moves a ";", so both forms split into the same members
                const rawConditions = rawValue === undefined ? [] : readList(rawValue);
                const aligned = rawConditions.length === conditions.length;
                if (!conditions.length) unparsed.push(line);
                conditions.forEach((condition, j) => {
                    if (!removeStatus(inv.status, condition, aligned ? rawConditions[j] : undefined, del, normalized)) unparsed.push(`status - ${condition}`);
                });
            }
            else if ((m = line.match(/^mods\s*:\s*(.*)$/i))) inv.mods = m[1].trim();
            else if ((m = line.match(/^\+\s*(.+)$/))) {
                inv.items.push(m[1].trim());
                inv.itemIds = inv.itemIds || [];
                inv.itemIds.push(nextId(state, "I", inv.itemIds));
            }
            else if ((m = line.match(/^-\s*(.+)$/))) {
                const at = itemIndex(inv.items, m[1], rawOf(/^-\s*(.+)$/), normalized);
                if (at < 0) unparsed.push(line);
                else removeEntry(inv, at);
            }
            else unparsed.push(line);
        });
        return unparsed;
    },
    prompt(value, state) {
        const snapshot = { inv: { ...value, items: [...value.items], itemIds: value.itemIds ? [...value.itemIds] : undefined }, ids: { ...(state?.ids || {}) } };
        ensureItemIds(snapshot);
        const parts = [];
        const money = Object.entries(value.money || {}).map(([currency, amount]) => `${amount}${currency ? ` ${currency}` : ""}`);
        const supplies = [], items = [];
        value.items.forEach((item, i) => {
            const id = snapshot.inv.itemIds[i], supply = value.supplies?.[id];
            if (supply) supplies.push(`${id}: ${supply.amount} ${supply.unit} — ${item}`);
            else items.push(`${id}: ${item}`);
        });
        if (money.length) parts.push(`Money: ${money.join("; ")}`);
        if (supplies.length) parts.push(`Supplies: ${supplies.join("; ")}`);
        if (items.length) parts.push(`carries ${items.join("; ")}`);
        if (value.titles.length) parts.push(`titles ${value.titles.join("; ")}`);
        if (value.status.length) parts.push(`status ${value.status.join("; ")}`);
        if (value.mods) parts.push(`mods ${value.mods}`);
        return parts.length ? `{{user}}: ${parts.join(" · ")}` : "";
    },
    rules: () => [
        "Money is a balance per currency, without item IDs. Initialize or explicitly correct it with `money: amount currency`; report actual income with `money + amount currency (why)` and spending with `money - amount currency (why)`. Report the amount actually handed over after any returned change, not just the price. The ledger calculates balances; never restate a balance every turn. Copy the currency from Money; omit it only when there is one unambiguous balance. Do not infer a balance from a bill's denomination. Noteworthy bills remain ordinary items or counted supplies, and do not automatically alter Money.",
        "Supplies are counted or measured stacks (ammo, food, batteries, water), each with an I# ID. Create a new stack with `supply: amount unit | item`; convert an existing item or explicitly correct its count with `I# quantity: amount unit`. For partial use or replenishment, write a signed delta such as `I# adjust: -3 (used)` or `I# adjust: +5 (restocked)`; the ledger does the arithmetic. Reuse an existing ID rather than creating a new stack every turn. Keep ammo types, units and other distinct supplies separate. Quantity metadata is authoritative; a number in an item's description does not set its count. Zero balances and stacks retain identity for replenishment; adjustments cannot overdraw known amounts. A `- I#` line removes the whole entry.",
        "Inventory is {{user}}'s alone: add items with `+ item` when found; the ledger assigns their I# IDs. Prefer `- I# (why)` when lost or used, and `I# update: description` when an item's description or holder changes; copy an existing ID from the inventory, never invent one. Name removals also work: full name first, otherwise a unique base name ignoring trailing parenthetical notes; ambiguous items need an ID. IDs are not unit counts. Award a title for a real accomplishment; track temporary conditions (Injured, Tired, Inspired) and clear them with time or action. Active conditions are in Status; condition text inside items or titles does not create a Status entry. For status removals, copy the existing condition name exactly, without explanations; clearing an already-absent condition is harmless. A changed condition needs two lines: `status - old condition` and `status + new condition`. Mods are ±1–2 on rolls in the domain they fit only. Never put stats, modifiers or title names in prose.",
    ].join("\n"),
    commands: COMMANDS,
    template: ctx => commandTemplate("Inventory", COMMANDS, ctx),
};
