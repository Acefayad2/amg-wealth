-- Secrets are provisioned separately in Supabase Vault, never in migration text.
create or replace function amg_private.invoke_matchup_calendar_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_key text;
  gateway_key text;
begin
  select decrypted_secret into worker_key from vault.decrypted_secrets where name = 'amg_calendar_worker_secret';
  select decrypted_secret into gateway_key from vault.decrypted_secrets where name = 'amg_calendar_worker_gateway_key';
  if worker_key is null or length(worker_key) < 32 or gateway_key is null then
    raise exception 'Calendar scheduler credentials have not been provisioned';
  end if;
  return net.http_post(
    url := 'https://jkwhoisuhcbkokwntrfg.supabase.co/functions/v1/amg-calendar-worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || gateway_key, 'x-amg-calendar-key', worker_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function amg_private.invoke_matchup_calendar_worker() from public, anon, authenticated;
grant execute on function amg_private.invoke_matchup_calendar_worker() to service_role;

select cron.schedule('amg-matchup-calendar-sync', '* * * * *', 'select amg_private.invoke_matchup_calendar_worker();');
