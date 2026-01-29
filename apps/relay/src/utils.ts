import { HttpError } from "./errors.js";
import { LIMITS } from "./constants.js";

export const jsonByteLength = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

export const enforceJsonSize = (
  value: unknown,
  maxBytes: number,
  fieldName: string
) => {
  const bytes = jsonByteLength(value);
  if (bytes > maxBytes) {
    throw new HttpError(
      413,
      "payload_too_large",
      `${fieldName} exceeds ${maxBytes} bytes`
    );
  }
};

export const ensureStringLength = (
  value: string | null | undefined,
  max: number,
  fieldName: string
) => {
  if (value == null) return;
  if (value.length > max) {
    throw new HttpError(400, "validation_error", `${fieldName} is too long`);
  }
};

export const parseDate = (value: Date | string | null | undefined): Date | null => {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

export const nowUtc = () => new Date();

export const secondsFromNow = (seconds: number) =>
  new Date(Date.now() + seconds * 1000);

export const withinSeconds = (base: Date, other: Date, windowSeconds: number) =>
  Math.abs(base.getTime() - other.getTime()) <= windowSeconds * 1000;

export const boolFromQuery = (value?: string): boolean | undefined => {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
};

export const parseLimit = (value: string | undefined, fallback: number, max: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
};

export const parseOffset = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
};

export const ensureTagLimits = (tags: string[]) => {
  if (tags.length > LIMITS.tagsMax) {
    throw new HttpError(400, "validation_error", "Too many tags");
  }
  for (const tag of tags) {
    if (tag.length > LIMITS.tagMax) {
      throw new HttpError(400, "validation_error", "Tag is too long");
    }
  }
};
