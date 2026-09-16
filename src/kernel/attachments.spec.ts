import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import { SqlitePersistenceAdapter } from "../sqlite/catalog.ts";
import { openNodeSqlite } from "../sqlite/node.ts";
import { attachmentContract } from "./attachments.contract.ts";

attachmentContract("Memory", () => new MemoryPersistenceAdapter());
attachmentContract("SQLite", () => new SqlitePersistenceAdapter(() => openNodeSqlite()));
