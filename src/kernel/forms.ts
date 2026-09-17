import { ERROR_CODES, FrameworkError, resourceNotFound } from "../errors/error.ts";
import type { CatalogRepository } from "../persistence/catalog.ts";
import type { CollectionRecord, RecordValues } from "../persistence/records.ts";
import type {
  CollectionFormDefinition,
  CollectionDefinition,
  FormDefinition,
  StandaloneFormDefinition,
} from "../spec/model.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { ExecutionContext } from "./model.ts";
import { prepareCreateValues } from "./record-values.ts";

export interface SubmitFormInput {
  readonly values: RecordValues;
  /** Required only by edit Forms. */
  readonly recordId?: string;
}

export type FormSubmission =
  | {
      readonly mode: "create" | "edit";
      readonly form: CollectionFormDefinition;
      readonly record: CollectionRecord;
    }
  | {
      readonly mode: "standalone";
      readonly form: StandaloneFormDefinition;
      readonly values: RecordValues;
    };

interface FormMutations {
  create(
    context: ExecutionContext,
    collectionKey: string,
    values: RecordValues,
  ): Promise<CollectionRecord>;
  update(
    context: ExecutionContext,
    collectionKey: string,
    recordId: string,
    values: RecordValues,
  ): Promise<CollectionRecord>;
  assertReferences(
    context: ExecutionContext,
    collection: CollectionDefinition,
    values: RecordValues,
  ): Promise<void>;
}

/** Executes Form intake while record mutation remains on the Kernel CRUD spine. */
export class FormService {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly mutations: FormMutations,
    private readonly assertContext: (context: ExecutionContext) => Promise<void>,
    private readonly authorize: (request: AuthorizationRequest) => Promise<void>,
  ) {}

  async list(context: ExecutionContext): Promise<readonly FormDefinition[]> {
    const workspace = await this.workspace(context);
    await this.authorizeRead(context, "forms.list");
    return structuredClone(workspace.spec.forms);
  }

  async get(context: ExecutionContext, key: string): Promise<FormDefinition | null> {
    const workspace = await this.workspace(context);
    const form = workspace.spec.forms.find((candidate) => candidate.key === key);
    if (!form) return null;
    await this.authorizeRead(context, "forms.read", form.id);
    return structuredClone(form);
  }

  async submit(
    context: ExecutionContext,
    key: string,
    input: SubmitFormInput,
  ): Promise<FormSubmission> {
    const workspace = await this.workspace(context);
    const form = workspace.spec.forms.find((candidate) => candidate.key === key);
    if (!form) throw resourceNotFound("Form", key);
    await this.authorizeRead(context, "forms.submit", form.id);
    if (form.mode === "standalone") {
      const collection = standaloneCollection(form);
      const values = prepareCreateValues(collection, input.values);
      await this.mutations.assertReferences(context, collection, values);
      return { mode: "standalone", form: structuredClone(form), values };
    }
    const collection = workspace.spec.collections.find(
      (candidate) => candidate.id === form.collectionId,
    );
    if (!collection) throw resourceNotFound("Collection", form.collectionId);
    assertExposedValues(form, collection, input.values);
    if (form.mode === "create") {
      const record = await this.mutations.create(context, collection.key, input.values);
      return { mode: "create", form: structuredClone(form), record };
    }
    if (!input.recordId) {
      throw new FrameworkError({
        code: ERROR_CODES.validationInvalidInput,
        message: "An edit Form requires a record ID.",
        issues: [
          {
            path: "recordId",
            code: "VALIDATION.REQUIRED",
            message: "Choose the record this Form should edit.",
          },
        ],
      });
    }
    const record = await this.mutations.update(
      context,
      collection.key,
      input.recordId,
      input.values,
    );
    return { mode: "edit", form: structuredClone(form), record };
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
        kind: id === context.workspaceId ? "workspace" : "form",
        id,
        workspaceId: context.workspaceId,
      },
    });
  }
}

function standaloneCollection(form: StandaloneFormDefinition): CollectionDefinition {
  return {
    id: form.id,
    key: form.key,
    label: form.label,
    ...(form.description === undefined ? {} : { description: form.description }),
    fields: form.fields,
  };
}

function assertExposedValues(
  form: CollectionFormDefinition,
  collection: CollectionDefinition,
  values: RecordValues,
): void {
  const allowed = new Set(
    collection.fields.filter((field) => form.fieldIds.includes(field.id)).map((field) => field.key),
  );
  const key = Object.keys(values).find((candidate) => !allowed.has(candidate));
  if (!key) return;
  throw new FrameworkError({
    code: ERROR_CODES.validationInvalidInput,
    message: "Some Form values need attention.",
    issues: [
      {
        path: `values.${key}`,
        code: "VALIDATION.FIELD_UNEXPOSED",
        message: `${key} is not exposed by ${form.label}.`,
      },
    ],
  });
}
