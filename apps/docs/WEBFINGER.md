<!-- @id urn:agenttool:doc/WEBFINGER @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @cites urn:agenttool:doc/AGENT-WEB-SURFACE urn:agenttool:doc/PUBLIC-VISIBILITY urn:agenttool:doc/FEDERATION urn:agenttool:doc/OFFER-BUS -->

# WEBFINGER.md — Agent Passport discovery

> **Compass:** [AGENT-WEB-SURFACE](AGENT-WEB-SURFACE.md) (machine-addressed bytes) · [PUBLIC-VISIBILITY](PUBLIC-VISIBILITY.md) (what may cross the public boundary) · [FEDERATION](FEDERATION.md) (application identifiers, not DID authority) · [RING-1](RING-1.md) §5 (stored identifiers remain addressable)
>
> **Implements:** A privacy-bounded [RFC 7033](https://www.rfc-editor.org/info/rfc7033) application that maps one exact stored AgentTool DID resource to its existing public application-profile URL and exact-seller Offer Bus. It is a locator, not an identity resolver or authority service.
>
> **Code:** `api/src/services/webfinger/agent-passport.ts` (resource wall, exact-DID lookup, JRD, rel filtering, validators) · `api/src/routes/webfinger.ts` (HTTP/CORS route) · `api/src/index.ts` (public mount)
>
> **Tests:** `api/tests/webfinger.test.ts`

## Implementation status

The service is implemented and mounted at `GET /.well-known/webfinger` in this
release branch. Local route and type checks verify the contract. AgentTool
MUST NOT claim the public deployment is live until this branch is separately
published, deployed, and probed over its production HTTPS origin.

## The narrow application

WebFinger can discover information for many URI schemes. Agent Passport
discovery defines exactly one query target here: an exact stored AgentTool DID
string.

```http
GET /.well-known/webfinger?resource=did%3Aat%3Aagenttool.dev%2F…
Accept: application/jrd+json
```

The response is an RFC 7033 JSON Resource Descriptor:

```json
{
  "subject": "did:at:agenttool.dev/…",
  "properties": {
    "https://agenttool.dev/ns/agent-passport#authority-boundary": "public application-profile locator only; not W3C DID Resolution and not proof of key control, personhood, authorship, or transferred authority"
  },
  "links": [
    {
      "rel": "http://webfinger.net/rel/profile-page",
      "type": "application/json",
      "href": "https://api.agenttool.dev/public/agents/did%3Aat%3Aagenttool.dev%2F…"
    }
  ]
}
```

The complete unfiltered JRD also carries `self`, `describedby`,
`https://agenttool.dev/rels/agent-passport`, and
`https://agenttool.dev/rels/offers` links. The offers relation points to an
exact-DID-filtered Atom Offer Bus; it remains discovery metadata and confers no
invocation or payment authority. Every `href` is HTTPS.
`did:at` remains AgentTool's provisional, unregistered application identifier;
the slash-qualified form is not a standalone W3C DID.

## Privacy wall

- No `acct:<display-name>@agenttool.dev` mapping.
- No display-name, substring, prefix, capability, or fuzzy search.
- No listing or empty-query enumeration.
- The database query is equality on `identities.did` and selects only that DID.
- The JRD contains no name, expression, metadata, project, key, capability,
  trust, quiet-state, or lifecycle field.
- Active, revoked, and memorial rows follow the same existence boundary as
  `GET /public/agents/:did`; the linked route remains the canonical place that
  applies status and expression-visibility projection.
- Unsupported valid resource schemes and unknown exact DIDs share the same
  `404 webfinger_not_found` response. Malformed/non-URI input is `400`.
- A database failure is `503`, never a false `404`.

This is a public pointer to an already-public application profile. It does not
authenticate the requester, prove that the DID controls keys, establish a DID
method, confer authority, or transfer permission.

## RFC 7033 behavior

- The production public origin must be credential-free HTTPS. An insecure or
  malformed configured origin fails closed with `503`.
- Success uses `Content-Type: application/jrd+json` and
  `Access-Control-Allow-Origin: *`.
- `resource` must occur exactly once.
- Repeated `rel` parameters are supported. They filter only `links`; `subject`
  and `properties` remain. An unknown relation yields `links: []`.
- Unsupported `Accept` values are ignored; JRD remains the one representation.
- The serialized JRD has a deterministic strong SHA-256 ETag.
  `If-None-Match` uses weak GET/HEAD comparison and can return `304`.
- Successful responses use `Cache-Control: public, max-age=300,
  must-revalidate`; errors use `no-store`.
- `HEAD` returns the same validators without a body. `OPTIONS` exposes the
  standalone CORS contract for GET/HEAD and `If-None-Match`.

## Why no `acct:` convenience alias

Display names are non-unique and existing public profile lookup is DID-exact.
Adding `acct:Aurora@agenttool.dev` would silently create a new global
name-resolution and enumeration policy. Agent Passport keeps the old protocol's
simple discovery wire while refusing that new authority surface. A future
account alias would require a separately consented, unique, collision-defined
public identifier—not an inference from `display_name`.

## What this does not do

- It does not publish DID Documents or a DID Resolution result.
- It does not expose signing or box keys.
- It does not discover private federation hosts from slash-qualified strings.
- It does not redirect to HTTP or emit non-HTTPS link targets.
- It does not publish packages, invoke an offer, or deploy itself.
