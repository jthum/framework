import type { JsonValue } from "../spec/model.ts";
import { nanoid } from "nanoid";

export const ERROR_CODES = {
  actionUnknown: "ACTION.UNKNOWN",
  specUnsupportedVersion: "SPEC.UNSUPPORTED_VERSION",
  specBindingRequired: "SPEC.BINDING_REQUIRED",
  permissionRunAsDenied: "PERMISSION.RUN_AS_DENIED",
  ruleWaitUnsupported: "RULE.WAIT_UNSUPPORTED",
  ruleCheckpointLimit: "RULE.CHECKPOINT_LIMIT",
  inferenceCancelled: "INFERENCE.CANCELLED",
  inferenceInvalidStream: "INFERENCE.INVALID_STREAM",
  inferenceProviderError: "INFERENCE.PROVIDER_ERROR",
  inferenceStepLimit: "INFERENCE.STEP_LIMIT",
  environmentCapabilityUnavailable: "ENVIRONMENT.CAPABILITY_UNAVAILABLE",
  internalUnexpected: "INTERNAL.UNEXPECTED",
  inferenceRefused: "INFERENCE.REFUSED",
  permissionDenied: "PERMISSION.DENIED",
  persistenceUnsupported: "PERSISTENCE.UNSUPPORTED",
  resourceConflict: "RESOURCE.CONFLICT",
  resourceNotFound: "RESOURCE.NOT_FOUND",
  specInvalid: "SPEC.INVALID",
  sourceCapabilityUnsupported: "SOURCE.CAPABILITY_UNSUPPORTED",
  validationInvalidInput: "VALIDATION.INVALID_INPUT",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES] | (string & {});

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ErrorEnvelope {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, JsonValue>>;
  readonly issues?: readonly ValidationIssue[];
  readonly retryable?: boolean;
  readonly errorId?: string;
}

export class FrameworkError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, JsonValue>> | undefined;
  readonly issues: readonly ValidationIssue[] | undefined;
  readonly retryable: boolean | undefined;
  readonly errorId: string | undefined;

  constructor(envelope: ErrorEnvelope, options?: ErrorOptions) {
    super(envelope.message, options);
    this.name = "FrameworkError";
    this.code = envelope.code;
    this.details = envelope.details;
    this.issues = envelope.issues;
    this.retryable = envelope.retryable;
    this.errorId = envelope.errorId;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.issues === undefined ? {} : { issues: this.issues }),
      ...(this.retryable === undefined ? {} : { retryable: this.retryable }),
      ...(this.errorId === undefined ? {} : { errorId: this.errorId }),
    };
  }
}

export function resourceNotFound(kind: string, id: string | number): FrameworkError {
  return new FrameworkError({
    code: ERROR_CODES.resourceNotFound,
    message: `${kind} was not found.`,
    details: { kind, id },
  });
}

/** Expected faults retain their code; unexpected details stay in the protected cause only. */
export function asFrameworkError(error: unknown): FrameworkError {
  if (error instanceof FrameworkError) return error;
  return new FrameworkError(
    {
      code: ERROR_CODES.internalUnexpected,
      message: "Something went wrong. Please try again.",
      errorId: nanoid(16),
    },
    { cause: error },
  );
}

export async function protectOperation<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw asFrameworkError(error);
  }
}

export function resourceConflict(message: string): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.resourceConflict, message });
}

export function invalidInput(message: string, issues?: readonly ValidationIssue[]): FrameworkError {
  return new FrameworkError({
    code: ERROR_CODES.validationInvalidInput,
    message,
    ...(issues?.length ? { issues } : {}),
  });
}
