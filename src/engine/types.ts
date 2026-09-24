// Internal schema model — every input adapter (SQL now; Prisma/JSON later)
// normalizes into these types, so the generator never changes when we add a front door.

/** What kind of value a column should get. Chosen by the type-map. */
export type GeneratorKind =
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'username'
  | 'phone'
  | 'city'
  | 'country'
  | 'streetAddress'
  | 'company'
  | 'jobTitle'
  | 'productName'
  | 'sku'
  | 'slug'
  | 'category'
  | 'price'
  | 'paragraph'
  | 'sentence'
  | 'word'
  | 'url'
  | 'uuid'
  | 'boolean'
  | 'integer'
  | 'decimal'
  | 'datetime'
  | 'date'
  | 'enum'
  | 'foreignKey'
  | 'autoIncrement'
  | 'json'
  | 'text';

export interface ForeignKeyRef {
  table: string;
  column: string;
}

export interface Column {
  name: string;
  /** Raw SQL type as written, e.g. "VARCHAR(255)", "int", "timestamp". */
  sqlType: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  autoIncrement: boolean;
  foreignKey?: ForeignKeyRef;
  /** Populated for ENUM / CHECK-IN columns. */
  enumValues?: string[];
  /** Chosen by the type-map; may be overridden by the user in the UI. */
  generator: GeneratorKind;
}

export interface Table {
  name: string;
  columns: Column[];
}

export interface Schema {
  tables: Table[];
}

export type GeneratedRow = Record<string, string | number | boolean | null>;

export interface GeneratedTable {
  name: string;
  columns: string[];
  rows: GeneratedRow[];
}

export interface GenerateOptions {
  count: number;
  seed: number;
  locale: string;
  /** Fraction of nullable columns that get NULL (0–1). */
  nullRate?: number;
}
