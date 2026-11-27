-- New CFT signups need review; previously active trainers remain unchanged.
create table amg_private.cft_approval_reviewers (
  user_id uuid primary key references auth.users(id),
  organization_id uuid not null references public.amg_organizations(id)
);
create table amg_private.cft_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  trainer_id uuid not null unique references public.cft_directory(id),
  organization_id uuid not null references public.amg_organizations(id),
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
create index cft_applications_pending on amg_private.cft_applications(organization_id,created_at) where status='pending';
alter table amg_private.cft_approval_reviewers enable row level security;
alter table amg_private.cft_applications enable row level security;
revoke all on amg_private.cft_approval_reviewers,amg_private.cft_applications from public,anon,authenticated;

-- The user explicitly requested this capability for their existing AMG account.
insert into amg_private.cft_approval_reviewers(user_id,organization_id)
select u.id,m.organization_id from auth.users u
join public.profiles p on p.id=u.id and p.role='admin' and p.is_active
join public.amg_organization_memberships m on m.user_id=u.id and m.role='platform_admin' and m.is_active
join public.amg_organizations o on o.id=m.organization_id and o.slug='anointed-money-group' and o.is_active
where u.id='2c27970c-28ae-4a70-9d77-ea5c6b037220' and lower(u.email)='acefayad@gmail.com';
do $$ begin
 if not exists(select 1 from amg_private.cft_approval_reviewers) then raise exception 'Verified AMG reviewer account not found'; end if;
end; $$;

create function amg_private.is_cft_reviewer() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from amg_private.cft_approval_reviewers r
 join public.profiles p on p.id=r.user_id and p.role='admin' and p.is_active
 join public.amg_organization_memberships m on m.user_id=r.user_id and m.organization_id=r.organization_id and m.role='platform_admin' and m.is_active
 join public.amg_organizations o on o.id=r.organization_id and o.is_active
 where r.user_id=auth.uid());
$$;
revoke all on function amg_private.is_cft_reviewer() from public,anon,authenticated;

create function amg_private.record_cft_application(p_user_id uuid,p_trainer_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare org uuid; application uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service registration only' using errcode='42501'; end if;
 select m.organization_id into org from public.amg_organization_memberships m
 join public.amg_organizations o on o.id=m.organization_id and o.slug='anointed-money-group' and o.is_active
 join public.profiles p on p.id=m.user_id and p.role='cft' and not p.is_active
 join public.cft_directory d on d.id=p_trainer_id and d.user_id=m.user_id and not d.active and not d.is_available
 where m.user_id=p_user_id and m.role='cft' and not m.is_active;
 if org is null then raise exception 'Inactive CFT registration is incomplete'; end if;
 insert into amg_private.cft_applications(user_id,trainer_id,organization_id) values(p_user_id,p_trainer_id,org) returning id into application;
 return application;
end; $$;
create function public.amg_record_cft_application(p_user_id uuid,p_trainer_id uuid) returns uuid
language sql security invoker set search_path='' as $$ select amg_private.record_cft_application(p_user_id,p_trainer_id); $$;
revoke all on function amg_private.record_cft_application(uuid,uuid),public.amg_record_cft_application(uuid,uuid) from public,anon,authenticated;
grant execute on function amg_private.record_cft_application(uuid,uuid),public.amg_record_cft_application(uuid,uuid) to service_role;

create function amg_private.cft_applications(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare reviewer uuid:=auth.uid(); org uuid; application amg_private.cft_applications; desired text; result jsonb;
begin
 if reviewer is null then raise exception 'Sign in to AMG' using errcode='42501'; end if;
 if action='status' then
   return jsonb_build_object('status',(select a.status from amg_private.cft_applications a where a.user_id=reviewer));
 end if;
 if not amg_private.is_cft_reviewer() then
   if action='list' then return jsonb_build_object('canReview',false,'applications','[]'::jsonb); end if;
   raise exception 'CFT approval access denied' using errcode='42501';
 end if;
 select organization_id into org from amg_private.cft_approval_reviewers where user_id=reviewer;
 if action='list' then
   select coalesce(jsonb_agg(item order by created_at),'[]'::jsonb) into result from (
     select jsonb_build_object('id',a.id,'name',d.display_name,'email',c.email,'phone',c.phone,'bio',d.bio,'status',a.status,'createdAt',a.created_at) item,a.created_at
     from amg_private.cft_applications a join public.cft_directory d on d.id=a.trainer_id and d.user_id=a.user_id
     join public.cft_contacts c on c.trainer_id=d.id where a.organization_id=org and a.status='pending' order by a.created_at limit 100
   ) pending;
   return jsonb_build_object('canReview',true,'applications',result,'pendingCount',(select count(*) from amg_private.cft_applications where organization_id=org and status='pending'));
 end if;
 if action not in ('approve','decline') then raise exception 'Unknown CFT approval action'; end if;
 -- Serialize decisions and recheck the current authority while holding its rows.
 perform 1 from amg_private.cft_approval_reviewers r join public.profiles p on p.id=r.user_id
 join public.amg_organization_memberships m on m.user_id=r.user_id and m.organization_id=r.organization_id
 join public.amg_organizations o on o.id=r.organization_id
 where r.user_id=reviewer and p.role='admin' and p.is_active and m.role='platform_admin' and m.is_active and o.is_active for share of r,p,m,o;
 if not found then raise exception 'CFT approval access denied' using errcode='42501'; end if;
 select * into application from amg_private.cft_applications where id=(payload->>'id')::uuid and organization_id=org for update;
 if not found then raise exception 'Application not found' using errcode='42501'; end if;
 desired:=case when action='approve' then 'approved' else 'declined' end;
 if application.status=desired then return jsonb_build_object('ok',true,'status',desired); end if;
 if application.status<>'pending' or payload->>'expectedStatus' is distinct from 'pending' then raise exception 'Application changed. Refresh before reviewing.' using errcode='40001'; end if;
 update amg_private.cft_applications set status=desired,reviewed_at=now(),reviewed_by=reviewer where id=application.id;
 if desired='approved' then
   update public.profiles set is_active=true where id=application.user_id and role='cft' and not is_active;
   if not found then raise exception 'Applicant profile changed. Review the account before approval.'; end if;
   update public.amg_organization_memberships set is_active=true,updated_at=now() where organization_id=org and user_id=application.user_id and role='cft' and not is_active;
   if not found then raise exception 'Applicant membership changed. Review the account before approval.'; end if;
   update public.cft_directory set active=true,is_available=false,updated_at=now() where id=application.trainer_id and user_id=application.user_id and not active;
   if not found then raise exception 'Applicant trainer profile changed. Review the account before approval.'; end if;
 end if;
 return jsonb_build_object('ok',true,'status',desired);
end; $$;
create function public.amg_cft_applications(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select amg_private.cft_applications(action,payload); $$;
revoke all on function amg_private.cft_applications(text,jsonb),public.amg_cft_applications(text,jsonb) from public,anon;
grant execute on function amg_private.cft_applications(text,jsonb),public.amg_cft_applications(text,jsonb) to authenticated;

-- Owner update policies must not let applicants activate themselves or elevate
-- their role. These guards cover new applications, preserving legacy accounts.
create function amg_private.guard_cft_application_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare decision text;
begin
 select status into decision from amg_private.cft_applications where user_id=old.id;
 if decision is not null then
   if decision<>'approved' and (new.is_active or new.role<>'cft') then raise exception 'AMG approval is required' using errcode='42501'; end if;
   if (new.role is distinct from old.role or new.is_active is distinct from old.is_active) and auth.role() is distinct from 'service_role' and not amg_private.is_cft_reviewer() then
     raise exception 'Only AMG can change trainer account access' using errcode='42501';
   end if;
 end if;
 return new;
end; $$;
create function amg_private.guard_cft_application_directory() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from amg_private.cft_applications where trainer_id=old.id and status<>'approved') and (new.active or new.is_available) then
   raise exception 'AMG approval is required' using errcode='42501';
 end if;
 return new;
end; $$;
revoke all on function amg_private.guard_cft_application_profile(),amg_private.guard_cft_application_directory() from public,anon,authenticated;
create trigger guard_cft_application_profile before update on public.profiles for each row execute function amg_private.guard_cft_application_profile();
create trigger guard_cft_application_directory before update on public.cft_directory for each row execute function amg_private.guard_cft_application_directory();
