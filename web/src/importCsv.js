/**
 * Read a BoardGameGeek collection export.
 *
 * Keyed on `objectid` only. Names are not unique, get re-spelled between
 * editions, and carry punctuation that survives export badly — the id is
 * authoritative and free of all of it.
 *
 * The unmatched rows are classified rather than counted, because a working
 * import produces plenty of them. Expansions are excluded from the corpus by
 * construction: BGG ranks them in a separate subtype, so none of the 39,585 in
 * the ranks dump carries a main-list rank and none can ever match. "47
 * unmatched" reads as a broken import; "31 expansions, 16 outside the top
 * 5,000" reads as a working one.
 */

/** Minimal RFC-4180 parse: quoted fields, doubled quotes, embedded newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v !== ''));
}

const NUMBER = /^\d+$/;

export function parseCollectionCsv(text, ix) {
  const rows = parseCsv(text);
  if (!rows.length) return { rows: 0, matched: [], unmatched: [], expansions: 0 };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const at = (...names) => {
    for (const name of names) {
      const i = header.indexOf(name);
      if (i >= 0) return i;
    }
    return -1;
  };
  const idAt = at('objectid', 'objectid ', 'id');
  const nameAt = at('objectname', 'name', 'title');
  // Column names vary between BGG's export and third-party tools, so every
  // status field is optional and absence means "counts as owned".
  const ownAt = at('own', 'owned');
  const typeAt = at('itemtype', 'objecttype', 'type', 'subtype');

  const matched = [], unmatched = [];
  let expansions = 0, considered = 0;

  for (const row of rows.slice(1)) {
    if (idAt < 0 || !NUMBER.test((row[idAt] ?? '').trim())) continue;
    if (ownAt >= 0 && !['1', 'true', 'yes'].includes((row[ownAt] ?? '').trim().toLowerCase())) {
      continue;                       // wishlisted or previously owned, not held
    }
    considered++;
    const id = Number(row[idAt].trim());
    const name = (nameAt >= 0 ? row[nameAt] : `#${id}`).trim();
    if (ix.rowOf.has(id)) { matched.push(id); continue; }
    if (typeAt >= 0 && /expansion/i.test(row[typeAt] ?? '')) { expansions++; continue; }
    unmatched.push({ id, name });
  }
  return { rows: considered, matched: [...new Set(matched)], unmatched, expansions };
}
