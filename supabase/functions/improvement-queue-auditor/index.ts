import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Missing environment variables' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    const staleThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const { data: queueItems, error: fetchError } = await supabase
      .from('improvement_queue')
      .select('*')
      .order('created_at', { ascending: true });

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch queue items', details: fetchError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const staleItems = queueItems?.filter(
      item => item.status === 'pending' && new Date(item.created_at) < staleThreshold
    ) || [];

    const pendingItems = queueItems?.filter(item => item.status === 'pending') || [];
    const processingItems = queueItems?.filter(item => item.status === 'processing') || [];
    const completedItems = queueItems?.filter(item => item.status === 'completed') || [];
    const failedItems = queueItems?.filter(item => item.status === 'failed') || [];

    const auditReport = {
      timestamp: now.toISOString(),
      totalItems: queueItems?.length || 0,
      statusBreakdown: {
        pending: pendingItems.length,
        processing: processingItems.length,
        completed: completedItems.length,
        failed: failedItems.length
      },
      staleItems: {
        count: staleItems.length,
        items: staleItems.map(item => ({
          id: item.id,
          component_path: item.component_path,
          created_at: item.created_at,
          age_hours: Math.floor((now.getTime() - new Date(item.created_at).getTime()) / (1000 * 60 * 60))
        }))
      },
      healthStatus: staleItems.length === 0 ? 'healthy' : 'degraded'
    };

    if (staleItems.length > 0) {
      const { error: updateError } = await supabase
        .from('improvement_queue')
        .update({ status: 'failed', error: 'Item became stale - exceeded 24 hour threshold' })
        .in('id', staleItems.map(item => item.id));

      if (updateError) {
        auditReport.warning = `Failed to update stale items: ${updateError.message}`;
      } else {
        auditReport.staleItems.updated = true;
      }
    }

    return new Response(
      JSON.stringify(auditReport),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});