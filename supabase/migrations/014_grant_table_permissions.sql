-- Tables created via raw SQL migrations do not automatically receive the role
-- grants that Supabase applies to Dashboard-created tables. Without these grants,
-- edge functions using service_role get "permission denied" (Postgres error 42501)
-- even though service_role bypasses RLS.
--
-- service_role: full access (edge functions, internal operations)
-- authenticated: full access (future authenticated client use)
-- anon: no access (these tables are not exposed to anonymous callers)

grant all privileges on table clients             to service_role, authenticated;
grant all privileges on table vas                 to service_role, authenticated;
grant all privileges on table leads               to service_role, authenticated;
grant all privileges on table sequence_templates  to service_role, authenticated;
grant all privileges on table sequence_steps      to service_role, authenticated;
grant all privileges on table email_templates     to service_role, authenticated;
grant all privileges on table lead_enrollments    to service_role, authenticated;
grant all privileges on table call_logs           to service_role, authenticated;
grant all privileges on table scheduled_callbacks to service_role, authenticated;
grant all privileges on table email_sends         to service_role, authenticated;
grant all privileges on table weekly_reports      to service_role, authenticated;
