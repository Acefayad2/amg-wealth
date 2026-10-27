export const GROUP_NAMES = [
  "Marketing Directors",
  "AMG Hierarchy",
  "AMG Baseshop",
] as const;

export const E164 = /^\+[1-9]\d{7,14}$/;

export function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function cleanText(value: unknown, max: number, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max) {
    throw new Error(`${label} must be between 1 and ${max} characters.`);
  }
  return cleaned;
}

export function requireUuid(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

export function publicError(error: unknown) {
  if (error instanceof Error && /required|must be|invalid|future|eligible|draft/i.test(error.message)) {
    return error.message;
  }
  return "The CRM request could not be completed.";
}
