/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Search, Tv, List, Info, AlertCircle, Play, Heart, Video, Lock, ShieldAlert, History } from 'lucide-react';
import { fetchPlaylist } from './services/iptvService';
import { fetchEPG, parseXMLTVDate } from './services/epgService';
import { IPTVChannel, IPTVPlaylist, AppSettings, EPGItem, Recording } from './types';
import { VideoPlayer } from './components/VideoPlayer';
import { ChannelCard } from './components/ChannelCard';
import { SettingsDialog } from './components/SettingsDialog';
import { EPGGuide } from './components/EPGGuide';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AnimatePresence, motion } from 'motion/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const DEFAULT_SETTINGS: AppSettings = {
  playlistUrl: 'https://iptv-org.github.io/iptv/countries/us.m3u',
  epgUrl: 'https://epg.pw/xmltv/feed/US.xml',
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
  const [recordings, setRecordings] = useState<Recording[]>(() => {
    const saved = localStorage.getItem('iptv_recordings');
    return saved ? JSON.parse(saved) : [];
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('All');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // PIN Protection State
  const [isPinPromptOpen, setIsPinPromptOpen] = useState(false);
  const [pendingGroup, setPendingGroup] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  const { focusedId, setFocusedId } = useKeyboardNavigation();

  useEffect(() => {
    localStorage.setItem('iptv_settings', JSON.stringify(settings));
    if (settings.playlistUrl) {
      loadData();
    }
  }, [settings.playlistUrl, settings.epgUrl, refreshTrigger]);

  useEffect(() => {
    localStorage.setItem('iptv_recordings', JSON.stringify(recordings));
  }, [recordings]);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const pl = await fetchPlaylist(settings.playlistUrl);
      setPlaylist(pl);
      
      if (settings.epgUrl) {
        try {
          const epgData = await fetchEPG(settings.epgUrl);
          setEpg(epgData);
        } catch (epgErr) {
          console.warn('EPG failed to load (ignoring):', epgErr);
        }
      } else {
        setEpg([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load playlist');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredChannels = useMemo(() => {
    if (!playlist) return [];
    return playlist.channels.filter(ch => {
      const matchesSearch = ch.name.toLowerCase().includes(searchQuery.toLowerCase());
      const isFavorite = settings.favorites.includes(ch.id);
      
      if (selectedGroup === 'Favorites') return matchesSearch && isFavorite;
      const matchesGroup = selectedGroup === 'All' || ch.group === selectedGroup;
      return matchesSearch && matchesGroup;
    });
  }, [playlist, searchQuery, selectedGroup, settings.favorites]);

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

  const handleGroupSelect = (group: string) => {
    const isLocked = settings.parentalControl.enabled && 
                     settings.parentalControl.lockedGroups.some(lg => group.toLowerCase().includes(lg.toLowerCase()));
    
    if (isLocked) {
      setPendingGroup(group);
      setIsPinPromptOpen(true);
      setPinInput('');
      setPinError(false);
    } else {
      setSelectedGroup(group);
    }
  };

  const verifyPin = () => {
    if (pinInput === settings.parentalControl.pin) {
      if (pendingGroup) setSelectedGroup(pendingGroup);
      setIsPinPromptOpen(false);
      setPinInput('');
      setPinError(false);
    } else {
      setPinError(true);
      setPinInput('');
    }
  };

  const handleRecordingComplete = (recording: Recording) => {
    setRecordings(prev => [recording, ...prev]);
  };

  const deleteRecording = (id: string) => {
    setRecordings(prev => prev.filter(r => r.id !== id));
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
                onClick={() => setRefreshTrigger(prev => prev + 1)} 
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
          
          {/* Sidebar: Categories */}
          <aside className="col-span-2 row-span-3 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-xl">
            <div className="p-4 border-b border-slate-800 bg-slate-800/30">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Categories</h2>
            </div>
            <ScrollArea className="flex-1 p-2">
              <div className="space-y-1">
                <div 
                  className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${selectedGroup === 'All' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'hover:bg-slate-800 text-slate-400'}`}
                  onClick={() => setSelectedGroup('All')}
                >
                  <div className="flex items-center gap-2">
                    <Tv size={14} />
                    <span className="text-xs font-medium">All Channels</span>
                  </div>
                  <span className="text-[10px] opacity-60">{playlist?.channels.length || 0}</span>
                </div>
                
                <div 
                  className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${selectedGroup === 'Favorites' ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400' : 'hover:bg-slate-800 text-slate-400'}`}
                  onClick={() => setSelectedGroup('Favorites')}
                >
                  <div className="flex items-center gap-2">
                    <Heart size={14} />
                    <span className="text-xs font-medium">Favorites</span>
                  </div>
                  <span className="text-[10px] opacity-60">{settings.favorites.length}</span>
                </div>

                {playlist?.groups.map(group => {
                  const isLocked = settings.parentalControl.enabled && 
                                   settings.parentalControl.lockedGroups.some(lg => group.toLowerCase().includes(lg.toLowerCase()));
                  return (
                    <div 
                      key={group}
                      className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${selectedGroup === group ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'hover:bg-slate-800 text-slate-400'}`}
                      onClick={() => handleGroupSelect(group)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isLocked ? <Lock size={12} className="text-amber-500 flex-shrink-0" /> : <List size={12} className="flex-shrink-0" />}
                        <span className="text-xs font-medium truncate pr-2">{group}</span>
                      </div>
                      <span className="text-[10px] opacity-60">
                        {playlist?.channels.filter(c => c.group === group).length}
                      </span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </aside>

          {/* Main Player Window */}
          <section className="col-span-7 row-span-3 bg-black border border-slate-800 rounded-2xl overflow-hidden relative shadow-2xl flex flex-col">
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
                <div className="flex-1 bg-black flex items-center justify-center relative group">
                  <VideoPlayer 
                    url={selectedChannel.url} 
                    title={selectedChannel.name} 
                    channelId={selectedChannel.id}
                    onRecordingComplete={handleRecordingComplete}
                  />
                </div>
                <div className="h-20 bg-slate-900/90 border-t border-slate-800 p-4 flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold text-white truncate">{selectedChannel.name}</h3>
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
            <div className="p-4 border-b border-slate-800 bg-slate-950/50">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                <input 
                  type="text" 
                  placeholder="Search channels..." 
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
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

          {/* Bottom: Recordings / Guide */}
          <section className="col-span-7 row-span-3 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-xl">
            <Tabs defaultValue="guide" className="h-full flex flex-col">
              <TabsList className="bg-slate-800/50 border-b border-slate-800 rounded-none w-full justify-start px-4 h-11">
                <TabsTrigger value="guide" className="text-[10px] uppercase font-bold tracking-widest text-slate-400 data-[state=active]:text-emerald-500 data-[state=active]:bg-transparent">Program Guide</TabsTrigger>
                <TabsTrigger value="recordings" className="text-[10px] uppercase font-bold tracking-widest text-slate-400 data-[state=active]:text-emerald-500 data-[state=active]:bg-transparent flex items-center gap-2">
                  <Video size={12} />
                  Recordings
                  {recordings.length > 0 && <Badge className="bg-emerald-500 text-[8px] h-3.5 px-1 min-w-[14px] flex items-center justify-center">{recordings.length}</Badge>}
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="guide" className="flex-1 m-0 overflow-hidden">
                <div className="h-full">
                  <EPGGuide 
                    channels={filteredChannels.slice(0, 100)} 
                    epg={epg} 
                    onChannelSelect={setSelectedChannel}
                    selectedChannelId={selectedChannel?.id}
                  />
                </div>
              </TabsContent>

              <TabsContent value="recordings" className="flex-1 m-0 overflow-hidden">
                <ScrollArea className="h-full p-4">
                  <div className="grid grid-cols-2 gap-4">
                    {recordings.map(rec => (
                      <div key={rec.id} className="bg-slate-950/40 border border-slate-800 rounded-xl p-3 flex gap-3 group relative">
                        <div className="w-20 h-14 bg-slate-800 rounded flex items-center justify-center shrink-0">
                          <Video size={20} className="text-emerald-500/40" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-[11px] font-bold text-slate-200 truncate">{rec.title}</h4>
                          <p className="text-[9px] text-slate-500 mt-1">{rec.channelName}</p>
                          <div className="flex justify-between items-center mt-2">
                            <span className="text-[9px] text-emerald-500/60 font-mono">{Math.floor(rec.duration / 60)}:{(rec.duration % 60).toString().padStart(2, '0')}</span>
                            <div className="flex gap-2">
                              <a href={rec.blobUrl} download={`${rec.title}.webm`} className="text-[9px] text-blue-400 hover:underline">Download</a>
                              <button onClick={() => deleteRecording(rec.id)} className="text-[9px] text-rose-500 hover:underline">Delete</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {recordings.length === 0 && (
                      <div className="col-span-2 py-8 text-center text-slate-600 italic text-xs">
                        No recordings yet. Hit the record button in the player to save live moments.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </section>

          {/* Bottom Left: Quick Setup Info */}
          <section className="col-span-2 row-span-3 bg-emerald-950/10 border border-emerald-900/30 rounded-2xl p-5 flex flex-col justify-between shadow-xl">
            <div className="min-w-0">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-3">Service Setup</h2>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[9px] uppercase font-bold text-slate-600">Active Playlist</label>
                  <div className="bg-black/40 p-2 rounded-lg text-[10px] font-mono text-slate-400 truncate border border-slate-800/50">
                    {settings.playlistUrl ? 'CONNECTED' : 'NOT LINKED'}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] uppercase font-bold text-slate-600">EPG Source</label>
                  <div className="bg-black/40 p-2 rounded-lg text-[10px] font-mono text-slate-400 truncate border border-slate-800/50">
                    {settings.epgUrl ? 'SYNCHRONIZED' : 'LOCAL ONLY'}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-emerald-500/40 font-medium italic">
              <ShieldAlert size={10} />
              Secured Connection
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
            <div className="flex items-center gap-2">RECORDING CACHE: {(recordings.length * 0.1).toFixed(1)} MB</div>
            <div className="flex items-center gap-2">FRAMEWORK: GOOGLE TV v4</div>
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
