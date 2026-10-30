import { useState, type FormEvent } from "react";
import {
  Bot as BotIcon,
  KeyRound,
  MessageSquareText,
  Send,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBots, useSaveBot } from "@/hooks/use-bots";
import { notificationTemplateSamples } from "@/lib/notification-templates";

type BotFormErrors = Partial<Record<"name" | "token" | "chatId" | "form", string>>;

function maskToken(token: string): string {
  const suffix = token.slice(-4);
  return suffix ? `•••••••• ${suffix}` : "••••••••";
}

export function BotManagement() {
  const { bots, isLoading, error, refetch } = useBots(true);
  const saveBot = useSaveBot();
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [errors, setErrors] = useState<BotFormErrors>({});

  const resetForm = () => {
    setName("");
    setToken("");
    setChatId("");
    setErrors({});
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors: BotFormErrors = {};
    const trimmedName = name.trim();
    const trimmedToken = token.trim();
    const trimmedChatId = chatId.trim();

    if (trimmedName.length < 2) {
      nextErrors.name = "Give the bot a name so the team can identify it.";
    }
    if (trimmedToken.length < 20 || !trimmedToken.includes(":")) {
      nextErrors.token = "Paste the full token exactly as BotFather issued it.";
    }
    if (trimmedChatId.length < 2) {
      nextErrors.chatId = "Add the chat ID or public channel handle.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    saveBot.mutate(
      {
        name: trimmedName,
        token: trimmedToken,
        chatId: trimmedChatId,
      },
      {
        onSuccess: (bot) => {
          toast.success(`${bot.name} saved to the bot registry`, {
            description: `Alerts will target chat ${bot.chatId} once the dispatcher goes live.`,
          });
          resetForm();
        },
        onError: (mutationError) => {
          setErrors({ form: mutationError.message });
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <section className="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
        <form
          onSubmit={handleSubmit}
          className="glass rounded-2xl p-4 sm:p-5"
        >
          <div className="flex items-start gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-primary/20 bg-primary/10">
              <BotIcon className="size-4 text-primary" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Configure Telegram bot</h2>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                Store the BotFather credentials that the alert dispatcher will
                use for IPO, equity and SIP messages.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3.5">
            <div className="space-y-1.5">
              <label
                htmlFor="bot-name"
                className="text-[11px] font-medium text-muted-foreground"
              >
                Bot name
              </label>
              <Input
                id="bot-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setErrors((current) => ({ ...current, name: undefined }));
                }}
                placeholder="StockPilot Alerts"
                autoComplete="off"
                maxLength={80}
                className="h-10 border-white/10 bg-black/30 text-[12px]"
              />
              {errors.name ? (
                <p className="text-[10px] text-negative">{errors.name}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="bot-token"
                className="text-[11px] font-medium text-muted-foreground"
              >
                Telegram bot token
              </label>
              <Input
                id="bot-token"
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                  setErrors((current) => ({ ...current, token: undefined }));
                }}
                placeholder="123456789:AAExampleBotFatherToken"
                autoComplete="off"
                spellCheck={false}
                className="h-10 border-white/10 bg-black/30 font-mono text-[11px]"
              />
              {errors.token ? (
                <p className="text-[10px] text-negative">{errors.token}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="bot-chat"
                className="text-[11px] font-medium text-muted-foreground"
              >
                Chat ID
              </label>
              <Input
                id="bot-chat"
                value={chatId}
                onChange={(event) => {
                  setChatId(event.target.value);
                  setErrors((current) => ({ ...current, chatId: undefined }));
                }}
                placeholder="-1001234567890 or @stockpilot_alerts"
                autoComplete="off"
                spellCheck={false}
                className="h-10 border-white/10 bg-black/30 text-[12px]"
              />
              {errors.chatId ? (
                <p className="text-[10px] text-negative">{errors.chatId}</p>
              ) : null}
            </div>

            {errors.form ? (
              <p className="rounded-lg border border-negative/25 bg-negative/10 px-2.5 py-2 text-[10px] leading-relaxed text-negative">
                {errors.form}
              </p>
            ) : null}

            <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-1.5 text-[9px] leading-relaxed text-muted-foreground/70">
                <ShieldCheck
              className="mt-0.5 size-3 shrink-0 text-emerald-500"
              strokeWidth={1.5}
            />
                The token is stored in the admin-only bots table and masked in
                this view.
              </p>
              <Button
                type="submit"
                size="sm"
                disabled={saveBot.isPending}
                className="h-9 shrink-0 gap-1.5 rounded-lg bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <Send className="size-3.5" />
                {saveBot.isPending ? "Saving…" : "Save bot"}
              </Button>
            </div>
          </div>
        </form>

        <section className="glass overflow-hidden rounded-2xl">
          <div className="flex flex-col gap-2 border-b border-white/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 className="text-sm font-semibold">Bot registry</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Bots available to the notification dispatcher.
              </p>
            </div>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] text-muted-foreground">
              <KeyRound className="size-3 text-primary" />
              {bots.length} configured
            </span>
          </div>

          {isLoading ? (
            <p className="px-4 py-10 text-center text-[11px] text-muted-foreground sm:px-5">
              Loading the bot registry…
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
          ) : bots.length === 0 ? (
            <p className="px-4 py-10 text-center text-[11px] leading-relaxed text-muted-foreground sm:px-5">
              No bots configured yet. Add the BotFather token and target chat to
              prepare the alert dispatcher.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {bots.map((bot) => (
                <div
                  key={bot.id}
                  className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
                      <BotIcon className="size-3.5 text-primary" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-medium">
                        {bot.name}
                      </p>
                      <p className="num truncate text-[10px] text-muted-foreground">
                        {bot.chatId}
                      </p>
                    </div>
                  </div>
                  <div className="pl-[42px] sm:pl-0 sm:text-right">
                    <p className="num text-[10px] text-muted-foreground">
                      {maskToken(bot.token)}
                    </p>
                    <p className="mt-0.5 text-[9px] text-muted-foreground/60">
                      Added {bot.createdAt}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-white/[0.06] px-4 py-3 text-[9px] leading-relaxed text-muted-foreground/70 sm:px-5">
            Credentials are readable only by administrators through row-level
            security. The dispatcher will read them server-side.
          </div>
        </section>
      </section>

      <section className="glass rounded-2xl p-4 sm:p-5">
        <div className="flex items-start gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-ai/25 bg-ai/10">
            <MessageSquareText className="size-4 text-ai" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">
              Hinglish notification templates
            </h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              Prepared for the Telegram dispatcher. Values are injected at send
              time from the latest IPO, portfolio and SIP records.
            </p>
          </div>
        </div>

        <div className="mt-3.5 grid gap-2.5 lg:grid-cols-3">
          {notificationTemplateSamples.map((template) => (
            <div
              key={template.kind}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
            >
              <p className="text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">
                {template.label}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-foreground">
                {template.message}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
