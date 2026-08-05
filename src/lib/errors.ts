export class AppError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    options: {
      retryable?: boolean;
      cause?: unknown;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
