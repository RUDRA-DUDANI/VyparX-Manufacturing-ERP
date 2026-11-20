import uuid
from decimal import Decimal

from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    ADMIN = "Admin", "Admin"
    CRM = "CRM", "CRM"
    SALES = "Sales", "Sales"
    PURCHASE = "Purchase", "Purchase"
    INVENTORY = "Inventory", "Inventory"
    PRODUCTION = "Production", "Production"
    QUALITY_CONTROL = "Quality Control", "Quality Control"
    TRANSPORT = "Transport", "Transport"
    EMPLOYEE_MANAGEMENT = "Employee Management", "Employee Management"
    ACCOUNTING_FINANCE = "Accounting & Finance", "Accounting & Finance"


class Module(models.TextChoices):
    """Departments that can have a department head assigned."""

    CRM = "CRM", "CRM"
    SALES_ORDER = "Sales Order", "Sales Order"
    PURCHASE_TRADING = "Purchase & Trading", "Purchase & Trading"
    PRODUCTION = "Production", "Production"
    INVENTORY = "Inventory", "Inventory"
    TRANSPORT = "Transport", "Transport"
    ACCOUNTING = "Accounting", "Accounting"


def department_labels():
    """Department display labels matching admin.js MODS order."""
    return [m for m in Module]


class MembershipStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    INACTIVE = "INACTIVE", "Inactive"


class Company(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company_name = models.CharField(max_length=180)
    registered_business_name = models.CharField(max_length=220)
    gstin = models.CharField(max_length=15, blank=True)
    email = models.EmailField()
    phone = models.CharField(max_length=32)
    address = models.TextField()
    country = models.CharField(max_length=80)
    state = models.CharField(max_length=80)
    pin_code = models.CharField(max_length=12)
    business_type = models.CharField(max_length=120, blank=True)
    industry = models.CharField(max_length=120, blank=True)
    employees = models.CharField(max_length=40, blank=True)
    business_location = models.CharField(max_length=220, blank=True)
    requirements = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["email"]),
            models.Index(fields=["gstin"]),
        ]

    def __str__(self):
        return self.company_name


class AppUser(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    firebase_uid = models.CharField(max_length=128, unique=True)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=160)
    phone = models.CharField(max_length=32, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.email


class CompanyMembership(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(AppUser, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=40, choices=Role.choices)
    department = models.CharField(max_length=80)
    # Department in which this user is the assigned head (blank when not a head).
    head_department = models.CharField(max_length=80, blank=True, default="")
    status = models.CharField(
        max_length=12,
        choices=MembershipStatus.choices,
        default=MembershipStatus.ACTIVE,
    )
    is_company_owner = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        AppUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_memberships",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["company", "user"], name="unique_company_user_membership"),
        ]
        indexes = [
            models.Index(fields=["company", "role", "status"]),
            models.Index(fields=["company", "head_department"]),
        ]

    @property
    def is_active(self):
        return self.status == MembershipStatus.ACTIVE and self.user.is_active and self.company.is_active

    def __str__(self):
        return f"{self.user.email} - {self.company.company_name} - {self.role}"


class CustomerStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    INACTIVE = "INACTIVE", "Inactive"


class LeadStatus(models.TextChoices):
    NEW = "NEW", "New"
    CONTACTED = "CONTACTED", "Contacted"
    FOLLOW_UP = "FOLLOW_UP", "Follow Up"
    QUOTATION = "QUOTATION", "Quotation"
    CONVERTED = "CONVERTED", "Converted"
    LOST = "LOST", "Lost"
    CLOSED = "CLOSED", "Closed"


class CustomerType(models.TextChoices):
    LEAD = "Lead", "Lead"
    CUSTOMER = "Customer", "Customer"


class Customer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="customers")
    name = models.CharField(max_length=180)
    contact_person = models.CharField(max_length=160, blank=True)
    phone = models.CharField(max_length=32)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    gstin = models.CharField(max_length=15, blank=True)
    state = models.CharField(max_length=80, blank=True)
    customer_type = models.CharField(max_length=12, choices=CustomerType.choices, default=CustomerType.LEAD)
    lead_source = models.CharField(max_length=80, blank=True)
    lead_status = models.CharField(max_length=20, choices=LeadStatus.choices, default=LeadStatus.NEW)
    follow_up_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    assigned_to = models.ForeignKey(
        AppUser,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_customers",
    )
    status = models.CharField(max_length=12, choices=CustomerStatus.choices, default=CustomerStatus.ACTIVE)
    created_by = models.ForeignKey(
        AppUser,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_customers",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["company", "email"], condition=~models.Q(email=""), name="unique_customer_email_per_company"),
            models.UniqueConstraint(fields=["company", "gstin"], condition=~models.Q(gstin=""), name="unique_customer_gstin_per_company"),
        ]
        indexes = [
            models.Index(fields=["company", "customer_type", "status"]),
            models.Index(fields=["company", "lead_status"]),
            models.Index(fields=["company", "name"]),
        ]

    def __str__(self):
        return self.name


class ProductService(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="crm_products")
    name = models.CharField(max_length=180)
    code = models.CharField(max_length=64, blank=True)
    description = models.TextField(blank=True)
    unit = models.CharField(max_length=32, default="Nos")
    hsn_sac = models.CharField(max_length=32, blank=True)
    rate = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["company", "code"], condition=~models.Q(code=""), name="unique_product_code_per_company"),
        ]
        indexes = [
            models.Index(fields=["company", "is_active"]),
            models.Index(fields=["company", "name"]),
        ]

    def __str__(self):
        return self.name


class QuotationStatus(models.TextChoices):
    DRAFT = "Draft", "Draft"
    SENT = "Sent", "Sent"
    ACCEPTED = "Accepted", "Accepted"
    REJECTED = "Rejected", "Rejected"
    EXPIRED = "Expired", "Expired"
    REVISED = "Revised", "Revised"


class Quotation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="quotations")
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="quotations")
    quotation_number = models.CharField(max_length=40)
    quotation_date = models.DateField(default=timezone.localdate)
    valid_until = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=QuotationStatus.choices, default=QuotationStatus.DRAFT)
    revision_number = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True)
    terms = models.TextField(blank=True)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    tax_total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    grand_total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    created_by = models.ForeignKey(AppUser, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_quotations")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["company", "quotation_number"], name="unique_quotation_number_per_company"),
        ]
        indexes = [
            models.Index(fields=["company", "status"]),
            models.Index(fields=["company", "quotation_date"]),
        ]

    def __str__(self):
        return self.quotation_number


class QuotationItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quotation = models.ForeignKey(Quotation, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(ProductService, null=True, blank=True, on_delete=models.SET_NULL)
    product_name = models.CharField(max_length=180)
    description = models.TextField(blank=True)
    unit = models.CharField(max_length=32, blank=True)
    hsn_sac = models.CharField(max_length=32, blank=True)
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    rate = models.DecimalField(max_digits=14, decimal_places=2)
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))
    taxable_amount = models.DecimalField(max_digits=14, decimal_places=2)
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))
    tax_amount = models.DecimalField(max_digits=14, decimal_places=2)
    line_total = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        indexes = [models.Index(fields=["quotation"])]


class QuotationHistory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    quotation = models.ForeignKey(Quotation, on_delete=models.CASCADE, related_name="history")
    action = models.CharField(max_length=64)
    from_status = models.CharField(max_length=16, blank=True)
    to_status = models.CharField(max_length=16, blank=True)
    revision_number = models.PositiveIntegerField(default=0)
    note = models.TextField(blank=True)
    performed_by = models.ForeignKey(AppUser, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["quotation", "created_at"])]


class SalesOrderStatus(models.TextChoices):
    DRAFT = "Draft", "Draft"
    CONFIRMED = "Confirmed", "Confirmed"
    AWAITING_MATERIALS = "Awaiting Materials", "Awaiting Materials"
    IN_PRODUCTION = "In Production", "In Production"
    READY_FOR_DISPATCH = "Ready for Dispatch", "Ready for Dispatch"
    PARTIALLY_DELIVERED = "Partially Delivered", "Partially Delivered"
    DELIVERED = "Delivered", "Delivered"
    CANCELLED = "Cancelled", "Cancelled"


class SalesOrder(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="sales_orders")
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="sales_orders")
    quotation = models.OneToOneField(Quotation, null=True, blank=True, on_delete=models.PROTECT, related_name="sales_order")
    order_number = models.CharField(max_length=40)
    order_date = models.DateField(default=timezone.localdate)
    expected_delivery_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=32, choices=SalesOrderStatus.choices, default=SalesOrderStatus.DRAFT)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    tax_total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    grand_total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    created_by = models.ForeignKey(AppUser, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_sales_orders")
    inventory_record_id = models.CharField(max_length=64, blank=True)
    production_record_id = models.CharField(max_length=64, blank=True)
    transport_record_id = models.CharField(max_length=64, blank=True)
    invoice_record_id = models.CharField(max_length=64, blank=True)
    payment_record_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["company", "order_number"], name="unique_sales_order_number_per_company"),
        ]
        indexes = [
            models.Index(fields=["company", "status"]),
            models.Index(fields=["company", "order_date"]),
        ]

    def __str__(self):
        return self.order_number


class SalesOrderItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sales_order = models.ForeignKey(SalesOrder, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(ProductService, null=True, blank=True, on_delete=models.SET_NULL)
    product_name = models.CharField(max_length=180)
    description = models.TextField(blank=True)
    unit = models.CharField(max_length=32, blank=True)
    hsn_sac = models.CharField(max_length=32, blank=True)
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    rate = models.DecimalField(max_digits=14, decimal_places=2)
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))
    taxable_amount = models.DecimalField(max_digits=14, decimal_places=2)
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))
    tax_amount = models.DecimalField(max_digits=14, decimal_places=2)
    line_total = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        indexes = [models.Index(fields=["sales_order"])]


class SalesOrderHistory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sales_order = models.ForeignKey(SalesOrder, on_delete=models.CASCADE, related_name="history")
    action = models.CharField(max_length=64)
    from_status = models.CharField(max_length=32, blank=True)
    to_status = models.CharField(max_length=32, blank=True)
    note = models.TextField(blank=True)
    performed_by = models.ForeignKey(AppUser, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["sales_order", "created_at"])]


class TaskStatus(models.TextChoices):
    PENDING = "Pending", "Pending"
    IN_PROGRESS = "In Progress", "In Progress"
    COMPLETED = "Completed", "Completed"
    OVERDUE = "Overdue", "Overdue"


class Task(models.Model):
    """Tasks and announcements sent by the Admin to a department.

    Deleted tasks are soft-deleted (archived) so audit history is preserved.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="tasks")
    department = models.CharField(max_length=80)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    type = models.CharField(max_length=32, default="Task")
    priority = models.CharField(max_length=16, default="Medium")
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=TaskStatus.choices, default=TaskStatus.PENDING)
    is_read = models.BooleanField(default=False)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(AppUser, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_tasks")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["company", "department", "status"]),
            models.Index(fields=["company", "is_deleted"]),
        ]

    def __str__(self):
        return self.title


class AlertSeverity(models.TextChoices):
    INFO = "INFO", "Info"
    WARNING = "WARNING", "Warning"
    CRITICAL = "CRITICAL", "Critical"


class Alert(models.Model):
    """Real-time business alerts generated from actual records (low stock,
    overdue orders, etc.). Deduplicated by dedup_key so the same unresolved
    event never produces duplicate rows.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="alerts")
    severity = models.CharField(max_length=16, choices=AlertSeverity.choices, default=AlertSeverity.INFO)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    source_module = models.CharField(max_length=64)
    record_ref = models.CharField(max_length=64, blank=True)
    link = models.CharField(max_length=120, blank=True)
    dedup_key = models.CharField(max_length=160)
    is_read = models.BooleanField(default=False)
    is_dismissed = models.BooleanField(default=False)
    event_time = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["company", "dedup_key"], name="unique_active_alert_per_company")
        ]
        indexes = [
            models.Index(fields=["company", "severity"]),
            models.Index(fields=["company", "source_module"]),
        ]

    def __str__(self):
        return self.title
