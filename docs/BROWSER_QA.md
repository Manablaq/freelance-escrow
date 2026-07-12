# Completed local browser QA

## Status and scope

A local browser-only QA pass was completed on **2026-07-12** with **Playwright 1.55.0** and **Chromium 140.0.7339.16**. This was a completed local inspection, not a committed or continuously running Playwright suite. The local scripts, JSON report, and screenshots remained under the ignored `.qa/` directory and are not repository evidence.

No funded-wallet blockchain transaction was performed during this pass. The funded GenLayer Bradbury wallet scenarios in [BRADBURY_MANUAL_QA.md](BRADBURY_MANUAL_QA.md) remain **UNVERIFIED**.

## Route and viewport matrix

The following eight routes were rendered:

- `/`
- `/marketplace`
- `/dashboard`
- `/register`
- `/post-job`
- `/freelancer/[valid accepted-state address]`
- `/job/1`
- `/job/2`

Each route was checked at five viewports—`320x700`, `390x844`, `768x1024`, `1024x768`, and `1440x900`—for **40 route/viewport combinations**.

## Recorded results

- Zero detected horizontal overflow.
- Zero browser console warnings or errors.
- Zero uncaught page exceptions.
- Zero failed network requests.
- Maximum observed `/api/contract` concurrency: one.
- Observed contract API responses used `no-store` caching controls.
- Visible keyboard-focus behavior was checked.
- The mobile menu was opened and closed with Escape.
- Transaction tracker states were inspected.
- Modal initial focus, focus trapping, Escape close, and focus restoration were checked.
- Reduced-motion behavior was inspected.
- The wallet connection modal was inspected at `320x700`.

## Evidence boundary

Local screenshots and reports were intentionally not committed. They should not be cited as durable repository artifacts. This document records the completed pass and its reported results; future continuously reproducible browser coverage would require a reviewed, committed test suite and CI job.
