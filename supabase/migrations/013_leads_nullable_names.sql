-- phone is the only required field on leads.
-- first_name and last_name are nullable so CSV imports without name
-- columns don't fail. The unique index on (client_id, phone) is required
-- for ON CONFLICT deduplication — phone must always be stored in
-- normalized form (digits only) for this index to work correctly.

alter table leads alter column first_name drop not null;
alter table leads alter column last_name drop not null;

create unique index idx_leads_phone_per_client
  on leads (client_id, phone);
