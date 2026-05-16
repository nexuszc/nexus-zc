// nexus-job-intake-sms
// Handles all inbound texts to the Twilio number.
// Twilio sends form data — use formData() not json().
// Returns TwiML XML — NOT JSON.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!;
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER') || Deno.env.get('TWILIO_FROM_NUMBER') || '';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const ROLE_CONFIGS: Record<string, { can_start_jobs: boolean }> = {
  owner: { can_start_jobs: true },
  pm: { can_start_jobs: true },
  sales: { can_start_jobs: true },
  crew: { can_start_jobs: false },
  admin: { can_start_jobs: true },
};

const UPDATE_KEYWORDS = [
  'tear off', 'tearoff', 'install', 'done', 'complete', 'finished',
  'on site', 'onsite', 'arriving', 'supplement', 'adjuster', 'approved',
  'inspection', 'permit', 'materials', 'delivered', 'crew', 'started',
];

function twilioResponse(message: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  );
}

async function lookupCaller(phone: string) {
  const clean = phone.replace(/\D/g, '');
  const { data: member } = await supabase
    .from('contractor_team_members')
    .select('*, contractor_accounts(id, company_name, plan, subscription_status)')
    .eq('phone', phone)
    .eq('active', true)
    .maybeSingle();
  if (member) return member;

  const { data: member2 } = await supabase
    .from('contractor_team_members')
    .select('*, contractor_accounts(id, company_name, plan, subscription_status)')
    .ilike('phone', `%${clean.slice(-10)}`)
    .eq('active', true)
    .maybeSingle();
  return member2 || null;
}

async function getSession(phone: string) {
  const { data } = await supabase
    .from('inbound_sessions')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();
  return data;
}

async function updateSession(phone: string, updates: Record<string, unknown>) {
  await supabase.from('inbound_sessions').upsert(
    { phone, ...updates, last_message_at: new Date().toISOString() },
    { onConflict: 'phone' }
  );
}

async function clearSession(phone: string) {
  await supabase.from('inbound_sessions').update({
    state: 'idle',
    pending_data: {},
    active_job_id: null,
  }).eq('phone', phone);
}

async function getActiveJobs(contractorId: string) {
  const { data } = await supabase
    .from('roofing_jobs')
    .select('id, homeowner_name, city, status')
    .eq('contractor_id', contractorId)
    .not('status', 'in', '("complete","paid","cancelled")')
    .order('created_at', { ascending: false })
    .limit(5);
  return data || [];
}

async function extractJobData(text: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Extract job details from this contractor message. Return ONLY valid JSON.

Message: "${text}"

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
  "notes": "any other details",
  "confidence": 0
}`,
      }],
    }),
  });
  const data = await res.json();
  try {
    return JSON.parse((data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim());
  } catch {
    return { confidence: 0 };
  }
}

async function createJob(extracted: Record<string, unknown>, member: Record<string, unknown>, rawText: string) {
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

async function sendHomeownerSMS(phone: string, homeownerName: string, token: string, contractorName: string) {
  const firstName = homeownerName.split(' ')[0];
  const portalUrl = `https://app.nexuszc.com/roofing/portal/${token}`;
  const message = `Hi ${firstName} — ${contractorName} just opened your roofing project file.\n\nSee your project anytime:\n${portalUrl}\n\nAria answers questions 24/7. You won't need to call.`;

  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: TWILIO_PHONE_NUMBER, To: phone, Body: message }),
  }).catch(() => {});
}

async function processUpdate(updateText: string, jobId: string, member: Record<string, unknown>) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `A roofer just texted this update: "${updateText}"\n\nWrite a brief homeowner-friendly version (1-2 sentences). Plain English. Reassuring tone. No jargon. Just the sentences. No quotes.`,
      }],
    }),
  });

  const data = await res.json();
  const friendlyUpdate = data.content?.[0]?.text?.trim() || updateText;

  const lc = updateText.toLowerCase();
  let activityType = 'status_update';
  let title = 'Project update';

  if (lc.includes('tear off') || lc.includes('tearoff')) {
    activityType = 'tear_off_complete'; title = 'Tear-off complete';
  } else if (lc.includes('install')) {
    activityType = 'installation_started'; title = 'Installation underway';
  } else if (lc.includes('done') || lc.includes('complete') || lc.includes('finished')) {
    activityType = 'job_complete'; title = 'Job complete';
  } else if (lc.includes('supplement')) {
    activityType = 'supplement_update'; title = 'Insurance update';
  } else if (lc.includes('adjuster')) {
    activityType = 'adjuster_update'; title = 'Adjuster update';
  } else if (lc.includes('on site') || lc.includes('arriving') || lc.includes('onsite')) {
    activityType = 'crew_arriving'; title = 'Crew arriving';
  } else if (lc.includes('permit')) {
    activityType = 'permit_update'; title = 'Permit update';
  } else if (lc.includes('inspection')) {
    activityType = 'inspection_update'; title = 'Inspection update';
  }

  await supabase.from('portal_activities').insert({
    job_id: jobId,
    activity_type: activityType,
    title,
    description: friendlyUpdate,
    raw_update: updateText,
    visible_to_homeowner: true,
    created_by: member.name as string,
  });

  if (activityType === 'job_complete') {
    await supabase.from('roofing_jobs').update({ status: 'complete' }).eq('id', jobId);
  }
}

async function handlePhotos(
  formData: FormData,
  from: string,
  member: Record<string, unknown> | null,
  session: Record<string, unknown> | null,
  numMedia: number
) {
  let jobId = session?.active_job_id as string | null;

  if (!jobId && member) {
    const jobs = await getActiveJobs((member.contractor_accounts as Record<string, unknown>).id as string);
    if (jobs.length === 1) jobId = jobs[0].id;
  }

  if (!jobId) return;

  let uploaded = 0;
  for (let i = 0; i < numMedia; i++) {
    const mediaUrl = formData.get(`MediaUrl${i}`) as string;
    const mediaType = formData.get(`MediaContentType${i}`) as string;
    if (!mediaType?.startsWith('image/')) continue;

    const imgRes = await fetch(mediaUrl, {
      headers: { 'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}` },
    }).catch(() => null);
    if (!imgRes?.ok) continue;

    const imgBuffer = await imgRes.arrayBuffer();
    const fileName = `${jobId}/${Date.now()}-${i}.jpg`;

    const { error: uploadErr } = await supabase.storage
      .from('job-photos')
      .upload(fileName, imgBuffer, { contentType: 'image/jpeg', upsert: false });

    if (uploadErr) continue;

    const { data: urlData } = supabase.storage.from('job-photos').getPublicUrl(fileName);

    await supabase.from('portal_photos').insert({
      job_id: jobId,
      url: urlData.publicUrl,
      uploaded_by: member?.name as string || 'Crew',
      uploaded_by_phone: from,
      uploaded_by_role: member?.role as string || 'crew',
    });

    uploaded++;
  }

  if (uploaded > 0) {
    await supabase.from('portal_activities').insert({
      job_id: jobId,
      activity_type: 'photos_added',
      title: 'New photos added',
      description: `${member?.name || 'Your crew'} uploaded ${uploaded} photo${uploaded > 1 ? 's' : ''}.`,
      visible_to_homeowner: true,
      created_by: member?.name as string || 'Crew',
    });
  }
}

Deno.serve(async (req) => {
  try {
    // Test ping (JSON)
    if (req.headers.get('content-type')?.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      if (body.test) return Response.json({ ok: true, message: 'nexus-job-intake-sms ready' });
    }

    const formData = await req.formData().catch(() => null);
    if (!formData) return new Response('ok');

    const from = formData.get('From') as string;
    const body = (formData.get('Body') as string || '').trim();
    const numMedia = parseInt(formData.get('NumMedia') as string || '0');

    if (!from) return new Response('ok');

    const [member, session] = await Promise.all([lookupCaller(from), getSession(from)]);

    // PHOTO HANDLING
    if (numMedia > 0) {
      await handlePhotos(formData, from, member, session, numMedia);
      return twilioResponse(member
        ? `Got it — photos added to the portal.`
        : `Photos received. What's the homeowner's last name?`
      );
    }

    const lowerBody = body.toLowerCase();

    // UNKNOWN NUMBER
    if (!member) {
      return twilioResponse(`Hey — you've reached Roofing OS.\n\nText your contractor name and we'll get you set up.`);
    }

    const firstName = (member.name as string).split(' ')[0];

    // SESSION: awaiting homeowner phone (after voice or SMS intake)
    if (session?.state === 'awaiting_homeowner_phone') {
      const phoneMatch = body.match(/\d{10}|\+1\d{10}|\d{3}[-.\s]\d{3}[-.\s]\d{4}/);
      if (phoneMatch) {
        const rawDigits = phoneMatch[0].replace(/\D/g, '');
        const homeownerPhone = rawDigits.length === 10 ? `+1${rawDigits}` : `+${rawDigits}`;
        const pending = session.pending_data as Record<string, unknown>;
        const jobId = pending?.job_id as string;
        const token = pending?.token as string;
        const homeownerName = pending?.homeowner_name as string;
        const contractorName = (member.contractor_accounts as Record<string, unknown>).company_name as string;

        if (jobId && token) {
          await Promise.all([
            sendHomeownerSMS(homeownerPhone, homeownerName, token, contractorName),
            supabase.from('roofing_jobs').update({
              homeowner_phone: homeownerPhone,
              portal_sent_at: new Date().toISOString(),
              portal_sent_confirmed: true,
            }).eq('id', jobId),
            clearSession(from),
          ]);
          const hw = homeownerName.split(' ')[0];
          return twilioResponse(`✅ Portal link sent to ${hw}. They'll see every update in real time.`);
        }
      }
      return twilioResponse(`Just the phone number — 10 digits is fine.`);
    }

    // SESSION: awaiting job selection
    if (session?.state === 'awaiting_job_selection') {
      const pending = session.pending_data as Record<string, unknown>;
      const jobs = (pending?.jobs || []) as Record<string, unknown>[];
      const idx = parseInt(lowerBody) - 1;
      if (idx >= 0 && idx < jobs.length) {
        const selectedJob = jobs[idx];
        await updateSession(from, { state: 'idle', active_job_id: selectedJob.id, pending_data: {} });
        await processUpdate(pending?.pending_update as string, selectedJob.id as string, member);
        return twilioResponse(`✅ Updated — ${selectedJob.homeowner_name} can see it now.`);
      }
      return twilioResponse(`Reply with the number (1, 2, 3...)`);
    }

    // SESSION: awaiting photo job selection
    if (session?.state === 'awaiting_photo_job') {
      const pending = session.pending_data as Record<string, unknown>;
      const jobs = (pending?.jobs || []) as Record<string, unknown>[];
      const idx = parseInt(lowerBody) - 1;
      if (idx >= 0 && idx < jobs.length) {
        await updateSession(from, { state: 'idle', active_job_id: jobs[idx].id, pending_data: {} });
        return twilioResponse(`Ready — send the photos now.`);
      }
      return twilioResponse(`Reply with the number.`);
    }

    // NEW JOB via SMS
    if (lowerBody.startsWith('new job') || lowerBody.startsWith('new homeowner')) {
      if (!ROLE_CONFIGS[member.role as string]?.can_start_jobs) {
        return twilioResponse(`Your role can't start jobs. Have your PM or owner call in.`);
      }
      return twilioResponse(`Got it — text me the details:\nHomeowner name, address, carrier, start date. All in one message is fine.`);
    }

    // STATUS UPDATE (free text that sounds like a job update)
    const isUpdate = UPDATE_KEYWORDS.some(kw => lowerBody.includes(kw));
    if (isUpdate) {
      const contractor = member.contractor_accounts as Record<string, unknown>;
      const activeJobs = await getActiveJobs(contractor.id as string);

      if (activeJobs.length === 0) {
        return twilioResponse(`No active jobs found. Text "new job" to start one.`);
      }

      if (activeJobs.length === 1) {
        await processUpdate(body, activeJobs[0].id, member);
        return twilioResponse(`✅ Portal updated — ${activeJobs[0].homeowner_name} can see it now.`);
      }

      const jobList = activeJobs.slice(0, 5).map((j, i) =>
        `${i + 1}. ${j.homeowner_name} — ${j.city || 'no city'}`
      ).join('\n');

      await updateSession(from, {
        state: 'awaiting_job_selection',
        pending_data: { jobs: activeJobs.slice(0, 5), pending_update: body },
      });

      return twilioResponse(`Which job?\n\n${jobList}\n\nReply with the number.`);
    }

    // FREE FORM — try to extract job data
    const contractor = member.contractor_accounts as Record<string, unknown>;
    const extracted = await extractJobData(body);
    const confidence = (extracted.confidence as number) || 0;

    if (confidence > 70 && extracted.homeowner_name && extracted.address) {
      const { job, token } = await createJob(extracted, member, body) as Record<string, unknown>;
      await updateSession(from, {
        state: 'awaiting_homeowner_phone',
        pending_data: {
          job_id: (job as Record<string, unknown>).id,
          token,
          homeowner_name: extracted.homeowner_name,
        },
      });
      return twilioResponse(`✅ Job created — ${extracted.homeowner_name}\n${extracted.address}\n\nWhat's the homeowner's cell number? I'll send them the portal link.`);
    }

    // Default fallback
    return twilioResponse(`Hey ${firstName} — text me a job update or "new job" to start one. Send photos anytime.`);

  } catch (err) {
    console.error('nexus-job-intake-sms error:', err);
    return new Response('ok');
  }
});
