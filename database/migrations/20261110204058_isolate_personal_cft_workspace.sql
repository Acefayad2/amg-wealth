-- The personal CFT portal is scoped to its signed-in owner, even when that
-- account also has administrative permissions elsewhere in AMG.
create or replace function public.amg_cft_workspace(action text, payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result jsonb;
  own_trainers jsonb;
  own_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'An active CFT account is required' using errcode = '42501';
  end if;

  if action = 'load' then
    result := amg_private.cft_workspace(action, payload);
    select coalesce(jsonb_agg(item), '[]'::jsonb), array_agg((item->>'id')::uuid)
      into own_trainers, own_ids
      from jsonb_array_elements(coalesce(result->'trainers', '[]'::jsonb)) item
      where item->>'user_id' = auth.uid()::text;

    return jsonb_build_object(
      'trainers', own_trainers,
      'appointments', coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(result->'appointments', '[]'::jsonb)) item where (item->>'trainer_id')::uuid = any(own_ids)), '[]'::jsonb),
      'slots', coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(result->'slots', '[]'::jsonb)) item where (item->>'trainer_id')::uuid = any(own_ids)), '[]'::jsonb),
      'schedules', coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(result->'schedules', '[]'::jsonb)) item where (item->>'trainer_id')::uuid = any(own_ids)), '[]'::jsonb)
    );
  end if;

  if not exists (
    select 1 from public.cft_directory d
    where d.id = (payload->>'trainerId')::uuid and d.user_id = auth.uid() and d.active
  ) then
    raise exception 'You can only manage your own trainer workspace' using errcode = '42501';
  end if;
  return amg_private.cft_workspace(action, payload);
end;
$$;

revoke all on function public.amg_cft_workspace(text, jsonb) from public, anon;
grant execute on function public.amg_cft_workspace(text, jsonb) to authenticated;
