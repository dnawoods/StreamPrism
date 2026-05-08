export interface IPTVChannel {
  id: string;
  name: string;
  logo: string;
  group: string;
  url: string;
  tvgId: string;
}

export interface EPGItem {
  start: string;
  stop: string;
  title: string;
  description: string;
  channelId: string;
}

export interface IPTVPlaylist {
  name: string;
  channels: IPTVChannel[];
  groups: string[];
  epgUrl?: string;
}

export interface ParentalControl {
  enabled: boolean;
  pin: string;
  lockedGroups: string[];
}

export interface AppSettings {
  playlistUrl: string;
  epgUrl: string;
  useProxy?: boolean;
  proxyStreams?: boolean;
  lastChannelId?: string;
  favorites: string[]; // List of channel IDs
  parentalControl: ParentalControl;
}
