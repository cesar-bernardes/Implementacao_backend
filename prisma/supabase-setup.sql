-- GD Tech Implementações
-- Banco: Supabase / PostgreSQL
-- Schema exclusivo da aplicação: implementacao
--
-- Este script é seguro para a primeira instalação e pode ser executado novamente:
-- ele não apaga tabelas nem dados existentes. Os dados demonstrativos usam UPSERT.

begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists implementacao;

-- ENUMS -----------------------------------------------------------------------

do $$ begin
  create type implementacao."GlobalRole" as enum ('GLOBAL_ADMIN', 'GLOBAL_RESTRICTED', 'USER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."OrganizationRole" as enum ('OWNER', 'SUPERVISOR', 'IMPLEMENTATION_RESPONSIBLE', 'VISITOR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."MembershipStatus" as enum ('INVITED', 'ACTIVE', 'SUSPENDED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."TemplateVersionStatus" as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."ImplementationStatus" as enum ('PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."CalendarEventType" as enum ('KICKOFF', 'FOLLOW_UP', 'TRAINING', 'SUPPORT', 'INTERNAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."CalendarEventStatus" as enum ('SCHEDULED', 'CANCELED', 'COMPLETED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."CalendarProvider" as enum ('INTERNAL', 'GOOGLE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."AnswerType" as enum ('CHECKLIST', 'NUMBER', 'SHORT_TEXT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."ChecklistAnswer" as enum ('COMPLETED', 'IN_PROGRESS', 'NOT_DONE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."ApprovalStatus" as enum ('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'CANCELED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."BlockerStatus" as enum ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."BlockerSource" as enum ('MANUAL', 'QUESTION', 'EVIDENCE', 'APPROVAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."WaitingParty" as enum ('CLIENT', 'GD_TECH', 'THIRD_PARTY');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."TaskStatus" as enum ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."Priority" as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."InvitationStatus" as enum ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type implementacao."NotificationStatus" as enum ('UNREAD', 'READ', 'ARCHIVED');
exception when duplicate_object then null; end $$;

-- NÚCLEO: USUÁRIOS, EMPRESAS E ACESSO ----------------------------------------

create table if not exists implementacao.users (
  id uuid primary key default gen_random_uuid(),
  auth_provider_id text not null unique,
  auth_user_id uuid references auth.users(id) on delete set null,
  email text not null unique,
  name text not null,
  global_role implementacao."GlobalRole" not null default 'USER',
  active boolean not null default true,
  first_access_at timestamptz,
  last_access_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_normalized check (email = lower(email))
);

alter table implementacao.users add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table implementacao.users add column if not exists first_access_at timestamptz;
alter table implementacao.users add column if not exists last_access_at timestamptz;
create unique index if not exists users_auth_user_id_idx
  on implementacao.users (auth_user_id) where auth_user_id is not null;

create table if not exists implementacao.organizations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text not null,
  document text unique,
  segment text,
  contact_email text,
  phone text,
  city text,
  state char(2),
  active boolean not null default true,
  is_platform_owner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table implementacao.organizations add column if not exists segment text;
alter table implementacao.organizations add column if not exists contact_email text;
alter table implementacao.organizations add column if not exists phone text;
alter table implementacao.organizations add column if not exists city text;
alter table implementacao.organizations add column if not exists state char(2);

create unique index if not exists organizations_single_platform_owner_idx
  on implementacao.organizations (is_platform_owner)
  where is_platform_owner = true;

create table if not exists implementacao.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references implementacao.users(id) on delete cascade,
  organization_id uuid not null references implementacao.organizations(id) on delete cascade,
  role implementacao."OrganizationRole" not null,
  status implementacao."MembershipStatus" not null default 'INVITED',
  permissions jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, organization_id)
);

create index if not exists memberships_organization_status_idx
  on implementacao.memberships (organization_id, status);
create index if not exists memberships_user_status_idx
  on implementacao.memberships (user_id, status);

create table if not exists implementacao.global_user_organization_scopes (
  user_id uuid not null references implementacao.users(id) on delete cascade,
  organization_id uuid not null references implementacao.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);

create table if not exists implementacao.user_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references implementacao.organizations(id) on delete cascade,
  email text not null,
  name text not null,
  global_role implementacao."GlobalRole" not null default 'USER',
  organization_role implementacao."OrganizationRole",
  token_hash text not null unique,
  status implementacao."InvitationStatus" not null default 'PENDING',
  invited_by uuid references implementacao.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitation_role_scope_check check (
    (organization_id is null and organization_role is null)
    or (organization_id is not null and organization_role is not null)
  )
);

create index if not exists user_invitations_email_status_idx
  on implementacao.user_invitations (email, status);

-- PRODUTOS E TEMPLATES VERSIONADOS -------------------------------------------

create table if not exists implementacao.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table implementacao.products add column if not exists description text;

create table if not exists implementacao.implementation_templates (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references implementacao.products(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists implementation_templates_product_idx
  on implementacao.implementation_templates (product_id);

create table if not exists implementacao.implementation_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references implementacao.implementation_templates(id) on delete cascade,
  version integer not null check (version > 0),
  status implementacao."TemplateVersionStatus" not null default 'DRAFT',
  definition jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

create table if not exists implementacao.template_phases (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references implementacao.implementation_template_versions(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  sort_order integer not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_version_id, code),
  unique (template_version_id, sort_order)
);

create table if not exists implementacao.template_questions (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references implementacao.implementation_template_versions(id) on delete cascade,
  phase_id uuid not null references implementacao.template_phases(id) on delete cascade,
  code text not null,
  prompt text not null,
  response_type implementacao."AnswerType" not null,
  required boolean not null default true,
  response_config jsonb not null default '{}'::jsonb,
  sort_order integer not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_version_id, code),
  unique (phase_id, sort_order)
);

create index if not exists template_questions_phase_idx
  on implementacao.template_questions (phase_id, sort_order);

-- PRODUTOS CONTRATADOS E IMPLEMENTAÇÕES --------------------------------------

create table if not exists implementacao.organization_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references implementacao.organizations(id) on delete cascade,
  product_id uuid not null references implementacao.products(id),
  template_version_id uuid not null references implementacao.implementation_template_versions(id),
  contracted_at date not null default current_date,
  active boolean not null default true,
  auto_sync_template boolean not null default true,
  created_by uuid references implementacao.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_id)
);

create table if not exists implementacao.implementations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references implementacao.organizations(id),
  organization_product_id uuid references implementacao.organization_products(id) on delete set null,
  template_version_id uuid not null references implementacao.implementation_template_versions(id),
  owner_id uuid references implementacao.users(id) on delete set null,
  name text not null,
  status implementacao."ImplementationStatus" not null default 'PLANNED',
  started_at date,
  due_at date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint implementation_dates_check check (due_at is null or started_at is null or due_at >= started_at)
);

alter table implementacao.implementations
  add column if not exists organization_product_id uuid references implementacao.organization_products(id) on delete set null;
alter table implementacao.implementations add column if not exists completed_at timestamptz;

create index if not exists implementations_organization_status_idx
  on implementacao.implementations (organization_id, status);
create index if not exists implementations_owner_status_idx
  on implementacao.implementations (owner_id, status);

create table if not exists implementacao.implementation_phases (
  id uuid primary key default gen_random_uuid(),
  implementation_id uuid not null references implementacao.implementations(id) on delete cascade,
  template_phase_id uuid references implementacao.template_phases(id) on delete set null,
  code text not null,
  name text not null,
  description text,
  sort_order integer not null check (sort_order > 0),
  active boolean not null default true,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (implementation_id, code),
  unique (implementation_id, sort_order)
);

create table if not exists implementacao.implementation_questions (
  id uuid primary key default gen_random_uuid(),
  implementation_id uuid not null references implementacao.implementations(id) on delete cascade,
  implementation_phase_id uuid not null references implementacao.implementation_phases(id) on delete cascade,
  template_question_id uuid references implementacao.template_questions(id) on delete set null,
  code text not null,
  prompt text not null,
  response_type implementacao."AnswerType" not null,
  required boolean not null default true,
  response_config jsonb not null default '{}'::jsonb,
  sort_order integer not null check (sort_order > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (implementation_id, code),
  unique (implementation_phase_id, sort_order)
);

create index if not exists implementation_questions_phase_idx
  on implementacao.implementation_questions (implementation_phase_id, sort_order);

create table if not exists implementacao.implementation_answers (
  id uuid primary key default gen_random_uuid(),
  implementation_question_id uuid not null unique references implementacao.implementation_questions(id) on delete cascade,
  checklist_value implementacao."ChecklistAnswer",
  number_value numeric,
  text_value varchar(100),
  notes text,
  answered_by uuid references implementacao.users(id) on delete set null,
  answered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- DOCUMENTOS, EVIDÊNCIAS, APROVAÇÕES E IMPEDIMENTOS --------------------------

create table if not exists implementacao.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references implementacao.organizations(id) on delete cascade,
  implementation_id uuid references implementacao.implementations(id) on delete cascade,
  uploaded_by uuid references implementacao.users(id) on delete set null,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  storage_bucket text not null default 'implementation-documents',
  storage_path text not null unique,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists documents_organization_implementation_idx
  on implementacao.documents (organization_id, implementation_id, created_at desc);

create table if not exists implementacao.answer_documents (
  answer_id uuid not null references implementacao.implementation_answers(id) on delete cascade,
  document_id uuid not null references implementacao.documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (answer_id, document_id)
);

create table if not exists implementacao.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references implementacao.organizations(id) on delete cascade,
  implementation_id uuid not null references implementacao.implementations(id) on delete cascade,
  implementation_question_id uuid references implementacao.implementation_questions(id) on delete cascade,
  requested_by uuid references implementacao.users(id) on delete set null,
  assigned_to uuid references implementacao.users(id) on delete set null,
  assigned_role implementacao."OrganizationRole",
  status implementacao."ApprovalStatus" not null default 'PENDING',
  title text not null,
  decision_notes text,
  due_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists approval_requests_implementation_status_idx
  on implementacao.approval_requests (implementation_id, status, due_at);

create table if not exists implementacao.blockers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references implementacao.organizations(id) on delete cascade,
  implementation_id uuid not null references implementacao.implementations(id) on delete cascade,
  implementation_phase_id uuid references implementacao.implementation_phases(id) on delete set null,
  implementation_question_id uuid references implementacao.implementation_questions(id) on delete set null,
  approval_request_id uuid references implementacao.approval_requests(id) on delete set null,
  source implementacao."BlockerSource" not null default 'MANUAL',
  status implementacao."BlockerStatus" not null default 'OPEN',
  priority implementacao."Priority" not null default 'HIGH',
  waiting_on implementacao."WaitingParty" not null,
  title text not null,
  description text,
  responsible_user_id uuid references implementacao.users(id) on delete set null,
  responsible_name text,
  blocks_progress boolean not null default true,
  due_at timestamptz,
  resolved_at timestamptz,
  created_by uuid references implementacao.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blockers_implementation_status_idx
  on implementacao.blockers (implementation_id, status, blocks_progress);

create table if not exists implementacao.action_plan_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references implementacao.organizations(id) on delete cascade,
  implementation_id uuid not null references implementacao.implementations(id) on delete cascade,
  blocker_id uuid references implementacao.blockers(id) on delete set null,
  title text not null,
  description text,
  status implementacao."TaskStatus" not null default 'OPEN',
  priority implementacao."Priority" not null default 'MEDIUM',
  assigned_to uuid references implementacao.users(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid references implementacao.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists action_plan_items_implementation_status_idx
  on implementacao.action_plan_items (implementation_id, status, due_at);

-- CALENDÁRIO ------------------------------------------------------------------

create table if not exists implementacao.calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references implementacao.organizations(id),
  implementation_id uuid references implementacao.implementations(id),
  owner_id uuid not null references implementacao.users(id),
  title text not null,
  description text,
  type implementacao."CalendarEventType" not null,
  status implementacao."CalendarEventStatus" not null default 'SCHEDULED',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/Cuiaba',
  client_can_see_details boolean not null default false,
  provider implementacao."CalendarProvider" not null default 'INTERNAL',
  external_event_id text,
  external_calendar_id text,
  meeting_url text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_event_id),
  constraint calendar_event_period_check check (ends_at > starts_at)
);

alter table implementacao.calendar_events add column if not exists meeting_url text;

create index if not exists calendar_events_owner_period_idx
  on implementacao.calendar_events (owner_id, starts_at, ends_at);
create index if not exists calendar_events_organization_start_idx
  on implementacao.calendar_events (organization_id, starts_at);

create table if not exists implementacao.calendar_event_attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references implementacao.calendar_events(id) on delete cascade,
  user_id uuid references implementacao.users(id) on delete set null,
  email text,
  name text,
  response_status text not null default 'NEEDS_ACTION',
  created_at timestamptz not null default now(),
  constraint attendee_identity_check check (user_id is not null or email is not null)
);

create unique index if not exists calendar_event_attendees_event_user_idx
  on implementacao.calendar_event_attendees (event_id, user_id)
  where user_id is not null;
create unique index if not exists calendar_event_attendees_event_email_idx
  on implementacao.calendar_event_attendees (event_id, email)
  where email is not null;

create table if not exists implementacao.calendar_availability (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references implementacao.users(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  start_minute integer not null check (start_minute between 0 and 1439),
  end_minute integer not null check (end_minute between 1 and 1440),
  timezone text not null default 'America/Cuiaba',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_period_check check (end_minute > start_minute),
  unique (user_id, weekday, start_minute, end_minute)
);

create index if not exists calendar_availability_user_day_idx
  on implementacao.calendar_availability (user_id, weekday, active);

-- NOTIFICAÇÕES, SESSÕES E AUDITORIA ------------------------------------------

create table if not exists implementacao.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references implementacao.users(id) on delete cascade,
  organization_id uuid references implementacao.organizations(id) on delete cascade,
  implementation_id uuid references implementacao.implementations(id) on delete cascade,
  title text not null,
  body text not null,
  action_url text,
  status implementacao."NotificationStatus" not null default 'UNREAD',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_status_idx
  on implementacao.notifications (user_id, status, created_at desc);

create table if not exists implementacao.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references implementacao.users(id) on delete cascade,
  refresh_token_hash text not null,
  user_agent text,
  ip_address inet,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_revoked_idx
  on implementacao.sessions (user_id, revoked_at);

create table if not exists implementacao.audit_logs (
  id bigint generated by default as identity primary key,
  organization_id uuid references implementacao.organizations(id),
  actor_id uuid references implementacao.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_organization_created_idx
  on implementacao.audit_logs (organization_id, created_at desc);
create index if not exists audit_logs_entity_idx
  on implementacao.audit_logs (entity_type, entity_id);

-- TRIGGERS E REGRAS -----------------------------------------------------------

create or replace function implementacao.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users', 'organizations', 'memberships', 'user_invitations', 'products',
    'implementation_templates', 'template_phases', 'template_questions',
    'organization_products', 'implementations', 'implementation_phases',
    'implementation_questions', 'implementation_answers', 'approval_requests',
    'blockers', 'action_plan_items', 'calendar_events', 'calendar_availability'
  ] loop
    execute format('drop trigger if exists set_updated_at on implementacao.%I', table_name);
    execute format(
      'create trigger set_updated_at before update on implementacao.%I for each row execute function implementacao.set_updated_at()',
      table_name
    );
  end loop;
end $$;

create or replace function implementacao.validate_answer_type()
returns trigger
language plpgsql
as $$
declare
  expected_type implementacao."AnswerType";
begin
  select response_type
    into expected_type
    from implementacao.implementation_questions
   where id = new.implementation_question_id;

  if expected_type = 'CHECKLIST' then
    if new.checklist_value is null or new.number_value is not null or new.text_value is not null then
      raise exception 'Pergunta CHECKLIST aceita somente checklist_value.';
    end if;
  elsif expected_type = 'NUMBER' then
    if new.number_value is null or new.checklist_value is not null or new.text_value is not null then
      raise exception 'Pergunta NUMBER aceita somente number_value.';
    end if;
  elsif expected_type = 'SHORT_TEXT' then
    if new.text_value is null or new.checklist_value is not null or new.number_value is not null then
      raise exception 'Pergunta SHORT_TEXT aceita somente text_value.';
    end if;
  else
    raise exception 'Tipo de resposta não encontrado.';
  end if;

  new.answered_at = now();
  return new;
end;
$$;

drop trigger if exists validate_answer_type on implementacao.implementation_answers;
create trigger validate_answer_type
before insert or update on implementacao.implementation_answers
for each row execute function implementacao.validate_answer_type();

-- Copia/sincroniza fases e perguntas da versão contratada para a empresa.
-- Respostas existentes são preservadas quando o texto ou a configuração muda.
create or replace function implementacao.sync_implementation_snapshot(p_implementation_id uuid)
returns void
language plpgsql
as $$
declare
  selected_version uuid;
begin
  select template_version_id
    into selected_version
    from implementacao.implementations
   where id = p_implementation_id;

  if selected_version is null then
    raise exception 'Implementação % não encontrada.', p_implementation_id;
  end if;

  update implementacao.implementation_phases ip
     set active = false
   where ip.implementation_id = p_implementation_id
     and ip.template_phase_id is not null
     and not exists (
       select 1
         from implementacao.template_phases tp
        where tp.template_version_id = selected_version
          and tp.code = ip.code
     );

  insert into implementacao.implementation_phases (
    implementation_id, template_phase_id, code, name, description, sort_order, active
  )
  select p_implementation_id, tp.id, tp.code, tp.name, tp.description, tp.sort_order, true
    from implementacao.template_phases tp
   where tp.template_version_id = selected_version
  on conflict (implementation_id, code) do update set
    template_phase_id = excluded.template_phase_id,
    name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    active = true;

  update implementacao.implementation_questions iq
     set active = false
   where iq.implementation_id = p_implementation_id
     and iq.template_question_id is not null
     and not exists (
       select 1
         from implementacao.template_questions tq
        where tq.template_version_id = selected_version
          and tq.code = iq.code
     );

  insert into implementacao.implementation_questions (
    implementation_id, implementation_phase_id, template_question_id,
    code, prompt, response_type, required, response_config, sort_order, active
  )
  select
    p_implementation_id,
    ip.id,
    tq.id,
    tq.code,
    tq.prompt,
    tq.response_type,
    tq.required,
    tq.response_config,
    tq.sort_order,
    true
  from implementacao.template_questions tq
  join implementacao.template_phases tp on tp.id = tq.phase_id
  join implementacao.implementation_phases ip
    on ip.implementation_id = p_implementation_id
   and ip.code = tp.code
  where tq.template_version_id = selected_version
  on conflict (implementation_id, code) do update set
    implementation_phase_id = excluded.implementation_phase_id,
    template_question_id = excluded.template_question_id,
    prompt = excluded.prompt,
    response_type = excluded.response_type,
    required = excluded.required,
    response_config = excluded.response_config,
    sort_order = excluded.sort_order,
    active = true;
end;
$$;

create or replace function implementacao.sync_implementation_snapshot_trigger()
returns trigger
language plpgsql
as $$
begin
  perform implementacao.sync_implementation_snapshot(new.id);
  return new;
end;
$$;

drop trigger if exists sync_implementation_snapshot on implementacao.implementations;
create trigger sync_implementation_snapshot
after insert or update of template_version_id on implementacao.implementations
for each row execute function implementacao.sync_implementation_snapshot_trigger();

-- Views de progresso. "Concluído" conta para o percentual; respostas numéricas
-- e de texto contam quando possuem valor salvo.
create or replace view implementacao.v_implementation_phase_progress
with (security_invoker = true) as
select
  ip.implementation_id,
  ip.id as implementation_phase_id,
  ip.code,
  ip.name,
  ip.sort_order,
  count(iq.id) filter (where iq.active) as total_questions,
  count(ia.id) filter (where iq.active) as answered_questions,
  count(ia.id) filter (
    where iq.active and (
      (iq.response_type = 'CHECKLIST' and ia.checklist_value = 'COMPLETED')
      or (iq.response_type = 'NUMBER' and ia.number_value is not null)
      or (iq.response_type = 'SHORT_TEXT' and ia.text_value is not null)
    )
  ) as completed_questions,
  case
    when count(iq.id) filter (where iq.active) = 0 then 0
    else round(
      100.0 * count(ia.id) filter (
        where iq.active and (
          (iq.response_type = 'CHECKLIST' and ia.checklist_value = 'COMPLETED')
          or (iq.response_type = 'NUMBER' and ia.number_value is not null)
          or (iq.response_type = 'SHORT_TEXT' and ia.text_value is not null)
        )
      ) / count(iq.id) filter (where iq.active), 2
    )
  end as progress_percent
from implementacao.implementation_phases ip
left join implementacao.implementation_questions iq on iq.implementation_phase_id = ip.id
left join implementacao.implementation_answers ia on ia.implementation_question_id = iq.id
where ip.active
group by ip.implementation_id, ip.id, ip.code, ip.name, ip.sort_order;

create or replace view implementacao.v_implementation_progress
with (security_invoker = true) as
with totals as (
  select
    i.id as implementation_id,
    count(iq.id) filter (where iq.active) as total_questions,
    count(ia.id) filter (
      where iq.active and (
        (iq.response_type = 'CHECKLIST' and ia.checklist_value = 'COMPLETED')
        or (iq.response_type = 'NUMBER' and ia.number_value is not null)
        or (iq.response_type = 'SHORT_TEXT' and ia.text_value is not null)
      )
    ) as completed_questions
  from implementacao.implementations i
  left join implementacao.implementation_questions iq on iq.implementation_id = i.id
  left join implementacao.implementation_answers ia on ia.implementation_question_id = iq.id
  group by i.id
)
select
  i.id as implementation_id,
  i.organization_id,
  i.name,
  i.status,
  coalesce(current_phase.code, first_phase.code) as current_phase_code,
  coalesce(current_phase.name, first_phase.name) as current_phase_name,
  t.total_questions,
  t.completed_questions,
  case when t.total_questions = 0 then 0
       else round(100.0 * t.completed_questions / t.total_questions, 2)
  end as progress_percent
from implementacao.implementations i
join totals t on t.implementation_id = i.id
left join lateral (
  select ip.code, ip.name
  from implementacao.implementation_phases ip
  where ip.implementation_id = i.id
    and exists (
      select 1
      from implementacao.implementation_questions iq
      join implementacao.implementation_answers ia on ia.implementation_question_id = iq.id
      where iq.implementation_phase_id = ip.id
    )
  order by ip.sort_order desc
  limit 1
) current_phase on true
left join lateral (
  select ip.code, ip.name
  from implementacao.implementation_phases ip
  where ip.implementation_id = i.id and ip.active
  order by ip.sort_order
  limit 1
) first_phase on true;

-- A visão pública nunca expõe empresa, assunto ou participantes: apenas ocupado.
create or replace view implementacao.v_calendar_busy_slots
with (security_invoker = true) as
select owner_id, starts_at, ends_at, timezone, 'BUSY'::text as availability
from implementacao.calendar_events
where status = 'SCHEDULED';

-- SEGURANÇA: O FRONTEND NÃO ACESSA DIRETAMENTE AS TABELAS ---------------------

do $$
declare
  table_name text;
begin
  for table_name in
    select tablename from pg_tables where schemaname = 'implementacao'
  loop
    execute format('alter table implementacao.%I enable row level security', table_name);
  end loop;
end $$;

revoke all on schema implementacao from anon, authenticated;
revoke all on all tables in schema implementacao from anon, authenticated;
revoke all on all sequences in schema implementacao from anon, authenticated;
revoke all on all functions in schema implementacao from anon, authenticated;

grant usage on schema implementacao to service_role;
grant all on all tables in schema implementacao to service_role;
grant all on all sequences in schema implementacao to service_role;
grant execute on all functions in schema implementacao to service_role;

alter default privileges in schema implementacao grant all on tables to service_role;
alter default privileges in schema implementacao grant all on sequences to service_role;
alter default privileges in schema implementacao grant execute on functions to service_role;

-- DADOS FICTÍCIOS -------------------------------------------------------------

insert into implementacao.organizations (
  id, legal_name, trade_name, document, segment, contact_email, phone, city, state, is_platform_owner
) values
  ('10000000-0000-4000-8000-000000000001', 'GD Tech Demonstração Ltda.', 'GD Tech', null, 'Tecnologia', 'contato@gdtech.demo', null, 'Cuiabá', 'MT', true),
  ('10000000-0000-4000-8000-000000000002', 'Viação Horizonte Demonstração Ltda.', 'Viação Horizonte', '00.000.000/0001-01', 'Transporte e logística', 'contato@horizonte.demo', '(65) 3000-0000', 'Cuiabá', 'MT', false),
  ('10000000-0000-4000-8000-000000000003', 'Logística Pantanal Fictícia Ltda.', 'Logística Pantanal', '00.000.000/0002-84', 'Transporte e logística', 'contato@pantanal.demo', null, 'Cuiabá', 'MT', false)
on conflict (id) do update set
  legal_name = excluded.legal_name,
  trade_name = excluded.trade_name,
  document = excluded.document,
  segment = excluded.segment,
  contact_email = excluded.contact_email,
  phone = excluded.phone,
  city = excluded.city,
  state = excluded.state,
  is_platform_owner = excluded.is_platform_owner;

insert into implementacao.users (id, auth_provider_id, email, name, global_role) values
  ('20000000-0000-4000-8000-000000000001', 'fake-auth-admin', 'admin@gdtech.demo', 'Ana Admin', 'GLOBAL_ADMIN'),
  ('20000000-0000-4000-8000-000000000002', 'fake-auth-consultant', 'consultor@gdtech.demo', 'Carlos Implementador', 'USER'),
  ('20000000-0000-4000-8000-000000000003', 'fake-auth-owner', 'diretoria@horizonte.demo', 'Marina Proprietária', 'USER'),
  ('20000000-0000-4000-8000-000000000004', 'fake-auth-leader', 'operacao@horizonte.demo', 'Rafael Champion', 'USER'),
  ('20000000-0000-4000-8000-000000000005', 'fake-auth-visitor', 'auditoria@horizonte.demo', 'Beatriz Visitante', 'USER'),
  ('20000000-0000-4000-8000-000000000006', 'fake-auth-manager', 'gestor@gdtech.demo', 'Lucas Gestor', 'GLOBAL_RESTRICTED')
on conflict (id) do update set
  auth_provider_id = excluded.auth_provider_id,
  email = excluded.email,
  name = excluded.name,
  global_role = excluded.global_role;

insert into implementacao.memberships (user_id, organization_id, role, status) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'OWNER', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'IMPLEMENTATION_RESPONSIBLE', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'SUPERVISOR', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'OWNER', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 'SUPERVISOR', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', 'VISITOR', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'IMPLEMENTATION_RESPONSIBLE', 'ACTIVE')
on conflict (user_id, organization_id) do update set
  role = excluded.role,
  status = excluded.status;

insert into implementacao.global_user_organization_scopes (user_id, organization_id) values
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000002')
on conflict do nothing;

insert into implementacao.products (id, name, slug, description) values
  ('30000000-0000-4000-8000-000000000001', 'GD Frotas', 'gd-frotas', 'Implementação completa da operação GD Frotas.')
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description;

insert into implementacao.implementation_templates (id, product_id, name) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Implementação GD Frotas')
on conflict (id) do update set name = excluded.name;

insert into implementacao.implementation_template_versions (
  id, template_id, version, status, definition, published_at
) values (
  '50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  1,
  'PUBLISHED',
  '{"product":"GD Frotas","version":1,"phases":10,"questions":49}'::jsonb,
  '2026-08-25T12:00:00Z'
)
on conflict (id) do update set
  status = excluded.status,
  definition = excluded.definition,
  published_at = excluded.published_at;

insert into implementacao.template_phases (
  id, template_version_id, code, name, sort_order
) values
  ('51000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'F01', 'Qualificação e logística', 1),
  ('51000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 'F02', 'Diagnóstico presencial', 2),
  ('51000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', 'F03', 'Acessos e governança', 3),
  ('51000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', 'F04', 'Cadastros auxiliares', 4),
  ('51000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000001', 'F05', 'Cadastro da frota', 5),
  ('51000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000001', 'F06', 'Dashboards e relatórios', 6),
  ('51000000-0000-4000-8000-000000000007', '50000000-0000-4000-8000-000000000001', 'F07', 'Treinamentos presenciais', 7),
  ('51000000-0000-4000-8000-000000000008', '50000000-0000-4000-8000-000000000001', 'F08', 'Abastecimento e posto', 8),
  ('51000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-000000000001', 'F09', 'Registro e check-in', 9),
  ('51000000-0000-4000-8000-000000000010', '50000000-0000-4000-8000-000000000001', 'F10', 'Checklist', 10)
on conflict (template_version_id, code) do update set
  name = excluded.name,
  sort_order = excluded.sort_order;

with question_data(phase_code, code, prompt, sort_order) as (values
  ('F01','QL-01','Validar todos os pré-requisitos obrigatórios',1),
  ('F01','QL-02','Definir escopo, unidades e frota',2),
  ('F01','QL-03','Nomear champion e responsáveis locais',3),
  ('F01','QL-04','Definir agenda da visita',4),
  ('F01','QL-05','Preparar sala e recursos de treinamento',5),
  ('F01','QL-06','Validar acesso aos pontos operacionais',6),
  ('F01','QL-07','Receber bases e documentos antes da visita',7),
  ('F02','DP-01','Realizar kickoff no local',1),
  ('F02','DP-02','Acompanhar o fluxo físico dos veículos',2),
  ('F02','DP-03','Acompanhar o processo de abastecimento',3),
  ('F02','DP-04','Acompanhar checklist e manutenção',4),
  ('F02','DP-05','Testar conectividade nos pontos de uso',5),
  ('F02','DP-06','Definir frota e turno piloto',6),
  ('F03','AG-01','Validar acesso administrador',1),
  ('F03','AG-02','Cadastrar usuários presencialmente',2),
  ('F03','AG-03','Definir permissões e papéis',3),
  ('F03','AG-04','Testar dispositivos da operação',4),
  ('F04','CA-01','Cadastrar centros de custo',1),
  ('F04','CA-02','Cadastrar tipos de veículo e categorias',2),
  ('F04','CA-03','Revisar combustíveis',3),
  ('F04','CA-04','Configurar regra geral de abastecimento',4),
  ('F05','CF-01','Higienizar a base com a equipe local',1),
  ('F05','CF-02','Cadastrar ou importar a frota',2),
  ('F05','CF-03','Conferir veículos fisicamente por amostragem',3),
  ('F05','CF-04','Vincular centros de custo, combustíveis e proprietários',4),
  ('F05','CF-05','Atualizar status ativos e inativos',5),
  ('F06','DR-01','Validar Dashboard de Abastecimento',1),
  ('F06','DR-02','Validar Dashboard de Checklist',2),
  ('F06','DR-03','Testar filtros, colunas e CSV',3),
  ('F07','TP-01','Treinar administradores e gestores',1),
  ('F07','TP-02','Treinar abastecimento e check-in por turno',2),
  ('F07','TP-03','Treinar motoristas no veículo',3),
  ('F07','TP-04','Treinar manutenção',4),
  ('F08','AP-01','Definir metas de consumo',1),
  ('F08','AP-02','Testar ajuste em Registro',2),
  ('F08','AP-03','Testar ajuste de saldo em Gestão',3),
  ('F08','AP-04','Conferir histórico e exportação',4),
  ('F09','RC-01','Definir posição e responsável pelo check-in',1),
  ('F09','RC-02','Executar check-in com veículo real',2),
  ('F09','RC-03','Testar correção de KM e fotos',3),
  ('F09','RC-04','Validar exclusão e cascata de pendências',4),
  ('F09','RC-05','Testar Tarefas do Sistema',5),
  ('F10','CK-01','Construir catálogo de itens com a operação',1),
  ('F10','CK-02','Montar checklists por segmento',2),
  ('F10','CK-03','Configurar regras gerais',3),
  ('F10','CK-04','Cadastrar gestores de notificação',4),
  ('F10','CK-05','Executar checklist com motorista real',5),
  ('F10','CK-06','Validar Operação e Alertas',6),
  ('F10','CK-07','Gerar e tratar Ordem de Serviço',7)
)
insert into implementacao.template_questions (
  template_version_id, phase_id, code, prompt, response_type,
  required, response_config, sort_order
)
select
  '50000000-0000-4000-8000-000000000001',
  tp.id,
  q.code,
  q.prompt,
  'CHECKLIST',
  true,
  '{"options":["COMPLETED","IN_PROGRESS","NOT_DONE"]}'::jsonb,
  q.sort_order
from question_data q
join implementacao.template_phases tp
  on tp.template_version_id = '50000000-0000-4000-8000-000000000001'
 and tp.code = q.phase_code
on conflict (template_version_id, code) do update set
  phase_id = excluded.phase_id,
  prompt = excluded.prompt,
  response_type = excluded.response_type,
  required = excluded.required,
  response_config = excluded.response_config,
  sort_order = excluded.sort_order;

insert into implementacao.organization_products (
  id, organization_id, product_id, template_version_id, contracted_at, created_by
) values (
  '70000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '2026-08-20',
  '20000000-0000-4000-8000-000000000001'
)
on conflict (organization_id, product_id) do update set
  template_version_id = excluded.template_version_id,
  active = true,
  auto_sync_template = true;

insert into implementacao.implementations (
  id, organization_id, organization_product_id, template_version_id,
  owner_id, name, status, started_at, due_at
) values (
  '60000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'Implantação piloto — Viação Horizonte',
  'ACTIVE',
  '2026-08-25',
  '2026-10-04'
)
on conflict (id) do update set
  organization_product_id = excluded.organization_product_id,
  template_version_id = excluded.template_version_id,
  owner_id = excluded.owner_id,
  name = excluded.name,
  status = excluded.status,
  started_at = excluded.started_at,
  due_at = excluded.due_at;

-- Mantém o cenário demonstrativo solicitado: F01 até F09 concluídas; F10 pendente.
insert into implementacao.implementation_answers (
  implementation_question_id, checklist_value, answered_by, notes
)
select
  iq.id,
  'COMPLETED',
  '20000000-0000-4000-8000-000000000002',
  'Resposta fictícia carregada para validação da lógica.'
from implementacao.implementation_questions iq
join implementacao.implementation_phases ip on ip.id = iq.implementation_phase_id
where iq.implementation_id = '60000000-0000-4000-8000-000000000001'
  and ip.sort_order <= 9
on conflict (implementation_question_id) do update set
  checklist_value = excluded.checklist_value,
  number_value = null,
  text_value = null,
  answered_by = excluded.answered_by,
  notes = excluded.notes;

insert into implementacao.calendar_availability (
  user_id, weekday, start_minute, end_minute, timezone
)
select
  '20000000-0000-4000-8000-000000000002',
  weekday,
  480,
  1080,
  'America/Cuiaba'
from generate_series(1, 5) as weekday
on conflict (user_id, weekday, start_minute, end_minute) do nothing;

insert into implementacao.calendar_events (
  id, organization_id, implementation_id, owner_id, title, description,
  type, starts_at, ends_at, client_can_see_details
) values (
  '80000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '60000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'Revisão da fase de check-in',
  'Reunião fictícia do ambiente de demonstração.',
  'FOLLOW_UP',
  '2026-08-26T09:00:00-04:00',
  '2026-08-26T10:00:00-04:00',
  false
)
on conflict (id) do update set
  title = excluded.title,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at;

insert into implementacao.audit_logs (
  organization_id, actor_id, action, entity_type, entity_id, metadata
)
select
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001',
  'DEMO_DATABASE_INITIALIZED',
  'Implementation',
  '60000000-0000-4000-8000-000000000001',
  '{"source":"supabase-setup.sql"}'::jsonb
where not exists (
  select 1 from implementacao.audit_logs
  where action = 'DEMO_DATABASE_INITIALIZED'
    and entity_id = '60000000-0000-4000-8000-000000000001'
);

commit;

-- Verificação final: deve retornar 10 fases, 49 perguntas e 42 concluídas.
select
  p.trade_name as empresa,
  progress.current_phase_code as fase_atual,
  progress.total_questions,
  progress.completed_questions,
  progress.progress_percent
from implementacao.v_implementation_progress progress
join implementacao.organizations p on p.id = progress.organization_id
where progress.implementation_id = '60000000-0000-4000-8000-000000000001';
