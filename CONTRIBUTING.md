# Contributing to GradPack

Thank you for helping students preserve the materials they are allowed to
access. GradPack is an early open-source project, so small, focused changes with
clear tests are especially valuable.

## Before opening a pull request

1. Discuss substantial behavior or scope changes in an issue first.
2. Use Node.js 22.22.2 and pnpm 11.17.0.
3. Keep fixtures invented and privacy-safe. Never copy Canvas, course, student,
   browser-profile, cookie, header, or credential data into the repository.
4. Add or update tests before changing behavior.
5. Run the standard gate:

   ```bash
   pnpm install --frozen-lockfile
   pnpm verify
   ```

6. Do not commit `dist/`, `dist-dev/`, `artifacts/`, course archives, coverage,
   logs, screenshots, environment files, or local tooling state.

Pull requests should explain the user-visible outcome, the tests run, privacy
impact, and any known limitation. Keep commits focused and use your own author
identity. Maintainer and reviewer commits should be cryptographically signed
with their own verified identity where applicable.

By contributing, you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE).

Security reports do not belong in a normal issue. Follow [SECURITY.md](SECURITY.md).
