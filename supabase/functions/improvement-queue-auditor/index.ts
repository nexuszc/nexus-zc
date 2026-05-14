import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

interface ImprovementQueueItem {
  id: string;
  improvement_area: string;
  current_state: string;
  desired_outcome: string;
  priority: string;
  status: string;
  created_at: string;
}

interface AuditResult {
  totalItems: number;
  statusBreakdown: Record<string, number>;
  priorityBreakdown: Record<string, number>;
  oldestPending: ImprovementQueueItem | null;
  recentlyCompleted: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: items, error } = await supabase
      .from('improvement_queue')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    const statusBreakdown: Record<string, number> = {};
    const priorityBreakdown: Record<string, number> = {};
    let oldestPending: ImprovementQueueItem | null = null;

    items.forEach((item: ImprovementQueueItem) => {
      statusBreakdown[item.status] = (statusBreakdown[item.status] || 0) + 1;
      priorityBreakdown[item.priority] = (priorityBreakdown[item.priority] || 0) + 1;

      if (item.status === 'pending' && !oldestPending) {
        oldestPending = item;
      }
    });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { count: recentlyCompleted } = await supabase
      .from('improvement_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed')
      .gte('created_at', sevenDaysAgo.toISOString());

    const auditResult: AuditResult = {
      totalItems: items.length,
      statusBreakdown,
      priorityBreakdown,
      oldestPending,
      recentlyCompleted: recentlyCompleted || 0,
    };

    return new Response(JSON.stringify(auditResult), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});