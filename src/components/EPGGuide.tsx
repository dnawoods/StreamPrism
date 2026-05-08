import React, { useMemo, useRef, useEffect, useState } from 'react';
import { IPTVChannel, EPGItem } from '../types';
import { parseXMLTVDate } from '../services/epgService';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Clock, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, addHours, startOfHour, isWithinInterval, addDays, startOfDay, differenceInMinutes } from 'date-fns';

interface EPGGuideProps {
  channels: IPTVChannel[];
  epg: EPGItem[];
  onChannelSelect: (channel: IPTVChannel) => void;
  selectedChannelId?: string;
}

const HOUR_WIDTH = 300; // Pixels per hour
const CHANNEL_HEIGHT = 70; // Pixels per channel row
const TIME_SLOT_MINUTES = 30;

export const EPGGuide: React.FC<EPGGuideProps> = ({ channels, epg, onChannelSelect, selectedChannelId }) => {
  const [viewDate, setViewDate] = useState(startOfHour(new Date()));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Time slots for the header (24 hours)
  const timeSlots = useMemo(() => {
    const slots = [];
    for (let i = 0; i < 24; i++) {
      slots.push(addHours(viewDate, i));
    }
    return slots;
  }, [viewDate]);

  const timelineStart = viewDate;
  const timelineEnd = addHours(viewDate, 24);

  // Group EPG by channel for easier lookup
  const epgByChannel = useMemo(() => {
    const map = new Map<string, EPGItem[]>();
    epg.forEach(item => {
      if (!map.has(item.channelId)) map.set(item.channelId, []);
      map.get(item.channelId)?.push(item);
    });
    return map;
  }, [epg]);

  const getProgramStyle = (start: Date, end: Date) => {
    const left = (differenceInMinutes(start, timelineStart) / 60) * HOUR_WIDTH;
    const width = (differenceInMinutes(end, start) / 60) * HOUR_WIDTH;
    return { left: Math.max(0, left), width };
  };

  const isCurrent = (start: Date, end: Date) => {
    return isWithinInterval(now, { start, end });
  };

  const scrollToNow = () => {
    if (scrollRef.current) {
      const offset = (differenceInMinutes(now, timelineStart) / 60) * HOUR_WIDTH - 100;
      scrollRef.current.scrollLeft = Math.max(0, offset);
    }
  };

  useEffect(() => {
    scrollToNow();
  }, [viewDate]);

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
      {/* Date/Control Header */}
      <div className="h-12 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/50">
        <div className="flex items-center gap-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Clock size={14} className="text-emerald-500" />
            TV Guide
          </h3>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400" onClick={() => setViewDate(prev => addHours(prev, -6))}>
              <ChevronLeft size={16} />
            </Button>
            <span className="text-[10px] font-mono font-bold text-slate-200 min-w-[140px] text-center uppercase">
              {format(viewDate, 'EEEE, MMM do HH:mm')}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400" onClick={() => setViewDate(prev => addHours(prev, 6))}>
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
           <Button 
            variant="outline" 
            size="sm" 
            onClick={scrollToNow}
            className="h-7 px-3 text-[9px] uppercase font-bold border-slate-700 bg-slate-800 text-emerald-400 hover:bg-slate-700"
          >
            Go to Now
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Channel Sidebar (Sticky) */}
        <div className="w-48 shrink-0 flex flex-col border-r border-slate-800 z-10 bg-slate-900 shadow-xl">
          <div className="h-10 border-b border-slate-800 shrink-0" />
          <ScrollArea className="flex-1">
            {channels.map(channel => (
              <div 
                key={channel.id} 
                className={`h-[70px] border-b border-slate-800 px-3 flex items-center gap-3 transition-colors cursor-pointer group ${selectedChannelId === channel.id ? 'bg-emerald-500/10' : 'hover:bg-slate-800/50'}`}
                onClick={() => onChannelSelect(channel)}
              >
                <div className="w-10 h-10 bg-black rounded border border-slate-800 flex items-center justify-center p-1 overflow-hidden shrink-0">
                  {channel.logo ? (
                    <img src={channel.logo} alt="" className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" />
                  ) : (
                    <Tv size={16} className="text-slate-700" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-slate-200 truncate group-hover:text-emerald-400 transition-colors uppercase tracking-tight leading-tight">
                    {channel.name}
                  </p>
                  <p className="text-[9px] text-slate-500 font-mono mt-0.5">CH {channel.tvgId || '?'}</p>
                </div>
              </div>
            ))}
          </ScrollArea>
        </div>

        {/* Timeline Grid */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <div ref={scrollRef} className="flex-1 overflow-auto bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] bg-fixed">
            {/* Time Scale Header */}
            <div className="flex sticky top-0 z-20 h-10 bg-slate-900 border-b border-slate-800 shadow-md">
              {timeSlots.map((time, i) => (
                <div key={i} className="flex shrink-0" style={{ width: HOUR_WIDTH }}>
                  <div className="flex-1 border-r border-slate-800/50 h-full flex flex-col justify-center px-4 relative">
                    <span className="text-[10px] font-mono font-bold text-slate-300">
                      {format(time, 'HH:mm')}
                    </span>
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
                      {format(time, 'MMM d')}
                    </span>
                  </div>
                  {/* Half hour marker */}
                  <div className="absolute top-0 bottom-0 border-r border-dashed border-slate-800/30" style={{ left: HOUR_WIDTH / 2 }} />
                </div>
              ))}
            </div>

            {/* Channels & Programs */}
            <div className="relative" style={{ width: 24 * HOUR_WIDTH }}>
              {/* Vertical Time Indicator */}
              <div 
                className="absolute top-0 bottom-0 w-px bg-emerald-500 z-10 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                style={{ left: (differenceInMinutes(now, timelineStart) / 60) * HOUR_WIDTH }}
              >
                <div className="absolute top-0 -left-[4px] w-2 h-2 bg-emerald-500 rounded-full" />
              </div>

              {channels.map((channel, cIdx) => (
                <div key={channel.id} className="h-[70px] border-b border-slate-800/50 relative">
                  {/* Grid Lines */}
                  {timeSlots.map((_, i) => (
                    <div key={i} className="absolute top-0 bottom-0 border-r border-slate-800/20" style={{ left: i * HOUR_WIDTH }} />
                  ))}

                  {/* Program Blocks */}
                  {channel.tvgId && epgByChannel.get(channel.tvgId)?.map((item, pIdx) => {
                    const startRaw = item.start;
                    const stopRaw = item.stop;
                    
                    // Basic string-based filter before parsing to save cycles
                    // XMLTV dates are YYYYMMDDHHMMSS, so we can do simple comparisons
                    // This is a rough optimization
                    
                    const start = parseXMLTVDate(startRaw);
                    const end = parseXMLTVDate(stopRaw);
                    
                    // Filter out programs not in current timeline view
                    if (end < timelineStart || start > timelineEnd) return null;

                    const style = getProgramStyle(start, end);
                    const isLive = isCurrent(start, end);

                    return (
                      <div
                        key={`${channel.id}-${pIdx}`}
                        className={`absolute top-1 bottom-1 p-2 rounded-lg border flex flex-col justify-center overflow-hidden transition-all cursor-pointer group/prog ${
                          isLive 
                            ? 'bg-emerald-500/10 border-emerald-500/30 ring-1 ring-emerald-500/10' 
                            : 'bg-slate-900/40 border-slate-800 hover:bg-slate-800/60 hover:border-slate-700'
                        }`}
                        style={style}
                        title={item.title}
                        onClick={() => onChannelSelect(channel)}
                      >
                        <div className="flex items-center justify-between gap-2">
                           <h4 className={`text-[10px] font-bold truncate ${isLive ? 'text-emerald-400' : 'text-slate-300'}`}>
                            {item.title}
                          </h4>
                          {isLive && (
                             <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_4px_rgba(16,185,129,0.8)] shrink-0" />
                          )}
                        </div>
                        <p className="text-[9px] text-slate-500 font-mono mt-0.5 truncate">
                          {format(start, 'HH:mm')} - {format(end, 'HH:mm')}
                        </p>
                        
                        {/* Expand on hover detail - simplified for now */}
                        <div className="absolute right-1 top-1 opacity-0 group-hover/prog:opacity-100 transition-opacity">
                          <Info size={10} className="text-slate-500" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Tv = ({ size, className }: { size: number, className: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>
  </svg>
);
