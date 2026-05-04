import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-brain-password",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const password = req.headers.get("x-brain-password");
  const expectedPassword = Deno.env.get("BRAIN_PASSWORD");
  if (!password || password !== expectedPassword) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "stats") {
      const [entries, projects, people] = await Promise.all([
        supabase.from("entries").select("id", { count: "exact", head: true }),
        supabase.from("projects").select("id", { count: "exact", head: true }).neq("category", "archived"),
        supabase.from("people").select("id", { count: "exact", head: true }),
      ]);
      const counts: any = {};
      for (const cat of ["platform", "vertical", "personal", "external", "idea"]) {
        const { count } = await supabase.from("projects").select("id", { count: "exact", head: true }).eq("category", cat);
        counts[cat] = count || 0;
      }
      return ok({
        total_entries: entries.count || 0,
        total_projects: projects.count || 0,
        total_people: people.count || 0,
        platform: counts.platform,
        vertical: counts.vertical,
        personal: counts.personal,
        external: counts.external,
        idea: counts.idea,
      });
    }

    if (action === "list_projects") {
      const { include_archived = false } = body;
      let query = supabase.from("projects").select("*").order("name");
      if (!include_archived) query = query.neq("category", "archived");
      const { data: projects, error } = await query;
      if (error) throw error;

      const enriched = await Promise.all(
        (projects || []).map(async (p) => {
          const { data: entries, count } = await supabase
            .from("entries")
            .select("content, created_at", { count: "exact" })
            .contains("project_names", [p.name])
            .eq("role", "user")
            .order("created_at", { ascending: false })
            .limit(1);
          
          // Also pull the project state if it exists
          const { data: state } = await supabase
            .from("project_states")
            .select("attention_call, current_state, next_step")
            .eq("project_name", p.name)
            .maybeSingle();
          
          return {
            ...p,
            entry_count: count || 0,
            last_activity: entries?.[0]?.created_at || null,
            latest_thought: entries?.[0]?.content || null,
            attention_call: state?.attention_call || null,
            current_state: state?.current_state || null,
            next_step: state?.next_step || null,
          };
        })
      );
      return ok(enriched);
    }

    if (action === "list_people") {
      const { data: people, error } = await supabase.from("people").select("*").order("name");
      if (error) throw error;
      const enriched = await Promise.all(
        (people || []).map(async (p) => {
          const { count } = await supabase
            .from("entries")
            .select("id", { count: "exact", head: true })
            .contains("people_names", [p.name])
            .eq("role", "user");
          return { ...p, entry_count: count || 0 };
        })
      );
      return ok(enriched);
    }

    if (action === "list_entries") {
      const {
        project, person, entry_type, min_importance, start_date, end_date,
        search, limit = 100, include_assistant = false,
      } = body;
      let query = supabase.from("entries").select("*")
        .order("created_at", { ascending: false }).limit(limit);
      if (!include_assistant) query = query.eq("role", "user");
      if (project) query = query.contains("project_names", [project]);
      if (person) query = query.contains("people_names", [person]);
      if (entry_type) query = query.eq("entry_type", entry_type);
      if (min_importance) query = query.gte("importance", min_importance);
      if (start_date) query = query.gte("created_at", start_date);
      if (end_date) query = query.lte("created_at", end_date);
      if (search) query = query.ilike("content", `%${search}%`);
      const { data, error } = await query;
      if (error) throw error;
      return ok(data || []);
    }

    if (action === "get_entry") {
      const { id } = body;
      const { data, error } = await supabase.from("entries").select("*").eq("id", id).single();
      if (error) throw error;
      return ok(data);
    }

    if (action === "set_category") {
      const { name, category } = body;
      if (!name || !category) return bad("name and category required");
      if (!["platform", "vertical", "personal", "external", "idea", "archived"].includes(category)) {
        return bad("invalid category");
      }
      const { error } = await supabase.from("projects").update({ category }).eq("name", name);
      if (error) throw error;
      return ok({ name, category });
    }

    if (action === "rename_project") {
      const { old_name, new_name } = body;
      if (!old_name || !new_name) return bad("old_name and new_name required");
      const { data: entries } = await supabase
        .from("entries").select("id, project_names").contains("project_names", [old_name]);
      for (const entry of entries || []) {
        const newNames = (entry.project_names || []).map((n: string) =>
          n === old_name ? new_name : n
        );
        await supabase.from("entries").update({ project_names: newNames }).eq("id", entry.id);
      }
      const { data: existing } = await supabase
        .from("projects").select("id").eq("name", new_name).maybeSingle();
      if (existing) {
        await supabase.from("projects").delete().eq("name", old_name);
      } else {
        await supabase.from("projects").update({ name: new_name }).eq("name", old_name);
      }
      return ok({ old_name, new_name, entries_updated: entries?.length || 0 });
    }

    if (action === "merge_projects") {
      const { source_names, target_name } = body;
      if (!Array.isArray(source_names) || !target_name) {
        return bad("source_names (array) and target_name (string) required");
      }
      const { data: entries, error: fetchErr } = await supabase
        .from("entries").select("id, project_names")
        .or(source_names.map((n: string) => `project_names.cs.{"${n}"}`).join(","));
      if (fetchErr) throw fetchErr;
      let updated = 0;
      for (const entry of entries || []) {
        const newNames = Array.from(new Set(
          (entry.project_names || []).map((n: string) =>
            source_names.includes(n) ? target_name : n
          )
        ));
        await supabase.from("entries").update({ project_names: newNames }).eq("id", entry.id);
        updated++;
      }
      const { data: existing } = await supabase
        .from("projects").select("id").eq("name", target_name).maybeSingle();
      if (!existing) {
        await supabase.from("projects").insert({ name: target_name, category: "idea" });
      }
      const toDelete = source_names.filter((n: string) => n !== target_name);
      if (toDelete.length > 0) {
        await supabase.from("projects").delete().in("name", toDelete);
      }
      return ok({ merged_into: target_name, sources_removed: toDelete, entries_updated: updated });
    }

    if (action === "delete_project") {
      const { name } = body;
      if (!name) return bad("name required");
      const { data: entries } = await supabase
        .from("entries").select("id, project_names").contains("project_names", [name]);
      for (const entry of entries || []) {
        const newNames = (entry.project_names || []).filter((n: string) => n !== name);
        await supabase.from("entries").update({ project_names: newNames }).eq("id", entry.id);
      }
      await supabase.from("projects").delete().eq("name", name);
      return ok({ deleted: name, entries_updated: entries?.length || 0 });
    }

    if (action === "get_portfolio_brief") {
      const { data, error } = await supabase
        .from("portfolio_briefs")
        .select("*")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return ok(data);
    }

    if (action === "update_entry") {
      const { id, project_names, people_names, entry_type, importance, tags } = body;
      if (!id) return bad("id required");
      const updates: any = {};
      if (project_names !== undefined) updates.project_names = project_names;
      if (people_names !== undefined) updates.people_names = people_names;
      if (entry_type !== undefined) updates.entry_type = entry_type;
      if (importance !== undefined) updates.importance = importance;
      if (tags !== undefined) updates.tags = tags;
      const { data, error } = await supabase
        .from("entries").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return ok(data);
    }

    return bad(`Unknown action: ${action}`);
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function ok(data: any) {
  return new Response(JSON.stringify({ data }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bad(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}