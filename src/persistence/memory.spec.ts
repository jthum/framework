import { catalogAdapterContract } from "./catalog.contract.ts";
import { MemoryPersistenceAdapter } from "./memory.ts";
import { recordStoreContract } from "./records.contract.ts";

catalogAdapterContract("Memory", () => new MemoryPersistenceAdapter());
recordStoreContract("Memory", () => new MemoryPersistenceAdapter());
