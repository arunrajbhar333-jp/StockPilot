import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Sparkline } from "@/components/sparkline";
import { AiScore, VerdictBadge } from "@/components/signals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { stocks, type Stock } from "@/data/mockData";
import { cn } from "@/lib/utils";

const money = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function DayChange({ changePct }: { changePct: number }) {
  const positive = changePct >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "num inline-flex items-center gap-0.5 text-[11px]",
        positive ? "text-signal" : "text-negative",
      )}
    >
      <Icon className="size-3" />
      {positive ? "+" : ""}
      {changePct.toFixed(2)}%
    </span>
  );
}

function StockIdentity({ stock }: { stock: Stock }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="num grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[9px] font-medium text-muted-foreground">
        {stock.symbol.slice(0, 2)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-foreground">
          {stock.name}
        </p>
        <p className="num mt-0.5 truncate text-[10px] text-muted-foreground">
          {stock.symbol} · {stock.sector}
        </p>
      </div>
    </div>
  );
}

export default function MarketCatalog() {
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("All sectors");

  const sectors = useMemo(
    () => ["All sectors", ...Array.from(new Set(stocks.map((s) => s.sector)))],
    [],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return stocks
      .filter((stock) => {
        const sectorMatch =
          sector === "All sectors" || stock.sector === sector;
        const searchMatch =
          needle.length === 0 ||
          `${stock.name} ${stock.symbol} ${stock.sector}`
            .toLowerCase()
            .includes(needle);
        return sectorMatch && searchMatch;
      })
      .sort((a, b) => b.aiScore - a.aiScore);
  }, [query, sector]);

  const hasFilters = query.trim().length > 0 || sector !== "All sectors";

  const clearFilters = () => {
    setQuery("");
    setSector("All sectors");
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow={`Equities · ${stocks.length} tracked listings`}
        title="Market catalog"
        description="Search the tracked universe by company, symbol or sector, then filter to the names the desk rates highest. Every listing carries a current AI score and verdict."
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
              {visible.length} of {stocks.length} listings
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
            Ranked by AI score
          </p>
          <p className="num text-[9px] tracking-wide text-muted-foreground/60">
            NSE · BSE
          </p>
        </div>

        {visible.length > 0 ? (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/[0.06] hover:bg-transparent">
                    {[
                      "Company",
                      "Market cap",
                      "Price",
                      "Day change",
                      "AI score",
                      "Verdict",
                      "30-day trend",
                    ].map((heading) => (
                      <TableHead
                        key={heading}
                        className={cn(
                          "text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase",
                          (heading === "Price" || heading === "Day change") &&
                            "text-right",
                          heading === "Market cap" && "hidden xl:table-cell",
                          heading === "30-day trend" &&
                            "hidden text-right xl:table-cell",
                        )}
                      >
                        {heading}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((stock) => (
                    <TableRow
                      key={stock.id}
                      className="border-white/[0.05] transition-colors hover:bg-white/[0.03]"
                    >
                      <TableCell className="py-3 pl-5">
                        <StockIdentity stock={stock} />
                      </TableCell>
                      <TableCell className="num hidden text-[11px] text-muted-foreground xl:table-cell">
                        {stock.marketCap}
                      </TableCell>
                      <TableCell className="num text-right text-[12px] text-foreground">
                        ₹{money.format(stock.price)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DayChange changePct={stock.changePct} />
                      </TableCell>
                      <TableCell>
                        <AiScore score={stock.aiScore} />
                      </TableCell>
                      <TableCell>
                        <VerdictBadge verdict={stock.verdict} />
                      </TableCell>
                      <TableCell className="hidden pr-5 text-right xl:table-cell">
                        <Sparkline
                          data={stock.spark}
                          positive={stock.changePct >= 0}
                          className="ml-auto h-8 w-20"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="divide-y divide-white/[0.05] md:hidden">
              {visible.map((stock) => (
                <div key={stock.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <StockIdentity stock={stock} />
                    <VerdictBadge verdict={stock.verdict} />
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="num text-[15px] font-medium text-foreground">
                        ₹{money.format(stock.price)}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <DayChange changePct={stock.changePct} />
                        <span className="num text-[9px] text-muted-foreground">
                          {stock.marketCap}
                        </span>
                      </div>
                    </div>
                    <Sparkline
                      data={stock.spark}
                      positive={stock.changePct >= 0}
                      className="h-8 w-20"
                    />
                  </div>

                  <div className="mt-2.5 flex items-center justify-between border-t border-white/[0.05] pt-2.5">
                    <p className="text-[9px] tracking-wide text-muted-foreground/70 uppercase">
                      AI score
                    </p>
                    <AiScore score={stock.aiScore} />
                  </div>
                </div>
              ))}
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
            Prices and AI scores are simulated for Phase 1. The scraper will
            expand this universe in the backend phase.
          </p>
          <p className="num">Last scoring run · 28 October 2026, 15:18 IST</p>
        </div>
      </section>
    </div>
  );
}
