alter table public.profiles
 add column username text unique check(username ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
 add column first_name text not null default '' check(length(first_name)<=50),
 add column last_name text not null default '' check(length(last_name)<=50),
 add column academic_year text not null default '' check(academic_year='' or academic_year ~ '^20[0-9]{2}-20[0-9]{2}$'),
 add column cells text[] not null default '{}' check(cardinality(cells)<=8 and cells <@ array['Event','Sponsoring','Communication','Média','Design','Soirée et Show','Logistique','Jeux et Sport']);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,full_name,username,first_name,last_name,department,academic_year,cells)
 values(new.id,
 left(coalesce(new.raw_user_meta_data->>'full_name',''),100),
 nullif(lower(new.raw_user_meta_data->>'username'),''),
 coalesce(new.raw_user_meta_data->>'first_name',''),
 coalesce(new.raw_user_meta_data->>'last_name',''),
 coalesce(new.raw_user_meta_data->>'department',''),
 coalesce(new.raw_user_meta_data->>'academic_year',''),
 coalesce(array(select jsonb_array_elements_text(new.raw_user_meta_data->'cells')),'{}'));
 return new;
end $$;
grant update(first_name,last_name,academic_year,cells) on public.profiles to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-photos','profile-photos',false,2097152,array['image/jpeg']);
create policy profile_photo_read on storage.objects for select to authenticated using(
 bucket_id='profile-photos' and public.current_role() is not null and
 (name=auth.uid()::text or public.is_staff())
);
create policy profile_photo_insert on storage.objects for insert to authenticated with check(
 bucket_id='profile-photos' and name=auth.uid()::text and public.current_role() is not null
);
create policy profile_photo_update on storage.objects for update to authenticated using(
 bucket_id='profile-photos' and name=auth.uid()::text and public.current_role() is not null
) with check(bucket_id='profile-photos' and name=auth.uid()::text and public.current_role() is not null);
