import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface TestContext {
  supabaseClient: ReturnType<typeof createClient>;
  userId?: string;
  sessionId?: string;
  testDataIds: {
    users: string[];
    sessions: string[];
    messages: string[];
    abilities: string[];
  };
}

export async function createTestContext(
  supabaseUrl: string,
  supabaseKey: string,
  options?: { userId?: string; createSession?: boolean }
): Promise<TestContext> {
  const supabaseClient = createClient(supabaseUrl, supabaseKey);
  
  const context: TestContext = {
    supabaseClient,
    testDataIds: {
      users: [],
      sessions: [],
      messages: [],
      abilities: [],
    },
  };

  if (options?.userId) {
    context.userId = options.userId;
    context.testDataIds.users.push(options.userId);
  }

  if (options?.createSession && context.userId) {
    const { data: session, error } = await supabaseClient
      .from('sessions')
      .insert({ user_id: context.userId, status: 'active' })
      .select('id')
      .single();

    if (!error && session) {
      context.sessionId = session.id;
      context.testDataIds.sessions.push(session.id);
    }
  }

  return context;
}

export async function setupTestData(
  context: TestContext,
  options?: {
    createUser?: boolean;
    createSession?: boolean;
    createMessages?: number;
    createAbilities?: string[];
  }
): Promise<void> {
  if (options?.createUser) {
    const { data: user, error } = await context.supabaseClient
      .from('users')
      .insert({ 
        email: `test-${Date.now()}@example.com`,
        created_at: new Date().toISOString() 
      })
      .select('id')
      .single();

    if (!error && user) {
      context.userId = user.id;
      context.testDataIds.users.push(user.id);
    }
  }

  if (options?.createSession && context.userId) {
    const { data: session, error } = await context.supabaseClient
      .from('sessions')
      .insert({ 
        user_id: context.userId, 
        status: 'active',
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (!error && session) {
      context.sessionId = session.id;
      context.testDataIds.sessions.push(session.id);
    }
  }

  if (options?.createMessages && context.sessionId) {
    for (let i = 0; i < options.createMessages; i++) {
      const { data: message, error } = await context.supabaseClient
        .from('messages')
        .insert({
          session_id: context.sessionId,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Test message ${i}`,
          created_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (!error && message) {
        context.testDataIds.messages.push(message.id);
      }
    }
  }

  if (options?.createAbilities && options.createAbilities.length > 0) {
    for (const abilityName of options.createAbilities) {
      const { data: ability, error } = await context.supabaseClient
        .from('abilities')
        .insert({
          name: abilityName,
          version: '1.0.0',
          status: 'active',
          created_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (!error && ability) {
        context.testDataIds.abilities.push(ability.id);
      }
    }
  }
}

export async function teardownTestData(context: TestContext): Promise<void> {
  const errors: Error[] = [];

  if (context.testDataIds.messages.length > 0) {
    const { error } = await context.supabaseClient
      .from('messages')
      .delete()
      .in('id', context.testDataIds.messages);
    
    if (error) errors.push(new Error(`Failed to delete messages: ${error.message}`));
  }

  if (context.testDataIds.sessions.length > 0) {
    const { error } = await context.supabaseClient
      .from('sessions')
      .delete()
      .in('id', context.testDataIds.sessions);
    
    if (error) errors.push(new Error(`Failed to delete sessions: ${error.message}`));
  }

  if (context.testDataIds.abilities.length > 0) {
    const { error } = await context.supabaseClient
      .from('abilities')
      .delete()
      .in('id', context.testDataIds.abilities);
    
    if (error) errors.push(new Error(`Failed to delete abilities: ${error.message}`));
  }

  if (context.testDataIds.users.length > 0) {
    const { error } = await context.supabaseClient
      .from('users')
      .delete()
      .in('id', context.testDataIds.users);
    
    if (error) errors.push(new Error(`Failed to delete users: ${error.message}`));
  }

  if (errors.length > 0) {
    throw new Error(`Teardown errors: ${errors.map(e => e.message).join(', ')}`);
  }
}

export async function verifyTestPrerequisites(
  supabaseUrl: string,
  supabaseKey: string
): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  if (!supabaseUrl) {
    errors.push('SUPABASE_URL is not defined');
  }
  
  if (!supabaseKey) {
    errors.push('SUPABASE_ANON_KEY is not defined');
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const supabaseClient = createClient(supabaseUrl, supabaseKey);

  const tablesToCheck = ['users', 'sessions', 'messages', 'abilities'];
  
  for (const table of tablesToCheck) {
    try {
      const { error } = await supabaseClient
        .from(table)
        .select('id')
        .limit(1);
      
      if (error) {
        errors.push(`Table '${table}' is not accessible: ${error.message}`);
      }
    } catch (e) {
      errors.push(`Failed to query table '${table}': ${e.message}`);
    }
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

export async function cleanTestState(
  supabaseClient: ReturnType<typeof createClient>
): Promise<void> {
  const testEmailPattern = 'test-%@example.com';
  
  const { data: testUsers } = await supabaseClient
    .from('users')
    .select('id')
    .like('email', testEmailPattern);

  if (testUsers && testUsers.length > 0) {
    const userIds = testUsers.map(u => u.id);

    await supabaseClient
      .from('messages')
      .delete()
      .in('session_id', 
        supabaseClient
          .from('sessions')
          .select('id')
          .in('user_id', userIds)
      );

    await supabaseClient
      .from('sessions')
      .delete()