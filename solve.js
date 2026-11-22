// A fast, dependency-free reader with the same answers as csv-reader 1.0.0 on every input.
//
// run({text, header}) returns {columns, rows, errors}:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF; a line with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr); it does not count as a line break;
//   - a quoted field runs to the next quote that is not doubled; "" is one quote; each CRLF or lone CR inside it
//     reads as LF; the text after its closing quote, up to the next comma or line break, is appended as it stands
//     (quote_junk, when at least one character is appended);
//   - a quote that never closes is a literal character and the text after it is read again as unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields are never trimmed or converted;
//   - columns is the first record when header is true (else null); rows holds the other records, each padded with ""
//     (short_row) or cut (long_row) to the first record's width;
//   - errors are {code, line, row} in the order met; line is the 1-based line the record starts on, counting every LF,
//     CRLF and lone CR inside quotes; row is the record's index in rows, null for the header.
//
// The reader's state lives in module-level variables and its helpers are plain module functions, so V8 optimises
// them once and keeps them optimised across the cases of a run.

const QUOTE = 34; // "
const COMMA = 44; // ,
const LF = 10; // \n
const CR = 13; // \r
const BOM = 0xfeff;

// How a field ended.
const K_COMMA = 1;
const K_LINE_BREAK = 2;
const K_END = 3;

// The text being read, and the reader's position in it.
let text = '';
let len = 0;
let pos = 0; // the next character to read
let line = 1; // the line that character is on
let kind = K_END; // how the last field read ended
let added = 0; // characters kept by the last readUnquoted

// The output being built, and the record being read (its starting line, and its index in rows; null for the header).
let errors = [];
let rows = [];
let columns = null;
let width = -1;
let hasHeader = false;
let recordLine = 1;
let recordRow = null;

function error(code) {
  errors.push({ code, line: recordLine, row: recordRow });
}

// Adds one record's fields, applying the header, padding and cutting rules.
function addRecord(fields) {
  if (width < 0) width = fields.length;
  if (hasHeader && columns === null) {
    columns = fields;
    return;
  }
  if (fields.length < width) {
    errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
    while (fields.length < width) fields.push('');
  } else if (fields.length > width) {
    errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
  }
  rows.push(fields);
}

// Reads unquoted text from pos, starting with `prefix`, up to the next comma or line break. Returns the value and
// sets kind (how it ended) and added (the characters kept).
function readUnquoted(prefix) {
  let value = prefix;
  added = 0;
  let s = pos;
  let i = pos;
  while (i < len) {
    const c = text.charCodeAt(i);
    if (c !== COMMA && c !== LF && c !== CR) {
      i += 1;
      continue;
    }
    if (c === COMMA) {
      value += text.slice(s, i);
      added += i - s;
      pos = i + 1;
      kind = K_COMMA;
      return value;
    }
    if (c === LF) {
      value += text.slice(s, i);
      added += i - s;
      pos = i + 1;
      line += 1;
      kind = K_LINE_BREAK;
      return value;
    }
    // A CR.
    if (i + 1 < len && text.charCodeAt(i + 1) === LF) {
      value += text.slice(s, i);
      added += i - s;
      pos = i + 2;
      line += 1;
      kind = K_LINE_BREAK;
      return value;
    }
    value += text.slice(s, i);
    added += i - s;
    error('stray_cr');
    i += 1;
    s = i;
  }
  value += text.slice(s, len);
  added += len - s;
  pos = len;
  kind = K_END;
  return value;
}

// Reads a quoted field whose opening quote is at pos. Returns the value and sets kind.
function readQuoted() {
  const open = pos;
  const openLine = line;
  let value = '';
  let s = pos + 1;
  let i = s;
  let closed = false;
  while (i < len) {
    const c = text.charCodeAt(i);
    if (c === QUOTE) {
      if (i + 1 < len && text.charCodeAt(i + 1) === QUOTE) {
        // "" inside quotes is one quote.
        value += text.slice(s, i) + '"';
        i += 2;
        s = i;
        continue;
      }
      value += text.slice(s, i);
      pos = i + 1;
      closed = true;
      break;
    }
    if (c === CR) {
      // CRLF and a lone CR inside quotes are each one LF.
      value += text.slice(s, i) + '\n';
      line += 1;
      i += (i + 1 < len && text.charCodeAt(i + 1) === LF) ? 2 : 1;
      s = i;
      continue;
    }
    if (c === LF) line += 1;
    i += 1;
  }

  if (!closed) {
    // A quote that never closes is a literal character; the text after it is read again as unquoted.
    pos = open + 1;
    line = openLine;
    error('unterminated_quote');
    return readUnquoted('"');
  }

  if (pos >= len) {
    kind = K_END;
    return value;
  }
  const c = text.charCodeAt(pos);
  if (c === COMMA) {
    pos += 1;
    kind = K_COMMA;
    return value;
  }
  if (c === LF) {
    pos += 1;
    line += 1;
    kind = K_LINE_BREAK;
    return value;
  }
  if (c === CR && pos + 1 < len && text.charCodeAt(pos + 1) === LF) {
    pos += 2;
    line += 1;
    kind = K_LINE_BREAK;
    return value;
  }
  // Text after the closing quote is appended as it stands, up to the next comma or line break.
  const withJunk = readUnquoted(value);
  if (added > 0) error('quote_junk');
  return withJunk;
}

// Reads every record of the text into rows (and columns, for a header).
function readAll() {
  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && pos + 1 < len && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) return;

    recordLine = line;
    recordRow = hasHeader && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === QUOTE;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (kind === K_COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    addRecord(fields);
  }
}

// Fast path for text with no quote and no CR: each line is one record, and line numbers are plain LF counts.
function readPlain() {
  let start = pos;
  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = len;
    if (end > start) {
      recordLine = line;
      recordRow = hasHeader && columns === null ? null : rows.length;
      addRecord(text.slice(start, end).split(','));
    }
    line += 1;
    start = end + 1;
  }
}

export function run(input) {
  text = String(input.text);
  len = text.length;
  hasHeader = input.header === true;
  errors = [];
  rows = [];
  columns = null;
  width = -1;
  recordLine = 1;
  recordRow = null;
  pos = len > 0 && text.charCodeAt(0) === BOM ? 1 : 0;
  line = 1;
  kind = K_END;
  added = 0;

  if (text.indexOf('"') < 0 && text.indexOf('\r') < 0) readPlain();
  else readAll();

  const result = { columns: hasHeader ? (columns ?? []) : null, rows, errors };
  // Drop the references so one run's text is not kept alive by the next call's state.
  text = '';
  return result;
}
