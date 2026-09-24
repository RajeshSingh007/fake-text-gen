import type { Faker } from '@faker-js/faker';
import type {
  Column,
  GeneratedRow,
  GeneratedTable,
  GenerateOptions,
  GeneratorKind,
  Schema,
} from './types';
import { seededRandom, pick, type Rng } from './prng';
import { topoSortTables } from './topoSort';

// Fixed anchor for relative date generators so output depends only on the seed,
// not on the wall clock. Without this, faker.date.recent() drifts every run.
const REF_DATE = new Date('2026-01-01T00:00:00.000Z');

/** Locale metadata for the UI — static, so it never pulls faker into the initial bundle. */
export const LOCALE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'en', label: 'English (US)' },
  { key: 'en_IN', label: 'English (India)' },
  { key: 'de', label: 'German' },
  { key: 'es', label: 'Spanish' },
  { key: 'fr', label: 'French' },
  { key: 'ja', label: 'Japanese' },
  { key: 'pt_BR', label: 'Portuguese (Brazil)' },
];

// faker is ~800 KB gzip; load it once, lazily, only when data is first generated.
let fakerModule: typeof import('@faker-js/faker') | null = null;async function loadFaker() {
  if (!fakerModule) fakerModule = await import('@faker-js/faker');
  return fakerModule;
}

function resolveFaker(mod: typeof import('@faker-js/faker'), locale: string): Faker {
  const map: Record<string, Faker> = {
    en: mod.fakerEN,
    en_IN: mod.fakerEN_IN,
    de: mod.fakerDE,
    es: mod.fakerES,
    fr: mod.fakerFR,
    ja: mod.fakerJA,
    pt_BR: mod.fakerPT_BR,
  };
  return map[locale] ?? mod.fakerEN;
}

/**
 * Generate data for a whole schema (async: faker is code-split).
 * - Tables are produced in FK-dependency order (topological sort).
 * - Foreign keys sample from the referenced table's already-generated values.
 * - Same (seed, count, locale) → identical output, always.
 */
export async function generateData(
  schema: Schema,
  opts: GenerateOptions,
): Promise<GeneratedTable[]> {
  const { count, seed, locale, nullRate = 0.05 } = opts;
  const mod = await loadFaker();
  const faker = resolveFaker(mod, locale);
  faker.seed(seed);
  const rng = seededRandom(seed);

  // Which (table.column) pairs are referenced by some FK — only these need pooling.
  const referenced = new Set<string>();
  for (const t of schema.tables) {
    for (const c of t.columns) {
      if (c.foreignKey) referenced.add(`${c.foreignKey.table}.${c.foreignKey.column}`);
    }
  }

  const pools = new Map<string, Array<string | number | boolean | null>>();
  const ordered = topoSortTables(schema);
  const result: GeneratedTable[] = [];

  for (const table of ordered) {
    const columns = table.columns;
    const rows: GeneratedRow[] = [];
    const counters = new Map<string, number>();
    const seen = new Map<string, Set<string>>();
    for (const c of columns) {
      if (c.generator === 'autoIncrement') counters.set(c.name, 1);
      if (c.unique && c.generator !== 'autoIncrement') seen.set(c.name, new Set());
    }
    const dateOrder = dateSequenceOrder(columns);
    const selfRefs = selfReferences(columns, table.name);
    const selfPools = new Map<string, Array<string | number | boolean | null>>(
      selfRefs.map((s) => [s.col.name, []]),
    );

    for (let i = 0; i < count; i++) {
      const row: GeneratedRow = {};
      for (const col of columns) {
        row[col.name] = generateValue(col, { faker, rng, counters, seen, pools, nullRate });
      }
      // Self-referential FKs draw their parent from rows already generated in
      // this same table (see selfReferences) → a valid acyclic tree/forest.
      for (const s of selfRefs) {
        const pool = selfPools.get(s.col.name)!;
        row[s.col.name] =
          pool.length === 0 || (s.col.nullable && rng() < SELF_REF_ROOT_RATE)
            ? null
            : pick(pool, rng);
        pool.push(row[s.refColumn]);
      }
      if (dateOrder.length) applyDateSequence(row, dateOrder);
      rows.push(row);
    }

    for (const col of columns) {
      const key = `${table.name}.${col.name}`;
      if (referenced.has(key)) {
        pools.set(key, rows.map((r) => r[col.name]));
      }
    }

    result.push({ name: table.name, columns: columns.map((c) => c.name), rows });
  }

  return result;
}

interface Ctx {
  faker: Faker;
  rng: Rng;
  counters: Map<string, number>;
  seen: Map<string, Set<string>>;
  pools: Map<string, Array<string | number | boolean | null>>;
  nullRate: number;
}

function generateValue(col: Column, ctx: Ctx): string | number | boolean | null {
  const { rng, counters, seen, pools } = ctx;

  if (col.generator === 'autoIncrement') {
    const n = counters.get(col.name) ?? 1;
    counters.set(col.name, n + 1);
    return n;
  }

  if (col.generator === 'foreignKey' && col.foreignKey) {
    const pool = pools.get(`${col.foreignKey.table}.${col.foreignKey.column}`);
    if (pool && pool.length) return pick(pool, rng);
    return null;
  }

  if (col.nullable && rng() < ctx.nullRate) return null;

  const raw = rawValue(col, ctx);

  if (col.unique && seen.has(col.name)) {
    const set = seen.get(col.name)!;
    let val = String(raw);
    let attempt = 0;
    while (set.has(val)) {
      attempt++;
      val = suffixUnique(String(raw), attempt);
    }
    set.add(val);
    return typeof raw === 'number' && attempt === 0 ? raw : val;
  }

  return raw;
}

function suffixUnique(base: string, n: number): string {
  const at = base.indexOf('@');
  if (at > 0) return `${base.slice(0, at)}+${n}${base.slice(at)}`;
  return `${base}_${n}`;
}

function rawValue(col: Column, ctx: Ctx): string | number | boolean | null {
  const { faker, rng } = ctx;
  const kind: GeneratorKind = col.generator;

  switch (kind) {
    case 'fullName': return faker.person.fullName();
    case 'firstName': return faker.person.firstName();
    case 'lastName': return faker.person.lastName();
    case 'email': return faker.internet.email().toLowerCase();
    case 'username': return faker.internet.username();
    case 'phone': return faker.phone.number();
    case 'city': return faker.location.city();
    case 'country': return faker.location.country();
    case 'streetAddress': return faker.location.streetAddress();
    case 'company': return faker.company.name();
    case 'jobTitle': return faker.person.jobTitle();
    case 'productName': return faker.commerce.productName();
    case 'sku': return faker.string.alphanumeric({ length: 8, casing: 'upper' });
    case 'slug': return faker.helpers.slugify(faker.lorem.words({ min: 2, max: 3 })).toLowerCase();
    case 'category': return faker.commerce.department();
    case 'price': return Number(faker.commerce.price({ min: 5, max: 2000 }));
    case 'paragraph': return faker.lorem.paragraph();
    case 'sentence': return faker.lorem.sentence();
    case 'word': return faker.lorem.word();
    case 'url': return faker.internet.url();
    case 'uuid': return faker.string.uuid();
    case 'boolean': return faker.datatype.boolean();
    case 'integer': return faker.number.int({ min: 1, max: 100000 });
    case 'decimal': return faker.number.float({ min: 0, max: 10000, fractionDigits: 2 });
    case 'datetime': return faker.date.recent({ days: 365, refDate: REF_DATE }).toISOString();
    case 'date': return faker.date.recent({ days: 365, refDate: REF_DATE }).toISOString().slice(0, 10);
    case 'enum': return col.enumValues?.length ? pick(col.enumValues, rng) : 'value';
    case 'json': return JSON.stringify({ k: faker.lorem.word(), v: faker.number.int(999) });
    case 'text':
    default:
      return faker.lorem.words({ min: 2, max: 4 });
  }
}

// ── Self-referential foreign keys ────────────────────────────────────────────
// A table whose FK points back at itself (categories.parent_id → categories.id,
// employees.manager_id → employees.id, comments.reply_to → comments.id) can't use
// the normal FK pool: it isn't built until the table finishes generating, so the
// generic path yields NULL for every row. Instead each row draws its parent from
// the ids of rows already generated in this same table → a valid acyclic
// tree/forest. This fraction of rows stay top-level roots (NULL parent) even when
// parents are available, matching how real hierarchies have several roots.
const SELF_REF_ROOT_RATE = 0.35;

interface SelfRef {
  col: Column;
  /** The own-table column this FK points at (its values become the parent pool). */
  refColumn: string;
}

function selfReferences(columns: Column[], tableName: string): SelfRef[] {
  return columns
    .filter((c) => c.generator === 'foreignKey' && c.foreignKey?.table === tableName)
    .map((c) => ({ col: c, refColumn: c.foreignKey!.column }));
}

// ── Chronological date sequencing ────────────────────────────────────────────
// A row's date columns should read in a sensible order (created_at ≤ updated_at
// ≤ completed_at). We coarsely tier each date column by lifecycle keyword —
// tier 0 = creation/start, tier 2 = terminal events, tier 1 = updates and any
// unrecognised date column — then order within a tier by declaration order.
const DATE_START_HINTS = /creat|regist|sign.?up|join|start|begin|open|plac|submit|request|order|issue/i;
const DATE_END_HINTS = /ship|dispatch|deliver|complet|finish|clos|cancel|refund|return|expir|archiv|delet|remov|resolv/i;

function dateTier(name: string): number {
  if (DATE_START_HINTS.test(name)) return 0;
  if (DATE_END_HINTS.test(name)) return 2;
  return 1;
}

/**
 * The date/datetime columns of a table, in the chronological order their values
 * should follow within a row. Returns [] when there are fewer than two, so the
 * common single-timestamp table incurs no reordering.
 */
function dateSequenceOrder(columns: Column[]): string[] {
  const dateCols = columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.generator === 'date' || c.generator === 'datetime');
  if (dateCols.length < 2) return [];
  return dateCols
    .sort((a, b) => dateTier(a.c.name) - dateTier(b.c.name) || a.i - b.i)
    .map(({ c }) => c.name);
}

/**
 * Reassign a row's date values so they run chronologically across `order`.
 * Purely permutes the values already generated for those columns — nulls stay
 * null and the exact set of timestamps is unchanged, so determinism and the
 * seeded distribution are preserved. ISO strings sort chronologically.
 */
function applyDateSequence(row: GeneratedRow, order: string[]): void {
  const values = order
    .map((name) => row[name])
    .filter((v): v is string => typeof v === 'string')
    .sort();
  let vi = 0;
  for (const name of order) {
    if (typeof row[name] === 'string') row[name] = values[vi++];
  }
}
