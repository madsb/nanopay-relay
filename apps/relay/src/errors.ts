import { ZodError } from "zod";

export type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details: unknown | null;
  };
};

export class HttpError extends Error {
  statusCode: number;
  code: string;
  details: unknown | null;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details ?? null;
  }
}

export const errorResponse = (
  code: string,
  message: string,
  details?: unknown
): ErrorResponse => ({
  error: {
    code,
    message,
    details: details ?? null
  }
});

export const toErrorResponse = (err: unknown): HttpError | null => {
  if (err instanceof HttpError) return err;
  if (err instanceof ZodError) {
    return new HttpError(400, "validation_error", "Invalid request", err.flatten());
  }
  return null;
};
