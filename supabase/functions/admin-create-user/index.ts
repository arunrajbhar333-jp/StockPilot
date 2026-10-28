// Supabase Edge Function: admin-create-user
//
// Creates a confirmed Supabase Auth user and writes role/permission data to
// public.profiles. The service role key stays inside the function — it must
// never be exposed as a VITE_ variable.
//
// Deploy:
//   supabase functions deploy admin-create-user
//
// Supabase automatically provides SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY to deployed functions.

import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_PERMISSIONS = ["ipo", "portfolio", "sip"] as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user: caller },
    error: callerError,
  } = await admin.auth.getUser(accessToken);

  if (callerError || !caller) {
    return json({ error: "Your session is invalid. Sign in again." }, 401);
  }

  const { data: callerProfile, error: callerProfileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .maybeSingle();

  if (callerProfileError) {
    return json({ error: "Could not verify your administrator profile." }, 500);
  }
  if (callerProfile?.role !== "admin") {
    return json({ error: "Only administrators can create users." }, 403);
  }

  let body: {
    full_name?: string;
    email?: string;
    password?: string;
    permissions?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const fullName = (body.full_name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const permissions = Array.from(
    new Set(
      (Array.isArray(body.permissions) ? body.permissions : []).filter(
        (permission): permission is string =>
          typeof permission === "string" &&
          (ALLOWED_PERMISSIONS as readonly string[]).includes(permission),
      ),
    ),
  );

  if (fullName.length < 2) {
    return json({ error: "Enter the teammate's full name." }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Enter a valid email address." }, 400);
  }
  if (password.length < 6) {
    return json({ error: "Use a password with at least 6 characters." }, 400);
  }
  if (permissions.length === 0) {
    return json({ error: "Assign at least one module." }, 400);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError || !created.user) {
    return json(
      { error: createError?.message ?? "Supabase Auth did not return a user." },
      400,
    );
  }

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: created.user.id,
      email,
      full_name: fullName,
      role: "user",
      permissions,
      status: "active",
    },
    { onConflict: "id" },
  );

  if (profileError) {
    // Avoid an orphaned auth account without a usable profile.
    await admin.auth.admin.deleteUser(created.user.id);
    return json(
      { error: `Profile could not be saved: ${profileError.message}` },
      500,
    );
  }

  return json({ userId: created.user.id, email });
});
