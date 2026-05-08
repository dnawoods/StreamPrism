import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX, AlertCircle, Settings2, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface VideoPlayerProps {
  url: string;
  title?: string;
  channelId?: string;
  proxyStreams?: boolean;
}

type PlayerEngine = 'hls' | 'mpegts' | 'native' | 'none';

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ url, title, channelId, proxyStreams = true }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [hasError, setHasError] = useState<{message: string, techDetail?: string} | null>(null);
  const [levels, setLevels] = useState<{ id: number, height: number, bitrate: number }[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);
  const [showStats, setShowStats] = useState(false);
  const [showTechDetail, setShowTechDetail] = useState(false);
  const [engine, setEngine] = useState<PlayerEngine>('none');
  const [stats, setStats] = useState({ bitrate: 0, dropped: 0, buffer: 0 });
  
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<any>(null);

  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play().catch(e => {
          if (e.name !== 'AbortError') {
            console.error("[PLAYER] Playback failed:", e);
            setIsPlaying(false);
            setHasError({
              message: 'Manual playback failed',
              techDetail: e.message
            });
          }
        });
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      if (container.requestFullscreen) {
        container.requestFullscreen();
      } else if ((container as any).webkitRequestFullscreen) {
        (container as any).webkitRequestFullscreen();
      } else if ((container as any).mozRequestFullScreen) {
        (container as any).mozRequestFullScreen();
      } else if ((container as any).msRequestFullscreen) {
        (container as any).msRequestFullscreen();
      }
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).mozCancelFullScreen) {
        (document as any).mozCancelFullScreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      }
      setIsFullscreen(false);
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  }, []);

  const handleVolumeChange = useCallback((value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      setIsMuted(newVolume === 0);
    }
  }, []);

  const changeLevel = useCallback((id: string) => {
    const levelId = parseInt(id);
    setCurrentLevel(levelId);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelId;
    }
  }, []);

  const toggleStats = useCallback(() => setShowStats(prev => !prev), []);

  useEffect(() => {
    if (!url) return;
    
    const video = videoRef.current;
    if (!video) return;

    const isInternal = url.startsWith(window.location.origin) || url.startsWith('/') || url.startsWith('blob:');
    const isAlreadyProxied = url.includes('/api/proxy?');
    
    let effectiveUrl = url;
    if (proxyStreams && !isInternal && !isAlreadyProxied) {
      try {
        // Robust base64 encoding for the browser
        const b64 = btoa(unescape(encodeURIComponent(url)));
        effectiveUrl = new URL(`/api/proxy?b64=${encodeURIComponent(b64)}`, window.location.origin).href;
      } catch (e) {
        console.warn("[PLAYER] Base64 encoding failed, falling back to standard encoding", e);
        effectiveUrl = new URL(`/api/proxy?url=${encodeURIComponent(url)}`, window.location.origin).href;
      }
    }

    console.log(`[PLAYER] Initializing: "${title || "Unknown"}" (Proxy: ${proxyStreams})`);

    let hls: Hls | null = null;
    let tsPlayer: any = null;
    let statsInterval: ReturnType<typeof setInterval> | null = null;
    let isCanceled = false;
    let playbackTimeout: ReturnType<typeof setTimeout> | null = null;

    const terminateCurrentStream = () => {
      if (playbackTimeout) {
        clearTimeout(playbackTimeout);
        playbackTimeout = null;
      }
      if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
      }
      
      if (hlsRef.current) {
        try {
          hlsRef.current.detachMedia();
          hlsRef.current.destroy();
        } catch (e) {
          console.warn('[PLAYER] HLS cleanup error:', e);
        }
        hlsRef.current = null;
      }
      
      if (mpegtsRef.current) {
        try {
          mpegtsRef.current.pause();
          mpegtsRef.current.unload();
          mpegtsRef.current.detachMediaElement();
          mpegtsRef.current.destroy();
        } catch (e) {
          console.warn('[PLAYER] mpegts cleanup error:', e);
        }
        mpegtsRef.current = null;
      }

      if (video) {
        try {
          video.pause();
          video.src = "";
          video.removeAttribute('src');
          video.load();
        } catch (e) {
          console.warn('[PLAYER] Video element reset error:', e);
        }
      }
      
      setEngine('none');
      setHasError(null);
    };

    const startPlayback = (engineToTry: PlayerEngine, retryCount = 0, engineHistory: PlayerEngine[] = []) => {
      terminateCurrentStream();
      
      const newHistory = [...engineHistory, engineToTry];

      if (engineToTry === 'hls' && Hls.isSupported()) {
        const hlsInstance = new Hls({
          enableWorker: true,
          manifestLoadingMaxRetry: 20,
          manifestLoadingTimeOut: 20000,
          lowLatencyMode: true,
        });
        hlsRef.current = hlsInstance;
        hlsInstance.loadSource(effectiveUrl);
        hlsInstance.attachMedia(video);
        
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          setHasError(null);
          setLevels(hlsInstance.levels.map((l, i) => ({ id: i, height: l.height, bitrate: l.bitrate })));
          video.play().catch(e => {
            if (e.name !== 'AbortError') setIsPlaying(false);
          });
        });

        hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              setHasError({ message: 'Network Error (HLS)', techDetail: data.details });
              hlsInstance.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hlsInstance.recoverMediaError();
            } else {
              if (newHistory.includes('mpegts')) {
                console.log("[HLS] Fatal error, already tried mpegts, falling back to native");
                startPlayback('native', 0, newHistory);
              } else {
                console.log("[HLS] Fatal error, trying fallback to mpegts");
                startPlayback('mpegts', 0, newHistory);
              }
            }
          }
        });
      } else if (engineToTry === 'mpegts' && mpegts.getFeatureList().mseLivePlayback) {
        tsPlayer = mpegts.createPlayer({
          type: 'mse',
          url: effectiveUrl,
          isLive: true,
        }, {
          enableWorker: true,
          lazyLoad: false,
          stashInitialSize: 128 * 1024,
        });
        mpegtsRef.current = tsPlayer;
        tsPlayer.attachMediaElement(video);
        tsPlayer.load();
        tsPlayer.play()?.catch((e: any) => {
          if (e.name !== 'AbortError') {
            if (retryCount < 2) {
              console.log(`[PLAYER] Play failed, retrying mpegts (${retryCount + 1})...`);
              playbackTimeout = setTimeout(() => startPlayback('mpegts', retryCount + 1, engineHistory), 1000);
            } else {
              setIsPlaying(false);
            }
          }
        });

        tsPlayer.on(mpegts.Events.ERROR, (type: any, detail: any, info: any) => {
          console.error(`[MPEGTS] Error (${type}): ${detail}`, info);
          
          if (isCanceled) return;

          const isNetworkError = type === 'NetworkError' || detail === 'Exception' || detail === 'NetworkError' || detail === 'NetworkException';
          
          if (isNetworkError) {
            if (retryCount < 2) {
              const delay = retryCount === 0 ? 1000 : 3000;
              console.log(`[PLAYER] Network error in mpegts, retrying (${retryCount + 1}) in ${delay}ms...`);
              playbackTimeout = setTimeout(() => startPlayback('mpegts', retryCount + 1, engineHistory), delay);
              return;
            } else if (retryCount === 2) {
              if (newHistory.includes('hls')) {
                 console.log("[PLAYER] MPEGTS failed, already tried HLS, falling back to native");
                 startPlayback('native', 0, newHistory);
              } else {
                 console.log("[PLAYER] MPEGTS terminal network error, trying HLS fallback");
                 startPlayback('hls', 0, newHistory);
              }
              return;
            }
          }
          
          console.log("[PLAYER] MPEGTS fatal error, falling back to native engine");
          startPlayback('native', 0, newHistory);
        });
      } else {
        setEngine('native');
        video.src = effectiveUrl;
        video.play().catch(e => {
          if (isCanceled) return;
          if (e.name !== 'AbortError') {
            if (retryCount < 1) {
              console.log("[PLAYER] Native play failed, retrying once...");
              playbackTimeout = setTimeout(() => startPlayback('native', 1), 1000);
            } else {
              setHasError({
                message: 'Signal Lost / Source Offline',
                techDetail: `Native playback failed: ${e.message}`
              });
              setIsPlaying(false);
            }
          }
        });
      }
    };

    // Initial termination
    terminateCurrentStream();
    
    // Initial engine choice
    const startAfterDelay = () => {
      if (isCanceled) return;
      
      const lowerUrl = url.toLowerCase();
      const isHls = lowerUrl.includes('.m3u8') || lowerUrl.includes('type=m3u8');
      
      if (isHls) {
        startPlayback('hls');
      } else {
        startPlayback('mpegts');
      }
    };

    // We wait 2000ms to ensure the provider has registered the previous connection as closed
    // This is critical for users with a 1-connection limit
    console.log(`[PLAYER] Waiting 2s before starting new stream to ensure previous connection is closed...`);
    playbackTimeout = setTimeout(startAfterDelay, 2000);

    const updateStats = () => {
      if (!videoRef.current) return;
      let bitrate = 0;
      let buffer = 0;
      
      if (hls && hls.currentLevel >= 0) {
        bitrate = Math.round(hls.levels[hls.currentLevel].bitrate / 1024);
        buffer = hls.mainForwardBufferInfo ? Math.round(hls.mainForwardBufferInfo.len * 10) / 10 : 0;
      } else if (tsPlayer?.statistics) {
        bitrate = Math.round(tsPlayer.statistics.speed || 0);
        if (videoRef.current.buffered.length > 0) {
          buffer = Math.round((videoRef.current.buffered.end(videoRef.current.buffered.length-1) - videoRef.current.currentTime) * 10) / 10;
        }
      } else if (videoRef.current.buffered.length > 0) {
        buffer = Math.round((videoRef.current.buffered.end(videoRef.current.buffered.length - 1) - videoRef.current.currentTime) * 10) / 10;
      }

      setStats({
        bitrate,
        dropped: videoRef.current.getVideoPlaybackQuality().droppedVideoFrames,
        buffer: Math.max(0, buffer)
      });
    };
    statsInterval = setInterval(updateStats, 2000);

    return () => {
      isCanceled = true;
      if (playbackTimeout) clearTimeout(playbackTimeout);
      terminateCurrentStream();
    };
  }, [url, title]);

  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  }, [isPlaying]);

  // Keyboard support for Google TV style navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        toggleMute();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, toggleFullscreen]);

  return (
    <div 
      ref={containerRef}
      id="player-container"
      className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden group shadow-2xl"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <video
        ref={videoRef}
        className="w-full h-full cursor-pointer object-contain"
        onClick={togglePlay}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        playsInline
        autoPlay
      />

      {/* Specialist Stats Overlay */}
      {showStats && (
        <div className="absolute top-16 right-6 z-30 bg-slate-900/90 border border-slate-700/50 p-3 rounded-lg backdrop-blur-md shadow-2xl font-mono text-[10px] space-y-1.5 min-w-[140px] animate-in fade-in zoom-in-95">
          <div className="flex justify-between items-center text-slate-500 uppercase font-bold text-[8px] tracking-wider border-b border-white/5 pb-1 mb-2">
            <span>Stream Diagnostics</span>
            <span className="text-[7px] text-slate-600 bg-white/5 px-1 rounded ml-1">{engine}</span>
            <Activity size={10} className="text-emerald-500" />
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Bitrate</span>
            <span className="text-emerald-400 font-bold">{stats.bitrate} kbps</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Buffer</span>
            <span className="text-cyan-400 font-bold">{stats.buffer}s</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Dropped</span>
            <span className="text-rose-400 font-bold">{stats.dropped} frames</span>
          </div>
          <div className="pt-2 flex flex-col gap-1">
             <div className="h-0.5 bg-slate-800 rounded-full overflow-hidden">
               <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, stats.buffer * 5)}%` }} />
             </div>
             <span className="text-[7px] text-slate-600 uppercase tracking-tighter">Buffer Health</span>
          </div>
        </div>
      )}

      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-20 px-8 text-center animate-in fade-in duration-500">
          <div className="flex flex-col items-center gap-6 max-w-md">
            <div className="relative">
              <AlertCircle className="text-rose-500 w-16 h-16" />
              <div className="absolute inset-0 blur-xl bg-rose-500/20 rounded-full -z-10" />
            </div>
            <div>
              <h4 className="text-white text-lg font-bold">Playback Failed</h4>
              <p className="text-sm text-slate-400 mt-2">{hasError.message}</p>
            </div>
            
              <div className="flex flex-col gap-3 w-full">
                <Button 
                  variant="default" 
                  size="sm" 
                  onClick={() => window.location.reload()}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-10"
                >
                  Retry Stream
                </Button>
                
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setShowTechDetail(!showTechDetail)}
                    className="border-slate-800 text-slate-400 hover:text-white h-10"
                  >
                    {showTechDetail ? 'Hide Logs' : 'View Logs'}
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${title || 'stream'}.m3u8`;
                      a.click();
                    }}
                    className="border-slate-800 text-slate-400 hover:text-white h-10"
                  >
                    Get M3U8
                  </Button>
                </div>
              </div>

            {showTechDetail && (
              <div className="w-full mt-2 p-3 bg-slate-950/80 border border-white/5 rounded-lg text-left font-mono text-[9px] text-slate-500 max-h-40 overflow-y-auto animate-in slide-in-from-top-2 duration-300">
                <p className="mb-1 text-emerald-500/70 border-b border-white/5 pb-1 uppercase tracking-widest font-bold">Diagnostics</p>
                <div className="space-y-1">
                  <p><span className="text-slate-300">Engine:</span> <span className="text-emerald-500 uppercase font-bold">{engine}</span></p>
                  <p><span className="text-slate-300">Title:</span> {title}</p>
                  <p className="break-all"><span className="text-slate-300">Original URL:</span> {url}</p>
                  <p className="break-all"><span className="text-slate-300">Proxy URL:</span> /api/proxy?url=...</p>
                  <p><span className="text-slate-300">Error:</span> {hasError.techDetail || 'No detailed log'}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Overlays and Controls */}
      <div className={`absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 transition-opacity duration-300 flex flex-col justify-between p-6 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex justify-between items-start">
          <div className="flex flex-col">
            <h3 className="text-white font-bold text-xl drop-shadow-md">{title || 'Live Stream'}</h3>
            <div className="flex items-center gap-3 mt-1">
               {currentLevel === -1 ? (
                 <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[8px] h-4 uppercase font-bold">Auto Quality</Badge>
               ) : (
                 <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[8px] h-4 uppercase font-bold">
                   {levels.find(l => l.id === currentLevel)?.height}p Fixed
                 </Badge>
               )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
                variant="ghost" 
                size="icon" 
                onClick={toggleStats} 
                className={`h-8 w-8 rounded-lg border transition-colors ${showStats ? 'bg-emerald-500 border-emerald-400 text-slate-950 hover:bg-emerald-400' : 'bg-slate-900/60 border-white/10 text-white hover:bg-white/10'}`}
              >
              <Activity size={16} />
            </Button>
            <div className="bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1.5 shadow-lg">
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              Live
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <Button variant="ghost" size="icon" onClick={togglePlay} className="text-white hover:bg-white/20 w-12 h-12 rounded-full">
            {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
          </Button>

          <div className="flex items-center gap-3 group/volume relative">
            <Button variant="ghost" size="icon" onClick={toggleMute} className="text-white hover:bg-white/20">
              {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </Button>
            <div className="w-24">
              <Slider
                value={[isMuted ? 0 : volume]}
                max={1}
                step={0.01}
                onValueChange={handleVolumeChange}
                className="cursor-pointer"
              />
            </div>
          </div>

          <div className="flex-1" />

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center justify-center text-white hover:bg-white/20 w-10 h-10 rounded-full transition-colors cursor-pointer outline-none focus:bg-white/30">
              <Settings2 size={24} />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-slate-900 border-slate-800 text-slate-200">
              <DropdownMenuLabel>Quality Settings</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-slate-800" />
              <DropdownMenuGroup>
                <DropdownMenuRadioGroup value={currentLevel.toString()} onValueChange={changeLevel}>
                  <DropdownMenuRadioItem value="-1">Auto (Recommend)</DropdownMenuRadioItem>
                  {levels.map(level => (
                    <DropdownMenuRadioItem key={level.id} value={level.id.toString()}>
                      {level.height}p ({Math.round(level.bitrate/1000)}k)
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="text-white hover:bg-white/20 w-10 h-10 rounded-full">
            {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
          </Button>
        </div>
      </div>
    </div>
  );
};
