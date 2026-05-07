-- VAs: the human execution layer assigned to each client.

create table vas (
  id         uuid        primary key default gen_random_uuid(),
  client_id  uuid        not null references clients(id) on delete cascade,
  name       text        not null,
  email      text,
  phone      text,
  status     text        not null default 'active'
               check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);
