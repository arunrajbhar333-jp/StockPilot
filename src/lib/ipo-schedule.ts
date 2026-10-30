import { useEffect, useState } from "react";
import type { Ipo } from "@/types/domain";

/**
 * Primary-market timing for an issue, in Indian Standard Time. The database
 * stores date-only values, so the standard book hours are assumed: bidding
 * opens at 10:00 IST on `open_date` and closes at 17:00 IST on `close_date`.
 */
const IST_OFFSET = "+05:30";
const IST_ZONE = "Asia/Kolkata";
export const OPEN_HOUR_IST = 10;
export const CLOSE_HOUR_IST = 17;

export type IpoPhase = "upcoming" | "open" | "closing-today" | "closed";

export interface IpoSchedule {
  phase: IpoPhase;
  /** "30 Oct, 10:00 AM", or null when the row has no usable date. */
  opens: string | null;
  closes: string | null;
  badge: string;
  /** How the badge should be coloured. */
  tone: "open" | "closing" | "upcoming" | "closed";
  applyLabel: "Apply" | "Wait for Open" | "Closed";
  canApply: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: IST_ZONE,
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: IST_ZONE,
});

const hourFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  hour12: true,
  timeZone: IST_ZONE,
});

/** "2026-10-30T00:00:00+00:00" -> "2026-10-30"; null when unusable. */
function isoDay(value: string | null): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** The exact instant a book opens or closes on a given IST calendar day. */
function istInstant(day: string, hour: number): Date {
  return new Date(
    `${day}T${String(hour).padStart(2, "0")}:00:00${IST_OFFSET}`,
  );
}

function formatInstant(instant: Date): string {
  return `${dayFormatter.format(instant)}, ${timeFormatter.format(instant)}`;
}

function sameIstDay(a: Date, b: Date): boolean {
  return dayFormatter.format(a) === dayFormatter.format(b);
}

export function getIpoSchedule(ipo: Ipo, now: Date = new Date()): IpoSchedule {
  const openDay = isoDay(ipo.openOn);
  const closeDay = isoDay(ipo.closeOn);
  const startsAt = openDay ? istInstant(openDay, OPEN_HOUR_IST) : null;
  const endsAt = closeDay ? istInstant(closeDay, CLOSE_HOUR_IST) : null;
  const opens = startsAt ? formatInstant(startsAt) : null;
  const closes = endsAt ? formatInstant(endsAt) : null;

  // Without both dates the clock cannot be trusted, so keep the stored snapshot
  // as the fallback rather than blocking the row outright.
  if (!startsAt || !endsAt) {
    const openish = ipo.status !== "Upcoming";
    return {
      phase: openish ? "open" : "upcoming",
      opens,
      closes,
      badge: openish ? "🟢 Open Now" : "Opens Soon",
      tone: openish ? "open" : "upcoming",
      applyLabel: openish ? "Apply" : "Wait for Open",
      canApply: openish,
      startsAt,
      endsAt,
    };
  }

  if (now < startsAt) {
    return {
      phase: "upcoming",
      opens,
      closes,
      badge: `Opens on ${dayFormatter.format(startsAt)}`,
      tone: "upcoming",
      applyLabel: "Wait for Open",
      canApply: false,
      startsAt,
      endsAt,
    };
  }

  if (now > endsAt) {
    return {
      phase: "closed",
      opens,
      closes,
      badge: "Closed",
      tone: "closed",
      applyLabel: "Closed",
      canApply: false,
      startsAt,
      endsAt,
    };
  }

  if (sameIstDay(now, endsAt)) {
    return {
      phase: "closing-today",
      opens,
      closes,
      badge: `🔴 Closes Today at ${hourFormatter.format(endsAt)}`,
      tone: "closing",
      applyLabel: "Apply",
      canApply: true,
      startsAt,
      endsAt,
    };
  }

  return {
    phase: "open",
    opens,
    closes,
    badge: "🟢 Open Now",
    tone: "open",
    applyLabel: "Apply",
    canApply: true,
    startsAt,
    endsAt,
  };
}

/** A clock that re-renders on an interval, so badges roll over on their own. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
