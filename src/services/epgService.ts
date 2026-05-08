import { EPGItem } from '../types';

export function parseXMLTV(content: string): EPGItem[] {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(content, 'text/xml');
  const programmes = xmlDoc.getElementsByTagName('programme');
  const items: EPGItem[] = [];

  for (let i = 0; i < programmes.length; i++) {
    const p = programmes[i];
    const channelId = p.getAttribute('channel') || '';
    const start = p.getAttribute('start') || '';
    const stop = p.getAttribute('stop') || '';
    const title = p.getElementsByTagName('title')[0]?.textContent || '';
    const description = p.getElementsByTagName('desc')[0]?.textContent || '';

    items.push({
      channelId,
      start,
      stop,
      title,
      description,
    });
  }

  return items;
}

export async function fetchEPG(url: string): Promise<EPGItem[]> {
  try {
    const response = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch EPG via proxy: ${response.status} ${errorText.substring(0, 50)}`);
    }
    const text = await response.text();
    return parseXMLTV(text);
  } catch (error) {
    console.error('Error fetching EPG:', error);
    throw error;
  }
}

// Utility to format XMLTV time (e.g., 20231027120000 +0000) to JS Date
export function parseXMLTVDate(dateStr: string): Date {
  if (!dateStr || dateStr.length < 12) return new Date();
  try {
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1;
    const day = parseInt(dateStr.substring(6, 8));
    const hour = parseInt(dateStr.substring(8, 10));
    const minute = parseInt(dateStr.substring(10, 12));
    const second = dateStr.length >= 14 ? parseInt(dateStr.substring(12, 14)) : 0;
    
    // Most XMLTV dates are already in fixed offset, we'll use UTC for stability
    const date = new Date(Date.UTC(year, month, day, hour, minute, second));
    return isNaN(date.getTime()) ? new Date() : date;
  } catch {
    return new Date();
  }
}
