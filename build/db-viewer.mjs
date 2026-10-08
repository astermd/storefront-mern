// Dev-only tool: a tiny local web UI for browsing the SQLite database this
// port writes to (`storage/database/app.sqlite3` by default), without a GUI
// app or a `sqlite3` CLI session. Run with `npm run db:view`, then open the
// URL it prints. Never started automatically alongside the app itself —
// this is a convenience for a developer looking something up, not a runtime
// dependency.
import Database from 'better-sqlite3';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.DB_VIEWER_PORT ?? 5959);

// Matches `connection-factory.ts`'s own default resolution for a local sqlite file.
const dbPath = process.env.DB_VIEWER_PATH ?? join(root, '..', 'storage', 'database', 'app.sqlite3');

if (!existsSync(dbPath)) {
  console.error(`db:view: no sqlite file at ${dbPath} — run \`npm run console -- db:migrate\` first, or set DB_VIEWER_PATH.`);
  process.exit(1);
}

const STYLE = `
<style>
body { font-family: -apple-system, sans-serif; margin: 0; background: #f5f6fa; }
header { background: #1a2b4a; color: white; padding: 16px 24px; font-size: 20px; }
nav { background: #fff; padding: 10px 24px; border-bottom: 1px solid #ddd; }
nav a { margin-right: 16px; text-decoration: none; color: #1a2b4a; font-weight: 600; padding: 6px 10px; border-radius: 4px; }
nav a.active, nav a:hover { background: #e8ecf7; }
main { padding: 20px 24px; }
table { border-collapse: collapse; width: 100%; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
th, td { border: 1px solid #e0e0e0; padding: 8px 10px; text-align: left; font-size: 13px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
th { background: #1a2b4a; color: white; position: sticky; top: 0; }
tr:nth-child(even) { background: #fafbfc; }
td:hover { white-space: normal; word-break: break-all; }
.count { color: #666; font-size: 13px; margin-bottom: 10px; }
</style>`;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function tables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name")
    .all()
    .map((r) => r.name);
}

function render(db, requested) {
  const names = tables(db);
  const table = names.includes(requested) ? requested : names[0];

  const nav = names.map((t) => `<a href="/?table=${encodeURIComponent(t)}" class="${t === table ? 'active' : ''}">${escapeHtml(t)}</a>`).join('');

  let body = '<p>No tables found.</p>';
  if (table) {
    const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT 200`).all();
    const count = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;

    if (rows.length > 0) {
      const cols = Object.keys(rows[0]);
      const thead = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
      const trs = rows
        .map((row) => {
          const tds = cols
            .map((c) => {
              const value = row[c];
              return value === null ? '<td><i>null</i></td>' : `<td title="${escapeHtml(value)}">${escapeHtml(value)}</td>`;
            })
            .join('');
          return `<tr>${tds}</tr>`;
        })
        .join('');
      body = `<div class="count">${count} rows total, showing latest 200</div><table><thead><tr>${thead}</tr></thead><tbody>${trs}</tbody></table>`;
    } else {
      body = '<p>No rows.</p>';
    }
  }

  return `<!DOCTYPE html><html><head><title>Storefront DB Viewer</title>${STYLE}</head><body>
<header>Storefront MERN — Database Viewer</header>
<nav>${nav}</nav>
<main>${body}</main>
</body></html>`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const db = new Database(dbPath, { readonly: true });
  try {
    const html = render(db, url.searchParams.get('table') ?? '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } finally {
    db.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`db:view — open http://localhost:${PORT}/`);
});
