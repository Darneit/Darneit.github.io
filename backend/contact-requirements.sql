-- Additive change: retain existing contact submissions and their access policies.
alter table public.contact_messages
  add column if not exists workers integer check (workers between 1 and 100000),
  add column if not exists duration text check (char_length(duration) <= 160);

-- Service-only wrapper preserves the existing submission/throttle transaction.
create or replace function public.submit_contact_with_requirements(
 p_company text, p_name text, p_phone text, p_email text,
 p_project_location text, p_trade text, p_message text, p_fingerprint text,
 p_workers integer default null, p_duration text default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
 if p_workers is not null and (p_workers < 1 or p_workers > 100000) then
   raise exception 'INVALID_WORKERS';
 end if;
 if char_length(p_duration) > 160 then raise exception 'INVALID_DURATION'; end if;
 v_id := public.submit_contact_message_internal(p_company,p_name,p_phone,p_email,
   p_project_location,p_trade,p_message,p_fingerprint);
 update public.contact_messages set workers=p_workers,duration=nullif(btrim(p_duration),'') where id=v_id;
 return v_id;
end;
$$;
revoke all on function public.submit_contact_with_requirements(text,text,text,text,text,text,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.submit_contact_with_requirements(text,text,text,text,text,text,text,text,integer,text) to service_role;
