# Nexus Smoke Test Suite Documentation

## Overview

The smoke test suite validates core system functionality and infrastructure health before deployment. These tests ensure critical paths work end-to-end with real database connections, authentication, and external services.

## Test Categories

### 1. Database Connectivity Tests
**Purpose**: Verify database connection, schema integrity, and basic CRUD operations

**Required Configuration**:
- Valid `DATABASE_URL` environment variable
- Database migrations applied
- Test database accessible

**Test Data Setup**:
-- Create test user
INSERT INTO users (id, email, created_at) 
VALUES ('test-smoke-user-001', 'smoke@test.nexus', NOW())
ON CONFLICT (id) DO NOTHING;

-- Create test ability
INSERT INTO abilities (id, user_id, name, status, created_at)
VALUES ('test-smoke-ability-001', 'test-smoke-user-001', 'Smoke Test Ability', 'active', NOW())
ON CONFLICT (id) DO NOTHING;
**Expected Behavior**:
- Connection established within 5 seconds
- SELECT query returns results
- INSERT creates new record
- UPDATE modifies existing record
- DELETE removes record
- Transactions commit successfully
- Foreign key constraints enforced

**Common Failures**:
- **Connection timeout**: Check DATABASE_URL, network access, database running
- **Schema mismatch**: Run migrations with `supabase db push`
- **Permission denied**: Verify database user has required permissions
- **SSL errors**: Check SSL mode in connection string

### 2. Authentication Tests
**Purpose**: Validate user authentication, session management, and JWT verification

**Required Configuration**:
- `SUPABASE_URL` environment variable
- `SUPABASE_ANON_KEY` environment variable
- `SUPABASE_SERVICE_KEY` for admin operations

**Test Data Setup**:
```sql
-- Test user credentials
-- Email: smoketest@nexus.local
-- Password: SmokeTest123!@#
-- Should be created via auth.users, not direct insert

-- Verify auth user exists
SELECT id, email FROM auth.users WHERE email = 'smoketest@nexus.local';
```

**Expected Behavior**:
- User can sign in with valid credentials
- JWT token generated and validated
- Session persists across requests
- Invalid credentials rejected
- Expired tokens refreshed
- Sign out clears session

**Common Failures**:
- **Invalid JWT**: Check SUPABASE_ANON_KEY matches project
- **User not found**: Create test user via Supabase dashboard or API
- **Session expired**: Implement token refresh logic
- **CORS errors**: Configure allowed origins in Supabase settings

### 3. API Endpoint Tests
**Purpose**: Ensure all critical API endpoints respond correctly

**Required Configuration**:
- All edge functions deployed
- Environment variables set in Supabase
- CORS configured

**Test Data Setup**:
No special setup required - uses authenticated test user

**API Endpoints to Test**:

#### GET /api/health
- Expected: 200 OK, `{"status": "healthy"}`
- Validates: Basic API availability

#### GET /api/abilities
- Expected: 200 OK, array of abilities
- Validates: Database query, authentication middleware

#### POST /api/abilities
- Body: `{"name": "Smoke Test Ability", "description": "Test"}`
- Expected: 201 Created, ability object with ID
- Validates: Data creation, validation

#### GET /api/abilities/{id}
- Expected: 200 OK, ability object
- Validates: Parameterized queries, data retrieval

#### PUT /api/abilities/{id}
- Body: `{"name": "Updated Smoke Test"}`
- Expected: 200 OK, updated ability object
- Validates: Data modification

#### DELETE /api/abilities/{id}
- Expected: 204 No Content
- Validates: Data deletion

**Common Failures**:
- **404 Not Found**: Edge function not deployed or wrong path
- **500 Internal Error**: Check function logs in Supabase dashboard
- **Timeout**: Increase timeout or optimize query performance
- **CORS blocked**: Add origin to allowed list

### 4. Message Queue Tests
**Purpose**: Verify async job processing and event handling

**Required Configuration**:
- Message queue service running (pgmq or equivalent)
- Queue tables created
- Worker processes active

**Test Data Setup**:
```sql
-- Create test queue if not exists
SELECT pgmq.create('smoke_test_queue');

-- Send test message
SELECT pgmq.send('smoke_test_queue', '{"test": "smoke", "timestamp": "' || NOW() || '"}');
```

**Expected Behavior**:
- Message enqueued successfully
- Worker picks up message within 10 seconds
- Message processed without errors
- Acknowledgment recorded
- Failed messages moved to DLQ after retries

**Common Failures**:
- **Queue not found**: Run queue initialization migrations
- **Worker not running**: Start worker process
- **Message stuck**: Check worker logs for errors
- **DLQ overflow**: Investigate and resolve failing messages

### 5. Storage Tests
**Purpose**: Validate file upload, download, and deletion

**Required Configuration**:
- Supabase Storage bucket created
- Storage policies configured
- CORS enabled for uploads

**Test Data Setup**:
```javascript
// Create test bucket via Supabase client
const { data, error } = await supabase.storage.createBucket('smoke-test-bucket', {
  public: false,
  fileSizeLimit: 1048576 // 1MB
});
```

**Expected Behavior**:
- File uploads successfully (< 1MB)
- File retrieves with correct content
- File URL generates correctly
- File deletes cleanly
- Access policies enforced

**Common Failures**:
- **Bucket not found**: Create bucket in Supabase dashboard
- **Upload blocked**: Check storage policies and file size
- **CORS error**: Enable CORS in bucket settings
- **Permission denied**: Verify RLS policies allow operation

### 6. Cache Tests
**Purpose**: Ensure caching layer works correctly

**Required Configuration**:
- Redis or similar cache service available
- Cache connection string in environment

**Test Data Setup**:
No special setup - tests create and clean up own keys

**Expected Behavior**:
- SET operation stores value
- GET operation retrieves correct value
- TTL expires keys as expected
- DELETE removes keys
- Cache misses return null

**Common Failures**:
- **Connection refused**: Verify cache service running
- **Authentication failed**: Check cache credentials
- **Memory limit**: Clear old keys or increase limit
- **Network timeout**: Check network connectivity

## Running Smoke Tests

### Local Development
```bash
# Set environment variables
export DATABASE_URL="postgresql://..."
export SUPABASE_URL="https://..."
export SUPABASE_ANON_KEY="..."

# Run full suite
npm run test:smoke

# Run specific category
npm run test:smoke -- --category=database
npm run test:smoke -- --category=auth
npm run test:smoke -- --category=api
```

### CI/CD Pipeline
```yaml
# Required secrets:
# - DATABASE_URL
# - SUPABASE_URL
# - SUPABASE_ANON_KEY
# - SUPABASE_SERVICE_KEY

# Run as pre-deployment gate
# Fail build if any smoke test fails
# Timeout: 5 minutes
```

### Pre-Production
```bash
# Run against staging environment
npm run test:smoke -- --env=staging

# Generate detailed report
npm run test:smoke -- --report=detailed
```

## Test Data Cleanup

After smoke tests complete, clean up test data:

```sql
-- Remove test abilities
DELETE FROM abilities WHERE id LIKE 'test-smoke-%';

-- Remove test users
DELETE FROM users WHERE email LIKE '%@test.nexus';

-- Clear test queue
SELECT pgmq.drop_queue('smoke_test_queue');

-- Remove storage test files
-- Via Supabase client: supabase.storage.emptyBucket('smoke-test-bucket')
```

## Troubleshooting Guide

### All Tests Failing

**Symptoms**: Every smoke test returns error
**Likely Causes**:
1. Environment variables not set
2. Services not running
3. Network connectivity issues

**Resolution Steps**:
1. Verify all required env vars: `env | grep -