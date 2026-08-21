# GRAD-21 Canvas-Familiar Offline Archive Design

- **Linear:** GRAD-21 — Build a Canvas-familiar offline archive experience
- **Status:** Approved for implementation planning
- **Date:** 2026-08-21
- **Applies to:** Individual-course archives and combined multi-course archives

## 1. Objective

Downloaded GradPack archives should use a familiar Canvas-like information
hierarchy without presenting themselves as Canvas or depending on Canvas at
runtime. The redesign covers only extracted offline archives. It does not alter
the GradPack extension Side Panel, Canvas retrieval permissions, or the set of
content GradPack captures.

The result must remain GradPack-branded, deterministic, static, fully usable
through `file://`, and subject to the existing archive, sanitizer, path,
privacy, and manifest safety contracts.

## 2. Product decisions

The approved design uses:

- a GradPack identity with Canvas-familiar layout, spacing, typography,
  navigation hierarchy, breadcrumbs, module rows, and resource presentation;
- the same visual system for individual-course and combined multi-course
  archives;
- a static multi-page architecture with no archive JavaScript;
- only destinations that work offline;
- visible, non-clickable outcomes for unavailable or unsupported resources;
- normal local links for saved pages and files; and
- clearly labeled external references under the existing external-link policy.

The archive must not copy or package Canvas or institutional logos, CSS,
JavaScript, fonts, live controls, or other proprietary assets. It must not imply
that it is an official Canvas page.

## 3. Information architecture

### 3.1 Shared shell

Every generated HTML page uses one trusted archive shell with these landmarks:

1. a skip link to the main content;
2. a compact GradPack global rail;
3. an optional course navigation region;
4. breadcrumbs;
5. one page-specific main region; and
6. a small offline-archive identity notice.

The global rail contains only working archive destinations:

- **Archive** — the current archive home;
- **Courses** — the combined course list, or the current course home in an
  individual archive; and
- **Status** — the relevant combined or course archive status page.

The course navigation contains:

- Home;
- Modules;
- Pages;
- Files; and
- Archive Status.

The current destination is marked semantically with `aria-current="page"` and
visually with the GradPack accent color. Breadcrumbs provide valid parent links
and plain text for the current page.

### 3.2 Individual-course archive

An individual course archive contains these generated pages:

```text
index.html                 Course home
modules.html               Module-ordered content
pages.html                 Saved and unavailable page outcomes
files.html                 Saved and unavailable file outcomes
status.html                Human-readable archive outcome summary
manifest.json              Authoritative machine-readable record
assets/archive.css         Trusted shared stylesheet
pages/<safe-name>.html     Sanitized saved Canvas pages in the shared shell
files/<safe-path>          Saved file bytes
```

Top-level names avoid collisions with the existing `pages/` and `files/`
resource namespaces. Resource paths remain canonical and are not renamed merely
for presentation.

Classic ZIP permits at most 65,535 entries. The course archive reserves seven
entries for its five generated HTML pages, stylesheet, and manifest, so GRAD-21
changes the maximum captured-resource count from 65,532 to **65,528**. The
builder must reject larger plans before retrieval or packaging; it must not
silently omit resources or emit an over-limit archive.

The course home introduces the local archive and provides direct routes to the
four content/status destinations. It does not duplicate the entire manifest.

### 3.3 Combined multi-course archive

The combined root contains:

```text
index.html                              Course list and combined summary
status.html                             Combined outcome summary
manifest.json                           Authoritative combined manifest
assets/archive.css                      Trusted shared stylesheet
courses/<safe-course-root>/...          Complete course archive pages/resources
```

The combined home presents one course card per completed course in deterministic
course order. Each card shows only the course display name, course code, coarse
module/item counts, and a local link to that course home. Course pages include a
working breadcrumb and global-rail route back to the combined course list.

Per-course pages inside a combined archive use the same shell and content
renderers as standalone course archives. A path resolver computes local links
from the current output path rather than concatenating hand-written `../`
segments.

## 4. Page behavior

### 4.1 Modules

The Modules page preserves the normalized plan's authored module order, module
item order, and indentation. Each item renders one explicit outcome:

- **Saved page** — working local page link;
- **Saved file** — working local file link;
- **External link** — labeled external link under the existing safe-link rules;
- **Unavailable** — visible status text without an `href`;
- **Unsupported** — visible status text without an `href`; or
- **Failed** — visible status text without an `href`.

The renderer never invents resources, silently omits a manifest outcome, or
turns an unavailable resource into a broken link.

### 4.2 Pages

The Pages page lists page outcomes in deterministic title/path order and adds
their module references when available. Saved pages are local links. Other
outcomes are non-interactive rows with a plain-language status. No Canvas URL,
ID, response body, or retrieval diagnostic is exposed in the rendered page.

### 4.3 Files

The Files page lists file outcomes in deterministic safe-path order. Saved files
have local links, safe display names, advertised or archived byte size when the
manifest already contains it, and module references when available. Other
outcomes use non-interactive status rows. Existing canonical path and collision
rules remain authoritative.

### 4.4 Archive Status

Archive Status translates manifest totals into readable summary cards and an
outcome list. `manifest.json` remains the authoritative record and is linked as
a local technical detail. The page retains the course-material responsibility
notice and identifies the archive as a local GradPack copy.

The combined status page aggregates the combined manifest totals and links to
each course's status page. It does not flatten, replace, or mutate nested course
manifests.

### 4.5 Saved HTML pages

Saved Canvas page content remains sanitized before presentation. The sanitizer
is refactored to produce a trusted sanitized content fragment; a dedicated saved
page renderer places that fragment inside the shared shell. This keeps shell
generation separate from untrusted content sanitization.

Saved page breadcrumbs identify the course and page title. Course navigation
remains available, and all shell links resolve correctly from the nested
`pages/` path. Sanitized content cannot inject shell classes, IDs, navigation,
styles, scripts, forms, event handlers, or remote assets.

## 5. Visual system and responsiveness

The stylesheet uses local system fonts and GradPack-owned design tokens for:

- the dark global rail;
- the neutral course navigation;
- the GradPack accent color;
- borders and module headers;
- success, unavailable, unsupported, failed, and external status treatments;
- spacing, focus rings, and readable line lengths; and
- narrow-screen layout behavior.

The desktop layout uses global rail, course navigation, and content columns.
Because the archive contains no JavaScript, narrow screens restack the rail and
course navigation into compact horizontal or wrapped regions using CSS only.
Content order remains logical when styles are unavailable.

The design targets WCAG 2.2 AA contrast for text and controls, visible keyboard
focus, semantic landmarks, one `h1` per page, descriptive link text, and
non-color status labels. Reduced-motion preferences require no special runtime
behavior because the archive introduces no animation.

## 6. Architecture and data flow

### 6.1 Trusted view model

A new immutable `ArchiveNavigationModel` is derived only from the already
normalized `CoursePlan` and `ArchiveManifest`. It contains the display data and
resolved outcomes required by the renderers. Raw Canvas responses never cross
into archive rendering.

The model builder must reject contradictions, including:

- a resource link whose path is not canonical;
- a module resource with no corresponding manifest outcome;
- a successful resource without a valid local archive path;
- totals that do not agree with normalized manifest resources; or
- unsafe combined-course roots.

### 6.2 Renderers

Small renderers own one responsibility each:

- shared document shell and navigation;
- course home;
- modules;
- pages index;
- files index;
- course status;
- combined home;
- combined status; and
- saved page document.

Renderers accept validated view models and a local path resolver. They return
HTML strings but do not read Canvas, mutate plans/manifests, create ZIPs, or call
Chrome APIs.

### 6.3 Packaging pipeline

The pipeline is:

```text
normalized course plan + retrieved outcomes
  -> normalized manifest
  -> immutable archive navigation model
  -> deterministic generated HTML page map
  -> strict generated-page and stylesheet validation
  -> canonical ZIP entry map
  -> deterministic ZIP bytes
```

The combined builder validates nested course archives as it does today, adds the
new trusted combined pages, and preserves deterministic entry sorting and fixed
ZIP metadata.

## 7. Safety validation

The existing exact archive validation is extended, not bypassed.

- Each generated page kind has an exact allowed structure, element set,
  attribute set, class set, ID set, and link policy.
- Generated top-level page paths are fixed and reserved.
- Local links must decode to canonical paths inside the current archive root and
  must equal their canonical percent-encoded representation.
- External links retain the existing HTTPS-only, credential-free, query-free,
  fragment-free policy and `rel="noopener noreferrer"`.
- No generated or sanitized page may contain scripts, inline styles, remote
  stylesheets, forms, embedded frames, event handlers, or comments.
- The trusted stylesheet must exactly equal the compiled `ARCHIVE_CSS` constant.
- Course names, titles, codes, filenames, and status text are escaped at the
  final HTML boundary.

If any generated page, sanitized page, stylesheet, path, or link fails
validation, archive creation stops. The builder does not emit a partially
trusted ZIP or loosen the policy to recover.

## 8. Error handling

Resource-level retrieval outcomes continue to be represented by the manifest
and rendered as saved, unavailable, unsupported, external, or failed. A
resource-level failure does not break navigation for successfully archived
content.

Structural failures are terminal for the affected archive:

- invalid view-model relationships;
- unsafe or colliding generated paths;
- invalid generated HTML;
- unsafe relative links;
- nested combined-archive validation failure; or
- ZIP entry/resource limit failure.

Multi-course orchestration preserves already completed course outputs under its
existing partial-success rules. Failed transient bytes continue to be released
under the existing cancellation and cleanup contract.

## 9. Verification strategy

### 9.1 Unit and contract tests

Tests cover:

- every page renderer and active navigation state;
- exact semantic landmarks, breadcrumbs, headings, and `aria-current` use;
- module order, item order, indentation, and terminal outcomes;
- pages/files sorting, sizes, module references, and unavailable rows;
- single-course and combined path resolution at every nesting depth;
- escaping of malicious course, module, page, file, and status text;
- path traversal, percent-encoding, unsafe external links, and link-policy
  rejection;
- rejection of scripts, inline styles, event handlers, remote assets, forms,
  frames, comments, and unapproved classes/IDs;
- exact stylesheet identity and absence of network dependencies;
- manifest-total consistency and unchanged machine-readable manifests;
- deterministic HTML, ZIP entry order, metadata, and package bytes; and
- backward-safe sanitizer behavior for archived page content.

### 9.2 Integration and end-to-end tests

Synthetic course fixtures exercise:

- an individual archive with pages, files, external references, and unavailable
  resources;
- a combined archive with at least two courses and colliding resource display
  names;
- every navigation link after extraction;
- saved page links back to Modules, Pages, Files, Status, and course/combined
  homes;
- opening extracted pages directly through `file://` with network disabled;
- keyboard traversal, visible focus, semantic landmarks, responsive stacking,
  and readable status labels; and
- unchanged extension permissions and no archive JavaScript.

The production verification suite must continue to pass, including formatting,
linting, type checking, unit/integration tests, production build, deterministic
pilot packaging, checksum verification, ZIP integrity, and exact production
extension inventory.

## 10. Scope boundaries

This issue does not add or redesign:

- the GradPack extension Side Panel;
- Canvas authentication or permission behavior;
- course discovery or retrieval scope;
- assignments, grades, announcements, discussions, people, inbox, calendar, or
  other uncaptured Canvas features;
- search, JavaScript routing, service workers, or a local web server;
- Canvas or institutional branding assets; or
- changes to the manifest schema unless implementation proves an existing field
  is insufficient and a separate approved design amendment is created.

## 11. Acceptance criteria

The design is complete when:

1. individual and combined archives use the approved Canvas-familiar GradPack
   shell;
2. all visible destinations work after extraction through `file://`;
3. saved HTML pages use the same shell and safe relative navigation;
4. module order and every manifest outcome remain visible and accurate;
5. no Canvas/institutional assets, archive JavaScript, or network dependency is
   introduced;
6. strict archive, sanitizer, path, privacy, deterministic ZIP, cancellation,
   and size/resource-limit contracts remain enforced, including the approved
   65,528 captured-resource maximum; and
7. the complete automated and extracted-offline verification strategy passes.
