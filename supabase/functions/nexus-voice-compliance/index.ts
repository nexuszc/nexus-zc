import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Two-party consent state area codes
const TWO_PARTY_AREA_CODES = [
  '310','323','424','213','415','408','510','650','619','858', // CA
  '561','954','305','786','407','321','813','727','941',        // FL
  '312','773','708','847','630','224','331',                    // IL
  '215','412','610','484','267','717','814',                    // PA
  '206','253','360','509','564',                               // WA
  '617','781','508','413','978','339',                         // MA
  '503','541','971',                                           // OR
  '775','702',                                                 // NV
  '406',                                                       // MT
  '603',                                                       // NH
];

function isTwoPartyState(phone: string): boolean {
  const areaCode = phone.replace(/\D/g, '').slice(1, 4);
  return TWO_PARTY_AREA_CODES.includes(areaCode);
}

function isValidCallingHour(phone: string): boolean {
  const areaCode = phone.replace(/\D/g, '').slice(1, 4);
  const utcHour = new Date().getUTCHours();

  const pacific = ['310','323','424','213','415','408','510',
    '650','619','858','206','253','503','702','775'];
  const mountain = ['303','720','480','602','505','801','307'];
  const central = ['312','773','214','469','713','832','281'];

  let localHour: number;
  if (pacific.includes(areaCode)) localHour = (utcHour - 7 + 24) % 24;
  else if (mountain.includes(areaCode)) localHour = (utcHour - 6 + 24) % 24;
  else if (central.includes(areaCode)) localHour = (utcHour - 5 + 24) % 24;
  else localHour = (utcHour - 4 + 24) % 24; // Eastern

  return localHour >= 8 && localHour < 21;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true });

  const { diagnostic_id, phone_number } = body;
  if (!phone_number) {
    return Response.json({ approved: false, reason: 'No phone number' });
  }

  // 1. Check consent
  const { data: consent } = await supabase
    .from('nexus_consents')
    .select('consent_voice')
    .eq('phone', phone_number)
    .maybeSingle();

  if (!consent?.consent_voice) {
    await supabase.from('voice_compliance').insert({
      diagnostic_id, phone_number,
      consent_verified: false,
      approved_to_call: false,
      rejection_reason: 'No voice consent'
    });
    return Response.json({ approved: false, reason: 'No voice consent recorded' });
  }

  // 2. Check internal DNC / unsubscribes
  const { data: unsub } = await supabase
    .from('nexus_unsubscribes')
    .select('id')
    .eq('phone', phone_number)
    .in('channel', ['voice', 'all'])
    .maybeSingle();

  if (unsub) {
    return Response.json({ approved: false, reason: 'On internal do-not-call list' });
  }

  // 3. Check calling hours (TCPA: 8am–9pm local)
  if (!isValidCallingHour(phone_number)) {
    return Response.json({
      approved: false,
      reason: 'Outside calling hours (8am-9pm local)',
      retry_after: '8am local time'
    });
  }

  // 4. Check recent call history — no more than 1 call per 20 hours
  const { data: recentCall } = await supabase
    .from('voice_calls')
    .select('id, outcome, created_at')
    .eq('to_number', phone_number)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentCall) {
    const hoursSince = (Date.now() - new Date(recentCall.created_at).getTime())
      / (1000 * 60 * 60);
    if (hoursSince < 20) {
      return Response.json({
        approved: false,
        reason: 'Called too recently',
        hours_since: hoursSince
      });
    }
    if (['hostile', 'not_interested'].includes(recentCall.outcome || '')) {
      return Response.json({
        approved: false,
        reason: 'Prospect previously opted out'
      });
    }
  }

  // 5. Check max call attempts (4 max per diagnostic)
  if (diagnostic_id) {
    const { count } = await supabase
      .from('voice_calls')
      .select('*', { count: 'exact', head: true })
      .eq('diagnostic_id', diagnostic_id);

    if ((count || 0) >= 4) {
      return Response.json({
        approved: false,
        reason: 'Maximum call attempts reached (4)'
      });
    }
  }

  const twoParty = isTwoPartyState(phone_number);

  await supabase.from('voice_compliance').insert({
    diagnostic_id,
    phone_number,
    dnc_checked: true,
    dnc_listed: false,
    consent_verified: true,
    time_zone_verified: true,
    calling_hours_valid: true,
    two_party_state: twoParty,
    approved_to_call: true
  });

  return Response.json({
    approved: true,
    two_party_state: twoParty,
    recording_disclosure: twoParty
      ? 'This call may be recorded for quality purposes.'
      : null
  });
});
