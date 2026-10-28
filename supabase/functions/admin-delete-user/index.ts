// Supabase Edge Function: admin-delete-user
//
// Deletes a Supabase Auth user and their profile. The profile delete cascades
// to portfolio holdings through the foreign key in schema.sql. The service role
// key stays inside the function and is never exposed to the browser.
//
// Deploy:
//   supabase functions deploy admin-delete-user
//
// Supabase automatically provides SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY to deployed functions.

import { createClient } from "npm:@supabase/supabase-js@2";

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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    return json({ error: "Only administrators can remove users." }, 403);
  }

  let body: { userId?: unknown };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";

  if (!UUID_PATTERN.test(userId)) {
    return json({ error: "A valid user ID is required." }, 400);
  }
  if (userId === caller.id) {
    return json({ error: "You cannot remove your own admin account." }, 400);
  }

  const { error: authError } = await admin.auth.admin.deleteUser(userId);

  if (authError) {
    const alreadyMissing = /not\s*found|does not exist|user not found/i.test(
      authError.message,
    );

    if (!alreadyMissing) {
      return json({ error: authError.message }, 400);
    }

    // Clean up an orphaned profile if the auth account is already gone.
    const { error: profileError } = await admin
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (profileError) {
      return json({ error: profileError.message }, 400);
    }

    return json({ deleted: true });
  }

  // The FK cascades this delete; this call makes cleanup explicit and covers
  // legacy profiles that were created before the trigger existed.
  const { error: profileError } = await admin
    .from("profiles")
    .delete()
    .eq("id", userId);

  if (profileError) {
    return json(
      {
        error: `Auth account removed, but the profile cleanup failed: ${profileError.message}`,
      },
      500,
    );
  }

  return json({ deleted: true });
});
