// nexus-job-intake-voice
// Handles Retell webhooks for inbound roofer calls.
// call_started → look up caller, set Aria context
// call_analyzed → extract job data, create job, email roofer
//
// SMS_DISABLED: 10DLC pending
// Re-enable after 147C letter + 10DLC registration
// Estimated: Monday May 18 2026
// To re-enable: uncomment sendSMS blocks + remove this note
// Then run: grep -r "SMS_DISABLED" supabase/functions/

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RETELL_API_KEY = Deno.env.get('RETELL_API_KEY') || '';
// ROOFING_ARIA_INBOUND_AGENT_ID: dedicated inbound agent for +17202921930
// Created 2026-05-15, webhook → nexus-job-intake-voice, llm: llm_e54f939d8b72817b006519d65c91
const RETELL_INBOUND_AGENT_ID = Deno.env.get('ROOFING_ARIA_INBOUND_AGENT_ID') || Deno.env.get('RETELL_AGENT_ID') || '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';

// SMS_DISABLED: 10DLC pending — re-enable Monday May 18 2026
// const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!;
// const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!;
// const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER') || Deno.env.get('TWILIO_FROM_NUMBER') || '';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const ROLE_CONFIGS: Record<string, {
  begin_message: (name: string) => string;
  can_start_jobs: boolean;
  can_update_jobs: boolean;
  can_upload_photos: boolean;
}> = {
  owner: {
    begin_message: (name) => `Hey ${name} — new job or update on an existing one?`,
    can_start_jobs: true,
    can_update_jobs: true,
    can_upload_photos: true,
  },
  pm: {
    begin_message: (name) => `Hey ${name} — what's the update?`,
    can_start_jobs: true,
    can_update_jobs: true,
    can_upload_photos: true,
  },
  sales: {
    begin_message: (name) => `Hey ${name} — new job to log?`,
    can_start_jobs: true,
    can_update_jobs: false,
    can_upload_photos: true,
  },
  crew: {
    begin_message: (name) => `Hey ${name} — send me photos or say on site or done.`,
    can_start_jobs: false,
    can_update_jobs: false,
    can_upload_photos: true,
  },
  unknown: {
    begin_message: () => `Hey — you've reached Roofing OS. Are you a contractor or homeowner?`,
    can_start_jobs: false,
    can_update_jobs: false,
    can_upload_photos: false,
  },
};

async function lookupCaller(phone: string) {
  const clean = phone.replace(/\D/g, '');

  const { data: member } = await supabase
    .from('contractor_team_members')
    .select('*, contractor_accounts(id, company_name, owner_email, plan, subscription_status)')
    .eq('phone', phone)
    .eq('active', true)
    .maybeSingle();

  if (member) return member;

  const { data: member2 } = await supabase
    .from('contractor_team_members')
    .select('*, contractor_accounts(id, company_name, owner_email, plan, subscription_status)')
    .ilike('phone', `%${clean.slice(-10)}`)
    .eq('active', true)
    .maybeSingle();

  return member2 || null;
}

async function extractJobData(transcript: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Extract job details from this contractor call transcript. Return ONLY valid JSON. No markdown.

IMPORTANT: Email addresses in voice transcripts are often spelled out. Reconstruct them:
- "john at gmail dot com" → "john@gmail.com"
- "mike underscore smith at yahoo dot com" → "mike_smith@yahoo.com"
- "info at roofer dash co dot com" → "info@roofer-co.com"

Transcript: "${transcript}"

Extract:
{
  "homeowner_name": "full name or null",
  "homeowner_email": "email address if mentioned in any form, reconstructed to valid format, or null",
  "address": "full address or null",
  "city": "city or null",
  "state": "state abbreviation or null",
  "zip": "zip or null",
  "carrier": "insurance carrier or null",
  "claim_number": "claim # or null",
  "job_type": "hail/wind/fire/other or null",
  "start_date": "YYYY-MM-DD or null",
  "notes": "any other details mentioned",
  "confidence": 0
}`,
      }],
    }),
  });

  const data = await res.json();
  try {
    return JSON.parse((data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim());
  } catch {
    return { confidence: 0, notes: data.content?.[0]?.text || '' };
  }
}

function buildSystemPrompt(member: Record<string, unknown>, contractor: Record<string, unknown>, role: string): string {
  return `You are Aria, the AI assistant for Roofing OS.

You are speaking with ${member.name}, a ${role} at ${contractor.company_name}.

YOUR JOB:
- Help them log new jobs fast
- Take updates on existing jobs
- Be efficient — they're busy on job sites

FOR NEW JOBS ask for (all in one go, not one by one):
- Homeowner name
- Property address
- Insurance carrier
- Approximate start date

Then confirm back: "Got it — [summary]. What's the homeowner's email so I can send them the portal link?"

When they give the email:
"Perfect — sending now. Job ID is [token]. Email this number anytime with updates — photos, status changes, anything. We translate it all for the homeowner."

If they don't have the email yet:
"No problem — email us the homeowner's address when you have it and we'll send the portal link right away."

FOR UPDATES: Listen to the update. Confirm you heard it. Tell them the portal will update.

TONE: Fast. Friendly. Peer to peer. No filler words. No corporate speak.`;
}

async function sendResendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Roofing OS <zach@nexuszc.com>',
      to,
      subject,
      html,
    }),
  }).catch(() => {});
}

// SMS_DISABLED: 10DLC pending — re-enable Monday May 18 2026
// To re-enable: uncomment below, remove this block
// async function sendSMS(to: string, body: string) {
//   if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) return;
//   await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
//     method: 'POST',
//     headers: {
//       'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
//       'Content-Type': 'application/x-www-form-urlencoded',
//     },
//     body: new URLSearchParams({ From: TWILIO_PHONE_NUMBER, To: to, Body: body }),
//   }).catch(() => {});
// }

async function createJob(extracted: Record<string, unknown>, member: Record<string, unknown>, transcript: string) {
  const contractor = member.contractor_accounts as Record<string, unknown>;
  const token = `ROS-${Date.now().toString(36).toUpperCase()}`;

  const { data: job, error } = await supabase
    .from('roofing_jobs')
    .insert({
      contractor_id: contractor.id,
      homeowner_name: extracted.homeowner_name,
      homeowner_email: extracted.homeowner_email || null,
      property_address: extracted.address,
      city: extracted.city,
      state: extracted.state,
      zip_code: extracted.zip,
      insurance_carrier: extracted.carrier,
      claim_number: extracted.claim_number,
      job_type: extracted.job_type,
      scheduled_start: extracted.start_date || null,
      status: 'lead',
      created_by_phone: member.phone,
      created_by_role: member.role,
      intake_transcript: transcript,
      notes: extracted.notes as string || null,
    })
    .select('id')
    .single();

  if (error || !job) throw new Error(`Job creation failed: ${error?.message}`);

  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  await supabase.from('homeowner_sessions').insert({
    job_id: job.id,
    homeowner_name: extracted.homeowner_name,
    homeowner_email: extracted.homeowner_email || null,
    magic_link_token: token,
    magic_link_expires_at: expiresAt.toISOString(),
  });

  await supabase.from('portal_activities').insert({
    job_id: job.id,
    activity_type: 'job_created',
    title: 'Job file opened',
    description: `Your contractor opened your job file. ${extracted.job_type || 'Storm'} damage claim with ${extracted.carrier || 'your insurance'}.`,
    icon: 'folder',
    visible_to_homeowner: true,
    created_by: member.name as string,
  });

  return { job, token };
}

async function sendHomeownerEmail(homeownerEmail: string, homeownerName: string, token: string, contractorName: string): Promise<void> {
  const firstName = homeownerName.split(' ')[0];
  const portalUrl = `https://app.nexuszc.com/roofing/portal/${token}`;
  const html = `<div style="font-family:-apple-system,sans-serif;max-width:520px;line-height:1.7;color:#1a1a1a;padding:20px;">
<p>Hi ${firstName} —</p>
<p>Your contractor just opened your project file.</p>
<p>You can track everything here — photos as the crew works, your insurance status in plain English, and answers to any question 24/7:</p>
<p style="margin:24px 0;">
<a href="${portalUrl}" style="background:#3b82f6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">View Your Project →</a>
</p>
<p>No need to call your contractor. Everything updates in real time.</p>
<p style="color:#64748b;font-size:14px;">Roofing OS · roofingos.dev</p>
</div>`;

  await sendResendEmail(homeownerEmail, 'Your roofing project is underway', html);
}

async function sendRooferConfirmEmail(rooferEmail: string, homeownerName: string, address: string, homeownerEmail: string, token: string): Promise<void> {
  const html = `<div style="font-family:-apple-system,sans-serif;max-width:520px;line-height:1.7;color:#1a1a1a;padding:20px;">
<p>Job file open for <strong>${homeownerName}</strong>.</p>
<p>${address}</p>
<p>Portal link sent to ${homeownerEmail}.</p>
<p>Job ID: <strong>${token}</strong></p>
<p style="color:#64748b;font-size:14px;">Email updates to this address anytime. We translate them for the homeowner.</p>
</div>`;

  await sendResendEmail(rooferEmail, `Job created — ${homeownerName}`, html);
}

async function configureAgentForCaller(callerPhone: string): Promise<void> {
  if (!callerPhone || !RETELL_API_KEY || !RETELL_INBOUND_AGENT_ID) return;
  const member = await lookupCaller(callerPhone);
  if (!member) return;
  const role = member.role as string || 'unknown';
  const config = ROLE_CONFIGS[role] || ROLE_CONFIGS.unknown;
  const firstName = (member.name as string || '').split(' ')[0];
  const contractor = member.contractor_accounts as Record<string, unknown>;
  await fetch(`https://api.retellai.com/update-agent/${RETELL_INBOUND_AGENT_ID}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      begin_message: config.begin_message(firstName),
      general_prompt: buildSystemPrompt(member, contractor, role),
    }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  try {
    const contentType = req.headers.get('content-type') || '';

    // ── Twilio inbound voice call ─────────────────────────────────────────────
    // Twilio sends application/x-www-form-urlencoded and expects TwiML back.
    // We pre-configure Aria for the caller, then dial through to Retell.
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const form = await req.formData().catch(() => new FormData());
      const callerPhone = (form.get('From') as string) || '';

      // Configure Aria before the call connects so the greeting is personalized
      await configureAgentForCaller(callerPhone);

      const retellPhone = Deno.env.get('RETELL_PHONE_NUMBER') || '+17205006668';
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Number>${retellPhone}</Number>
  </Dial>
</Response>`;
      return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
    }

    // ── Retell webhook or test ping — JSON ────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    if (body.test) return Response.json({ ok: true, message: 'nexus-job-intake-voice ready' });

    const event = body.event || body.event_type;
    const call = body.call || body;
    const callerPhone = call?.from_number || body.from_number || '';

    if (event === 'call_started') {
      const member = callerPhone ? await lookupCaller(callerPhone) : null;
      const role = member?.role || 'unknown';
      const config = ROLE_CONFIGS[role] || ROLE_CONFIGS.unknown;
      const firstName = (member?.name as string || '').split(' ')[0];
      const beginMessage = config.begin_message(firstName);

      if (member && RETELL_API_KEY && RETELL_INBOUND_AGENT_ID) {
        const contractor = member.contractor_accounts as Record<string, unknown>;
        await fetch(`https://api.retellai.com/update-agent/${RETELL_INBOUND_AGENT_ID}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${RETELL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            begin_message: beginMessage,
            general_prompt: buildSystemPrompt(member, contractor, role),
          }),
        }).catch(() => {});
      }

      return Response.json({ ok: true, member_found: !!member, role });
    }

    if (event === 'call_analyzed') {
      const debug = body.debug === true;
      console.log('call_analyzed received', { callerPhone, call_id: call?.call_id || body.call_id });

      const transcript = call?.transcript || body.transcript || '';
      console.log('transcript length:', transcript.length, 'has_caller:', !!callerPhone);
      if (!transcript || !callerPhone) return Response.json({ ok: true, debug_exit: 'no_transcript_or_phone' });

      const member = await lookupCaller(callerPhone);
      console.log('member_found:', !!member, 'role:', member?.role);
      if (!member) return Response.json({ ok: true, debug_exit: 'no_member' });

      const role = member.role as string;
      const config = ROLE_CONFIGS[role] || ROLE_CONFIGS.unknown;
      console.log('can_start_jobs:', config.can_start_jobs);
      if (!config.can_start_jobs) return Response.json({ ok: true, debug_exit: 'role_cannot_start_jobs', role });

      console.log('running extractJobData...');
      const extracted = await extractJobData(transcript);
      console.log('extracted:', JSON.stringify(extracted));
      const rawConf = (extracted.confidence as number) || 0;
      const confidence = rawConf <= 1 ? rawConf * 100 : rawConf;
      console.log('confidence:', confidence, 'has_name:', !!extracted.homeowner_name, 'has_address:', !!extracted.address);
      if (debug) return Response.json({ debug: true, extracted, confidence, member_found: true, role, can_start_jobs: true });

      if (confidence > 60 && extracted.homeowner_name && extracted.address) {
        console.log('creating job...');
        const { job, token } = await createJob(extracted, member, transcript) as Record<string, unknown>;
        const contractor = member.contractor_accounts as Record<string, unknown>;
        const jobId = (job as Record<string, unknown>).id as string;
        console.log('job created:', jobId, 'token:', token);

        if (extracted.homeowner_email) {
          console.log('sending homeowner email to:', extracted.homeowner_email);
          await sendHomeownerEmail(
            extracted.homeowner_email as string,
            extracted.homeowner_name as string,
            token as string,
            contractor.company_name as string
          );

          await supabase.from('roofing_jobs').update({
            portal_sent_at: new Date().toISOString(),
            portal_sent_confirmed: true,
          }).eq('id', jobId);

          await supabase.from('homeowner_sessions')
            .update({ homeowner_email: extracted.homeowner_email })
            .eq('job_id', jobId);
        } else {
          console.log('no homeowner email — queuing inbound_session for follow-up');
          await supabase.from('inbound_sessions').upsert({
            phone: callerPhone,
            member_id: member.id,
            contractor_id: contractor.id,
            session_type: 'sms',
            state: 'awaiting_homeowner_email',
            pending_data: {
              job_id: jobId,
              token,
              homeowner_name: extracted.homeowner_name,
            },
            last_message_at: new Date().toISOString(),
          }, { onConflict: 'phone' });
        }

        const rooferEmail = (contractor.owner_email || '') as string;
        console.log('roofer_email:', rooferEmail || '(none)');
        if (rooferEmail) {
          await sendRooferConfirmEmail(
            rooferEmail,
            extracted.homeowner_name as string,
            extracted.address as string,
            (extracted.homeowner_email || 'not yet provided') as string,
            token as string
          );
        }

        // SMS_DISABLED: 10DLC pending — re-enable Monday May 18 2026
        // await sendSMS(callerPhone, `✅ Job created — ${extracted.homeowner_name}\n${extracted.address}\n\nJob ID: ${token}`);
      } else {
        console.log('skipping job creation — confidence too low or missing fields');
      }

      return Response.json({ ok: true });
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error('nexus-job-intake-voice error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
