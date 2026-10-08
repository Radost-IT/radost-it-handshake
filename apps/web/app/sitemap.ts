import type { MetadataRoute } from 'next';
import { SCREENSHOTS, screenshotUrl, SITE_URL } from './site';

function screenshotUrls(...files: string[]): string[] {
  return SCREENSHOTS.filter((shot) => files.length === 0 || files.includes(shot.file)).map(
    (shot) => `${SITE_URL}${screenshotUrl(shot.file)}`,
  );
}

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1, images: screenshotUrls() },
    {
      url: `${SITE_URL}/arena`,
      changeFrequency: 'daily',
      priority: 0.8,
      images: screenshotUrls('09-red-team-lab', '10-attack-held'),
    },
    { url: `${SITE_URL}/arena/leaderboard`, changeFrequency: 'hourly', priority: 0.5 },
    {
      url: `${SITE_URL}/evals`,
      changeFrequency: 'weekly',
      priority: 0.6,
      images: screenshotUrls('11-evals'),
    },
    { url: `${SITE_URL}/merchants`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/request-access`, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${SITE_URL}/contact`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
