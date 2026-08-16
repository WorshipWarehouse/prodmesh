# Contributing to prodmesh

Contributions are welcome — including forks that have already run somewhere
real. If you have been running a modified prodmesh in your building and fixed
something, that fix is worth more than most things written from a desk. Please
send it back.

Read [`CLAUDE.md`](CLAUDE.md) first. It holds the conventions and the
constraints, and every rule in it exists because breaking it caused a real
problem. This file covers only what is different when the change is coming from
outside.

## How work lands

The maintainer does not open pull requests against this repository. Work is
branched, verified against a running server, and merged locally. That is
deliberate: a PR exists so somebody can review code they did not write, and for
a solo maintainer it is ceremony with no reviewer on the other end.

**For everyone else, a pull request is exactly right**, and for the same reason
— it is the only way to review a change nobody here controls. So the asymmetry
is not a double standard. It is the same principle applied to two situations.

Open the PR against `main`. Branch names follow the house style:
`feat/<name>`, `fix/<name>`, `chore/<name>`, `docs/<name>`.

## Before you open it

```bash
npm test     # server (node --test) + UI (vitest)
npm run lint
```

Both green, please. If a change of yours makes an existing test wrong, update
the test in the same PR and say in the description why the old expectation no
longer holds — a red suite on a contributor's branch is the single most common
reason work sits unmerged.

**One topic per pull request.** A 40-commit branch containing a new integration,
a layout redesign and a bug fix cannot be accepted or rejected as a unit,
because the answers are usually different. Three PRs get three answers, and
usually two fast merges.

## Rules that bite outside contributors hardest

These are in `CLAUDE.md` too, but they are the ones people trip on first.

**Everything under `server/` is published.** The Dockerfile copies the whole
directory into the runtime image, so seed fixtures and test files ship inside
it — `docker run … cat server/topologySeed.js` prints them to anyone. Never put
a real device IP, OS username, hostname, Planning Center id, or a real person's
name in `server/`. Demo and test data uses TEST-NET-1 (`192.0.2.x`),
role-shaped usernames, and fictional ids.

**Never commit `server/data/`.** It holds live tokens, PINs and the database.
It is git-ignored; keep it that way.

**No runtime CDN or internet dependencies.** A booth machine may have no route
to the internet. Vendor new assets rather than hotlinking them.

**Triage security findings against the LAN-appliance threat model.** The bar is
*"this got bridged onto guest wifi and a teenager is throwing requests at it"*,
not internet exposure. Unauthenticated resource exhaustion and privilege
escalation matter. Passive wire sniffing does not. Note that an unauthenticated
route which fans out to a device or a paid third-party API is a form of
resource exhaustion, even though it only reads.

**Preserve the comments that explain why.** Where code looks strange because a
device or an API is strange, the reasoning is the most expensive content in the
repo. If you believe a documented decision is wrong, change it and say so in the
PR — that is a fine thing to do. Just don't delete the reasoning silently, and
don't let a diff drop it by accident.

## Green tests are not verification

The suite runs against mock-mode rooms, so it needs no hardware. Green means the
logic holds. It does **not** mean the feature works.

Anything touching ProPresenter, Companion, Smaart, Open Sound Meter or Planning
Center is only truly verified on-site, against a specific building's gear —
often only on a Sunday. A ProPresenter minor version can change API behaviour
underneath a passing test.

So please say which half you checked. "Tests green, and I ran this against
ProPresenter 21.4 on our Mac mini for two services" is a mergeable claim.
"Tests green" on an integration change is not, and the honest version —
"tests green, no hardware to try it on" — is genuinely useful and will not
count against you.

If your change encodes something you learned from real gear, add it to
[`docs/INTEGRATION-NOTES.md`](docs/INTEGRATION-NOTES.md). That file is the point
of this project surviving contact with reality.

Expect integration work to merge more slowly than the code deserves. It waits
for a Sunday.

## Licensing and provenance

This project is [MIT](LICENSE). By opening a pull request you license your
contribution under those same terms, which is also what GitHub's Terms of
Service already say about content added to a repository carrying a license
notice.

That covers code **you wrote**. It cannot cover code that is not yours to give.
If a change carries logic, an algorithm or a non-trivial block from another
project, say so in the PR and name the project and its license. Porting an
insight you learned by reading someone else's code is normal and fine; copying
their implementation without saying where it came from is a problem that
surfaces much later and is painful to unwind.

Set your git identity to a real address before you commit:

```bash
git config user.email "you@example.com"
```

Author metadata is permanent once merged. A default like
`you@Your-Mac-mini.local` publishes your machine's hostname into this
repository's history forever, and makes you unreachable besides.

## Reporting something instead

A good bug report about a device that behaves oddly is a real contribution and
is often more useful than a patch — you have hardware nobody here has. Open an
issue with the product and exact version, what you expected, and what it did.
