-- va_code: short alphanumeric code VAs use to log in to the queue UI.
-- Sam assigns codes when onboarding each VA (e.g. "maria01", "ana02").
-- Unique per client so two clients can both have a VA with code "va1".

alter table vas add column va_code text;

create unique index idx_vas_code_per_client
  on vas (client_id, va_code)
  where va_code is not null;
