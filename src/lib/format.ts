const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

const inrCompact = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});

/** ₹24,812.35 */
export function formatInr(value: number): string {
  return inr.format(value);
}

/** 24812 -> ₹24,812 · 2481240 -> ₹24.81 L · 248124000 -> ₹24.81 Cr */
export function formatInrCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_00_00_000) return `₹${inrCompact.format(value / 1_00_00_000)} Cr`;
  if (abs >= 1_00_000) return `₹${inrCompact.format(value / 1_00_000)} L`;
  if (abs >= 1_000) return `₹${inrCompact.format(value / 1_000)} K`;
  return `₹${inrCompact.format(value)}`;
}

/** 0.6231 -> +0.62% */
export function formatPct(value: number, digits = 2): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

/** 152.4 -> +₹152.40 */
export function formatSignedInr(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${inr.format(Math.abs(value))}`;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Future value of a monthly SIP at an annual CAGR. */
export function sipFutureValue(
  monthly: number,
  annualRatePct: number,
  years: number,
): number {
  const months = Math.round(years * 12);
  const r = annualRatePct / 100 / 12;
  if (r === 0) return monthly * months;
  return monthly * ((Math.pow(1 + r, months) - 1) / r) * (1 + r);
}
