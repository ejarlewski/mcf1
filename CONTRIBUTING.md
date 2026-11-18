# Contributing

Thanks for being interested in this project! It is a deliberately small,
zero-dependency app, so this page is mostly about what fits and what does not.

## What this project is

A single-user Kanban board that runs entirely in the browser: three-ish static
files, no build step, no npm, no frameworks, no CDNs, no web fonts, no server.
Your board lives in `localStorage`. See [README.md](README.md) and
[the implementation spec](<Personal Kanban Board – Implementation Specification.md>)
for the full picture.

Those constraints are the *point* of the project, so please keep them:

- No dependencies, package managers, bundlers or build steps.
- No CDN links, remote fonts or analytics — it has to keep working from
  `file://` and fully offline.
- No server, account, sync or multi-user features (see the spec's non-goals:
  authentication, servers/databases/cloud storage, real-time sync/notifications,
  frameworks/build steps, comments/attachments/time tracking/reporting).

A PR that adds a dependency or a backend is unlikely to be merged, however
nice the code is. If you want to take it in a bigger direction, fork it and
make it yours — the MIT license says so.

## Ground rules

- This project is under the [MIT license](LICENSE). Anything you contribute is
  offered under the same license, and you should only submit code you have the
  right to give away.
- One focused change per pull request. A bug fix on its own merges faster than
  a bug fix plus a reformat plus a rename.
- Be decent to people. This is a hobby project maintained in spare time;
  slow responses are not rejection.

## Getting it running

- **Simplest:** double-click `index.html`. It works straight from `file://`.
- **Or serve the folder:** `python -m http.server 8791`, then
  `http://localhost:8791`.

There is no install step and nothing to compile. Note that `localStorage` is
scoped per origin, so `file://` and `http://localhost` hold **different**
boards; use Export/Import to move one to the other. That is a gotcha when
testing, not a bug.

## How to make a change

1. Fork this repository and create a branch off `main`.
2. Make your change. The files have clear jobs (`storage.js` owns persistence
   and validation, `state.js` owns state and autosave, `render.js` owns the DOM,
   `dnd.js` owns drag and drop, `app.js` owns boot and wiring) — try to make
   your change land in the file it belongs to, and keep the existing
   zero-dependency structure.
3. Test it in a browser (see below).
4. Open a pull request. **Direct pushes to `main` are not possible** — a branch
   ruleset requires every change to arrive through a pull request. Approvals
   are not required, so your PR can be merged as soon as it looks right.

Bug fixes, typo fixes, accessibility improvements and clearer error messages
are always welcome. For anything that changes behaviour or adds a feature,
please open an issue first so we can agree it belongs in the project.

## Testing your change

There is no automated test suite — the manual checklist *is* the test suite.

- Walk the relevant sections of
  [MANUAL-TEST-CHECKLIST.md](MANUAL-TEST-CHECKLIST.md) and say which ones you
  ran in your PR description.
- Check both origins if your change touches persistence: `file://` and
  `http://localhost`.
- Check light theme **and** dark theme, and check with
  `prefers-reduced-motion: reduce` enabled if you touched animation.
- Check the console is free of errors, and that the Network tab still shows
  requests for nothing but the local files.
- Storage sanity: reload the page and confirm the board survives; try the
  "Changes won't be saved." path in a private window if your change touches
  storage at all.

## Reporting a problem

Please include:

- Browser and OS (and whether you use `file://` or a served URL).
- Exact steps, what you expected, what happened instead.
- Any message in the browser console, verbatim.
- Whether the "Changes won't be saved." banner appeared.
- If data behaved oddly, an exported JSON backup (`Export` button) — glance
  through it first and remove anything you would rather not share.

Please search the open issues before filing; duplicates are fine but a
"me too" comment is more useful than a second issue.

## For maintainers: branch protection lives in a file

`main` is protected by a GitHub *ruleset* defined in
[.github/rulesets/protect-main.json](.github/rulesets/protect-main.json). That
file is only an input — GitHub does not read it automatically. Apply it with:

```sh
bash scripts/apply-github-ruleset.sh      # needs gh, authenticated with the repo scope
```

Re-run that script whenever you edit the JSON. As written it enforces three
things on the default branch: nobody deletes it, nobody force-pushes it, and
every change must arrive through a pull request — with zero approvals required,
so a solo maintainer can still merge their own work.

Two things worth knowing before you change it:

- On the free plan rulesets only exist for **public** repositories, so a private
  fork of this repo cannot apply them until it is public.
- Do not add `{ "type": "update" }` back. That rule counts merging a pull
  request as an update of the protected ref, which leaves the maintainer unable
  to merge their own pull request while their bypass is set to `pull_request`
  (observed as "the base branch policy prohibits the merge"). The
  `pull_request` rule already refuses direct pushes on its own.

Also in this repo: [pull request template](.github/PULL_REQUEST_TEMPLATE.md) and
[issue templates](.github/ISSUE_TEMPLATE). If a label named in a template does
not exist in your repository, GitHub quietly skips it; create missing ones with
e.g. `gh label create bug --repo <owner>/<repo> --color d4c5f9`.
