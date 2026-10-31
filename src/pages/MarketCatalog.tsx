import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Search, SearchX, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { VerdictBadge } from "@/components/signals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";
import { parseHoldingVerdict } from "@/lib/mappers";
import {
  isSupabaseConfigured,
  supabase,
  SUPABASE_SETUP_MESSAGE,
} from "@/lib/supabase";
import { useChatStore } from "@/store/use-chat-store";
import type { HoldingVerdict } from "@/types/domain";

const CATALOG_KEY = ["market-catalog"] as const;

/** Row shape of public.market_catalog, priced and graded by the scraper. */
interface CatalogStock {
  id: string;
  symbol: string | null;
  stock_name: string | null;
  sector: string | null;
  current_price: number | null;
  ai_verdict: string | null;
  confidence: number | null;
  last_analyzed_at: string | null;
}

const money = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function StockIdentity({ stock }: { stock: CatalogStock }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="num grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[9px] font-medium text-muted-foreground">
        {(stock.symbol ?? "").slice(0, 2)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-foreground">
          {stock.stock_name ?? stock.symbol ?? "Untitled listing"}
        </p>
        <p className="num mt-0.5 truncate text-[10px] text-muted-foreground">
          {stock.symbol ?? "—"} · {stock.sector ?? "Unclassified"}
        </p>
      </div>
    </div>
  );
}

function Confidence({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }

  const tone =
    value >= 75 ? "bg-signal" : value >= 50 ? "bg-gold" : "bg-negative";

  return (
    <div className="flex items-center justify-end gap-2">
      <span className="num text-[12px] text-foreground">{Math.round(value)}%</span>
      <div className="h-1 w-9 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn("h-full rounded-full", tone)}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

function verdictOf(stock: CatalogStock): HoldingVerdict | null {
  return stock.ai_verdict ? parseHoldingVerdict(stock.ai_verdict) : null;
}

export default function MarketCatalog() {
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("All sectors");
  const { openChat } = useChatStore();

  const { data: catalog = [], isPending, isError, error, refetch } = useQuery({
    queryKey: CATALOG_KEY,
    enabled: isSupabaseConfigured,
    queryFn: async (): Promise<CatalogStock[]> => {
      if (!supabase) throw new Error(SUPABASE_SETUP_MESSAGE);
      const { data, error: queryError } = await supabase
        .from("market_catalog")
        .select(
          "id, symbol, stock_name, sector, current_price, ai_verdict, confidence, last_analyzed_at",
        )
        .order("symbol", { ascending: true });

      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as CatalogStock[];
    },
  });

  const sectors = useMemo(
    () => [
      "All sectors",
      ...Array.from(
        new Set(catalog.map((stock) => stock.sector ?? "").filter(Boolean)),
      ).sort(),
    ],
    [catalog],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return catalog
      .filter((stock) => {
        const sectorMatch = sector === "All sectors" || stock.sector === sector;
        const searchMatch =
          needle.length === 0 ||
          `${stock.stock_name ?? ""} ${stock.symbol ?? ""} ${stock.sector ?? ""}`
            .toLowerCase()
            .includes(needle);
        return sectorMatch && searchMatch;
      })
      .sort(
        (a, b) =>
          (b.confidence ?? -1) - (a.confidence ?? -1) ||
          (a.symbol ?? "").localeCompare(b.symbol ?? ""),
      );
  }, [catalog, query, sector]);

  const hasFilters = query.trim().length > 0 || sector !== "All sectors";

  const clearFilters = () => {
    setQuery("");
    setSector("All sectors");
  };

  const askAi = (stock: CatalogStock) => {
    openChat(
      `Analyze ${stock.stock_name ?? "unknown"} (${stock.symbol ?? "symbol"}). Should I buy/hold/sell this? Give me the final verdict.`,
    );
  };

  const catalogError =
    error instanceof Error
      ? error.message
      : isError
        ? "We could not load the live catalogue right now."
        : null;

  if (isPending) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <PageHeader
          eyebrow="Equities · loading"
          title="Market catalog"
          description="Loading tracked listings from the live catalogue."
        />

        <section className="glass overflow-hidden rounded-2xl">
          <div className="border-b border-white/[0.06] p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-md">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/70" />
                <Input
                  disabled
                  placeholder="Search by company, symbol or sector"
                  className="h-10 border-white/10 bg-black/30 pr-9 pl-9 text-[12px] placeholder:text-muted-foreground/50 focus-visible:border-primary/50"
                />
              </div>
              <Skeleton className="h-5 w-32" />
            </div>
          </div>

          <div className="divide-y divide-white/[0.05] p-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 py-2">
                <Skeleton className="size-8" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <PageHeader
          eyebrow="Equities · catalogue unavailable"
          title="Market catalog"
          description="We could not load the live catalogue right now."
        />

        <section className="glass overflow-hidden rounded-2xl">
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
            <span className="grid size-11 place-items-center rounded-full border border-white/[0.08] bg-white/[0.03]">
              <SearchX className="size-5 text-muted-foreground" />
            </span>
            <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
              {catalogError ?? "The market catalog failed to load."}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void refetch();
              }}
              className="border-white/10 bg-white/[0.03] text-[11px]"
            >
              Retry catalogue
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow={`Equities · ${catalog.length} tracked listings`}
        title="Market catalog"
        description="Search the tracked universe by company, symbol or sector, then filter to the names the desk rates highest. Every listing carries a current AI verdict and confidence."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[10px] text-muted-foreground">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal/70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-signal" />
            </span>
            Scored after the close
          </span>
        }
      />

      <section className="glass overflow-hidden rounded-2xl">
        <div className="border-b border-white/[0.06] p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-md">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by company, symbol or sector"
                aria-label="Search the market catalog"
                className="h-10 border-white/10 bg-black/30 pr-9 pl-9 text-[12px] placeholder:text-muted-foreground/50 focus-visible:border-primary/50"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
            <p className="num text-[10px] text-muted-foreground">
              {visible.length} of {catalog.length} listings
            </p>
          </div>

          <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {sectors.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setSector(item)}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-all",
                  sector === item
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-white/[0.07] bg-white/[0.02] text-muted-foreground hover:border-white/15 hover:text-foreground",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2 sm:px-5">
          <p className="text-[9px] tracking-[0.14em] text-muted-foreground/70 uppercase">
            Ranked by AI confidence
          </p>
          <p className="num text-[9px] tracking-wide text-muted-foreground/60">
            NSE · BSE · live catalogue
          </p>
        </div>

        {visible.length > 0 ? (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/[0.06] hover:bg-transparent">
                    <TableHead className="text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">
                      Company
                    </TableHead>
                    <TableHead className="text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">
                      Sector
                    </TableHead>
                    <TableHead className="text-right text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">
                      Price
                    </TableHead>
                    <TableHead className="text-right text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">
                      Confidence
                    </TableHead>
                    <TableHead className="text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">
                      Verdict
                    </TableHead>
                    <TableHead className="hidden text-right text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase xl:table-cell">
                      Last scored
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((stock) => {
                    const verdict = verdictOf(stock);
                    return (
                      <TableRow
                        key={stock.id}
                        className="border-white/[0.05] transition-colors hover:bg-white/[0.03]"
                      >
                        <TableCell className="py-3 pl-5">
                          <div className="flex items-center gap-2">
                            <StockIdentity stock={stock} />
                            <button
                              type="button"
                              onClick={() => askAi(stock)}
                              className="rounded-lg bg-primary/10 p-2 text-primary transition-colors hover:bg-primary/20"
                              title="Ask AI about this stock"
                            >
                              <Bot className="size-4" />
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="text-[11px] text-muted-foreground">
                          {stock.sector ?? "Unclassified"}
                        </TableCell>
                        <TableCell className="num text-right text-[12px] text-foreground">
                          ₹{money.format(stock.current_price ?? 0)}
                        </TableCell>
                        <TableCell>
                          <Confidence value={stock.confidence} />
                        </TableCell>
                        <TableCell>
                          {verdict ? (
                            <VerdictBadge verdict={verdict} />
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              Not scored
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="num hidden pr-5 text-right text-[10px] text-muted-foreground xl:table-cell">
                          {stock.last_analyzed_at
                            ? formatRelativeTime(stock.last_analyzed_at)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="divide-y divide-white/[0.05] md:hidden">
              {visible.map((stock) => {
                const verdict = verdictOf(stock);
                return (
                  <div key={stock.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <StockIdentity stock={stock} />
                      <div className="flex items-center gap-1.5">
                        {verdict ? (
                          <VerdictBadge verdict={verdict} />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            Not scored
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => askAi(stock)}
                          className="rounded-lg bg-primary/10 p-2 text-primary transition-colors hover:bg-primary/20"
                          title="Ask AI about this stock"
                        >
                          <Bot className="size-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 flex items-end justify-between gap-3">
                      <p className="num text-[15px] font-medium text-foreground">
                        ₹{money.format(stock.current_price ?? 0)}
                      </p>
                      <div className="text-right">
                        <p className="text-[9px] tracking-wide text-muted-foreground/70 uppercase">
                          Confidence
                        </p>
                        <Confidence value={stock.confidence} />
                      </div>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between border-t border-white/[0.05] pt-2.5">
                      <p className="text-[9px] tracking-wide text-muted-foreground/70 uppercase">
                        {stock.sector ?? "Unclassified"}
                      </p>
                      <p className="num text-[9px] text-muted-foreground">
                        {stock.last_analyzed_at
                          ? `Scored ${formatRelativeTime(stock.last_analyzed_at)}`
                          : "Not scored yet"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <span className="grid size-11 place-items-center rounded-full border border-white/[0.08] bg-white/[0.03]">
              <SearchX className="size-5 text-muted-foreground" />
            </span>
            <p className="mt-4 text-sm font-medium text-foreground">
              No listings match that search
            </p>
            <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-muted-foreground">
              Try a different company, symbol or sector, or clear the filters to
              see the full universe.
            </p>
            {hasFilters ? (
              <Button
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="mt-4 border-white/10 bg-white/[0.03] text-[11px]"
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        )}

        <div className="flex flex-col gap-1 border-t border-white/[0.06] px-4 py-3 text-[9px] text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p>
            Prices and AI verdicts are refreshed from the exchange scraper into
            the live market catalog.
          </p>
          <p className="num">Last refresh · now</p>
        </div>
      </section>
    </div>
  );
}
