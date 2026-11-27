-- Remove only appointment client emails; keep the existing staff push behavior.
-- No account, role, grant, notification preference, or existing record changes.
DO $guard$
BEGIN
  IF pg_get_functiondef('amg_private.matchup_notifications()'::regprocedure) IS DISTINCT FROM $before$CREATE OR REPLACE FUNCTION amg_private.matchup_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare trainer_user uuid; agent_user uuid; heading text; event text; details jsonb; uid uuid;
begin
 select user_id into trainer_user from public.cft_directory where id=new.trainer_id;
 select id into agent_user from auth.users where new.agent_email<>'' and lower(email)=lower(new.agent_email) and email_confirmed_at is not null limit 1;
 if tg_op='INSERT' then
   if new.status='pending' then perform amg_private.queue_notification(trainer_user,'request:'||new.id,'changes','New CFT request','A new matchup request needs your response.','/cft',now()+interval '24 hours',jsonb_build_object('appointmentId',new.id,'status',new.status));
   elsif new.status='confirmed' then
     -- Auto-accepted booking: tell the trainer (and the agent, if they have an AMG login). No response needed.
     details:=jsonb_build_object('appointmentId',new.id,'status',new.status,'date',new.appointment_date,'time',new.appointment_time);
     perform amg_private.queue_notification(trainer_user,'booked:'||new.id,'changes','New appointment booked','An agent booked one of your open times. Open AMG for details.','/cft',now()+interval '24 hours',details);
     if agent_user is not null then perform amg_private.queue_notification(agent_user,'booked:'||new.id,'changes','Appointment confirmed','Your appointment is confirmed. Open AMG for details.','/calendar',now()+interval '24 hours',details); end if;
   end if;
   return new;
 end if;
 if new.status is distinct from old.status and new.status in ('confirmed','cancelled') then
   heading:=case when new.status='confirmed' then 'Appointment accepted' when old.status='pending' then 'Appointment declined' else 'Appointment cancelled' end;
 elsif (new.appointment_date,new.appointment_time,new.trainer_id) is distinct from (old.appointment_date,old.appointment_time,old.trainer_id) and new.status in ('pending','confirmed') then
   heading:='Appointment rescheduled';
 else return new;end if;
 event:='change:'||new.id||':'||txid_current();
 details:=jsonb_build_object('appointmentId',new.id,'status',new.status,'date',new.appointment_date,'time',new.appointment_time);
 for uid in select distinct x from unnest(array[trainer_user,agent_user]) x where x is not null loop
   perform amg_private.queue_notification(uid,event,'changes',heading,'Your appointment has changed. Open AMG for details.',case when uid=trainer_user then '/cft' else '/calendar' end,now()+interval '24 hours',details);
 end loop;
 if new.trainer_id is distinct from old.trainer_id then
   select user_id into uid from public.cft_directory where id=old.trainer_id;
   if uid is not null then perform amg_private.queue_notification(uid,event||':previous','changes','Appointment reassigned','An appointment has been reassigned. Open AMG for details.','/cft',now()+interval '24 hours',details);end if;
 end if;
 if new.client_email<>'' then perform amg_private.queue_notification(null,event,'changes',heading,'Your AMG appointment on '||new.appointment_date||' at '||to_char(new.appointment_time,'HH12:MI AM')||' Eastern Time has been '||case when new.status='confirmed' and heading<>'Appointment rescheduled' then 'accepted.' when new.status='cancelled' then 'cancelled.' else 'rescheduled. Please use the updated date and time in this email.' end,'/calendar',now()+interval '24 hours',details,new.client_email); end if;
 return new;
end; $function$
$before$ THEN
    RAISE EXCEPTION 'Appointment notification function changed; review before applying';
  END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION amg_private.matchup_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare trainer_user uuid; agent_user uuid; heading text; event text; details jsonb; uid uuid;
begin
 select user_id into trainer_user from public.cft_directory where id=new.trainer_id;
 select id into agent_user from auth.users where new.agent_email<>'' and lower(email)=lower(new.agent_email) and email_confirmed_at is not null limit 1;
 if tg_op='INSERT' then
   if new.status='pending' then perform amg_private.queue_notification(trainer_user,'request:'||new.id,'changes','New CFT request','A new matchup request needs your response.','/cft',now()+interval '24 hours',jsonb_build_object('appointmentId',new.id,'status',new.status));
   elsif new.status='confirmed' then
     -- Auto-accepted booking: tell the trainer (and the agent, if they have an AMG login). No response needed.
     details:=jsonb_build_object('appointmentId',new.id,'status',new.status,'date',new.appointment_date,'time',new.appointment_time);
     perform amg_private.queue_notification(trainer_user,'booked:'||new.id,'changes','New appointment booked','An agent booked one of your open times. Open AMG for details.','/cft',now()+interval '24 hours',details);
     if agent_user is not null then perform amg_private.queue_notification(agent_user,'booked:'||new.id,'changes','Appointment confirmed','Your appointment is confirmed. Open AMG for details.','/calendar',now()+interval '24 hours',details); end if;
   end if;
   return new;
 end if;
 if new.status is distinct from old.status and new.status in ('confirmed','cancelled') then
   heading:=case when new.status='confirmed' then 'Appointment accepted' when old.status='pending' then 'Appointment declined' else 'Appointment cancelled' end;
 elsif (new.appointment_date,new.appointment_time,new.trainer_id) is distinct from (old.appointment_date,old.appointment_time,old.trainer_id) and new.status in ('pending','confirmed') then
   heading:='Appointment rescheduled';
 else return new;end if;
 event:='change:'||new.id||':'||txid_current();
 details:=jsonb_build_object('appointmentId',new.id,'status',new.status,'date',new.appointment_date,'time',new.appointment_time);
 for uid in select distinct x from unnest(array[trainer_user,agent_user]) x where x is not null loop
   perform amg_private.queue_notification(uid,event,'changes',heading,'Your appointment has changed. Open AMG for details.',case when uid=trainer_user then '/cft' else '/calendar' end,now()+interval '24 hours',details);
 end loop;
 if new.trainer_id is distinct from old.trainer_id then
   select user_id into uid from public.cft_directory where id=old.trainer_id;
   if uid is not null then perform amg_private.queue_notification(uid,event||':previous','changes','Appointment reassigned','An appointment has been reassigned. Open AMG for details.','/cft',now()+interval '24 hours',details);end if;
 end if;
 -- Appointment updates stay in AMG; do not enqueue client email delivery.
 return new;
end; $function$
;
