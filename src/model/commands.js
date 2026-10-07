// ──────────────────────────────────────────────────────────────────────────────
// Commands: each grammar's public forms, one command per template line. A command is
// { id, form, example, keywords, freeText? }; `form` and `example` may take the
// section context (the Check form differs by check style). Test fixtures live in
// tests/support, never here. Pure.
// ──────────────────────────────────────────────────────────────────────────────

import { foldQuotes } from "./normalize.js";

/** A command's form under `ctx`. */
export const formOf = (command, ctx) => (typeof command.form === "function" ? command.form(ctx) : command.form);

/** True for an unchanged placeholder form, rather than a completed command. */
export function isCommandPlaceholder(line, commands) {
    // Compare syntax only; the actual command and its values remain untouched.
    const key = s => foldQuotes(s).replace(/\s+/g, " ")
        .replace(/\s*(?:<->|->|=>|[→↔⟶➔➜⇔])\s*/g, "→")
        .replace(/\s*:\s*/g, ":").trim().toLowerCase();
    const value = key(line);
    return commands.some(c => ["dnd", "arrow"].some(checkStyle => value === key(formOf(c, { checkStyle }))));
}

/** A template block: the heading, then one command per line without echo-rejection wrappers. */
export function commandTemplate(heading, commands, ctx) {
    return [`${heading}:`, ...commands.map(c => `- ${formOf(c, ctx)}`)];
}
