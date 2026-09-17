import { resourceNotFound } from "../errors/error.ts";
import type { CatalogRepository } from "../persistence/catalog.ts";
import type { PageDefinition } from "../spec/model.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { ExecutionContext } from "./model.ts";

/** Reads portable Page layout without taking responsibility for host rendering. */
export class PageService {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly assertContext: (context: ExecutionContext) => Promise<void>,
    private readonly authorize: (request: AuthorizationRequest) => Promise<void>,
  ) {}

  async list(context: ExecutionContext): Promise<readonly PageDefinition[]> {
    const workspace = await this.workspace(context);
    await this.authorizeRead(context, "pages.list");
    return structuredClone(workspace.spec.pages);
  }

  async get(context: ExecutionContext, key: string): Promise<PageDefinition | null> {
    const workspace = await this.workspace(context);
    const page = workspace.spec.pages.find((candidate) => candidate.key === key);
    if (!page) return null;
    await this.authorizeRead(context, "pages.read", page.id);
    return structuredClone(page);
  }

  private async workspace(context: ExecutionContext) {
    await this.assertContext(context);
    const workspace = await this.catalog.getWorkspace(context.workspaceId);
    if (!workspace) throw resourceNotFound("Workspace", context.workspaceId);
    return workspace;
  }

  private async authorizeRead(
    context: ExecutionContext,
    operation: string,
    id = context.workspaceId,
  ): Promise<void> {
    await this.authorize({
      context,
      operation,
      resource: {
        kind: id === context.workspaceId ? "workspace" : "page",
        id,
        workspaceId: context.workspaceId,
      },
    });
  }
}
