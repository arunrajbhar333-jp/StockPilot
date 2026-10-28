/**
 * Hinglish notification copy for the Telegram bot.
 *
 * These builders only format messages; delivery is handled by the bot service
 * once the scraper and Gemini verdict jobs are connected.
 */

const amountFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});

function amount(value: number | string): string {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? amountFormatter.format(numeric) : String(value);
}

export interface IpoNotificationInput {
  name: string;
  gmp: number | string;
  score: number | string;
}

export interface EquityNotificationInput {
  name: string;
  price: number | string;
  reason: string;
}

export interface SipNotificationInput {
  name: string;
  reason: string;
}

export const notificationTemplates = {
  ipo: ({ name, gmp, score }: IpoNotificationInput) =>
    `🚨 Naya IPO Aaya Hai! Company: ${name}. GMP: ₹${amount(gmp)}. AI Score: ${score}/10. 🟢 FINAL DECISION: APPLY NOW.`,

  equity: ({ name, price, reason }: EquityNotificationInput) =>
    `📉 Portfolio Update! Stock: ${name}. Current Price: ₹${amount(price)}. 🔴 FINAL DECISION: SELL. Reason: ${reason}.`,

  sip: ({ name, reason }: SipNotificationInput) =>
    `💰 Smart SIP Opportunity! Fund: ${name}. 🟢 FINAL DECISION: START SIP. Reason: ${reason}.`,
} as const;

export type NotificationKind = keyof typeof notificationTemplates;

export const notificationTemplateSamples = [
  {
    kind: "ipo" as const,
    label: "New IPO",
    message: notificationTemplates.ipo({
      name: "NexaGrid Energy",
      gmp: 112,
      score: 9.1,
    }),
  },
  {
    kind: "equity" as const,
    label: "Equity verdict",
    message: notificationTemplates.equity({
      name: "Tata Motors",
      price: 812.6,
      reason: "JLR margin guidance looks stretched while EV capex stays elevated",
    }),
  },
  {
    kind: "sip" as const,
    label: "Smart SIP",
    message: notificationTemplates.sip({
      name: "Nifty 50 Index",
      reason: "Lowest-cost beta with a ten-year CAGR ahead of most active funds",
    }),
  },
];
