"""Resend transactional email delivery for persisted department tasks."""
import html
import json
import logging
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email

logger = logging.getLogger(__name__)


def send_task_assignment_email(task, recipients):
    if not recipients:
        return {"status": "missing_recipient_email"}

    api_key = str(getattr(settings, "RESEND_API_KEY", "") or "").strip()
    sender_email = str(getattr(settings, "RESEND_FROM_EMAIL", "") or "").strip()
    sender_name = str(getattr(settings, "RESEND_FROM_NAME", "VyaparX ERP") or "VyaparX ERP").strip()
    if not api_key or not sender_email:
        return {"status": "not_configured"}
    try:
        validate_email(sender_email)
    except ValidationError:
        logger.error("Resend sender address is invalid; check RESEND_FROM_EMAIL")
        return {"status": "invalid_sender"}

    # Accept only explicitly resolved department-head addresses and avoid
    # duplicate sends if legacy records contain duplicate head assignments.
    valid_recipients = []
    seen_addresses = set()
    for recipient in recipients:
        address = str((recipient or {}).get("email") or "").strip()
        if not address:
            continue
        try:
            validate_email(address)
        except ValidationError:
            continue
        address_key = address.casefold()
        if address_key in seen_addresses:
            continue
        seen_addresses.add(address_key)
        valid_recipients.append({
            "email": address,
            **({"name": str(recipient.get("name") or "").strip()} if recipient.get("name") else {}),
        })
    if not valid_recipients:
        return {"status": "missing_recipient_email"}

    title = str(task.get("title") or task.get("s") or "New task")
    sender_department = str(task.get("createdDepartment") or task.get("fd") or "")
    department = str(task.get("department") or task.get("td") or "")
    description = str(task.get("description") or task.get("desc") or "")
    due_date = str(task.get("dueDate") or task.get("due") or "Not specified")
    priority = str(task.get("priority") or task.get("p") or "Medium")
    task_id = str(task.get("id") or "")

    safe = lambda value: html.escape(value, quote=True)
    body = (
        "<h2>New department task</h2>"
        f"<p><strong>Title:</strong> {safe(title)}</p>"
        f"<p><strong>From:</strong> {safe(sender_department)}</p>"
        f"<p><strong>To:</strong> {safe(department)}</p>"
        f"<p><strong>Priority:</strong> {safe(priority)}</p>"
        f"<p><strong>Due date:</strong> {safe(due_date)}</p>"
        f"<p><strong>Description:</strong><br>{safe(description).replace(chr(10), '<br>')}</p>"
        f"<p>Task reference: {safe(task_id)}</p>"
    )
    payload = {
        "from": f"{sender_name} <{sender_email}>" if sender_name else sender_email,
        "to": [recipient["email"] for recipient in valid_recipients],
        "subject": f"New task assigned to {department}: {title}"[:180],
        "html": body,
        "text": (
            f"New task: {title}\nFrom: {sender_department}\nTo: {department}\n"
            f"Priority: {priority}\nDue date: {due_date}\nDescription: {description}\nTask: {task_id}"
        ),
    }
    request = Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "accept": "application/json",
            "authorization": f"Bearer {api_key}",
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=4) as response:
            result = json.loads(response.read().decode("utf-8") or "{}")
            email_id = str(result.get("id") or "")
            if not email_id:
                logger.warning("Resend returned success without an email ID for a task notification")
                return {"status": "failed", "errorCode": "invalid_provider_response"}
            return {"status": "accepted", "messageId": email_id}
    except HTTPError as exc:
        # Do not store provider bodies; they can include request data.
        logger.warning("Resend rejected a task email (HTTP %s)", exc.code)
        return {"status": "failed", "errorCode": str(exc.code)}
    except (URLError, TimeoutError, OSError):
        logger.warning("Resend task email request failed due to a connection error")
        return {"status": "failed", "errorCode": "connection_error"}
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.warning("Resend returned an invalid task-email response")
        return {"status": "failed", "errorCode": "invalid_provider_response"}
