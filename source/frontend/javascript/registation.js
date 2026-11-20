/**
 * VyaparX ERP - Organization Registration Controller
 * Multi-step onboarding wizard, form validations, and account submission.
 */

let currentStep = 1;

const steps = {
  1: document.getElementById("step1"),
  2: document.getElementById("step2"),
  3: document.getElementById("step3"),
};

const nextBtn = document.getElementById("nextBtn");
const backBtn = document.getElementById("backBtn");
const submitBtn = document.getElementById("submitBtn");
const errorMessage = document.getElementById("errorMessage");

const businessType = document.getElementById("businessType");
const otherBusinessWrapper = document.getElementById("otherBusinessWrapper");

const otherBusiness = document.getElementById("otherBusiness");

/* =====================================================
       ONLY CHARACTERS + SPACES
       Full Name
       ===================================================== */

document.getElementById("fullName").addEventListener("input", function () {
  this.value = this.value.replace(/[^a-zA-Z\s]/g, "");
});

/* =====================================================
       ONLY CHARACTERS + SPACES
       Company Name
       ===================================================== */

document.getElementById("companyName").addEventListener("input", function () {
  this.value = this.value.replace(/[^a-zA-Z\s]/g, "");
});

document
  .getElementById("registeredBusinessName")
  .addEventListener("input", function () {
    this.value = this.value.replace(/[^a-zA-Z0-9\s.&()-]/g, "");
  });

document.getElementById("gstin").addEventListener("input", function () {
  this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15);
});

/* =====================================================
       ONLY CHARACTERS + SPACES
       CITY
       ===================================================== */

document.getElementById("city").addEventListener("input", function () {
  this.value = this.value.replace(/[^a-zA-Z\s]/g, "");
});

/* =====================================================
       ONLY CHARACTERS + SPACES
       STATE
       ===================================================== */

document.getElementById("state").addEventListener("input", function () {
  this.value = this.value.replace(/[^a-zA-Z\s]/g, "");
});

/* =====================================================
       MOBILE - ONLY NUMBERS / MAX 10 DIGITS
       ===================================================== */

document.getElementById("mobile").addEventListener("input", function () {
  this.value = this.value.replace(/\D/g, "").slice(0, 10);
});

/* =====================================================
       PIN CODE - ONLY NUMBERS
       ===================================================== */

document.getElementById("pinCode").addEventListener("input", function () {
  this.value = this.value.replace(/\D/g, "");
});

/* =====================================================
       OTHER BUSINESS TYPE
       ===================================================== */

businessType.addEventListener("change", function () {
  if (this.value === "Other") {
    otherBusinessWrapper.classList.remove("hidden");

    otherBusiness.required = true;
  } else {
    otherBusinessWrapper.classList.add("hidden");

    otherBusiness.required = false;

    otherBusiness.value = "";
  }
});

/* =====================================================
       OTHER INDUSTRY
       ===================================================== */

const industry = document.getElementById("industry");

const otherIndustryWrapper = document.getElementById("otherIndustryWrapper");

const otherIndustry = document.getElementById("otherIndustry");

industry.addEventListener("change", function () {
  if (this.value === "Other") {
    otherIndustryWrapper.classList.remove("hidden");

    otherIndustry.required = true;
  } else {
    otherIndustryWrapper.classList.add("hidden");

    otherIndustry.required = false;

    otherIndustry.value = "";
  }
});

/* =====================================================
       ERROR MESSAGE
       ===================================================== */

function showError(message) {
  errorMessage.textContent = message;

  errorMessage.classList.remove("hidden");
}

function hideError() {
  errorMessage.classList.add("hidden");

  errorMessage.textContent = "";
}

/* =====================================================
       PASSWORD VALIDATION
       
       Requirements:
       - Minimum 8 characters
       - 1 uppercase
       - 1 lowercase
       - 1 number
       - 1 special character
       ===================================================== */

function validateAdminPassword() {
  const password = document.getElementById("adminPassword").value;

  const passwordPattern =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

  if (!passwordPattern.test(password)) {
    showError(
      "Admin Password must contain at least 8 characters, 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.",
    );

    return false;
  }

  return true;
}

/* =====================================================
       VALIDATE CURRENT STEP
       ===================================================== */

function validateCurrentStep() {
  hideError();

  const currentSection = steps[currentStep];

  const fields = currentSection.querySelectorAll(
    "input[required], select[required], textarea[required]",
  );

  for (const field of fields) {
    if (!field.checkValidity()) {
      field.reportValidity();

      return false;
    }
  }

  /* STEP 1 VALIDATION */

  if (currentStep === 1) {
    /* Mobile */

    const mobile = document.getElementById("mobile").value;

    if (mobile.length !== 10) {
      showError("Please enter a valid 10 digit mobile number.");

      return false;
    }

    /* Admin Password */

    if (!validateAdminPassword()) {
      return false;
    }

    const password = document.getElementById("adminPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (password !== confirmPassword) {
      showError("Admin Password and Confirm Admin Password must match.");

      return false;
    }
  }

  if (currentStep === 2) {
    const gstin = document.getElementById("gstin").value.trim();
    const gstinPattern =
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

    if (gstin && !gstinPattern.test(gstin)) {
      showError("Please enter a valid GSTIN or leave it blank.");

      return false;
    }
  }

  /* STEP 3 MODULE VALIDATION */

  if (currentStep === 3) {
    const modules = document.querySelectorAll('input[name="modules"]:checked');

    if (modules.length === 0) {
      showError("Please select at least one ERP module.");

      return false;
    }
  }

  return true;
}

/* =====================================================
       UPDATE STEPS
       ===================================================== */

function updateSteps() {
  Object.values(steps).forEach((section) => {
    section.classList.add("hidden");
  });

  steps[currentStep].classList.remove("hidden");

  /* Step Circles */

  for (let i = 1; i <= 3; i++) {
    const circle = document.getElementById("stepCircle" + i);

    const text = document.getElementById("stepText" + i);

    circle.classList.remove("step-active", "step-complete");

    if (i === currentStep) {
      circle.classList.add("step-active");

      text.classList.remove("text-slate-500");

      text.classList.add("text-slate-900");
    } else if (i < currentStep) {
      circle.classList.add("step-complete");
    }
  }

  /* Lines */

  document.getElementById("line1").className =
    currentStep >= 2
      ? "step-line-active w-10 sm:w-20 h-[2px] mx-4"
      : "step-line w-10 sm:w-20 h-[2px] mx-4";

  document.getElementById("line2").className =
    currentStep >= 3
      ? "step-line-active w-10 sm:w-20 h-[2px] mx-4"
      : "step-line w-10 sm:w-20 h-[2px] mx-4";

  /* Back Button */

  if (currentStep === 1) {
    backBtn.classList.add("hidden");
  } else {
    backBtn.classList.remove("hidden");
  }

  /* Next / Submit */

  if (currentStep === 3) {
    nextBtn.classList.add("hidden");

    submitBtn.classList.remove("hidden");
  } else {
    nextBtn.classList.remove("hidden");

    submitBtn.classList.add("hidden");
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

/* =====================================================
       NEXT BUTTON
       ===================================================== */

nextBtn.addEventListener("click", function () {
  if (!validateCurrentStep()) {
    return;
  }

  if (currentStep < 3) {
    currentStep++;

    updateSteps();
  }
});

/* =====================================================
       BACK BUTTON
       ===================================================== */

backBtn.addEventListener("click", function () {
  hideError();

  if (currentStep > 1) {
    currentStep--;

    updateSteps();
  }
});

/* =====================================================
       FINAL REGISTRATION
       ===================================================== */

document
  .getElementById("registrationForm")
  .addEventListener("submit", function (event) {
    event.preventDefault();

    if (!validateCurrentStep()) {
      return;
    }

    /* Selected Modules */

    const modules = Array.from(
      document.querySelectorAll('input[name="modules"]:checked'),
    ).map((item) => item.value);

    /* Registration Data */

    const registrationData = {
      personal: {
        fullName: document.getElementById("fullName").value,

        email: document.getElementById("email").value,

        countryCode: document.getElementById("countryCode").value,

        mobile: document.getElementById("mobile").value,

        address: document.getElementById("address").value,

        city: document.getElementById("city").value,

        state: document.getElementById("state").value,

        country: document.getElementById("country").value,

        pinCode: document.getElementById("pinCode").value,

        adminPassword: document.getElementById("adminPassword").value,

        confirmPassword: document.getElementById("confirmPassword").value,
      },

      business: {
        companyName: document.getElementById("companyName").value,

        registeredBusinessName: document.getElementById(
          "registeredBusinessName",
        ).value,

        gstin: document.getElementById("gstin").value,

        businessType:
          businessType.value === "Other"
            ? otherBusiness.value
            : businessType.value,

        industry:
          industry.value === "Other" ? otherIndustry.value : industry.value,

        employees: document.getElementById("employees").value,

        businessLocation: document.getElementById("businessLocation").value,
      },

      requirements: {
        modules: modules,

        requirements: document.getElementById("requirements").value,
      },
    };

    /* Save Registration Data via Centralized Engine */

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account…";
    (async function () {
      try {
        await window.VyaparXAuth.registerCompany(registrationData);

        // Pre-remember email for easy sign-in on login page
        localStorage.setItem(
          "vyparxRememberedEmail",
          registrationData.personal.email.trim(),
        );

        /* Success Popup */
        document.getElementById("successModal").classList.remove("hidden");
      } catch (err) {
        const detail = err.data?.fields && typeof err.data.fields === "object"
          ? Object.entries(err.data.fields).map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(", ") : messages}`).join("; ")
          : err.message;
        showError(detail || "Registration failed. Please check your inputs.");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account";
      }
    })();
  });

/* =====================================================
       CLOSE SUCCESS MODAL
       ===================================================== */

document.getElementById("closeModal").addEventListener("click", function () {
  document.getElementById("successModal").classList.add("hidden");
});

/* Initial Step */

updateSteps();
