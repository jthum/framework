import { toast } from "svelte-sonner";

import { ERROR_CODES, FrameworkError } from "../../errors/error.ts";

export interface PresentedError {
  readonly message: string;
  readonly code: string;
  readonly errorId?: string;
}

export function presentError(error: unknown, fallback: string): PresentedError {
  if (error instanceof FrameworkError)
    return {
      message: error.message,
      code: error.code,
      ...(error.errorId ? { errorId: error.errorId } : {}),
    };
  const errorId = crypto.randomUUID();
  console.error(`Unexpected Framework UI error ${errorId}`, error);
  return { message: fallback, code: ERROR_CODES.internalUnexpected, errorId };
}

export function toastError(error: unknown, fallback: string): void {
  const presented = presentError(error, fallback);
  toast.error(presented.message, {
    description: `${presented.code}${presented.errorId ? ` · ${presented.errorId}` : ""}`,
  });
}
