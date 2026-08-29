# GradPack Trust Summary Design

## Goal

Give classmate-pilot users a short, reassuring explanation of how GradPack
handles their Canvas access and downloaded archives, together with a clear
personal-use expectation. The message must be visible before retrieval and in
the installation guide without sounding legalistic or alarming.

## Approved Copy

### Heading

**Your courses stay with you**

### Trust statement

GradPack works only with Frankfurt School Canvas and uses the session already
open in your browser. Everything is processed locally—there is no telemetry,
backend, or cloud upload. Your archives are saved only to your computer.

### Responsible-use statement

**For personal study:** Please keep downloaded course materials for your own
use and do not redistribute them.

## Product Placement

### Side Panel

Add a dedicated trust card to the course-selection and archive-configuration
views, before the user begins discovery or confirms retrieval. The card uses
the approved heading and both approved statements.

The card replaces the existing generic notice that says GradPack processes
everything locally. Existing operational notices about archive limits and
keeping the Canvas tab open remain unchanged. The trust card is informational:
it has no checkbox, dismissal control, link, or consent state.

The card should follow the existing white-card visual language while remaining
visually distinct through a short heading and restrained supporting text. The
responsible-use sentence should be readable as guidance, not styled as an
error or warning.

### Installation Guide

Add a `Privacy and responsible use` section near the beginning of
`docs/pilot/INSTALL.md`, before checksum verification. Use the same approved
trust and responsible-use wording so the setup instructions and product UI do
not diverge.

Remove or consolidate nearby duplicate local-processing language where needed,
while preserving factual installation, archive-limit, and removal guidance.

## Scope and Boundaries

This change is copy and presentation only. It does not change:

- Chrome permissions or host access;
- Canvas authentication or session handling;
- discovery, retrieval, sanitization, packaging, or download behavior;
- archive contents or manifests;
- telemetry, persistence, backend, or cloud behavior; or
- any legal terms, license, or formal consent mechanism.

The notice describes the current classmate pilot. It must not imply support for
Canvas institutions other than Frankfurt School or guarantee that third-party
external links and resources are stored locally.

## Accessibility and Responsive Behavior

The trust card uses semantic heading and paragraph elements. It must remain
legible at the Side Panel's current minimum width, inherit the existing focus
and color system, and avoid icon-only meaning. No interaction or new focus
target is introduced.

## Verification

Automated checks should establish that:

- the Side Panel renders the approved heading and both statements in the
  selection and configuration views;
- the old generic local-processing notice is not duplicated alongside the new
  card;
- the installation guide contains the matching section and approved meaning;
- the extension manifest and permission set remain unchanged; and
- formatting, linting, type checking, all tests, and the production build pass.

Manual review should confirm that the card is easy to scan in the unpacked
extension at the Side Panel's narrow width and does not compete with primary
course-selection or retrieval actions.
