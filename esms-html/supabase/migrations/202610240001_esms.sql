-- ESMS: apply to a fresh Supabase project. No service key is used by the app.
create type public.app_role as enum ('member', 'manager', 'admin');
create type public.mission_status as enum ('todo', 'in_progress', 'done');
create type public.attendance_status as enum ('present', 'absent', 'excused');

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null default '' check (length(full_name) <= 100),
 department text not null default '' check (length(department) <= 100),
 bio text not null default '' check (length(bio) <= 1000),
 role public.app_role not null default 'member', active boolean not null default true,
 created_at timestamptz not null default now()
);
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id, full_name) values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name',''),100));
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create function public.current_role() returns public.app_role language sql stable security definer set search_path = '' as $$
 select role from public.profiles where id = auth.uid() and active;
$$;
create function public.is_staff() returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce(public.current_role() in ('admin','manager'), false);
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce(public.current_role() = 'admin', false);
$$;

create table public.missions (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 3 and 160),
 description text not null default '' check(length(description) <= 5000),
 assignee_id uuid not null references public.profiles(id), created_by uuid not null default auth.uid() references public.profiles(id),
 status public.mission_status not null default 'todo', due_date date not null,
 created_at timestamptz not null default now()
);
create index missions_assignee_idx on public.missions(assignee_id);
create index missions_due_idx on public.missions(due_date);
create table public.meetings (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 3 and 160),
 location text not null check(length(location) between 2 and 200), starts_at timestamptz not null,
 agenda text not null default '' check(length(agenda) <= 5000), created_by uuid not null default auth.uid() references public.profiles(id),
 created_at timestamptz not null default now()
);
create index meetings_starts_idx on public.meetings(starts_at);
create table public.attendances (
 meeting_id uuid not null references public.meetings(id) on delete cascade,
 member_id uuid not null references public.profiles(id), status public.attendance_status not null,
 marked_by uuid not null default auth.uid() references public.profiles(id), updated_at timestamptz not null default now(),
 primary key(meeting_id,member_id)
);
create index attendances_member_idx on public.attendances(member_id);
create table public.documents (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 2 and 160),
 object_path text not null unique, original_name text not null, mime_type text not null,
 size_bytes bigint not null check(size_bytes > 0 and size_bytes <= 10485760),
 uploaded_by uuid not null default auth.uid() references public.profiles(id), created_at timestamptz not null default now()
);
create table public.document_grants (
 document_id uuid not null references public.documents(id) on delete cascade,
 member_id uuid not null references public.profiles(id) on delete cascade,
 granted_by uuid not null default auth.uid() references public.profiles(id), created_at timestamptz not null default now(),
 primary key(document_id,member_id)
);
create index document_grants_member_idx on public.document_grants(member_id);
create table public.audit_log (
 id bigint generated always as identity primary key, actor_id uuid, action text not null,
 entity text not null, record_id text, created_at timestamptz not null default now()
);
create function public.audit_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb;
begin
 row_data := case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
 insert into public.audit_log(actor_id, action, entity, record_id) values
 (auth.uid(), TG_OP, TG_TABLE_NAME, coalesce(row_data->>'id', concat_ws(':',row_data->>'document_id', row_data->>'meeting_id',row_data->>'member_id')));
 return coalesce(new,old);
end $$;

alter table public.profiles enable row level security;
alter table public.missions enable row level security;
alter table public.meetings enable row level security;
alter table public.attendances enable row level security;
alter table public.documents enable row level security;
alter table public.document_grants enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff());
create policy profiles_edit on public.profiles for update to authenticated using (id = auth.uid() and public.current_role() is not null) with check(id = auth.uid());
create policy missions_read on public.missions for select to authenticated using(public.is_staff() or (assignee_id = auth.uid() and public.current_role() is not null));
create policy missions_create on public.missions for insert to authenticated with check(public.is_staff() and created_by = auth.uid());
create policy missions_edit on public.missions for update to authenticated using(public.is_staff()) with check(public.is_staff());
create policy missions_delete on public.missions for delete to authenticated using(public.is_staff());
create policy meetings_read on public.meetings for select to authenticated using(public.current_role() is not null);
create policy meetings_write on public.meetings for insert to authenticated with check(public.is_staff() and created_by = auth.uid());
create policy meetings_edit on public.meetings for update to authenticated using(public.is_staff()) with check(public.is_staff());
create policy meetings_delete on public.meetings for delete to authenticated using(public.is_staff());
create policy attendance_read on public.attendances for select to authenticated using(public.is_staff() or (member_id = auth.uid() and public.current_role() is not null));
create policy attendance_insert on public.attendances for insert to authenticated with check(public.is_staff() and marked_by = auth.uid());
create policy attendance_edit on public.attendances for update to authenticated using(public.is_staff()) with check(public.is_staff() and marked_by = auth.uid());
create policy attendance_delete on public.attendances for delete to authenticated using(public.is_staff());
create policy grants_read on public.document_grants for select to authenticated using(public.is_admin() or (member_id = auth.uid() and public.current_role() is not null));
create policy grants_insert on public.document_grants for insert to authenticated with check(public.is_admin() and granted_by = auth.uid());
create policy grants_delete on public.document_grants for delete to authenticated using(public.is_admin());
create policy documents_read on public.documents for select to authenticated using(public.is_admin() or (public.current_role() is not null and exists(select 1 from public.document_grants g where g.document_id = id and g.member_id = auth.uid())));
create policy documents_insert on public.documents for insert to authenticated with check(public.is_admin() and uploaded_by = auth.uid());
create policy documents_delete on public.documents for delete to authenticated using(public.is_admin());
create policy audit_read on public.audit_log for select to authenticated using(public.is_admin());

-- Explicit grants: members cannot promote themselves even with a direct REST call.
revoke all on public.profiles,public.missions,public.meetings,public.attendances,public.documents,public.document_grants,public.audit_log from anon,authenticated;
grant select on public.profiles,public.missions,public.meetings,public.attendances,public.documents,public.document_grants,public.audit_log to authenticated;
grant update(full_name,department,bio) on public.profiles to authenticated;
grant insert,update,delete on public.missions,public.meetings,public.attendances to authenticated;
grant insert,delete on public.documents,public.document_grants to authenticated;

create function public.set_mission_status(target uuid, new_status public.mission_status) returns void language plpgsql security definer set search_path = '' as $$
begin
 if public.current_role() is null then raise exception 'Forbidden' using errcode='42501'; end if;
 update public.missions set status = new_status where id = target and (assignee_id = auth.uid() or public.is_staff());
 if not found then raise exception 'Forbidden' using errcode='42501'; end if;
end $$;
create function public.set_member_access(target uuid, new_role public.app_role, enabled boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
 -- Serialize access changes and disallow changing one's own administrative access.
 perform pg_advisory_xact_lock(823710);
 if not public.is_admin() or target = auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
 update public.profiles set role = new_role, active = enabled where id = target;
 if not found then raise exception 'Member not found'; end if;
end $$;

create trigger audit_profiles after update on public.profiles for each row execute function public.audit_change();
create trigger audit_missions after insert or update or delete on public.missions for each row execute function public.audit_change();
create trigger audit_meetings after insert or update or delete on public.meetings for each row execute function public.audit_change();
create trigger audit_attendances after insert or update or delete on public.attendances for each row execute function public.audit_change();
create trigger audit_documents after insert or delete on public.documents for each row execute function public.audit_change();
create trigger audit_grants after insert or delete on public.document_grants for each row execute function public.audit_change();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('private-documents','private-documents',false,10485760,array['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
create policy private_files_read on storage.objects for select to authenticated using (
 bucket_id = 'private-documents' and (public.is_admin() or exists(select 1 from public.documents d where d.object_path = name))
);
create policy private_files_insert on storage.objects for insert to authenticated with check(bucket_id = 'private-documents' and public.is_admin());
create policy private_files_delete on storage.objects for delete to authenticated using(bucket_id = 'private-documents' and public.is_admin());

revoke execute on function public.handle_new_user(), public.audit_change(), public.current_role(), public.is_staff(), public.is_admin(), public.set_mission_status(uuid,public.mission_status), public.set_member_access(uuid,public.app_role,boolean) from public,anon;
grant execute on function public.current_role(),public.is_staff(),public.is_admin(),public.set_mission_status(uuid,public.mission_status),public.set_member_access(uuid,public.app_role,boolean) to authenticated;
