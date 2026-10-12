import { test } from "node:test";
import assert from "node:assert/strict";
import { parseThemeColors } from "../lib/theme.mjs";

test("reads green and red", () => {
  assert.deepEqual(parseThemeColors('red = "#ea6962"\ngreen = "#a9b665"\n'), { up: "#a9b665", down: "#ea6962" });
});

test("a missing key is null", () => {
  assert.deepEqual(parseThemeColors('green = "#a9b665"\n'), { up: "#a9b665", down: null });
  assert.deepEqual(parseThemeColors('red = "#ea6962"\n'), { up: null, down: "#ea6962" });
  assert.deepEqual(parseThemeColors(""), { up: null, down: null });
});

test("malformed values and lines are ignored", () => {
  assert.deepEqual(parseThemeColors('green = "#a9b66"\nred = "ea6962"\n'), { up: null, down: null });
  assert.deepEqual(parseThemeColors('green = "#a9b665\nred ==="#ea6962"'), { up: null, down: null });
  assert.deepEqual(parseThemeColors("bright_green = \"#a9b665\"\nlight_red = \"#ea6962\""), { up: null, down: null });
  assert.deepEqual(parseThemeColors(undefined), { up: null, down: null });
  assert.deepEqual(parseThemeColors(null), { up: null, down: null });
});

test("accepts single quotes, no quotes, spacing and trailing comments; last line wins", () => {
  assert.deepEqual(parseThemeColors("green='#111111'\n  red = #222222  # note\ngreen = \"#333333\""), { up: "#333333", down: "#222222" });
  assert.deepEqual(parseThemeColors('red = "#ea6962"\r\ngreen = "#a9b665"\r\n'), { up: "#a9b665", down: "#ea6962" });
});

test("a seven-digit hex is not a colour", () => {
  assert.deepEqual(parseThemeColors('green = "#a9b6655"'), { up: null, down: null });
});
