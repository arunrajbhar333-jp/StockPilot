// Supabase Edge Function: admin-update-user
//
// Updates an existing user's profile (name, email, role, permissions) and/or
// resets their password. The service role key stays inside the function and is
// never exposed to the browser.
//
// Request body (all fields optional except userId):
//   {
//     "userId": "uuid",
//     "full_name": "Optional name",
//     "email": "optional@example.com",
//     "role": "admin" | "user",
//     "permissions": ["ipo", "portfolio", "sip"],
//     "password": "new-password"
//   }
//
// Deploy:
//   supabase functions deploy admin-update-user
//
// Supabase automatically provides SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY to deployed functions.

import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_PERMISSIONS = ["ipo", "portfolio", "sip"] as const;
const ALLOWED_ROLES = ["admin", "user"] as const;

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
    .select("role, status")
    .eq("id", caller.id)
    .maybeSingle();

  if (callerProfileError) {
    return json({ error: "Could not verify your administrator profile." }, 500);
  }
  if (callerProfile?.status === "suspended") {
    return json({ error: "This account is suspended." }, 403);
  }
  if (callerProfile?.role !== "admin") {
    return json({ error: "Only administrators can update users." }, 403);
  }

  let body: {
    userId?: unknown;
    full_name?: unknown;
    email?: unknown;
    role?: unknown;
    permissions?: unknown;
    password?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!UUID_PATTERN.test(userId)) {
    return json({ error: "A valid user ID is required." }, 400);
  }

  // Partial update: only fields present in the body are touched.
  const fullName =
    typeof body.full_name === "string" ? body.full_name.trim() : undefined;
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
  const password = typeof body.password === "string" ? body.password : undefined;

  let role: (typeof ALLOWED_ROLES)[number] | undefined;
  if (body.role !== undefined) {
    if (
      typeof body.role !== "string" ||
      !(ALLOWED_ROLES as readonly string[]).includes(body.role)
    ) {
      return json({ error: "Role must be 'admin' or 'user'." }, 400);
    }
    role = body.role as (typeof ALLOWED_ROLES)[number];
  }

  let permissions: string[] | undefined;
  if (body.permissions !== undefined) {
    permissions = Array.from(
      new Set(
        (Array.isArray(body.permissions) ? body.permissions : []).filter(
          (permission): permission is string =>
            typeof permission === "string" &&
            (ALLOWED_PERMISSIONS as readonly string[]).includes(permission),
        ),
      ),
    );
  }

  if (fullName !== undefined && fullName.length < 2) {
    return json({ error: "Enter the user's full name." }, 400);
  }
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Enter a valid email address." }, 400);
  }
  if (permissions !== undefined && permissions.length === 0) {
    return json({ error: "Assign at least one module." }, 400);
  }
  if (password !== undefined && password.length < 6) {
    return json({ error: "Use a password with at least 6 characters." }, 400);
  }

  const profilePatch: Record<string, unknown> = {};
  if (fullName !== undefined) profilePatch.full_name = fullName;
  if (email !== undefined) profilePatch.email = email;
  if (role !== undefined) profilePatch.role = role;
  if (permissions !== undefined) profilePatch.permissions = permissions;

  const wantsProfileUpdate = Object.keys(profilePatch).length > 0;
  if (!wantsProfileUpdate && password === undefined) {
    return json({ error: "Nothing to update." }, 400);
  }

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id, email")
    .eq("id", userId)
    .maybeSingle();

  if (targetError) {
    return json({ error: `Could not load the user: ${targetError.message}` }, 500);
  }
  if (!target) {
    return json({ error: "User not found." }, 404);
  }

  // Never let an admin demote their own account into a lockout.
  if (userId === caller.id && role !== undefined && role !== "admin") {
    return json(
      { error: "You cannot remove your own administrator access." },
      400,
    );
  }

  // Auth first (email/password), so a rejected email fails before the profile
  // row is touched.
  const authAttributes: {
    email?: string;
    email_confirm?: boolean;
    password?: string;
  } = {};
  const emailChanged =
    email !== undefined && email !== (target.email ?? "").toLowerCase();
  if (emailChanged) {
    authAttributes.email = email;
    authAttributes.email_confirm = true;
  }
  if (password !== undefined) {
    authAttributes.password = password;
  }

  let authUpdated = false;
  if (Object.keys(authAttributes).length > 0) {
    const { error: authError } = await admin.auth.admin.updateUserById(
      userId,
      authAttributes,
    );
    if (authError) {
      return json({ error: authError.message }, 400);
    }
    authUpdated = true;
  }

  let profileUpdated = false;
  if (wantsProfileUpdate) {
    const { error: profileError } = await admin
      .from("profiles")
      .update(profilePatch)
      .eq("id", userId);

    if (profileError) {
      return json(
        { error: `Profile could not be saved: ${profileError.message}` },
        500,
      );
    }
    profileUpdated = true;
  }

  return json({
    updated: true,
    profileUpdated,
    authUpdated,
    passwordUpdated: password !== undefined,
  });
});
