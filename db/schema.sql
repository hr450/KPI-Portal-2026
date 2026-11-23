-- Rankviz KPI Portal - database schema (PostgreSQL). Safe to run more than once.

create sequence if not exists emp_seq;
create sequence if not exists kpi_seq;
create sequence if not exists sub_seq;

create table if not exists employees (
  id          text primary key default ('E' || nextval('emp_seq')),
  name        text not null,
  email       text not null unique check (email = lower(email)),
  dept        text not null default '',
  role        text not null default 'Staff' check (role in ('HR','CEO','Staff')),
  scored      boolean not null default true,          -- performance is scored (appears in team lists)
  status      text not null default 'Active' check (status in ('Active','Left')),
  join_month  text check (join_month ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

create table if not exists employee_scorers (
  employee_id text not null references employees(id) on delete cascade,
  scorer_id   text not null references employees(id) on delete cascade,
  primary key (employee_id, scorer_id)
);

create table if not exists dept_access (
  scorer_id text not null references employees(id) on delete cascade,
  dept      text not null,
  primary key (scorer_id, dept)
);

create table if not exists kpis (
  id         text primary key default ('K' || nextval('kpi_seq')),
  name       text not null,
  descr      text not null default '',
  active     boolean not null default true,
  scope      text not null default 'ALL' check (scope in ('ALL','TEAM')),
  owner_id   text references employees(id) on delete set null,
  end_month  text
);

create table if not exists kpi_applies (
  kpi_id      text not null references kpis(id) on delete cascade,
  employee_id text not null references employees(id) on delete cascade,
  primary key (kpi_id, employee_id)
);

create table if not exists sub_metrics (
  id          text primary key default ('S' || nextval('sub_seq')),
  kpi_id      text not null references kpis(id) on delete cascade,
  name        text not null,
  criteria    text not null default '',
  weight      numeric(6,2) not null check (weight >= 0 and weight <= 100),
  active      boolean not null default true,
  start_month text,
  end_month   text
);

create table if not exists scores (
  month       text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  employee_id text not null references employees(id) on delete cascade,
  sub_id      text not null references sub_metrics(id) on delete cascade,
  value       numeric(2,1) not null check (value >= 1 and value <= 5),
  scored_by   text,
  updated_at  timestamptz not null default now(),
  primary key (month, employee_id, sub_id)
);
create index if not exists scores_emp_idx on scores (employee_id);

create table if not exists audit_log (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  actor  text,
  action text,
  detail jsonb
);

-- safety copies taken automatically before every "Restore from backup"
create table if not exists backups (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  created_by text,
  reason     text,
  data       jsonb not null
);

-- Supabase security: tables in the "public" schema are reachable through Supabase's public Data API.
-- Turning on Row Level Security (with NO policies) blocks that door completely.
-- Our server connects with the database owner role, which is not affected by RLS.
alter table employees        enable row level security;
alter table employee_scorers enable row level security;
alter table dept_access      enable row level security;
alter table kpis             enable row level security;
alter table kpi_applies      enable row level security;
alter table sub_metrics      enable row level security;
alter table scores           enable row level security;
alter table audit_log        enable row level security;
alter table backups          enable row level security;
