-- Real database role/approval checks. All synthetic accounts and decisions roll back.
begin;
do $$
declare org uuid; candidate uuid:=gen_random_uuid(); rejected uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); trainer uuid; rejected_trainer uuid;
begin
 select id into org from public.amg_organizations where slug='anointed-money-group';
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at,raw_user_meta_data,raw_app_meta_data)
 values(candidate,'qa-cft-'||candidate||'@example.invalid',now(),now(),now(),'{"first_name":"QA","last_name":"Applicant"}','{"role":"cft","cft_approval_required":true}'),
 (rejected,'qa-cft-'||rejected||'@example.invalid',now(),now(),now(),'{"first_name":"QA","last_name":"Declined"}','{"role":"cft","cft_approval_required":true}'),
 (outsider,'qa-cft-'||outsider||'@example.invalid',now(),now(),now(),'{"first_name":"QA","last_name":"Unauthorized"}','{}');
 if exists(select 1 from public.profiles where id in(candidate,rejected) and (is_active or role<>'cft')) then raise exception 'Initial Auth profile was activated before approval';end if;
 insert into public.profiles(id,email,role,is_active) select id,email,'cft',false from auth.users where id in(candidate,rejected)
 on conflict(id) do update set role='cft',is_active=false;
 insert into public.profiles(id,email,role,is_active) select id,email,'admin',true from auth.users where id=outsider
 on conflict(id) do update set role='admin',is_active=true;
 insert into public.cft_directory(user_id,display_name,initials,location,active,is_available,bio) values(candidate,'QA Approval Applicant','QA','',false,false,'Fictional rollback-only CFT application') returning id into trainer;
 insert into public.cft_directory(user_id,display_name,initials,location,active,is_available,bio) values(rejected,'QA Declined Applicant','QD','',false,false,'Fictional rollback-only declined application') returning id into rejected_trainer;
 insert into public.cft_contacts(trainer_id,email,phone) select d.id,u.email,'2025550100' from public.cft_directory d join auth.users u on u.id=d.user_id where d.user_id in(candidate,rejected);
 insert into public.amg_organization_memberships(organization_id,user_id,role,display_name,email,phone,is_active)
 select org,id,'cft','QA Applicant',email,'2025550100',false from auth.users where id in(candidate,rejected);
 perform set_config('amg.qa.candidate',candidate::text,true);perform set_config('amg.qa.rejected',rejected::text,true);perform set_config('amg.qa.outsider',outsider::text,true);
 perform set_config('amg.qa.trainer',trainer::text,true);perform set_config('amg.qa.rejected_trainer',rejected_trainer::text,true);
end; $$;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('amg.qa.application',public.amg_record_cft_application(current_setting('amg.qa.candidate')::uuid,current_setting('amg.qa.trainer')::uuid)::text,true);
select set_config('amg.qa.rejected_application',public.amg_record_cft_application(current_setting('amg.qa.rejected')::uuid,current_setting('amg.qa.rejected_trainer')::uuid)::text,true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('amg.qa.candidate'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('amg.qa.candidate'),'role','authenticated')::text,true);
do $$
declare denied boolean;
begin
 if public.amg_cft_applications('status')->>'status'<>'pending' then raise exception 'Missing pending status';end if;
 if public.amg_cft_applications('list')->>'canReview'<>'false' then raise exception 'Applicant can review';end if;
 denied:=false;begin perform public.amg_cft_applications('approve',jsonb_build_object('id',current_setting('amg.qa.application'),'expectedStatus','pending'));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Self approval allowed';end if;
 denied:=false;begin update public.profiles set is_active=true where id=auth.uid();exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Self activation allowed';end if;
 denied:=false;begin update public.profiles set role='admin' where id=auth.uid();exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Pending privilege escalation allowed';end if;
 denied:=false;begin update public.cft_directory set active=true,is_available=true where id=current_setting('amg.qa.trainer')::uuid;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Directory activation bypass allowed';end if;
 denied:=false;begin insert into public.cft_availability(trainer_id,available_date,start_time,status) values(current_setting('amg.qa.trainer')::uuid,current_date+1,'21:00','open');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Direct availability bypass allowed';end if;
 denied:=false;begin perform public.amg_cft_workspace('load');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Pending CFT workspace access allowed';end if;
 if has_function_privilege('anon','public.amg_cft_applications(text,jsonb)','execute') then raise exception 'Anonymous application access';end if;
 if has_function_privilege('authenticated','public.amg_record_cft_application(uuid,uuid)','execute') then raise exception 'Client can manufacture applications';end if;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('amg.qa.outsider'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('amg.qa.outsider'),'role','authenticated')::text,true);
do $$ declare denied boolean:=false;begin
 begin perform public.amg_cft_applications('approve',jsonb_build_object('id',current_setting('amg.qa.application'),'expectedStatus','pending'));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unassigned admin could approve';end if;
end; $$;
select set_config('request.jwt.claim.sub','2c27970c-28ae-4a70-9d77-ea5c6b037220',true);
select set_config('request.jwt.claims','{"sub":"2c27970c-28ae-4a70-9d77-ea5c6b037220","role":"authenticated"}',true);
do $$ declare result jsonb; denied boolean;begin
 result:=public.amg_cft_applications('list');
 if result->>'canReview'<>'true' or not exists(select 1 from jsonb_array_elements(result->'applications') x where x->>'id'=current_setting('amg.qa.application')) then raise exception 'AMG owner cannot see signup';end if;
 perform public.amg_cft_applications('approve',jsonb_build_object('id',current_setting('amg.qa.application'),'expectedStatus','pending'));
 perform public.amg_cft_applications('approve',jsonb_build_object('id',current_setting('amg.qa.application'),'expectedStatus','pending'));
 denied:=false;begin perform public.amg_cft_applications('decline',jsonb_build_object('id',current_setting('amg.qa.application'),'expectedStatus','pending'));exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Opposite stale decision was accepted';end if;
 perform public.amg_cft_applications('decline',jsonb_build_object('id',current_setting('amg.qa.rejected_application'),'expectedStatus','pending'));
 denied:=false;begin perform public.amg_cft_applications('approve',jsonb_build_object('id',gen_random_uuid(),'expectedStatus','pending'));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unknown application accepted';end if;
end; $$;
select set_config('request.jwt.claim.sub',current_setting('amg.qa.candidate'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('amg.qa.candidate'),'role','authenticated')::text,true);
do $$ declare work jsonb; denied boolean:=false;begin
 if public.amg_cft_applications('status')->>'status'<>'approved' then raise exception 'Approval not visible to applicant';end if;
 work:=public.amg_cft_workspace('load');
 if jsonb_array_length(work->'trainers')<>1 or work->'trainers'->0->>'user_id'<>auth.uid()::text then raise exception 'Approved workspace is not owner scoped';end if;
 if (work->'trainers'->0->>'is_available')::boolean then raise exception 'Approval unexpectedly published availability';end if;
 begin update public.profiles set role='admin' where id=auth.uid();exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Approved CFT can elevate their role';end if;
 perform public.amg_cft_workspace('add-slots',jsonb_build_object('trainerId',current_setting('amg.qa.trainer'),'slots',jsonb_build_array(jsonb_build_object('date',current_date+1,'time','21:00'))));
end; $$;
reset role;
do $$ begin
 if not exists(select 1 from amg_private.cft_applications where id=current_setting('amg.qa.application')::uuid and status='approved' and reviewed_by='2c27970c-28ae-4a70-9d77-ea5c6b037220') then raise exception 'Approval audit missing';end if;
 if exists(select 1 from public.profiles where id=current_setting('amg.qa.rejected')::uuid and is_active) then raise exception 'Declined profile active';end if;
 if exists(select 1 from public.cft_directory where id=current_setting('amg.qa.rejected_trainer')::uuid and active) then raise exception 'Declined directory active';end if;
end; $$;
rollback;
select 'PASS: pending signup, owner approval, decline, role guards, idempotency and scoped workspace; fixture writes rolled back' as result;
