---
title: KINGDOM Dark Continent Cartographer
emoji: 🗺️
colorFrom: purple
colorTo: gray
sdk: gradio
sdk_version: 6.21.0
python_version: "3.12"
app_file: app.py
license: apache-2.0
short_description: Read-only provenance and risk-gate viewer for KINGDOM.
suggested_hardware: cpu-basic
---

# KINGDOM Dark Continent Cartographer

![Cartographer observatory artwork](assets/hero-web.webp)

Read-only explorer for the commit-pinned metadata in
[`Yu-and-Ai/kingdom-dark-continent-karma`](https://huggingface.co/datasets/Yu-and-Ai/kingdom-dark-continent-karma).

The Space loads two small bundled JSONL files, verifies their exact SHA-256
values, and then offers phase/cabinet filters, record inspection, and a bounded
comparison view. It performs no runtime network read and requires no token.

It cannot download upstream rows, accept gates, call a model, execute tools,
mutate a graph, merge, publish, award XP/reward, authorize, trade, or crown.
Every Dark Continent wall remains `not_checked`, every risk state remains
`unknown`, and every recommendation remains `hold`.

Browser use comes first. MCP is intentionally disabled in v0.1 while the
read-only function schemas receive separate review.

The web hero is a generated visual derivative made for this release. It is not
research evidence, a map of a real place, or a claim that any wall works.
