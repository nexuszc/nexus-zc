import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const AREA_CODE_TIMEZONE: Record<string, string> = {
  // Mountain Time (MT)
  '303': 'America/Denver', '720': 'America/Denver',
  '719': 'America/Denver', '970': 'America/Denver',
  '406': 'America/Denver', '307': 'America/Denver',
  '505': 'America/Denver', '575': 'America/Denver',
  '801': 'America/Denver', '435': 'America/Denver',
  '385': 'America/Denver', '208': 'America/Denver',
  // Central Time (CT)
  '713': 'America/Chicago', '832': 'America/Chicago',
  '281': 'America/Chicago', '346': 'America/Chicago',
  '214': 'America/Chicago', '972': 'America/Chicago',
  '469': 'America/Chicago', '817': 'America/Chicago',
  '512': 'America/Chicago', '737': 'America/Chicago',
  '210': 'America/Chicago', '726': 'America/Chicago',
  '312': 'America/Chicago', '773': 'America/Chicago',
  '872': 'America/Chicago', '630': 'America/Chicago',
  '708': 'America/Chicago', '847': 'America/Chicago',
  '815': 'America/Chicago', '618': 'America/Chicago',
  '314': 'America/Chicago', '636': 'America/Chicago',
  '417': 'America/Chicago', '816': 'America/Chicago',
  '913': 'America/Chicago', '316': 'America/Chicago',
  '405': 'America/Chicago', '918': 'America/Chicago',
  '504': 'America/Chicago', '225': 'America/Chicago',
  '318': 'America/Chicago', '337': 'America/Chicago',
  '507': 'America/Chicago', '612': 'America/Chicago',
  '651': 'America/Chicago', '763': 'America/Chicago',
  '952': 'America/Chicago', '414': 'America/Chicago',
  '608': 'America/Chicago', '920': 'America/Chicago',
  '515': 'America/Chicago', '319': 'America/Chicago',
  '563': 'America/Chicago', '402': 'America/Chicago',
  '531': 'America/Chicago', '605': 'America/Chicago',
  '701': 'America/Chicago',
  // Eastern Time (ET)
  '305': 'America/New_York', '786': 'America/New_York',
  '954': 'America/New_York', '754': 'America/New_York',
  '561': 'America/New_York', '407': 'America/New_York',
  '321': 'America/New_York', '904': 'America/New_York',
  '386': 'America/New_York', '850': 'America/New_York',
  '813': 'America/New_York', '727': 'America/New_York',
  '941': 'America/New_York', '239': 'America/New_York',
  '404': 'America/New_York', '678': 'America/New_York',
  '770': 'America/New_York', '470': 'America/New_York',
  '912': 'America/New_York', '706': 'America/New_York',
  '803': 'America/New_York', '843': 'America/New_York',
  '704': 'America/New_York', '980': 'America/New_York',
  '919': 'America/New_York', '336': 'America/New_York',
  '434': 'America/New_York', '540': 'America/New_York',
  '571': 'America/New_York', '703': 'America/New_York',
  '804': 'America/New_York', '757': 'America/New_York',
  '240': 'America/New_York', '301': 'America/New_York',
  '410': 'America/New_York', '443': 'America/New_York',
  '202': 'America/New_York', '302': 'America/New_York',
  '609': 'America/New_York', '732': 'America/New_York',
  '848': 'America/New_York', '908': 'America/New_York',
  '973': 'America/New_York', '201': 'America/New_York',
  '551': 'America/New_York', '862': 'America/New_York',
  '212': 'America/New_York', '646': 'America/New_York',
  '917': 'America/New_York', '718': 'America/New_York',
  '347': 'America/New_York', '929': 'America/New_York',
  '516': 'America/New_York', '631': 'America/New_York',
  '914': 'America/New_York', '845': 'America/New_York',
  '617': 'America/New_York', '857': 'America/New_York',
  '781': 'America/New_York', '978': 'America/New_York',
  '508': 'America/New_York', '413': 'America/New_York',
  '401': 'America/New_York', '203': 'America/New_York',
  '475': 'America/New_York', '860': 'America/New_York',
  '207': 'America/New_York', '603': 'America/New_York',
  '802': 'America/New_York', '315': 'America/New_York',
  '518': 'America/New_York', '585': 'America/New_York',
  '716': 'America/New_York', '412': 'America/New_York',
  '724': 'America/New_York', '878': 'America/New_York',
  '215': 'America/New_York', '267': 'America/New_York',
  '610': 'America/New_York', '484': 'America/New_York',
  '570': 'America/New_York', '814': 'America/New_York',
  '614': 'America/New_York', '380': 'America/New_York',
  '513': 'America/New_York', '937': 'America/New_York',
  '216': 'America/New_York', '440': 'America/New_York',
  '330': 'America/New_York', '234': 'America/New_York',
  '419': 'America/New_York', '567': 'America/New_York',
  '317': 'America/New_York', '463': 'America/New_York',
  '219': 'America/New_York', '574': 'America/New_York',
  '260': 'America/New_York', '765': 'America/New_York',
  '812': 'America/New_York', '502': 'America/New_York',
  '859': 'America/New_York', '606': 'America/New_York',
  '270': 'America/New_York', '364': 'America/New_York',
  '615': 'America/New_York', '629': 'America/New_York',
  '901': 'America/New_York', '423': 'America/New_York',
  '865': 'America/New_York', '731': 'America/New_York',
  '205': 'America/New_York', '251': 'America/New_York',
  '256': 'America/New_York', '334': 'America/New_York',
  '601': 'America/New_York', '769': 'America/New_York',
  '228': 'America/New_York', '662': 'America/New_York',
  // Pacific Time (PT)
  '213': 'America/Los_Angeles', '310': 'America/Los_Angeles',
  '323': 'America/Los_Angeles', '424': 'America/Los_Angeles',
  '626': 'America/Los_Angeles', '747': 'America/Los_Angeles',
  '818': 'America/Los_Angeles', '619': 'America/Los_Angeles',
  '858': 'America/Los_Angeles', '760': 'America/Los_Angeles',
  '442': 'America/Los_Angeles', '714': 'America/Los_Angeles',
  '949': 'America/Los_Angeles', '562': 'America/Los_Angeles',
  '657': 'America/Los_Angeles', '909': 'America/Los_Angeles',
  '951': 'America/Los_Angeles', '805': 'America/Los_Angeles',
  '661': 'America/Los_Angeles', '559': 'America/Los_Angeles',
  '916': 'America/Los_Angeles', '279': 'America/Los_Angeles',
  '530': 'America/Los_Angeles', '415': 'America/Los_Angeles',
  '628': 'America/Los_Angeles', '510': 'America/Los_Angeles',
  '341': 'America/Los_Angeles', '650': 'America/Los_Angeles',
  '408': 'America/Los_Angeles', '669': 'America/Los_Angeles',
  '925': 'America/Los_Angeles', '707': 'America/Los_Angeles',
  '503': 'America/Los_Angeles', '971': 'America/Los_Angeles',
  '541': 'America/Los_Angeles', '458': 'America/Los_Angeles',
  '206': 'America/Los_Angeles', '253': 'America/Los_Angeles',
  '425': 'America/Los_Angeles', '360': 'America/Los_Angeles',
  '564': 'America/Los_Angeles', '509': 'America/Los_Angeles',
  '702': 'America/Los_Angeles', '725': 'America/Los_Angeles',
  '775': 'America/Los_Angeles',
  // Alaska / Hawaii
  '907': 'America/Anchorage',
  '808': 'Pacific/Honolulu'
};

const FEDERAL_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16',
  '2026-05-25', '2026-06-19', '2026-07-03', '2026-07-04',
  '2026-09-07', '2026-10-12', '2026-11-11',
  '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15',
  '2027-05-31', '2027-06-18', '2027-06-19',
  '2027-07-05', '2027-09-06', '2027-10-11',
  '2027-11-11', '2027-11-25', '2027-12-24', '2027-12-31'
]);

function getTimezone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  const digits = cleaned.startsWith('1') ? cleaned.slice(1) : cleaned;
  const areaCode = digits.slice(0, 3);
  return AREA_CODE_TIMEZONE[areaCode] || 'America/Denver';
}

function getLocalTimeParts(utcTime: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; dayOfWeek: number; dateStr: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short'
  });
  const parts = formatter.formatToParts(utcTime);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '0';

  const year = parseInt(get('year'));
  const month = parseInt(get('month'));
  const day = parseInt(get('day'));
  const rawHour = parseInt(get('hour'));
  // Intl hour12:false can return 24 for midnight
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = parseInt(get('minute'));
  const second = parseInt(get('second'));

  const weekdayStr = get('weekday');
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = weekdayMap[weekdayStr] ?? new Date(year, month - 1, day).getDay();

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, hour, minute, second, dayOfWeek, dateStr };
}

function getNextValidWindow(timezone: string, callType: string): Date {
  const now = new Date();
  const isContractorCall = callType !== 'homeowner_intake' && callType !== 'storm_alert_previous_customer';

  for (let daysAhead = 0; daysAhead < 14; daysAhead++) {
    const candidate = new Date(now.getTime() + daysAhead * 86400000);
    const local = getLocalTimeParts(candidate, timezone);

    if (isContractorCall && (local.dayOfWeek === 0 || local.dayOfWeek === 6)) continue;
    if (FEDERAL_HOLIDAYS.has(local.dateStr)) continue;

    const endHour = (callType === 'homeowner_intake' || callType === 'storm_alert_previous_customer') ? 19 : 17;
    const startHour = (isContractorCall && local.dayOfWeek === 1) ? 10 : 9;

    if (daysAhead === 0) {
      if (local.hour >= endHour) continue; // past end — try next day
      if (local.hour < startHour) {
        // Return today at startHour local
        return localHourToUTC(candidate, timezone, local.dateStr, startHour);
      }
      // Currently in valid window — return now
      return now;
    }

    // Future day — return at startHour
    const futureDate = new Date(now);
    futureDate.setUTCDate(futureDate.getUTCDate() + daysAhead);
    return localHourToUTC(futureDate, timezone, local.dateStr, startHour);
  }

  // Fallback — 7 days from now at 10am MT
  const fallback = new Date(now.getTime() + 7 * 86400000);
  return localHourToUTC(fallback, 'America/Denver', '', 10);
}

function localHourToUTC(nearDate: Date, timezone: string, _dateStr: string, localHour: number): Date {
  // Binary search the UTC time that maps to localHour:00 in the given timezone
  // Start with a rough estimate using the current UTC offset
  const local = getLocalTimeParts(nearDate, timezone);
  const roughOffset = nearDate.getTime() - new Date(local.year, local.month - 1, local.day, local.hour, local.minute, local.second).getTime();

  // Build target local midnight + localHour hours
  const targetLocal = new Date(local.year, local.month - 1, local.day, localHour, 0, 0, 0);
  const estimate = new Date(targetLocal.getTime() + roughOffset);

  // Verify and nudge by up to ±90 min to handle DST edges
  for (let offsetMin = 0; offsetMin <= 90; offsetMin += 1) {
    for (const sign of [1, -1]) {
      const probe = new Date(estimate.getTime() + sign * offsetMin * 60000);
      const probeLocal = getLocalTimeParts(probe, timezone);
      if (probeLocal.hour === localHour && probeLocal.minute === 0) return probe;
    }
  }
  return estimate;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'aria-call-gate ready' });

  const { contact_phone, call_type = 'cold_outbound_contractor', check_time } = body;

  if (!contact_phone) {
    return Response.json({ error: 'contact_phone required' }, { status: 400 });
  }

  const now = check_time ? new Date(check_time) : new Date();
  const timezone = getTimezone(contact_phone);
  const local = getLocalTimeParts(now, timezone);

  // RULE 1 — DNC / unsubscribe
  const { data: unsub } = await supabase
    .from('nexus_unsubscribes')
    .select('id, reason')
    .eq('phone', contact_phone)
    .maybeSingle();

  if (unsub) {
    return Response.json({
      allowed: false,
      reason: 'unsubscribed',
      reason_detail: `This number opted out: ${unsub.reason || 'requested removal'}`,
      next_allowed_at: null,
      permanent: true,
      recipient_timezone: timezone,
      local_time: `${local.dateStr}T${String(local.hour).padStart(2,'0')}:${String(local.minute).padStart(2,'0')}:00`
    });
  }

  // RULE 2 — Federal holidays
  if (FEDERAL_HOLIDAYS.has(local.dateStr)) {
    const nextWindow = getNextValidWindow(timezone, call_type);
    return Response.json({
      allowed: false,
      reason: 'federal_holiday',
      reason_detail: `Today is a federal holiday. Next window: ${nextWindow.toISOString()}`,
      next_allowed_at: nextWindow.toISOString(),
      recipient_timezone: timezone,
      local_time: `${local.dateStr}T${String(local.hour).padStart(2,'0')}:${String(local.minute).padStart(2,'0')}:00`
    });
  }

  const isContractorCall = call_type !== 'homeowner_intake' && call_type !== 'storm_alert_previous_customer';

  // RULE 3 — Weekend (contractor calls only)
  if (isContractorCall && (local.dayOfWeek === 0 || local.dayOfWeek === 6)) {
    const nextWindow = getNextValidWindow(timezone, call_type);
    return Response.json({
      allowed: false,
      reason: 'weekend',
      reason_detail: `Contractor calls not allowed on weekends. Next window: ${nextWindow.toISOString()}`,
      next_allowed_at: nextWindow.toISOString(),
      recipient_timezone: timezone,
      local_time: `${local.dateStr}T${String(local.hour).padStart(2,'0')}:${String(local.minute).padStart(2,'0')}:00`
    });
  }

  // RULE 4 — TCPA absolute hours (9am–8pm local for everyone)
  if (local.hour < 9 || local.hour >= 20) {
    const nextWindow = getNextValidWindow(timezone, call_type);
    return Response.json({
      allowed: false,
      reason: 'outside_tcpa_hours',
      reason_detail: `Local time is ${local.hour}:${String(local.minute).padStart(2,'0')} in ${timezone}. TCPA requires 9am-8pm local time. Next window: ${nextWindow.toISOString()}`,
      next_allowed_at: nextWindow.toISOString(),
      recipient_timezone: timezone,
      local_time: `${local.dateStr}T${String(local.hour).padStart(2,'0')}:${String(local.minute).padStart(2,'0')}:00`
    });
  }

  // RULE 5 — Contractor-specific hours
  if (isContractorCall) {
    // Monday — not before 10am
    if (local.dayOfWeek === 1 && local.hour < 10) {
      const nextWindow = getNextValidWindow(timezone, call_type);
      return Response.json({
        allowed: false,
        reason: 'monday_morning',
        reason_detail: `Avoid contractor calls Monday before 10am. Next window: ${nextWindow.toISOString()}`,
        next_allowed_at: nextWindow.toISOString(),
        recipient_timezone: timezone,
        local_time: `${local.dateStr}T${String(local.hour).padStart(2,'0')}:${String(local.minute).padStart(2,'0')}:00`
      });
    }

    // Friday — not after 3pm
    if (local.dayOfWeek === 5 && local.hour >= 15) {
      const nextWindow = getNextValidWindow(timezone, call_type);
      return Response.json({
        allowed: false,
        reason: 'friday_afternoon',
        reason_detail: `Avoid contractor calls Friday after 3pm. Next window: ${nextWindow.toISOString()}`,
        next_allowed_at: nextWindow.toISOString(),
        recipient_timezone: timezone,
        local_time: `${local.dateStr}T${String(local.hour).padStart(2,'0')}:${String(local.minute).padStart(2,'0')}:00`
      });
    }

    // General contractor hours — not after 5pm
    if (local.hour >= 17) {
      const nextWindow = getNextValidWindow(timezone, call_type);
      return Response.json({
        allowed: false,
        reason: 'after_business_hours',
        reason_detail: `Contractor calls end at 5pm local time. Local time: ${local.hour}:${String(local.minute).padStart(2,'0')}. Next window: ${nextWindow.toISOString()}`,
        next_allowed_at: nextWindow.toISOString(),
        recipient_timezone: timezone,
        local_time: `${local.dateStr}T${String(local.hour).padStart(2,'0')}:${String(local.minute).padStart(2,'0')}:00`
      });
    }
  }

  return Response.json({
    allowed: true,
    recipient_timezone: timezone,
    local_time: `${local.dateStr}T${String(local.hour).padStart(2,'0')}:${String(local.minute).padStart(2,'0')}:00`,
    local_hour: local.hour,
    day_of_week: local.dayOfWeek,
    call_type
  });
});
