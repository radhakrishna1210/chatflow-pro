/**
 * Order-insensitive comparison of Prisma schemas.
 *
 * Prisma reformats schema.prisma before embedding it as the generated client's
 * inlineSchema. Besides whitespace and comments, formatting moves block
 * attributes (@@unique, @@index, ...) below all fields and may regroup fields,
 * so a byte- or token-order comparison reports a correctly generated client as
 * stale. Order carries no meaning for model fields, block attributes, field
 * attributes, datasource/generator settings, or top-level blocks, so those are
 * compared as sets. Enum values keep their order (it defines the database
 * enum's ordering). Everything inside quotes is retained verbatim.
 */

// Strip comments and all whitespace outside quotes from one logical line.
function compactLine(line) {
  let result = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      result += char;
      if (char === '\\') result += line[++index] || '';
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; result += char; continue; }
    if (char === '/' && line[index + 1] === '/') break;
    if (!/\s/.test(char)) result += char;
  }
  return result;
}

// Remove block comments, then split into logical lines. A statement whose
// brackets are still open continues onto the next physical line.
function logicalLines(text) {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let withoutBlockComments = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      withoutBlockComments += char;
      if (char === '\\') withoutBlockComments += source[++index] || '';
      else if (char === '"' || char === '\n') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; withoutBlockComments += char; continue; }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      withoutBlockComments += '\n';
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) break;
      withoutBlockComments += source.slice(index, end + 2).replace(/[^\n]/g, '');
      index = end + 1;
      continue;
    }
    withoutBlockComments += char;
  }

  const lines = [];
  let pending = '';
  let depth = 0;
  for (const physical of withoutBlockComments.split('\n')) {
    const compact = compactLine(physical);
    if (!compact && !pending) continue;
    pending += compact;
    let inQuotes = false;
    for (let index = 0; index < compact.length; index += 1) {
      const char = compact[index];
      if (inQuotes) {
        if (char === '\\') index += 1;
        else if (char === '"') inQuotes = false;
      } else if (char === '"') inQuotes = true;
      else if (char === '(' || char === '[') depth += 1;
      else if (char === ')' || char === ']') depth -= 1;
    }
    if (depth <= 0) {
      lines.push(pending);
      pending = '';
      depth = 0;
    }
  }
  if (pending) lines.push(pending);
  return lines;
}

// Split a compacted field line into its declaration and top-level attributes,
// so `@id @default(cuid())` equals `@default(cuid()) @id`.
function canonicalField(line) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      current += char;
      if (char === '\\') current += line[++index] || '';
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; current += char; continue; }
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === '@' && depth === 0 && line[index - 1] !== '@') {
      parts.push(current);
      current = '';
    }
    current += char;
  }
  parts.push(current);
  const [declaration, ...attributes] = parts;
  return [declaration, ...attributes.sort()].join('');
}

const ORDERED_BLOCKS = new Set(['enum']);

/**
 * Returns a string that is identical for two schemas exactly when they declare
 * the same blocks with the same statements, regardless of formatting,
 * comments, or statement ordering.
 */
export function canonicalSchema(text) {
  const blocks = [];
  let current = null;
  for (const line of logicalLines(text)) {
    if (!current) {
      const open = line.match(/^(model|enum|view|type|datasource|generator)(.*)\{$/);
      if (open) {
        current = { kind: open[1], header: `${open[1]} ${open[2]}`, statements: [] };
      } else {
        blocks.push(line); // Unexpected top-level text is kept, never ignored.
      }
      continue;
    }
    if (line === '}') {
      const statements = ORDERED_BLOCKS.has(current.kind)
        ? current.statements
        : current.statements
          .map((statement) => (statement.startsWith('@@') ? statement : canonicalField(statement)))
          .sort();
      blocks.push(`${current.header}{${statements.join('\n')}}`);
      current = null;
      continue;
    }
    current.statements.push(line);
  }
  if (current) blocks.push(`${current.header}{${current.statements.join('\n')}`); // Unterminated block.
  return blocks.sort().join('\n');
}
