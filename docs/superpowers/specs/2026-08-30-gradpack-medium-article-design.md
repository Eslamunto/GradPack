# GradPack Medium article design

## Working title

**I Was Tired of Downloading My MBA Coursework Manually—So I Built GradPack With Codex**

Subtitle: **How one repetitive student problem became an open-source Chrome
extension, an installation video for non-technical users, and a bigger lesson
about building with AI.**

## Purpose and audience

The article is a personal builder story for non-technical professionals and
students. It should make software creation with Codex feel approachable without
portraying it as automatic or effortless. GradPack is the concrete story, while
the closing lesson encourages readers to identify and frame a repetitive
problem of their own.

## Central narrative

Near the end of an MBA, valuable course material is distributed across Canvas.
Saving it manually means working course by course, page by page, and file by
file. The author described the desired outcome and constraints to Codex, then
worked iteratively with it to turn that frustration into GradPack: an
open-source Chrome extension that creates local, offline archives from course
materials available to the student's signed-in Canvas session.

The article must not frame the result as the output of one magical prompt. The
author contributed the problem, priorities, product decisions, and real-world
feedback. Codex helped investigate Canvas behavior, structure the work,
implement and test the extension, prepare documentation, and generate
privacy-safe installation videos.

## Article structure

1. **The moment of frustration** — Approaching the end of the MBA and realizing
   that manually preserving the material would be repetitive and impractical.
2. **Turning frustration into a precise problem** — Defining the outcome:
   select accessible courses, retrieve available material, and create useful
   local archives.
3. **Building with Codex** — Breaking the problem into smaller parts, exploring
   Canvas behavior, making product decisions, implementing the extension,
   testing edge cases, and iterating.
4. **From personal need to open source** — Explaining the decision to make
   GradPack transparent and local-first, with no backend, cloud upload,
   analytics, or telemetry.
5. **Designing for non-technical classmates** — Creating short and detailed
   installation videos, captions, written guidance, and privacy-safe mock
   screens for installing the unpacked alpha.
6. **Where the project stands** — Describing GradPack honestly as an alpha
   classmate pilot for Frankfurt School's Canvas environment. It is not yet
   published in the Chrome Web Store.
7. **Future plans** — Improve the installation experience, publish through the
   Chrome Web Store, learn from Frankfurt School students, and later explore
   support for other institutions using Canvas.
8. **Try this with your own problem** — Invite readers to notice repetition,
   describe the outcome, define boundaries, build the smallest useful version,
   test it in reality, and iterate.

## Voice and style

- First person, conversational, reflective, and candid.
- Accessible to readers who do not write software.
- Explain necessary technical terms in plain language.
- Use concrete moments from the GradPack journey instead of generic claims
  about artificial intelligence.
- Treat Codex as a collaborator and accelerator, not an autonomous inventor.
- Keep the article suitable for a Medium reading time of approximately six to
  eight minutes.

## Accuracy and trust boundaries

- Describe only materials the signed-in student can already access.
- Do not imply that GradPack bypasses Canvas permissions or institutional
  controls.
- State that archives remain local and that the current pilot has no telemetry,
  backend, or cloud upload.
- Remind readers that downloaded material is for personal study and should not
  be redistributed.
- Distinguish automated development and packaging evidence from live acceptance
  by a broader student population.
- Describe Chrome Web Store publication and broader Canvas compatibility as
  future plans, not completed capabilities.

## Closing call to action

The primary call to action is not to install GradPack. It is to identify a
repetitive personal or professional task and frame it for Codex:

1. What repeatedly frustrates me?
2. What outcome do I actually want?
3. What must the solution protect or avoid?
4. What is the smallest version that would already help?
5. How will I test it in the real environment?

The final note may invite readers to follow or explore the open-source GradPack
project as a secondary call to action once the correct public repository link
has been confirmed.
