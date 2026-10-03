# Framework browser SQLite

Optional browser SQLite storage for Framework. It runs `wa-sqlite` in a worker, prefers OPFS,
falls back to IndexedDB when OPFS is unavailable, and finally uses memory when neither persistent
browser store is available.

```ts
import { createBrowserSqlitePool } from "@jthum/framework-sqlite-browser";

const pool = await createBrowserSqlitePool({ namespace: "my-app" });
const catalog = await pool.open("catalog.db");
```

The package implements Framework's `SqliteDatabase` contract. Database routing and names remain
host policy and are passed to `SqlitePersistenceAdapter` in the usual way.

Every database connection enables foreign-key enforcement, including connections reopened after
OPFS capacity growth. A worker crash or failed initialization closes the pool and rejects pending
and subsequent requests; the host must create a new pool rather than reuse an uncertain worker.

## Linked source development

When a Vite host links a separate Framework checkout and consumes its development source exports,
allow that checkout in Vite's `server.fs.allow`. Worker modules are fetched directly by the browser,
so permitting only the host repository is insufficient. Installed or Git-pinned packages live under
the host's `node_modules` and do not need this additional local-development allowance.
