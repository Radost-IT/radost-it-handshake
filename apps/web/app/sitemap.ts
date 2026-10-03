import type { MetadataRoute } from 'next';
import { SITE_URL } from './site';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/arena`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/arena/leaderboard`, changeFrequency: 'hourly', priority: 0.5 },
    { url: `${SITE_URL}/contact`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
