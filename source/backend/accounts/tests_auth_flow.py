"""Isolated tests for Firebase login verification and company registration.

Firebase Admin and Firestore are mocked. No live credentials, no real
Firestore documents, and no test records are created.
"""
import json
import os
import sys
from types import SimpleNamespace
from unittest import mock

# Test-only settings: the Django test client sends Host: testserver, which the
# production ALLOWED_HOSTS list (localhost/127.0.0.1) rejects before any view
# runs. Setting this before setup() avoids changing production settings.
os.environ.setdefault("DJANGO_ALLOWED_HOSTS", "testserver,localhost,127.0.0.1")

import django
from django.test import TestCase, override_settings
from rest_framework.test import APIRequestFactory, force_authenticate

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "vyaparx_backend.settings")
django.setup()

from firebase_admin import auth as fb_auth  # noqa: E402
from firebase_admin import exceptions as fb_exceptions  # noqa: E402

from accounts import firestore_views  # noqa: E402
from accounts.firebase import FirebaseAuthService, FirebaseNotConfigured  # noqa: E402

VALID_CLAIMS = {
    "uid": "firebase-uid-admin-1",
    "email": "admin@example.test",
    "aud": "vyparx-44160",
    "iss": "https://securetoken.google.com/vyparx-44160",
}
IDENTITY = {
    "uid": VALID_CLAIMS["uid"],
    "companyId": "company-1",
    "user": {"fullName": "Admin One", "email": "admin@example.test", "isActive": True},
    "company": {"companyName": "Acme", "isActive": True},
    "membership": {"role": "Admin", "department": "Administration", "status": "ACTIVE",
                   "headDepartment": ""},
}
REGISTRATION = {
    "personal": {
        "fullName": "Admin One", "email": "admin@example.test", "countryCode": "+91",
        "mobile": "9876543210", "address": "1 Main Road", "country": "India",
        "state": "Gujarat", "pinCode": "390001", "adminPassword": "Str0ng#Pass",
        "confirmPassword": "Str0ng#Pass",
    },
    "business": {
        "companyName": "Acme", "registeredBusinessName": "Acme Pvt Ltd", "gstin": "",
        "businessType": "Manufacturing", "industry": "Textile", "employees": "10",
        "businessLocation": "Surat",
    },
    "requirements": {"modules": ["crm"]},
}


class FakeBatch:
    def __init__(self):
        self.docs = {}
        self.committed = False

    def set(self, ref, payload):
        self.docs[ref.path] = payload

    def commit(self):
        self.committed = True


class FakeDb:
    def __init__(self):
        self.batches = []

    def batch(self):
        batch = FakeBatch()
        self.batches.append(batch)
        return batch


class FakeRef:
    def __init__(self, path):
        self.path = path


def fake_ref(path):
    def _ref(*args, **kwargs):
        return FakeRef(path.format(*args) if args else path)
    return _ref


class LoginTests(TestCase):
    def post(self, payload, headers=None):
        return self.client.post("/api/auth/login", data=json.dumps(payload),
                                content_type="application/json", **(headers or {}))

    @mock.patch.object(firestore_views, "get_identity", return_value=IDENTITY)
    @mock.patch.object(FirebaseAuthService, "verify_id_token", return_value=VALID_CLAIMS)
    def test_valid_admin_login(self, verify, _identity):
        response = self.post({"idToken": "valid.token.value", "role": "Admin"})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["dashboardUrl"], "admin.html")
        self.assertEqual(body["user"]["role"], "Admin")
        self.assertEqual(body["user"]["companyId"], "company-1")
        verify.assert_called_once_with("valid.token.value")

    @mock.patch.object(firestore_views, "get_identity", return_value=IDENTITY)
    @mock.patch.object(FirebaseAuthService, "verify_id_token", return_value=VALID_CLAIMS)
    def test_login_accepts_bearer_header_when_body_token_missing(self, verify, _identity):
        response = self.post({"role": "Admin"},
                             headers={"HTTP_AUTHORIZATION": "Bearer header.token.value"})
        self.assertEqual(response.status_code, 200, response.content)
        verify.assert_called_once_with("header.token.value")

    @mock.patch.object(FirebaseAuthService, "verify_id_token",
                       side_effect=fb_auth.InvalidIdTokenError("Failed to verify token: expired token"))
    def test_malformed_or_expired_token_is_401(self, _verify):
        response = self.post({"idToken": "garbage", "role": "Admin"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"], "Invalid or expired Firebase ID token.")

    @mock.patch.object(FirebaseAuthService, "verify_id_token",
                       side_effect=fb_auth.InvalidIdTokenError(
                           "Token has incorrect \"aud\" (audience) claim."))
    def test_token_from_other_project_is_401(self, _verify):
        response = self.post({"idToken": "other.project.token", "role": "Admin"})
        self.assertEqual(response.status_code, 401)

    @mock.patch.object(FirebaseAuthService, "verify_id_token",
                       side_effect=fb_auth.RevokedIdTokenError("Token has been revoked."))
    def test_revoked_token_is_401(self, _verify):
        response = self.post({"idToken": "revoked.token", "role": "Admin"})
        self.assertEqual(response.status_code, 401)

    @mock.patch.object(FirebaseAuthService, "verify_id_token",
                       side_effect=FirebaseNotConfigured("Firebase Admin credentials are missing."))
    def test_missing_firebase_configuration_is_503(self, _verify):
        response = self.post({"idToken": "token", "role": "Admin"})
        self.assertEqual(response.status_code, 503)

    @mock.patch.object(firestore_views, "get_identity", return_value=None)
    @mock.patch.object(FirebaseAuthService, "verify_id_token", return_value=VALID_CLAIMS)
    def test_missing_firestore_user_is_403_not_401(self, _verify, _identity):
        response = self.post({"idToken": "valid.token.value", "role": "Admin"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("membership", response.json()["error"].lower())

    @mock.patch.object(firestore_views, "get_identity", return_value=IDENTITY)
    @mock.patch.object(FirebaseAuthService, "verify_id_token", return_value=VALID_CLAIMS)
    def test_wrong_selected_role_is_403(self, _verify, _identity):
        response = self.post({"idToken": "valid.token.value", "role": "Sales"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("Admin", response.json()["error"])

    def test_missing_token_and_role_is_400(self):
        self.assertEqual(self.post({}).status_code, 400)


@override_settings(FIREBASE_WEB_CONFIG={"apiKey": "k", "authDomain": "d", "projectId": "vyparx-44160",
                                        "storageBucket": "b", "messagingSenderId": "s", "appId": "a"})
@mock.patch.object(firestore_views, "user_ref", side_effect=lambda u: FakeRef(f"users/{u}"))
@mock.patch.object(firestore_views, "company_ref", side_effect=lambda c: FakeRef(f"companies/{c}"))
@mock.patch.object(firestore_views, "membership_ref", side_effect=lambda c, u: FakeRef(f"companies/{c}/members/{u}"))
@mock.patch.object(FirebaseAuthService, "create_user")
class RegistrationTests(TestCase):
    def setUp(self):
        self.db = FakeDb()
        for target, kwargs in (
            ("get_db", {"return_value": self.db}),
            ("user_ref_by_email_exists", {"return_value": False}),
        ):
            patcher = mock.patch.object(firestore_views, target, **kwargs)
            patcher.start()
            self.addCleanup(patcher.stop)

    def post(self, payload):
        return self.client.post("/api/auth/register", data=json.dumps(payload),
                                content_type="application/json")

    def test_nested_frontend_payload_is_flattened_and_saved(self, create_user, _membership_ref, _company_ref, _user_ref):
        create_user.return_value = mock.Mock(uid="new-firebase-uid")
        with mock.patch.object(firestore_views, "queue_welcome_email") as welcome_email:
            response = self.post(REGISTRATION)
        self.assertEqual(response.status_code, 201, response.content)
        welcome_email.assert_called_once_with("Admin One", "admin@example.test", "Acme")
        body = response.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["user"]["role"], "Admin")
        company_id = body["companyId"]
        batch = self.db.batches[0]
        self.assertTrue(batch.committed)
        self.assertIn("new-firebase-uid", batch.docs[f"companies/{company_id}/members/new-firebase-uid"]["uid"])
        self.assertEqual(batch.docs["users/new-firebase-uid"]["companyId"], company_id)
        self.assertEqual(batch.docs["users/new-firebase-uid"]["email"], "admin@example.test")

    def test_welcome_email_queue_failure_does_not_fail_committed_registration(
        self, create_user, _membership_ref, _company_ref, _user_ref,
    ):
        create_user.return_value = mock.Mock(uid="welcome-queue-failure-uid")
        with mock.patch.object(firestore_views, "queue_welcome_email", side_effect=RuntimeError("queue unavailable")), \
             mock.patch.object(FirebaseAuthService, "delete_user") as delete_user:
            response = self.post(REGISTRATION)

        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(self.db.batches[0].committed)
        self.assertIn("users/welcome-queue-failure-uid", self.db.batches[0].docs)
        delete_user.assert_not_called()

    def test_flat_payload_is_accepted(self, create_user, _membership_ref, _company_ref, _user_ref):
        create_user.return_value = mock.Mock(uid="flat-uid")
        payload = {
            "companyName": "Acme", "registeredBusinessName": "Acme Pvt Ltd",
            "ownerName": "Admin One", "email": "admin@example.test", "phone": "+919876543210",
            "address": "1 Main Road", "country": "India", "state": "Gujarat",
            "pinCode": "390001", "password": "Str0ng#Pass", "confirmPassword": "Str0ng#Pass",
        }
        self.assertEqual(self.post(payload).status_code, 201)
        self.assertIn("users/flat-uid", self.db.batches[0].docs)

    def test_missing_fields_report_field_specific_errors(self, _create_user, _membership_ref, _company_ref, _user_ref):
        response = self.post({"personal": {"email": "admin@example.test"}})
        self.assertEqual(response.status_code, 400)
        fields = response.json()["fields"]
        self.assertIn("company_name", fields)
        self.assertIn("password", fields)

    def test_invalid_email_is_rejected(self, _create_user, _membership_ref, _company_ref, _user_ref):
        payload = json.loads(json.dumps(REGISTRATION))
        payload["personal"]["email"] = "not-an-email"
        response = self.post(payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.json()["fields"])

    def test_password_mismatch_is_rejected(self, _create_user, _membership_ref, _company_ref, _user_ref):
        payload = json.loads(json.dumps(REGISTRATION))
        payload["personal"]["confirmPassword"] = "Different#1"
        response = self.post(payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("confirmPassword", response.json()["fields"])

    def test_duplicate_email_is_409(self, _create_user, _membership_ref, _company_ref, _user_ref):
        with mock.patch.object(firestore_views, "user_ref_by_email_exists", return_value=True):
            response = self.post(REGISTRATION)
        self.assertEqual(response.status_code, 409)
        self.assertIn("email", response.json()["fields"])

    def test_firebase_failure_rolls_back_and_reports_error(self, create_user, _membership_ref, _company_ref, _user_ref):
        create_user.side_effect = Exception("EMAIL_EXISTS")
        response = self.post(REGISTRATION)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.db.batches, "No company/membership may be written on failure")

    def test_firestore_failure_removes_orphan_firebase_account(self, create_user, _membership_ref, _company_ref, _user_ref):
        create_user.return_value = mock.Mock(uid="orphan-uid")
        self.db.batch = mock.Mock(side_effect=RuntimeError("firestore unavailable"))
        with mock.patch.object(FirebaseAuthService, "delete_user") as delete_user:
            response = self.post(REGISTRATION)
        self.assertEqual(response.status_code, 400)
        delete_user.assert_called_once_with("orphan-uid")


class LegacyTransportRequestRecoveryTests(TestCase):
    def test_recovers_only_requests_linked_to_company_sales_orders(self):
        legacy_request = {
            "recordType": "transportRequest",
            "salesOrderId": "SO-1",
            "approvalStatus": "Pending",
        }
        foreign_request = {
            "recordType": "transportRequest",
            "companyId": "company-2",
            "salesOrderId": "SO-2",
        }
        mismatched_request = {
            "recordType": "transportRequest",
            "salesOrderId": "SO-other",
        }
        snapshots = {
            request_id: mock.Mock(exists=True, **{"to_dict.return_value": payload})
            for request_id, payload in (
                ("TRQ-1", legacy_request),
                ("TRQ-2", foreign_request),
                ("TRQ-3", mismatched_request),
            )
        }
        refs = {request_id: mock.Mock() for request_id in snapshots}
        for request_id, ref in refs.items():
            ref.get.return_value = snapshots[request_id]
        transport_collection = mock.Mock()
        transport_collection.document.side_effect = refs.__getitem__
        orders = [
            {"id": "SO-1", "recordType": "salesOrder", "transportRequestId": "TRQ-1"},
            {"id": "SO-2", "recordType": "salesOrder", "transportRequestId": "TRQ-2"},
            {"id": "SO-3", "recordType": "salesOrder", "transportRequestId": "TRQ-3"},
        ]

        with mock.patch.object(firestore_views, "list_module_records", return_value=orders), \
             mock.patch.object(firestore_views, "module_records_ref", return_value=transport_collection):
            result = firestore_views.ModuleDataView._recover_legacy_transport_requests("company-1", [])

        self.assertEqual([row["id"] for row in result], ["TRQ-1"])
        self.assertEqual(result[0]["companyId"], "company-1")
        refs["TRQ-1"].update.assert_called_once_with({"companyId": "company-1", "module": "transport"})
        refs["TRQ-2"].update.assert_not_called()
        refs["TRQ-3"].update.assert_not_called()

    def test_recovers_transport_bill_linked_to_company_order(self):
        order = {"id": "SO-1", "recordType": "salesOrder", "dispatchId": "TRN-1"}
        bill_data = {"recordType": "transportBill", "dispatchId": "TRN-1", "salesOrderId": "SO-1"}
        bill_snap = mock.Mock(id="TB-TRN-1-1001", **{"to_dict.return_value": bill_data})
        transport_collection = mock.Mock()
        transport_collection.where.return_value.stream.return_value = [bill_snap]

        with mock.patch.object(firestore_views, "list_module_records", return_value=[order]), \
             mock.patch.object(firestore_views, "module_records_ref", return_value=transport_collection):
            result = firestore_views.ModuleDataView._recover_legacy_transport_bills("company-1", [])

        self.assertEqual([row["id"] for row in result], ["TB-TRN-1-1001"])
        self.assertEqual(result[0]["companyId"], "company-1")
        transport_collection.document.assert_called_once_with("TB-TRN-1-1001")
        transport_collection.document.return_value.update.assert_called_once_with(
            {"companyId": "company-1", "module": "transport"},
        )

    def test_recovers_accounting_request_for_legacy_transport_bill(self):
        request_data = {
            "recordType": "transportAccountingRequest",
            "sourceId": "TB-TRN-1-1001",
            "approvalStatus": "Pending",
        }
        request_snap = mock.Mock(exists=True, **{"to_dict.return_value": request_data})
        request_ref = mock.Mock()
        request_ref.get.return_value = request_snap
        accounting_collection = mock.Mock()
        accounting_collection.document.return_value = request_ref
        bill = {"id": "TB-TRN-1-1001", "recordType": "transportBill"}

        with mock.patch.object(firestore_views.ModuleDataView, "_recover_legacy_transport_bills", return_value=[bill]), \
             mock.patch.object(firestore_views, "list_module_records", return_value=[]), \
             mock.patch.object(firestore_views, "module_records_ref", return_value=accounting_collection):
            result = firestore_views.ModuleDataView._recover_legacy_transport_accounting_requests("company-1", [])

        self.assertEqual([row["id"] for row in result], ["TBR-TRN-1-1001"])
        self.assertEqual(result[0]["companyId"], "company-1")
        request_ref.update.assert_called_once_with({"companyId": "company-1", "module": "accounting"})


class TransportAccountingSubmissionTests(TestCase):
    def test_repeated_submission_returns_existing_pending_request(self):
        request_id = "TBR-TRN-1-1001"
        bill_id = "TB-TRN-1-1001"
        source_ref = mock.Mock()
        request_ref = mock.Mock()
        source_snapshot = mock.Mock(
            exists=True,
            **{"to_dict.return_value": {
                "recordType": "dispatch",
                "status": "DELIVERED",
                "accountingRequestId": "legacy-request-id",
            }},
        )
        request_record = {
            "recordType": "transportAccountingRequest",
            "sourceId": bill_id,
            "approvalStatus": "Pending",
            "billNumber": "1001",
        }
        request_snapshot = mock.Mock(exists=True, **{"to_dict.return_value": request_record})
        transaction = mock.Mock()
        payload = {
            "id": request_id,
            "recordType": "transportAccountingRequest",
            "sourceId": bill_id,
        }

        with mock.patch.object(firestore_views, "firestore") as firestore_mock, \
             mock.patch.object(firestore_views, "get_db", return_value=mock.Mock(transaction=lambda: transaction)), \
             mock.patch.object(
                 firestore_views,
                 "_transaction_document",
                 side_effect=lambda _tx, ref: source_snapshot if ref is source_ref else request_snapshot,
             ):
            firestore_mock.transactional.side_effect = lambda callback: callback
            response = firestore_views.AccountingBusinessRequestsView()._create_pair(
                source_ref,
                request_ref,
                source_snapshot.to_dict(),
                {"accountingRequestId": request_id},
                payload,
                extra_ref=mock.Mock(),
                extra_data={"recordType": "transportBill"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["success"])
        self.assertEqual(response.data["record"]["id"], request_id)
        self.assertEqual(response.data["record"]["approvalStatus"], "Pending")
        transaction.update.assert_called_once_with(source_ref, {
            "accountingRequestId": request_id,
            "accountingApprovalStatus": "Pending",
        })
        transaction.create.assert_not_called()

    def test_stale_dispatch_pointer_repairs_orphaned_bill_and_creates_request(self):
        source_ref, request_ref, linked_ref, bill_ref = (mock.Mock() for _ in range(4))
        snapshots = {
            source_ref: mock.Mock(exists=True, **{"to_dict.return_value": {
                "recordType": "dispatch", "status": "DELIVERED", "accountingRequestId": "stale-id",
            }}),
            request_ref: mock.Mock(exists=False),
            linked_ref: mock.Mock(exists=False),
            bill_ref: mock.Mock(exists=True, **{"to_dict.return_value": {
                "recordType": "transportBill", "dispatchId": "TRN-1", "billNumber": "1001",
            }}),
        }
        transaction = mock.Mock()
        payload = {
            "id": "TBR-TRN-1-1001", "recordType": "transportAccountingRequest",
            "sourceId": "TB-TRN-1-1001", "companyId": "company-1",
            "dispatchId": "TRN-1", "billNumber": "1001", "requestDate": "2026-10-25",
            "createdBy": "user-1",
        }

        with mock.patch.object(firestore_views, "firestore") as firestore_mock, \
             mock.patch.object(firestore_views, "get_db", return_value=mock.Mock(transaction=lambda: transaction)), \
             mock.patch.object(firestore_views, "_transaction_document",
                               side_effect=lambda _tx, ref: snapshots[ref]), \
             mock.patch.object(firestore_views.AccountingBusinessRequestsView, "_ref", return_value=linked_ref):
            firestore_mock.transactional.side_effect = lambda callback: callback
            response = firestore_views.AccountingBusinessRequestsView()._create_pair(
                source_ref, request_ref, {}, {"accountingRequestId": payload["id"]}, payload,
                extra_ref=bill_ref, extra_data={"recordType": "transportBill", "dispatchId": "TRN-1", "billNumber": "1001"},
            )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["success"])
        transaction.update.assert_any_call(bill_ref, mock.ANY)
        transaction.update.assert_any_call(source_ref, {"accountingRequestId": payload["id"]})
        transaction.create.assert_called_once_with(request_ref, payload)


class ManualProductionOrderApiTests(TestCase):
    class Snapshot:
        def __init__(self, record=None, doc_id="SO-DB-1"):
            self.exists = record is not None
            self.record = record or {}
            self.id = doc_id

        def to_dict(self):
            return dict(self.record)

    class Document:
        def __init__(self, record_id, record=None):
            self.id = record_id
            self.record = record

        def get(self):
            return ManualProductionOrderApiTests.Snapshot(self.record, self.id)

    class Collection:
        def __init__(self, record):
            self.record = record

        def document(self, record_id):
            record = self.record if str(record_id) == str(self.record.get("id")) else None
            return ManualProductionOrderApiTests.Document(record_id, record)

    def setUp(self):
        from datetime import date
        self.today = date.today().isoformat()
        self.sales_order = {
            "id": "SO-DB-1", "recordType": "salesOrder", "companyId": "company-1",
            "orderNumber": "SO-001", "items": [
                {"i": "catalog-pp", "q": 500, "code": " 001 ", "productName": "PP   COLOR", "uom": "Nos"},
                {"i": "catalog-blue", "q": 200, "code": "002", "productName": "BLUE COLOR", "uom": "Nos"},
            ],
        }
        self.user = SimpleNamespace(
            is_authenticated=True,
            membership=SimpleNamespace(role=firestore_views.Role.PRODUCTION),
            company=SimpleNamespace(id="company-1"),
            app_user=SimpleNamespace(firebase_uid="production-user", full_name="Production User"),
        )

    def submit(self, values, sales_order=None, saved_order=None):
        from rest_framework.test import APIRequestFactory, force_authenticate
        order = self.sales_order if sales_order is None else sales_order
        factory = APIRequestFactory()
        request = factory.post("/api/production-orders/manual", values, format="json")
        force_authenticate(request, user=self.user)
        with mock.patch.object(firestore_views, "module_records_ref", return_value=self.Collection(order)), \
             mock.patch.object(firestore_views, "list_module_records", return_value=[order]), \
             mock.patch.object(firestore_views, "get_module_record", return_value=saved_order), \
             mock.patch.object(firestore_views, "save_module_record", side_effect=lambda company, module, rid, data: {**data, "id": rid}) as save:
            response = firestore_views.ManualProductionOrderView.as_view()(request)
        return response, save

    def payload(self, **values):
        result = {
            "salesOrder": "SO-001", "salesOrderNumber": "SO-001",
            "productName": "PP COLOR", "quantity": 500, "unit": "Nos",
            "expectedStartDate": self.today, "noMaterialsRequired": True,
            "idempotencyKey": "test-submit-1",
        }
        result.update(values)
        return result

    def test_product_id_matches_compact_sales_order_item(self):
        response, save = self.submit(self.payload(
            salesOrder="SO-DB-1", salesOrderId="SO-DB-1", productId="catalog-pp", productCode="not-used",
        ))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["record"]["productId"], "catalog-pp")
        save.assert_called_once()

    def test_exact_product_code_is_normalized_and_saved_from_sales_line(self):
        response, _ = self.submit(self.payload(productCode="001", batch="ab-001", supervisor="abc"))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["record"]["productCode"], "001")
        self.assertEqual(response.data["record"]["qty"], 500)
        self.assertEqual(response.data["record"]["batch"], "ab-001")
        self.assertEqual(response.data["record"]["sup"], "abc")
        self.assertTrue(response.data["record"]["manualNoMaterialRequired"])

    def test_normalized_product_name_matches_when_code_is_not_supplied(self):
        response, _ = self.submit(self.payload(productCode="", productName=" pp  color "))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["record"]["productName"], "pp  color")

    def test_unmatched_product_details_are_saved_as_entered(self):
        invalid, _ = self.submit(self.payload(productCode="999", productName="CUSTOM ITEM"))
        other_line, _ = self.submit(self.payload(productCode="002"))
        self.assertEqual(invalid.status_code, 201)
        self.assertEqual(invalid.data["record"]["productCode"], "999")
        self.assertEqual(invalid.data["record"]["productName"], "CUSTOM ITEM")
        self.assertEqual(invalid.data["record"]["productMatchStatus"], "Unmatched")
        self.assertEqual(other_line.status_code, 201)
        self.assertEqual(other_line.data["record"]["productCode"], "002")
        self.assertEqual(other_line.data["record"]["productMatchStatus"], "Matched")

    def test_sales_order_from_another_company_is_rejected(self):
        foreign = {**self.sales_order, "companyId": "company-elsewhere"}
        response, save = self.submit(self.payload(), sales_order=foreign)
        self.assertEqual(response.status_code, 404)
        save.assert_not_called()

    def test_no_materials_confirmation_is_required_and_persisted(self):
        response, save = self.submit(self.payload(noMaterialsRequired=False))
        self.assertEqual(response.status_code, 400)
        save.assert_not_called()

    def test_same_idempotency_key_returns_existing_order(self):
        existing = {"id": "PO-M-EXISTING", "idempotencyKey": "test-submit-1", "recordType": "workOrder"}
        response, save = self.submit(self.payload(), saved_order=existing)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["duplicate"])
        save.assert_not_called()


class ProductionOrderStartApiTests(TestCase):
    """Exercise Start against an isolated Firestore-shaped in-memory store."""

    class Store:
        def __init__(self, records=None):
            self.records = records or {"production": {}, "sales": {}, "inventory": {}}

        def collection(self, module):
            return self.Collection(self, module)

        class Snapshot:
            def __init__(self, store, module, record_id):
                self.store, self.module, self.id = store, module, str(record_id)
                self.reference = ProductionOrderStartApiTests.Store.Document(store, module, self.id)
                self.record = store.records.get(module, {}).get(self.id)
                self.exists = self.record is not None

            def to_dict(self):
                return dict(self.record or {})

        class Document:
            def __init__(self, store, module, record_id):
                self.store, self.module, self.id = store, module, str(record_id)

            def get(self):
                return ProductionOrderStartApiTests.Store.Snapshot(self.store, self.module, self.id)

            def update(self, values):
                self.store.records.setdefault(self.module, {}).setdefault(self.id, {}).update(values)

            def create(self, values):
                bucket = self.store.records.setdefault(self.module, {})
                if self.id in bucket:
                    raise ValueError("already exists")
                bucket[self.id] = dict(values)

        class Query:
            def __init__(self, store, module, filters=(), count=None):
                self.store, self.module = store, module
                self.filters, self.count = filters, count

            def where(self, field, operator, value):
                return ProductionOrderStartApiTests.Store.Query(
                    self.store, self.module, (*self.filters, (field, operator, value)), self.count,
                )

            def limit(self, count):
                return ProductionOrderStartApiTests.Store.Query(
                    self.store, self.module, self.filters, count,
                )

            def stream(self):
                rows = self.store.records.get(self.module, {})
                snapshots = []
                for record_id, record in rows.items():
                    if all(operator == "==" and record.get(field) == value
                           for field, operator, value in self.filters):
                        snapshots.append(ProductionOrderStartApiTests.Store.Snapshot(
                            self.store, self.module, record_id,
                        ))
                return iter(snapshots[:self.count] if self.count else snapshots)

        class Collection(Query):
            def document(self, record_id):
                return ProductionOrderStartApiTests.Store.Document(self.store, self.module, record_id)

        class Transaction:
            def get(self, ref):
                return ref.get()

            def update(self, ref, values):
                ref.update(values)

            def create(self, ref, values):
                ref.create(values)

        def transaction(self):
            return self.Transaction()

    def setUp(self):
        from accounts.models import Role
        self.store = self.Store({"production": {}, "sales": {}, "inventory": {}})
        self.user = SimpleNamespace(
            is_authenticated=True,
            membership=SimpleNamespace(role=Role.PRODUCTION),
            company=SimpleNamespace(id="company-1"),
            app_user=SimpleNamespace(firebase_uid="production-user", full_name="Production User"),
        )

    def add_manual_order(self, document_id, **overrides):
        record = {
            "id": document_id, "recordType": "workOrder", "companyId": "company-1",
            "status": "PLANNED", "st": "PLANNED", "manualCreated": True,
            "manualNoMaterialRequired": True, "materials": [], "hist": [], "prod": 0, "qty": 5,
        }
        record.update(overrides)
        self.store.records["production"][document_id] = record
        return record

    def post_action(self, route_id, role=None):
        from rest_framework.test import APIRequestFactory, force_authenticate
        user = self.user
        if role is not None:
            user = SimpleNamespace(**vars(self.user))
            user.membership = SimpleNamespace(role=role)
        request = APIRequestFactory().post(f"/api/production-orders/{route_id}/start", {}, format="json")
        force_authenticate(request, user=user)
        with mock.patch.object(firestore_views, "module_records_ref",
                               side_effect=lambda _company, module: self.store.collection(module)), \
             mock.patch.object(firestore_views, "get_db", return_value=self.store), \
             mock.patch.object(firestore_views, "firestore") as firestore_mock:
            firestore_mock.transactional.side_effect = lambda callback: callback
            return firestore_views.ProductionOrderActionView.as_view()(request, order_id=route_id, action="start")

    def test_start_updates_existing_firestore_document_and_returns_canonical_id(self):
        order = self.add_manual_order("DOC-PO-100", id="DOC-PO-100", productionOrderNo="PO-100")
        response = self.post_action("DOC-PO-100")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["record"]["id"], "DOC-PO-100")
        self.assertEqual(order["st"], "IN_PROGRESS")
        self.assertEqual(order["status"], "IN_PROGRESS")
        self.assertEqual(len(self.store.records["production"]), 1)
        self.assertEqual(order["hist"][-1]["message"], "Production started")

    def test_public_order_number_resolves_to_actual_document_id(self):
        order = self.add_manual_order("DOC-PO-101", id="PO-101", productionOrderNo="PO-101")
        response = self.post_action("PO-101")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["record"]["id"], "DOC-PO-101")
        self.assertEqual(order["st"], "IN_PROGRESS")
        self.assertEqual(len(self.store.records["production"]), 1)

    def test_start_rejects_foreign_company_order(self):
        order = self.add_manual_order("FOREIGN-PO", companyId="company-2")
        response = self.post_action("FOREIGN-PO")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(order["st"], "PLANNED")

    def test_start_rejects_pending_material_plan_approval(self):
        order = self.add_manual_order("PO-WITH-PLAN", materialPlanId="MP-1", manualCreated=False,
                                      manualNoMaterialRequired=False,
                                      materials=[{"materialId": "MAT-1", "requiredQty": 1, "issuedQty": 1}])
        self.store.records["production"]["MP-1"] = {
            "id": "MP-1", "recordType": "materialPlan", "companyId": "company-1",
            "approvalStatus": "Pending", "productionOrderId": "PO-WITH-PLAN",
        }
        response = self.post_action(order["id"])
        self.assertEqual(response.status_code, 409)
        self.assertIn("Material Plan", response.data["error"])
        self.assertEqual(order["st"], "PLANNED")

    def test_start_rejects_unapproved_linked_sales_order(self):
        order = self.add_manual_order("PO-WITH-SALES", salesOrderId="SO-1")
        self.store.records["sales"]["SO-1"] = {
            "id": "SO-1", "recordType": "salesOrder", "companyId": "company-1",
            "accountingApprovalStatus": "Pending",
        }
        response = self.post_action(order["id"])
        self.assertEqual(response.status_code, 409)
        self.assertIn("Accounting approval", response.data["error"])
        self.assertEqual(order["st"], "PLANNED")

    def test_start_rejects_unauthorized_role(self):
        from accounts.models import Role
        order = self.add_manual_order("PO-UNAUTHORIZED")
        response = self.post_action(order["id"], role=Role.ACCOUNTING_FINANCE)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(order["st"], "PLANNED")

    def test_legacy_recovery_requires_verified_same_company_backlinks(self):
        legacy = {
            "id": "PO-LEGACY", "recordType": "productionOrder", "qty": 2, "prod": 0,
            "productionRequestId": "PR-1", "materialPlanId": "MP-1", "salesOrderId": "SO-1",
        }
        self.store.records["production"].update({
            "DOC-LEGACY": legacy,
            "PR-1": {"id": "PR-1", "recordType": "productionRequest", "companyId": "company-1",
                     "productionOrderId": "DOC-LEGACY"},
            "MP-1": {"id": "MP-1", "recordType": "materialPlan", "companyId": "company-1",
                     "productionOrderId": "DOC-LEGACY"},
            "DOC-UNLINKED": {"recordType": "productionOrder", "qty": 1, "prod": 0},
            "DOC-FOREIGN": {"recordType": "productionOrder", "qty": 1, "prod": 0,
                            "productionRequestId": "PR-FOREIGN"},
            "PR-FOREIGN": {"recordType": "productionRequest", "companyId": "company-2",
                           "productionOrderId": "DOC-FOREIGN"},
        })
        self.store.records["sales"]["SO-1"] = {
            "recordType": "salesOrder", "companyId": "company-1",
        }
        with mock.patch.object(firestore_views, "module_records_ref",
                               side_effect=lambda _company, module: self.store.collection(module)):
            recovered = firestore_views.ModuleDataView._recover_legacy_production_orders("company-1", [])

        self.assertEqual([row["id"] for row in recovered], ["DOC-LEGACY"])
        self.assertEqual(self.store.records["production"]["DOC-LEGACY"]["companyId"], "company-1")
        self.assertNotIn("companyId", self.store.records["production"]["DOC-UNLINKED"])
        self.assertNotIn("companyId", self.store.records["production"]["DOC-FOREIGN"])

    def test_start_eligibility_reports_approvals_and_issue_blockers(self):
        pending_plan_order = {"id": "PO-1", "status": "PLANNED", "materialPlanId": "MP-1",
                              "materials": [{"requiredQty": 1, "issuedQty": 0}]}
        pending_plan = {"recordType": "materialPlan", "companyId": "company-1",
                        "productionOrderId": "PO-1", "approvalStatus": "Pending"}
        result = firestore_views._production_start_eligibility(
            pending_plan_order, "company-1", plan=pending_plan,
        )
        self.assertFalse(result["eligible"])
        self.assertIn("approval is pending", result["reason"])

        pending_issue_order = {"id": "PO-2", "status": "READY",
                               "materials": [{"requiredQty": 1, "issuedQty": 0}]}
        result = firestore_views._production_start_eligibility(pending_issue_order, "company-1")
        self.assertFalse(result["eligible"])
        self.assertIn("Issue all required", result["reason"])

    def test_generic_post_still_rejects_work_order_creation(self):
        from rest_framework.test import APIRequestFactory, force_authenticate
        order = {"id": "PO-NEW", "recordType": "productionOrder", "qty": 1, "prod": 0}
        request = APIRequestFactory().post("/api/modules/production/data", order, format="json")
        force_authenticate(request, user=self.user)
        with mock.patch.object(firestore_views, "module_records_ref",
                               side_effect=lambda _company, module: self.store.collection(module)):
            response = firestore_views.ModuleDataView.as_view()(request, module_name="production")
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("PO-NEW", self.store.records["production"])

    def test_material_plan_cannot_link_to_foreign_company_request(self):
        from rest_framework.test import APIRequestFactory, force_authenticate
        self.store.records["production"]["PR-FOREIGN"] = {
            "id": "PR-FOREIGN", "recordType": "productionRequest", "companyId": "company-2",
            "requestCode": "PRD-20", "items": [{"itemId": "ITEM-1", "quantity": 5}],
        }
        request = APIRequestFactory().post("/api/modules/production/data", {
            "id": "MP-NEW", "recordType": "materialPlan", "productionRequestId": "PR-FOREIGN",
            "productId": "ITEM-1", "materials": [],
        }, format="json")
        force_authenticate(request, user=self.user)
        with mock.patch.object(firestore_views, "module_records_ref",
                               side_effect=lambda _company, module: self.store.collection(module)), \
             mock.patch.object(firestore_views, "list_module_records", return_value=[]):
            response = firestore_views.ModuleDataView.as_view()(request, module_name="production")
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("MP-NEW", self.store.records["production"])


class TransportAccountingApiFlowTests(TestCase):
    """Exercise submit -> Accounting inbox -> approve through the API views."""

    class Store:
        def __init__(self):
            self.records = {
                "transport": {"TRN-1": {"id": "TRN-1", "recordType": "dispatch",
                    "status": "DELIVERED", "st": "DELIVERED", "so": "SO-1"}},
                "sales": {"SO-1": {"id": "SO-1", "recordType": "salesOrder",
                    "orderNumber": "SO-1", "customerName": "Test Customer"}},
                "accounting": {},
            }

        def collection(self, module):
            return self.Collection(self, module)

        class Collection:
            def __init__(self, store, module):
                self.store, self.module = store, module

            def document(self, record_id):
                return TransportAccountingApiFlowTests.Store.Document(self.store, self.module, str(record_id))

        class Document:
            def __init__(self, store, module, record_id):
                self.store, self.module, self.id = store, module, record_id

            def get(self):
                row = self.store.records.get(self.module, {}).get(self.id)
                return TransportAccountingApiFlowTests.Store.Snapshot(row)

        class Snapshot:
            def __init__(self, row):
                self.exists = row is not None
                self.row = row or {}

            def to_dict(self):
                return dict(self.row)

        class Transaction:
            def __init__(self, store):
                self.store = store

            def get(self, ref):
                return ref.get()

            def create(self, ref, data):
                self.store.records.setdefault(ref.module, {})[ref.id] = dict(data)

            def update(self, ref, data):
                self.store.records.setdefault(ref.module, {}).setdefault(ref.id, {}).update(data)

        def transaction(self):
            return self.Transaction(self)

    def test_transport_bill_reaches_accounting_and_approval_updates_bill_status(self):
        store = self.Store()
        factory = APIRequestFactory()
        user = SimpleNamespace(
            is_authenticated=True,
            company=SimpleNamespace(id="company-1"),
            app_user=SimpleNamespace(firebase_uid="transport-user", full_name="Transport User"),
            full_name="Transport User",
        )

        def authenticated_request(method, path, payload, **view_kwargs):
            request = getattr(factory, method)(path, payload, format="json")
            force_authenticate(request, user=user)
            return request, view_kwargs

        with mock.patch.object(firestore_views, "user_can_access_module", return_value=True), \
             mock.patch.object(firestore_views, "module_records_ref", side_effect=lambda _company, module: store.collection(module)), \
             mock.patch.object(firestore_views, "list_module_records",
                               side_effect=lambda _company, module: list(store.records.get(module, {}).values())), \
             mock.patch.object(firestore_views, "get_db", return_value=store), \
             mock.patch.object(firestore_views, "firestore") as firestore_mock, \
             mock.patch.object(firestore_views.ModuleDataView, "_recover_legacy_transport_accounting_requests",
                               side_effect=lambda _company, rows: rows), \
             mock.patch.object(firestore_views.ModuleDataView, "_recover_legacy_transport_requests",
                               side_effect=lambda _company, rows: rows):
            firestore_mock.transactional.side_effect = lambda callback: callback
            submit_request, _ = authenticated_request("post", "/api/accounting/requests/transport/submit", {
                "dispatchId": "TRN-1", "billNumber": "INV-1001", "billDate": "2026-10-25",
                "dueDate": "2026-11-24", "transporterName": "Test Transporter",
                "transportCharges": 1000, "gstRate": 18,
            })
            submitted = firestore_views.AccountingBusinessRequestsView.as_view()(
                submit_request, request_type="transport",
            )

            self.assertEqual(submitted.status_code, 201, submitted.data)
            request_id = submitted.data["record"]["id"]
            self.assertEqual(store.records["transport"]["TRN-1"]["accountingRequestId"], request_id)

            inbox_request = factory.get("/api/accounting/requests")
            force_authenticate(inbox_request, user=user)
            inbox = firestore_views.AccountingBusinessRequestsView.as_view()(inbox_request)
            self.assertEqual(inbox.status_code, 200, inbox.data)
            self.assertEqual([row["id"] for row in inbox.data["records"]], [request_id])

            approve_request, _ = authenticated_request("post", f"/api/accounting/requests/transport/{request_id}/approve", {})
            approved = firestore_views.AccountingBusinessRequestsView.as_view()(
                approve_request, request_type="transport", request_id=request_id, action="approve",
            )
            bill_id = submitted.data["record"]["sourceId"]
            self.assertEqual(approved.status_code, 200, approved.data)
            self.assertEqual(approved.data["record"]["approvalStatus"], "Approved")
            self.assertEqual(store.records["transport"][bill_id]["approvalStatus"], "Approved")
            self.assertEqual(store.records["transport"][bill_id]["billStatus"], "PAYMENT_PENDING")


if __name__ == "__main__":
    import unittest
    unittest.main()
