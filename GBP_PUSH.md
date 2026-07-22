# Pushing GBP posts live from the Content Calendar — research & setup

**Status:** researched 2026-07-21, **not started** (backlog #22). This is the
"one-click publish a GBP content item to the live Google Business Profile"
feature. Unlike Shopify (mint a token and go), this one is **gated on Google
approving API access**, so read this before committing engineering time.

## Verdict

It's technically possible but it is the heaviest integration on the list, and
most of the work up front is **paperwork and waiting on Google, not code.** You
can't build/test anything until Google grants your Cloud project access to the
Business Profile APIs. Plan for **days-to-weeks of lead time** before a single
post can go out programmatically.

## The two hard gates (both must clear first)

1. **Manual access approval.** Enabling the API in Google Cloud is *not* the
   same as being allowed to call it — Google gives new projects **zero quota**
   until a separate, manual, one-time access request is approved. Requirements:
   - A verified Google Business Profile that's been **active 60+ days**
   - A valid business website
   - A submitted access-request form describing a legitimate use case
     (managing your own location qualifies)
   - Approval typically takes **several days to a few weeks**
2. **OAuth 2.0 — no API keys.** The Business Profile API rejects API keys with
   401 because the data is *user-owned*, not project-owned. You must set up an
   OAuth 2.0 client and have the Google account that manages the listing grant
   consent. That token (refresh token) then lives server-side.

Sources: [Google OAuth for Business Profile](https://developers.google.com/my-business/content/implement-oauth),
[Basic setup](https://developers.google.com/my-business/content/basic-setup).

## One open question to resolve during setup

Google has restricted and reshuffled the "local posts" capability over the
years across the older Google My Business API and the newer Business Profile
APIs. **Confirm during the access request that programmatic post creation is
still available for your account/API version** before assuming it. If post
creation is closed, the feature can't ship regardless of approval — worth
verifying early rather than after building.

## Step-by-step to get to "we can build this"

1. Confirm the Green Kiss GBP is verified and 60+ days active, with a live
   website listed.
2. In Google Cloud Console: create (or reuse) a project → enable the Business
   Profile APIs.
3. Submit the **Business Profile API access request form** for that project;
   describe the use case (publishing our own store's posts from our internal
   ops tool). Wait for approval.
4. Once approved: create an **OAuth 2.0 client ID** (web app), set the
   authorized redirect URI to our api.php OAuth callback.
5. Do the one-time consent flow as the managing Google account; capture the
   **refresh token** and store it server-side in `config.php` (never client-side).
6. Only now is there anything to build/test.

## What we'd build once access is real (fits our existing architecture)

- Server-side OAuth plumbing in `api.php`: an authorize/callback pair, refresh-
  token storage in `config.php` (same "secrets stay server-side" pattern as the
  Omnisend key and Shopify token), and token refresh on expiry.
- A `gbp_publish` action that takes a `gbp`-channel content item id, maps our
  fields (body, CTA type + URL, category, first image) to the Business Profile
  local-post payload, and posts to the account/location's localPosts resource.
- In `ContentCalendar.jsx`: a "Publish to Google" button on `gbp` items
  (editor/admin), a published/last-synced status, and clear error surfacing
  (reuse the toast-on-error pattern the Omnisend/Shopify calls already use).
- Keep the existing GBP **preview** and manual workflow as the fallback for any
  item that fails to publish or predates approval.

## Recommendation

Don't write code yet. Start the **access request now** (step 1–3) since the
clock is Google's, not ours, and confirm post-creation is still open for the
account. When access is granted, the build itself is a normal 1–2 day
integration that slots into the same server-proxy pattern we used for Omnisend
and Shopify. Until then, GBP posts stay planned/drafted here and published by
hand — the in-app preview makes that quick.
