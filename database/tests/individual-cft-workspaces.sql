-- Live integration smoke test. Requires a regular CFT and an admin with their
-- own active CFT profiles. All test schedule writes are rolled back.
begin;
do $$
declare cft_user uuid; cft_trainer uuid; admin_user uuid; admin_trainer uuid;
begin
  select d.user_id,d.id into cft_user,cft_trainer
    from public.cft_directory d join public.profiles p on p.id=d.user_id
    join auth.users u on u.id=d.user_id
    where d.active and not d.is_demo and p.is_active and p.role='cft' and u.email_confirmed_at is not null limit 1;
  select d.user_id,d.id into admin_user,admin_trainer
    from public.cft_directory d join public.profiles p on p.id=d.user_id
    join auth.users u on u.id=d.user_id
    where d.active and not d.is_demo and p.is_active and p.role='admin' and u.email_confirmed_at is not null limit 1;
  if cft_user is null or admin_user is null then raise exception 'Two active test identities are required'; end if;
  perform set_config('amg.test.cft_user',cft_user::text,true);
  perform set_config('amg.test.cft_trainer',cft_trainer::text,true);
  perform set_config('amg.test.admin_user',admin_user::text,true);
  perform set_config('amg.test.admin_trainer',admin_trainer::text,true);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('amg.test.cft_user'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('amg.test.cft_user'),'role','authenticated')::text,true);
do $$
declare work jsonb; result jsonb; action_name text; denied boolean;
  own_trainer uuid := current_setting('amg.test.cft_trainer')::uuid;
  other_trainer uuid := current_setting('amg.test.admin_trainer')::uuid;
  tomorrow date := (now() at time zone 'America/New_York')::date + 1;
begin
  work := public.amg_cft_workspace('load','{}');
  if jsonb_array_length(work->'trainers') <> 1
    or exists(select 1 from jsonb_array_elements(work->'trainers') x where x->>'user_id' <> auth.uid()::text)
    or exists(select 1 from jsonb_array_elements(work->'appointments') x where x->>'trainer_id' <> own_trainer::text)
    or exists(select 1 from jsonb_array_elements(work->'slots') x where x->>'trainer_id' <> own_trainer::text)
    or exists(select 1 from jsonb_array_elements(work->'schedules') x where x->>'trainer_id' <> own_trainer::text)
  then raise exception 'CFT workspace exposed another owner'; end if;

  foreach action_name in array array['availability','add-slots','slot','delete-slot','appointment','save-weekly','stop-weekly'] loop
    denied := false;
    begin
      perform public.amg_cft_workspace(action_name,jsonb_build_object('trainerId',other_trainer,'available',false));
    exception when insufficient_privilege then denied := true;
    end;
    if not denied then raise exception 'Foreign trainer mutation was not denied: %',action_name; end if;
  end loop;

  if exists(select 1 from public.cft_directory where id=other_trainer)
    or exists(select 1 from public.cft_availability where trainer_id=other_trainer)
    or exists(select 1 from public.matchup_appointments where trainer_id=other_trainer)
    or exists(select 1 from public.cft_contacts where trainer_id=other_trainer)
  then raise exception 'Direct table access exposed another trainer'; end if;
  if has_column_privilege('authenticated','public.profiles','role','UPDATE')
    or has_column_privilege('authenticated','public.amg_app_profiles','role','UPDATE')
  then raise exception 'A trainer can change authorization roles'; end if;

  result := public.amg_cft_workspace('add-slots',jsonb_build_object('trainerId',own_trainer,'slots',jsonb_build_array(jsonb_build_object('date',tomorrow,'time','21:00'))));
  if result->>'ok' <> 'true' then raise exception 'Own schedule save failed'; end if;
  work := public.amg_cft_workspace('load','{}');
  if not exists(select 1 from jsonb_array_elements(work->'slots') x where x->>'trainer_id'=own_trainer::text and (x->>'available_date')::date=tomorrow) then
    raise exception 'Own saved schedule was not returned';
  end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('amg.test.admin_user'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('amg.test.admin_user'),'role','authenticated')::text,true);
do $$
declare work jsonb; denied boolean := false;
begin
  work := public.amg_cft_workspace('load','{}');
  if jsonb_array_length(work->'trainers') <> 1
    or exists(select 1 from jsonb_array_elements(work->'trainers') x where x->>'user_id' <> auth.uid()::text)
    or exists(select 1 from jsonb_array_elements(work->'appointments') x where x->>'trainer_id' <> current_setting('amg.test.admin_trainer'))
    or exists(select 1 from jsonb_array_elements(work->'slots') x where x->>'trainer_id' <> current_setting('amg.test.admin_trainer'))
    or exists(select 1 from jsonb_array_elements(work->'schedules') x where x->>'trainer_id' <> current_setting('amg.test.admin_trainer'))
  then raise exception 'Admin personal workspace exposed another trainer'; end if;
  begin
    perform public.amg_cft_workspace('availability',jsonb_build_object('trainerId',current_setting('amg.test.cft_trainer'),'available',false));
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Admin personal workspace changed another trainer'; end if;
  if has_function_privilege('anon','public.amg_cft_workspace(text,jsonb)','EXECUTE') then raise exception 'Anonymous workspace access is enabled'; end if;
end $$;
rollback;
select jsonb_build_object('status','passed','cft_owner_isolation',true,'admin_personal_owner_isolation',true,'foreign_mutations_denied',true,'direct_table_rls_checked',true,'own_schedule_save_verified',true,'test_writes_rolled_back',true) as checks;
