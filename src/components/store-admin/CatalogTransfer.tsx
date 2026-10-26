'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface CategoryOption {
  id: string;
  name: string;
}

interface ImportError {
  rowNumber: number;
  column: string;
  message: string;
}

interface ImportResponse {
  importId: string;
  dryRun: boolean;
  status: 'validated' | 'imported' | 'rejected';
  total: number;
  created: number;
  updated: number;
  failed: number;
  errorCount: number;
  errors: ImportError[];
  errorReportUrl: string;
}

interface Props {
  categories: CategoryOption[];
  canEdit: boolean;
}

const STATUS_LABEL: Record<ImportResponse['status'], string> = {
  validated: 'Validated — nothing written',
  imported: 'Imported',
  rejected: 'Rejected — nothing written',
};

/**
 * Bulk catalogue import and export.
 *
 * A dry run validates every row and writes only the report. Commit applies the
 * file in one transaction: if a single row fails, the whole file is refused,
 * so the catalogue never ends up half-imported.
 */
export function CatalogTransfer({ categories, canEdit }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('catalog.csv');
  const [busy, setBusy] = useState<'dry' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');

  async function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(null);
    setResult(null);
    if (!file) {
      setCsv('');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError('The file must be 12 MB or smaller.');
      setCsv('');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    try {
      const text = await file.text();
      setCsv(text);
      setFilename(file.name || 'catalog.csv');
    } catch {
      setError('Could not read that file. Save it as CSV and try again.');
    }
  }

  async function run(dryRun: boolean) {
    if (!csv.trim()) {
      setError('Choose a CSV file or paste its text first.');
      return;
    }
    if (!dryRun) {
      const confirmed = window.confirm(
        `Import ${filename}? Every valid row is written together; if any row ` +
          'fails validation the whole file is refused.',
      );
      if (!confirmed) return;
    }

    setBusy(dryRun ? 'dry' : 'commit');
    setError(null);
    setResult(null);
    try {
      const response = await fetch('/api/store-admin/catalog/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv, filename, dryRun }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not run the import.');
      }
      setResult(body as ImportResponse);
      if (body.status === 'imported') router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not run the import.');
    } finally {
      setBusy(null);
    }
  }

  function exportUrl(): string {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (status !== 'all') params.set('status', status);
    if (query.trim()) params.set('q', query.trim());
    const tail = params.toString();
    return `/api/store-admin/catalog/export${tail ? `?${tail}` : ''}`;
  }

  return (
    <>
      {error ? (
        <p className="sa-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sa-transfer-grid">
        <section className="sa-detail-card">
          <h2 className="sa-card-title">Import</h2>
          <p className="sa-page-sub">
            Up to 5,000 rows per file. Set <code>product_id</code> to update an
            existing product; leave it blank to create one. Image URLs are
            separated by <code>|</code>.
          </p>

          <div className="sa-control-grid">
            <label className="sa-field sa-field-wide">
              <span className="sa-label">CSV file</span>
              <input
                ref={fileRef}
                className="sa-input"
                type="file"
                accept=".csv,text/csv"
                onChange={pickFile}
                disabled={!canEdit}
              />
              <span className="sa-hint">
                <a href="/api/store-admin/catalog/import" download>
                  Download the template
                </a>{' '}
                for the exact columns.
              </span>
            </label>
            <label className="sa-field sa-field-wide">
              <span className="sa-label">
                Or paste the rows <span className="sa-hint">header row included</span>
              </span>
              <textarea
                className="sa-input sa-mono"
                rows={6}
                value={csv}
                onChange={(event) => {
                  setCsv(event.target.value);
                  setResult(null);
                }}
                placeholder="product_id,name,slug,brand,category,condition,description,price,…"
                disabled={!canEdit}
              />
            </label>
          </div>

          <div className="sa-inline-actions">
            <button
              type="button"
              className="sa-btn"
              disabled={!canEdit || busy !== null}
              onClick={() => run(true)}
            >
              {busy === 'dry' ? 'Validating…' : 'Validate (dry run)'}
            </button>
            <button
              type="button"
              className="sa-btn sa-btn-primary"
              disabled={!canEdit || busy !== null}
              onClick={() => run(false)}
            >
              {busy === 'commit' ? 'Importing…' : 'Import now'}
            </button>
          </div>

          {!canEdit ? (
            <p className="sa-lock-note">Only an owner or admin can import products.</p>
          ) : null}
        </section>

        <section className="sa-detail-card">
          <h2 className="sa-card-title">Export</h2>
          <p className="sa-page-sub">
            Download the catalogue in the same columns the importer accepts —
            edit in a spreadsheet, then import the file back.
          </p>

          <div className="sa-control-grid">
            <label className="sa-field">
              <span className="sa-label">Category</span>
              <select
                className="sa-input"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="sa-field">
              <span className="sa-label">Status</span>
              <select
                className="sa-input"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">All products</option>
                <option value="active">Active only</option>
                <option value="inactive">Hidden only</option>
              </select>
            </label>
            <label className="sa-field sa-field-wide">
              <span className="sa-label">Search</span>
              <input
                className="sa-input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name or slug"
              />
            </label>
          </div>

          <div className="sa-inline-actions">
            <a className="sa-btn sa-btn-primary" href={exportUrl()} download>
              Download catalogue CSV
            </a>
          </div>

          <h3 className="sa-control-title">Stock reports</h3>
          <div className="sa-inline-actions">
            <a className="sa-btn sa-btn-small" href="/api/store-admin/stock/export?scope=low" download>
              Low stock CSV
            </a>
            <a className="sa-btn sa-btn-small" href="/api/store-admin/stock/export?scope=all" download>
              All stock levels CSV
            </a>
          </div>
        </section>
      </div>

      {result ? (
        <section className="sa-detail-card sa-import-result">
          <h2 className="sa-card-title">
            {result.dryRun ? 'Dry run result' : 'Import result'}
          </h2>
          <p className={`sa-notice${result.status === 'rejected' ? ' sa-error' : ' sa-success'}`}>
            {STATUS_LABEL[result.status]}
          </p>

          <div className="sa-stat-grid">
            <div className="sa-stat">
              <div className="sa-stat-top">
                <span className="sa-stat-label">Rows</span>
              </div>
              <p className="sa-stat-value">{result.total}</p>
            </div>
            <div className="sa-stat">
              <div className="sa-stat-top">
                <span className="sa-stat-label">New products</span>
              </div>
              <p className="sa-stat-value">{result.created}</p>
            </div>
            <div className="sa-stat">
              <div className="sa-stat-top">
                <span className="sa-stat-label">Updates</span>
              </div>
              <p className="sa-stat-value">{result.updated}</p>
            </div>
            <div className="sa-stat">
              <div className="sa-stat-top">
                <span className="sa-stat-label">Rows with errors</span>
              </div>
              <p className="sa-stat-value">{result.failed}</p>
            </div>
          </div>

          {result.errors.length > 0 ? (
            <>
              <div className="sa-inline-actions">
                <a className="sa-btn sa-btn-small" href={result.errorReportUrl} download>
                  Download the error report
                </a>
                <span className="sa-hint">
                  {result.errorCount > result.errors.length
                    ? `Showing the first ${result.errors.length} of ${result.errorCount} errors.`
                    : `${result.errorCount} ${result.errorCount === 1 ? 'error' : 'errors'}.`}
                </span>
              </div>
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th className="sa-num">Row</th>
                      <th>Column</th>
                      <th>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((item, index) => (
                      <tr key={`${item.rowNumber}-${item.column}-${index}`}>
                        <td className="sa-num">{item.rowNumber}</td>
                        <td className="sa-mono">{item.column || '—'}</td>
                        <td>{item.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="sa-success">Every row passed validation.</p>
          )}
        </section>
      ) : null}
    </>
  );
}
