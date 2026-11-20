"""Registration welcome email via Resend for VyaparX ERP.

Sent exactly once per successful registration, in a fire-and-forget style:
a delivery failure never breaks or rolls back the registration itself.
"""
import html
import json
import logging
import threading
from datetime import datetime, timezone as dt_timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email

logger = logging.getLogger(__name__)

# Idempotency guard: remember which registrations already received a welcome
# email within this process so a retry of the same request never sends twice.
_WELCOME_SENT = set()
_WELCOME_LOCK = threading.Lock()


def _escape(value):
    return html.escape(str(value or ""), quote=True)


def _app_login_url():
    """Public login/dashboard URL from configuration; never invented."""
    return str(getattr(settings, "APP_PUBLIC_URL", "") or "").strip().rstrip("/")


def _logo_url():
    """Public HTTPS logo URL. Uses APP_PUBLIC_URL when configured; otherwise a
    stable branded placeholder block is rendered instead of a broken image."""
    base = _app_login_url()
    if base:
        return f"{base}frontend/assets/logo.png"
    return ""


def _render_html(user_name, company_name, login_url, logo_url, support_email):
    safe_name = _escape(user_name)
    safe_company = _escape(company_name)
    company_block = (
        f'<p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">'
        f"Your company <strong style=\"color:#0f172a;\">{safe_company}</strong> "
        "has been registered successfully.</p>"
        if company_name else ""
    )
    logo_block = (
        f'<img src="{_escape(logo_url)}" alt="VyaparX" width="112" style="width:112px;height:auto;display:block;border:0;outline:none;" />'
        if logo_url
        else '<div style="font-size:30px;font-weight:800;color:#1d4ed8;letter-spacing:-0.5px;">VX <span style="color:#0f172a;">VyaparX</span></div>'
    )
    features = [
        ("CRM &amp; Customer Management",
         "Organize customer information, manage leads, and track follow-ups."),
        ("Sales &amp; Quotation Management",
         "Create quotations, manage sales orders, and monitor order status."),
        ("Purchase &amp; Vendor Management",
         "Manage purchase workflows, suppliers, and material procurement."),
        ("Inventory Management",
         "Track stock availability and monitor material movement."),
        ("Production Management",
         "Plan production requests, materials, and order progress."),
        ("Transport Management",
         "Coordinate deliveries and keep transport connected with sales."),
        ("Accounting &amp; Business Reports",
         "Review financial information and gain better business visibility."),
    ]
    feature_rows = "".join(
        f'<tr>'
        f'<td style="padding:10px 0;border-bottom:1px solid #eef2f7;">'
        f'<div style="font-size:14px;font-weight:700;color:#1d4ed8;">&#9679; {title}</div>'
        f'<div style="font-size:13px;color:#64748b;padding-top:3px;">{desc}</div>'
        f'</td></tr>'
        for title, desc in features
    )
    year = datetime.now(dt_timezone.utc).year
    support_line = (
        f'If you did not create this account, contact our support team at '
        f'<a href="mailto:{_escape(support_email)}" style="color:#1d4ed8;text-decoration:none;">{_escape(support_email)}</a>.'
        if support_email else
        "If you did not create this account, please contact our support team."
    )
    cta = (
        f'<a href="{_escape(login_url)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;'
        f'font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:999px;'
        f'letter-spacing:0.2px;">Get Started with VyaparX &rarr;</a>'
        if login_url else
        '<span style="font-size:14px;color:#64748b;">Open your VyaparX application to begin.</span>'
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Welcome to VyaparX</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">Your business journey starts here. Discover a smarter way to manage your business with VyaparX ERP.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,0.08);">
  <!-- Header -->
  <tr><td style="background:#0b1b3a;padding:30px 36px;" align="center">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:12px;vertical-align:middle;">{logo_block}</td>
      <td style="font-size:24px;font-weight:800;color:#ffffff;vertical-align:middle;letter-spacing:-0.3px;">VyaparX</td>
    </tr></table>
    <div style="margin-top:10px;font-size:11px;letter-spacing:2.5px;color:#c9a227;font-weight:700;">BUSINESS MANAGEMENT, SIMPLIFIED</div>
  </td></tr>
  <!-- Gold divider -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#c9a227,#7c3aed,#1d4ed8);font-size:0;line-height:0;">&nbsp;</td></tr>
  <!-- Body -->
  <tr><td style="padding:36px;">
    <p style="margin:0 0 6px;color:#64748b;font-size:14px;">Hello {safe_name},</p>
    <h1 style="margin:0 0 14px;color:#0f172a;font-size:26px;line-height:1.25;">Welcome to VyaparX! &#127881;</h1>
    <p style="margin:0 0 14px;color:#0f172a;font-size:15px;font-weight:700;line-height:1.6;">Your business deserves more than disconnected tools. It deserves one powerful platform that brings everything together.</p>
    <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">Thank you for choosing VyaparX. We are delighted to welcome you to a smarter, more connected way of managing your business.</p>
    {company_block}
    <p style="margin:0 0 10px;color:#475569;font-size:15px;line-height:1.6;">VyaparX is designed to help businesses streamline daily operations, improve team coordination, maintain better control over business processes, and make informed decisions from one centralized platform.</p>
    <h2 style="margin:26px 0 6px;color:#0f172a;font-size:18px;">Everything Your Business Needs. One Connected Platform.</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">{feature_rows}</table>
    <h2 style="margin:26px 0 8px;color:#0f172a;font-size:18px;">Ready to Get Started?</h2>
    <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">Your VyaparX registration has been completed successfully. Sign in to your account and explore your workspace.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 24px;"><tr><td align="center" bgcolor="#1d4ed8" style="border-radius:999px;">
      {cta}
    </td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;margin-top:6px;">
      <tr><td style="padding:16px 18px;">
        <div style="font-size:14px;font-weight:700;color:#92400e;">&#128274; A Quick Security Reminder</div>
        <div style="font-size:13px;color:#78350f;padding-top:6px;line-height:1.55;">Your account security matters. Never share your password, authentication codes, or other confidential login information with anyone.</div>
        <div style="font-size:13px;color:#78350f;padding-top:6px;line-height:1.55;">{support_line}</div>
      </td></tr>
    </table>
    <p style="margin:26px 0 4px;color:#475569;font-size:15px;line-height:1.6;">Thank you for making VyaparX part of your business journey.</p>
    <p style="margin:0;color:#475569;font-size:15px;line-height:1.6;font-weight:600;">Let's simplify operations, strengthen collaboration, and build a more efficient business together.</p>
    <p style="margin:24px 0 0;color:#475569;font-size:15px;line-height:1.6;">Warm regards,<br /><strong style="color:#0f172a;">Team VyaparX</strong><br /><em style="color:#94a3b8;font-size:13px;">Business Management, Simplified.</em></p>
  </td></tr>
  <!-- Footer -->
  <tr><td style="background:#0b1b3a;padding:22px 36px;text-align:center;">
    <div style="font-size:13px;font-weight:700;color:#ffffff;">VyaparX ERP</div>
    <div style="font-size:12px;color:#94a3b8;padding-top:4px;">&copy; {year} VyaparX. All rights reserved.</div>
    <div style="font-size:11px;color:#64748b;padding-top:8px;">This is an automated welcome email. Please do not reply directly unless the configured support system accepts replies.</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>"""


def _render_text(user_name, company_name, login_url, support_email):
    lines = [
        f"Hello {user_name},",
        "",
        "Welcome to VyaparX!",
        "",
        "Thank you for choosing VyaparX. We are delighted to welcome you to a",
        "smarter, more connected way of managing your business.",
    ]
    if company_name:
        lines.append("")
        lines.append(f"Your company {company_name} has been registered successfully.")
    lines += [
        "",
        "With VyaparX, you can manage your business from one centralized platform:",
        "  - CRM & Customer Management",
        "  - Sales & Quotation Management",
        "  - Purchase & Vendor Management",
        "  - Inventory Management",
        "  - Production Management",
        "  - Transport Management",
        "  - Accounting & Business Reports",
        "",
        "Your VyaparX registration has been completed successfully.",
    ]
    if login_url:
        lines.append(f"Get started: {login_url}")
    lines += [
        "",
        "Security reminder: never share your password or authentication codes",
        "with anyone." + (
            f" If you did not create this account, contact support at {support_email}."
            if support_email else
            " If you did not create this account, please contact our support team."
        ),
        "",
        "Warm regards,",
        "Team VyaparX",
        "Business Management, Simplified.",
        "",
        f"© {datetime.now(dt_timezone.utc).year} VyaparX. All rights reserved.",
        "This is an automated welcome email.",
    ]
    return "\n".join(lines)


def _deliver(payload):
    api_key = str(getattr(settings, "RESEND_API_KEY", "") or "").strip()
    sender_email = str(getattr(settings, "RESEND_FROM_EMAIL", "") or "").strip()
    sender_name = str(getattr(settings, "RESEND_FROM_NAME", "VyaparX ERP") or "VyaparX ERP").strip()
    if not api_key or not sender_email:
        logger.info("Welcome email skipped: Resend is not configured (RESEND_API_KEY/RESEND_FROM_EMAIL)")
        return {"status": "not_configured"}
    try:
        validate_email(sender_email)
    except ValidationError:
        logger.error("Welcome email skipped: RESEND_FROM_EMAIL is invalid")
        return {"status": "invalid_sender"}

    payload = dict(payload)
    payload["from"] = f"{sender_name} <{sender_email}>" if sender_name else sender_email
    request = Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),        
        headers={
            "accept": "application/json",
            "authorization": f"Bearer {api_key}",
            "content-type": "application/json",
            "User-Agent": "VyaparX-ERP/1.0",
        },

        method="POST",
    )
    try:
        with urlopen(request, timeout=8) as response:
            result = json.loads(response.read().decode("utf-8") or "{}")
            email_id = str(result.get("id") or "")
            if not email_id:
                logger.warning("Resend accepted a welcome email without returning an ID")
                return {"status": "failed", "errorCode": "invalid_provider_response"}
            return {"status": "accepted", "messageId": email_id}
   
    except HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        logger.warning(
            "Resend rejected a welcome email (HTTP %s): %s",
            exc.code,
            error_body,
        )
        return {"status": "failed", "errorCode": str(exc.code)}

    except (URLError, TimeoutError, OSError):
        logger.warning("Resend welcome email request failed due to a connection error")
        return {"status": "failed", "errorCode": "connection_error"}
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.warning("Resend returned an invalid welcome-email response")
        return {"status": "failed", "errorCode": "invalid_provider_response"}
        


def send_welcome_email(user_name, recipient_email, company_name=""):
    """Send the registration welcome email exactly once.

    Never raises: a delivery failure is logged and returned as a status so the
    registration response is unaffected. Duplicate sends for the same email
    are suppressed for the lifetime of the process.
    """
    recipient = str(recipient_email or "").strip().lower()
    if not recipient:
        return {"status": "missing_recipient_email"}
    with _WELCOME_LOCK:
        if recipient in _WELCOME_SENT:
            return {"status": "already_sent"}
        # Mark before sending: a retry of a partially-failed request will not
        # double-send; transient failures are rare and non-critical here.
        _WELCOME_SENT.add(recipient)

    subject = "Welcome to VyaparX | Let's Build a Smarter Business Together!"
    login_url = _app_login_url()
    logo_url = _logo_url()
    support_email = str(getattr(settings, "SUPPORT_EMAIL", "") or "").strip()
    payload = {
        "to": [recipient],
        "subject": subject,
        "html": _render_html(user_name, company_name, login_url, logo_url, support_email),
        "text": _render_text(user_name, company_name, login_url, support_email),
    }
    return _deliver(payload)


def queue_welcome_email(user_name, recipient_email, company_name=""):
    """Fire-and-forget variant used by the registration view so the HTTP
    response is never delayed by the email provider round-trip."""
    thread = threading.Thread(
        target=send_welcome_email,
        args=(user_name, recipient_email, company_name),
        daemon=True,
        name="vyaparx-welcome-email",
    )
    thread.start()
    return {"status": "queued"}
