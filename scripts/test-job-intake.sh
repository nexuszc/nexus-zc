#!/bin/bash
# Job Intake v1 test suite — 15 tests
# Run after deploying nexus-job-intake-voice and nexus-job-intake-sms

echo "=== JOB INTAKE TESTS ==="
PASS=0; FAIL=0

SUPABASE_URL="https://koqpbnxkhgbsnbdjwldx.supabase.co"
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvcXBibnhraGdic25iZGp3bGR4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjkyMzA2NiwiZXhwIjoyMDkyNDk5MDY2fQ.8xaF4ePrSqNBodw1-scsJ9YgOtbv52oGw_F5jP7gTmo"
FUNCTIONS_URL="$SUPABASE_URL/functions/v1"
AUTH="Authorization: Bearer $SERVICE_KEY"
CT="Content-Type: application/json"

check() {
  local label="$1"
  local cmd="$2"
  if eval "$cmd" > /dev/null 2>&1; then
    echo "✅ $label"; ((PASS++))
  else
    echo "❌ $label"; ((FAIL++))
  fi
}

# ── FUNCTIONS DEPLOYED ──────────────────────────────────────────────────────────

check "nexus-job-intake-voice deployed" \
  "curl -sf -X POST '$FUNCTIONS_URL/nexus-job-intake-voice' \
    -H '$AUTH' -H '$CT' \
    -d '{\"test\":true}' | grep -q 'ready'"

check "nexus-job-intake-sms deployed" \
  "curl -sf -X POST '$FUNCTIONS_URL/nexus-job-intake-sms' \
    -H '$AUTH' -H '$CT' \
    -d '{\"test\":true}' | grep -q 'ready'"

# ── DB TABLES EXIST ─────────────────────────────────────────────────────────────

check "contractor_team_members exists" \
  "curl -sf '$SUPABASE_URL/rest/v1/contractor_team_members?limit=1' \
    -H '$AUTH' -H 'apikey: $SERVICE_KEY' | grep -v 'error'"

check "inbound_sessions exists" \
  "curl -sf '$SUPABASE_URL/rest/v1/inbound_sessions?limit=1' \
    -H '$AUTH' -H 'apikey: $SERVICE_KEY' | grep -v 'error'"

# ── ZACH SEEDED AS TEST MEMBER ──────────────────────────────────────────────────

check "Zach seeded as team member" \
  "curl -sf '$SUPABASE_URL/rest/v1/contractor_team_members?phone=eq.%2B17203948574' \
    -H '$AUTH' -H 'apikey: $SERVICE_KEY' | grep -q 'Zach'"

# ── NEW DB COLUMNS ON EXISTING TABLES ──────────────────────────────────────────

check "roofing_jobs has created_by_phone column" \
  "curl -sf '$SUPABASE_URL/rest/v1/roofing_jobs?select=created_by_phone&limit=0' \
    -H '$AUTH' -H 'apikey: $SERVICE_KEY' | grep -v 'error'"

check "portal_photos has uploaded_by_phone column" \
  "curl -sf '$SUPABASE_URL/rest/v1/portal_photos?select=uploaded_by_phone&limit=0' \
    -H '$AUTH' -H 'apikey: $SERVICE_KEY' | grep -v 'error'"

check "portal_activities has created_by column" \
  "curl -sf '$SUPABASE_URL/rest/v1/portal_activities?select=created_by&limit=0' \
    -H '$AUTH' -H 'apikey: $SERVICE_KEY' | grep -v 'error'"

# ── STORAGE BUCKET ──────────────────────────────────────────────────────────────

check "job-photos bucket exists" \
  "curl -sf '$SUPABASE_URL/storage/v1/bucket/job-photos' \
    -H '$AUTH' | grep -q 'job-photos'"

# ── ROLE CONFIGS IN VOICE FUNCTION ─────────────────────────────────────────────

check "All 4 roles defined in voice function" \
  "grep -c 'owner:\|pm:\|sales:\|crew:' \
    supabase/functions/nexus-job-intake-voice/index.ts | grep -qE '^[4-9]|^[1-9][0-9]'"

check "extractJobData function present" \
  "grep -q 'extractJobData' \
    supabase/functions/nexus-job-intake-voice/index.ts"

# ── SMS FUNCTION STRUCTURE ──────────────────────────────────────────────────────

check "handlePhotos in SMS function" \
  "grep -q 'handlePhotos' \
    supabase/functions/nexus-job-intake-sms/index.ts"

check "twilioResponse (TwiML XML) in SMS function" \
  "grep -q 'twilioResponse' \
    supabase/functions/nexus-job-intake-sms/index.ts"

check "awaiting_homeowner_phone state in SMS function" \
  "grep -q 'awaiting_homeowner_phone' \
    supabase/functions/nexus-job-intake-sms/index.ts"

check "processUpdate in SMS function" \
  "grep -q 'processUpdate' \
    supabase/functions/nexus-job-intake-sms/index.ts"

check "sendHomeownerSMS in SMS function" \
  "grep -q 'sendHomeownerSMS' \
    supabase/functions/nexus-job-intake-sms/index.ts"

check "portal_activities insert in SMS function" \
  "grep -q 'portal_activities' \
    supabase/functions/nexus-job-intake-sms/index.ts"

check "job-photos storage upload in SMS function" \
  "grep -q 'job-photos' \
    supabase/functions/nexus-job-intake-sms/index.ts"

# ── TELEGRAM REDIRECTS ──────────────────────────────────────────────────────────

check "pipeline redirects to dashboard" \
  "grep -A2 \"msgLower === 'pipeline'\" \
    supabase/functions/chat/index.ts | grep -q 'app.nexuszc.com'"

check "system health redirects to dashboard" \
  "grep -A2 'msgLower === \"system health\"' \
    supabase/functions/chat/index.ts | grep -q 'app.nexuszc.com'"

check "help simplified to 6 commands" \
  "grep -A8 'msgLower === \"help\"' \
    supabase/functions/chat/index.ts | grep -q 'booked'"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "Results: $PASS passed, $FAIL failed"
echo ""

if [ $FAIL -eq 0 ]; then
  echo "✅ All tests passed."
else
  echo "❌ $FAIL test(s) failed — fix before committing."
  exit 1
fi
