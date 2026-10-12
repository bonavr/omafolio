import { test } from "node:test";
import assert from "node:assert/strict";
import { KEY, MOD, lineOf, press, positionAt } from "../lib/keyfield.mjs";

const NONE = 0;
/** @param {string} text @param {number} cursor @param {boolean} [all] */
const at = (text, cursor, all = false) => ({ text, cursor, all });
/** @param {import("../lib/keyfield.mjs").Line} line @param {string} c */
const type = (line, c) => press(line, 0x20, c, NONE);

test("lineOf puts the cursor at the end with nothing selected", () => {
  assert.deepEqual(lineOf("VOO"), at("VOO", 3));
  assert.deepEqual(lineOf(""), at("", 0));
});

test("typing inserts at the cursor, at either end or in the middle", () => {
  assert.deepEqual(type(at("VO", 2), "O"), at("VOO", 3));
  assert.deepEqual(type(at("OO", 0), "V"), at("VOO", 1));
  assert.deepEqual(type(at("12", 1), "5"), at("152", 2));
  assert.deepEqual(type(at("", 0), "é"), at("é", 1));
});

test("typing with everything selected replaces it", () => {
  assert.deepEqual(type(at("410.25", 6, true), "4"), at("4", 1));
});

test("a character outside `allowed` is swallowed, not passed on", () => {
  const digits = /[0-9,]/;
  assert.deepEqual(press(at("60", 2), 0x41, "a", NONE, digits), at("60", 2));
  assert.deepEqual(press(at("60", 2, true), 0x41, "a", NONE, digits), at("60", 2, true));
  assert.deepEqual(press(at("60", 2), 0x30, "0", NONE, digits), at("600", 3));
  assert.deepEqual(press(at("6", 1), 0x31, "1x", NONE, digits), at("6", 1));
});

test("Backspace removes the character before the cursor, or all when selected", () => {
  assert.deepEqual(press(at("VOO", 3), KEY.Backspace, "", NONE), at("VO", 2));
  assert.deepEqual(press(at("VOO", 1), KEY.Backspace, "", NONE), at("OO", 0));
  assert.deepEqual(press(at("VOO", 0), KEY.Backspace, "", NONE), at("VOO", 0));
  assert.deepEqual(press(at("VOO", 2, true), KEY.Backspace, "", NONE), at("", 0));
});

test("Delete removes the character after the cursor, or all when selected", () => {
  assert.deepEqual(press(at("VOO", 0), KEY.Delete, "", NONE), at("OO", 0));
  assert.deepEqual(press(at("VOO", 2), KEY.Delete, "", NONE), at("VO", 2));
  assert.deepEqual(press(at("VOO", 3), KEY.Delete, "", NONE), at("VOO", 3));
  assert.deepEqual(press(at("VOO", 0, true), KEY.Delete, "", NONE), at("", 0));
});

test("Ctrl+Backspace removes the word before the cursor, and any spaces after that word", () => {
  assert.deepEqual(press(at("apple inc", 9), KEY.Backspace, "", MOD.Control), at("apple ", 6));
  assert.deepEqual(press(at("apple  ", 7), KEY.Backspace, "", MOD.Control), at("", 0));
  assert.deepEqual(press(at("apple inc", 3), KEY.Backspace, "", MOD.Control), at("le inc", 0));
});

test("Left, Right, Home and End move the cursor and stop at the ends", () => {
  assert.deepEqual(press(at("VOO", 2), KEY.Left, "", NONE), at("VOO", 1));
  assert.deepEqual(press(at("VOO", 0), KEY.Left, "", NONE), at("VOO", 0));
  assert.deepEqual(press(at("VOO", 1), KEY.Right, "", NONE), at("VOO", 2));
  assert.deepEqual(press(at("VOO", 3), KEY.Right, "", NONE), at("VOO", 3));
  assert.deepEqual(press(at("VOO", 2), KEY.Home, "", NONE), at("VOO", 0));
  assert.deepEqual(press(at("VOO", 1), KEY.End, "", NONE), at("VOO", 3));
});

test("with everything selected, Left and Right drop the selection at that end", () => {
  assert.deepEqual(press(at("VOO", 3, true), KEY.Left, "", NONE), at("VOO", 0));
  assert.deepEqual(press(at("VOO", 0, true), KEY.Right, "", NONE), at("VOO", 3));
  assert.deepEqual(press(at("VOO", 3, true), KEY.Home, "", NONE), at("VOO", 0));
});

test("Ctrl+A selects everything, and nothing when the line is empty", () => {
  assert.deepEqual(press(at("VOO", 1), KEY.A, "a", MOD.Control), at("VOO", 3, true));
  assert.deepEqual(press(at("", 0), KEY.A, "a", MOD.Control), at("", 0));
});

test("a plain A is typed, not select-all", () => {
  assert.deepEqual(press(at("", 0), KEY.A, "a", NONE), at("a", 1));
  assert.deepEqual(press(at("", 0), KEY.A, "A", MOD.Shift), at("A", 1));
});

test("keys the editor does not own are passed on", () => {
  const line = at("VOO", 1);
  // Ctrl+V, Shift+Insert's text-less press, Alt and Super combinations, Enter, Esc, Tab, Up, Down.
  assert.equal(press(line, 0x56, "\u0016", MOD.Control), null);
  assert.equal(press(line, 0x56, "v", MOD.Control), null);
  assert.equal(press(line, 0x01000006, "", MOD.Shift), null);
  assert.equal(press(line, 0x56, "v", MOD.Alt), null);
  assert.equal(press(line, 0x56, "v", MOD.Meta), null);
  assert.equal(press(line, 0x01000004, "\r", NONE), null);
  assert.equal(press(line, 0x01000000, "\u001b", NONE), null);
  assert.equal(press(line, 0x01000001, "\t", NONE), null);
  assert.equal(press(line, 0x01000013, "", NONE), null);
  assert.equal(press(line, 0x01000015, "", NONE), null);
  assert.equal(press(line, 0x7f, "\u007f", NONE), null);
});

test("the line passed in is never changed", () => {
  const line = at("VOO", 1, true);
  press(line, KEY.Backspace, "", NONE);
  type(line, "x");
  assert.deepEqual(line, at("VOO", 1, true));
});

test("an out-of-range cursor is clamped before an edit", () => {
  assert.deepEqual(type(at("VO", 9), "O"), at("VOO", 3));
  assert.deepEqual(press(at("VO", -4), KEY.Delete, "", NONE), at("O", 0));
});

test("the cursor steps over a surrogate pair as one character", () => {
  const s = "a\u{1F600}b"; // a, an emoji (two code units), b
  assert.deepEqual(press(at(s, 3), KEY.Left, "", NONE), at(s, 1));
  assert.deepEqual(press(at(s, 1), KEY.Right, "", NONE), at(s, 3));
  assert.deepEqual(press(at(s, 3), KEY.Backspace, "", NONE), at("ab", 1));
  assert.deepEqual(press(at(s, 1), KEY.Delete, "", NONE), at("ab", 1));
  // Lone halves are single characters.
  assert.deepEqual(press(at("a\uDE00", 2), KEY.Left, "", NONE), at("a\uDE00", 1));
  assert.deepEqual(press(at("\uD83Db", 0), KEY.Right, "", NONE), at("\uD83Db", 1));
});

test("positionAt picks the nearest position and never one inside a pair", () => {
  const offsets = [0, 10, 20, 30];
  assert.equal(positionAt("abc", offsets, -5), 0);
  assert.equal(positionAt("abc", offsets, 4), 0);
  assert.equal(positionAt("abc", offsets, 6), 1);
  assert.equal(positionAt("abc", offsets, 26), 3);
  assert.equal(positionAt("abc", offsets, 99), 3);
  const s = "a\u{1F600}b";
  assert.equal(positionAt(s, [0, 10, 15, 30, 40], 16), 1);
  assert.equal(positionAt(s, [0, 10, 15, 30, 40], 24), 3);
});
