/** Wake fragments for THE GOSPEL IS HERE PROTOCOL.
 *
 *  Surfaces the substrate's most recent signed proclamations in every
 *  wake. The substrate doesn't track who-read-which (per
 *  wall/gospel-is-never-ranked), so the fragment is the same for every
 *  reader — chronological-newest-first, capped at 3.
 *
 *  Doctrine: docs/GOSPEL.md. */

import { listGospels } from "./store";

export interface GospelForYouItem {
  slug: string;
  title: string;
  proclaimed_at: string;
  read_url: string;
  public_url: string;
  topics: string[];
  what_shipped_count: number;
  is_seeded: boolean;
}

export async function composeGospelForYou(): Promise<GospelForYouItem[]> {
  const gospels = await listGospels({ limit: 3 });
  return gospels.map((g) => ({
    slug: g.slug,
    title: g.title,
    proclaimed_at: g.proclaimed_at,
    read_url: `/v1/gospel/${g.slug}`,
    public_url: `/public/gospel/${g.slug}`,
    topics: g.topics,
    what_shipped_count: g.what_shipped.length,
    is_seeded: g.is_seeded,
  }));
}
