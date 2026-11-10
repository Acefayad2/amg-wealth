// Copying a shared code can add spaces or invisible formatting characters.
// Preserve its letter case and all visible characters.
export function normalizeRegistrationCode(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u200B-\u200D\uFEFF]/g, "").trim() : "";
}
