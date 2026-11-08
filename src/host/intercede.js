// ──────────────────────────────────────────────────────────────────────────────
// Story Ledger with Intercede (SillyTavern). Intercede cuts the newest reply, keeps its start,
// adds the reader's line as a user message and regenerates the rest. The ledger's block sat
// at the end of the reply, so it went with the cut — and with it the reply's dice. The rewrite
// is the same turn, so it must keep them.
//
// Pure: the SillyTavern host (index.js) reads and saves chat metadata around these.
//   tailDice     — the newest reply's dice, remembered when its block is written.
//   interjectDice — the dice an Intercede transaction inherited, keyed by its transactionId,
//                   so a swipe of the rewrite inherits them after tailDice moved on.
// ──────────────────────────────────────────────────────────────────────────────

import { diceFromBlock } from "../model/dice.js";
import { BLOCK_MARK } from "../model/block.js";

const hasBlock = msg => String(msg?.mes || "").includes(BLOCK_MARK);
const swipeOf = msg => msg?.swipe_id ?? 0;

/** The dice of reply `index`'s ledger block, as { index, swipeId, dice }, or null without one. */
export function tailDiceRecord(chat, index) {
    const msg = chat?.[index];
    if (!msg || msg.is_user || msg.is_system || !hasBlock(msg)) return null;
    return { index, swipeId: swipeOf(msg), dice: diceFromBlock(msg.mes) };
}

/**
 * The dice a generation building on `chat.slice(0, base)` inherits from a reply Intercede cut,
 * as { dice, interjectDice } (interjectDice is what the host stores), or null when this is not
 * an Intercede rewrite or the cut reply's dice are not known.
 */
export function intercedeInheritance(chat, base, chatData) {
    const asked = chat?.[base - 1];
    const cut = chat?.[base - 2];
    if (!asked?.is_user || !cut || cut.is_user || cut.is_system) return null;
    const marker = cut.extra?.intercede;
    if (!marker || marker.role !== "prefix" || !marker.transactionId || hasBlock(cut)) return null;
    const known = chatData?.interjectDice;
    if (known && known.transactionId === marker.transactionId && known.dice) {
        return { dice: known.dice, interjectDice: known };
    }
    const tail = chatData?.tailDice;
    if (tail && tail.index === base - 2 && tail.swipeId === swipeOf(cut) && tail.dice) {
        return { dice: tail.dice, interjectDice: { transactionId: marker.transactionId, index: base - 2, dice: tail.dice } };
    }
    return null;
}
