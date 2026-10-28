import { useMemo, useState } from "react";
import { Activity, CalendarClock, Sparkles, TrendingUp } from "lucide-react";
import { IpoTable } from "@/components/ipo-table";
import { PageHeader } from "@/components/page-header";
import { ipos } from "@/data/mockData";
import { cn } from "@/lib/utils";

const filters = [
  { key: "all", label: "All issues" },
  { key: "Mainboard", label: "Mainboard" },
  { key: "SME", label: "SME" },
] as const;

type FilterKey = (typeof filters)[number]["key"];

export default function IpoTracker() {
  const [filter, setFilter] = useState<FilterKey>("all");

  const visible = useMemo(
    () => (filter === "all" ? ipos : ipos.filter((ipo) => ipo.type === filter)),
    [filter],
  );

  const stats = useMemo(() => {
    const openNow = ipos.filter((ipo) => ipo.status !== "Upcoming").length;
    const avgScore =
      ipos.reduce((total, ipo) => total + ipo.aiScore, 0) / ipos.length;
    const bestGmp = Math.max(...ipos.map((ipo) => ipo.gmpPct));
    const bestSub = Math.max(...ipos.map((ipo) => ipo.subscription));

    return { openNow, avgScore, bestGmp, bestSub };
  }, []);

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Primary market · Live issues"
        title="IPO tracker"
        description="Every live issue, scored one to ten by Gemini when the book opens. GMP and subscription figures are pulled from the exchange feed."
        actions={
          <>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[10px] text-muted-foreground">
              <CalendarClock className="size-3 text-primary" />
              Last sync · 15:18 IST
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[10px] text-muted-foreground">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal/70" />
                <span className="relative inline-flex size-1.5 rounded-full bg-signal" />
              </span>
              {stats.openNow} issues open now
            </span>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          {
            label: "Open issues",
            value: String(stats.openNow),
            note: "of six tracked issues",
            icon: Activity,
          },
          {
            label: "Average AI score",
            value: stats.avgScore.toFixed(1),
            note: "across the cycle",
            icon: Sparkles,
          },
          {
            label: "Highest GMP",
            value: `+${stats.bestGmp.toFixed(1)}%`,
            note: "NexaGrid Energy",
            icon: TrendingUp,
          },
          {
            label: "Peak subscription",
            value: `${stats.bestSub.toFixed(1)}x`,
            note: "institutional and retail",
            icon: CalendarClock,
          },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="glass lift relative overflow-hidden rounded-2xl p-4"
            >
              <div className="flex items-start justify-between">
                <p className="text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  {stat.label}
                </p>
                <Icon className="size-3.5 text-primary/70" />
              </div>
              <p className="num mt-2.5 text-xl font-medium text-foreground">
                {stat.value}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {stat.note}
              </p>
            </div>
          );
        })}
      </section>

      <section className="glass overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-3 border-b border-white/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-sm font-semibold">Live issues</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Ranked by AI score. Select Apply to review the underwriting note.
            </p>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-black/25 p-1">
            {filters.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all",
                  filter === item.key
                    ? "bg-primary/15 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pb-1">
          <IpoTable data={visible} detailed />
        </div>

        <div className="flex flex-col gap-1 border-t border-white/[0.06] px-4 py-3 text-[9px] text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p>
            AI score blends GMP stability, subscription quality, anchor book and
            valuation versus listed peers.
          </p>
          <p className="num">Source: simulated exchange feed</p>
        </div>
      </section>

      <section className="glass relative overflow-hidden rounded-2xl p-4 sm:p-5">
        <div className="pointer-events-none absolute -right-16 -bottom-16 size-52 rounded-full bg-ai/[0.08] blur-3xl" />
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md border border-ai/25 bg-ai/10">
            <Sparkles className="size-3 text-ai" />
          </span>
          <h2 className="text-sm font-semibold">How the AI score is calculated</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            {
              step: "01",
              title: "Demand quality",
              body: "Anchor allocation, QIB bid quality and GMP stability over the final 48 hours.",
            },
            {
              step: "02",
              title: "Fundamentals",
              body: "Revenue CAGR, margin trajectory, working capital and promoter holding post-issue.",
            },
            {
              step: "03",
              title: "Valuation gap",
              body: "Issue multiple versus listed peers, adjusted for free float and sector momentum.",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5"
            >
              <p className="num text-[10px] text-primary/70">{item.step}</p>
              <p className="mt-1.5 text-[11px] font-medium text-foreground">
                {item.title}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                {item.body}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[9px] text-muted-foreground/60">
          Scores are simulated for Phase 1. Gemini scoring and the GitHub Actions
          ingestion pipeline arrive with the backend.
        </p>
      </section>
    </div>
  );
}
