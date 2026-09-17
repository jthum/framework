import type { FormSubmission, SubmitFormInput } from "../kernel/forms.ts";
import type { Kernel } from "../kernel/kernel.ts";
import type { ExecutionContext, Workspace } from "../kernel/model.ts";
import type { SourceDescriptor, SourceResult, SourceRow } from "../kernel/sources.ts";
import type { ViewQueryResult } from "../kernel/views.ts";
import type { CollectionRecord, RecordValues } from "../persistence/records.ts";
import { resourceNotFound } from "../errors/error.ts";
import type {
  FormDefinition,
  PageDefinition,
  SourceQueryDefinition,
  Spec,
  ViewDefinition,
} from "../spec/model.ts";

/**
 * Context-bound operations consumed by interface code.
 *
 * A browser host can bind this directly to an in-process Kernel. A server or remote host can
 * implement the same contract over its transport without exposing Kernel lifecycle to the UI.
 */
export interface WorkspaceClient {
  getWorkspace(): Promise<Workspace>;
  applySpec(spec: Spec): Promise<Workspace>;

  createRecord(collectionKey: string, values: RecordValues): Promise<CollectionRecord>;
  getRecord(collectionKey: string, recordId: string): Promise<CollectionRecord | null>;
  listRecords(collectionKey: string): Promise<CollectionRecord[]>;
  updateRecord(
    collectionKey: string,
    recordId: string,
    values: RecordValues,
  ): Promise<CollectionRecord>;
  deleteRecord(collectionKey: string, recordId: string): Promise<void>;

  listSources(): Promise<SourceDescriptor[]>;
  getSource(key: string): Promise<SourceDescriptor | null>;
  querySource(key: string, query?: SourceQueryDefinition): Promise<SourceResult>;
  getSourceRecord(key: string, id: string): Promise<SourceRow | null>;

  listViews(): Promise<readonly ViewDefinition[]>;
  getView(key: string): Promise<ViewDefinition | null>;
  queryView(key: string): Promise<ViewQueryResult>;

  listForms(): Promise<readonly FormDefinition[]>;
  getForm(key: string): Promise<FormDefinition | null>;
  submitForm(key: string, input: SubmitFormInput): Promise<FormSubmission>;

  listPages(): Promise<readonly PageDefinition[]>;
  getPage(key: string): Promise<PageDefinition | null>;
}

/** Binds one validated execution context without taking ownership of the Kernel. */
export async function createWorkspaceClient(
  kernel: Kernel,
  context: ExecutionContext,
): Promise<WorkspaceClient> {
  const resolved = await kernel.resolveContext(context);
  return new LocalWorkspaceClient(kernel, resolved);
}

class LocalWorkspaceClient implements WorkspaceClient {
  constructor(
    private readonly kernel: Kernel,
    private readonly context: ExecutionContext,
  ) {}

  async getWorkspace(): Promise<Workspace> {
    const workspace = await this.kernel.getWorkspace(this.context);
    if (!workspace) throw resourceNotFound("Workspace", this.context.workspaceId);
    return workspace;
  }

  applySpec(spec: Spec): Promise<Workspace> {
    return this.kernel.applySpec(this.context, spec);
  }

  createRecord(collectionKey: string, values: RecordValues): Promise<CollectionRecord> {
    return this.kernel.createRecord(this.context, collectionKey, values);
  }

  getRecord(collectionKey: string, recordId: string): Promise<CollectionRecord | null> {
    return this.kernel.getRecord(this.context, collectionKey, recordId);
  }

  listRecords(collectionKey: string): Promise<CollectionRecord[]> {
    return this.kernel.listRecords(this.context, collectionKey);
  }

  updateRecord(
    collectionKey: string,
    recordId: string,
    values: RecordValues,
  ): Promise<CollectionRecord> {
    return this.kernel.updateRecord(this.context, collectionKey, recordId, values);
  }

  deleteRecord(collectionKey: string, recordId: string): Promise<void> {
    return this.kernel.deleteRecord(this.context, collectionKey, recordId);
  }

  listSources(): Promise<SourceDescriptor[]> {
    return this.kernel.listSources(this.context);
  }

  getSource(key: string): Promise<SourceDescriptor | null> {
    return this.kernel.getSource(this.context, key);
  }

  querySource(key: string, query?: SourceQueryDefinition): Promise<SourceResult> {
    return this.kernel.querySource(this.context, key, query);
  }

  getSourceRecord(key: string, id: string): Promise<SourceRow | null> {
    return this.kernel.getSourceRecord(this.context, key, id);
  }

  listViews(): Promise<readonly ViewDefinition[]> {
    return this.kernel.listViews(this.context);
  }

  getView(key: string): Promise<ViewDefinition | null> {
    return this.kernel.getView(this.context, key);
  }

  queryView(key: string): Promise<ViewQueryResult> {
    return this.kernel.queryView(this.context, key);
  }

  listForms(): Promise<readonly FormDefinition[]> {
    return this.kernel.listForms(this.context);
  }

  getForm(key: string): Promise<FormDefinition | null> {
    return this.kernel.getForm(this.context, key);
  }

  submitForm(key: string, input: SubmitFormInput): Promise<FormSubmission> {
    return this.kernel.submitForm(this.context, key, input);
  }

  listPages(): Promise<readonly PageDefinition[]> {
    return this.kernel.listPages(this.context);
  }

  getPage(key: string): Promise<PageDefinition | null> {
    return this.kernel.getPage(this.context, key);
  }
}
