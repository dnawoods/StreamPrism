import { EPGItem } from '../types';

export function parseXMLTV(content: string): EPGItem[] {
  let sanitizedContent = content.trim();
  if (!sanitizedContent) {
    console.warn("[EPG] Empty EPG content received");
    return [];
  }
  
  // Remove ALL XML declarations from the content. 
  // They are only valid at the very start of an XML document.
  // Since we are wrapping the content, any existing declaration would be invalid.
  sanitizedContent = sanitizedContent.replace(/<\?xml.*?\?>/g, '');

  // Fix unescaped ampersands which are extremely common in IPTV EPGs
  sanitizedContent = sanitizedContent.replace(/&(?!(amp|lt|gt|quot|apos);|#)/g, '&amp;');

  // Truncation protection: Many IPTV providers return truncated XML.
  // We find the last complete fundamental tag to avoid "mismatch" errors at the end.
  const lastProgramEnd = sanitizedContent.lastIndexOf('</programme>');
  const lastChannelEnd = sanitizedContent.lastIndexOf('</channel>');
  const lastTvEnd = sanitizedContent.lastIndexOf('</tv>');
  
  const lastValidIndex = Math.max(
    lastProgramEnd !== -1 ? lastProgramEnd + 12 : 0, 
    lastChannelEnd !== -1 ? lastChannelEnd + 10 : 0,
    lastTvEnd !== -1 ? lastTvEnd + 5 : 0
  );
  
  if (lastValidIndex > 0) {
    sanitizedContent = sanitizedContent.substring(0, lastValidIndex);
  }

  // Wrap the content to ensure it has a single root element and avoid "extra content at end" errors
  const wrapContent = `<?xml version="1.0" encoding="UTF-8"?><epg_wrapper>${sanitizedContent}</epg_wrapper>`;
  
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(wrapContent, 'text/xml');
  
  // Check for parsing errors
  const parserError = xmlDoc.getElementsByTagName('parsererror');
  if (parserError.length > 0) {
    console.error("[EPG] XML Parsing Error:", parserError[0].textContent);
    
    // If wrapping failed, try parsing the original as a fallback
    // (sometimes the wrapper itself might cause issues if the content is very weird)
    const fallbackDoc = parser.parseFromString(sanitizedContent, 'text/xml');
    const fallbackError = fallbackDoc.getElementsByTagName('parsererror');
    if (fallbackError.length === 0) {
      return processDoc(fallbackDoc);
    }
    return [];
  }

  return processDoc(xmlDoc);
}

function processDoc(xmlDoc: Document): EPGItem[] {
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
