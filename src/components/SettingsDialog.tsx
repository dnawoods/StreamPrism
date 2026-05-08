import React, { useState } from 'react';
import { Settings as SettingsIcon, Lock, Unlock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppSettings, ParentalControl } from '../types';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';

interface SettingsDialogProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({ settings, onSave }) => {
  const [playlistUrl, setPlaylistUrl] = useState(settings.playlistUrl);
  const [epgUrl, setEpgUrl] = useState(settings.epgUrl);
  const [isOpen, setIsOpen] = useState(false);
  
  // Parental Control Local State
  const [pcEnabled, setPcEnabled] = useState(settings.parentalControl?.enabled || false);
  const [pcPin, setPcPin] = useState(settings.parentalControl?.pin || '');

  const handleSave = () => {
    onSave({ 
      ...settings, 
      playlistUrl, 
      epgUrl,
      parentalControl: {
        enabled: pcEnabled,
        pin: pcPin,
        lockedGroups: settings.parentalControl?.lockedGroups || []
      }
    });
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="h-9 px-4 border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-semibold" />}>
        <SettingsIcon size={16} className="mr-2" />
        Settings
      </DialogTrigger>
      <DialogContent className="sm:max-w-[450px] bg-slate-900 border-slate-800 text-slate-200">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <SettingsIcon size={20} className="text-emerald-500" />
            Service Configuration
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            Manage your IPTV sources and security preferences.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-6 py-4">
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Source URLs</h3>
            <div className="grid gap-2">
              <Label htmlFor="playlist" className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">Playlist URL (M3U)</Label>
              <Input
                id="playlist"
                placeholder="https://provider.com/playlist.m3u"
                className="bg-slate-950 border-slate-800 focus-visible:ring-emerald-500 text-sm h-11"
                value={playlistUrl}
                onChange={(e) => setPlaylistUrl(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="epg" className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">EPG URL (XMLTV)</Label>
              <Input
                id="epg"
                placeholder="https://provider.com/epg.xml"
                className="bg-slate-950 border-slate-800 focus-visible:ring-emerald-500 text-sm h-11"
                value={epgUrl}
                onChange={(e) => setEpgUrl(e.target.value)}
              />
            </div>
          </div>

          <Separator className="bg-slate-800" />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                  <ShieldAlert size={14} className="text-amber-500" />
                  Parental Controls
                </h3>
                <p className="text-[10px] text-slate-600">Restrict access to certain content.</p>
              </div>
              <Switch 
                checked={pcEnabled} 
                onCheckedChange={setPcEnabled}
                className="data-[state=checked]:bg-emerald-600"
              />
            </div>

            {pcEnabled && (
              <div className="grid gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
                <Label htmlFor="pin" className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">4-Digit Security PIN</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" size={16} />
                  <Input
                    id="pin"
                    type="password"
                    maxLength={4}
                    placeholder="Enter PIN"
                    className="bg-slate-950 border-slate-800 focus-visible:ring-emerald-500 text-sm h-11 pl-10 tracking-[0.5em]"
                    value={pcPin}
                    onChange={(e) => setPcPin(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
                <p className="text-[9px] text-slate-500">Locked categories will require this PIN to open.</p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="submit" onClick={handleSave} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold uppercase text-xs tracking-widest h-11 transition-all shadow-lg shadow-emerald-900/40">
            Apply Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
