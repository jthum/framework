import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createBrowserSqlitePool } from "./pool.ts";

describe("browser SQLite pool", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects invalid namespaces before touching browser APIs", async () => {
    await expect(createBrowserSqlitePool({ namespace: " / " })).rejects.toThrow(
      "must contain a letter or number",
    );
  });

  it("presents the worker as exclusive Framework SQLite databases", async () => {
    const messages: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "Worker",
      class {
        private readonly listeners = new Map<string, (event: { data: unknown }) => void>();

        addEventListener(name: string, listener: (event: { data: unknown }) => void): void {
          this.listeners.set(name, listener);
        }

        postMessage(message: Record<string, unknown>): void {
          messages.push(message);
          const result =
            message.method === "init"
              ? { backend: "memory" }
              : message.method === "all"
                ? [{ value: 7 }]
                : true;
          queueMicrotask(() =>
            this.listeners.get("message")?.({ data: { id: message.id, result } }),
          );
        }

        terminate(): void {}
      },
    );

    const pool = await createBrowserSqlitePool({ namespace: "test-host" });
    const database = await pool.open("catalog.db");

    await expect(pool.open("catalog.db")).rejects.toThrow("already has an active connection");
    await expect(database.get<{ value: number }>("SELECT 7 AS value")).resolves.toEqual({
      value: 7,
    });
    await expect(
      database.transaction(async (connection) => {
        await connection.run("INSERT INTO sample VALUES (?)", [7]);
        return "done";
      }),
    ).resolves.toBe("done");

    expect(messages.map((message) => message.method)).toEqual([
      "init",
      "open",
      "all",
      "execute",
      "run",
      "execute",
    ]);

    await database.close();
    const reopened = await pool.open("catalog.db");
    await reopened.close();
    await pool.close();
  });
});
