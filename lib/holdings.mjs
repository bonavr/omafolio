// The holdings file: parsing, validation, serialisation and edits.
//
// A holding's identity is (asset, costCurrency); costCurrency undefined means
// "the asset's listing currency". `cost` is the average cost per unit.
// Pure ES module: runs in Node and in QML's JS engine.

/** @typedef {import("./types.mjs").Holding} Holding */

/**
 * Extracts a 1-based line number from a JSON.parse error message. Uses
 * "line N" when the engine reports it, else counts newlines before
 * "position N" in `text`, else null. Engine wording varies, so this only
 * looks for those two phrases.
 * @param {string} message
 * @param {string} text the text that failed to parse
 * @returns {number|null}
 */
export function jsonErrorLine(message, text) {
  const line = /line (\d+)/i.exec(message);
  if (line) return Number(line[1]);
  const pos = /position (\d+)/i.exec(message);
  if (pos) {
    let count = 1;
    const end = Math.min(Number(pos[1]), text.length);
    for (let i = 0; i < end; i++) if (text[i] === "\n") count++;
    return count;
  }
  return null;
}

/** @param {unknown} v @returns {v is string} */
function isNonEmptyString(v) { return typeof v === "string" && v.length > 0; }
/** @param {unknown} v @returns {v is number} */
function isNonNegativeNumber(v) { return typeof v === "number" && Number.isFinite(v) && v >= 0; }

/**
 * Returns a validated Holding, or a string describing what is wrong.
 * @param {any} raw
 * @returns {Holding|string}
 */
function validateEntry(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return "is not an object";
  if (!isNonEmptyString(raw.asset)) return "needs an asset (non-empty text)";
  if (!isNonNegativeNumber(raw.quantity)) return "needs a quantity that is a number, 0 or more";
  if (!isNonNegativeNumber(raw.cost)) return "needs a cost that is a number, 0 or more";
  /** @type {Holding} */
  const holding = { asset: raw.asset, quantity: raw.quantity, cost: raw.cost };
  if (raw.costCurrency !== undefined) {
    if (!isNonEmptyString(raw.costCurrency)) return "has a costCurrency that is not non-empty text";
    holding.costCurrency = raw.costCurrency.toUpperCase();
  }
  return holding;
}

/** @type {(h: Holding, asset: string, costCurrency?: string) => boolean} */
const sameIdentity = (h, asset, costCurrency) => h.asset === asset && h.costCurrency === costCurrency;

/**
 * Merges entries of equal identity: quantities add, cost is quantity-weighted.
 * @param {Holding[]} holdings
 * @returns {Holding[]}
 */
function mergeDuplicates(holdings) {
  /** @type {Holding[]} */
  const out = [];
  for (const h of holdings) {
    const i = out.findIndex((o) => sameIdentity(o, h.asset, h.costCurrency));
    if (i < 0) { out.push({ ...h }); continue; }
    const prev = out[i];
    const quantity = prev.quantity + h.quantity;
    // With no units there is no weighting; keep the first cost.
    const cost = quantity > 0 ? (prev.quantity * prev.cost + h.quantity * h.cost) / quantity : prev.cost;
    out[i] = { ...prev, quantity, cost };
  }
  return out;
}

/**
 * Parses the holdings file. Null or blank text is an empty portfolio. Any
 * invalid entry fails the whole parse (naming the entry) rather than being
 * dropped. `line` is set only for JSON syntax errors, when it can be found.
 * @param {string|null} text
 * @returns {{ok: true, holdings: Holding[]} | {ok: false, error: string, line: number|null}}
 */
export function parseHoldings(text) {
  if (text === null || text.trim() === "") return { ok: true, holdings: [] };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Not valid JSON: ${message}`, line: jsonErrorLine(message, text) };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.holdings)) {
    return { ok: false, error: 'Expected an object with a "holdings" list.', line: null };
  }
  /** @type {Holding[]} */
  const valid = [];
  for (let i = 0; i < data.holdings.length; i++) {
    const result = validateEntry(data.holdings[i]);
    if (typeof result === "string") return { ok: false, error: `Holding entry ${i + 1} ${result}.`, line: null };
    valid.push(result);
  }
  return { ok: true, holdings: mergeDuplicates(valid) };
}

/**
 * Serialises to the documented layout: one holding per line, costCurrency only
 * when set, trailing newline.
 * @param {Holding[]} holdings
 * @returns {string}
 */
export function serializeHoldings(holdings) {
  const lines = holdings.map((h) => {
    let line = `  { "asset": ${JSON.stringify(h.asset)}, "quantity": ${JSON.stringify(h.quantity)}, "cost": ${JSON.stringify(h.cost)}`;
    if (h.costCurrency !== undefined) line += `, "costCurrency": ${JSON.stringify(h.costCurrency)}`;
    return line + " }";
  });
  return ['{ "holdings": [', ...lines.map((l, i) => (i < lines.length - 1 ? l + "," : l)), "]}", ""].join("\n");
}

/**
 * Returns a copy of `holdings` with the entry of the same (asset, costCurrency)
 * replaced by `holding`, or `holding` appended when there is none.
 * @param {Holding[]} holdings
 * @param {Holding} holding
 * @returns {Holding[]}
 */
export function withHolding(holdings, holding) {
  const i = holdings.findIndex((h) => sameIdentity(h, holding.asset, holding.costCurrency));
  if (i < 0) return [...holdings, holding];
  return holdings.map((h, j) => (j === i ? holding : h));
}

/**
 * Returns a copy of `holdings` without the entry of that (asset, costCurrency).
 * @param {Holding[]} holdings
 * @param {string} asset
 * @param {string} [costCurrency] undefined selects the entry with no costCurrency
 * @returns {Holding[]}
 */
export function withoutHolding(holdings, asset, costCurrency) {
  return holdings.filter((h) => !sameIdentity(h, asset, costCurrency));
}

/**
 * The cost currency to suggest for a new holding: crypto is priced in the base
 * currency; anything else undefined, meaning its listing currency.
 * @param {string} asset
 * @param {string} baseCurrency
 * @returns {string|undefined}
 */
export function defaultCostCurrency(asset, baseCurrency) {
  return asset.startsWith("crypto:") ? baseCurrency : undefined;
}
