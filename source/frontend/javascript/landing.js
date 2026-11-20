/**
 * VyaparX - Landing Page Interactive Scripts
 * Sticky header scroll effects, workflow observer, scroller sync, and contact form handling.
 */

/* --- Section Script 1 --- */
document.addEventListener("DOMContentLoaded", () => {
  const header = document.getElementById("site-header");
  const menuToggle = document.getElementById("mobile-menu-toggle");
  const siteNav = document.getElementById("site-nav");

  if (menuToggle && siteNav) {
    const closeMenu = () => {
      siteNav.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.setAttribute("aria-label", "Open navigation menu");
    };

    menuToggle.addEventListener("click", () => {
      const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
      siteNav.classList.toggle("is-open", !isOpen);
      menuToggle.setAttribute("aria-expanded", String(!isOpen));
      menuToggle.setAttribute(
        "aria-label",
        isOpen ? "Open navigation menu" : "Close navigation menu",
      );
    });

    siteNav.addEventListener("click", (event) => {
      if (event.target.closest("a")) closeMenu();
    });

    document.addEventListener("click", (event) => {
      if (!header.contains(event.target)) closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 767) closeMenu();
    });
  }

  const updateHeader = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 20);
  };

  window.addEventListener("scroll", updateHeader, { passive: true });
  updateHeader();
});

/* --- Section Script 2 --- */
(function () {
  const section = document.getElementById("business-modules-section");
  if (!section) return;
  const panel = section.querySelector(".rightModulePanel");
  const scroller = panel?.querySelector(".rightModuleScroller");
  const leftColumn = section.querySelector(":scope > .grid > .sticky");
  if (!panel || !scroller || !leftColumn) return;

  const syncFeatureScrollerHeight = () => {
    if (window.innerWidth <= 1024) {
      panel.style.removeProperty("height");
      return;
    }
    const availableHeight = Math.max(240, window.innerHeight - 140);
    const contentHeight = Math.ceil(leftColumn.getBoundingClientRect().height);
    panel.style.height = `${Math.min(contentHeight, availableHeight)}px`;
  };

  syncFeatureScrollerHeight();
  if ("ResizeObserver" in window) {
    new ResizeObserver(syncFeatureScrollerHeight).observe(leftColumn);
  }
  window.addEventListener("resize", syncFeatureScrollerHeight, { passive: true });

})();

/* --- Section Script 3 --- */
// Intersection Observer for Workflow Section
document.addEventListener("DOMContentLoaded", () => {
  const section = document.getElementById("workflow-section");
  const scroller = document.getElementById("workflow-scroller");
  const steps = document.querySelectorAll(".workflow-step");
  const images = Array.from({ length: 8 }, (_, i) =>
    document.getElementById(`workflow-img-${i + 1}`),
  );

  if (!steps.length || !images[0] || !scroller) return;

  const observerOptions = {
    root: scroller,
    rootMargin: "0px",
    threshold: 0.5, // Trigger when 50% of the element is visible
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const index = entry.target.getAttribute("data-index");

        if (window.innerWidth >= 1024) {
          // Update visible image
          images.forEach((img, i) => {
            if (img) {
              if (i + 1 == index) {
                img.classList.add("active");
              } else {
                img.classList.remove("active");
              }
            }
          });
        }
      }
    });
  }, observerOptions);

  steps.forEach((step) => observer.observe(step));

  // Add full-page scroll wheel lock logic
  window.addEventListener(
    "wheel",
    (e) => {
      if (window.innerWidth < 1024) return; // Only for desktop grid

      const scrollerRect = scroller.getBoundingClientRect();
      const isScrollingDown = e.deltaY > 0;
      const isScrollingUp = e.deltaY < 0;

      const atTop = scroller.scrollTop <= 0;
      const atBottom =
        Math.ceil(scroller.scrollTop + scroller.clientHeight) >=
        scroller.scrollHeight - 1;

      // Lock scroll when the scroller area is fully positioned in view
      // We check if its top is roughly at the sticky position and its bottom hasn't scrolled past the viewport
      const isScrollerInView =
        scrollerRect.top <= 140 &&
        scrollerRect.bottom >= window.innerHeight - 50;

      if (isScrollerInView) {
        if ((isScrollingDown && !atBottom) || (isScrollingUp && !atTop)) {
          e.preventDefault();

          // Snap slightly if drifting
          if (scrollerRect.top > 75 && isScrollingDown) {
            window.scrollBy({
              top: scrollerRect.top - 70,
              behavior: "instant",
            });
          }

          scroller.scrollTop += e.deltaY;
        }
      }
    },
    { passive: false },
  );
});

/* --- Section Script 4 --- */
document.addEventListener("DOMContentLoaded", function () {
  const contactForm = document.getElementById("vyparx-contact-form");
  const businessType = document.getElementById("contact-business");
  const otherWrap = document.getElementById("contact-other-wrap");
  const otherBusiness = document.getElementById("contact-other");
  const successModal = document.getElementById("contact-success-modal");
  const modalOk = document.getElementById("contact-modal-ok");
  const phone = document.getElementById("contact-phone");

  const nameField = document.getElementById("contact-name");
  const companyField = document.getElementById("contact-company");

  if (nameField) {
    nameField.addEventListener("input", function () {
      nameField.value = nameField.value.replace(/[^\p{L}\s]/gu, "");
    });
  }

  if (companyField) {
    companyField.addEventListener("input", function () {
      companyField.value = companyField.value.replace(/[^\p{L}\s]/gu, "");
    });
  }

  if (phone) {
    phone.addEventListener("input", function () {
      phone.value = phone.value.replace(/\D/g, "").slice(0, 10);
    });
  }

  if (businessType) {
    businessType.addEventListener("change", function () {
      const isOther = businessType.value === "Other";
      otherWrap.classList.toggle("hidden", !isOther);
      otherBusiness.required = isOther;
      if (!isOther) otherBusiness.value = "";
    });
  }

  if (contactForm) {
    contactForm.addEventListener("submit", function (event) {
      event.preventDefault();
      const name = document.getElementById("contact-name");
      const company = document.getElementById("contact-company");
      const phone = document.getElementById("contact-phone");
      const countryCode = document.getElementById("contact-country-code");
      const email = document.getElementById("contact-email");
      const message = document.getElementById("contact-message");
      const nameError = document.getElementById("contact-name-error");
      const companyError = document.getElementById("contact-company-error");
      const phoneError = document.getElementById("contact-phone-error");
      const emailError = document.getElementById("contact-email-error");

      const nameValid =
        /^\p{L}(?:[\p{L}\s]*\p{L})?$/u.test(name.value.trim()) &&
        name.value.trim().length >= 2;
      const companyValid =
        /^\p{L}(?:[\p{L}\s]*\p{L})?$/u.test(company.value.trim()) &&
        company.value.trim().length >= 2;
      const phoneValid = /^\d{10}$/.test(phone.value.trim());
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
      const businessValid = businessType.value.trim() !== "";
      const otherValid =
        businessType.value !== "Other" || otherBusiness.value.trim() !== "";
      const messageValid = message.value.trim().length > 0;

      nameError.classList.toggle("hidden", nameValid);
      companyError.classList.toggle("hidden", companyValid);
      phoneError.classList.toggle("hidden", phoneValid);
      emailError.classList.toggle("hidden", emailValid);
      businessType.classList.toggle("border-red-300", !businessValid);
      otherBusiness.classList.toggle("border-red-300", !otherValid);
      message.classList.toggle("border-red-300", !messageValid);

      if (
        !nameValid ||
        !companyValid ||
        !phoneValid ||
        !emailValid ||
        !businessValid ||
        !otherValid ||
        !messageValid
      )
        return;

      successModal.classList.remove("hidden");
      successModal.classList.add("flex");
      contactForm.reset();
      otherWrap.classList.add("hidden");
      otherBusiness.required = false;
    });
  }

  function closeContactModal() {
    successModal.classList.add("hidden");
    successModal.classList.remove("flex");
  }
  if (modalOk) modalOk.addEventListener("click", closeContactModal);
  if (successModal)
    successModal.addEventListener("click", function (event) {
      if (event.target === successModal) closeContactModal();
    });

  const pricingData = {
    3: {
      price: "₹25,000",
      monthly: "₹8,333/month · billed every 3 months",
      cta: "Get Pro · ₹25,000",
    },
    6: {
      price: "₹45,000",
      monthly: "₹7,500/month · billed every 6 months",
      cta: "Get Pro · ₹45,000",
    },
    12: {
      price: "₹85,000",
      monthly: "₹7,083/month · billed yearly",
      cta: "Get Pro · ₹85,000",
    },
  };
  const buttons = document.querySelectorAll(".pricing-month");
  const price = document.getElementById("pricing-price");
  const monthly = document.getElementById("pricing-monthly");
  const cta = document.getElementById("pricing-cta");

  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      const months = button.getAttribute("data-pricing-month");
      const data = pricingData[months];
      if (!data) return;

      buttons.forEach(function (item) {
        item.classList.remove(
          "bg-white/10",
          "text-white",
          "border",
          "border-white/20",
          "shadow-sm",
        );
        item.classList.add("text-slate-300");
      });
      button.classList.remove("text-slate-300");
      button.classList.add(
        "bg-white/10",
        "text-white",
        "border",
        "border-white/20",
        "shadow-sm",
      );

      price.textContent = data.price;
      monthly.textContent = data.monthly;
      cta.textContent = data.cta;
    });
  });
});
