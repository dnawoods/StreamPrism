import React from 'react';
import { IPTVChannel } from '../types';
import { Badge } from '@/components/ui/badge';
import { Heart } from 'lucide-react';

interface ChannelCardProps {
  channel: IPTVChannel;
  isSelected: boolean;
  isFavorite: boolean;
  isFocused?: boolean;
  onClick: () => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
  currentProgram?: string;
}

export const ChannelCard: React.FC<ChannelCardProps> = ({ 
  channel, 
  isSelected, 
  isFavorite,
  isFocused,
  onClick, 
  onToggleFavorite,
  currentProgram 
}) => {
  return (
    <div
      data-nav-id={channel.id}
      onClick={onClick}
      className={`flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all duration-200 group relative ${
        isSelected 
          ? 'bg-emerald-500/10 border border-emerald-500/30 text-white' 
          : isFocused
          ? 'bg-slate-800 border-slate-600 ring-2 ring-emerald-500/50'
          : 'hover:bg-slate-800 border border-transparent'
      }`}
    >
      <div className="relative w-14 h-14 bg-slate-950 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center border border-slate-800">
        {channel.logo ? (
          <img 
            src={channel.logo} 
            alt={channel.name} 
            className="w-full h-full object-contain p-1"
            referrerPolicy="no-referrer"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).parentElement?.classList.add('bg-muted');
            }}
          />
        ) : (
          <div className="text-2xl font-bold opacity-30">{channel.name[0]}</div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start gap-2">
          <div className="flex flex-col min-w-0">
            <h4 className="font-semibold text-sm truncate">{channel.name}</h4>
            {channel.group && (
              <span className="text-[9px] text-slate-600 uppercase font-bold tracking-tighter truncate">
                {channel.group}
              </span>
            )}
          </div>
          <button 
            onClick={onToggleFavorite}
            className={`p-1.5 rounded-full transition-colors ${isFavorite ? 'text-rose-500' : 'text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100'}`}
          >
            <Heart size={16} fill={isFavorite ? "currentColor" : "none"} />
          </button>
        </div>
        <p className="text-xs text-slate-500 truncate mt-0.5">
          {currentProgram || 'Live Stream'}
        </p>
      </div>
      
      {isSelected && (
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-emerald-500 rounded-l-full" />
      )}
    </div>
  );
};
