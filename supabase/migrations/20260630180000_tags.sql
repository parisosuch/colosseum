-- Tags on channels and blocks. A plain text[] column rather than a separate
-- tag table: there's no cross-channel tag browsing yet, just per-resource
-- labels, and array containment queries (`tags @> array[...]`) cover that.

alter table public.channel
  add column tags text[] not null default '{}';

alter table public."column"
  add column tags text[] not null default '{}';
