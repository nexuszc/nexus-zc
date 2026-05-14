import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface AuditRequest {
  operation: 'check_overdue' | 'process_stale' | 'validate_queue';
  threshold_hours?: number;
}

interface AuditResult {
  success: boolean;
  operation: string;
  items_processed?: number;
  items_found?: number;
  errors?: string[];
  details?: any;
}

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const body: AuditRequest = await req.json();
    
    if (!body.operation) {
      return new Response(
        JSON.stringify({ error: 'Missing operation parameter' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    let result: AuditResult;

    switch (body.operation) {
      case 'check_overdue': {
        const thresholdHours = body.threshold_hours || 24;
        const thresholdDate = new Date(Date.now() - thresholdHours * 60 * 60 * 1000).toISOString();
        
        const { data: overdueItems, error } = await supabaseClient
          .from('improvement_queue')
          .select('*')
          .eq('status', 'pending')
          .lt('created_at', thresholdDate);

        if (error) {
          throw error;
        }

        result = {
          success: true,
          operation: 'check_overdue',
          items_found: overdueItems?.length || 0,
          details: overdueItems,
        };
        break;
      }

      case 'process_stale': {
        const thresholdHours = body.threshold_hours || 72;
        const thresholdDate = new Date(Date.now() - thresholdHours * 60 * 60 * 1000).toISOString();
        
        const { data: staleItems, error: fetchError } = await supabaseClient
          .from('improvement_queue')
          .select('id')
          .eq('status', 'pending')
          .lt('created_at', thresholdDate);

        if (fetchError) {
          throw fetchError;
        }

        if (staleItems && staleItems.length > 0) {
          const { error: updateError } = await supabaseClient
            .from('improvement_queue')
            .update({ status: 'stale', updated_at: new Date().toISOString() })
            .in('id', staleItems.map(item => item.id));

          if (updateError) {
            throw updateError;
          }
        }

        result = {
          success: true,
          operation: 'process_stale',
          items_processed: staleItems?.length || 0,
        };
        break;
      }

      case 'validate_queue': {
        const { data: allItems, error } = await supabaseClient
          .from('improvement_queue')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) {
          throw error;
        }

        const errors: string[] = [];
        const statusCounts: Record<string, number> = {};

        allItems?.forEach(item => {
          statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
          
          if (!item.improvement_data) {
            errors.push(`Item ${item.id} missing improvement_data`);
          }
          
          if (!item.priority || !['low', 'medium', 'high', 'critical'].includes(item.priority)) {
            errors.push(`Item ${item.id} has invalid priority`);
          }
        });

        result = {
          success: true,
          operation: 'validate_queue',
          items_found: allItems?.length || 0,
          errors: errors.length > 0 ? errors : undefined,
          details: { statusCounts },
        };
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid operation' }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
    }

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Audit error:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message || 'Internal server error' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});