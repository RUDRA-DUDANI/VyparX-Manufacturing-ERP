/**
 * VyaparX ERP - Sign-In & Authentication Controller
 * User credentials validation, role selector, session persistence, and password recovery.
 */

/* =========================
     LOGIN ELEMENTS
  ========================== */

const loginForm = document.getElementById("loginForm");
const email = document.getElementById("email");
const password = document.getElementById("password");
const role = document.getElementById("role");
const signinBtn = document.getElementById("signinBtn");
const rememberMe = document.getElementById("rememberMe");

const passwordToggle = document.getElementById("passwordToggle");

/* =========================
     PASSWORD SHOW / HIDE
  ========================== */

passwordToggle.addEventListener("click", function () {
  if (password.type === "password") {
    password.type = "text";
    passwordToggle.textContent = "Hide";
  } else {
    password.type = "password";
    passwordToggle.textContent = "Show";
  }
});

/* =========================
     PASSWORD VALIDATION
  ========================== */

function validatePassword(value) {
  return {
    length: value.length >= 8,
    upper: /[A-Z]/.test(value),
    lower: /[a-z]/.test(value),
    number: /[0-9]/.test(value),
    special: /[^A-Za-z0-9]/.test(value),
  };
}

function updatePasswordRequirements() {
  const value = password.value;

  const requirements = validatePassword(value);

  updateRequirement("reqLength", requirements.length);

  updateRequirement("reqUpper", requirements.upper);

  updateRequirement("reqLower", requirements.lower);

  updateRequirement("reqNumber", requirements.number);

  updateRequirement("reqSpecial", requirements.special);

  const allValid =
    requirements.length &&
    requirements.upper &&
    requirements.lower &&
    requirements.number &&
    requirements.special;

  if (allValid) {
    password.classList.remove("error");
    password.classList.add("success");

    document.getElementById("passwordError").classList.remove("show");
  } else {
    password.classList.remove("success");

    if (value.length > 0) {
      password.classList.add("error");
    }
  }

  return allValid;
}

function updateRequirement(id, valid) {
  const element = document.getElementById(id);

  if (valid) {
    element.classList.add("valid");
  } else {
    element.classList.remove("valid");
  }
}

password.addEventListener("input", updatePasswordRequirements);

/* =========================
     CAPS LOCK
  ========================== */

password.addEventListener("keyup", function (event) {
  const warning = document.getElementById("capsWarning");

  if (event.getModifierState("CapsLock")) {
    warning.style.display = "block";
  } else {
    warning.style.display = "none";
  }
});

/* =========================
     EMAIL VALIDATION
  ========================== */

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/* =========================
     LOGIN SUBMIT
  ========================== */

loginForm.addEventListener("submit", function (event) {
  event.preventDefault();

  let valid = true;

  /* EMAIL */

  if (!validEmail(email.value.trim())) {
    document.getElementById("emailError").classList.add("show");

    email.classList.add("error");

    valid = false;
  } else {
    document.getElementById("emailError").classList.remove("show");

    email.classList.remove("error");
    email.classList.add("success");
  }

  /* PASSWORD */

  const passwordValid = updatePasswordRequirements();

  if (!passwordValid) {
    document.getElementById("passwordError").classList.add("show");

    password.classList.add("error");

    valid = false;
  }

  /* ROLE */

  if (!role.value) {
    document.getElementById("roleError").classList.add("show");

    role.classList.add("error");

    valid = false;
  } else {
    document.getElementById("roleError").classList.remove("show");

    role.classList.remove("error");
    role.classList.add("success");
  }

  /* STOP LOGIN IF ANYTHING INVALID */

  if (!valid) {
    return;
  }

  const inputEmail = email.value.trim().toLowerCase();
  const inputPassword = password.value;
  const selectedRole = role.value;

  /* AUTHENTICATE WITH CENTRALIZED SECURE ENGINE */

  signinBtn.disabled = true;
  signinBtn.textContent = "Verifying Credentials...";

  (async function () {
    try {
      const result = await window.VyaparXAuth.login(
        inputEmail,
        inputPassword,
        selectedRole,
      );

      /* REMEMBER EMAIL */
      if (rememberMe.checked) {
        localStorage.setItem("vyparxRememberedEmail", email.value.trim());
      } else {
        localStorage.removeItem("vyparxRememberedEmail");
      }

      signinBtn.textContent = "Access Granted! Redirecting...";

      setTimeout(() => {
        window.location.href = result.dashboardUrl;
      }, 400);
    } catch (err) {
      signinBtn.disabled = false;
      signinBtn.textContent = "Sign In";

      const msg = err.message || "Authentication failed.";

      if (msg.includes("No registered account")) {
        const emailError = document.getElementById("emailError");
        emailError.textContent = msg;
        emailError.classList.add("show");
        email.classList.add("error");
        email.classList.remove("success");
      } else if (msg.includes("Invalid email or password")) {
        const passwordError = document.getElementById("passwordError");
        passwordError.textContent = msg;
        passwordError.classList.add("show");
        password.classList.add("error");
        password.classList.remove("success");
      } else if (msg.includes("deactivated")) {
        const roleError = document.getElementById("roleError");
        roleError.textContent = msg;
        roleError.classList.add("show");
        role.classList.add("error");
        role.classList.remove("success");
      } else if (msg.includes("not authorized for the selected role") || msg.includes("Access Denied")) {
        const roleError = document.getElementById("roleError");
        roleError.textContent = msg;
        roleError.classList.add("show");
        role.classList.add("error");
        role.classList.remove("success");
      } else {
        const roleError = document.getElementById("roleError");
        roleError.textContent = msg;
        roleError.classList.add("show");
      }
    }
  })();
});

email.addEventListener("input", function () {
  const err = document.getElementById("emailError");
  if (err && err.textContent !== "Please enter a valid email address.") {
    err.textContent = "Please enter a valid email address.";
  }
});

password.addEventListener("input", function () {
  const err = document.getElementById("passwordError");
  if (err && err.textContent !== "Please complete all password requirements.") {
    err.textContent = "Please complete all password requirements.";
  }
});

/* =========================
     REMEMBERED EMAIL
  ========================== */

const rememberedEmail = localStorage.getItem("vyparxRememberedEmail");

if (rememberedEmail) {
  email.value = rememberedEmail;
  rememberMe.checked = true;
}

/* =========================
     FORGOT PASSWORD
  ========================== */

const forgotModal = document.getElementById("forgotModal");

document
  .getElementById("forgotPassword")
  .addEventListener("click", function () {
    forgotModal.classList.add("active");
  });

document.getElementById("forgotClose").addEventListener("click", function () {
  forgotModal.classList.remove("active");
});

document.getElementById("resetBtn").addEventListener("click", function () {
  const resetEmail = document.getElementById("resetEmail");

  const resetError = document.getElementById("resetError");

  if (!validEmail(resetEmail.value.trim())) {
    resetEmail.classList.add("error");
    resetError.classList.add("show");

    return;
  }

  resetEmail.classList.remove("error");
  resetError.classList.remove("show");

  (async function () {
    try {
      await window.VyaparXAuth.sendPasswordReset(resetEmail.value.trim());
      alert(
        "If this email is registered, password reset instructions will be sent.",
      );
    } catch (err) {
      alert(err.message || "Password reset is not available right now.");
    }
  })();

  forgotModal.classList.remove("active");
});

// Check if user was redirected here with an auth guard message
const pendingAuthMsg = sessionStorage.getItem("vyparx_auth_msg");
if (pendingAuthMsg) {
  const roleError = document.getElementById("roleError");
  if (roleError) {
    roleError.textContent = pendingAuthMsg;
    roleError.classList.add("show");
  }
  sessionStorage.removeItem("vyparx_auth_msg");
}
