// Reads the semantic colours the shell's own Color singleton lacks from a
// theme's colors.toml. Pure: ThemeColors.qml supplies the file text.

const HEX = /^\s*(green|red)\s*=\s*(?:"(#[0-9A-Fa-f]{6})"|'(#[0-9A-Fa-f]{6})'|(#[0-9A-Fa-f]{6}))\s*(?:#.*)?$/;

/**
 * The theme's green and red as "#rrggbb" strings. A key that is absent, not a
 * six-digit hex colour, or on a malformed line is null, so the caller can fall
 * back to its own colour. The last valid line for a key wins.
 * @param {string} text Contents of colors.toml; anything else reads as empty.
 * @returns {{up: string|null, down: string|null}}
 */
export function parseThemeColors(text) {
  /** @type {{up: string|null, down: string|null}} */
  const out = { up: null, down: null };
  const lines = typeof text === "string" ? text.split("\n") : [];
  for (const line of lines) {
    const m = HEX.exec(line);
    if (!m) continue;
    const hex = m[2] || m[3] || m[4];
    if (m[1] === "green") out.up = hex;
    else out.down = hex;
  }
  return out;
}
