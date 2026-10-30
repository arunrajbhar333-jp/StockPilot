import { useState, type FormEvent } from "react";
import { CalendarDays, IndianRupee, LineChart, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAddHolding } from "@/hooks/use-portfolio-actions";
import { useSession } from "@/lib/session";

interface FormErrors {
  stock?: string;
  quantity?: string;
  price?: string;
  date?: string;
  form?: string;
}

function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/** "Reliance Industries" -> "RELIANCE"; "BLS Poly" -> "BLS". */
function deriveSymbol(stockName: string): string {
  return (
    stockName
      .trim()
      .split(/\s+/)[0]
      ?.replace(/[^A-Za-z0-9&.-]/g, "")
      .toUpperCase()
      .slice(0, 20) || "STOCK"
  );
}

export function AddStockDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useSession();
  const addHolding = useAddHolding();

  const [stock, setStock] = useState("");
  const [quantity, setQuantity] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayIso);
  const [errors, setErrors] = useState<FormErrors>({});

  const reset = () => {
    setStock("");
    setQuantity("");
    setBuyPrice("");
    setPurchaseDate(todayIso());
    setErrors({});
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !addHolding.isPending) reset();
    onOpenChange(next);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedStock = stock.trim();
    const parsedQuantity = Number(quantity);
    const parsedPrice = Number(buyPrice);

    const nextErrors: FormErrors = {};

    if (trimmedStock.length < 2) {
      nextErrors.stock = "Enter the stock symbol or company name.";
    }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      nextErrors.quantity = "Enter a whole number of shares.";
    } else if (parsedQuantity > 1_000_000) {
      nextErrors.quantity = "That quantity is too large.";
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      nextErrors.price = "Enter the price you paid per share.";
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
      nextErrors.date = "Choose the date you bought the stock.";
    } else if (purchaseDate > todayIso()) {
      nextErrors.date = "The purchase date cannot be in the future.";
    }
    if (!user) {
      nextErrors.form = "Sign in again before adding a holding.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !user) return;

    addHolding.mutate(
      {
        userId: user.id,
        stockName: trimmedStock,
        symbol: deriveSymbol(trimmedStock),
        quantity: parsedQuantity,
        buyPrice: Number(parsedPrice.toFixed(2)),
        purchaseDate,
      },
      {
        onSuccess: ({ analysis }) => {
          toast.success(
            `${trimmedStock} added · ${analysis.verdict}${
              analysis.source === "mock" ? " · placeholder" : ""
            }`,
            { description: analysis.reasoning },
          );
          reset();
          onOpenChange(false);
        },
        onError: (error) => {
          setErrors({ form: error.message });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="glass-deep gap-0 overflow-hidden border-white/10 p-0 sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="border-b border-white/[0.07] px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 font-display text-base">
              <Plus className="size-4 text-primary" />
              Add stock
            </DialogTitle>
            <DialogDescription className="mt-1 text-[11px] leading-relaxed">
              Record a holding and let the AI grade it. The call is saved to your
              Supabase portfolio.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-3.5 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <label
                htmlFor="stock-name"
                className="text-[11px] font-medium text-muted-foreground"
              >
                Stock symbol or name
              </label>
              <div className="relative">
                <LineChart className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                <Input
                  id="stock-name"
                  value={stock}
                  onChange={(event) => {
                    setStock(event.target.value);
                    setErrors((current) => ({ ...current, stock: undefined }));
                  }}
                  placeholder="Reliance Industries"
                  autoComplete="off"
                  maxLength={60}
                  className="h-10 border-white/10 bg-black/30 pl-9 text-[12px]"
                />
              </div>
              {errors.stock ? (
                <p className="text-[10px] text-negative">{errors.stock}</p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="stock-quantity"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Quantity
                </label>
                <Input
                  id="stock-quantity"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    setErrors((current) => ({
                      ...current,
                      quantity: undefined,
                    }));
                  }}
                  placeholder="40"
                  className="num h-10 border-white/10 bg-black/30 text-[12px]"
                />
                {errors.quantity ? (
                  <p className="text-[10px] text-negative">{errors.quantity}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="stock-price"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Buy price
                </label>
                <div className="relative">
                  <IndianRupee className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                  <Input
                    id="stock-price"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.05"
                    value={buyPrice}
                    onChange={(event) => {
                      setBuyPrice(event.target.value);
                      setErrors((current) => ({ ...current, price: undefined }));
                    }}
                    placeholder="2410.50"
                    className="num h-10 border-white/10 bg-black/30 pl-9 text-[12px]"
                  />
                </div>
                {errors.price ? (
                  <p className="text-[10px] text-negative">{errors.price}</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="stock-date"
                className="text-[11px] font-medium text-muted-foreground"
              >
                Date of purchase
              </label>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                <Input
                  id="stock-date"
                  type="date"
                  value={purchaseDate}
                  max={todayIso()}
                  onChange={(event) => {
                    setPurchaseDate(event.target.value);
                    setErrors((current) => ({ ...current, date: undefined }));
                  }}
                  className="num h-10 border-white/10 bg-black/30 pl-9 text-[12px]"
                />
              </div>
              {errors.date ? (
                <p className="text-[10px] text-negative">{errors.date}</p>
              ) : null}
            </div>

            <p className="flex items-start gap-1.5 rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2 text-[9px] leading-relaxed text-muted-foreground/70">
              <Sparkles
                className="mt-0.5 size-3 shrink-0 text-amber-500"
                strokeWidth={1.5}
              />
              On save, the position is graded STRONG BUY through STRONG SELL with
              a one-line thesis. Until GEMINI_API_KEY is set, the call is a
              deterministic placeholder.
            </p>

            {errors.form ? (
              <p className="rounded-lg border border-negative/25 bg-negative/10 px-2.5 py-2 text-[10px] leading-relaxed text-negative">
                {errors.form}
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-white/[0.07] px-5 py-3.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={addHolding.isPending}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {addHolding.isPending ? "Grading…" : "Add stock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
