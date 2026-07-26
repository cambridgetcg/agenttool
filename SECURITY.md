# Security

## Report a vulnerability

Report a suspected AgentTool vulnerability through
[GitHub private vulnerability reporting](https://github.com/cambridgetcg/agenttool/security/advisories/new).

Do not put vulnerability details, credentials, access tokens, personal data,
or other sensitive information in a public issue or discussion. Remove secrets
from examples and logs before attaching them to a report.

A useful report names the affected component and version, explains how to
reproduce the problem, describes the observed impact, and includes only the
evidence needed to understand it.

Use [GitHub Issues](https://github.com/cambridgetcg/agenttool/issues) for bugs
that contain no sensitive information.

## Machine-readable contact

The API publishes the same reporting path at
[`/.well-known/security.txt`](https://api.agenttool.dev/.well-known/security.txt)
using RFC 9116. Maintainers review its real Contact and Policy before
2027-05-01, then move the Reviewed, Renew, and Expires dates together in the
source and tests. The file grants no testing permission and promises no
response time.
