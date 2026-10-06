# UTM & Event Tracking Scheme

Goal: know which channel produces scans, audit requests, and sales — with zero analytics services and nothing stored about visitors. Two mechanisms only.

## 1. UTM parameters (links we share)

Every outbound link to the site carries UTMs; the site's JS reads them and stamps them into the audit-request mailto automatically (see `docs/index.html` — `__utm`), so **every inbound lead email arrives pre-tagged**.

| Param | Values | Where used |
|---|---|---|
| `utm_source` | `github` · `devto` · `supabase-community` · `discord` · `reddit` · `partner` · `direct` | every shared link |
| `utm_medium` | `readme` · `article` · `comment` · `profile` · `scan` | how the link was embedded |
| `utm_campaign` | `audit_offers` · `article_rls_leaks` · `partner_<name>` | the initiative |
| `utm_content` | free text | specific placement (e.g. `readme_footer`) |

Ready-made links:
- README footer: `…/?utm_source=github&utm_medium=readme&utm_campaign=audit_offers`
- dev.to articles: `…/?utm_source=devto&utm_medium=article&utm_campaign=article_rls_leaks`
- Partner referrals: `…/?utm_source=partner&utm_medium=profile&utm_campaign=partner_<name>`

## 2. Lead tracker (the only database)

`gelir-plani/lead-takip.jsonl` — one JSON line per lead, appended the moment a lead arrives (from email). Schema:

```json
{"id":"L001","date":"2026-10-05","source":"utm_source=github&utm_medium=readme","repo":"acme/app","status":"new","offer":"","response":"","sale":0,"notes":""}
```

Statuses: `new` → `replied` → `quoted` → `won` / `lost` / `cold`. When a sale clears, `sale` gets the amount and the `GELIR-DEFTERI` gets the revenue entry — income only counts once paid (standing rule).

## 3. What we deliberately do NOT track

- No visitor analytics, no cookies, no pixels on the site (the scanner runs client-side; nothing is logged anywhere).
- Scan counts are unknowable by design — the trade-off for a genuinely private checker is accepted. The measurable funnel starts at the audit-request email, which is the only event that matters for revenue anyway.

## 4. Review ritual

Weekly: count leads by `source`, conversion by status. Channels producing zero leads after a fair window (6+ shared placements and no audit requests) get retired, not scaled — documented in KAMPANYA-LOG.
