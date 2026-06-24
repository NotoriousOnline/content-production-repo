-- Instagram draft/publish history for Social Automation (service role only; RLS with no policies).

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  wp_post_title text not null,
  short_title text,
  instagram_caption text,
  image_base64 text,
  instagram_status text not null default 'pending',
  instagram_post_id text,
  instagram_permalink text,
  error_message text
);

create index if not exists social_posts_created_at_idx on public.social_posts (created_at desc);

alter table public.social_posts enable row level security;

comment on table public.social_posts is 'Instagram draft/publish history for Social Automation tool.';
