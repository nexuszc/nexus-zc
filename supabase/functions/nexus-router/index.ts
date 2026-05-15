id });
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  if (!diagnostic) {
    await logError("Diagnostic not found", new Error("Not found"), { diagnostic_id });
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const scores = {
    custom: diagnostic.custom_fit_score || 0,
    vertical_os: diagnostic.vertical_os_fit_score || 0,
    acquisition: diagnostic.acquisition_fit_score || 0,
    builder: diagnostic.builder_fit_score || 0
  };

  // Check if vertical OS exists for their industry
  const { data: existingOS } = await supabase.from("projects").select("id, name").eq("category", "vertical").ilike("name", `%${diagnostic.industry || ""}%`).maybeSingle();

  let model = "nurture";
  let telegramAlert = "";

  if (existingOS && scores.vertical_os >= 70) {
    model = "vertical_os";
    telegramAlert = `🎯 *New Vertical OS Lead*\n*Business:* ${diagnostic.business_name}\n*Score:* ${diagnostic.nexus_score}/100\n*Product:* ${existingOS.name}\n*Report:* nexuszc.com/report/${diagnostic.slug}\n*Password:* \`${diagnostic.report_password}\``;
  } else if (scores.custom >= 80) {
    const revenue = diagnostic.pre_nexus_value_estimate || 0;
    if (revenue >= 1000000) {
      model = "custom_enterprise";
      telegramAlert = `🔥 *Enterprise Lead*\n*Business:* ${diagnostic.business_name}\n*Score:* ${diagnostic.nexus_score}/100\n*Est. revenue:* ~$${(revenue / 1000000).toFixed(1)}M\n*Leakage:* $${(diagnostic.estimated_revenue_leakage || 0).toLocaleString()}\n*Report:* nexuszc.com/report/${diagnostic.slug}\n*Password:* \`${diagnostic.report_password}\`\n\nReply \`send report: ${diagnostic.slug}\` to deliver.`;
    } else if (revenue >= 250000) {
      model = "custom_growth";
      telegramAlert = `💼 *Growth Lead*\n*Business:* ${diagnostic.business_name}\n*Score:* ${diagnostic.nexus_score}/100\n*Report:* nexuszc.com/report/${diagnostic.slug}\n*Password:* \`${diagnostic.report_password}\`\n\nReply \`send report: ${diagnostic.slug}\` to deliver.`;
    } else {
      model = "custom_starter";
      telegramAlert = `✨ *Starter Lead*\n*Business:* ${diagnostic.business_name}\n*Score:* ${diagnostic.nexus_score}/100\n*Report:* nexuszc.com/report/${diagnostic.slug}\n*Password:* \`${diagnostic.report_password}\``;
    }
  } else if (scores.acquisition >= 60) {
    model = "acquisition";
    telegramAlert = `🎯 *Acquisition Target*\n*Business:* ${diagnostic.business_name}\n*Current value:* $${(diagnostic.pre_nexus_value_estimate || 0).toLocaleString()}\n*Post-Nexus value:* $${(diagnostic.post_nexus_value_estimate || 0).toLocaleString()}\n*Value gap:* $${((diagnostic.post_nexus_value_estimate || 0) - (diagnostic.pre_nexus_value_estimate || 0)).toLocaleString()}`;
  } else if (scores.custom >= 50 || scores.vertical_os >= 50) {
    model = "custom_starter";
    telegramAlert = `📊 *New Lead – No Vertical OS*\n*Business:* ${diagnostic.business_name}\n*Industry:* ${diagnostic.industry}\n*Score:* ${diagnostic.nexus_score}/100\nRouting to custom Nexus.`;
  } else {
    model = "nurture";
    telegramAlert = `🥉 *Low-Fit Lead – Nurture*\n*Business:* ${diagnostic.business_name}\n*Score:* ${diagnostic.nexus_score}/100`;
  }

  // Update diagnostic
  try {
    await supabase.from("nexus_diagnostics").update({ recommended_model: model, status: "report_ready", updated_at: new Date().toISOString() }).eq("id", diagnostic_id);
  } catch (updateError) {
    await logError("Failed to update diagnostic", updateError, { diagnostic_id, model });
  }

  if (telegramAlert) await tg(telegramAlert);

  // Trigger next actions
  if (model === "acquisition") {
    try {
      await supabase.from("nexus_acquisition_targets").insert({
        diagnostic_id: diagnostic.id,
        business_name: diagnostic.business_name,
        business_url: diagnostic.business_url,
        industry: diagnostic.industry,
        estimated_current_value: diagnostic.pre_nexus_value_estimate,
        estimated_post_nexus_value: diagnostic.post_nexus_value_estimate,
        value_gap: (diagnostic.post_nexus_value_estimate || 0) - (diagnostic.pre_nexus_value_estimate || 0),
        acquisition_brief: diagnostic.internal_report,
        status: "flagged"
      });
    } catch (insertError) {
      await logError("Failed to insert acquisition target", insertError, { diagnostic_id });
    }
  }

  if (model === "custom_starter" && BLAND_API_KEY && diagnostic.owner_phone && !diagnostic.proactive_run) {
    // Check voice consent before triggering call
    try {
      const { data: consent } = await supabase.from("nexus_consents").select("consent_voice, dnc_listed").eq("email", diagnostic.owner_email).maybeSingle();
      if (consent?.consent_voice && !consent?.dnc_listed) {
        fetch(`${SUPABASE_URL}/functions/v1/nexus-voice`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ diagnostic_id })
        }).catch(() => {});
      }
    } catch (consentError) {
      await logError("Failed to check voice consent", consentError, { diagnostic_id });
    }
  }

  // Update vertical proposal tracking
  if (diagnostic.industry) {
    try {
      const { data: existing } = await supabase.from("nexus_vertical_proposals").select("id, evidence_count").eq("industry", diagnostic.industry).maybeSingle();
      if (existing) {
        await supabase.from("nexus_vertical_proposals").update({ evidence_count: (existing.evidence_count || 0) + 1 }).eq("id", existing.id);
      } else {
        await supabase.from("nexus_vertical_proposals").insert({ vertical_name: `${diagnostic.industry} OS`, industry: diagnostic.industry, evidence_count: 1, status: "detecting" });
      }
    } catch (verticalError) {
      await logError("Failed to update vertical proposals", verticalError, { diagnostic_id, industry: diagnostic.industry });
    }
  }

  return Response.json({ ok: true, model, diagnostic_id });
});

export default Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/nexus-router" || path === "/") {
      const { diagnostic_id } = await req.json();

      if (!diagnostic_id) {
        return new Response(JSON.stringify({ error: "Missing diagnostic_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

      let diagnostic;
      try {
        const { data, error } = await supabase.from("nexus_diagnostics").select("*").eq("id", diagnostic_id).single();
        if (error) throw error;
        diagnostic = data;
      } catch (dbError) {
        await logError("Database query failed", dbError, { diagnostic_id });
        return new Response(JSON.stringify({ error: "Database error" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (!diagnostic) {
        await logError("Diagnostic not found", new Error("Not found"), { diagnostic_id });
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const scores = {
        custom: diagnostic.custom_fit_score || 0,
        vertical_os: diagnostic.vertical_os_fit_score || 0,
        acquisition: diagnostic.acquisition_fit_score || 0,
        builder: diagnostic.builder_fit_score || 0
      };

      const { data: existingOS } = await supabase.from("projects").select("id, name").eq("category", "vertical").ilike("name", `%${diagnostic.industry || ""}%`).maybeSingle();

      let model = "nurture";
      let telegramAlert = "";

      if (existingOS && scores.vertical_os >= 70) {
        model = "vertical_os";
        telegramAlert = `🎯 *New Vertical OS Lead*\n*Business:* ${diagnostic.business_name}\n*Score:* ${diagnostic.nexus_score}/100\n*Product:* ${existingOS.name}\n*Report:* nexuszc.com/report/${diagnostic.slug}\n*Password:* \`${diagnostic.report_password}\``;
      } else if (scores.custom >= 80) {
        const revenue = diagnostic.pre_nexus_value_estimate || 0;
        if (revenue >= 1000000) {
          model = "custom_enterprise";
          telegramAlert = `🔥 *Enterprise Lead*\n*Business:* ${diagnostic.business_name}\n*Score:* ${diagnostic.nexus_score}/100\n*Est. revenue:* ~$${(revenue / 1000000).toFixed(1)}M\n*Leakage:* $${(diagnostic.estimated_revenue_leakage || 0).toLocaleString()}\n*Report:* nexuszc.com/report/${diagnostic.slug}\n*Password:* \`${diagnostic.report_password}\`\n\nReply \`send report: ${diagnostic.slug}\` to deliver.`;
        } else if (revenue >= 250000) {
          model = "custom_growth";
          telegramAlert = `💼 *Growth Lead*\n*Business:* ${diagnostic.business_name}\n*Score:* ${diagnostic.nexus_score}/100\n*Report:* nexuszc.com/report/${diagnostic.slug}\n*Password:* \`${diagnostic.report_password}\`\n\nReply \`send report: ${diagnostic.slug}\` to deliver.`;
        } else {
          model = "custom_starter";
          telegramAlert = `✨ *Starter Lead*\n*Business:* ${diagnostic.business_name}\n*Score:* ${diagnostic.nexus_score}/100\n*Report:* nexuszc.com/report/${diagnostic.slug}\n*Password:* \`${diagnostic.report_password}\``;
        }
      } else if (scores.acquisition >= 60) {
        model = "acquisition";
        telegramAlert = `🎯 *Acquisition Target*\n*Business:* ${diagnostic.business_name}\n*Current value:* $${(diagnostic.pre_nexus_value_estimate || 0).toLocaleString()}\n*Post-Nexus value:* $${(diagnostic.post_nexus_value_estimate || 0).toLocaleString()}\n*Value gap:* $${((diagnostic.post_nexus_value_estimate || 0) - (diagnostic.pre_nexus_value_estimate || 0)).toLocaleString()}`;
      } else if (scores.custom >= 50 || scores.vertical_os >= 50) {
        model = "custom_starter";
        telegramAlert = `📊 *New Lead – No Vertical OS*\n*Business:* ${diagnostic.business_name}\n*Industry:* ${diagnostic.industry}\n*Score:* ${diagnostic.nexus_score}/100\nRouting to custom Nexus.`;
      } else {
        model = "nurture";
        telegramAlert = `🥉 *Low-Fit Lead – Nurture*\n*Business:* ${diagnostic.business_name}\n*Score:* ${diagnostic.nexus_score}/100`;
      }

      try {
        await supabase.from("nexus_diagnostics").update({ recommended_model: model, status: "report_ready", updated_at: new Date().toISOString() }).eq("id", diagnostic_id);
      } catch (updateError) {
        await logError("Failed to update diagnostic", updateError, { diagnostic_id, model });
      }

      if (telegramAlert) await tg(telegramAlert);

      if (model === "acquisition") {
        try {
          await supabase.from("nexus_acquisition_targets").insert({
            diagnostic_id: diagnostic.id,
            business_name: diagnostic.business_name,
            business_url: diagnostic.business_url,
            industry: diagnostic.industry,
            estimated_current_value: diagnostic.pre_nexus_value_estimate,
            estimated_post_nexus_value: diagnostic.post_nexus_value_estimate,
            value_gap: (diagnostic.post_nexus_value_estimate || 0) - (diagnostic.pre_nexus_value_estimate || 0),
            acquisition_brief: diagnostic.internal_report,
            status: "flagged"
          });
        } catch (insertError) {
          await logError("Failed to insert acquisition target", insertError, { diagnostic_id });
        }
      }

      if (model === "custom_starter" && BLAND_API_KEY && diagnostic.owner_phone && !diagnostic.proactive_run) {
        try {
          const { data: consent } = await supabase.from("nexus_consents").select("consent_voice, dnc_listed").eq("email", diagnostic.owner_email).maybeSingle();
          if (consent?.consent_voice && !consent?.dnc_listed) {
            fetch(`${SUPABASE_URL}/functions/v1/nexus-voice`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
              body: JSON.stringify({ diagnostic_id })
            }).catch(() => {});
          }
        } catch (consentError) {
          await logError("Failed to check voice consent", consentError, { diagnostic_id });
        }
      }

      if (diagnostic.industry) {
        try {
          const { data: existing } = await supabase.from("nexus_vertical_proposals").select("id, evidence_count").eq("industry", diagnostic.industry).maybeSingle();
          if (existing) {
            await supabase.from("nexus_vertical_proposals").update({ evidence_count: (existing.evidence_count || 0) + 1