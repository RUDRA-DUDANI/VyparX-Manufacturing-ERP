# VyaparX customer demo — code audit

**Audit type:** static code trace. No authenticated UI workflow was executed. Every workflow below remains **NOT TESTED** until it is run in an isolated demo tenant and its saved result is confirmed.

## Application and storage

- Frontend pages and module controllers live under `source/frontend/html` and `source/frontend/javascript`.
- The backend is Django REST Framework (`source/backend/vyaparx_backend`, `source/backend/accounts`). Business records use company-scoped Firestore module records; the frontend calls authenticated APIs through `VyaparXAuth`.
- `python -m django check --settings=vyaparx_backend.settings` passed with no Django system-check issues. The installed Google client libraries warn that this environment uses Python 3.10.11, which is outside their supported version range.
- The repository has no `manage.py`. The README's `python manage.py ...` commands therefore do not run from the checked-out files; Django's module CLI is available instead.

## Workflow trace

| Module / step | UI action and implementation | API/backend path | Database effect in code | Actual verification |
|---|---|---|---|---|
| Setup & master data | Admin company, users, department heads; CRM client/catalog screens | `/api/admin/company`, `/api/admin/users`, `/api/admin/department-heads`, `/api/modules/{module}/data` | Company-scoped Firestore records | NOT TESTED |
| CRM → Quotation | `source/frontend/javascript/CRM.js`: lead quotation form; reads/saves `quotations`, `crm`, and `catalog` records | Authenticated module data API; Sales displays/approves quotations before conversion | Quotation and lead records saved by module API | NOT TESTED |
| Sales Order → Accounting approval | `source/frontend/javascript/sales.js`: quotation conversion and order actions | `/api/accounting/sales-requests`; `SalesAccountingRequestsView` in `firestore_views.py` | Approval status/history, linked order updates; optional release receipt is separate | NOT TESTED |
| Production → Material Planning | `producation.js` / `inventory.js`: plan creation, send, approve/reject, create order | `/api/production/material-plans/{plan_id}/{action}`; `/api/production-orders/{order_id}/{action}` | Material plan/request and production-order records | NOT TESTED |
| Inventory → Purchase → Goods Receipt | `inventory.js` creates requisitions; `purchese.js` handles purchase orders and receive action | `/api/inventory/purchase-orders`, `/api/inventory/purchase-orders/{id}/{action}`, `/api/purchase-orders/{id}/receive` | Receipt endpoint is designed to atomically create receipt/movement and update PO and stock | NOT TESTED |
| Production → QC | `producation.js` exposes output, send-to-QC, pass/fail; backend restricts QC decisions by role | `/api/production-orders/{order_id}/{action}`; `ProductionOrderActionView` | QC status, production status, and history updated | NOT TESTED |
| Transport → Delivery | `transport.js` requests/approves dispatch and updates dispatch transitions | `/api/sales/orders/{id}/transport-request`, `/api/transport/requests/{id}/{action}`, `/api/transport/dispatches/{id}/{action}` | Transport request, dispatch, delivery status and associated source updates | NOT TESTED |
| Accounting → Payments → Reports | `accounting.js` records receipts/payments and renders reports | Sales receipt endpoint and `/api/accounting/requests/{type}/{id}/pay`; `AccountingBusinessRequestsView` | Posted entries plus cumulative paid/received and balance fields | NOT TESTED |

## Scope limits

This is a code trace, not proof that the end-to-end scenario works with a real tenant. Amounts, stock levels, statuses, record persistence, cross-module refreshes, permissions, printouts, and report reconciliation have not been exercised. Do not narrate these as verified outcomes until a safe demo workflow is recorded.
