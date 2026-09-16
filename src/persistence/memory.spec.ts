import { catalogAdapterContract } from "./catalog.contract.ts";
import { MemoryPersistenceAdapter } from "./memory.ts";

catalogAdapterContract("Memory", () => new MemoryPersistenceAdapter());
