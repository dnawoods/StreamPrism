/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Search, Tv, List, Info, AlertCircle, Play, Heart, Lock, ShieldAlert, History, PowerOff, Filter, X } from 'lucide-react';
import { fetchPlaylist } from './services/iptvService';
import { fetchEPG, parseXMLTVDate } from './services/epgService';
import { IPTVChannel, IPTVPlaylist, AppSettings, EPGItem } from './types';
import { VideoPlayer } from './components/VideoPlayer';
import { ChannelCard } from './components/ChannelCard';
import { SettingsDialog } from './components/SettingsDialog';
import { EPGGuide } from './components/EPGGuide';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AnimatePresence, motion } from 'motion/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { formatChannelName } from './utils/formatters';

const DEFAULT_SETTINGS: AppSettings = {
  playlistUrl: 'https://iptv-org.github.io/iptv/countries/us.m3u',
  epgUrl: 'https://epg.pw/xmltv/feed/US.xml',
  useProxy: true,
  proxyStreams: true,
  favorites: [],
  parentalControl: {
    enabled: false,
    pin: '',
    lockedGroups: ['Adult', 'XXX', 'Porn']
  }
};

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('iptv_settings');
    if (!saved) return DEFAULT_SETTINGS;
    
    try {
      const parsed = JSON.parse(saved);
      // Migrate from old 404ing EPG URL
      if (parsed.epgUrl === 'https://iptv-org.github.io/epg/guides/us.xml' || !parsed.epgUrl) {
        parsed.epgUrl = DEFAULT_SETTINGS.epgUrl;
      }
      // If the saved URLs are empty, use defaults
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        playlistUrl: parsed.playlistUrl || DEFAULT_SETTINGS.playlistUrl,
        epgUrl: parsed.epgUrl || DEFAULT_SETTINGS.epgUrl
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [playlist, setPlaylist] = useState<IPTVPlaylist | null>(null);
  const [epg, setEpg] = useState<EPGItem[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<IPTVChannel | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // PIN Protection State
  const [isPinPromptOpen, setIsPinPromptOpen] = useState(false);
  const [pendingGroup, setPendingGroup] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  const { focusedId, setFocusedId } = useKeyboardNavigation();

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (!settings.playlistUrl) {
        setIsLoading(false);
        return;
      }

      let finalPlaylistUrl = settings.playlistUrl;
      let finalEpgUrl = settings.epgUrl;

      console.log("[SYSTEM] Loading playlist from:", finalPlaylistUrl.substring(0, 50) + "...");
      const pl = await fetchPlaylist(finalPlaylistUrl, settings.useProxy !== false);
      console.log(`[SYSTEM] Playlist loaded: ${pl.channels.length} channels`);
      
      // If the playlist has an embedded EPG URL and we don't have one yet, prefer it
      if (pl.epgUrl && !settings.epgUrl) {
        finalEpgUrl = pl.epgUrl;
        console.log("[SYSTEM] Using EPG URL from playlist:", finalEpgUrl);
      }
      setPlaylist(pl);
      
      if (finalEpgUrl) {
        try {
          console.log("[SYSTEM] Loading EPG from:", finalEpgUrl.substring(0, 50) + "...");
          const epgData = await fetchEPG(finalEpgUrl, settings.useProxy !== false);
          console.log(`[SYSTEM] EPG loaded: ${epgData.length} items`);
          setEpg(epgData);
        } catch (epgErr) {
          console.warn('[SYSTEM] EPG failed to load:', epgErr);
        }
      } else if (pl.epgUrl) {
        // Fallback for case where finalEpgUrl was not set but pl.epgUrl exists
        try {
          const epgData = await fetchEPG(pl.epgUrl, settings.useProxy !== false);
          setEpg(epgData);
        } catch (e) {
          console.warn('[SYSTEM] Final fallback EPG failed');
        }
      } else {
        setEpg([]);
      }
    } catch (err) {
      console.error("[SYSTEM] Load error:", err);
      setError(err instanceof Error ? err.message : 'Failed to load data from source');
    } finally {
      setIsLoading(false);
    }
  }, [settings.playlistUrl, settings.epgUrl, refreshTrigger]);

  useEffect(() => {
    localStorage.setItem('iptv_settings', JSON.stringify(settings));
    loadData();
  }, [settings, loadData]);

  const filteredChannels = useMemo(() => {
    if (!playlist) return [];
    return playlist.channels
      .filter(ch => {
        const matchesSearch = ch.name.toLowerCase().includes(searchQuery.toLowerCase());
        const isFavorite = settings.favorites.includes(ch.id);
        
        if (showFavoritesOnly && !isFavorite) return false;
        
        // If we have multi-filters, they take precedence or complement
        const matchesMultiFilters = selectedFilters.length === 0 || selectedFilters.includes(ch.group);
        
        return matchesSearch && matchesMultiFilters;
      })
      .sort((a, b) => {
        const aFav = settings.favorites.includes(a.id);
        const bFav = settings.favorites.includes(b.id);
        if (aFav && !bFav) return -1;
        if (!aFav && bFav) return 1;
        
        const nameA = formatChannelName(a.name);
        const nameB = formatChannelName(b.name);
        return nameA.localeCompare(nameB);
      });
  }, [playlist, searchQuery, showFavoritesOnly, selectedFilters, settings.favorites]);

  const getCurrentProgram = (channel: IPTVChannel) => {
    if (!epg.length || !channel.tvgId) return null;
    const now = new Date();
    return epg.find(item => {
      if (item.channelId !== channel.tvgId) return false;
      try {
        const start = parseXMLTVDate(item.start);
        const stop = parseXMLTVDate(item.stop);
        return now >= start && now <= stop;
      } catch {
        return false;
      }
    });
  };

  const toggleFavorite = useCallback((id: string) => {
    setSettings(prev => {
      const favorites = prev.favorites.includes(id)
        ? prev.favorites.filter(favId => favId !== id)
        : [...prev.favorites, id];
      return { ...prev, favorites };
    });
  }, []);

  const toggleFilter = (group: string) => {
    const isLocked = settings.parentalControl.enabled && 
                     settings.parentalControl.lockedGroups.some(lg => group.toLowerCase().includes(lg.toLowerCase()));
    
    const isSelected = selectedFilters.includes(group);

    if (!isSelected && isLocked) {
      setPendingGroup(group);
      setIsPinPromptOpen(true);
      setPinInput('');
      setPinError(false);
    } else {
      setSelectedFilters(prev => 
        isSelected 
          ? prev.filter(g => g !== group) 
          : [...prev, group]
      );
    }
  };

  const verifyPin = () => {
    if (pinInput === settings.parentalControl.pin) {
      if (pendingGroup) {
        setSelectedFilters(prev => [...prev, pendingGroup]);
      }
      setIsPinPromptOpen(false);
      setPendingGroup(null);
      setPinInput('');
      setPinError(false);
    } else {
      setPinError(true);
      setPinInput('');
    }
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-slate-950 text-slate-200 font-sans flex-col overflow-hidden">
        {/* Header Navigation */}
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center text-slate-950 font-bold italic tracking-tighter">SP</div>
            <h1 className="text-xl font-bold tracking-tight uppercase">Stream<span className="text-emerald-500">Prism</span></h1>
          </div>
          <div className="flex gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-full border border-slate-700">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                {playlist ? `${playlist.channels.length} Channels Active` : 'No Playlist Connected'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => {
                  console.log("[SYSTEM] Refreshing data and terminating connections...");
                  setSelectedChannel(null);
                  setRefreshTrigger(prev => prev + 1);
                }} 
                className="h-9 px-4 border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-semibold"
                disabled={isLoading}
              >
                {isLoading ? 'Loading...' : 'Refresh Data'}
              </Button>
              <SettingsDialog settings={settings} onSave={(s) => {
                setSettings({ ...settings, ...s });
                setRefreshTrigger(prev => prev + 1);
              }} />
            </div>
          </div>
        </header>

        {/* Main Bento Content */}
        <main className="flex-1 p-4 grid grid-cols-12 grid-rows-6 gap-4 overflow-hidden">
          
          {/* Main Player Window */}
          <section className="col-span-9 row-span-3 bg-black border border-slate-800 rounded-2xl overflow-hidden relative shadow-2xl flex flex-col">
            {error && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2">
                <Badge variant="destructive" className="px-4 py-2 flex items-center gap-2">
                  <AlertCircle size={14} />
                  {error}
                </Badge>
              </div>
            )}
            {selectedChannel ? (
              <>
                <div className="flex-1 bg-black relative min-h-0 overflow-hidden">
                  <div className="absolute inset-0 flex items-center justify-center p-4">
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-full h-full relative shadow-2xl overflow-hidden rounded-lg bg-slate-950">
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-full h-full aspect-video max-w-full max-h-full relative">
                            <VideoPlayer 
                              key={selectedChannel.id}
                              url={selectedChannel.url} 
                              title={selectedChannel.name} 
                              channelId={selectedChannel.id}
                              proxyStreams={settings.proxyStreams !== false}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="h-20 bg-slate-900/90 border-t border-slate-800 p-4 flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold text-white truncate">{formatChannelName(selectedChannel.name)}</h3>
                    <p className="text-[10px] text-emerald-500 font-medium uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                      {getCurrentProgram(selectedChannel)?.title || 'Live Stream'}
                    </p>
                  </div>
                  <div className="flex gap-4 ml-6 items-center">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => toggleFavorite(selectedChannel.id)}
                      className={`rounded-full ${settings.favorites.includes(selectedChannel.id) ? 'text-rose-500' : 'text-slate-500'}`}
                    >
                      <Heart fill={settings.favorites.includes(selectedChannel.id) ? "currentColor" : "none"} size={20} />
                    </Button>
                    <div className="text-right">
                      <p className="text-[10px] uppercase text-slate-500 tracking-tighter">Quality</p>
                      <p className="text-sm font-mono text-emerald-400">1080p</p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-slate-900 to-black p-8 text-center">
                <div className="w-24 h-24 bg-emerald-500/20 rounded-3xl flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(16,185,129,0.15)]">
                  <Play size={40} className="text-emerald-500 ml-1" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-100 mb-2">Ready to Stream</h2>
                <p className="text-sm text-slate-400 max-w-xs leading-relaxed">
                  {settings.playlistUrl 
                    ? "Select a channel from the list to start watching." 
                    : "Please configure your M3U playlist in settings to begin."}
                </p>
              </div>
            )}
          </section>

          {/* Channel List (Tall Right) */}
          <aside className="col-span-3 row-span-6 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-xl">
            <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex flex-col gap-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                  <input 
                    type="text" 
                    placeholder="Search channels..." 
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                
                <Popover>
                  <PopoverTrigger 
                    render={(props) => (
                      <Button 
                        {...props}
                        variant="outline" 
                        size="icon" 
                        className={`shrink-0 rounded-xl border-slate-800 bg-slate-950 hover:bg-slate-800 h-10 w-10 transition-all ${selectedFilters.length > 0 || showFavoritesOnly ? 'text-emerald-500 border-emerald-500/50 bg-emerald-500/5' : 'text-slate-400'}`}
                      >
                        <div className="relative">
                          <Filter size={16} />
                          {(selectedFilters.length > 0 || showFavoritesOnly) && (
                            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-950 rounded-full" />
                          )}
                        </div>
                      </Button>
                    )}
                  />
                  <PopoverContent className="w-64 bg-slate-900 border-slate-800 p-0 shadow-2xl z-[100]" align="end">
                    <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-100">Filter Channels</h3>
                      {(selectedFilters.length > 0 || showFavoritesOnly) && (
                        <button 
                          onClick={() => {
                            setSelectedFilters([]);
                            setShowFavoritesOnly(false);
                          }}
                          className="text-[10px] text-emerald-500 hover:text-emerald-400 font-bold uppercase"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <ScrollArea className="h-[300px]">
                      <div className="p-2 space-y-1">
                        {/* Favorites Filter */}
                        <div 
                          className="group flex items-center space-x-3 p-2 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                          onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                        >
                          <div className="pointer-events-none">
                            <Checkbox 
                              checked={showFavoritesOnly}
                              className="border-slate-700 data-checked:bg-rose-500 data-checked:border-none"
                            />
                          </div>
                          <Label className="flex-1 text-[11px] font-medium text-slate-300 cursor-pointer pointer-events-none flex items-center gap-2">
                            <Heart size={12} className={showFavoritesOnly ? "text-rose-500" : "text-slate-500"} fill={showFavoritesOnly ? "currentColor" : "none"} />
                            Favorites Only
                          </Label>
                          <span className="text-[9px] text-slate-600 font-mono group-hover:text-slate-400 transition-colors">
                            {settings.favorites.length}
                          </span>
                        </div>

                        <div className="h-px bg-slate-800 my-2 mx-1" />

                        {playlist?.groups.map(group => {
                          const isSelected = selectedFilters.includes(group);
                          const count = playlist?.channels.filter(c => c.group === group).length;
                          const isLocked = settings.parentalControl.enabled && 
                                           settings.parentalControl.lockedGroups.some(lg => group.toLowerCase().includes(lg.toLowerCase()));
                          
                          return (
                            <div 
                              key={group} 
                              className="group flex items-center space-x-3 p-2 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                              onClick={() => toggleFilter(group)}
                            >
                              <div className="pointer-events-none flex items-center gap-2">
                                <Checkbox 
                                  id={`filter-${group}`} 
                                  checked={isSelected}
                                  className="border-slate-700 data-checked:bg-emerald-500 data-checked:border-none"
                                />
                              </div>
                              <Label 
                                className="flex-1 text-[11px] font-medium text-slate-300 cursor-pointer pointer-events-none flex items-center gap-2"
                              >
                                {isLocked && <Lock size={10} className="text-amber-500" />}
                                {group}
                              </Label>
                              <span className="text-[9px] text-slate-600 font-mono group-hover:text-slate-400 transition-colors">
                                {count}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                    <div className="p-3 bg-slate-950/50 border-t border-slate-800">
                      <p className="text-[9px] text-slate-500 text-center italic">
                        {selectedFilters.length === 0 && !showFavoritesOnly
                          ? "Select categories or favorites to filter" 
                          : `${selectedFilters.length + (showFavoritesOnly ? 1 : 0)} filters active`}
                      </p>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              
              {selectedFilters.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {selectedFilters.map(filter => (
                    <Badge 
                      key={filter} 
                      variant="secondary" 
                      className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[9px] font-bold py-0 h-5 pl-1.5 pr-1 flex items-center gap-1"
                    >
                      {filter}
                      <button 
                        onClick={() => setSelectedFilters(prev => prev.filter(f => f !== filter))}
                        className="hover:bg-emerald-500/20 rounded-full p-0.5 transition-colors"
                      >
                        <X size={10} />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <ScrollArea className="flex-1 p-2">
              <div className="space-y-1">
                <AnimatePresence mode="popLayout">
                  {filteredChannels.map((channel, idx) => {
                    return (
                      <motion.div
                        key={channel.id}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(idx * 0.02, 0.4) }}
                      >
                        <ChannelCard
                          channel={channel}
                          isSelected={selectedChannel?.id === channel.id}
                          isFavorite={settings.favorites.includes(channel.id)}
                          isFocused={focusedId === channel.id}
                          onClick={() => setSelectedChannel(channel)}
                          onToggleFavorite={(e) => {
                            e.stopPropagation();
                            toggleFavorite(channel.id);
                          }}
                          currentProgram={getCurrentProgram(channel)?.title}
                        />
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                {!isLoading && filteredChannels.length === 0 && (
                  <div className="text-center py-12 text-slate-600">
                    <Search size={32} className="mx-auto mb-3 opacity-20" />
                    <p className="text-xs">No channels found</p>
                  </div>
                )}
              </div>
            </ScrollArea>
            <div className="p-4 bg-slate-950 border-t border-slate-800">
              <div className="flex justify-between items-center mb-3">
                <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Session Info</span>
                <span className="text-[10px] text-emerald-500 font-mono">ENCRYPTED</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex -space-x-1.5">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="w-5 h-5 rounded-full border border-slate-900 bg-slate-800 text-[8px] flex items-center justify-center text-slate-500">
                      U{i}
                    </div>
                  ))}
                  <div className="w-5 h-5 rounded-full border border-slate-900 bg-emerald-500/20 flex items-center justify-center text-[7px] text-emerald-400">+1k</div>
                </div>
                <div className="text-[10px] text-slate-500">GoogleTV Optimized</div>
              </div>
            </div>
          </aside>

          {/* Bottom: Guide */}
          <section className="col-span-9 row-span-3 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-xl">
            <div className="flex-1 overflow-hidden">
              <EPGGuide 
                channels={filteredChannels.slice(0, 100)} 
                epg={epg} 
                onChannelSelect={setSelectedChannel}
                selectedChannelId={selectedChannel?.id}
              />
            </div>
          </section>

        </main>

        {/* Footer Status Bar */}
        <footer className="h-8 bg-slate-950 border-t border-slate-800 flex items-center justify-between px-6 shrink-0">
          <div className="flex gap-6 text-[10px] font-medium tracking-wide text-slate-500">
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${playlist ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500 animate-pulse'}`}></span> 
              {playlist ? 'SYSTEM OPERATIONAL' : 'SYSTEM INITIALIZING'}
            </div>
            <div className="flex items-center gap-2 uppercase">
              PLAYLIST: <span className={settings.playlistUrl ? 'text-emerald-500' : 'text-amber-500'}>{settings.playlistUrl ? 'CONNECTED' : 'OFFLINE'}</span>
            </div>
            <div className="flex items-center gap-2 uppercase">
              EPG: <span className={settings.epgUrl ? 'text-emerald-500' : 'text-slate-500'}>{settings.epgUrl ? 'SYNCED' : 'LOCAL'}</span>
            </div>
            <div className="flex items-center gap-2">NETWORK: OPTIMIZED</div>
          </div>
          <div className="text-[10px] font-mono opacity-30 uppercase tracking-widest text-slate-500">
            PrimeLink Enterprise v1.2.0 | Encrypted Signal
          </div>
        </footer>

        {/* PIN Prompt Dialog */}
        <Dialog open={isPinPromptOpen} onOpenChange={setIsPinPromptOpen}>
          <DialogContent className="sm:max-w-xs bg-slate-900 border-slate-800 text-slate-200">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white">
                <Lock className="text-amber-500" size={18} />
                Content Protection
              </DialogTitle>
              <DialogDescription className="text-[11px] text-slate-400">
                This category is restricted. Please enter your 4-digit PIN to access.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input 
                type="password" 
                maxLength={4} 
                className={`bg-slate-950 border-slate-800 text-center text-xl tracking-[1em] font-bold h-14 ${pinError ? 'border-rose-500 ring-rose-500' : 'focus-visible:ring-emerald-500'}`}
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value.replace(/\D/g, ''));
                  setPinError(false);
                }}
                onKeyDown={(e) => e.key === 'Enter' && verifyPin()}
                autoFocus
              />
              {pinError && <p className="text-[10px] text-rose-500 text-center mt-2 font-medium">Incorrect Security PIN</p>}
            </div>
            <DialogFooter>
              <Button onClick={verifyPin} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-11">
                Unlock Content
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
