import type { GeneratedTable } from './types';

export type ExportFormat = 'csv' | 'json' | 'sql';

/** Serialize generated tables to the requested format as a single string. */
export function serialize(tables: GeneratedTable[], format: ExportFormat): string {
  switch (format) {
    case 'json': return toJson(tables);
    case 'sql': return toSql(tables);
    case 'csv':
    default: return toCsv(tables);
  }
}

export const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv',
  json: 'application/json',
  sql: 'application/sql',
};

function toJson(tables: GeneratedTable[]): string {
  // Single table → array; multiple → object keyed by table name.
  if (tables.length === 1) return JSON.stringify(tables[0].rows, null, 2);
  const out: Record<string, unknown> = {};
  for (const t of tables) out[t.name] = t.rows;
  return JSON.stringify(out, null, 2);
}

function toCsv(tables: GeneratedTable[]): string {
  // Concatenate tables, each preceded by a comment banner when there's more than one.
  return tables
    .map((t) => {
      const header = t.columns.join(',');
      const body = t.rows
        .map((r) => t.columns.map((c) => csvCell(r[c])).join(','))
        .join('\n');
      const banner = tables.length > 1 ? `# ${t.name}\n` : '';
      return `${banner}${header}\n${body}`;
    })
    .join('\n\n');
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Quote if it contains comma, quote, or newline; escape embedded quotes.
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toSql(tables: GeneratedTable[]): string {
  return tables
    .map((t) => {
      const cols = t.columns.map(quoteIdent).join(', ');
      const values = t.rows
        .map((r) => `(${t.columns.map((c) => sqlLiteral(r[c])).join(', ')})`)
        .join(',\n  ');
      return `INSERT INTO ${quoteIdent(t.name)} (${cols}) VALUES\n  ${values};`;
    })
    .join('\n\n');
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}
