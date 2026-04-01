# Remaining Warning Noise Notes

These notes are intentionally small and review-oriented.

- No additional real-world repos are checked into this workspace, so the local regression matrix currently validates fixture repos plus the `repo-preflight` repo itself.
- Local observation from `repo-preflight` on April 1, 2026: verdict stayed `Ready`, with two `INFO` results for missing `dev` and env-variable usage without env files. Those are not warnings today, but they are still the best candidates for future noise if heuristics drift.
- The remaining warning shape to keep watching in real repos is env-file warning sensitivity: repos that use hosted secret managers or shell-only env injection can still look "env-heavy" without wanting `.env` files.
- The other area to keep watching is app-like workspace roots that orchestrate child packages but do not expose a meaningful root `dev` flow; those can still warn if the root looks app-like.
