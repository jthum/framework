import type { WorkspaceClient } from "@jthum/framework/client";
import type { PageDefinition, Spec } from "@jthum/framework/spec";

export interface PageAuthoringOptions {
  /** Select the Pages managed by one list while retaining all other canonical Pages. */
  readonly include?: (page: PageDefinition) => boolean;
  readonly onChange?: (spec: Spec) => void | Promise<void>;
}

export interface PageActions {
  save(page: PageDefinition): Promise<PageDefinition>;
  remove(key: string): Promise<void>;
  replace(pages: readonly PageDefinition[]): Promise<void>;
}

/** Bind Page list and editor mutations to one context-bound Workspace client. */
export function createPageActions(
  client: WorkspaceClient,
  options: PageAuthoringOptions = {},
): PageActions {
  const include = options.include ?? (() => true);
  return {
    save: async (page) => {
      const workspace = await client.getWorkspace();
      const previous = workspace.spec.pages.find((candidate) => candidate.key === page.key);
      const definition = { ...structuredClone(page), id: previous?.id ?? page.id };
      const updated = await client.applySpec({
        ...workspace.spec,
        pages: previous
          ? workspace.spec.pages.map((candidate) =>
              candidate.id === previous.id ? definition : candidate,
            )
          : [...workspace.spec.pages, definition],
      });
      await options.onChange?.(updated.spec);
      return definition;
    },
    remove: async (key) => {
      const workspace = await client.getWorkspace();
      const updated = await client.applySpec({
        ...workspace.spec,
        pages: workspace.spec.pages.filter((page) => page.key !== key),
      });
      await options.onChange?.(updated.spec);
    },
    replace: async (pages) => {
      const workspace = await client.getWorkspace();
      const retained = workspace.spec.pages.filter((page) => !include(page));
      const updated = await client.applySpec({
        ...workspace.spec,
        pages: [...retained, ...structuredClone(pages)],
      });
      await options.onChange?.(updated.spec);
    },
  };
}
