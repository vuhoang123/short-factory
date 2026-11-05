---
name: Shorts Factory
description: Warm, focused local studio for turning reviewed social posts into downloadable short videos.
colors:
  warm-ground: "#f6f0eb"
  surface: "#ffffff"
  ink: "#493b36"
  muted: "#76655b"
  action: "#ae4228"
  action-hover: "#91361f"
  border: "#d9c9bd"
  action-soft: "#f6e8df"
  surface-alt: "#eee5dd"
  field-border: "#bfaea1"
  focus: "#ae4228"
typography:
  display:
    fontFamily: "Be Vietnam Pro, Segoe UI, sans-serif"
    fontSize: "clamp(28px, 2.3vw, 34px)"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Be Vietnam Pro, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Be Vietnam Pro, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Be Vietnam Pro, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Be Vietnam Pro, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  control: "12px"
  compact: "12px"
  medium: "14px"
  large: "16px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section: "40px"
  control: "44px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "{spacing.control}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "{spacing.control}"
  text-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "{spacing.control}"
  navigation-link:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "{spacing.control}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.large}"
    padding: "24px"
  preview:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.ink}"
    rounded: "{rounded.large}"
    padding: "24px"
  notice:
    backgroundColor: "{colors.action-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
---

# Design System: Shorts Factory

## Overview

**Creative North Star: "Easy Studio"**

Shorts Factory should feel like a calm, friendly workbench for a Vietnamese-speaking creator working locally. The interface starts from the next useful action—bring in a permitted post, review its source images and rights, shape the narration, then render and download an MP4—without making administration compete with creation.

The visual world is warm paper around white working surfaces. Be Vietnam Pro gives Vietnamese labels and longer explanations a human, readable voice; terracotta is reserved for the action that moves the current task forward. A practical preview stays beside the editor on wide screens and moves above the work on small screens. The UI is quiet at rest, explicit about progress and recovery, and honest about review gates and local-only output.

**Key Characteristics:**
- Warm paper ground with white, tactile task surfaces.
- One clear current task with a useful portrait preview nearby.
- Friendly Vietnamese-first typography with comfortable reading rhythm.
- Terracotta action color used for decisive movement, not decoration.
- Flat tonal depth, gentle borders, and broad accessible controls.

### Named Rules

**The Easy-Path Rule.** Keep one understandable next action visible for the current task, while preserving access to the source, draft, preview, and recovery state.

## Colors

The palette is grounded and low-glare: warm paper, white work surfaces, brown ink, and a single terracotta action voice.

### Primary

- **Burnt Terracotta Action:** The decisive action color for creating, continuing, saving, and rendering. Use it sparingly so the next useful action remains unmistakable.

### Neutral

- **Warm Paper Ground:** The application canvas and page-level background; it gives the white editor surfaces room to breathe.
- **White Working Surface:** The default background for forms, panels, and focused editing areas.
- **Brown Ink:** Headings, labels, body text, and high-confidence status copy.
- **Soft Brown Muted:** Supporting copy, metadata, helper text, and secondary navigation.
- **Warm Border:** Quiet one-pixel separation between surfaces, fields, summaries, and list rows.
- **Terracotta Soft Wash:** Low-emphasis notices, selected navigation, and gentle action-adjacent emphasis.
- **Preview Clay:** The dedicated tonal layer behind the portrait preview column.

### Named Rules

**The Warm-Ground Rule.** Let warm paper carry the page and white carry the work; do not rebuild the old green palette or make every surface a card.

## Typography

**Display Font:** Be Vietnam Pro (with Segoe UI, sans-serif fallback)
**Body Font:** Be Vietnam Pro (with Segoe UI, sans-serif fallback)
**Label/Mono Font:** Be Vietnam Pro; use tabular numerals for counts, durations, and stage values.

**Character:** Be Vietnam Pro is open, approachable, and dependable in Vietnamese. Semibold headings create clear wayfinding without turning the studio into a loud dashboard; muted copy is reserved for context, not essential instructions.

### Hierarchy

- **Display** (600, `clamp(28px, 2.3vw, 34px)`, `1.3`): Page titles such as “Bắt đầu một video mới” and “Video của bạn.”
- **Headline** (600, `24px`, `1.35`): Major task headings such as source capture and review sections.
- **Title** (600, `17px`, `1.4`): Panel headings, preview labels, and compact section titles.
- **Body** (400, `16px`, `1.65`): Instructions, source text, notices, and editable narration; keep long prose around 65–72ch where possible.
- **Label** (600, `14px`, `1.5`): Form labels, navigation links, buttons, and step labels.

### Named Rules

**The Clear-Voice Rule.** Use semibold only to establish hierarchy or action; never turn helper text, progress metadata, or every navigation item into a headline.

## Layout

The application is a centered work surface with a maximum content width of 1380px. Desktop pages use generous horizontal breathing room and a 32px top rhythm; the header stays a compact 80px horizontal bar with the product brand, three primary destinations, and a “Công cụ & tài khoản” disclosure for workspace switching and secondary tools.

The creation surface is a two-column workbench: a flexible white editing column and a 350px preview column, separated by a 28px gap. The editing column owns the four real steps—Nguồn bài, Lời đọc, Nền & nhạc, Xuất video—and keeps script, source review, settings, and stateful recovery in one task area. The preview column is a clay-toned portrait stage, 9:16 by default, with export state directly below the preview.

At 1100px the preview narrows to 290px, the editor padding tightens, and the capture URL action stacks below its field. At 800px the workbench becomes a single column, the preview moves first, and the primary navigation becomes a full-width row in the normal header flow so it never covers editable content. At 480px the page uses 16px side padding, form rows collapse to one column, step controls become compact grid items, and the editor keeps 20px internal padding. The preview must remain readable and never be hidden merely to fit a smaller viewport.

## Elevation & Depth

This is a flat-by-default system. Depth comes from tonal layering—warm ground, white work surfaces, and the clay preview field—plus quiet one-pixel borders. Resting panels do not need drop shadows; focus uses a clear terracotta outline, and state changes use color and copy rather than floating effects. A panel may lift only when a native browser affordance requires it, such as the account menu disclosure.

### Named Rules

**The Flat-Rest Rule.** Surfaces are calm at rest; use tonal contrast, borders, and explicit state copy before reaching for shadows or decorative chrome.

## Shapes

The form language is gently curved and practical. Controls use 12px corners, compact chips and summaries stay at 12px, and task panels use 16px corners; the family should stay within the 12–16px range unless a native element requires its own silhouette. Borders are quiet and one pixel. Inputs, buttons, summaries, and step targets provide at least a 44px interaction height, with enough horizontal padding to make Vietnamese labels comfortable.

Avoid nested card scaffolds. Group related controls with headings, whitespace, details disclosures, and dividers instead of stacking multiple rounded containers. Portrait preview media may use a slightly stronger 14px crop radius, but the stage itself remains a 16px surface.

## Components

### Buttons

- **Character:** Tactile, direct, and easy to scan.
- **Shape:** Gently curved controls (12px) with a 44px minimum height.
- **Primary:** Terracotta fill with white text; use for “Mở bài để chụp”, “Tạo bản nháp kịch bản”, “Tạo video MP4”, and the current forward action.
- **Hover / Focus:** Deepen the terracotta on hover; every keyboard focus state gets a 3px terracotta outline with a 3px offset. Do not rely on color alone for disabled state.
- **Secondary / Ghost / Tertiary:** White or transparent with ink/muted text and a quiet border or underline; use for navigation between steps, recovery, and lower-emphasis alternatives.

### Chips

- **Style:** Small status badges use the warm surface family, muted text, and compact padding rather than saturated pills.
- **State:** Status text must say what is true—such as “Chờ duyệt”, “Đã duyệt”, “Đã hủy”—and must not imply third-party publishing success.

### Cards / Containers

- **Corner Style:** Task panels use 16px corners; the primary editing column is a single white work surface.
- **Background:** White for the work, warm paper for the page, and clay for the preview column.
- **Shadow Strategy:** Flat at rest; depth comes from tonal layers and one-pixel borders.
- **Border:** Use the warm border only where it clarifies grouping, lists, summaries, or field edges.
- **Internal Padding:** 24px is the default panel rhythm; the editor uses 30px on wide screens, 24px at medium widths, and 20px on small screens.

### Inputs / Fields

- **Style:** Broad native inputs with white fill, brown ink, 12px corners, and a warm field border; labels sit above the field and helper copy sits below it.
- **Focus:** A visible 3px terracotta outline with a 3px offset; preserve the browser’s clear keyboard affordance.
- **Error / Disabled:** Explain the recovery action in plain Vietnamese. Disabled controls stay legible and visibly unavailable rather than becoming low-contrast ghosts.

### Navigation

- **Style:** The 80px header keeps “Tạo video”, “Video của bạn”, and “Thư viện” at the top level. The active link uses a soft terracotta wash and terracotta-leaning ink, with semibold text.
- **Account menu:** “Công cụ & tài khoản” opens workspace selection, role context, secondary tools, and logout without competing with the creation path.
- **Mobile:** At 800px and below, primary navigation becomes a full-width row below the brand/account row; secondary tools remain in the disclosure. Keeping it in normal flow prevents it from covering source and editing controls while scrolling.

### Studio Stepper

The stepper is the studio’s compact progress map: four real steps in a horizontal grid, separated from the work by a divider. The active step receives a filled terracotta number circle; future steps remain quiet and unavailable until the script exists. Step labels retain their Vietnamese names and remain keyboard-operable.

### Preview Stage

The preview is not decoration: it is the fastest feedback loop for script, voice, captions, source integrity, background, and music choices. Keep the 9:16 stage beside the editor on wide screens, use a calm empty state before import, and place a short status/action bar immediately below it. On mobile, put the stage before the editing controls so the result stays visible while the task is completed.

## Do's and Don'ts

### Do:

- **Do** put the next useful action first and keep it visible in the current step.
- **Do** use Be Vietnam Pro and Vietnamese-first labels for creation, capture, review, progress, and recovery.
- **Do** preserve the warm ground, white work surfaces, terracotta action voice, and clay preview layer.
- **Do** keep controls at least 44px high and maintain visible keyboard focus.
- **Do** show original/anonymized source previews, rights review, provenance, and actionable failure states before rendering.
- **Do** keep the editor and preview synchronized as settings change, while requiring a saved script and human review before MP4 approval.

### Don't:

- **Don't** revive the legacy green palette or add decorative badges, ornamental gradients, or nested card scaffolds.
- **Don't** use shadows as the default way to separate content; use tonal surfaces, whitespace, and borders.
- **Don't** hide source integrity, privacy, rights, or recovery details behind ambiguous status language.
- **Don't** claim automatic social publishing; unapproved providers and permissions remain blocked and publishing requires an explicit handoff.
- **Don't** make mobile users lose the preview, the current step, or the recovery action just to save vertical space.
