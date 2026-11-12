# Deployment 302b548

Date: 2026-11-03 (Asia/Shanghai).

- Commit 302b5486a56250e196b757234737609b165916ec pushed to origin/main.
- GitHub CI succeeded: https://github.com/summerliang74/sider/actions/runs/41581524097
- Strict local production build succeeded.
- Existing Launchpad project 1793096891306 now serves sider-302b548 at https://siderlearn.com.
- Public production smoke verification: all 15 checks passed after recovery.
- Live browser verification: widths 320, 390, 768, 1440 have no horizontal overflow; deployed navigation-progress CSS present; no uncaught page exceptions.

The legacy publish operation cleared the application's runtime environment. The application initially served its bootstrapping placeholder. Runtime environment was restored from available local credentials with current production public variables, followed by a relaunch. The rate-limit endpoint was restored using the valid local Redis endpoint and matching token (quality-colt-158699.upstash.io), differing from the pre-publish endpoint (new-cricket-245108.upstash.io). Both were probed with the available local token: the former returned PONG, the latter rejected that token. Existing production secret references were not changed.

The optional authenticated readiness request returned 401. This does not establish any dependency outage; it means PostgreSQL, Redis and storage readiness could not be verified through that endpoint. Authenticated resource navigation was not tested because the browser has no user login session. No database migrations were introduced.

Only the five performance-related source files were committed. Pre-existing documentation and package-lock changes were left outside the commit.
