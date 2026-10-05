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
