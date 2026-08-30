# I Was Tired of Downloading My MBA Coursework Manually—So I Built GradPack With Codex

_How one repetitive student problem became an open-source Chrome extension, installation videos for non-technical users, and a bigger lesson about building with AI._

As I moved closer to the end of my MBA at Frankfurt School, I started thinking about what would happen to all the knowledge I had accumulated in Canvas.

There were lecture slides, readings, files, course pages, and links spread across different modules and courses. I could access them now, but that did not mean I would always have access to them.

The obvious solution was to download everything I wanted to keep.

The problem was the word _everything_.

Doing it manually meant opening every course, moving through its modules, finding the useful pages and files, downloading them one by one, and then recreating some kind of sensible folder structure on my laptop. It was possible, but it was exactly the sort of repetitive task that is easy to postpone until it is too late.

I did not begin with an ambition to build a software product. I began with a much simpler thought:

> There must be a better way to do this in one go.

That thought became [GradPack](https://github.com/Eslamunto/GradPack), a Chrome extension designed to turn the Canvas course materials a student can already access into useful local archives.

More importantly, the process changed how I think about building with AI.

## Starting with the problem, not the technology

I did not approach Codex with a detailed technical specification. I approached it with the frustration I understood firsthand.

I wanted to select my courses, preserve the available material locally, and retain enough structure to make the archive useful later. I did not want to click through every item manually. I also did not want the solution to upload my coursework somewhere else or require me to provide my password, cookies, or other credentials.

Those boundaries mattered as much as the feature itself.

The first useful step was therefore not asking Codex to “build a Chrome extension.” It was explaining the situation:

- Canvas already knew which courses and materials I was allowed to access.
- I was already signed in through Chrome.
- The resulting files should stay on my computer.
- The archive should be understandable without needing Canvas later.
- The tool should not bypass permissions or attempt to retrieve anything unavailable to me.

Once the problem was framed that way, Codex could help turn a vague frustration into smaller questions we could actually solve.

How should the extension discover courses? What should happen when a resource cannot be downloaded? Should several courses become one large archive or separate files? How should the student review what will happen before the download starts? What would make the result useful offline rather than merely a pile of files?

This was the real beginning of GradPack.

## It was not one magical prompt

Stories about building with AI sometimes compress the entire process into a sentence: “I typed a prompt, and the app appeared.”

That was not my experience—and I think the real process is more interesting.

GradPack developed through many rounds of discussion, implementation, testing, and correction. I supplied the problem, priorities, and decisions. Codex helped me inspect how Canvas behaved, propose options, write the code, run tests, identify gaps, and document what we had learned.

We began narrowly. The early pilot focused on saving one accessible course at a time. That gave us a smaller real-world workflow to understand before expanding it.

Then the questions became more demanding.

Canvas is not simply a folder full of downloadable files. A course may organize material through modules, pages, files, and external links. Some sections may be disabled. Some resources may be unavailable. A signed-in session can expire, a browser tab can move, and a large course may not fit comfortably into one archive.

Each discovery forced us to make a product decision rather than merely add more code.

GradPack eventually grew to let a student select one or more displayed courses, including completed ones, and choose a combined archive or one archive per course. Before retrieving the material, it checks the selected courses and presents a review. Courses that are ready can continue; those that cannot be handled safely are clearly marked instead of silently disappearing.

The downloaded archive includes an offline interface for navigating the preserved material and an archive status that records what succeeded, what remained an external link, and what could not be retrieved. If some courses do not finish, the student can retry those courses without repeating the successful work.

These details may sound less exciting than generating an app in one prompt. But they are the difference between a demo and something another person might trust with a real task.

## Why local-first and open source mattered

Coursework can contain personal, licensed, or institution-specific material. That made the architecture a question of trust.

GradPack uses the Canvas session already open in the student’s browser and works only with material that session can access. The current pilot has no analytics, telemetry, backend, or cloud upload. The archive is generated locally and downloaded to the student’s computer.

This does not give students new access or bypass Canvas controls. It helps them preserve material they can already view, for their own personal study. The responsibility not to redistribute course content remains important.

I also chose to make GradPack an open-source project under the Apache 2.0 license. That means the software does not have to be a black box. Others can inspect how it works, question its decisions, report problems, and eventually contribute improvements.

For a tool built around preserving personal access to educational material, transparency should be part of the product—not an afterthought.

## Working software was not enough

Once the extension worked, I encountered another problem: installing an unpublished Chrome extension is not obvious to a non-technical user.

The current GradPack pilot is installed manually. A classmate has to extract the correct ZIP file, open Chrome’s extensions page, enable Developer mode, choose **Load unpacked**, select the extracted folder rather than the ZIP, sign in to Canvas, and keep the Canvas tab open while GradPack works.

None of those steps is especially difficult once you have seen them. But asking a classmate to follow unfamiliar browser instructions from a technical document creates unnecessary friction.

So Codex helped me work on the onboarding as well as the software.

We created a short quick-start video and a slower, detailed installation guide with captions. The walkthroughs use recreated, privacy-safe screens rather than recordings of my real Canvas account. They contain no real course names, student identity, or Canvas URLs. Written installation and troubleshooting guidance accompany the videos for anyone who prefers to read.

This part of the project taught me an important lesson: a solution is not finished when it works for the person who built it. It becomes useful when the intended user can understand it, install it, and recover when something goes wrong.

For technical builders, documentation and onboarding are often treated as the final layer. For non-technical users, they are part of the product itself.

## Where GradPack stands today

GradPack is currently an alpha classmate pilot for Frankfurt School students using Canvas. It is distributed as an unpacked Chrome extension and is not yet available through the Chrome Web Store.

That distinction matters. Automated tests and a carefully prepared installation bundle provide useful evidence, but they are not the same as broad real-world acceptance. The next learning will come from classmates trying the extension in their own signed-in Canvas environments and reporting privacy-safe feedback.

The future plan is to make installation much easier by publishing GradPack through the Chrome Web Store. I also want to keep improving the offline archive experience and learn where the current workflow confuses or fails real students.

Frankfurt School is the starting point because it is the environment and student need I know. Canvas, however, is used by many educational institutions. If the pilot proves useful and the differences between institutions can be handled safely, GradPack could eventually support other students using the same platform.

That is a direction, not a promise. Expanding responsibly will require testing against real institutional configurations, respecting access boundaries, and avoiding the assumption that every Canvas environment behaves identically.

## The bigger lesson: frame one problem well

GradPack began with a task I was avoiding.

I did not need to know every component of a Chrome extension before starting. I needed to understand my own problem well enough to describe the desired outcome and recognize the decisions that mattered.

Codex reduced the distance between that understanding and working software. It could investigate, propose, implement, test, and explain at a speed I could not have achieved alone. But the collaboration still depended on context, judgment, and real-world verification from me.

If you are curious about building with Codex but do not consider yourself technical, I would not begin by searching for an app idea. I would begin by noticing repetition.

Ask yourself:

1. **What repeatedly frustrates me?** Look for a task you delay because it is tedious, fragmented, or easy to get wrong.
2. **What outcome do I actually want?** Describe the finished result rather than guessing which technology should create it.
3. **What must the solution protect or avoid?** Think about privacy, permissions, cost, reliability, and the people affected.
4. **What is the smallest version that would already help?** A narrow real solution teaches more than an ambitious imaginary platform.
5. **How will I test it in reality?** A local demonstration is a beginning. The real environment and intended users provide the evidence that matters.

Then bring that framed problem to Codex and work through it as a conversation.

You may not end up building a Chrome extension. You may create a small script, a better workflow, a personal tool, or simply a clearer understanding of what is possible.

But you will be starting in the right place: not with AI looking for a purpose, but with a real problem worth solving.
