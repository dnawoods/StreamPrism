import { EPGItem } from '../types';

export function parseXMLTV(content: string): EPGItem[] {
  const sanitizedContent = content.trim();
  if (!sanitizedContent) {
    console.warn("[EPG] Empty EPG content received");
    return [];
  }
  
  const parser = new DOMParser();
  // Basic check if it even looks like XML
  if (!sanitizedContent.includes('<') || !sanitizedContent.includes('>')) {
    console.warn("[EPG] Content does not look like XML");
    return [];
  }
  
  const xmlDoc = parser.parseFromString(sanitizedContent, 'text/xml');
  
  // Check for parsing errors
  const parserError = xmlDoc.getElementsByTagName('parsererror');
  if (parserError.length > 0) {
    console.error("[EPG] XML Parsing Error:", parserError[0].textContent);
    // Try to recover or just return empty
    return [];
  }

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

export async function fetchEPG(url: string, useProxy: boolean = true): Promise<EPGItem[]> {
  try {
    let fetchUrl = url;
    if (useProxy) {
      try {
        const b64 = btoa(unescape(encodeURIComponent(url)));
        fetchUrl = `/api/proxy?b64=${encodeURIComponent(b64)}`;
      } catch (e) {
        fetchUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
      }
    }
    console.log(`[SERVICE] Fetching EPG: ${useProxy ? 'via proxy' : 'direct'}`);
    
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server responded with ${response.status}: ${errorText.substring(0, 100)}`);
    }
    const text = await response.text();
    
    // Check if it's an HTML error page masquerading as EPG
    if (text.includes('<html') || text.includes('<!DOCTYPE html')) {
      console.warn("[EPG] Received HTML instead of XML. Likely an error page.");
      return [];
    }
    
    return parseXMLTV(text);
  } catch (error) {
    console.error('Error fetching EPG:', error);
    if (error instanceof TypeError) {
      if (!useProxy) {
        throw new Error('EPG Load failed (Direct). CORS restriction likely. Enable proxy in settings.');
      }
      throw new Error(`EPG Network error (Proxy): ${error.message}`);
    }
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
