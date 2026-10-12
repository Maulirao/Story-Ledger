// LocalChar speaks in its own message shape; the shared core speaks SillyTavern's. This is the
// one place the two meet.

/**
 * LocalChar history [{ id, variant_id, role, name, content, is_system }] -> the SillyTavern-shaped
 * chat the core reads [{ mes, is_user, is_system, name, swipe_id }]. Order and length are kept, so
 * an index in one is the same message in the other.
 */
export function toStChat(history, { userName = "", charName = "" } = {}) {
    return (history || []).map(m => {
        const isUser = m.role === "user";
        const isSystem = Boolean(m.is_system) || m.role === "system";
        return {
            mes: typeof m.content === "string" ? m.content : "",
            is_user: isUser,
            is_system: isSystem,
            name: m.name || (isUser ? userName : isSystem ? "" : charName),
            swipe_id: 0,
        };
    });
}

/**
 * Where a rule proposal came from. ST used `m${index}s${swipe}`; LocalChar has no swipes inside a
 * message, and a version id changes on every edit (and does not exist yet when a reply is
 * finalized), so the message id alone is the stable key.
 */
export const proposalSource = message => String(message.id);
