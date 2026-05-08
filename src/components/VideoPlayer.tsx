import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX, Circle, Square, AlertCircle, Settings2, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Recording } from '../types';
import {
  DropdownMenu,
  DropdownMenuContent,
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
  onRecordingComplete?: (recording: Recording) => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ url, title, channelId, onRecordingComplete }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [hasError, setHasError] = useState<string | null>(null);
  const [levels, setLevels] = useState<{ id: number, height: number, bitrate: number }[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState({ bitrate: 0, dropped: 0, buffer: 0 });
  
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    // Use proxy for ALL external streams to avoid CORS/Mixed Content issues
    const isInternal = url.startsWith(window.location.origin) || url.startsWith('/') || url.startsWith('blob:');
    const effectiveUrl = !isInternal
      ? `${window.location.origin}/api/proxy?url=${encodeURIComponent(url)}`
      : url;

    let hls: Hls | null = null;
    let statsInterval: NodeJS.Timeout | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        manifestLoadingMaxRetry: 5,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 5,
        levelLoadingRetryDelay: 1000,
        fragLoadingMaxRetry: 10,
        fragLoadingRetryDelay: 1000,
      });
      hlsRef.current = hls;

      hls.loadSource(effectiveUrl);
      hls.attachMedia(video);
      
      const updateStats = () => {
        if (hls && videoRef.current) {
          const level = hls.levels[hls.currentLevel];
          setStats({
            bitrate: level ? Math.round(level.bitrate / 1024) : 0,
            dropped: videoRef.current.getVideoPlaybackQuality().droppedVideoFrames,
            buffer: hls.mainForwardBufferInfo ? Math.round(hls.mainForwardBufferInfo.len * 10) / 10 : 0
          });
        }
      };
      statsInterval = setInterval(updateStats, 2000);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!videoRef.current) return;
        setHasError(null);
        setLevels(hls?.levels.map((l, i) => ({ id: i, height: l.height, bitrate: l.bitrate })) || []);
        setCurrentLevel(hls?.autoLevelEnabled ? -1 : hls?.currentLevel || -1);
        
        const playPromise = videoRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch(e => {
            if (e.name !== 'AbortError') {
              console.warn('Auto-play blocked or failed', e);
            }
            setIsPlaying(false);
          });
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.error('Fatal network error:', data);
              setHasError('Network Congestion: Stream timed out');
              hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error('Fatal media error:', data);
              setHasError('Codec Mismatch: Stream format incompatible');
              hls?.recoverMediaError();
              break;
            default:
              setHasError('Terminal System Failure');
              hls?.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = effectiveUrl;
      const onLoadedMetadata = () => {
        setHasError(null);
        video.play().catch(e => {
          if (e.name !== 'AbortError') console.error('Auto-play blocked', e);
        });
      };
      video.addEventListener('loadedmetadata', onLoadedMetadata);
    } else {
      // Fallback for non-HLS streams (like raw MP4 or TS)
      console.log("Using fallback player for:", effectiveUrl);
      video.src = effectiveUrl;
      setHasError(null);
      video.play().catch(e => {
        if (e.name !== 'AbortError') console.warn('Fallback auto-play blocked', e);
        // Don't set error here as it might just be a codec issue or user interaction required
      });
    }

    return () => {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = "";
        videoRef.current.load();
      }
      if (hls) {
        hls.destroy();
      }
      clearInterval(statsInterval);
    };
  }, [url]);

  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play().catch(e => {
          console.error("Playback failed:", e);
          setIsPlaying(false);
        });
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, []);

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      setIsMuted(newVolume === 0);
    }
  };

  const changeLevel = (id: string) => {
    const levelId = parseInt(id);
    setCurrentLevel(levelId);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelId;
    }
  };

  const toggleStats = () => setShowStats(!showStats);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const startRecording = () => {
    if (!videoRef.current || isRecording) return;
    
    try {
      const stream = (videoRef.current as any).captureStream ? (videoRef.current as any).captureStream() : (videoRef.current as any).mozCaptureStream ? (videoRef.current as any).mozCaptureStream() : null;
      
      if (!stream) {
        console.error('Recording is not supported in this browser for this stream.');
        return;
      }

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') 
        ? 'video/webm;codecs=vp9' 
        : MediaRecorder.isTypeSupported('video/webm') 
          ? 'video/webm' 
          : 'video/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const blobUrl = URL.createObjectURL(blob);
        
        if (onRecordingComplete) {
          onRecordingComplete({
            id: Math.random().toString(36).substr(2, 9),
            channelId: channelId || '',
            channelName: title || 'Unknown',
            timestamp: Date.now(),
            duration: recordingDuration,
            blobUrl,
            title: `Recording: ${title} (${new Date().toLocaleString()})`
          });
        }
        
        setRecordingDuration(0);
      };

      recorder.start();
      setIsRecording(true);
      
      const startTime = Date.now();
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
      
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  };

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
      className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden group"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <video
        ref={videoRef}
        className="w-full h-full cursor-pointer max-h-screen"
        onClick={togglePlay}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      {/* Specialist Stats Overlay */}
      {showStats && (
        <div className="absolute top-16 right-6 z-30 bg-slate-900/90 border border-slate-700/50 p-3 rounded-lg backdrop-blur-md shadow-2xl font-mono text-[10px] space-y-1.5 min-w-[140px] animate-in fade-in zoom-in-95">
          <div className="flex justify-between items-center text-slate-500 uppercase font-bold text-[8px] tracking-wider border-b border-white/5 pb-1 mb-2">
            <span>Stream Diagnostics</span>
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
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20 px-8 text-center">
          <div className="flex flex-col items-center gap-4">
            <AlertCircle className="text-rose-500 w-12 h-12" />
            <div>
              <h4 className="text-white font-bold">Playback Error</h4>
              <p className="text-xs text-slate-400 mt-1">{hasError}</p>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => window.location.reload()}
              className="mt-2 border-slate-700 text-slate-300"
            >
              Reload Player
            </Button>
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
               {isRecording && (
                <div className="flex items-center gap-2 text-red-500 font-mono text-[10px] font-bold animate-pulse uppercase">
                  <Circle size={8} fill="currentColor" />
                  REC {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
                </div>
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
            <DropdownMenuTrigger 
              render={
                <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 w-10 h-10 rounded-full">
                  <Settings2 size={24} />
                </Button>
              }
            />
            <DropdownMenuContent className="bg-slate-900 border-slate-800 text-slate-200">
              <DropdownMenuLabel>Quality Settings</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-slate-800" />
              <DropdownMenuRadioGroup value={currentLevel.toString()} onValueChange={changeLevel}>
                <DropdownMenuRadioItem value="-1">Auto (Recommend)</DropdownMenuRadioItem>
                {levels.map(level => (
                  <DropdownMenuRadioItem key={level.id} value={level.id.toString()}>
                    {level.height}p ({Math.round(level.bitrate/1000)}k)
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {isRecording ? (
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={stopRecording}
              className="flex items-center gap-2 font-bold uppercase text-[10px] tracking-widest px-4 h-9 rounded-full"
            >
              <Square size={14} fill="white" />
              Stop Recording
            </Button>
          ) : (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={startRecording}
              className="flex items-center gap-2 font-bold uppercase text-[10px] tracking-widest px-4 h-9 rounded-full border-white/20 text-white hover:bg-white/10"
            >
              <Circle size={14} />
              Record
            </Button>
          )}

          <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="text-white hover:bg-white/20 w-10 h-10 rounded-full">
            {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
          </Button>
        </div>
      </div>
    </div>
  );
};
