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
