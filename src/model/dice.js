// ──────────────────────────────────────────────────────────────────────────────
// Dice. Rolled by the extension, never by the model. Pure apart from the default
// random source (crypto.getRandomValues, available in browsers and Node ≥ 19).
// ──────────────────────────────────────────────────────────────────────────────

/** A float in [0, 1). */
export function defaultRng() {
    const a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    return a[0] / 2 ** 32;
}

/** `n` d20 rolls. */
export const rollD20s = (n, rng = defaultRng) => Array.from({ length: n }, () => 1 + Math.floor(rng() * 20));

/** Fate A/B/C, one World Sim roll, and the three check dice offered for a turn. */
export function rollTurnDice(rng = defaultRng) {
    const rolls = rollD20s(7, rng);
    return { fate: { a: rolls[0], b: rolls[1], c: rolls[2] }, world: rolls[3], checks: rolls.slice(4) };
}

const isD20 = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 20;
const clone = value => JSON.parse(JSON.stringify(value));

/** Apply locked reader values to freshly rolled turn dice without mutating either input. */
export function withFudges(dice, fudges) {
    const result = { ...(dice || {}) };
    if (dice?.fate) result.fate = { ...dice.fate };
    if (Array.isArray(dice?.checks)) result.checks = [...dice.checks];
    const locks = fudges?.dice || {};
    const applied = [];
    for (const key of ["fate.a", "fate.b", "fate.c"]) {
        if (isD20(locks[key])) {
            result.fate = { ...(result.fate || {}) };
            result.fate[key.at(-1)] = Number(locks[key]);
            applied.push(key);
        }
    }
    if (isD20(locks.world)) {
        result.world = Number(locks.world);
        applied.push("world");
    }
    if (Array.isArray(locks.checks) && locks.checks.length === 3 && locks.checks.every(isD20)) {
        result.checks = locks.checks.map(Number);
        applied.push("checks");
    }
    return { dice: result, fudged: applied };
}

/** Keep saved controls across replies until cleared; do not apply them to earlier replies. */
export function fudgesForGeneration(fudges, index) {
    if (!fudges || typeof fudges !== "object") return { active: null, next: null };
    if (fudges.appliedTo === null || fudges.appliedTo === undefined) {
        const next = clone(fudges);
        next.appliedTo = index;
        return { active: clone(fudges), next };
    }
    if (index >= fudges.appliedTo) return { active: clone(fudges), next: clone(fudges) };
    return { active: null, next: clone(fudges) };
}

function blockSections(mes) {
    const sections = new Map();
    const titleKey = title => title.replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
    const re = /<summary>([\s\S]*?)<\/summary>([\s\S]*?)(?=<\/details>)/gi;
    for (const match of String(mes || "").matchAll(re)) sections.set(titleKey(match[1]), match[2]);
    return sections;
}

function rowValue(body, field) {
    if (!body) return null;
    const re = new RegExp(`^[-*•]\\s*<b>${field}:<\\/b>\\s*(.*?)\\s*$`, "im");
    return body.match(re)?.[1] ?? null;
}

/** Read dice shown in this reply's Fate, World Sim, and Check rows. */
export function diceFromBlock(mes) {
    const sections = blockSections(mes);
    const result = {};
    const fate = rowValue(sections.get("FATE ROUTINE"), "Rolls")
        ?.match(/^A\s*(\d+)\s*·\s*B\s*(\d+)\s*·\s*C\s*(\d+)(?:\s+\(fudged:[^)]+\))?$/i);
    if (fate) result.fate = { a: Number(fate[1]), b: Number(fate[2]), c: Number(fate[3]) };
    const world = rowValue(sections.get("WORLD SIM"), "Roll")?.match(/^(\d+)(?:\s+\(fudged\))?$/i);
    if (world) result.world = Number(world[1]);
    const checks = rowValue(sections.get("DND TASK SIM"), "Rolls") || rowValue(sections.get("WIND S ARROW"), "Rolls");
    const parsedChecks = checks?.match(/^(\d+(?:\s*,\s*\d+)*)(?:\s+\(fudged\))?$/i);
    if (parsedChecks) result.checks = parsedChecks[1].split(/\s*,\s*/).map(Number);
    return result;
}

/** Parse `fate.a=20 world=7 checks=20,3,11` into the chat's fudge record shape. */
export function parseDiceCommand(text) {
    const raw = String(text || "").trim();
    if (!raw) throw new Error("Give dice locks such as fate.a=20 world=7 checks=20,3,11.");
    const dice = {};
    for (const token of raw.split(/\s+/)) {
        const match = token.match(/^([^=]+)=(.+)$/);
        if (!match) throw new Error(`Could not read dice lock "${token}"; use field=value.`);
        const key = match[1].toLowerCase(), value = match[2];
        if (["fate.a", "fate.b", "fate.c", "world"].includes(key)) {
            if (!isD20(value)) throw new Error(`${key} must be a whole number from 1 to 20.`);
            dice[key] = Number(value);
        } else if (key === "checks") {
            const values = value.split(",");
            if (values.length !== 3 || values.some(item => !isD20(item))) throw new Error("checks needs three whole numbers from 1 to 20, separated by commas.");
            dice.checks = values.map(Number);
        } else throw new Error(`Unknown dice field "${match[1]}"; use fate.a, fate.b, fate.c, world, or checks.`);
    }
    return { dice };
}

/** Parse an explicit tier/source override or the combined calm control. */
export function parseForceCommand(text) {
    const parts = String(text || "").trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (parts.length === 1 && parts[0] === "CALM") return { calm: true };
    if (!parts.length || parts.length > 2 || !["AMBIENT", "MINOR", "MAJOR"].includes(parts[0]) ||
        (parts.length === 2 && !["TRUE", "WEIGHTED"].includes(parts[1]))) {
        throw new Error("Invalid force command. Use AMBIENT, MINOR, or MAJOR with optional TRUE or WEIGHTED; or use calm.");
    }
    return { tier: parts[0], ...(parts[1] ? { source: parts[1] } : {}) };
}

/**
 * The check dice a generation starts with, and the pending record to keep for it.
 * `index` is the reply the generation writes; `shown` is the Rolls row that reply's
 * block already has (a continue keeps those). Pending dice belong to one chat and one
 * reply only.
 */
export function rollsForGeneration({ type, chatId, index, pending, shown, checksOn, roll = () => rollD20s(3) }) {
    let rolls = [];
    if (checksOn) {
        if (type === "continue" && shown && shown.length) rolls = [...shown];
        else if (type === "continue" && pending && pending.chatId === chatId && pending.index === index) rolls = [...pending.rolls];
        else rolls = roll();
    }
    return { chatId, index, rolls };
}

/** The dice a received reply's block records: the pending ones when they were rolled for this reply, else what it already shows. */
export function rollsForReceive({ chatId, index, pending, shown }) {
    if (pending && pending.chatId === chatId && pending.index === index) return [...pending.rolls];
    return shown ? [...shown] : [];
}
