// One line of text being typed into KeyField.qml, and what a key press does to
// it. KeyField exists because Qt's editable TextInput reads the whole
// clipboard every time the clipboard changes, with no size limit or deadline,
// so another program could stall the shell through any open text field. This
// editor offers no paste and holds no clipboard code: a line changes only by
// the keys handled here.
//
// Positions count UTF-16 code units, as QML strings do; the cursor never stops
// inside a surrogate pair.

/**
 * The text, where the cursor is (0 to text.length), and whether all of the
 * text is selected. Selecting everything is the only selection there is: the
 * next typed character or deletion replaces it.
 * @typedef {{ text: string, cursor: number, all: boolean }} Line
 */

/** The Qt key and modifier values press() understands (Qt::Key, Qt::KeyboardModifier). */
export const KEY = Object.freeze({
  Backspace: 0x01000003,
  Delete: 0x01000007,
  Home: 0x01000010,
  End: 0x01000011,
  Left: 0x01000012,
  Right: 0x01000014,
  A: 0x41,
});
export const MOD = Object.freeze({
  Shift: 0x02000000,
  Control: 0x04000000,
  Alt: 0x08000000,
  Meta: 0x10000000,
});

/**
 * A line showing `text` with the cursor at its end and nothing selected.
 * @param {string} text
 * @returns {Line}
 */
export function lineOf(text) {
  return { text, cursor: text.length, all: false };
}

/**
 * What one key press does to `line`, or null when the key is not one this
 * editor handles (Enter, Esc, Tab, Up, Down, function keys, shortcuts), so the
 * caller passes it on. The line itself is never changed.
 *
 * - A typed character goes in at the cursor, replacing the text when all of it
 *   is selected. With `allowed`, a character it does not match is swallowed:
 *   handled, and the line is unchanged.
 * - Backspace and Delete remove the character before or after the cursor, or
 *   everything when all is selected; Ctrl+Backspace removes the word before.
 * - Left, Right, Home and End move the cursor; with everything selected, Left
 *   and Right drop the selection at the start or end.
 * - Ctrl+A selects everything.
 *
 * @param {Line} line
 * @param {number} key Qt key code
 * @param {string} text the text the key produced ("" for none)
 * @param {number} modifiers Qt modifier flags
 * @param {RegExp | null} [allowed] matches each character that may be typed
 * @returns {Line | null}
 */
export function press(line, key, text, modifiers, allowed = null) {
  const ctrl = (modifiers & MOD.Control) !== 0;
  const { text: s, all } = line;
  const at = Math.max(0, Math.min(s.length, line.cursor));

  if (ctrl && key === KEY.A) return { text: s, cursor: s.length, all: s !== "" };

  switch (key) {
    case KEY.Backspace:
      if (all) return lineOf("");
      if (ctrl) {
        const from = wordStart(s, at);
        return { text: s.slice(0, from) + s.slice(at), cursor: from, all: false };
      }
      return { text: s.slice(0, at - step(s, at, -1)) + s.slice(at), cursor: at - step(s, at, -1), all: false };
    case KEY.Delete:
      if (all) return lineOf("");
      return { text: s.slice(0, at) + s.slice(at + step(s, at, 1)), cursor: at, all: false };
    case KEY.Left:
      return { text: s, cursor: all ? 0 : at - step(s, at, -1), all: false };
    case KEY.Right:
      return { text: s, cursor: all ? s.length : at + step(s, at, 1), all: false };
    case KEY.Home:
      return { text: s, cursor: 0, all: false };
    case KEY.End:
      return { text: s, cursor: s.length, all: false };
  }

  // Shortcuts (Ctrl+V among them) are not typing.
  if (ctrl || (modifiers & (MOD.Alt | MOD.Meta)) !== 0 || !printable(text)) return null;
  if (allowed && !Array.from(text).every((c) => allowed.test(c))) return line;
  if (all) return lineOf(text);
  return { text: s.slice(0, at) + text + s.slice(at), cursor: at + text.length, all: false };
}

/**
 * Where the cursor goes for a click `x` pixels from the start of the text,
 * given each position's offset: `offsets[i]` is the width of the first i code
 * units, so offsets.length is text.length + 1. The nearest position wins,
 * never one inside a surrogate pair.
 * @param {string} text
 * @param {number[]} offsets
 * @param {number} x
 * @returns {number}
 */
export function positionAt(text, offsets, x) {
  let best = 0;
  for (let i = 1; i <= text.length; i++) {
    if (insidePair(text, i)) continue;
    if (Math.abs(offsets[i] - x) < Math.abs(offsets[best] - x)) best = i;
  }
  return best;
}

// Text that a key press types: something, with no control characters.
/** @param {string} text */
function printable(text) {
  if (text === "") return false;
  for (const c of text) {
    const code = c.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return false;
  }
  return true;
}

// Whether position `at` falls between the two halves of a surrogate pair.
/**
 * @param {string} s
 * @param {number} at
 */
function insidePair(s, at) {
  const before = s.charCodeAt(at - 1);
  const after = s.charCodeAt(at);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

// How many code units one character takes going `dir` (1 or -1) from `at`:
// 2 across a surrogate pair, 1 otherwise, 0 at that end of the text.
/**
 * @param {string} s
 * @param {number} at
 * @param {1 | -1} dir
 */
function step(s, at, dir) {
  if (dir < 0) return at === 0 ? 0 : insidePair(s, at - 1) ? 2 : 1;
  return at >= s.length ? 0 : insidePair(s, at + 1) ? 2 : 1;
}

// Where Ctrl+Backspace stops: back over any spaces, then over the word.
/**
 * @param {string} s
 * @param {number} at
 */
function wordStart(s, at) {
  let i = at;
  while (i > 0 && /\s/.test(s[i - 1])) i--;
  while (i > 0 && !/\s/.test(s[i - 1])) i--;
  return i;
}
