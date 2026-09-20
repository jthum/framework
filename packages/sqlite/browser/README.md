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
