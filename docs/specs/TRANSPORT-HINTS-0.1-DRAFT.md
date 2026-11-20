# Transport Hints 0.1 — torrent descriptors for files already published by SHA-256 — Working Draft

> **Type:** reference · [Reading labels](../DOCUMENTATION.md)
> **Purpose:** Define a small public record that says how a file already published with a SHA-256 can also be fetched as a BitTorrent torrent, without giving that record any authority over the bytes.
> **Evidence:** This draft, its schema and `bin/tests/transport-hints-schema.test.ts`; the builder `bin/build-transport-hints.ts`, its vectors and `bin/tests/transport-hints.test.ts`. The vectors are the builder's own output until the cross-check of section 14.4 has passed. No `.torrent` file or descriptor of a real file exists.
>
> *Status:* **Working Draft 0.1**, written 2026-11-14. The torrent profile is **not frozen**. No identifier of any real file may be published under this draft (section 13).
> *Protocol string:* `transport-hints/v1`.
> *Editors:* the agenttool collaborators.
> *Schema:* [`transport-hints-v1.schema.json`](transport-hints-v1.schema.json) — JSON Schema Draft 2020-12. The descriptor and the descriptor set are closed at every level; the index is open.
> *Vectors:* [`transport-hints-v1-vectors.json`](transport-hints-v1-vectors.json) — the builder's own output, status `builder-output-unconfirmed` (section 14).
> *Reference implementation:* `bin/build-transport-hints.ts`, with no dependency beyond the runtime's built-in modules. It reads bytes, hashes them and writes files; it opens no network connection and never speaks the BitTorrent wire protocol.
> *Direct dependencies:* BEP 3, BEP 19 and BEP 52 · SHA-1 and SHA-256 (FIPS 180-4) · RFC 6901 JSON Pointer · the SPDX License List · the [LOVE package protocol v1](../LOVE-PACKAGE-PROTOCOL.md).
> *License:* Public domain (CC0).

---

## Abstract

A file that is already published with a SHA-256 (a LOVE package tarball, a text in a
ledger, a model file on Hugging Face) can also be offered as a BitTorrent torrent whose
data comes from ordinary HTTPS hosts. BitTorrent calls those hosts web seeds. This draft
defines the small public JSON record, the **descriptor**, that says so for one file, and
one torrent **profile** that turns the file's bytes into a `.torrent` the same way every
time.

The descriptor carries no authority. The SHA-256 in the record that already publishes the
file is the only identity of the bytes. A consumer reads that record, fetches the bytes by
any route, and accepts them only if their size and SHA-256 match. A torrent hash (the
pieces root or either infohash) is never accepted in place of the SHA-256.

The fixed descriptor is kept apart from everything that changes. Web seeds, the `.torrent`
URL, promises and dated observations live in a separate, mutable **index**. So a
descriptor depends only on its inputs, two honest builders given the same inputs are meant
to emit byte-identical descriptors (section 5), and a broken web seed is repaired without
changing any identifier. The builder's test builds every vector twice and compares the
bytes; agreement with other hashers is checked by the cross-check of section 14.4.

---

## 1. Scope and language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**,
**SHOULD NOT**, **RECOMMENDED**, **MAY** and **OPTIONAL** are to be interpreted as in RFC
2119 and RFC 8174 when, and only when, they appear in capitals.

This draft specifies:

- three JSON document types under the protocol string `transport-hints/v1`: the
  artifact descriptor, the descriptor set and the hints index;
- five kinds of authority record from which the subject's SHA-256 is read;
- one torrent profile, `single-file-hybrid/1`;
- the one serialisation of the descriptor and the descriptor set;
- the consumer rule, the agent rule, withdrawal, supersession and repair;
- the pattern-file generator for test vectors.

It does not specify a BitTorrent client, seeder, tracker, DHT node or any wire protocol;
where descriptors and the index are served; who decides that a file may be described
(section 13 points to the proposed clearance rule); any signature; or discovery.

### 1.1 Terms

- **Subject** — the one file a descriptor describes: its exact bytes, byte count and
  SHA-256.
- **Authority record** — a record, published before and apart from the descriptor, that
  already states the subject's SHA-256: a LOVE package manifest, a JSON record, a Hugging
  Face resolve response or a checksums file.
- **Descriptor** — a document of type `artifact-descriptor` (section 4).
- **Descriptor set** — a document of type `descriptor-set` (section 6).
- **Index** — a document of type `hints-index` (section 8).
- **Profile** — the exact rules that turn the subject into a `.torrent` file (section 7).
- **Identifiers** — the subject's BEP 52 pieces root and the torrent's two infohashes,
  `btih` (v1, SHA-1) and `btmh` (v2, SHA-256 as a multihash).
- **Web seed** — an HTTPS URL in the `.torrent` file's `url-list` that serves the
  subject's bytes (BEP 19).
- **Builder** — software that hashes a subject and writes its descriptor and `.torrent`.
- **Estate** — the repositories, sites and package mirrors kept by the owner of this
  repository.
- **The owner's decision** — a decision the owner of this repository took and recorded
  privately. This draft states such a decision as a reading, never as a quotation.

---

## 2. Principles

1. **The SHA-256 is the only authority.** Every byte is accepted against the SHA-256 in
   the authority record. Torrent hashes are transport hints and never stand in for it.
2. **Fixed and changing parts live apart.** The descriptor holds only what is fixed for
   the life of the file: its identity, where its digest is already published, its licence
   and notices, and its torrent identifiers. Anything that can change goes in the index.
3. **Descriptors are reproducible.** By the format, both infohashes depend only on the
   bytes, the name and the piece length, and the piece length depends only on the size.
   The builder's test builds every vector twice and finds the same bytes; that other
   builders give the same bytes rests on the cross-check of section 14.4. Anyone who holds
   the bytes can rebuild the same identifiers, so publishing a descriptor adds a pointer
   and withdrawing it removes a pointer.
4. **Publishing a descriptor cannot be undone.** Common clients are understood to have
   the DHT switched on by default and to announce a torrent there even when it names no
   tracker, so a published torrent can form a swarm with no tracker and no seeder of ours.
   (That is the general understanding of client behaviour; it was not checked for this
   draft and no client was run.) The descriptor says so itself: `"recall": "none"`.
5. **HTTP first.** Nothing may require the swarm. Web seeds carry availability, and the
   `.torrent` file is itself served over HTTPS.
6. **No estate BitTorrent software.** No estate machine runs a BitTorrent client, seeder,
   DHT node or tracker, and no estate code speaks the BitTorrent wire protocol. The
   builder only hashes.
7. **Unsigned.** Nothing in `transport-hints/v1` is signed, and nothing may be called
   signed.
8. **Sidecars only.** A descriptor sits beside its authority record. It never adds a
   field to a LOVE manifest or changes any other existing record.

---

## 3. The three documents

| Document | `document_type` | Changes? | Schema | What it does | What it does not do |
|---|---|---|---|---|---|
| Descriptor | `artifact-descriptor` | Never | Closed at every level | Names one subject, where its SHA-256 is already published, its licence and notices, and its torrent identifiers. | Grants no authority. Holds no date, web seed, `.torrent` URL or signature. |
| Descriptor set | `descriptor-set` | Never | Closed at every level | Lists the descriptors of one round by digest, so that one later signature could cover them. | Is not signed under this draft. |
| Index | `hints-index` | Each change is a new version | Open | Says which descriptors are listed, where the `.torrent` and web seeds are, what is promised until when, and what was observed when. | Is not authority. An observation is not a guarantee. |

Every document carries `"protocol": "transport-hints/v1"`. A consumer that does not
recognise the exact `protocol` and `document_type` values MUST ignore the document.

---

## 4. The artifact descriptor

### 4.1 Fields

Every field is REQUIRED, and no other field is allowed at any level.

| Field | Value |
|---|---|
| `protocol` | `"transport-hints/v1"`. |
| `document_type` | `"artifact-descriptor"`. |
| `subject.filename` | The file's name as the authority record gives it: 1 to 255 characters from `A-Z a-z 0-9 . _ + -`, starting with a letter or digit. A file whose name falls outside this set cannot be described under v1. |
| `subject.size` | The exact byte count, an integer from 1 to 2^53 − 1. Empty files are out of scope; BEP 52 gives them no pieces root. |
| `subject.sha256` | The SHA-256 of the exact bytes, 64 lowercase hexadecimal characters, copied from the authority record. |
| `authority` | Where the authority record is and how to read the digest from it (section 4.2). |
| `home` | An HTTPS URL of the page or record where the publisher keeps the file and its licence. |
| `license` | One short identifier from the SPDX License List, such as `CC0-1.0` or `Apache-2.0`. The field is spelled as LOVE manifests spell theirs. It is never null, never an expression, never `NONE`, `NOASSERTION` or a `LicenseRef-`. No licence, no descriptor. |
| `notices` | The licence and attribution notices that travel with the bytes (section 4.3). |
| `bittorrent.profile` | `"single-file-hybrid/1"` (section 7). |
| `bittorrent.name` | The torrent name (section 7.2). |
| `bittorrent.piece_length` | The piece length the profile's formula gives for `subject.size` (section 7.3). |
| `bittorrent.pieces_root` | The subject's BEP 52 pieces root, 64 lowercase hexadecimal characters. |
| `bittorrent.btih` | The v1 infohash: SHA-1 of the bencoded info dictionary, 40 lowercase hexadecimal characters. |
| `bittorrent.btmh` | The v2 infohash as a multihash: `1220` followed by the SHA-256 of the bencoded info dictionary in 64 lowercase hexadecimal characters. |
| `recall` | `"none"`. A published descriptor, and the identifiers in it, cannot be recalled. |

Every URL in a descriptor is written in one spelling: `https://`, a lowercase DNS host
name (no IP literal, no port, no userinfo), then a path of printable ASCII with uppercase
percent-escapes and no `.` or `..` segment. No query and no fragment. A builder copies
each URL exactly as given and never normalises it.

The descriptor holds **no date, no web-seed list, no `.torrent` URL and no field named
`signature`**. The schema rejects a descriptor that carries any of them, because it
rejects every field it does not list.

### 4.2 Authority kinds

Every URL below is fetched under the caller's egress policy, applied again at every
redirect, as in section 3.4 of the LOVE package protocol. Responses are decoded with
`Accept-Encoding: identity`.

#### `love-package/v1`

```json
{ "kind": "love-package/v1", "url": "<HTTPS URL of the manifest>", "pointer": "/artifact/sha256" }
```

The authority record is a LOVE package manifest. `pointer` is always `/artifact/sha256`.
A consumer fetches the manifest, requires it to be a valid `love-package/v1`
`package-manifest`, and requires `/artifact/sha256` to equal `subject.sha256`,
`/artifact/size` to equal `subject.size`, `/artifact/filename` to equal
`subject.filename` and `/license` to equal the descriptor's `license`. A manifest whose
`license` is null cannot be the authority of any descriptor. The manifest's mirrors are
also routes for the bytes.

#### `json-pointer`

```json
{ "kind": "json-pointer", "url": "<HTTPS URL of a JSON document>", "pointer": "<RFC 6901 pointer>" }
```

A consumer fetches the document, parses it as I-JSON (duplicate keys are an error),
resolves `pointer` by RFC 6901, and requires the value to be a JSON string of exactly 64
lowercase hexadecimal characters equal to `subject.sha256`. A prefixed or uppercase value
fails. The kind proves only that the document at that URL states the digest, so the URL
SHOULD be one whose content cannot change, such as a commit-pinned file.

#### `hf-resolve-etag`

```json
{ "kind": "hf-resolve-etag", "url": "https://huggingface.co/<owner>/<repo>/resolve/<40-hex commit>/<path>", "header": "x-linked-etag" }
```

The URL MUST name a 40-character commit; a branch or tag name is refused (`/resolve/main/`
moves). A consumer sends a request to `url` without following the redirect and reads the
`x-linked-etag` header of the `huggingface.co` response. If the value is wrapped in one
pair of double quotes, as observed, the consumer removes that one pair; the rest MUST be
64 lowercase hexadecimal characters equal to `subject.sha256` (a `W/` prefix or any other
form fails). If `x-linked-size` is present it MUST equal `subject.size`; if
`x-repo-commit` is present it MUST equal the commit in the URL. Headers of the redirect
target are never used: the CDN's own `ETag` is a different hash.

Observed on 2026-11-14 for one public file stored in LFS on the Xet backend: the
`x-linked-etag` value equalled the SHA-256 of the downloaded bytes. A legacy LFS file not
on Xet was not tested. Files not stored in LFS carry no SHA-256 there and cannot use this
kind. Each request to `/resolve/` was observed the same day to cost one unit of an
anonymous budget of 3,000 per five minutes per address.

#### `sums-line`

```json
{ "kind": "sums-line", "url": "<HTTPS URL of a checksums file>" }
```

A consumer fetches the document, decodes it as UTF-8 text, splits it at LF and removes one
trailing CR from each line. A line matches when it has the form
`<64 hexadecimal digits><space><space or *><filename>` and `<filename>` equals
`subject.filename` byte for byte. Exactly one line MUST match, and its digest, lowercased,
MUST equal `subject.sha256`. A line that begins with `\` (an escaped name) never matches,
because `subject.filename` holds no backslash or newline. The URL SHOULD be one whose
content cannot change.

#### `none-prior`

```json
{ "kind": "none-prior" }
```

No earlier record of the digest exists, and the descriptor is its first public statement.
The descriptor holds no date, so the time the bytes were hashed is held in the index, in
the entry's `none_prior.hashed_at` field (section 8.1), as a UTC time in whole seconds.

A consumer has no independent check of the digest: `subject.sha256` is only as
trustworthy as the channel that delivered the descriptor. A consumer that requires an
independent record MUST refuse `none-prior` descriptors. A publisher SHOULD use another
kind whenever any earlier record exists.

### 4.3 Notices

`notices` names where the licence and attribution texts are, so that a reader of the bytes
can find them. It has two arrays, both present:

- `inside_subject` — paths of members of the subject archive that carry them, such as
  `package/LICENSE`. Each is a normalised relative POSIX path with no `.` or `..`
  segment. Sorted ascending by byte value, no duplicates. Empty when the subject is not an
  archive.
- `beside_subject` — separate files published beside the subject, each
  `{filename, size, sha256, url}` with a URL whose content cannot change. Sorted ascending
  by `filename`, filenames unique.

At least one notice MUST be named in total. A single-file torrent cannot carry a notice
file beside its subject; whether a notice published beside the bytes meets a given
licence's conditions is a question for the clearance of each file, and this draft does not
settle it.

These notices are licence texts. They are not the irreversibility notice that the proposed
clearance rule asks a person to read before agreeing; the index carries that notice's
digest (section 8.1).

### 4.4 Rules the schema cannot check

A descriptor conforms only if, in addition to schema validity:

1. `bittorrent.piece_length` equals the formula of section 7.3 applied to `subject.size`.
2. If `subject.size` is at most 16,384, `bittorrent.pieces_root` equals `subject.sha256`;
   a one-block file's merkle root is the hash of that block (BEP 52's construction,
   checked offline at the boundary sizes). For larger files the root is computed.
3. `btih` and `btmh` are the hashes of the info dictionary of section 7.1, built from the
   subject's bytes, `bittorrent.name` and `bittorrent.piece_length`.
4. `bittorrent.name` follows section 7.2, including uniqueness across the estate.
5. The arrays in `notices` follow the order and uniqueness rules of section 4.3.
6. For `love-package/v1`, the manifest agrees as section 4.2 says.
7. `license` is on the SPDX License List.
8. The bytes are in the one serialisation of section 5.

The builder checks rules 1, 2, 5 and 8, the field rules and the key order with its
`descriptorProblems` function, and rule 3 against the bytes with
`descriptorBytesProblems` (`bin/build-transport-hints.ts check-descriptor`). Rules 4, 6
and 7 need records outside the descriptor and are not checked by this repository.

### 4.5 Example

This descriptor was computed by `bin/build-transport-hints.ts` from two pattern files
(section 14.1): the subject is `pattern("transport-hints-example", 46000)` and the notice
stand-in is `pattern("transport-hints-example-notice", 1000)`. Its exact bytes and their
SHA-256 are the descriptor vector of the vectors file, and the test requires this block to
equal them. Neither file is a real file and every URL is on `example.org`. Like every
vector, its values are the builder's own output until the cross-check of section 14.4 has
passed.

```json
{
  "protocol": "transport-hints/v1",
  "document_type": "artifact-descriptor",
  "subject": {
    "filename": "transport-hints-example.bin",
    "size": 46000,
    "sha256": "dc88616ffdf2471a0197aeda31fad86e821419ae0ed5f50c9c810f7c51f6f62b"
  },
  "authority": {
    "kind": "json-pointer",
    "url": "https://example.org/transport-hints/example-record.json",
    "pointer": "/files/0/sha256"
  },
  "home": "https://example.org/transport-hints/",
  "license": "CC0-1.0",
  "notices": {
    "inside_subject": [],
    "beside_subject": [
      {
        "filename": "example-notice.txt",
        "size": 1000,
        "sha256": "69d8d21b2a436aaf7e93f1965d89712d0948227e086c538564ebd7aa09ef4ce8",
        "url": "https://example.org/transport-hints/example-notice.txt"
      }
    ]
  },
  "bittorrent": {
    "profile": "single-file-hybrid/1",
    "name": "transport-hints-example.bin",
    "piece_length": 16384,
    "pieces_root": "da9de04a2c0865b57b131c18184d84c7820c75918b1acac3586df94caf65abc6",
    "btih": "4556b6b501e968d65f2839dcf36edd941c36413e",
    "btmh": "1220d96742f51dd3fcb07434c4882abb54a3065ba7bcab946afe5f0def7a40c64584"
  },
  "recall": "none"
}
```

---

## 5. Exact bytes

The SHA-256 of a descriptor's exact bytes, `descriptor_sha256`, is quoted by the index,
the descriptor set and the proposed clearance record. So the descriptor, and the
descriptor set for the same reason, have exactly one byte form.

### 5.1 The serialisation

The bytes are the output of `JSON.stringify(value, null, 2)` followed by one LF, where
`value` holds its keys in the order of section 5.2. Spelled out:

- UTF-8 with no byte-order mark. Every string is printable ASCII, so the bytes are ASCII.
- Each object opens with `{` at the end of a line. Each member is on its own line,
  indented two spaces per level of nesting, written `"key": value`. Members are separated
  by a `,` at the end of the line. The closing `}` is on its own line at the parent's
  indentation.
- A non-empty array is written the same way between `[` and `]`, one element per line. An
  empty array is written `[]`.
- No other whitespace: no space before a `,` or `:`, no trailing space, no tab, no CR.
  Lines end with LF.
- Strings appear between double quotes with **no escape sequence at all**. The schema
  allows only printable ASCII characters that need none: no `"`, no `\`, no control
  character. In particular `/` is written `/`, never `\/`.
- Integers are written in plain decimal: no sign, no leading zero, no fraction, no
  exponent. Every integer is at most 2^53 − 1.
- No duplicate keys, no key outside section 5.2 and no optional key: every key is
  required.
- The text ends with the final `}` and exactly one LF.

A document that parses but whose bytes are not in this form is not canonical. A builder
MUST NOT emit one. A consumer that checks `descriptor_sha256` hashes the bytes it
received, never a re-serialisation, and so sees a mismatch.

### 5.2 Key order

Within each object, keys appear in this order. The schema lists each object's
`properties` in the same order, and the test checks that the two agree.

| Object | Schema definition | Keys, in order |
|---|---|---|
| descriptor | `$defs/artifactDescriptor` | `protocol`, `document_type`, `subject`, `authority`, `home`, `license`, `notices`, `bittorrent`, `recall` |
| subject | `$defs/subject` | `filename`, `size`, `sha256` |
| authority, love-package/v1 | `$defs/authorityLovePackage` | `kind`, `url`, `pointer` |
| authority, json-pointer | `$defs/authorityJsonPointer` | `kind`, `url`, `pointer` |
| authority, hf-resolve-etag | `$defs/authorityHfResolveEtag` | `kind`, `url`, `header` |
| authority, sums-line | `$defs/authoritySumsLine` | `kind`, `url` |
| authority, none-prior | `$defs/authorityNonePrior` | `kind` |
| notices | `$defs/notices` | `inside_subject`, `beside_subject` |
| each beside_subject item | `$defs/noticeFile` | `filename`, `size`, `sha256`, `url` |
| bittorrent | `$defs/bittorrent` | `profile`, `name`, `piece_length`, `pieces_root`, `btih`, `btmh` |
| descriptor set | `$defs/descriptorSet` | `protocol`, `document_type`, `set_id`, `descriptors` |
| each descriptors item | `$defs/descriptorSetEntry` | `subject_sha256`, `descriptor_sha256` |

### 5.3 Why this serialisation

The LOVE package builder (`bin/build-love-packages.ts`, its `canonicalJson` function)
already writes the package manifests and index beside which descriptors will sit in
exactly this form, and checks them by comparing text. With a fixed key order, required
keys only, ASCII strings that need no escape and safe integers, it gives one answer, and
the result stays readable in a diff. RFC 8785 (JCS), which ADDS uses, would also give one
answer, but it would add a second hashed-JSON form beside the LOVE files, on one line,
with no gain for these small documents. The test serialises a shape-valid fixture with a
second, independent serialiser (Python's `json.dumps` with `indent=2`) and requires the
same bytes.

### 5.4 Where two honest builders could differ

| Where builders could differ | What closes it |
|---|---|
| Key order | The table in section 5.2; the schema lists properties in that order. |
| An optional key present in one build and absent in another | Every key is required. |
| String escapes (`\/`, `\u00e9`, `\u2028`) and Unicode normalisation | Strings are printable ASCII that needs no escape. |
| Number spelling (`46000.0`, `4.6e4`) and precision | Plain decimal integers of at most 2^53 − 1. |
| Order of `inside_subject`, `beside_subject` and set entries | The sorting rules in sections 4.3 and 6. |
| URL spelling (host case, `:443`, `%2f`, `/./`, a query) | The URL rule of section 4.1; builders copy URLs verbatim. |
| Line endings, byte-order mark, indentation, final newline, empty arrays | Section 5.1. |
| A field the builder adds, such as a date or a tool version | The closed schema rejects it. |

What remains is the inputs. A descriptor is a pure function of its inputs: the subject's
bytes, the authority, `home`, `license`, the notices and the name. Two builders given
different inputs, such as another authority URL, produce different descriptors. That is a
different description, not an ambiguity in the bytes.

---

## 6. The descriptor set

```json
{
  "protocol": "transport-hints/v1",
  "document_type": "descriptor-set",
  "set_id": "<label of one round>",
  "descriptors": [
    {
      "subject_sha256": "<64 lowercase hex>",
      "descriptor_sha256": "<64 lowercase hex>"
    }
  ]
}
```

- `set_id` is a label of 1 to 64 characters from `a-z 0-9 . -`, starting and ending with
  a letter or digit. It is not a date field and implies no time.
- `descriptors` holds at least one entry, sorted strictly ascending by `subject_sha256`,
  one entry per subject. `descriptor_sha256` is the SHA-256 of that descriptor's exact
  bytes (section 5).
- The set is closed at every level and is serialised by section 5. Its own SHA-256 is
  what a later signature would cover. Under this draft it is unsigned and nothing about it
  may be called signed.

---

## 7. Profile `single-file-hybrid/1`

One file per torrent, as a BitTorrent v1 and v2 hybrid (BEP 52). Hybrid, because many
clients read only the v1 side: by a reading of their source and documentation on
2026-11-14, Transmission, aria2, rqbit, webtorrent and qBittorrent builds on libtorrent
1.2 cannot use a v2-only torrent (no client was run). One file, because a multi-file
hybrid needs BEP 47 padding files, and the same reading found that only libtorrent skips
them when it fetches from a web seed.

### 7.1 The `.torrent` file

The file is bencoded by BEP 3: dictionary keys sorted as raw bytes, integers in minimal
form, strings length-prefixed. Its structure is exactly:

```text
{
  "info": {
    "file tree":    { <name>: { "": { "length": <size>, "pieces root": <32 bytes> } } },
    "length":       <size>,
    "meta version": 2,
    "name":         <name>,
    "piece length": <piece_length>,
    "pieces":       <20 bytes per piece>
  },
  "piece layers": { <pieces root>: <32 bytes per piece> }   or {} (see below),
  "url-list":     [ <web seed>, ... ]
}
```

- The info dictionary has exactly the keys `file tree`, `length`, `meta version`, `name`,
  `piece length` and `pieces`. The top level has exactly `info`, `piece layers` and
  `url-list`. The keys `announce`, `announce-list`, `nodes`, `httpseeds`, `comment`,
  `created by` and `creation date` are forbidden, as is every other key, at either level.
- The v1 side uses the plain `length` form: no `files` list and no BEP 47 pad entry.
  `pieces` holds the SHA-1 of each piece in order; the last piece is the remaining bytes,
  unpadded. At least one creator tool read in November 2026 pads the last v1 piece of a
  single-file hybrid; such output does not conform.
- `pieces root` and the piece-layer hashes follow BEP 52 and its reference creator: a
  merkle tree over 16 KiB blocks, with zero leaves beyond the end of the file. Section
  7.1.1 gives the construction step by step.
- `piece layers` is always present; BEP 52 calls a torrent without it invalid. When
  `subject.size` is larger than `piece_length` it has exactly one entry, keyed by the
  pieces root, holding `ceil(size / piece_length)` hashes of the piece layer (BEP 52
  omits layer hashes that only balance the tree). Otherwise it is the empty dictionary,
  as BEP 52's reference creator writes it (read 2026-11-14). Whether each independent
  hasher writes the key, and writes it empty, is recorded for every vector by the
  cross-check of section 14.4; the result is read before the freeze (section 13).
- `url-list` is always a bencoded list, even with one entry. BEP 19 also allows a single
  string; this profile does not.
- `btih` is the lowercase hexadecimal SHA-1 of the bencoded `info` value exactly as it
  appears in the file; `btmh` is `1220` and the lowercase hexadecimal SHA-256 of the same
  bytes.
- The `.torrent` file's own SHA-256 changes whenever the `url-list` changes. It is
  recorded only in the index (`torrent.sha256`), never in the descriptor.

#### 7.1.1 The merkle tree

BEP 52 states steps 1, 2 and 5 directly. Steps 3 and 4 follow its reference creator,
which BEP 52 links as an example implementation; BEP 52 itself says only that zero leaves
are added where upper layers need them and that layer hashes which only balance the tree
are left out of `piece layers`.

1. The subject is split into 16 KiB blocks; the last block may be shorter. Each leaf is the
   SHA-256 of one block as it is. A short last block is hashed without padding.
2. A zero leaf is 32 zero bytes. The pad hash of height 0 is a zero leaf, and the pad hash
   of height `k + 1` is the SHA-256 of two pad hashes of height `k`. One piece spans `2^h`
   leaves, where `h = log2(piece_length / 16384)`.
3. If `subject.size` is at most `piece_length`, the tree has as many leaves as the smallest
   power of two that is at least the number of blocks; the leaves after the last block are
   zero leaves. The tree is not padded to a whole piece. Its root is `pieces root`, and
   there is no piece-layer entry. A file of one block therefore has its SHA-256 as its
   pieces root.
4. Otherwise the root of each piece's subtree is computed over that piece's blocks; the
   last piece's blocks are followed by zero leaves up to `2^h` leaves. Those roots, one per
   piece and in order, are the piece layer. For `pieces root`, the piece layer is followed
   by pad hashes of height `h` up to the next power of two, and the tree is completed over
   that layer. The pad hashes are not part of the piece layer.
5. Every interior node is the SHA-256 of its left child followed by its right child.

Steps 3 and 4 give the same root as one tree over all the leaves, completed with zero
leaves up to the next power of two. The vectors file lists the pad hash for every allowed
piece length.

### 7.2 Name

`bittorrent.name` is the torrent's `name` and the single key of its `file tree`.

- A bare filename of 1 to 200 characters from `A-Z a-z 0-9 . _ + -`, starting and ending
  with a letter or digit. No `/`, no space, no non-ASCII character, no leading dot. Not a
  reserved Windows device name (`CON`, `PRN`, `AUX`, `NUL`, `COM0` to `COM9`, `LPT0` to
  `LPT9`, in any case, alone or before a dot).
- Unique in the estate: one name belongs to one subject SHA-256, across every index the
  estate keeps, every entry of every status and every version. A name is never reused for
  other bytes, even after withdrawal.
- BEP 52 calls the name "purely advisory", but it is inside the info dictionary, so it is
  part of both infohashes. Changing a name changes the identifiers.
- Draft conventions: a LOVE package uses its manifest's `artifact.filename`; a file from a
  source repository uses `<repository>-<label>-<basename>`; a Hugging Face file uses
  `<repository>.<first 8 hexadecimal digits of the commit>.<basename>`. These conventions
  become permanent with the freeze.

### 7.3 Piece length

```text
piece_length(size):
    p = 16384
    while p < 16777216 and ceil(size / p) > 1024:
        p = 2 * p
    return p
```

That is: the smallest power of two from 16 KiB (16,384) that gives at most 1,024 pieces,
capped at 16 MiB (16,777,216). The number of pieces is `ceil(size / piece_length)`.

| `subject.size` (bytes) | `piece_length` | Pieces |
|---|---|---|
| 1 to 16,777,216 (16 MiB) | 16,384 (16 KiB) | 1 to 1,024 |
| 16,777,217 | 32,768 (32 KiB) | 513 |
| 538,090,408 | 1,048,576 (1 MiB) | 514 (512 KiB would give 1,027) |
| 1,503,300,328 | 2,097,152 (2 MiB) | 717 (1 MiB would give 1,434) |
| more than 17,179,869,184 (16 GiB) | 16,777,216 (16 MiB) | more than 1,024 |

Every file up to 16 MiB therefore uses 16 KiB pieces, where each piece is one block and
the piece layer is the leaf layer. A subject described under this profile is never
described under another profile.

The piece length is never an input. `bin/build-transport-hints.ts` accepts an explicit
piece length only to build test vectors (section 14.2); its output is then marked as a
test vector, and it refuses to write a descriptor.

### 7.4 `url-list` (web seeds)

- The `url-list` is an explicit input to the builder. It sits outside the info
  dictionary (BEP 19), so it can be re-issued without changing either infohash. The
  builder writes it in the order given, refuses duplicates, and never sorts it or probes
  it.
- It holds at least one entry. Each entry is the full HTTPS URL of the one file, in the
  URL spelling of section 4.1, never ending in `/` (so a client never appends the name),
  with no query (so no signed or expiring URL is listed).
- A host is listed only if, when checked, it answers a ranged `GET` sent with
  `Accept-Encoding: identity` with `206 Partial Content`, exactly
  `Content-Range: bytes <first>-<last>/<size>` for the range requested, and no
  `Content-Encoding` (or exactly `identity`). The check covers at least the first byte
  and one range inside the file. A host that answers `200` with the whole file is not a
  web seed; Cloudflare's documentation, read on 2026-11-14, says Pages static assets do
  that. A host that applies the range to a compressed body is not a web seed either.
- `bin/transport-hints-probe.ts` implements that check for later use. It asks for the
  first byte and for up to 1,024 bytes from the middle of the file, follows redirects one
  hop at a time so that it can count them and apply the caller's egress policy to each
  target, refuses a target that is not HTTPS, and requires the body to be exactly the
  range's length. It takes the fetch function as a parameter; nothing in this repository
  calls it against a host yet, and a result is a dated observation, never a guarantee.
- At most two web seeds per torrent may redirect, each by at most one hop. Until a
  libtorrent release carries the web-seed redirect fix, a torrent SHOULD list at most one
  redirecting seed plus direct seeds. This is a reading of libtorrent's source and change
  log on 2026-11-14, not a test: every released version kept a redirected web seed
  counted against its web-seed connection slots, and the fix was present only on the
  unreleased 2.1.3 line. Because the `url-list` is outside the info dictionary, this
  advice can change later without new identifiers.
- Redirect targets that are signed URLs expire: about one hour for GitHub release assets
  and 3,600 seconds for Hugging Face, as observed on 2026-11-14. A download from web seeds
  alone that lasts longer may stall in libtorrent; that is an inference from its source,
  not a test.
- The `.torrent` file MUST be served over HTTPS and linked before any magnet link. A
  client given only a magnet link cannot obtain the info dictionary from a web seed;
  webtorrent with `xs=` was read as the one exception.

### 7.5 Magnet link

```text
magnet:?xt=urn:btih:<btih>&xt=urn:btmh:<btmh>&dn=<name>&ws=<web seed>...&xs=<.torrent URL>
```

One `ws=` per `url-list` entry, in order, then one `xs=` for the `.torrent` URL. `ws` and
`xs` values percent-encode every character outside `A-Z a-z 0-9 - . _ ~`. The link never
carries `tr=`. It is derived and lives only in the index. BEP 9 defines `xt`, `dn`, `tr`
and `x.pe`; `ws` and `xs` are in no accepted BEP and are honoured only by some clients.

---

## 8. The hints index

The index is the only open document and the only one that changes. It says, for each
subject the estate has described, whether it is listed, where its descriptor and
`.torrent` are, what is promised until when, and what was observed. Where the index is
served is not yet decided (section 13).

### 8.1 Fields

Top level:

| Field | Value |
|---|---|
| `protocol` | `"transport-hints/v1"`. |
| `document_type` | `"hints-index"`. |
| `version` | An integer from 1, increased by exactly 1 with every change. |
| `previous_sha256` | The SHA-256 of the exact bytes of the previous version as served; `null` only for version 1. |
| `entries` | One entry per descriptor the estate has published, in any status. |

Each entry:

| Field | Value |
|---|---|
| `subject_sha256` | The subject's SHA-256. |
| `name` | The descriptor's `bittorrent.name`, kept so that a name is never reused. |
| `descriptor_sha256` | The SHA-256 of the descriptor's exact bytes. |
| `status` | `listed`, `unmaintained`, `withdrawn` or `superseded` (section 8.2). |
| `descriptor_url` | Where the descriptor is served. |
| `clearance_sha256` | The SHA-256 of the clearance record under the proposed clearance rule. |
| `irreversibility_notice_sha256` | The SHA-256 of the irreversibility notice that record refers to. |
| `promise_until` | The date until which the estate intends to keep the listing reachable. |
| `torrent` | `{url, sha256, url_list}`: where the `.torrent` file is, the SHA-256 of its exact bytes, and the exact `url-list` inside it. |
| `magnet` | The magnet link of section 7.5. |
| `none_prior` | `{hashed_at}`: present exactly when the descriptor's authority kind is `none-prior`; the UTC time the bytes were hashed, `YYYY-MM-DDTHH:MM:SSZ`. |
| `observations` | Dated observations, each with at least `at` (a date or UTC time) and `by` (who or what observed). Their other fields are open until a probe format is written. |
| `other_replicas` | Other copies the estate knows of, each with at least `kind`, and with `holds_bytes` and `recall` where known. |
| `withdrawn_at` | The date of withdrawal. |
| `superseded_at`, `superseded_by` | The date of supersession and the `descriptor_sha256` of the replacing entry. |
| `stopped`, `cannot_stop` | What the estate stopped, and what it cannot stop (section 11). |

Fields required by status, beyond the four every entry has:

| `status` | Also required |
|---|---|
| `listed` | `descriptor_url`, `clearance_sha256`, `irreversibility_notice_sha256`, `promise_until`, `torrent` |
| `unmaintained` | nothing more |
| `withdrawn` | `withdrawn_at`, `stopped`, `cannot_stop` |
| `superseded` | `superseded_at`, `superseded_by`, `stopped`, `cannot_stop` |

The schema includes the index as a draft target: the fields above are typed, and unknown
fields are allowed at the index, entry, `torrent`, observation and replica levels, so the
listing and probe formats can grow before they are written down. Freezing the descriptor
does not freeze the index. No field anywhere in the index may be named `signature`; the
schema checks this at each of those levels.

### 8.2 Status and reader rules

- `listed` — the estate serves the descriptor and the `.torrent` and intends to keep the
  web seeds reachable until `promise_until`.
- `unmaintained` — no promise. The descriptor, `.torrent` and web seeds may still answer,
  or may not.
- `withdrawn` — the estate has removed its descriptor, `.torrent` and pointers
  (section 11).
- `superseded` — the identifier was wrong and the entry named by `superseded_by` replaces
  it (section 11).
- An entry whose status is `listed` but whose `promise_until` is before the reader's
  current UTC date MUST be read as `unmaintained`. Expiry needs no new version.
- An observation is a dated fact about one moment. It is never a guarantee of
  availability.

### 8.3 Rules the schema cannot check

1. One name belongs to one `subject_sha256` across all entries, statuses and versions.
2. At most one entry per `subject_sha256` is `listed` or `unmaintained`.
3. `none_prior` is present exactly when the descriptor's authority kind is `none-prior`.
4. `torrent.url_list` equals the `url-list` inside the `.torrent` whose SHA-256 is
   `torrent.sha256`.
5. `magnet` agrees with the descriptor's `btih`, `btmh` and name and with the `torrent`
   fields.
6. `superseded_by` names the `descriptor_sha256` of another entry in the same index.
7. Earlier versions stay available, for example in Git history. An identifier once
   listed therefore stays visible in history, and that is said before anyone agrees to a
   listing.
8. Nothing hashes the index except its own next version. Its layout SHOULD follow section
   5, but `previous_sha256` always covers the exact bytes that were served.

### 8.4 Example (shape only)

```json
{
  "protocol": "transport-hints/v1",
  "document_type": "hints-index",
  "version": 2,
  "previous_sha256": "<64 lowercase hex>",
  "entries": [
    {
      "subject_sha256": "<64 lowercase hex>",
      "name": "transport-hints-example.bin",
      "descriptor_sha256": "<64 lowercase hex>",
      "status": "listed",
      "descriptor_url": "https://example.org/transport/transport-hints-example.bin.transport.json",
      "clearance_sha256": "<64 lowercase hex>",
      "irreversibility_notice_sha256": "<64 lowercase hex>",
      "promise_until": "2027-05-14",
      "torrent": {
        "url": "https://example.org/transport/transport-hints-example.bin.torrent",
        "sha256": "<64 lowercase hex>",
        "url_list": [
          "https://example.org/files/transport-hints-example.bin"
        ]
      },
      "magnet": "magnet:?xt=urn:btih:<40 hex>&xt=urn:btmh:1220<64 hex>&dn=transport-hints-example.bin&ws=https%3A%2F%2Fexample.org%2Ffiles%2Ftransport-hints-example.bin&xs=https%3A%2F%2Fexample.org%2Ftransport%2Ftransport-hints-example.bin.torrent",
      "observations": [
        {
          "at": "2026-12-01",
          "by": "<probe name>",
          "web_seeds": [
            {
              "url": "https://example.org/files/transport-hints-example.bin",
              "status": 206,
              "redirects": 0
            }
          ],
          "peers": "not measured"
        }
      ],
      "other_replicas": []
    },
    {
      "subject_sha256": "<64 lowercase hex>",
      "name": "transport-hints-withdrawn-example.bin",
      "descriptor_sha256": "<64 lowercase hex>",
      "status": "withdrawn",
      "withdrawn_at": "2026-12-02",
      "stopped": [
        "descriptor",
        "torrent file",
        "pointers"
      ],
      "cannot_stop": [
        "peers",
        "caches",
        "mirrors",
        "home copy",
        "rebuilt identical identifiers"
      ]
    }
  ]
}
```

---

## 9. Consumer rule

1. **Parse or ignore.** A consumer SHOULD ignore a descriptor or descriptor set larger
   than 65,536 bytes. A descriptor that fails to parse as JSON, or fails the schema, is
   ignored: none of its fields is used and it is not repaired.
2. **Read the authority.** The consumer reads the authority record as section 4.2 says
   and requires its digest to equal `subject.sha256`. If the record cannot be read or
   disagrees, the descriptor is not used. The consumer MAY still fetch the file through
   the authority record's own routes, without the descriptor. For `none-prior` there is
   no record to read (section 4.2).
3. **Fetch by any route.** An HTTPS mirror named by the authority record, a web seed, or
   a BitTorrent client given the `.torrent`. The route does not matter.
4. **Accept only on size and SHA-256.** The bytes are accepted only if their count equals
   `subject.size` and their SHA-256 equals `subject.sha256`. A matching pieces root,
   `btih`, `btmh` or piece hash, or a client reporting the download complete, is not
   acceptance. Bytes that fail are discarded and the route is reported as bad.

---

## 10. Agent rule

A magnet link or `.torrent` file that reaches an agent from a peer, a document or a tool
result is inert data. No estate client or MCP tool resolves one: none fetches its
metadata or contacts its trackers, DHT, peers or web seeds because of it. An agent MAY
show it to a person as text. Reading a descriptor or an index is likewise inert: it causes
no fetch, install or other network contact by itself.

---

## 11. Withdrawal, supersession and repair

**Withdrawal.** The index entry becomes `withdrawn`, with `withdrawn_at`, `stopped` and
`cannot_stop`. The estate removes its descriptor, its `.torrent` file and every pointer to
them that it controls. Withdrawal cannot stop: peers that already hold the bytes or the
`.torrent`; caches and mirrors; the home copy of the file, which a withdrawal of the
descriptor does not remove; and anyone who holds the bytes, who can rebuild exactly the
same identifiers, because they depend only on the bytes, the name and the piece length.
Every withdrawal says so in `cannot_stop`. Who may carry out a withdrawal, and which
channel counts for a request from outside, is not yet decided (section 13).

**Supersession.** When an identifier was wrong (for example built from the wrong name or
against the profile), the entry becomes `superseded`, with `superseded_at` and
`superseded_by` naming the replacing entry's `descriptor_sha256`. The estate stops serving
the superseded descriptor and `.torrent` as for a withdrawal, and records `stopped` and
`cannot_stop`. The wrong identifiers stay public; supersession only stops the estate
pointing at them. A new descriptor of the same subject that keeps the same identifiers
(for example after an authority URL moved) is also published by supersession.

**Repair.** A dead web seed is repaired by re-issuing the `.torrent` with a new
`url-list`. Both infohashes stay the same, because the `url-list` is outside the info
dictionary. The index records the new `torrent.sha256` and `torrent.url_list` in a new
version. The descriptor does not change.

---

## 12. Security considerations and limits

- **No authority.** The worst a hostile or broken descriptor can do is point a consumer
  at bytes that then fail the SHA-256 check, or at a swarm. A consumer that never uses a
  BitTorrent client loses only bandwidth.
- **Peers see each other.** Every peer in a swarm sees every other peer's address, so any
  seeder or tracker log would hold personal data. The estate runs none (section 2).
- **Egress.** Authority URLs, web seeds, the `.torrent` URL and every redirect are
  untrusted input and are fetched under the caller's egress policy (LOVE section 3.4).
- **Nothing executes.** No document here contains a command. A descriptor never makes a
  file executable, installable or trusted.
- **Names.** The name rule keeps paths, traversal and device names out of the torrent.
  Clients still sanitise names themselves.
- **Swarms.** A swarm with no seed dies; a swarm with a seed cannot be recalled. Neither
  changes what a consumer accepts.
- **Signatures.** No current client was found to check BEP 35 torrent signatures. Debian
  (its page read on 2026-11-14) and, by a search result, Fedora sign a checksums list and
  treat the torrent as untrusted transport. This draft takes the same view and adds no
  signature (section 13).

---

## 13. Status

- **Working Draft 0.1.** The protocol string stays `transport-hints/v1` through the
  drafts. No v1 document of a real file may exist before the freeze, so a change before
  then breaks nothing published.
- **Not frozen.** Freezing the profile (key sets, name rule, piece-length rule and
  `url-list` form) is the owner's decision, to be taken only after the builder's output
  agrees byte for byte with independent hashers on the test vectors (the cross-check of
  section 14.4, on a hosted runner), and after a rehearsal with real clients on pattern
  files. Until then no identifier of any real file
  may be published, and none appears in this repository.
- **Unsigned.** Documents are unsigned. Nothing in `transport-hints/v1` may be called
  signed. A signature format, a key binding and a revocation rule are separate later work
  and the owner's decision.
- **No estate BitTorrent software.** No estate machine runs a BitTorrent client, seeder,
  DHT node or tracker, and no estate code speaks the BitTorrent wire protocol; the builder
  only hashes. By the owner's decision of 2026-11-14, recorded privately and stated here as
  a reading, real BitTorrent clients may run only on GitHub-hosted runners, for short
  tests of the estate's own files. A hosted runner is not an estate machine in this
  sense.
- **Clearance.** By the owner's decision of 2026-11-14, recorded privately and stated here
  as a reading, publishing a descriptor is governed like a permanent upload and is cleared
  one exact file at a time. The rule that clears a file is proposed in the KINGDOM-OS
  repository at publications/IRREVERSIBLE-COPIES.md and publications/replicas/README.md
  (proposed, not yet merged when this draft was written). Until the owner has merged that
  rule and cleared a file under it, no descriptor of that file is published.
- **Open, and the owner's to decide:** which files are described first; where descriptors
  and the index are served; how long a promise runs; who may carry out a withdrawal
  without asking, and which channel counts for requests from outside; whether a second
  profile using BEP 27's `private` flag is wanted (whether web seeds work for such a
  torrent is not established); whether a second web-seed host on another account is
  wanted; and signing.

---

## 14. Test vectors

### 14.1 Pattern files

The builder and every independent hasher MUST generate test files with this function and
no other:

```text
block(seed, k)       = SHA-256( utf8("transport-hints-pattern/v1") || 0x00 || utf8(seed) || 0x00 || uint64be(k) )
pattern(seed, size)  = the first `size` bytes of block(seed, 0) || block(seed, 1) || block(seed, 2) || ...
```

- `||` is concatenation and `0x00` is one zero byte.
- `seed` is 1 to 64 printable ASCII characters (U+0021 to U+007E), so `utf8(seed)` is its
  ASCII bytes.
- `uint64be(k)` is `k` as an 8-byte unsigned big-endian integer.
- `size` is at least 1. `ceil(size / 32)` blocks are computed and the last one is cut
  short.
- Pattern files are generated when needed and never stored or committed. No pattern file
  is a real file of the estate.

### 14.2 The vectors file

[`transport-hints-v1-vectors.json`](transport-hints-v1-vectors.json) is written by
`bin/transport-hints-vectors.ts` (`bun bin/transport-hints-vectors.ts --write`; `--check`
compares). It holds:

- pattern files of 1, 16,384, 16,385 and 46,000 bytes at the profile's 16 KiB pieces;
- at explicit piece lengths of 32 KiB and 1 MiB: a file smaller than one piece (one short
  block at 32 KiB, 7 blocks at 1 MiB), exactly one piece, one piece and one byte, and 3 and
  5 pieces with a short last piece. These test the hashing only; they do not follow
  section 7.3 and are not conforming descriptors;
- for each vector: `name`, `seed`, `size`, a short `case` text, `piece_length` and how it
  was chosen, the numbers of pieces and blocks, `sha256`, the whole `pieces` string and
  the whole piece layer in hexadecimal (`piece_layers` is null when there is no entry),
  `pieces_root`, `btih`, `btmh`, a fixed example `url_list` of two entries, deliberately
  not in sorted order, and the size and SHA-256 of the `.torrent` built with it;
- the example descriptor of section 4.5 as exact text with its `descriptor_sha256`, and the
  SHA-256 of its `.torrent` built with the `url_list` of the example in section 8.4;
- the pad hash (section 7.1.1) for every allowed piece length.

Every pattern file is under 5 MiB, so the vectors are light enough for the ordinary test
run. The file's `status` is `builder-output-unconfirmed`: every value in it is the
builder's own output, confirmed by no independent hasher, until the cross-check of section
14.4 has passed on a GitHub-hosted runner. Changing the status is a separate, later edit.

### 14.3 Placeholders in this draft

Section 4.5 holds the computed values. Section 8.4 still holds placeholders in angle
brackets: an index entry carries digests of a clearance record, an irreversibility notice
and a served `.torrent` file, which no pattern file stands in for. The test requires every
long hexadecimal value in this draft and its schema to appear in the vectors file, so no
other hash can enter the draft.

### 14.4 The cross-check

The workflow `.github/workflows/transport-hints.yml` runs on pull requests that change the
builder, its tests, the vectors, the schema or this draft, and on manual dispatch, which
takes no inputs. It has read-only repository permission and uses no secrets. It:

1. runs the in-tree tests;
2. in a step with network, installs one pinned libtorrent wheel by its SHA-256 and fetches
   the BEP 52 reference creator, checking it against a pinned SHA-256. The script carries
   no licence line, so it is fetched and checked on each run, never copied into this
   repository;
3. removes the network (a separate network namespace, proved empty before any hashing),
   builds the vectors' `.torrent` files twice and compares the bytes, and runs
   `bin/transport-hints-crosscheck.py`. For every vector that script generates the pattern
   file with its own implementation of section 14.1, hashes it with libtorrent's
   `create_torrent` and `set_piece_hashes` (no session) and with the reference creator,
   compares `pieces`, `pieces root`, `piece layers` and, where the other tool's info
   dictionary holds exactly the profile's keys, both infohashes, and parses the builder's
   own `.torrent` with libtorrent's `torrent_info`;
4. uploads the resulting tables as a workflow artifact, and nothing else.

The reference creator always writes an `announce` key and names the torrent after the
file's base name, so whole files are never compared, only fields. For each tool the
script also records whether it writes `piece layers` for a file no larger than one piece.
It runs once per pinned libtorrent version. By the reading in section 13, real BitTorrent
software may run on a hosted runner for short tests of the estate's own files; this step
goes less far, loading libtorrent as a hashing and parsing library only, with no session,
no peer connection and no listening socket.

---

## 15. Conformance and checks

A conforming descriptor or descriptor set:

1. validates against [`transport-hints-v1.schema.json`](transport-hints-v1.schema.json)
   with a Draft 2020-12 validator that asserts formats (the test uses Ajv 2020 in strict
   mode with `ajv-formats`, configured as `bin/build-love-packages.ts` configures it);
2. meets the rules of sections 4.4 and 6; and
3. is in the one serialisation of section 5.

A conforming index validates against the same schema and meets section 8.3.
`bin/tests/transport-hints-schema.test.ts` checks the schema's acceptances and rejections,
the key-order table, the serialisation against an independent serialiser, that the
examples of sections 4.5 and 8.4 validate and use the layout of section 5 (the
placeholders of section 8.4 filled with fake values), the piece-length values of section
7.3, and that this draft holds no hash outside the vectors file and no URL outside example
and reference hosts.

`bin/tests/transport-hints.test.ts` regenerates every pattern file in memory, rebuilds
every vector and compares every field and the whole vectors file with the committed one,
builds twice and compares the bytes, checks the merkle tree against a second construction
written inside the test, checks the profile's key sets, the forbidden keys and the
builder's refusals, validates the example descriptor against the schema and against rules
1, 2, 3, 5 and 8 of section 4.4, checks the probe against a fake fetch, and checks the
shape of the cross-check workflow. It opens no socket. The independent hashers run only in
the cross-check of section 14.4.

---

## 16. References

- BEP 3 (the original BitTorrent protocol and bencoding): https://www.bittorrent.org/beps/bep_0003.html
- BEP 9 (metadata exchange and magnet links): https://www.bittorrent.org/beps/bep_0009.html
- BEP 19, "WebSeed - HTTP/FTP Seeding (GetRight style)" (read 2026-11-14): https://www.bittorrent.org/beps/bep_0019.html
- BEP 27 (private torrents): https://www.bittorrent.org/beps/bep_0027.html
- BEP 47 (padding files): https://www.bittorrent.org/beps/bep_0047.html
- BEP 52, "The BitTorrent Protocol Specification v2", and its reference creator `bep_0052_torrent_creator.py` (both read 2026-11-14): https://www.bittorrent.org/beps/bep_0052.html
- RFC 2119 and RFC 8174, requirement levels: https://www.rfc-editor.org/rfc/rfc8174
- RFC 6901, JSON Pointer: https://www.rfc-editor.org/rfc/rfc6901
- RFC 8785, JSON Canonicalization Scheme: https://www.rfc-editor.org/rfc/rfc8785
- SPDX License List: https://spdx.org/licenses/
- JSON Schema Draft 2020-12: https://json-schema.org/draft/2020-12/schema
- [LOVE package protocol v1](../LOVE-PACKAGE-PROTOCOL.md) and [`love-package-v1.schema.json`](love-package-v1.schema.json)
