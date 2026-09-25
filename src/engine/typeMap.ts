import type { Column, GeneratorKind } from './types';

/**
 * The type-map: decide how a column gets its data.
 * Priority order (matches USE-CASES.md):
 *   1. constraints (auto-increment PK, foreign key, enum)
 *   2. column NAME match (email -> email, city -> city)  ← most realistic
 *   3. fall back to column TYPE (int -> integer, varchar -> text)
 *
 * Returns a GeneratorKind; the UI may override it per column.
 */
export function mapColumnToGenerator(col: {
  name: string;
  sqlType: string;
  autoIncrement: boolean;
  primaryKey: boolean;
  foreignKey?: unknown;
  enumValues?: string[];
}): GeneratorKind {
  // 1. Structural constraints win outright.
  if (col.foreignKey) return 'foreignKey';
  if (col.enumValues && col.enumValues.length > 0) return 'enum';
  if (col.autoIncrement || (col.primaryKey && isIntType(col.sqlType))) return 'autoIncrement';

  // 2. Match by column name (normalized: lowercase, strip _ and spaces).
  const n = col.name.toLowerCase().replace(/[_\s]/g, '');
  const byName = matchByName(n);
  if (byName) return byName;

  // 3. Fall back to SQL type.
  return matchByType(col.sqlType);
}

function matchByName(n: string): GeneratorKind | null {
  // Order matters: check the most specific substrings first.
  const rules: Array<[RegExp, GeneratorKind]> = [
    [/^(uuid|guid)$/, 'uuid'],
    [/(^id$|_id$|^id)/, 'integer'], // bare id handled as autoIncrement earlier; *_id non-FK -> integer
    [/email/, 'email'],
    [/(^username|handle|login)/, 'username'],
    [/(fullname|^name$|customername|contactname|displayname)/, 'fullName'],
    [/(firstname|givenname|^fname$)/, 'firstName'],
    [/(lastname|surname|familyname|^lname$)/, 'lastName'],
    [/(phone|mobile|contactnumber|tel)/, 'phone'],
    [/(streetaddress|address|street|addr)/, 'streetAddress'],
    [/(city|town)/, 'city'],
    [/(country|nation)/, 'country'],
    [/(company|employer|organi[sz]ation|orgname|^org$|legalname|legalentity|entityname|businessname)/, 'company'],
    [/(jobtitle|position|role|designation)/, 'jobTitle'],
    [/(sku|productcode|itemcode|barcode|^upc$|code$|^code$)/, 'sku'],
    [/slug/, 'slug'],
    [/(categoryname|department|^category$|section)/, 'category'],
    [/(productname|itemname|product|title)/, 'productName'],
    [/(price|amount|cost|total|salary|balance|revenue|fee)/, 'price'],
    [/(avatar|image|photo|picture|website|url|link|homepage)/, 'url'],
    [/(description|bio|about|comment|review|note|body|content|message)/, 'paragraph'],
    [/(createdat|updatedat|deletedat|timestamp|datetime)/, 'datetime'],
    [/(birthdate|dob|date)/, 'date'],
    [/(isactive|isdeleted|isverified|enabled|active|verified|^is[A-Z])/, 'boolean'],
  ];
  for (const [re, kind] of rules) {
    if (re.test(n)) return kind;
  }
  return null;
}

export function matchByType(sqlType: string): GeneratorKind {
  const t = sqlType.toLowerCase();
  if (/(bool|bit)/.test(t)) return 'boolean';
  if (/(timestamp|datetime)/.test(t)) return 'datetime';
  if (/date/.test(t)) return 'date';
  if (/(decimal|numeric|float|double|real|money)/.test(t)) return 'decimal';
  if (/(int|serial|bigint|smallint)/.test(t)) return 'integer';
  if (/(uuid|guid)/.test(t)) return 'uuid';
  if (/(json|jsonb)/.test(t)) return 'json';
  if (/(text|longtext|mediumtext|clob)/.test(t)) return 'paragraph';
  // varchar/char and unknowns -> short text
  return 'text';
}

function isIntType(sqlType: string): boolean {
  return /(int|serial|bigint|smallint)/i.test(sqlType);
}

/** Human-friendly label for a generator kind (used in the UI dropdown). */
export const GENERATOR_LABELS: Record<GeneratorKind, string> = {
  fullName: 'Full name',
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  username: 'Username',
  phone: 'Phone',
  city: 'City',
  country: 'Country',
  streetAddress: 'Street address',
  company: 'Company',
  jobTitle: 'Job title',
  productName: 'Product name',
  sku: 'SKU',
  slug: 'Slug',
  category: 'Category',
  price: 'Price',
  paragraph: 'Paragraph',
  sentence: 'Sentence',
  word: 'Word',
  url: 'URL',
  uuid: 'UUID',
  boolean: 'Boolean',
  integer: 'Integer',
  decimal: 'Decimal',
  datetime: 'Date + time',
  date: 'Date',
  enum: 'Enum (fixed set)',
  foreignKey: 'Foreign key',
  autoIncrement: 'Auto-increment',
  json: 'JSON',
  text: 'Text',
};

/** All kinds a user can pick from in the override dropdown, grouped. */
export const ALL_GENERATORS = Object.keys(GENERATOR_LABELS) as GeneratorKind[];

export function applyTypeMap(columns: Column[]): void {
  for (const col of columns) {
    col.generator = mapColumnToGenerator(col);
  }
}
