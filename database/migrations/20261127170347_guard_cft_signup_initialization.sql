-- Admin-only Auth metadata marks new registrations before the Auth profile
-- trigger runs. This closes the window before the application row is recorded.
create or replace function amg_private.guard_cft_application_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare decision text; requires_review boolean;
begin
 select coalesce((raw_app_meta_data->>'cft_approval_required')::boolean,false) into requires_review from auth.users where id=new.id;
 if tg_op='INSERT' then
   if requires_review then new.role:='cft';new.is_active:=false;end if;
   return new;
 end if;
 select status into decision from amg_private.cft_applications where user_id=old.id;
 if decision is null and requires_review then decision:='pending';end if;
 if decision is not null then
   if decision<>'approved' and (new.is_active or new.role<>'cft') then raise exception 'AMG approval is required' using errcode='42501'; end if;
   if (new.role is distinct from old.role or new.is_active is distinct from old.is_active) and auth.role() is distinct from 'service_role' and not amg_private.is_cft_reviewer() then
     raise exception 'Only AMG can change trainer account access' using errcode='42501';
   end if;
 end if;
 return new;
end; $$;
drop trigger guard_cft_application_profile on public.profiles;
create trigger guard_cft_application_profile before insert or update on public.profiles for each row execute function amg_private.guard_cft_application_profile();

create or replace function amg_private.guard_cft_application_directory() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (exists(select 1 from amg_private.cft_applications where trainer_id=old.id and status<>'approved')
   or (exists(select 1 from auth.users where id=old.user_id and raw_app_meta_data->>'cft_approval_required'='true')
     and not exists(select 1 from amg_private.cft_applications where trainer_id=old.id and status='approved')))
   and (new.active or new.is_available) then raise exception 'AMG approval is required' using errcode='42501';end if;
 return new;
end; $$;
