import { useMemo, useState } from "react";
import { Activity, CalendarClock, Loader2, Sparkles, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { IpoTable } from "@/components/ipo-table";
import { PageHeader } from "@/components/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useReanalyzeAllIpos } from "@/hooks/use-ipo-actions";
import { useIpos } from "@/hooks/use-market-data";
import { getIpoSchedule, useNow } from "@/lib/ipo-schedule";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const filters = [
  { key: "all", label: "All issues" },
  { key: "Mainboard", label: "Mainboard" },
  { key: "SME", label: "SME" },
] as const;

const statusFilters = [
  { key: "all", label: "All" },
  { key: "open", label: "Open Now" },
  { key: "upcoming", label: "Upcoming" },
  { key: "closing-today", label: "Closing Today" },
] as const;

type FilterKey = (typeof filters)[number]["key"];
type StatusFilterKey = (typeof statusFilters)[number]["key"];

export default function IpoTracker() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>("all");
  const [query, setQuery] = useState("");
  const [confirmAnalyzeAll, setConfirmAnalyzeAll] = useState(false);
  const { theme } = useTheme();
  const { isAdmin } = useSession();
  const { ipos, isLoading, error, refetch } = useIpos();
  const analyzeAll = useReanalyzeAllIpos();
  const now = useNow();

  // Rows the scraper has not scored yet: analyze-ipo writes a real score into
  // ai_score, so 0 marks "still pending" rather than "bad issue".
  const pendingIpos = useMemo(
    () => ipos.filter((ipo) => ipo.aiScore === 0),
    [ipos],
  );

  const handleAnalyzeAll = () => {
    // The whole tracked list, not just the unscored rows: this is the manual
    // force-refresh for scores that look stale after a GMP or book update.
    const targets = ipos.map((ipo) => ({ id: ipo.id, company: ipo.company }));

    if (targets.length === 0) {
      toast.info("There are no IPOs to re-analyze yet.");
      return;
    }

    analyzeAll.mutate(targets, {
      onSuccess: (result) => {
        if (result.failed === 0) {
          toast.success(
            `Successfully analyzed ${result.analyzed} IPO${result.analyzed === 1 ? "" : "s"}.`,
          );
          return;
        }
        toast.warning(`${result.analyzed} analyzed, ${result.failed} failed.`, {
          description: `Still pending: ${result.failedCompanies.join(", ")}.`,
        });
      },
      onError: (mutationError) => {
        toast.error("Bulk analysis stopped", {
          description: mutationError.message,
        });
      },
    });
  };

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return ipos
      .filter((ipo) => {
        if (filter !== "all" && ipo.type !== filter) return false;
        if (
          statusFilter !== "all" &&
          getIpoSchedule(ipo, now).phase !== statusFilter
        ) {
          return false;
        }
        return term === "" || ipo.company.toLowerCase().includes(term);
      })
      // Strongest conviction first, so the APPLY rows open the list. Ties fall
      // back to the grey-market premium, then to the name for a stable order.
      .sort(
        (a, b) =>
          b.aiScore - a.aiScore ||
          b.gmp - a.gmp ||
          a.company.localeCompare(b.company),
      );
  }, [filter, ipos, now, query, statusFilter]);

  const stats = useMemo(() => {
    // Use the live clock rather than the stored snapshot, so the count matches
    // the badges in the table.
    const openNow = ipos.filter((ipo) => {
      const phase = getIpoSchedule(ipo, now).phase;
      return phase === "open" || phase === "closing-today";
    }).length;
    const avgScore = ipos.length
      ? ipos.reduce((total, ipo) => total + ipo.aiScore, 0) / ipos.length
      : 0;
    const bestGmp = ipos.length
      ? Math.max(...ipos.map((ipo) => ipo.gmpPct))
      : 0;
    const bestSub = ipos.length
      ? Math.max(...ipos.map((ipo) => ipo.subscription))
      : 0;

    return { openNow, avgScore, bestGmp, bestSub };
  }, [ipos, now]);

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
              Realtime · Supabase
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[10px] text-muted-foreground">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal/70" />
                <span className="relative inline-flex size-1.5 rounded-full bg-signal" />
              </span>
              {isLoading ? "Syncing" : `${stats.openNow} issues open now`}
            </span>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          {
            label: "Open issues",
            value: String(stats.openNow),
            note: "across the live feed",
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

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search company"
              aria-label="Search IPOs by company name"
              className={cn(
                "w-full rounded-lg px-4 py-2 text-[12px] transition-colors outline-none sm:w-56",
                theme === "light"
                  ? "border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500"
                  : "border border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/25",
              )}
            />

            {isAdmin ? (
              <AlertDialog
                open={confirmAnalyzeAll}
                onOpenChange={setConfirmAnalyzeAll}
              >
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={analyzeAll.isPending}
                    aria-live="polite"
                    className={cn(
                      "h-[34px] w-full justify-center gap-1.5 rounded-lg px-3 text-[11px] font-medium sm:w-auto",
                      // Unscored rows pull the eye; a fully graded table stays quiet.
                      pendingIpos.length > 0
                        ? "border-ai/35 bg-ai/10 text-ai hover:bg-ai/15 hover:text-ai"
                        : theme === "light"
                          ? "border border-slate-300 bg-white text-slate-600 hover:text-slate-900"
                          : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-foreground",
                    )}
                  >                      {analyzeAll.isPending ? (
                        <Loader2
                          className="size-3.5 shrink-0 animate-spin"
                          strokeWidth={1.5}
                        />
                      ) : (
                        <Sparkles
                          className="size-3.5 shrink-0 text-amber-500"
                          strokeWidth={1.5}
                        />
                      )}
                    {analyzeAll.isPending
                      ? analyzeAll.progress
                        ? `Analyzing ${analyzeAll.progress.current} of ${analyzeAll.progress.total}…`
                        : "Analyzing…"
                      : `Re-Analyze All (${ipos.length})`}
                  </Button>
                </AlertDialogTrigger>

                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Re-analyze every tracked issue?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to re-analyze all {ipos.length} IPOs?
                      This will use your Gemini API quota.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleAnalyzeAll}>
                      Re-analyze {ipos.length}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}

            <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-auto">
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

              <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-black/25 p-1">
                {statusFilters.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setStatusFilter(item.key)}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all",
                      statusFilter === item.key
                        ? "bg-primary/15 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {isLoading ? (
          <p className="px-4 py-10 text-center text-[11px] text-muted-foreground sm:px-5">
            Loading issues from Supabase…
          </p>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center sm:px-5">
            <p className="text-[11px] text-negative">{error.message}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-[11px] text-primary underline-offset-4 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-[11px] text-muted-foreground sm:px-5">
            {ipos.length === 0
              ? "No issues have been published yet. Run the seed SQL or wait for the scraper."
              : query.trim()
                ? `No issues match “${query.trim()}”.`
                : "No issues match this filter."}
          </p>
        ) : (
          <div className="pb-1">
            <IpoTable data={visible} detailed />
          </div>
        )}

        <div className="flex flex-col gap-1 border-t border-white/[0.06] px-4 py-3 text-[9px] text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p>
            AI score blends GMP stability, subscription quality, anchor book and
            valuation versus listed peers.
          </p>
          <p className="num">Source: Supabase · ipos</p>
        </div>
      </section>

      <section className="glass relative overflow-hidden rounded-2xl p-4 sm:p-5">
        <div className="pointer-events-none absolute -right-16 -bottom-16 size-52 rounded-full bg-ai/[0.08] blur-3xl" />
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md border border-ai/25 bg-ai/10">
            <Sparkles className="size-3 shrink-0 text-amber-500" strokeWidth={1.5} />
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
          Scores are seeded for now. Gemini scoring and the GitHub Actions
          ingestion pipeline arrive with the scraper.
        </p>
      </section>
    </div>
  );
}
