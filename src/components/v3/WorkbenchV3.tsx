import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeneratedTable, GeneratorKind, Schema } from '@engine/types';
import { parseSql, SqlParseError, SAMPLE_SQL, findExample } from '@engine/index';
import { generateData, LOCALE_OPTIONS } from '@engine/generate';
import { serialize, MIME, type ExportFormat } from '@engine/export';
import { GENERATOR_LABELS, ALL_GENERATORS } from '@engine/typeMap';
import Select from '../Select';
import './workbench-v3.css';

const PREVIEW_ROWS = 100;
const GENERATOR_OPTIONS = ALL_GENERATORS.map((g) => ({ value: g, label: GENERATOR_LABELS[g] }));
const LOCALE_SELECT = LOCALE_OPTIONS.map(({ key, label }) => ({ value: key, label }));

/**
 * Stripe-themed workbench. Presentation only — the parse → type-map → generate →
 * serialize pipeline is the shared engine in src/engine, identical to the other UIs.
 */
export default function WorkbenchV3() {
  const [sqlText, setSqlText] = useState('');
  const [schema, setSchema] = useState<Schema | null>(null);
  const [dialect, setDialect] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [count, setCount] = useState(1000);
  const [seed, setSeed] = useState(42);
  const [locale, setLocale] = useState('en');

  const [preview, setPreview] = useState<GeneratedTable[] | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasGenerated = preview !== null;

  const parse = useCallback(async (text: string): Promise<Schema | null> => {
    try {
      const { schema, dialect } = await parseSql(text);
      setSchema(schema);
      setDialect(dialect);
      setError(null);
      return schema;
    } catch (err) {
      setSchema(null);
      setPreview(null);
      setError(err instanceof SqlParseError ? err.message : 'Failed to parse SQL.');
      return null;
    }
  }, []);

  const runPreview = useCallback(
    async (s: Schema) => {
      try {
        const rows = Math.min(count, PREVIEW_ROWS);
        const tables = await generateData(s, { count: rows, seed, locale });
        setPreview(tables);
        setActiveTab((i) => Math.min(i, Math.max(0, tables.length - 1)));
        setError(null);
      } catch (err) {
        // Generation (not parsing) failed — surface it instead of failing silently.
        setPreview(null);
        setError(err instanceof Error ? `Couldn't generate data. ${err.message}` : 'Failed to generate data.');
      }
    },
    [count, seed, locale],
  );

  const handleGenerate = useCallback(async () => {
    setBusy(true);
    try {
      const s = schema ?? (await parse(sqlText));
      if (s) await runPreview(s);
    } finally {
      setBusy(false);
    }
  }, [schema, sqlText, parse, runPreview]);

  const handleParse = useCallback(async () => {
    // Parse *and* preview in one click — a parsed-but-empty preview reads as broken
    // and gives no cue to press Generate. "Try an example" already does both.
    setBusy(true);
    try {
      const s = await parse(sqlText);
      if (s) await runPreview(s);
    } finally {
      setBusy(false);
    }
  }, [parse, sqlText, runPreview]);

  const loadSql = useCallback(
    async (sql: string) => {
      setSqlText(sql);
      setBusy(true);
      try {
        const s = await parse(sql);
        if (s) await runPreview(s);
      } finally {
        setBusy(false);
      }
    },
    [parse, runPreview],
  );

  const loadExample = useCallback(() => loadSql(SAMPLE_SQL), [loadSql]);

  // Deep-link handoff from the landing page: /app?example=chess preloads that
  // schema and generates a preview immediately, so the card click lands on rows.
  const didAutoload = useRef(false);
  useEffect(() => {
    if (didAutoload.current) return;
    didAutoload.current = true;
    const id = new URLSearchParams(window.location.search).get('example');
    const ex = findExample(id);
    if (ex) void loadSql(ex.sql);
  }, [loadSql]);

  const handleOverride = useCallback(
    (tableName: string, columnName: string, generator: GeneratorKind) => {
      setSchema((prev) => {
        if (!prev) return prev;
        return {
          tables: prev.tables.map((t) =>
            t.name !== tableName
              ? t
              : {
                  ...t,
                  columns: t.columns.map((c) =>
                    c.name === columnName ? { ...c, generator } : c,
                  ),
                },
          ),
        };
      });
    },
    [],
  );

  // After the first generation, keep the preview in sync as inputs change.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (schema && hasGenerated) runPreview(schema);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, seed, locale, count]);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (!schema) return;
      try {
        const tables = await generateData(schema, { count, seed, locale });
        const multi = tables.length > 1;
        // CSV is single-table: export the table on screen rather than concatenating.
        const scoped = format === 'csv' && multi ? [tables[activeTab] ?? tables[0]] : tables;
        const text = serialize(scoped, format);
        const blob = new Blob([text], { type: MIME[format] });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download =
          format === 'csv' && multi
            ? `mockforge-${scoped[0].name}-${seed}.csv`
            : `mockforge-${seed}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(err instanceof Error ? `Couldn't export ${format.toUpperCase()}. ${err.message}` : 'Export failed.');
      }
    },
    [schema, count, seed, locale, activeTab],
  );

  const handleCopy = useCallback(() => {
    if (!preview) return;
    navigator.clipboard?.writeText(serialize(preview, 'json'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [preview]);

  const activeTable = preview?.[activeTab] ?? preview?.[0] ?? null;
  const shown = activeTable?.rows.length ?? 0;
  const capped = shown < count;
  const totalCols = schema?.tables.reduce((n, t) => n + t.columns.length, 0) ?? 0;

  // SQL type per column of the on-screen table, shown under each header like a
  // DB client (INTEGER / TEXT / VARCHAR(120)…). Sourced from the parsed schema.
  const activeCols = schema?.tables.find((t) => t.name === activeTable?.name)?.columns;
  const colType = (name: string) => activeCols?.find((c) => c.name === name)?.sqlType ?? '';

  return (
    <div className="stx-app">
      {/* Top bar */}
      <header className="stx-topbar">
        <div className="stx-tb-left">
          <a className="stx-tb-brand" href="/">
            <span className="stx-tb-mark" aria-hidden="true"></span>
            mockforge
          </a>
          <span className="stx-tb-crumb">Generator</span>
        </div>

        <div className="stx-tb-controls">
          <label className="stx-ctl">
            <span>seed</span>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
            />
          </label>
          <label className="stx-ctl">
            <span>rows</span>
            <input
              type="number"
              min={1}
              max={1000000}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(1000000, Number(e.target.value) || 1)))}
            />
          </label>
          <div className="stx-ctl stx-ctl-sel">
            <span>locale</span>
            <Select
              value={locale}
              options={LOCALE_SELECT}
              onChange={setLocale}
              ariaLabel="Locale"
              triggerClassName="sel-stx sel-stx-locale"
              menuClassName="sel-menu-stx"
            />
          </div>
          <button className="stx-generate" onClick={handleGenerate} disabled={busy}>
            {busy ? 'Generating…' : 'Generate'}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </header>

      {/* Workspace */}
      <div className="stx-grid">
        {/* Input */}
        <section className="stx-panel stx-panel-input">
          <div className="stx-panel-head">
            <span className="stx-ph-title">
              <span className="stx-ph-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
                </svg>
              </span>
              <span className="stx-panel-title">Schema</span>
            </span>
            {dialect && <span className="stx-chip-dialect">{dialect}</span>}
          </div>
          <div className="stx-panel-body">
            <div className="stx-sql-wrap">
              <span className="stx-sql-lang" aria-hidden="true">SQL</span>
              <textarea
                className="stx-sql"
                placeholder="Paste a CREATE TABLE statement…"
                value={sqlText}
                onChange={(e) => setSqlText(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="stx-input-actions">
              <button className="stx-btn stx-btn-primary stx-btn-sm" onClick={handleParse} disabled={!sqlText.trim() || busy}>
                {busy ? 'Working…' : 'Parse & preview'}
              </button>
              <button className="stx-btn stx-btn-secondary stx-btn-sm" onClick={loadExample}>
                Try an example
              </button>
            </div>
            {error ? (
              <div className="stx-error">{error}</div>
            ) : (
              <p className="stx-hint">
                Postgres, MySQL, SQLite &amp; MariaDB are auto-detected. Foreign keys resolve in
                dependency order.
              </p>
            )}
          </div>
        </section>

        {/* Mapping */}
        <section className="stx-panel stx-panel-map">
          <div className="stx-panel-head">
            <span className="stx-ph-title">
              <span className="stx-ph-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7h12M15 7l-3-3M15 7l-3 3" /><path d="M21 17H9M9 17l3-3M9 17l3 3" />
                </svg>
              </span>
              <span className="stx-panel-title">Type-map</span>
            </span>
            {schema && (
              <span className="stx-muted">
                {schema.tables.length} {schema.tables.length === 1 ? 'table' : 'tables'}
              </span>
            )}
          </div>
          <div className="stx-panel-body">
            {schema ? (
              schema.tables.map((table) => (
                <div className="stx-table-block" key={table.name}>
                  <div className="stx-table-name">
                    <span className="stx-tn-dot" aria-hidden="true"></span>
                    {table.name}
                    <span className="stx-muted">{table.columns.length} cols</span>
                  </div>
                  {table.columns.map((col) => (
                    <div className="stx-col-row" key={col.name}>
                      <div className="stx-col-meta">
                        <span className="stx-col-name" title={col.name}>{col.name}</span>
                        <span className="stx-col-type">{col.sqlType}</span>
                        {col.primaryKey && <span className="stx-tag stx-tag-pk">PK</span>}
                        {col.foreignKey && (
                          <span
                            className="stx-tag stx-tag-fk"
                            title={`references ${col.foreignKey.table}.${col.foreignKey.column}`}
                          >
                            FK→{col.foreignKey.table}
                          </span>
                        )}
                        {col.unique && !col.primaryKey && (
                          <span className="stx-tag stx-tag-uniq">UNIQUE</span>
                        )}
                      </div>
                      <Select
                        value={col.generator}
                        options={GENERATOR_OPTIONS}
                        onChange={(v) => handleOverride(table.name, col.name, v as GeneratorKind)}
                        ariaLabel={`Generator for ${table.name}.${col.name}`}
                        triggerClassName="sel-stx sel-stx-compact"
                        menuClassName="sel-menu-stx"
                      />
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <div className="stx-empty">
                <div className="stx-empty-glyph" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7h12M15 7l-3-3M15 7l-3 3" /><path d="M21 17H9M9 17l3-3M9 17l3 3" />
                  </svg>
                </div>
                <h3>No schema yet</h3>
                <p>Paste SQL and hit “Parse schema”, or load the example to see the type-map.</p>
              </div>
            )}
          </div>
        </section>

        {/* Preview */}
        <section className="stx-panel stx-panel-preview">
          {preview && activeTable ? (
            <>
              <div className="stx-panel-head">
                {preview.length > 1 ? (
                  <div className="stx-tabs" role="tablist">
                    {preview.map((t, i) => (
                      <button
                        key={t.name}
                        role="tab"
                        data-active={i === activeTab}
                        onClick={() => setActiveTab(i)}
                      >
                        <svg className="stx-tab-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M3 9h18M9 9v12" />
                        </svg>
                        {t.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="stx-ph-title">
                    <span className="stx-ph-icon" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M3 9h18M9 9v12" />
                      </svg>
                    </span>
                    <span className="stx-panel-title">Preview</span>
                  </span>
                )}
                <span
                  className="stx-rows-badge"
                  title={capped ? 'Preview is capped for speed — export delivers all rows' : undefined}
                >
                  {capped
                    ? `${shown.toLocaleString()} of ${count.toLocaleString()} rows`
                    : `${shown.toLocaleString()} rows`}
                </span>
              </div>
              <div className="stx-table-scroll">
                <table className="stx-data">
                  <thead>
                    <tr>
                      {activeTable.columns.map((c) => (
                        <th key={c}>
                          <span className="stx-th-name">{c}</span>
                          {colType(c) && <span className="stx-th-type">{colType(c)}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeTable.rows.map((row, i) => (
                      <tr key={i}>
                        {activeTable.columns.map((c) => {
                          const v = row[c];
                          if (v === null) return <td key={c} className="stx-null">NULL</td>;
                          const isNum = typeof v === 'number';
                          return (
                            <td key={c} className={isNum ? 'stx-num' : undefined} title={String(v)}>
                              {String(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="stx-export">
                <button className="stx-btn stx-btn-secondary stx-btn-sm" onClick={handleCopy}>
                  {copied ? 'Copied ✓' : 'Copy JSON'}
                </button>
                <span className="stx-export-note">Export {count.toLocaleString()} rows</span>
                <button
                  className="stx-btn stx-btn-secondary stx-btn-sm"
                  onClick={() => handleExport('csv')}
                  title={
                    preview.length > 1
                      ? `CSV exports the active table (${activeTable.name}). Use JSON or SQL for all tables.`
                      : undefined
                  }
                >
                  CSV
                </button>
                <button className="stx-btn stx-btn-secondary stx-btn-sm" onClick={() => handleExport('json')}>JSON</button>
                <button className="stx-btn stx-btn-primary stx-btn-sm" onClick={() => handleExport('sql')}>SQL</button>
              </div>
            </>
          ) : (
            <>
              <div className="stx-panel-head">
                <span className="stx-ph-title">
                  <span className="stx-ph-icon" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M3 9h18M9 9v12" />
                    </svg>
                  </span>
                  <span className="stx-panel-title">Preview</span>
                </span>
              </div>
              <div className="stx-empty stx-empty-lg">
                <div className="stx-empty-glyph" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M3 9h18M9 9v12" />
                  </svg>
                </div>
                {schema ? (
                  <>
                    <h3>Schema ready</h3>
                    <p>Your schema parsed cleanly. Generate rows to preview them here.</p>
                    <button className="stx-btn stx-btn-primary stx-btn-sm" onClick={handleGenerate} disabled={busy}>
                      {busy ? 'Generating…' : 'Generate rows'}
                    </button>
                  </>
                ) : (
                  <>
                    <h3>Nothing generated yet</h3>
                    <p>Paste SQL and hit <strong>Parse &amp; preview</strong>, or load the example to see realistic rows here.</p>
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Status bar */}
      {schema && (
        <footer className="stx-statusbar">
          <div className="stx-sb-group">
            {dialect && (
              <span className="stx-sb-item stx-sb-dialect">
                <span className="stx-sb-dot" aria-hidden="true"></span>
                {dialect}
              </span>
            )}
            <span className="stx-sb-sep" aria-hidden="true"></span>
            <span className="stx-sb-item"><strong>{schema.tables.length}</strong>&nbsp;tables</span>
            <span className="stx-sb-item"><strong>{totalCols}</strong>&nbsp;columns</span>
          </div>
          <div className="stx-sb-group stx-sb-right">
            <span className="stx-sb-item">seed&nbsp;<strong>{seed}</strong></span>
            <span className="stx-sb-item"><strong>{count.toLocaleString()}</strong>&nbsp;rows</span>
            <span className="stx-sb-repro" title="Same seed → identical data, every run">
              <span className="pulse" aria-hidden="true"></span>
              Deterministic
            </span>
          </div>
        </footer>
      )}
    </div>
  );
}
