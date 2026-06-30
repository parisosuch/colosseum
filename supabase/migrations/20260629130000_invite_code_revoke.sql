-- Allow members to revoke their own invite codes.
--
-- The original invite migration intentionally shipped no delete policy. Revoking
-- is limited to UNUSED codes (uses = 0): a used code is already spent, and
-- deleting it would cascade-remove its invite_redemption audit row.
create policy "invite_code: delete own unused"
  on public.invite_code for delete to authenticated
  using (auth.uid() = created_by and uses = 0);
