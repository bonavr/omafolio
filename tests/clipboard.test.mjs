import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// No Qt text input may come back: an editable TextInput reads the whole
// clipboard every time it changes, so another program could stall the shell
// through it (KeyField.qml). The shell's TextField, NumberField,
// SearchableDropdown and MultiSelect are built on one. Nor may the plugin
// read the clipboard itself.

const root = join(import.meta.dirname, "..");
const INPUTS = ["TextInput", "TextEdit", "TextField", "TextArea", "SpinBox", "ComboBox", "NumberField",
  "SearchableDropdown", "MultiSelect"];
// An element (`TextField {`, `QQC.TextField {`) or an inline component built on one.
const ELEMENT = new RegExp(`(?:^|[\\s.:])(?:${INPUTS.join("|")})\\s*\\{`);
const CLIPBOARD = /\bclipboard|\bpaste\b|canPaste|wl-paste|wl-copy|xclip|xsel/i;

/** The files the shell runs: QML and JS, outside node_modules and the dev-only tests and scripts. */
function sources() {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || ["node_modules", "tests", "scripts"].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(qml|mjs|js)$/.test(entry.name)) out.push(path);
    }
  };
  walk(root);
  return out;
}

// Comments name the inputs to say why they are absent; only code counts.
/** @param {string} text */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** @param {RegExp} pattern */
function offenders(pattern) {
  return sources().flatMap((path) => code(readFileSync(path, "utf8")).split("\n")
    .filter((line) => pattern.test(line))
    .map((line) => `${path.slice(root.length + 1)}: ${line.trim()}`));
}

test("the plugin finds its own sources to check", () => {
  const names = sources().map((path) => path.slice(root.length + 1));
  for (const name of ["SettingsPage.qml", "KeyField.qml", "Panel.qml", "lib/keyfield.mjs"]) assert.ok(names.includes(name), name);
});

test("no Qt text input appears anywhere in the plugin", () => {
  assert.deepEqual(offenders(ELEMENT), []);
});

test("nothing in the plugin reads or writes the clipboard", () => {
  assert.deepEqual(offenders(CLIPBOARD), []);
});

test("the checks recognise what they forbid", () => {
  for (const line of ["TextField {", "  QQC.TextField {", "component AmountField: TextField {", "NumberField{",
    "contentItem: TextInput {"]) assert.ok(ELEMENT.test(code(line)), line);
  for (const line of ["KeyField {", "Text {", "horizontalAlignment: Text.AlignRight", "// TextField {"])
    assert.ok(!ELEMENT.test(code(line)), line);
  for (const line of ["Quickshell.clipboardText", "Clipboard.text", "input.paste()", "wl-paste -n"])
    assert.ok(CLIPBOARD.test(code(line)), line);
});
