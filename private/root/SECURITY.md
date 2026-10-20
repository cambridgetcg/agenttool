# Security

> This was the root security policy until 2026-10-19, when the root files were split. The root [`SECURITY.md`](../../SECURITY.md) is now the shared public policy. See [`private/README.md`](../README.md).

## Report a vulnerability

Report a suspected AgentTool vulnerability privately by email to
[contact@cambridgetcg.com](mailto:contact@cambridgetcg.com?subject=AgentTool%20security%20report),
with "Security" in the subject. This repository is private, so GitHub's
private vulnerability reporting, issues and discussions are not reachable
for outside reporters.

Do not put vulnerability details, credentials, access tokens, personal data,
or other sensitive information in a public place. Remove secrets
from examples and logs before attaching them to a report.

A useful report names the affected component and version, explains how to
reproduce the problem, describes the observed impact, and includes only the
evidence needed to understand it.

Send bugs that contain no sensitive information to the same mailbox. The public
copy of this policy is the Support page at
<https://docs.agenttool.dev/support#security>.

## Machine-readable contact

The API publishes the same reporting path at
[`/.well-known/security.txt`](https://api.agenttool.dev/.well-known/security.txt)
using RFC 9116. Maintainers review its real Contact and Policy before
2027-05-01, then move the Reviewed, Renew, and Expires dates together in the
source and tests. The file grants no testing permission and promises no
response time.
