import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ONESX_API_KEY = Deno.env.get('ONESX_API_KEY') || '';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Bundle pricing: { quantity, price_cents_each }
const BUNDLES = [
  { qty: 1,  price_cents: 2500 },
  { qty: 5,  price_cents: 2000 }, // $100 total
  { qty: 10, price_cents: 1750 }, // $175 total
];

function priceForBundle(qty: number): number {
  const bundle = [...BUNDLES].reverse().find(b => qty >= b.qty);
  return bundle ? bundle.price_cents : 2500;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'roofing-measurements ready', bundles: BUNDLES }, { headers: corsHeaders });

  const { action } = body;

  // ORDER: place a measurement order
  if (action === 'order') {
    const { job_id, address, contractor_id, bundle_qty } = body;
    if (!address) return Response.json({ error: 'address required' }, { status: 400, headers: corsHeaders });

    const qty = parseInt(bundle_qty) || 1;
    const priceCents = priceForBundle(qty);

    const { data: report, error: insertErr } = await supabase
      .from('measurement_reports')
      .insert({
        job_id: job_id || null,
        contractor_id: contractor_id || null,
        address,
        status: 'processing',
        provider: ONESX_API_KEY ? 'onesx' : 'manual',
        price_cents: priceCents,
        ordered_at: new Date().toISOString(),
        ordered_by: contractor_id || null,
      })
      .select()
      .single();

    if (insertErr) return Response.json({ error: insertErr.message }, { status: 500, headers: corsHeaders });

    if (ONESX_API_KEY) {
      try {
        const res = await fetch('https://api.1esx.com/v1/orders', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ONESX_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            address,
            report_type: 'full',
            webhook_url: `${SUPABASE_URL}/functions/v1/roofing-measurements`
          })
        });
        const data = await res.json().catch(() => ({}));
        if (data.order_id) {
          await supabase.from('measurement_reports')
            .update({ provider_order_id: data.order_id })
            .eq('id', report.id);
        }
      } catch (e) {
        console.error('1ESX API error:', e);
      }
    } else {
      // Manual fulfillment — log for operator attention
      await supabase.from('system_heartbeats').insert({
        function_name: 'roofing-measurements',
        status: 'ok',
        response_ms: 0,
        error_message: null,
        metadata: { action: 'manual_order', report_id: report.id, address, price_cents: priceCents }
      }).catch(() => {});
    }

    return Response.json({
      ok: true,
      report_id: report.id,
      status: report.status,
      price_cents: priceCents,
      price_display: `$${(priceCents / 100).toFixed(0)}`,
      manual: !ONESX_API_KEY
    }, { headers: corsHeaders });
  }

  // WEBHOOK: 1ESX sends results here
  if (action === 'webhook' || (req.method === 'POST' && body.order_id)) {
    const { order_id, status: providerStatus, report_url, measurements } = body;
    if (!order_id) return Response.json({ ok: false }, { status: 400, headers: corsHeaders });

    const update: Record<string, unknown> = {
      status: providerStatus === 'complete' ? 'complete' : 'failed',
      completed_at: new Date().toISOString()
    };
    if (report_url) update.report_url = report_url;
    if (measurements) {
      update.raw_data = measurements;
      update.total_squares = measurements.total_squares;
      update.predominant_pitch = measurements.predominant_pitch;
      update.ridges_ft = measurements.ridges;
      update.valleys_ft = measurements.valleys;
      update.eaves_ft = measurements.eaves;
      update.rakes_ft = measurements.rakes;
      update.hips_ft = measurements.hips;
    }

    await supabase.from('measurement_reports')
      .update(update)
      .eq('provider_order_id', order_id);

    return Response.json({ ok: true }, { headers: corsHeaders });
  }

  // LIST: get all reports for a contractor
  if (action === 'list') {
    const { contractor_id, job_id } = body;
    let query = supabase.from('measurement_reports').select('*').order('ordered_at', { ascending: false });
    if (contractor_id) query = query.eq('contractor_id', contractor_id);
    if (job_id) query = query.eq('job_id', job_id);
    const { data } = await query.limit(50);
    return Response.json({ ok: true, reports: data || [], bundles: BUNDLES }, { headers: corsHeaders });
  }

  // BUNDLES: return pricing tiers
  if (action === 'bundles') {
    return Response.json({ ok: true, bundles: BUNDLES }, { headers: corsHeaders });
  }

  return Response.json({ error: 'unknown action' }, { status: 400, headers: corsHeaders });
});
