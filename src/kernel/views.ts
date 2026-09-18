import { resourceNotFound } from "../errors/error.ts";
import type {
  JsonValue,
  SourceFilter,
  ViewDefinition,
  ViewPresentationDefinition,
  ViewQueryInput,
} from "../spec/model.ts";
import { FrameworkError } from "../errors/error.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { ExecutionContext, Workspace } from "./model.ts";
import type { SourceResult, SourceService } from "./sources.ts";

export interface ViewQueryResult {
  readonly view: ViewDefinition;
  readonly data: SourceResult;
  readonly presentation?: ViewPresentationDefinition;
}

/** Resolves portable View definitions without coupling them to a persistence adapter. */
export class ViewService {
  constructor(
    private readonly resolveWorkspace: (context: ExecutionContext) => Promise<Workspace>,
    private readonly sources: SourceService,
    private readonly assertContext: (context: ExecutionContext) => Promise<void>,
    private readonly authorize: (request: AuthorizationRequest) => Promise<void>,
  ) {}

  async list(context: ExecutionContext): Promise<readonly ViewDefinition[]> {
    const workspace = await this.workspace(context);
    await this.authorizeRead(context, "views.list");
    const sources = new Set((await this.sources.list(context)).map((source) => source.key));
    return structuredClone(workspace.spec.views.filter((view) => sources.has(view.source)));
  }

  async get(context: ExecutionContext, key: string): Promise<ViewDefinition | null> {
    const workspace = await this.workspace(context);
    const view = workspace.spec.views.find((item) => item.key === key);
    if (!view) return null;
    await this.authorizeRead(context, "views.read", view.id);
    return structuredClone(view);
  }

  async query(
    context: ExecutionContext,
    key: string,
    input: ViewQueryInput = {},
  ): Promise<ViewQueryResult> {
    const view = await this.get(context, key);
    if (!view) throw resourceNotFound("View", key);
    return this.preview(context, view, input);
  }

  async preview(
    context: ExecutionContext,
    view: ViewDefinition,
    input: ViewQueryInput = {},
  ): Promise<ViewQueryResult> {
    await this.workspace(context);
    await this.authorizeRead(context, "views.preview");
    const data = await this.sources.query(
      context,
      view.source,
      parameterizedQuery(view, input.parameters ?? {}),
    );
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
        kind: id === context.workspaceId ? "workspace" : "view",
        id,
        workspaceId: context.workspaceId,
      },
    });
  }
}

function parameterizedQuery(view: ViewDefinition, values: Readonly<Record<string, JsonValue>>) {
  const declared = new Map((view.parameters ?? []).map((parameter) => [parameter.key, parameter]));
  for (const key of Object.keys(values)) {
    if (!declared.has(key)) throw invalidParameters(`View parameter "${key}" is not declared.`);
  }
  const filters: SourceFilter[] = [];
  for (const parameter of view.parameters ?? []) {
    if (!(parameter.key in values)) {
      if (parameter.required)
        throw invalidParameters(`View parameter "${parameter.key}" is required.`);
      continue;
    }
    filters.push({
      path: parameter.path,
      operator: parameter.operator ?? "eq",
      ...(values[parameter.key] === undefined ? {} : { value: values[parameter.key] }),
    });
  }
  if (!filters.length) return view.query;
  const stored = view.query?.filter;
  const filter: SourceFilter = stored
    ? { all: [stored, ...filters] }
    : filters.length === 1
      ? filters[0]!
      : { all: filters };
  return { ...view.query, filter };
}

function invalidParameters(message: string): FrameworkError {
  return new FrameworkError({ code: "VALIDATION.INVALID_INPUT", message });
}
