import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const activityTemplates: Record<string, { title: string; description: string; description_es: string; icon: string }> = {
  contract_signed: {
    title: "Contract signed — you're official",
    description: "Your roofing project is confirmed. We're now coordinating everything needed to get started.",
    description_es: "Su proyecto de techo está confirmado. Estamos coordinando todo lo necesario para comenzar.",
    icon: "✅"
  },
  insurance_contacted: {
    title: "Insurance company notified",
    description: "We've contacted your insurance company and submitted your damage documentation. An adjuster will be assigned shortly.",
    description_es: "Hemos contactado a su compañía de seguros y enviado la documentación de daños.",
    icon: "📋"
  },
  adjuster_scheduled: {
    title: "Adjuster inspection scheduled",
    description: "Your adjuster inspection is scheduled. We'll be there to represent you.",
    description_es: "Su inspección del ajustador está programada. Estaremos allí para representarle.",
    icon: "📅"
  },
  supplement_submitted: {
    title: "Additional coverage requested",
    description: "We found items your insurance estimate missed and submitted a request for additional coverage.",
    description_es: "Encontramos elementos que su estimado de seguro omitió. Enviamos una solicitud de cobertura adicional.",
    icon: "💰"
  },
  supplement_approved: {
    title: "Additional coverage approved",
    description: "Great news — your insurance approved additional coverage. Your total claim increased.",
    description_es: "Excelentes noticias — su seguro aprobó cobertura adicional.",
    icon: "🎉"
  },
  materials_ordered: {
    title: "Materials ordered",
    description: "Your roofing materials have been ordered and are scheduled for delivery soon.",
    description_es: "Sus materiales de techo han sido ordenados.",
    icon: "📦"
  },
  permit_submitted: {
    title: "Permit application submitted",
    description: "We've submitted your roofing permit to the city. Approval typically takes 3-5 business days.",
    description_es: "Hemos enviado su solicitud de permiso de construcción.",
    icon: "🏛️"
  },
  permit_approved: {
    title: "Permit approved — ready to build",
    description: "Your roofing permit has been approved. We're cleared to start installation.",
    description_es: "Su permiso de construcción ha sido aprobado. Estamos listos para comenzar la instalación.",
    icon: "✅"
  },
  crew_assigned: {
    title: "Crew assigned to your project",
    description: "Your foreman and crew have been assigned to your project.",
    description_es: "Su cuadrilla ha sido asignada a su proyecto.",
    icon: "👷"
  },
  installation_started: {
    title: "Installation has started",
    description: "Your crew has arrived and work has begun. We'll send photo updates throughout the day.",
    description_es: "Su cuadrilla ha llegado y el trabajo ha comenzado.",
    icon: "🔨"
  },
  hidden_damage_found: {
    title: "Additional damage found",
    description: "During tear-off we found additional damage. We've documented everything and started the process to get it covered by your insurance.",
    description_es: "Durante el desmontaje encontramos daño adicional.",
    icon: "🔍"
  },
  installation_complete: {
    title: "Installation complete",
    description: "Your new roof is installed. Final inspection and cleanup are being completed now.",
    description_es: "Su nuevo techo está instalado.",
    icon: "🏠"
  },
  warranty_registered: {
    title: "Warranty registered",
    description: "Your manufacturer warranty has been registered in your name. Your warranty certificate is in your documents.",
    description_es: "Su garantía del fabricante ha sido registrada a su nombre.",
    icon: "🛡️"
  },
  depreciation_submitted: {
    title: "Final payment request submitted",
    description: "We've submitted your completion documentation to release your held insurance funds. This typically takes 5-10 business days.",
    description_es: "Hemos enviado su documentación de finalización para liberar sus fondos de seguro retenidos.",
    icon: "💵"
  },
  payment_received: {
    title: "Payment received",
    description: "Payment received. Thank you.",
    description_es: "Pago recibido. Gracias.",
    icon: "✅"
  },
  project_complete: {
    title: "Project complete",
    description: "Your roof project is complete. Thank you for choosing us. Your portal will continue to monitor your roof and send alerts after any significant weather events.",
    description_es: "Su proyecto de techo está completo. Gracias por elegirnos.",
    icon: "⭐"
  },
  storm_alert: {
    title: "Storm detected near your property",
    description: "A storm was detected near your property. We're monitoring for any impact on your roof.",
    description_es: "Se detectó una tormenta cerca de su propiedad.",
    icon: "⛈️"
  },
  photo_added: {
    title: "New photos added",
    description: "Your crew added photos from your project. Check the photos tab to see your roof progress.",
    description_es: "Su cuadrilla agregó fotos de su proyecto.",
    icon: "📷"
  },
  review_requested: {
    title: "How did we do?",
    description: "Your project is complete. We'd love to hear about your experience.",
    description_es: "Su proyecto está completo. Nos encantaría saber sobre su experiencia.",
    icon: "⭐"
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });

  const { job_id, activity_type, metadata } = await req.json().catch(() => ({}));

  if (!job_id || !activity_type) {
    return Response.json({ error: "job_id and activity_type required" }, { status: 400 });
  }

  const template = activityTemplates[activity_type];
  if (!template) {
    return Response.json({ error: `Unknown activity type: ${activity_type}` }, { status: 400 });
  }

  // Apply metadata substitutions for specific types
  let description = template.description;
  let description_es = template.description_es;
  if (metadata?.carrier) {
    description = description.replace("your insurance company", metadata.carrier);
  }
  if (metadata?.date) {
    description = description.replace("soon", `on ${metadata.date}`).replace("on your installation day", `on ${metadata.date}`);
    description_es = description_es.replace("pronto", metadata.date);
  }
  if (metadata?.amount) {
    const fmtAmt = `$${((metadata.amount) / 100).toLocaleString()}`;
    description = description.replace("additional coverage", `${fmtAmt} in additional coverage`);
  }
  if (metadata?.material) {
    description = description.replace("Your roofing materials", `Your ${metadata.material}`);
  }
  if (metadata?.foreman_name) {
    description = description.replace("Your foreman", metadata.foreman_name);
  }

  await supabase.from("portal_activities").insert({
    job_id,
    activity_type,
    title: template.title,
    description,
    description_es,
    icon: template.icon,
    metadata,
    visible_to_homeowner: true
  });

  // Notify homeowner
  const { data: session } = await supabase
    .from("homeowner_sessions")
    .select("*")
    .eq("job_id", job_id)
    .maybeSingle();

  if (session) {
    const prefs = (session.notification_preferences || {}) as Record<string, boolean>;
    const minorTypes = ["materials_ordered", "permit_submitted", "photo_added"];
    const isMinor = minorTypes.includes(activity_type);

    if (!(prefs.major_only && isMinor)) {
      const notifText = session.preferred_language === "es" ? description_es : description;
      const portalUrl = `https://roofingos.dev/portal/${session.magic_link_token}`;

      if (prefs.sms !== false && session.homeowner_phone) {
        const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
        const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
        const twilioFrom = Deno.env.get("TWILIO_PHONE_NUMBER") || Deno.env.get("RETELL_PHONE_NUMBER") || "";
        if (twilioSid && twilioAuth) {
          await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
            {
              method: "POST",
              headers: {
                "Authorization": `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
                "Content-Type": "application/x-www-form-urlencoded"
              },
              body: new URLSearchParams({
                From: twilioFrom,
                To: session.homeowner_phone,
                Body: `${template.icon} ${template.title}: ${notifText} View portal: ${portalUrl}`
              })
            }
          ).catch(() => {});
        }
      }
    }
  }

  return Response.json({ ok: true });
});
