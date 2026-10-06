# Permission-Based Outreach SOP

How RLS issues found in other people's public repos get handled. This is the only sanctioned contact flow. It exists to be genuinely useful and to build trust — not to farm leads.

## Non-negotiables

1. **Public source only.** We read files anyone can read (raw.githubusercontent.com, api.github.com). We never touch a live database, never run queries against someone's Supabase project, never test an endpoint.
2. **No unproven claims.** A finding goes in an email only when it's been verified at the source level (exact file + line, and a decode/count check where applicable), and the email includes the 30-second verify query so the recipient can confirm it independently. If it can't be verified precisely, it doesn't get sent.
3. **One email, informative only.** No price, no pitch, no product link in the first message. The value IS the finding. Sign-off may link the public method repo "for context, not an ask."
4. **At most one follow-up** (~3 days, "did this reach the right person?"), then stop, forever. A "not interested" reply closes the file permanently.
5. **No key values in emails.** Point to the file and the check, never echo secrets.
6. **No private repos, no guesses.** If the repo requires auth to read, we don't engage. If we can't find a verified owner address (committer email, SECURITY.md, official contact page), we don't send.
7. **No automation of live targeting.** Scans may run on public search to find candidates, but every email is drafted and reviewed individually before sending, and every recipient is deduped against the sent log.

## The flow

1. **Find** (public search): repo-first scans — recently-pushed Supabase repos, then per-repo checks of migrations + env files. Signals: `TO anon USING(true)`, no-TO `USING(true)`, `USING(true) WITH CHECK(true)` for authenticated writes, committed `service_role` JWTs / `sb_secret_` values.
2. **Verify** (STRICT): real shipped app (live domain, team, users — skip students/demos); the finding confirmed in the file; for secrets, a real decode (placeholder values are skipped, never reported).
3. **Reach** (one email): what we found, where, the 30-second verify query, the fix, and "I only read public source — didn't touch your database. No need to reply." Full technical detail in the first email — "found something, reply to see" never works and wastes their time.
4. **Respond** (if they reply): answer the technical question first, completely, for free. If they ask "how did you find this" — answer honestly: public GitHub search. If they ask for more help — that's the natural moment to describe the paid tiers. If they just say thanks — the email is the win; leave it there.
5. **Log**: every send and every reply goes into the lead tracker (`gelir-plani/lead-takip.jsonl`) with source/UTM so the funnel is measurable.

## What this is not

- Not beg-bounty (never a price next to a finding).
- Not a bug-bounty program substitute.
- Not scalable spam: a small number of high-quality, individually verified notes per week.
