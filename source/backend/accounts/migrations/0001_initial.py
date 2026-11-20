import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="AppUser",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("firebase_uid", models.CharField(max_length=128, unique=True)),
                ("email", models.EmailField(max_length=254, unique=True)),
                ("full_name", models.CharField(max_length=160)),
                ("phone", models.CharField(blank=True, max_length=32)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name="Company",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("company_name", models.CharField(max_length=180)),
                ("registered_business_name", models.CharField(max_length=220)),
                ("gstin", models.CharField(blank=True, max_length=15)),
                ("email", models.EmailField(max_length=254)),
                ("phone", models.CharField(max_length=32)),
                ("address", models.TextField()),
                ("country", models.CharField(max_length=80)),
                ("state", models.CharField(max_length=80)),
                ("pin_code", models.CharField(max_length=12)),
                ("business_type", models.CharField(blank=True, max_length=120)),
                ("industry", models.CharField(blank=True, max_length=120)),
                ("employees", models.CharField(blank=True, max_length=40)),
                ("business_location", models.CharField(blank=True, max_length=220)),
                ("requirements", models.JSONField(blank=True, default=dict)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name="CompanyMembership",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                (
                    "role",
                    models.CharField(
                        choices=[
                            ("Admin", "Admin"),
                            ("CRM", "CRM"),
                            ("Sales", "Sales"),
                            ("Purchase", "Purchase"),
                            ("Inventory", "Inventory"),
                            ("Production", "Production"),
                            ("Quality Control", "Quality Control"),
                            ("Transport", "Transport"),
                            ("Employee Management", "Employee Management"),
                            ("Accounting & Finance", "Accounting & Finance"),
                        ],
                        max_length=40,
                    ),
                ),
                ("department", models.CharField(max_length=80)),
                ("status", models.CharField(choices=[("ACTIVE", "Active"), ("INACTIVE", "Inactive")], default="ACTIVE", max_length=12)),
                ("is_company_owner", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("company", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="memberships", to="accounts.company")),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_memberships", to="accounts.appuser")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="memberships", to="accounts.appuser")),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=("company", "user"), name="unique_company_user_membership"),
                ],
            },
        ),
        migrations.AddIndex(model_name="company", index=models.Index(fields=["email"], name="accounts_co_email_67d3c1_idx")),
        migrations.AddIndex(model_name="company", index=models.Index(fields=["gstin"], name="accounts_co_gstin_0e4b55_idx")),
        migrations.AddIndex(model_name="companymembership", index=models.Index(fields=["company", "role", "status"], name="accounts_co_company_b94ef5_idx")),
    ]
