import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SERVICE_CHOICES = new Set([
  "Piling & ground works",
  "Foundation works",
  "Masonry works",
  "Structural steel & roofing",
  "Scaffolding",
  "Finishing works",
  "MEP works",
  "Waterproofing & insulation",
  "Road works",
  "Aluminium, glass & metal"
]);

const validName = (value: string) => /^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]{1,119}$/u.test(value);
const validPhone = (value: string) => /^\d{7,15}$/.test(value);

const hasUnsafeControls = (value: string) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
const allowedOrigins = new Set([
  "https://prtcgroup.com",
  "https://www.prtcgroup.com",
  "https://darneit.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));

const clean = (v: unknown, max = 500) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const reply = (body: unknown, status = 200, origin = "") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://prtcgroup.com",
      "Vary": "Origin"
    }
  });

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,"0")).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://prtcgroup.com",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin"
      }
    });
  }

  if (req.method !== "POST") return reply({error:"Method not allowed"},405,origin);
  if (origin && !allowedOrigins.has(origin)) return reply({error:"Origin not allowed"},403,origin);
  if (!origin || !allowedOrigins.has(origin)) return reply({error:"Origin not allowed"},403,origin);
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) return reply({error:"Unsupported content type"},415,origin);
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > 32768) return reply({error:"Request too large"},413,origin);

  try {
    const body = await req.json();
    if (clean(body.website,200)) return reply({ok:true},200,origin);

    const company = clean(body.company,160);
    const name = clean(body.name,120);
    const phone = clean(body.phone,80);
    const email = clean(body.email,180).toLowerCase();
    const project_location = clean(body.project_location,160);
    const trade = clean(body.trade,180);
    const message = clean(body.message,4000);
    const workersRaw = body.workers;
    const workers = workersRaw === '' || workersRaw == null ? null : Number(workersRaw);
    if (workers !== null && ((typeof workersRaw !== 'string' && typeof workersRaw !== 'number') || !Number.isInteger(workers) || workers < 1 || workers > 100000)) {
      return reply({error:"Number of workers must be a whole number between 1 and 100000."},400,origin);
    }
    if (body.duration != null && (typeof body.duration !== 'string' || body.duration.length > 160)) {
      return reply({error:"Contract duration must be 160 characters or fewer."},400,origin);
    }
    const duration = clean(body.duration,160);
    if (hasUnsafeControls(duration)) return reply({error:"Invalid characters in contract duration."},400,origin);

    if (!company || !name || !phone || !email || !trade) return reply({error:"Please complete all required fields."},400,origin);
    if (!validName(name)) return reply({error:"Please enter a valid contact name."},400,origin);
    if (!validPhone(phone)) return reply({error:"Please enter a phone number using 7 to 15 digits only."},400,origin);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({error:"Please enter a valid email address."},400,origin);
    if (!SERVICE_CHOICES.has(trade)) return reply({error:"Please select a valid PRTC manpower service."},400,origin);
    if ([company,name,phone,email,project_location,trade].some(hasUnsafeControls)) return reply({error:"Invalid characters in form fields."},400,origin);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const ua = req.headers.get("user-agent") || "";
    const fingerprint = await sha256(ip + "|" + ua);

    const base = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const res = await fetch(base + "/rest/v1/rpc/submit_contact_with_requirements", {
      method:"POST",
      headers:{
        "apikey":service,
        "Authorization":"Bearer " + service,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        p_company:company,
        p_name:name,
        p_phone:phone,
        p_email:email,
        p_project_location:project_location,
        p_trade:trade,
        p_message:message,
        p_fingerprint:fingerprint,
        p_workers:workers,
        p_duration:duration
      })
    });

    const text = await res.text();
    if (!res.ok) {
      if (text.includes("RATE_LIMITED")) return reply({error:"Too many messages. Please try again later."},429,origin);
      throw new Error(text);
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const notifyEmail = Deno.env.get("ADMIN_NOTIFICATION_EMAIL");
    const fromEmail = Deno.env.get("NOTIFICATION_FROM_EMAIL");
    if (resendKey && notifyEmail && fromEmail) {
      const mailRes = await fetch("https://api.resend.com/emails", {
        method:"POST",
        headers:{"Authorization":"Bearer " + resendKey,"Content-Type":"application/json"},
        body:JSON.stringify({
          from:fromEmail,
          to:[notifyEmail],
          reply_to: email,
          subject:"New PRTC contact message - " + (company || name),
          html:`
          <div style="margin:0;background:#f3f6f8;padding:32px 14px;font-family:Arial,Helvetica,sans-serif;color:#071b2d">
            <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 14px 40px rgba(4,26,48,.10)">
              <div style="background:#041a30;padding:26px 32px">
                <img src="https://raw.githubusercontent.com/Darneit/Darneit.github.io/main/assets/prtc-header-dark.png" alt="PRTC Group" style="display:block;width:170px;height:auto">
              </div>
              <div style="padding:34px 32px 28px">
                <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#0b66c3;margin-bottom:10px">Website notification</div>
                <h1 style="margin:0 0 8px;font-size:28px;line-height:1.2;color:#071b2d">New contact message</h1>
                <p style="margin:0 0 26px;color:#607080;line-height:1.6">A new message was submitted through the PRTC Group website.</p>

                <div style="border:1px solid #e3e9ee;border-radius:14px;overflow:hidden">
                  <div style="padding:14px 18px;border-bottom:1px solid #e9eef2"><strong style="display:inline-block;width:150px">Name</strong>${escapeHtml(name)}</div>
                  <div style="padding:14px 18px;border-bottom:1px solid #e9eef2"><strong style="display:inline-block;width:150px">Company</strong>${escapeHtml(company || "—")}</div>
                  <div style="padding:14px 18px;border-bottom:1px solid #e9eef2"><strong style="display:inline-block;width:150px">Email</strong>${escapeHtml(email)}</div>
                  <div style="padding:14px 18px;border-bottom:1px solid #e9eef2"><strong style="display:inline-block;width:150px">Phone</strong>${escapeHtml(phone)}</div>
                  <div style="padding:14px 18px;border-bottom:1px solid #e9eef2"><strong style="display:inline-block;width:150px">Project location</strong>${escapeHtml(project_location || "—")}</div>
                  <div style="padding:14px 18px"><strong style="display:inline-block;width:150px">Service</strong>${escapeHtml(trade || "—")}</div>
                  <div style="padding:14px 18px"><strong>Workers required</strong> ${escapeHtml(workers ?? "—")}</div>
                  <div style="padding:14px 18px"><strong>Contract duration</strong> ${escapeHtml(duration || "—")}</div>
                </div>

                ${message ? `<div style="margin-top:22px;padding:18px;border-radius:14px;background:#f7f9fb"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#607080;margin-bottom:8px">Message</div><div style="line-height:1.65">${escapeHtml(message)}</div></div>` : ""}

                <div style="margin-top:28px">
                  <a href="https://darneit.github.io/admin/" style="display:inline-block;background:#0b3558;color:#ffffff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">Open Admin Dashboard</a>
                </div>
              </div>
              <div style="padding:18px 32px;background:#f7f9fb;color:#778692;font-size:12px;line-height:1.5">PRTC Group website notification</div>
            </div>
          </div>`
        })
      });
      if (!mailRes.ok) console.error("Resend contact email failed", mailRes.status, await mailRes.text());
      else console.log("Resend contact email sent");
    }

    return reply({ok:true,id:text ? JSON.parse(text) : null},201,origin);
  } catch {
    return reply({error:"We could not send your message right now. Please try again."},500,origin);
  }
});
