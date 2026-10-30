import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { usePortfolioChat, type ChatTurn } from "@/hooks/use-portfolio-actions";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Should I hold TATA MOTORS?",
  "Crude oil badh raha hai, kya asar padega?",
  "Infra push se kaunse holdings ko fayda hoga?",
];

/** Floating "Ask AI" assistant. Ask about your portfolio, India macro, or crude oil.
 */
export function AiChatWidget() {
  const { user, canAccess } = useSession();
  const chat = usePortfolioChat();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = Boolean(user) && canAccess("portfolio");

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns, chat.isPending, failure]);

  if (!visible) return null;

  const send = (text: string) => {
    const message = text.trim();
    if (!message || chat.isPending) return;

    setFailure(null);
    setValue("");
    const history = turns.slice(0, 8);
    setTurns((prev) => [...prev, { role: "user", text: message }]);

    chat.mutate(
      { message, history },
      {
        onSuccess: (reply) =>
          setTurns((prev) => [...prev, { role: "assistant", text: reply }]),
        onError: (error) =>
          setFailure(
            error instanceof Error ? error.message : "Reply nahi mil paaya.",
          ),
      },
    );
  };

  return (
    <>
      {open ? (
        <div className="fixed right-3 bottom-3 z-50 flex w-[calc(100vw-1.5rem)] max-w-[360px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:right-5 sm:bottom-5 chatbot-fixed relative">
          <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10">
              <Sparkles
                className="size-3.5 shrink-0 text-amber-500"
                strokeWidth={1.5}
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold">StockPilot AI</p>
              <p className="truncate text-[10px] text-muted-foreground">
                Portfolio · macro · crude · Hinglish mein poocho
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="grid size-7 place-items-center rounded-full text-muted-foreground transition-all duration-200 hover:bg-muted hover:text-foreground"
            >
              <X className="size-4 shrink-0" strokeWidth={1.5} />
            </button>
          </div>

          <div
            ref={listRef}
            className="flex max-h-[320px] min-h-[160px] flex-col gap-2.5 overflow-y-auto px-3.5 py-3"
          >
            {turns.length === 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Apne portfolio, India macro aur crude oil ke baare mein kuch
                  bhi poocho — jawab Hinglish mein milega.
                </p>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => send(suggestion)}
                      className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-muted"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {turns.map((turn, index) => (
              <div
                key={`${turn.role}-${index}`}
                className={cn(
                  "max-w-[92%] rounded-xl px-3 py-2 text-[11.5px] leading-relaxed whitespace-pre-wrap",
                  turn.role === "user"
                    ? "self-end bg-primary text-primary-foreground"
                    : "self-start border border-border bg-muted/50 text-foreground",
                )}
              >
                {turn.text}
              </div>
            ))}

            {chat.isPending ? (
              <div className="flex items-center gap-1.5 self-start text-[11px] text-muted-foreground">
                <Loader2
                  className="size-3.5 shrink-0 animate-spin"
                  strokeWidth={1.5}
                />
                Soch raha hoon…
              </div>
            ) : null}

            {failure ? (
              <p className="rounded-lg border border-negative/40 bg-negative/10 px-2.5 py-2 text-[11px] leading-relaxed text-negative">
                {failure}
              </p>
            ) : null}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              send(value);
            }}
            className="flex items-end gap-2 border-t border-border px-3 py-2.5"
          >
            <input
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="e.g. TATA MOTORS hold karun?"
              aria-label="Ask the AI assistant"
              className="relative min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 pr-10 text-[12px] text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30 focus:outline-none"
            />
            <button
              type="submit"
              disabled={chat.isPending || !value.trim()}
              aria-label="Send question"
              className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground p-2 transition-all duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="size-3.5 shrink-0" strokeWidth={1.5} />
            </button>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? "Close AI assistant" : "Ask AI"}
        className="primary-glow-sm fixed right-3 bottom-3 z-50 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary px-4 py-2.5 text-[12px] font-semibold text-primary-foreground shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/90 sm:right-5 sm:bottom-5"
      >
        {open ? (
          <X className="size-4 shrink-0" strokeWidth={1.5} />
        ) : (
          <MessageCircle className="size-4 shrink-0" strokeWidth={1.5} />
        )}
        {open ? "Close" : "Ask AI"}
      </button>
    </>
  );
}
