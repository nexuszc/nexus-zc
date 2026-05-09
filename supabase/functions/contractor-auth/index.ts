import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { action, email, client_id, role } = await req.json();

  if (action === "invite") {
    const { data: user, error: authErr } = await supabase.auth.admin.inviteUserByEmail(email);
    if (authErr) return Response.json({ error: authErr.message }, { status: 400 });

    const { error: linkErr } = await supabase
      .from("contractor_auth")
      .insert({ user_id: user.user.id, client_id, role: role || "owner" });

    if (linkErr) return Response.json({ error: linkErr.message }, { status: 400 });
    return Response.json({ ok: true, user_id: user.user.id });
  }

  if (action === "get_contractor") {
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return Response.json({ error: "Not authenticated" }, { status: 401 });

    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

    const { data: ca } = await supabase
      .from("contractor_auth")
      .select("*, clients(*)")
      .eq("user_id", user.id)
      .single();

    return Response.json({ contractor: ca });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
});
