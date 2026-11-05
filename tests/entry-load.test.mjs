// SillyTavern loads index.js as the first module of the extension. Each case runs in a fresh
// node process, so no other test has loaded the model first. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const STUBS = `
globalThis.SillyTavern = { getContext: () => ({}) };
globalThis.document = { querySelectorAll: () => [], querySelector: () => null };
globalThis.$ = () => ({ length: 1, on() {}, append() {} });
globalThis.jQuery = () => {};
`;

const loadFirst = file => spawnSync(process.execPath, ["--input-type=module", "-e",
    `${STUBS}\nawait import(${JSON.stringify(new URL(file, import.meta.url).href)});\nconsole.log("loaded");`], { encoding: "utf8" });

for (const file of ["../index.js", "../src/model/sections/quests.js", "../src/model/sections/chekhov.js", "../src/model/sections/fate.js", "../src/model/sections/inventory.js"]) {
    test(`${file.replace("../", "")} loads as the first module`, () => {
        const r = loadFirst(file);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /loaded/);
    });
}
