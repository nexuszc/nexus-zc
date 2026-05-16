import { supabaseAdmin } from '../_shared/supabase.ts';

interface TestResult {
  passed: boolean;
  message: string;
  duration: number;
  skipped?: boolean;
}

export async function testHealthMonitor(): Promise<TestResult> {
  const start = Date.now();
  
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/health-monitor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
      },
      body: JSON.stringify({}),
    });

    const duration = Date.now() - start;

    if (!response.ok) {
      return {
        passed: false,
        message: `Health monitor returned status ${response.status}`,
        duration,
      };
    }

    const data = await response.json();
    
    if (data.status === 'healthy' || data.status === 'degraded') {
      return {
        passed: true,
        message: `Health monitor returned ${data.status}`,
        duration,
      };
    }

    return {
      passed: false,
      message: `Unexpected health status: ${data.status}`,
      duration,
    };
  } catch (error) {
    return {
      passed: false,
      message: `Health monitor error: ${error.message}`,
      duration: Date.now() - start,
    };
  }
}

export async function testGetPublicConfig(): Promise<TestResult> {
  const start = Date.now();
  
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/get-public-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
      },
      body: JSON.stringify({}),
    });

    const duration = Date.now() - start;

    if (!response.ok) {
      return {
        passed: false,
        message: `Get public config returned status ${response.status}`,
        duration,
      };
    }

    const data = await response.json();
    
    if (data.config && typeof data.config === 'object') {
      return {
        passed: true,
        message: 'Public config retrieved successfully',
        duration,
      };
    }

    return {
      passed: false,
      message: 'Invalid config format returned',
      duration,
    };
  } catch (error) {
    return {
      passed: false,
      message: `Get public config error: ${error.message}`,
      duration: Date.now() - start,
    };
  }
}

export async function testChat(): Promise<TestResult> {
  const start = Date.now();
  
  try {
    const { data: testUser, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: `smoke-test-${Date.now()}@test.com`,
      password: 'test-password-123',
      email_confirm: true,
    });

    if (userError || !testUser.user) {
      return {
        passed: false,
        message: `Failed to create test user: ${userError?.message}`,
        duration: Date.now() - start,
      };
    }

    const { data: sessionData, error: sessionError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: testUser.user.email!,
    });

    if (sessionError) {
      await supabaseAdmin.auth.admin.deleteUser(testUser.user.id);
      return {
        passed: false,
        message: `Failed to create session: ${sessionError.message}`,
        duration: Date.now() - start,
      };
    }

    const { data: { session }, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email: testUser.user.email!,
      password: 'test-password-123',
    });

    if (signInError || !session) {
      await supabaseAdmin.auth.admin.deleteUser(testUser.user.id);
      return {
        passed: false,
        message: `Failed to sign in: ${signInError?.message}`,
        duration: Date.now() - start,
      };
    }

    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        message: 'Hello, this is a smoke test',
        conversationId: crypto.randomUUID(),
      }),
    });

    const duration = Date.now() - start;

    await supabaseAdmin.auth.admin.deleteUser(testUser.user.id);

    if (!response.ok) {
      return {
        passed: false,
        message: `Chat returned status ${response.status}`,
        duration,
      };
    }

    const data = await response.json();
    
    if (data.reply || data.error) {
      return {
        passed: true,
        message: 'Chat responded successfully',
        duration,
      };
    }

    return {
      passed: false,
      message: 'Invalid chat response format',
      duration,
    };
  } catch (error) {
    return {
      passed: false,
      message: `Chat test error: ${error.message}`,
      duration: Date.now() - start,
    };
  }
}

export async function testSystemHeartbeat(): Promise<TestResult> {
  const start = Date.now();
  
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/system-heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({}),
    });

    const duration = Date.now() - start;

    if (!response.ok) {
      return {
        passed: false,
        message: `System heartbeat returned status ${response.status}`,
        duration,
      };
    }

    const data = await response.json();
    
    if (data.status && data.timestamp) {
      return {
        passed: true,
        message: `System heartbeat status: ${data.status}`,
        duration,
      };
    }

    return {
      passed: false,
      message: 'Invalid heartbeat response format',
      duration,
    };
  } catch (error) {
    return {
      passed: false,
      message: `System heartbeat error: ${error.message}`,
      duration: Date.now() - start,
    };
  }
}