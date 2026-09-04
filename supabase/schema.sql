-- =============================================================================
-- VibeLeads AI — schema do Supabase
-- =============================================================================
-- Como usar:
--   1. Crie um projeto em https://supabase.com
--   2. Abra o SQL Editor do projeto e cole/rode este arquivo inteiro
--   3. Copie a "Project URL" e a "anon public key" (Settings > API) para o
--      seu .env (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY)
--
-- O que este arquivo cria:
--   - tabela public.profiles (1 linha por usuário autenticado, ligada a
--     auth.users via id) guardando os dados de perfil e de oferta usados
--     pelo app (os mesmos campos do onboarding e da tela de Configurações)
--   - Row Level Security (RLS): cada usuário só enxerga e edita a própria
--     linha — nunca a de outra pessoa
--   - um trigger que cria automaticamente a linha em profiles assim que um
--     novo usuário se cadastra (auth.users), já preenchendo nome e e-mail
--
-- Não contém nenhuma credencial — apenas estrutura (DDL) e políticas.
-- =============================================================================

-- Extensão usada para gerar valores default, caso ainda não esteja habilitada
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Tabela: profiles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  nome text default '',
  telefone text default '',
  whatsapp text default '',
  empresa text default '',
  instagram text default '',
  site text default '',
  cidade text default '',
  estado text default '',

  -- Respostas do onboarding / oferta usada para gerar mensagens e sites com IA
  onboarding_done boolean not null default false,
  offer jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Perfil e dados de oferta de cada usuário do VibeLeads AI (1 linha por usuário).';

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Criação automática do perfil quando um novo usuário se cadastra
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, nome)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "Usuário lê o próprio perfil" on public.profiles;
create policy "Usuário lê o próprio perfil"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Usuário insere o próprio perfil" on public.profiles;
create policy "Usuário insere o próprio perfil"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Usuário atualiza o próprio perfil" on public.profiles;
create policy "Usuário atualiza o próprio perfil"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Sem política de DELETE de propósito: a exclusão de conta é feita apagando
-- o usuário em auth.users (o "on delete cascade" acima remove o perfil junto).
