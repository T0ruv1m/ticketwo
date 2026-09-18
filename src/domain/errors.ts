export type DomainErrorCode =
  | "invalid-project"
  | "invalid-volumes"
  | "duplicate-group"
  | "duplicate-group-mismatch"
  | "group-not-found"
  | "ticket-not-found"
  | "invalid-target"
  | "out-of-bounds"
  | "collision"
  | "full-page-on-grid"
  | "invalid-idempotency-key"
  | "batch-not-found"
  | "render-failed"
  | "render-timeout";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
