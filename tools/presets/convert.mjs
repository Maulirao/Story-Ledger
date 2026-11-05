// ──────────────────────────────────────────────────────────────────────────────
// Preset converter: makes a "+ Story Ledger" copy of a SillyTavern chat-completion
// preset from a recipe — prompts to add, prompts to switch off and exact text edits. Dry run by
// default (prints what would change); --write writes the copy, never over an
// existing file unless --replace is given. Any name or text the recipe expects but
// the preset lacks aborts the whole preset: nothing is written.
//
//   node tools/presets/convert.mjs tools/presets/recipes/<name>.json [--write] [--replace] [--dir <presets dir>]
// ──────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_DIR = "C:\\dev\\lonelynoy\\presets";

const LINGERING = /<internal_states>|<ledger>/i;

const findPrompt = (preset, key) => (preset.prompts || []).find(p => p.name === key || p.identifier === key || (p.name || "").trim() === String(key).trim());

/**
 * Apply `recipe` ({ add: [{ after, enabled, prompt }], off: string[], regexOff: string[], edits: [{ prompt, find, replace }] }) to a preset object.
 * `regexOff` names regex scripts (by name, trimmed) in extensions.regex_scripts to disable.
 * Returns { preset, report: { added: [{ name, after, enabled }], off: [{ name, identifier, was }], regexOff: [{ name, was }], edits: [{ prompt, find, replace }], missing: string[] } };
 * when `missing` is non-empty the returned preset is the untouched input.
 */
export function applyRecipe(input, recipe) {
    const preset = JSON.parse(JSON.stringify(input));
    const report = { added: [], off: [], regexOff: [], edits: [], missing: [], warnings: [] };
    // a new prompt goes in right after its anchor, in the prompt list and in every order that holds the anchor
    for (const { after, enabled, prompt } of recipe.add || []) {
        if (findPrompt(preset, prompt.identifier) || findPrompt(preset, prompt.name)) { report.missing.push(`prompt exists: ${prompt.name}`); continue; }
        const anchor = findPrompt(preset, after);
        if (!anchor) { report.missing.push(`prompt: ${after}`); continue; }
        preset.prompts.splice(preset.prompts.indexOf(anchor) + 1, 0, JSON.parse(JSON.stringify(prompt)));
        for (const o of preset.prompt_order || []) {
            const at = (o.order || []).findIndex(e => e.identifier === anchor.identifier);
            if (at >= 0) o.order.splice(at + 1, 0, { identifier: prompt.identifier, enabled: !!enabled });
        }
        report.added.push({ name: prompt.name, after: anchor.name, enabled: !!enabled });
    }
    for (const key of recipe.off || []) {
        const p = findPrompt(preset, key);
        if (!p) { report.missing.push(`prompt: ${key}`); continue; }
        const entries = (preset.prompt_order || []).flatMap(o => o.order || []).filter(e => e.identifier === p.identifier);
        report.off.push({ name: p.name, identifier: p.identifier, was: entries.map(e => e.enabled) });
        for (const e of entries) e.enabled = false;
    }
    const scripts = preset.extensions?.regex_scripts || [];
    for (const name of recipe.regexOff || []) {
        const hits = scripts.filter(sc => String(sc.scriptName || "").trim() === String(name).trim());
        if (!hits.length) { report.missing.push(`regex: ${name}`); continue; }
        for (const sc of hits) { report.regexOff.push({ name: String(name).trim(), was: Boolean(sc.disabled) }); sc.disabled = true; }
    }
    for (const edit of recipe.edits || []) {
        const p = findPrompt(preset, edit.prompt);
        if (!p) { report.missing.push(`prompt: ${edit.prompt}`); continue; }
        const content = String(p.content || "");
        const at = content.indexOf(edit.find);
        if (at < 0) { report.missing.push(`${edit.prompt}: "${edit.find}"`); continue; }
        p.content = content.slice(0, at) + edit.replace + content.slice(at + edit.find.length);
        report.edits.push({ prompt: p.name, find: edit.find, replace: edit.replace });
    }
    // a prompt still switched on that orders the old state block would fight the extension
    const on = new Set((preset.prompt_order || []).flatMap(o => o.order || []).filter(e => e.enabled).map(e => e.identifier));
    for (const pr of preset.prompts || []) {
        if (!on.has(pr.identifier)) continue;
        const text = String(pr.content || "").replace(/\{\{\/\/[\s\S]*?\}\}/g, "");   // {{// comments}} never reach the model
        if (LINGERING.test(text)) report.warnings.push(pr.name);
    }
    return report.missing.length ? { preset: input, report } : { preset, report };
}

const short = (s, n = 160) => { const t = String(s).replace(/\s+/g, " "); return t.length > n ? `${t.slice(0, n)}…` : t; };

export function formatReport(recipe, report, target, exists) {
    const out = [`Recipe: ${recipe.source}  →  ${target}${exists ? "  (EXISTS — needs --replace)" : ""}`, ""];
    if (report.added.length) out.push("Added:", ...report.added.map(a => `  - ${a.name.trim()}  (after ${a.after.trim()}, ${a.enabled ? "on" : "off"})`), "");
    out.push("Switched off:");
    for (const o of report.off) out.push(`  - ${o.name.trim()}  (${o.was.map(w => (w ? "on" : "off")).join("/") || "not in any order"} → off)`);
    if (report.regexOff && report.regexOff.length) out.push("", "Regex off:", ...report.regexOff.map(r => `  - ${r.name}  (${r.was ? "already off" : "on → off"})`));
    out.push("", "Text edits:");
    for (const e of report.edits) out.push(`  - ${e.prompt.trim()}`, `      before: ${short(e.find)}`, `      after:  ${short(e.replace)}`);
    if (report.warnings && report.warnings.length) out.push("", "WARNING — still on and still mention <internal_states> or <ledger>:", ...report.warnings.map(w => `  - ${w.trim()}`));
    if (report.missing.length) out.push("", "MISSING — nothing will be written:", ...report.missing.map(m => `  - ${m}`));
    return out.join("\n");
}

function main(argv) {
    const args = argv.slice(2);
    const recipePath = args.find(a => !a.startsWith("--"));
    const dirIx = args.indexOf("--dir");
    const dir = dirIx >= 0 ? args[dirIx + 1] : DEFAULT_DIR;
    if (!recipePath) { console.error("usage: convert.mjs <recipe.json> [--write] [--replace] [--dir <dir>]"); return 2; }
    const recipe = JSON.parse(fs.readFileSync(recipePath, "utf8"));
    const source = path.join(dir, recipe.source), target = path.join(dir, recipe.target);
    const preset = JSON.parse(fs.readFileSync(source, "utf8"));
    const { preset: out, report } = applyRecipe(preset, recipe);
    const exists = fs.existsSync(target);
    console.log(formatReport(recipe, report, recipe.target, exists));
    if (report.missing.length) return 1;
    if (!args.includes("--write")) { console.log("\nDry run — nothing written. Add --write to write the copy."); return 0; }
    if (exists && !args.includes("--replace")) { console.error(`\n${recipe.target} exists — add --replace to overwrite it.`); return 1; }
    const indent = /^\{\r?\n( +)/.exec(fs.readFileSync(source, "utf8"));
    fs.writeFileSync(target, JSON.stringify(out, null, indent ? indent[1].length : 4), "utf8");
    console.log(`\nWrote ${target}`);
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv);
