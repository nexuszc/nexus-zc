import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

export interface TestContext {
  supabase: SupabaseClient;
  testUserId?: string;
  testProjectId?: string;
  testTaskId?: string;
  cleanupIds: {
    users: string[];
    projects: string[];
    tasks: string[];
    logs: string[];
  };
}

export async function setupTestContext(): Promise<TestContext> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return {
    supabase,
    cleanupIds: {
      users: [],
      projects: [],
      tasks: [],
      logs: [],
    },
  };
}

export async function teardownTestContext(ctx: TestContext): Promise<void> {
  try {
    if (ctx.cleanupIds.tasks.length > 0) {
      await ctx.supabase
        .from('tasks')
        .delete()
        .in('id', ctx.cleanupIds.tasks);
    }

    if (ctx.cleanupIds.projects.length > 0) {
      await ctx.supabase
        .from('projects')
        .delete()
        .in('id', ctx.cleanupIds.projects);
    }

    if (ctx.cleanupIds.logs.length > 0) {
      await ctx.supabase
        .from('smoke_test_logs')
        .delete()
        .in('id', ctx.cleanupIds.logs);
    }

    if (ctx.cleanupIds.users.length > 0) {
      for (const userId of ctx.cleanupIds.users) {
        await ctx.supabase.auth.admin.deleteUser(userId);
      }
    }
  } catch (error) {
    console.error('Error during teardown:', error);
  }
}

export async function createTestUser(ctx: TestContext): Promise<string> {
  const email = `test-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;
  const password = 'TestPassword123!';

  const { data, error } = await ctx.supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(`Failed to create test user: ${error?.message}`);
  }

  ctx.testUserId = data.user.id;
  ctx.cleanupIds.users.push(data.user.id);

  return data.user.id;
}

export async function createTestProject(ctx: TestContext, userId: string): Promise<string> {
  const { data, error } = await ctx.supabase
    .from('projects')
    .insert({
      name: `Test Project ${Date.now()}`,
      description: 'Test project for smoke tests',
      owner_id: userId,
      status: 'active',
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create test project: ${error?.message}`);
  }

  ctx.testProjectId = data.id;
  ctx.cleanupIds.projects.push(data.id);

  return data.id;
}

export async function createTestTask(
  ctx: TestContext,
  projectId: string,
  userId: string
): Promise<string> {
  const { data, error } = await ctx.supabase
    .from('tasks')
    .insert({
      title: `Test Task ${Date.now()}`,
      description: 'Test task for smoke tests',
      project_id: projectId,
      assigned_to: userId,
      status: 'pending',
      priority: 'medium',
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create test task: ${error?.message}`);
  }

  ctx.testTaskId = data.id;
  ctx.cleanupIds.tasks.push(data.id);

  return data.id;
}

export async function verifyRecordExists(
  ctx: TestContext,
  table: string,
  id: string
): Promise<boolean> {
  const { data, error } = await ctx.supabase
    .from(table)
    .select('id')
    .eq('id', id)
    .single();

  if (error) {
    return false;
  }

  return !!data;
}

export async function verifyRecordCount(
  ctx: TestContext,
  table: string,
  filters: Record<string, any>,
  expectedCount: number
): Promise<boolean> {
  let query = ctx.supabase.from(table).select('id', { count: 'exact' });

  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }

  const { count, error } = await query;

  if (error) {
    throw new Error(`Failed to count records: ${error.message}`);
  }

  return count === expectedCount;
}

export function assertResponse(
  response: any,
  expectedStatus?: number
): void {
  if (expectedStatus && response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}`
    );
  }

  if (!response.data && response.error) {
    throw new Error(`Response error: ${response.error.message}`);
  }
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      message || `Assertion failed: expected ${expected}, got ${actual}`
    );
  }
}

export function assertTrue(condition: boolean, message?: string): void {
  if (!condition) {
    throw new Error(message || 'Assertion failed: expected true');
  }
}

export function assertNotNull<T>(value: T | null | undefined, message?: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message || 'Assertion failed: value is null or undefined');
  }
}

export async function logTestResult(
  ctx: TestContext,
  testName: string,
  success: boolean,
  error?: string
): Promise<void> {
  try {
    const { data } = await ctx.supabase
      .from('smoke_test_logs')
      .insert({
        test_name: testName,
        success,
        error_message: error || null,
        executed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (data?.id) {
      ctx.cleanupIds.logs.push(data.id);
    }
  } catch (err) {
    console.error('Failed to log test result:', err);
  }
}

export function handleTestError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error occurred';
}

export async function waitForCondition(
  condition: () => Promise<boolean>,
  timeoutMs: number = 5000,
  intervalMs: number = 100
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return false;
}

export async function seed