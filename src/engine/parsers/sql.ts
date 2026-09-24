import type { Column, Schema, Table } from '../types';
import { applyTypeMap } from '../typeMap';

// node-sql-parser bundles PEG grammars for every dialect (~500 KB gzip); load it
// lazily so it stays out of the initial app island and arrives on first parse.

// Dialects we try in order until one parses cleanly. MySQL/MariaDB come first:
// they throw on Postgres-only syntax (SERIAL, TIMESTAMP WITH TIME ZONE) so real
// Postgres pastes still fall through, but a MySQL paste isn't silently mangled
// by Postgres (which would drop AUTO_INCREMENT and misread ENUM values).
const DIALECTS = ['mysql', 'mariadb', 'postgresql', 'sqlite', 'bigquery'] as const;

interface NormalizedSql {
  sql: string;
  /** Lower-cased Postgres custom-enum type name → its allowed values. */
  customEnums: Record<string, string[]>;
}

/**
 * Prepare pasted DDL for the grammar:
 *  - node-sql-parser has no grammar for Postgres 10+ identity columns
 *    (`GENERATED ALWAYS|BY DEFAULT AS IDENTITY`) in any dialect, so rewrite them
 *    to their SERIAL equivalent, which also lets the existing SERIAL →
 *    autoIncrement detection pick them up for free.
 *  - Harvest Postgres `CREATE TYPE x AS ENUM (...)` declarations so a column
 *    typed as `x` can generate one of the enum's values instead of raw text.
 *    The CREATE TYPE statement itself parses fine under the postgresql dialect
 *    and is skipped downstream as a non-table statement — no stripping needed.
 */
function normalizeSql(sql: string): NormalizedSql {
  const cleaned = sql.replace(
    /\b(BIGINT|SMALLINT|INTEGER|INT)\s+GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY(?:\s*\([^)]*\))?/gi,
    (_, type: string) => {
      const t = type.toUpperCase();
      if (t === 'BIGINT') return 'BIGSERIAL';
      if (t === 'SMALLINT') return 'SMALLSERIAL';
      return 'SERIAL';
    },
  );

  const customEnums: Record<string, string[]> = {};
  const typeEnum = /CREATE\s+TYPE\s+("?\w+"?)\s+AS\s+ENUM\s*\(([^)]*)\)/gi;
  for (let m = typeEnum.exec(cleaned); m; m = typeEnum.exec(cleaned)) {
    const name = m[1].replace(/"/g, '').toLowerCase();
    const values = m[2]
      .split(',')
      .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    if (name && values.length) customEnums[name] = values;
  }

  return { sql: cleaned, customEnums };
}

export interface ParseResult {
  schema: Schema;
  dialect: string;
}

export class SqlParseError extends Error {}

/** Parse pasted SQL DDL into our internal Schema. Throws SqlParseError on total failure. */
export async function parseSql(sql: string): Promise<ParseResult> {
  const trimmed = sql.trim();
  if (!trimmed) throw new SqlParseError('Paste a CREATE TABLE statement to begin.');

  const { sql: normalized, customEnums } = normalizeSql(trimmed);
  const mod = await import('node-sql-parser');
  const Parser = (mod as any).Parser ?? (mod as any).default?.Parser;
  const parser = new Parser();
  let ast: unknown;
  let usedDialect = '';
  let lastErr: unknown;

  for (const dialect of DIALECTS) {
    try {
      const candidate = parser.astify(normalized, { database: dialect });
      // A dialect can "succeed" yet mis-parse features it doesn't own (e.g.
      // Postgres swallowing MySQL AUTO_INCREMENT/ENUM and emitting column names
      // as `{expr:{value}}` instead of strings). Only accept a clean parse.
      if (!isCleanParse(candidate)) {
        lastErr = new Error(`${dialect} produced a malformed schema`);
        continue;
      }
      ast = candidate;
      usedDialect = dialect;
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!ast) {
    const msg = lastErr instanceof Error ? lastErr.message : 'Could not parse SQL.';
    throw new SqlParseError(`Couldn't parse that SQL. ${msg}`);
  }

  const statements = Array.isArray(ast) ? ast : [ast];
  const tables: Table[] = [];

  for (const stmt of statements as any[]) {
    if (stmt?.type !== 'create' || stmt?.keyword !== 'table') continue;
    const table = parseCreateTable(stmt, customEnums);
    if (table) tables.push(table);
  }

  if (tables.length === 0) {
    throw new SqlParseError('No CREATE TABLE statements found in the input.');
  }

  for (const t of tables) applyTypeMap(t.columns);
  return { schema: { tables }, dialect: usedDialect };
}

/**
 * Extract a plain string column name from node-sql-parser's `column` field.
 * Clean dialects give a string; a mis-matched dialect can nest it as
 * `{ expr: { value } }` or `{ value }`. Returns undefined if unrecoverable.
 */
function readColumnName(column: any): string | undefined {
  if (typeof column === 'string') return column;
  if (column == null) return undefined;
  const c = column.column ?? column;
  if (typeof c === 'string') return c;
  const v = c?.expr?.value ?? c?.value;
  return typeof v === 'string' ? v : undefined;
}

/**
 * A dialect can parse without throwing yet mangle features it doesn't support.
 * Reject any result where a column definition's name can't be recovered — the
 * signal that the grammar didn't truly understand the statement. (Postgres
 * legitimately nests names as `{expr:{value}}`; readColumnName handles both,
 * so only a truly unrecoverable name fails the check.)
 */
function isCleanParse(ast: unknown): boolean {
  const statements = Array.isArray(ast) ? ast : [ast];
  let sawTable = false;
  for (const stmt of statements as any[]) {
    if (stmt?.type !== 'create' || stmt?.keyword !== 'table') continue;
    sawTable = true;
    for (const def of stmt.create_definitions ?? []) {
      if (def?.resource !== 'column') continue;
      if (readColumnName(def.column) === undefined) return false;
    }
  }
  return sawTable;
}

/**
 * Extract the allowed values from a column-level `CHECK (col IN ('a','b'))`,
 * so enum-like Postgres columns generate one of their permitted values instead
 * of random text. Returns undefined for any other CHECK (e.g. `price >= 0`).
 */
function readCheckInValues(check: any): string[] | undefined {
  const defs = check?.definition;
  if (!Array.isArray(defs)) return undefined;
  for (const expr of defs) {
    if (expr?.type === 'binary_expr' && String(expr.operator).toUpperCase() === 'IN') {
      const vals = (expr.right?.value ?? [])
        .map((v: any) => (typeof v?.value === 'string' ? v.value : undefined))
        .filter((v: string | undefined): v is string => v !== undefined);
      if (vals.length) return vals;
    }
  }
  return undefined;
}

function parseCreateTable(stmt: any, customEnums: Record<string, string[]>): Table | null {
  const name: string | undefined = stmt.table?.[0]?.table;
  if (!name) return null;
  const defs: any[] = stmt.create_definitions ?? [];
  const columns: Column[] = [];
  const byName = new Map<string, Column>();

  // Pass 1: column definitions.
  for (const def of defs) {
    if (def.resource !== 'column') continue;
    const col = buildColumn(def, customEnums);
    columns.push(col);
    byName.set(col.name, col);
  }

  // Pass 2: table-level constraints (PRIMARY KEY / FOREIGN KEY / UNIQUE).
  for (const def of defs) {
    if (def.resource !== 'constraint') continue;
    const ctype = String(def.constraint_type ?? '').toLowerCase();
    const cols: string[] = (def.definition ?? [])
      .map((d: any) => readColumnName(d?.column))
      .filter(Boolean) as string[];

    if (ctype.includes('primary')) {
      for (const c of cols) {
        const col = byName.get(c);
        if (col) col.primaryKey = true;
      }
    } else if (ctype.includes('unique')) {
      for (const c of cols) {
        const col = byName.get(c);
        if (col) col.unique = true;
      }
    } else if (ctype.includes('foreign')) {
      const refTable = def.reference_definition?.table?.[0]?.table;
      const refCols: string[] = (def.reference_definition?.definition ?? [])
        .map((d: any) => readColumnName(d?.column))
        .filter(Boolean) as string[];
      // Composite keys: pair each local column with its positional reference
      // (falling back to the first ref column), so every participating column
      // gets a foreignKey rather than only the first.
      cols.forEach((localCol, i) => {
        const col = byName.get(localCol);
        const refCol = refCols[i] ?? refCols[0];
        if (col && refTable && refCol) {
          col.foreignKey = { table: refTable, column: refCol };
        }
      });
    }
  }

  return { name, columns };
}

function buildColumn(def: any, customEnums: Record<string, string[]>): Column {
  const name: string = readColumnName(def.column) ?? 'column';
  const sqlType = formatType(def.definition);
  // nullable is present only when NOT NULL is declared; absence => nullable.
  const notNull = def.nullable?.type === 'not null';
  const primaryKey = !!def.primary_key || def.unique_or_primary === 'primary key';
  const autoIncrement =
    !!def.auto_increment || /serial/i.test(def.definition?.dataType ?? '');
  const unique = def.unique === 'unique' || !!def.unique_or_primary;

  // Enum values come from an inline MySQL ENUM, a CHECK (col IN (...)) list, or
  // a referenced Postgres custom enum type harvested by normalizeSql.
  const dataType = String(def.definition?.dataType ?? '');
  const enumValues =
    dataType.toUpperCase() === 'ENUM'
      ? (def.definition?.expr?.value ?? []).map((v: any) => String(v.value))
      : readCheckInValues(def.check) ?? customEnums[dataType.toLowerCase()];

  // Inline column-level foreign key: `user_id INT REFERENCES users(user_id)`.
  // node-sql-parser attaches this to the column as `reference_definition`
  // (table-level `FOREIGN KEY (...)` constraints are handled in parseCreateTable).
  const ref = def.reference_definition;
  const refTable = ref?.table?.[0]?.table;
  const refCol = readColumnName(ref?.definition?.[0]?.column);
  const foreignKey = refTable && refCol ? { table: refTable, column: refCol } : undefined;

  return {
    name,
    sqlType,
    nullable: !notNull && !primaryKey,
    primaryKey,
    unique: unique || primaryKey,
    autoIncrement,
    enumValues,
    foreignKey,
    generator: 'text', // replaced by applyTypeMap()
  };
}

/** Rebuild a readable type string: VARCHAR(120), DECIMAL(10,2), INT. */
function formatType(definition: any): string {
  if (!definition?.dataType) return 'TEXT';
  const base = String(definition.dataType);
  if (definition.length != null && definition.scale != null) {
    return `${base}(${definition.length},${definition.scale})`;
  }
  if (definition.length != null) return `${base}(${definition.length})`;
  return base;
}
