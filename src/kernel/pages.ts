import type { PageDefinition } from "../spec/model.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { ExecutionContext, Workspace } from "./model.ts";

/** Reads portable Page layout without taking responsibility for host rendering. */
export class PageService {
  constructor(
    private readonly resolveWorkspace: (context: ExecutionContext) => Promise<Workspace>,
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
    return this.resolveWorkspace(context);
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
