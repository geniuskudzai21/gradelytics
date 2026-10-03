-- 001_ai_usage.sql
-- Per-user daily AI quota tracking. Run once in the Supabase SQL Editor.
--
-- The app runs on free model tiers, so the scarce resource is the provider's
-- rate limit, not money. This table records how much AI each user has burned
-- today so the server can cap it before one account eats the whole quota.

create table if not exists public.ai_usage (
    user_id      uuid        not null references auth.users(id) on delete cascade,
    day          date        not null default current_date,
    chat_count   integer     not null default 0,
    vision_count integer     not null default 0,
    updated_at   timestamptz not null default now(),
    primary key (user_id, day)
);

alter table public.ai_usage enable row level security;

-- Server-side quota checks run as service_role; nobody reads this from the
-- browser, so keep every client role out.
revoke all on table public.ai_usage from public, anon, authenticated;

-- Atomic increment. Read-then-write from the server would race two parallel
-- requests past the cap, so the counter has to move inside the database.
create or replace function public.bump_ai_usage(p_user_id uuid, p_kind text)
returns table(chat_count integer, vision_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_chat   integer;
    v_vision integer;
begin
    insert into public.ai_usage as u (user_id, day, chat_count, vision_count)
    values (
        p_user_id,
        current_date,
        case when p_kind = 'chat'   then 1 else 0 end,
        case when p_kind = 'vision' then 1 else 0 end
    )
    on conflict (user_id, day) do update
        set chat_count   = u.chat_count   + case when p_kind = 'chat'   then 1 else 0 end,
            vision_count = u.vision_count + case when p_kind = 'vision' then 1 else 0 end,
            updated_at   = now()
    returning u.chat_count, u.vision_count into v_chat, v_vision;

    return query select v_chat, v_vision;
end;
$$;

revoke all on function public.bump_ai_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(uuid, text) to service_role;