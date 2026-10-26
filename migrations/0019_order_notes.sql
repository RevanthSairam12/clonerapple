-- 0019: Internal order notes.
--
-- Staff notes are append-only: there is no update or delete path. A correction
-- is a new note. The author is kept denormalised so a note keeps its context if
-- the staff account is later removed.

create table if not exists order_notes (
  id           text primary key,
  order_id     text not null references orders(id) on delete cascade,
  body         text not null,
  author_id    text references store_admins(id) on delete set null,
  author_name  text not null default '',
  author_email text not null default '',
  created_at   timestamptz not null default now(),
  constraint order_notes_body_length_check check (char_length(body) between 1 and 2000)
);

create index if not exists idx_order_notes_order_created
  on order_notes(order_id, created_at desc);

alter table order_notes enable row level security;
