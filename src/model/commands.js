// ──────────────────────────────────────────────────────────────────────────────
// Commands: each grammar's public forms, one command per template line. A command is
// { id, form, example, keywords, freeText? }; `form` and `example` may take the
// section context (the Check form differs by check style). Test fixtures live in
// tests/support, never here. Pure.
// ──────────────────────────────────────────────────────────────────────────────

/** A command's form under `ctx`. */
export const formOf = (command, ctx) => (typeof command.form === "function" ? command.form(ctx) : command.form);

/** A template block: the heading, then one `- [form]` line per command. */
export function commandTemplate(heading, commands, ctx) {
    return [`${heading}:`, ...commands.map(c => `- [${formOf(c, ctx)}]`)];
}
