# PRTC backend

The public PRTC site remains a static GitHub Pages site. Supabase provides the database, Auth, Storage and Edge Functions.

## Architecture
- Public enquiry form -> `submit-enquiry` Edge Function -> `public.enquiries`
- Careers form + CV -> `submit-application` Edge Function -> `public.applications` + private `cv-private` Storage bucket
- Public client marquee -> read-only `public.clients`
- `/admin/` -> Supabase Auth + RLS-protected administration
- Client logos added through admin -> public `client-logos` Storage bucket

## Security
RLS is enabled on all application tables. Public users cannot read enquiries or applications and cannot access CVs. Admin access is granted through `public.admin_users`, keyed by the authenticated Supabase user UUID. The service-role key is used only inside Edge Functions and must never be placed in public JavaScript.

The CV bucket is private. Approved admins download CVs while authenticated, so Storage RLS is enforced.

## Creating the first admin
1. In Supabase Dashboard open Authentication -> Users.
2. Create/invite the temporary admin email and set a password.
3. Once the user exists, add its UUID to `public.admin_users` with role `admin`.
4. Visit `/admin/` and sign in.
5. Later create the official @prtcgroup.com user, insert its UUID into `admin_users`, verify access, then remove the temporary row/user.

## Forms
The public forms are submitted through Edge Functions rather than directly to Postgres. Edge Functions validate required fields, sanitize lengths, apply a honeypot, basic per-client throttling, and enforce CV type/size limits.

## CV limits
Allowed: PDF, DOC, DOCX. Maximum: 10 MB.

## Email notifications
The Edge Functions support Resend when these Supabase Function secrets are configured:
- `RESEND_API_KEY`
- `ADMIN_NOTIFICATION_EMAIL`
- `NOTIFICATION_FROM_EMAIL`

If these are absent, form submission still works and records are stored; only email notification is skipped.

## Client management
Existing clients are seeded in Supabase but currently reference the existing site assets. New/replaced logos uploaded from admin are stored in the public `client-logos` bucket. The public marquee reads enabled clients ordered by `display_order`.

## Deployment
The website can remain on GitHub Pages. Supabase URL and the publishable key are safe to use in the browser; authorization is enforced by RLS. Never expose a service-role key.

## Local testing
Serve the repository over HTTP rather than opening files directly. The Edge Functions allow the production site, the GitHub Pages domain, and common localhost development ports.

## Replacing temporary email
Admin authorization never compares email addresses in frontend code. Add the official account to Supabase Auth, add its UUID to `admin_users`, test it, then remove the temporary account.

## Notifications
Change the notification recipient by updating the Supabase Function secret `ADMIN_NOTIFICATION_EMAIL`; no application code changes are needed.
