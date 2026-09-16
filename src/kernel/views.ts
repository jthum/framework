import { resourceNotFound } from "../errors/error.ts";
import type { CatalogRepository } from "../persistence/catalog.ts";
import type { ViewDefinition, ViewPresentationDefinition } from "../spec/model.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { ExecutionContext } from "./model.ts";
import type { SourceResult, SourceService } from "./sources.ts";

export interface ViewResult {
  readonly view: ViewDefinition;
  readonly data: SourceResult;
  readonly presentation?: ViewPresentationDefinition;
}

/** Resolves portable View definitions without coupling them to a persistence adapter. */
export class ViewService {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly sources: SourceService,
    private readonly assertContext: (context: ExecutionContext) => Promise<void>,
    private readonly authorize: (request: AuthorizationRequest) => Promise<void>,
  ) {}

  async list(context: ExecutionContext): Promise<readonly ViewDefinition[]> {
    const workspace = await this.workspace(context);
    await this.authorizeRead(context, "views.list");
    return structuredClone(workspace.spec.views);
  }

  async get(context: ExecutionContext, key: string): Promise<ViewDefinition | null> {
    const workspace = await this.workspace(context);
    const view = workspace.spec.views.find((item) => item.key === key);
    if (!view) return null;
    await this.authorizeRead(context, "views.read", view.id);
    return structuredClone(view);
  }

  async query(context: ExecutionContext, key: string): Promise<ViewResult> {
    const view = await this.get(context, key);
    if (!view) throw resourceNotFound("View", key);
    const data = await this.sources.query(context, view.source, view.query);
    return {
      view,
      data,
      ...(view.presentation === undefined
        ? {}
        : { presentation: structuredClone(view.presentation) }),
    };
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
        kind: id === context.workspaceId ? "workspace" : "view",
        id,
        workspaceId: context.workspaceId,
      },
    });
  }
}
