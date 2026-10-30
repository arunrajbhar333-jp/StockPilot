// Supabase Edge Function: send-telegram-alert
//
// Delivers one Hinglish alert to a Telegram chat. The bot token is read
// server-side from the `bots` table, so callers never see or store it.
//
// Callers:
//   1. The market scraper, which authenticates with the service role key.
//   2. A signed-in administrator (POST from the admin console).
//
// Body:
//   {
//     "message": string,          // 1..4096 chars, Markdown allowed
//     "chat_id"?: string,         // wins over the bot's default chat
//     "bot_id"?: string           // otherwise the first configured bot is used
//   }
//
// Deploy:
//   supabase functions deploy send-telegram-alert
//
// Secrets (Project Settings → Edge Functions → Secrets):
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Telegram rejects messages above 4096 characters; leave headroom. */
const MAX_MESSAGE_LENGTH = 4000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Length-constant comparison for the service role key. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

interface BotRow {
  id: string;
  chat_id: string | null;
  telegram_bot_token: string;
}

interface SendResult {
  ok: boolean;
  message_id?: number;
  description?: string;
}

/** One Telegram send. `parseMode` is dropped and retried when Telegram cannot
 *  parse the entities, so a stray underscore never blocks an alert. */
async function telegramSend(
  token: string,
  chatId: string,
  text: string,
): Promise<SendResult> {
  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;

  for (const parseMode of ["Markdown", undefined] as const) {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    };
    if (parseMode) payload.parse_mode = parseMode;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { message_id?: number };
      description?: string;
    };

    if (response.ok && data.ok) {
      return { ok: true, message_id: data.result?.message_id };
    }

    const description = data.description ?? `HTTP ${response.status}`;
    const unparsable = /can't parse entities/i.test(description);
    if (parseMode && unparsable) continue;
    return { ok: false, description };
  }

  return { ok: false, description: "Telegram rejected the message." };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "The Edge Function is missing its Supabase secrets." }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "Missing bearer token." }, 401);
  }
  const accessToken = authorization.slice("Bearer ".length);
  const systemCaller = safeEqual(accessToken, serviceRoleKey);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let callerId: string | null = null;

  if (!systemCaller) {
    const {
      data: { user: caller },
      error: callerError,
    } = await admin.auth.getUser(accessToken);

    if (callerError || !caller) {
      return json({ error: "Your session is invalid. Sign in again." }, 401);
    }
    callerId = caller.id;

    const { data: callerProfile, error: callerProfileError } = await admin
      .from("profiles")
      .select("status, role, telegram_chat_id")
      .eq("id", caller.id)
      .maybeSingle();

    if (callerProfileError) {
      return json({ error: "Could not verify your profile." }, 500);
    }
    if (callerProfile?.status === "suspended") {
      return json({ error: "This account is suspended." }, 403);
    }
    // Sending is an operator action: only administrators may push alerts.
    if (callerProfile?.role !== "admin") {
      return json({ error: "Only administrators can send alerts." }, 403);
    }
  }

  let body: { message?: unknown; chat_id?: unknown; bot_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const message =
    typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return json({ error: "A message is required." }, 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return json(
      { error: `Messages must stay under ${MAX_MESSAGE_LENGTH} characters.` },
      400,
    );
  }

  const requestedChatId =
    typeof body.chat_id === "string" ? body.chat_id.trim() : "";
  const requestedBotId =
    typeof body.bot_id === "string" ? body.bot_id.trim() : "";

  const botQuery = admin
    .from("bots")
    .select("id, chat_id, telegram_bot_token")
    .order("created_at", { ascending: true })
    .limit(1);
  if (requestedBotId) botQuery.eq("id", requestedBotId);

  const { data: bots, error: botError } = await botQuery;
  if (botError) {
    return json({ error: `Could not read the bot configuration: ${botError.message}` }, 500);
  }

  const bot = (bots?.[0] ?? null) as BotRow | null;
  if (!bot?.telegram_bot_token) {
    return json(
      { error: "No Telegram bot is configured. Add one in the admin console." },
      404,
    );
  }

  // Chat precedence: explicit request → the bot's default chat → the caller's
  // stored chat → any profile that has one.
  let chatId = requestedChatId || bot.chat_id || "";

  if (!chatId && callerId) {
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("telegram_chat_id")
      .eq("id", callerId)
      .maybeSingle();
    chatId = (callerProfile?.telegram_chat_id ?? "").trim();
  }

  if (!chatId) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("telegram_chat_id")
      .not("telegram_chat_id", "is", null)
      .limit(1);
    chatId = (profiles?.[0]?.telegram_chat_id ?? "").trim();
  }

  if (!chatId) {
    return json(
      { error: "No chat id is available. Set one on the bot or your profile." },
      404,
    );
  }

  let result: SendResult;
  try {
    result = await telegramSend(bot.telegram_bot_token, chatId, message);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[send-telegram-alert] transport failure: ${detail}`);
    return json({ error: `Telegram could not be reached: ${detail}` }, 502);
  }

  if (!result.ok) {
    console.error(
      `[send-telegram-alert] Telegram refused the message: ${result.description}`,
    );
    return json({ error: `Telegram rejected the message: ${result.description}` }, 502);
  }

  return json({ ok: true, chat_id: chatId, message_id: result.message_id ?? null });
});
