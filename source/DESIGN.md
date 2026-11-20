---
name: Nexus Enterprise
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45464d'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#0058be'
  on-secondary: '#ffffff'
  secondary-container: '#2170e4'
  on-secondary-container: '#fefcff'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#23005c'
  on-tertiary-container: '#9466ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#e9ddff'
  tertiary-fixed-dim: '#d0bcff'
  on-tertiary-fixed: '#23005c'
  on-tertiary-fixed-variant: '#5516be'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
  surface-dark: '#1E293B'
  border-subtle: '#E2E8F0'
  text-muted: '#64748B'
  accent-glow: rgba(59, 130, 246, 0.15)
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  container-max: 1440px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 40px
---

## Brand & Style

The design system is engineered for high-scale B2B SaaS environments, prioritizing clarity, trust, and professional momentum. The brand personality is "Architectural Intelligence"—it feels established and enterprise-grade yet possesses the kinetic energy of a modern startup.

The visual style is **Corporate Modern with Glassmorphism accents**. It utilizes a structured grid, generous white space, and a sophisticated layering system. The aesthetic draws from the precision of technical blueprints while maintaining the approachability of high-end consumer software. Expect deep, immersive backgrounds contrasted with vibrant, glowing interactive elements that guide the user through complex ERP workflows.

## Colors

This design system utilizes a "Deep Sea" palette. The foundation is built on **Deep Navy (#0F172A)** for primary text and dark-mode surfaces, providing an immediate sense of stability. 

**Vibrant Blue (#3B82F6)** serves as the primary action color, used for high-priority CTAs and active states. **Purple Accent (#8B5CF6)** is reserved for "Intelligence" features—AI insights, premium modules, or data visualizations—to distinguish them from standard CRUD operations. **F8FAFC** is the workhorse for page backgrounds, ensuring the UI feels airy and reduces eye strain during long-form data entry.

## Typography

The typography strategy pairs **Geist** for headlines with **Inter** for body and UI elements. Geist provides a technical, precise edge to large titles, while Inter ensures maximum readability for dense data tables and complex forms.

Hierarchy is maintained through strict weight distribution. Use `label-caps` for table headers and small section titles to provide a clear structural anchor. For mobile views, large display type should scale down aggressively to prevent awkward line breaks in narrow containers.

## Layout & Spacing

This design system uses a **12-column fluid grid** for internal dashboards and a **fixed-center grid** for marketing or report-heavy views. The spacing rhythm is based on an 8px base unit.

- **Desktop (1440px+):** 12 columns, 24px gutters, 40px side margins.
- **Tablet (768px - 1439px):** 8 columns, 20px gutters, 24px side margins.
- **Mobile (Up to 767px):** 4 columns, 16px gutters, 16px side margins.

For dense ERP views, use "Compact Padding" (12px) within cards to maximize information density without sacrificing clarity. For analytical dashboards, use "Spacious Padding" (24px-32px) to allow data visualizations to breathe.

## Elevation & Depth

Hierarchy is communicated through **Tonal Layering and Soft Shadows**. 

1. **Level 0 (Background):** #F8FAFC – The canvas.
2. **Level 1 (Cards/Surface):** #FFFFFF – Pure white surfaces with a 1px border of #E2E8F0. 
3. **Level 2 (Active/Hover):** A subtle shadow (0px 10px 15px -3px rgba(15, 23, 42, 0.08)) to indicate interactivity.
4. **Level 3 (Modals/Overlays):** High-diffusion shadows with a 10% opacity tint of the Primary color to ground the element.

Glassmorphism is applied to sticky headers and navigation sidebars using a `backdrop-blur` of 12px and a semi-transparent white fill (rgba(255, 255, 255, 0.8)).

## Shapes

The shape language is sophisticated and modern. Standard UI components like inputs and small buttons use **0.5rem (8px)** rounding. 

However, primary containers and dashboard cards utilize **rounded-2xl (1.5rem/24px)** to create a distinctive, high-end SaaS appearance. This contrast between "harder" functional elements and "softer" structural containers creates a balanced, professional aesthetic that feels approachable yet precise.

## Components

### Buttons
- **Primary:** Solid #3B82F6 with white text. 8px border radius. Subtle inner glow on hover.
- **Secondary:** Ghost style with #3B82F6 border and text. 
- **Tertiary:** Pure text with a light slate-100 background on hover.

### Cards
Cards are the primary container unit. They must feature a white background, 24px corner radius, and a 1px #E2E8F0 border. For "Featured" metrics, use a subtle 2px top-border in the secondary or tertiary color.

### Input Fields
Inputs should be clean with a 1px border (#E2E8F0). On focus, the border transitions to #3B82F6 with a soft 4px outer glow in the same color (20% opacity).

### Professional Line Icons
Use 24px stroke-based icons with a consistent 2px weight. Icons in navigation should use #64748B (Muted) when inactive and #3B82F6 when active.

### Data Tables
Tables are the heart of the ERP. Use a "Zebra" striping pattern with #F8FAFC on even rows. Headers must be in `label-caps` with a sticky top position.