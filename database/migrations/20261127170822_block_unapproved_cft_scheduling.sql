-- Existing owner RLS permits direct availability writes. Pending applications
-- must also be blocked there and at the booking write boundary, not only in UI.
create function amg_private.guard_unapproved_cft_records() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.cft_directory d join auth.users u on u.id=d.user_id
   where d.id=new.trainer_id and (
     exists(select 1 from amg_private.cft_applications a where a.trainer_id=d.id and a.status<>'approved')
     or (u.raw_app_meta_data->>'cft_approval_required'='true' and not exists(select 1 from amg_private.cft_applications a where a.trainer_id=d.id and a.status='approved'))
   )) then raise exception 'AMG approval is required before scheduling appointments' using errcode='42501';end if;
 return new;
end; $$;
revoke all on function amg_private.guard_unapproved_cft_records() from public,anon,authenticated;
create trigger guard_unapproved_cft_availability before insert or update on public.cft_availability for each row execute function amg_private.guard_unapproved_cft_records();
create trigger guard_unapproved_cft_bookings before insert or update of trainer_id on public.matchup_appointments for each row execute function amg_private.guard_unapproved_cft_records();
