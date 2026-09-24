import type { Schema, Table } from './types';

/**
 * Topological sort of tables by foreign-key dependencies (Kahn's algorithm).
 * Parents (referenced tables) come before children, so a child can always point
 * at an already-generated parent row → referential integrity holds.
 *
 * Self-references and cycles are tolerated: cyclic tables are appended in input
 * order (the generator handles missing parents by picking any prior/own row).
 */
export function topoSortTables(schema: Schema): Table[] {
  const tables = schema.tables;
  const byName = new Map(tables.map((t) => [t.name, t]));

  // Build dependency edges: table -> set of tables it references (excluding self).
  const deps = new Map<string, Set<string>>();
  for (const t of tables) {
    const set = new Set<string>();
    for (const col of t.columns) {
      const fk = col.foreignKey;
      if (fk && fk.table !== t.name && byName.has(fk.table)) {
        set.add(fk.table);
      }
    }
    deps.set(t.name, set);
  }

  // Kahn: repeatedly emit tables whose deps are all already emitted.
  const emitted = new Set<string>();
  const order: Table[] = [];
  let progress = true;

  while (order.length < tables.length && progress) {
    progress = false;
    for (const t of tables) {
      if (emitted.has(t.name)) continue;
      const unmet = [...deps.get(t.name)!].some((d) => !emitted.has(d));
      if (!unmet) {
        order.push(t);
        emitted.add(t.name);
        progress = true;
      }
    }
  }

  // Any leftovers are in a cycle → append in original order.
  for (const t of tables) {
    if (!emitted.has(t.name)) order.push(t);
  }

  return order;
}
