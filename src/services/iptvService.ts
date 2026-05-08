import { IPTVChannel, IPTVPlaylist } from '../types';

export function parseM3U(content: string): IPTVPlaylist {
  const lines = content.split(/\r?\n/);
  const channels: IPTVChannel[] = [];
  const groupsSet = new Set<string>();
  let epgUrl = '';

  let currentGroup = 'Uncategorized';
  let currentChannel: Partial<IPTVChannel> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('#EXTM3U')) {
      const epgMatch = line.match(/url-tvg="([^"]*)"/) || 
                       line.match(/x-tvg-url="([^"]*)"/) ||
                       line.match(/tvg-url="([^"]*)"/);
      if (epgMatch) {
        epgUrl = epgMatch[1];
      }
    } else if (line.startsWith('#EXTINF:')) {
      const info = line.substring(8);
      
      // Parse attributes
      const tvgIdMatch = info.match(/tvg-id="([^"]*)"/);
      const tvgLogoMatch = info.match(/tvg-logo="([^"]*)"/);
      const groupMatch = info.match(/group-title="([^"]*)"/);
      
      // The name is usually at the end after the last comma
      const lastCommaIndex = info.lastIndexOf(',');
      const name = lastCommaIndex !== -1 ? info.substring(lastCommaIndex + 1).trim() : 'Unknown Channel';

      currentChannel = {
        tvgId: tvgIdMatch ? tvgIdMatch[1] : '',
        logo: tvgLogoMatch ? tvgLogoMatch[1] : '',
        group: groupMatch ? groupMatch[1] : '', // temp empty, will fallback to currentGroup
        name: name,
      };
    } else if (line.startsWith('#EXTGRP:')) {
      currentGroup = line.substring(8).trim();
      if (currentChannel.name) {
        currentChannel.group = currentGroup;
      }
    } else if (line && !line.startsWith('#')) {
      if (currentChannel.name) {
        const group = currentChannel.group || currentGroup || 'Uncategorized';
        channels.push({
          ...currentChannel,
          group,
          id: `${currentChannel.name}-${channels.length}-${line.substring(line.length - 10)}`,
          url: line,
        } as IPTVChannel);
        groupsSet.add(group);
      }
      currentChannel = {};
      // We don't reset currentGroup because it might apply to multiple channels
    }
  }

  return {
    name: 'Default Playlist',
    channels,
    groups: Array.from(groupsSet).sort(),
    epgUrl
  };
}

export async function fetchPlaylist(url: string, useProxy: boolean = true): Promise<IPTVPlaylist> {
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
    console.log(`[SERVICE] Fetching playlist: ${useProxy ? 'via proxy' : 'direct'}`);
    
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server responded with ${response.status}: ${errorText.substring(0, 100)}`);
    }
    const text = await response.text();
    return parseM3U(text);
  } catch (error) {
    console.error('Error fetching playlist:', error);
    if (error instanceof TypeError) {
      if (!useProxy) {
        throw new Error('Load failed (Direct Access). This is likely a CORS restriction. Please enable "Network Proxy" in settings.');
      }
      throw new Error(`Network error (Proxy): Check your internet connection or the server availability. (${error.message})`);
    }
    throw error;
  }
}
