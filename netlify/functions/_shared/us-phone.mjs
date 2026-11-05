// Store one canonical form so consent, opt-outs, and Quo recipient matching agree.
export function normalizeUsPhone(value) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input || !/^\+?[0-9().\s-]+$/.test(input) || (input.includes("+") && !input.startsWith("+"))) return null;
  const digits = input.replace(/\D/g, "");
  const ten = digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
  if (ten.length !== 10 || !/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return `+1${ten}`;
}
