import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function sendSMS(to: string, body: string) {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')!;
  const from = Deno.env.get('TWILIO_FROM_NUMBER') || Deno.env.get('TWILIO_PHONE_NUMBER') || '+18005550100';
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${sid}:${token}`),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString()
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'contractor-auth ready' });

  const { action } = body;

  // SEND MAGIC LINK — phone-primary auth
  if (action === 'send_magic_link') {
    const { phone, contractor_id } = body;
    if (!phone) return Response.json({ ok: false, error: 'phone required' }, { status: 400 });

    let resolvedContractorId = contractor_id;

    if (!resolvedContractorId) {
      // Try owner phone first
      const { data: byOwner } = await supabase
        .from('contractor_accounts')
        .select('id')
        .eq('owner_phone', phone)
        .eq('status', 'active')
        .single();

      if (byOwner) {
        resolvedContractorId = byOwner.id;
      } else {
        // Try employee phone
        const { data: byEmployee } = await supabase
          .from('contractor_employees')
          .select('contractor_id')
          .eq('phone', phone)
          .eq('active', true)
          .single();
        resolvedContractorId = byEmployee?.contractor_id;
      }
    }

    if (!resolvedContractorId) {
      return Response.json({ ok: false, error: 'No active account found for this phone number' }, { status: 404 });
    }

    // Look up employee record for this phone
    const { data: employee } = await supabase
      .from('contractor_employees')
      .select('id, name, role')
      .eq('contractor_id', resolvedContractorId)
      .eq('phone', phone)
      .eq('active', true)
      .single();

    const { data: session } = await supabase
      .from('contractor_sessions')
      .insert({
        contractor_id: resolvedContractorId,
        employee_id: employee?.id || null,
        token_type: 'magic_link',
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      })
      .select('token')
      .single();

    if (!session) return Response.json({ ok: false, error: 'failed to create session' }, { status: 500 });

    const baseUrl = Deno.env.get('DASHBOARD_URL') || 'https://roofingos.dev';
    const link = `${baseUrl}/dashboard/?token=${session.token}`;

    await sendSMS(phone, `Your Roofing OS login link (15 min):\n${link}\n\nDo not share this link.`);

    return Response.json({ ok: true, sent: true });
  }

  // VERIFY TOKEN — called by dashboard on load
  if (action === 'verify_token') {
    const { token } = body;
    if (!token) return Response.json({ ok: false, error: 'token required' }, { status: 400 });

    const { data: session } = await supabase
      .from('contractor_sessions')
      .select('id, contractor_id, employee_id, expires_at')
      .eq('token', token)
      .single();

    if (!session) return Response.json({ ok: false, error: 'invalid token' }, { status: 401 });
    if (new Date(session.expires_at) < new Date()) {
      return Response.json({ ok: false, error: 'token expired' }, { status: 401 });
    }

    // Extend session to 7-day rolling window
    await supabase
      .from('contractor_sessions')
      .update({
        used_at: session.used_at || new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      })
      .eq('id', session.id);

    const { data: contractor } = await supabase
      .from('contractor_accounts')
      .select('id, company_name, owner_name, owner_phone, plan, status, trial_ends_at, subscription_status, churn_risk_score')
      .eq('id', session.contractor_id)
      .single();

    let employee = null;
    if (session.employee_id) {
      const { data: emp } = await supabase
        .from('contractor_employees')
        .select('id, name, role, is_owner')
        .eq('id', session.employee_id)
        .single();
      employee = emp;
    }

    // Update last login + advance onboarding step
    const now = new Date().toISOString();
    const onboardingUpdate: Record<string, unknown> = { last_login_at: now };
    if (contractor?.onboarding_step === 'account_created') {
      onboardingUpdate.onboarding_step = 'dashboard_accessed';
      onboardingUpdate.dashboard_first_accessed_at = now;
    }
    await supabase
      .from('contractor_accounts')
      .update(onboardingUpdate)
      .eq('id', session.contractor_id);

    if (contractor && onboardingUpdate.onboarding_step) {
      contractor.onboarding_step = onboardingUpdate.onboarding_step as string;
    }

    return Response.json({ ok: true, authenticated: true, contractor, employee, session_token: token });
  }

  // LIST EMPLOYEES — returns all team members for this contractor
  if (action === 'list_employees') {
    const { token } = body;
    if (!token) return Response.json({ ok: false, error: 'token required' }, { status: 400 });

    const { data: session } = await supabase
      .from('contractor_sessions')
      .select('contractor_id, expires_at')
      .eq('token', token)
      .single();

    if (!session || new Date(session.expires_at) < new Date()) {
      return Response.json({ ok: false, error: 'invalid session' }, { status: 401 });
    }

    const { data: employees } = await supabase
      .from('contractor_employees')
      .select('id, name, phone, role, is_owner, active')
      .eq('contractor_id', session.contractor_id)
      .order('is_owner', { ascending: false });

    return Response.json({ ok: true, employees: employees || [] });
  }

  // PING — session keepalive
  if (action === 'ping') {
    const { token } = body;
    if (!token) return Response.json({ ok: false, error: 'token required' }, { status: 400 });

    const { data: session } = await supabase
      .from('contractor_sessions')
      .select('id, contractor_id, expires_at')
      .eq('token', token)
      .single();

    if (!session || new Date(session.expires_at) < new Date()) {
      return Response.json({ ok: false, authenticated: false });
    }

    await supabase
      .from('contractor_sessions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', session.id);

    return Response.json({ ok: true, authenticated: true, contractor_id: session.contractor_id });
  }

  // ADD EMPLOYEE — owner/office only
  if (action === 'add_employee') {
    const { contractor_id, session_token, name, phone, role } = body;
    if (!contractor_id || !session_token || !name) {
      return Response.json({ ok: false, error: 'contractor_id, session_token, name required' }, { status: 400 });
    }

    const { data: callerSession } = await supabase
      .from('contractor_sessions')
      .select('contractor_id, employee_id')
      .eq('token', session_token)
      .eq('contractor_id', contractor_id)
      .single();

    if (!callerSession) return Response.json({ ok: false, error: 'unauthorized' }, { status: 403 });

    if (callerSession.employee_id) {
      const { data: emp } = await supabase
        .from('contractor_employees')
        .select('role')
        .eq('id', callerSession.employee_id)
        .single();
      if (emp && emp.role !== 'owner' && emp.role !== 'office') {
        return Response.json({ ok: false, error: 'only owners/office can add employees' }, { status: 403 });
      }
    }

    const { data: newEmp } = await supabase
      .from('contractor_employees')
      .insert({ contractor_id, name, phone: phone || null, role: role || 'crew', is_owner: false })
      .select('id, name, role')
      .single();

    return Response.json({ ok: true, employee: newEmp });
  }

  return Response.json({ ok: false, error: 'action required: send_magic_link | verify_token | ping | add_employee | list_employees' }, { status: 400 });
});
