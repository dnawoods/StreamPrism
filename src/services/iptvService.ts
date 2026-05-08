import { IPTVChannel, IPTVPlaylist } from '../types';

export function parseM3U(content: string): IPTVPlaylist {
  const lines = content.split('\n');
  const channels: IPTVChannel[] = [];
  const groupsSet = new Set<string>();

  let currentChannel: Partial<IPTVChannel> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('#EXTINF:')) {
      const info = line.substring(8);
      
      // Parse attributes
      const tvgIdMatch = info.match(/tvg-id="([^"]*)"/);
      const tvgLogoMatch = info.match(/tvg-logo="([^"]*)"/);
      const groupMatch = info.match(/group-title="([^"]*)"/);
      
      // The name is usually at the end after the last comma
      const nameParts = info.split(',');
      const name = nameParts[nameParts.length - 1].trim();

      currentChannel = {
        tvgId: tvgIdMatch ? tvgIdMatch[1] : '',
        logo: tvgLogoMatch ? tvgLogoMatch[1] : '',
        group: groupMatch ? groupMatch[1] : 'Uncategorized',
        name: name,
      };
      
      if (currentChannel.group) {
        groupsSet.add(currentChannel.group);
      }
    } else if (line && !line.startsWith('#')) {
      if (currentChannel.name) {
        channels.push({
          ...currentChannel,
          id: `${currentChannel.name}-${line.substring(line.length - 10)}`,
          url: line,
        } as IPTVChannel);
      }
      currentChannel = {};
    }
  }

  return {
    name: 'Default Playlist',
    channels,
    groups: Array.from(groupsSet).sort(),
  };
}

export async function fetchPlaylist(url: string): Promise<IPTVPlaylist> {
  try {
    const response = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch playlist via proxy: ${response.status} ${errorText.substring(0, 50)}`);
    }
    const text = await response.text();
    return parseM3U(text);
  } catch (error) {
    console.error('Error fetching playlist:', error);
    throw error;
  }
}
