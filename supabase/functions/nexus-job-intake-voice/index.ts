// nexus-job-intake-voice
// Handles Retell webhooks for inbound roofer calls.
// call_started → look up caller, set Aria context
// call_analyzed → extract job data, create job, SMS roofer

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RETELL_API_KEY = Deno.env.get('RETELL_API_KEY') || '';
const RETELL_AGENT_ID = Deno.env.get('RETELL_AGENT_ID') || '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!;
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER') || Deno.env.get('TWILIO_FROM_NUMBER') || '';

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
    .select('*, contractor_accounts(id, company_name, plan, subscription_status)')
    .eq('phone', phone)
    .eq('active', true)
    .maybeSingle();

  if (member) return member;

  // Try matching last 10 digits
  const { data: member2 } = await supabase
    .from('contractor_team_members')
    .select('*, contractor_accounts(id, company_name, plan, subscription_status)')
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

Transcript: "${transcript}"

Extract:
{
  "homeowner_name": "full name or null",
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

FOR NEW JOBS ask for (in one go, not one by one):
- Homeowner name
- Property address
- Insurance carrier
- Approximate start date

Then confirm back: "Got it — [summary]. Should I send the homeowner the portal link?"

If they say yes — confirm you'll send it and give them the job ID.
If they say no — tell them to text the homeowner's number when ready.

FOR UPDATES: Listen to the update. Confirm you heard it. Tell them the portal will update.

TONE: Fast. Friendly. Peer to peer. No filler words. No corporate speak.`;
}

async function sendSMS(to: string, body: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) return;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: TWILIO_PHONE_NUMBER, To: to, Body: body }),
  }).catch(() => {});
}

async function createJob(extracted: Record<string, unknown>, member: Record<string, unknown>, transcript: string) {
  const contractor = member.contractor_accounts as Record<string, unknown>;

  const token = `ROS-${Date.now().toString(36).toUpperCase()}`;

  const { data: job, error } = await supabase
    .from('roofing_jobs')
    .insert({
      contractor_id: contractor.id,
      homeowner_name: extracted.homeowner_name,
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
    magic_link_token: token,
    magic_link_expires_at: expiresAt.toISOString(),
  });

  await supabase.from('portal_activities').insert({
    job_id: job.id,
    activity_type: 'job_created',
    title: 'Job file opened',
    description: `Your contractor opened your job file. ${extracted.job_type || 'Storm'} damage claim with ${extracted.carrier || 'your insurance'}.`,
    visible_to_homeowner: true,
    created_by: member.name as string,
  });

  return { job, token };
}

Deno.serve(async (req) => {
  try {
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

      if (member && RETELL_API_KEY && RETELL_AGENT_ID) {
        const contractor = member.contractor_accounts as Record<string, unknown>;
        await fetch(`https://api.retellai.com/v2/update-agent/${RETELL_AGENT_ID}`, {
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
      const transcript = call?.transcript || body.transcript || '';
      if (!transcript || !callerPhone) return Response.json({ ok: true });

      const member = await lookupCaller(callerPhone);
      if (!member) return Response.json({ ok: true });

      const role = member.role as string;
      const config = ROLE_CONFIGS[role] || ROLE_CONFIGS.unknown;
      if (!config.can_start_jobs) return Response.json({ ok: true });

      const lc = transcript.toLowerCase();
      const isNewJob = lc.includes('new job') || lc.includes('new homeowner') || lc.includes('new project');
      if (!isNewJob) return Response.json({ ok: true });

      const extracted = await extractJobData(transcript);
      const confidence = (extracted.confidence as number) || 0;

      if (confidence > 60 && extracted.homeowner_name && extracted.address) {
        const { job, token } = await createJob(extracted, member, transcript) as Record<string, unknown>;

        // SMS roofer — ask for homeowner phone to send portal
        await sendSMS(callerPhone,
          `✅ Job created — ${extracted.homeowner_name}\n${extracted.address}\n\nReply with homeowner's cell # to send them the portal link.\nJob ID: ${token}`
        );

        // Store session state waiting for homeowner phone
        await supabase.from('inbound_sessions').upsert({
          phone: callerPhone,
          member_id: member.id,
          contractor_id: (member.contractor_accounts as Record<string, unknown>).id,
          session_type: 'sms',
          state: 'awaiting_homeowner_phone',
          pending_data: {
            job_id: (job as Record<string, unknown>).id,
            token,
            homeowner_name: extracted.homeowner_name,
          },
          last_message_at: new Date().toISOString(),
        }, { onConflict: 'phone' });
      }

      return Response.json({ ok: true });
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error('nexus-job-intake-voice error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
