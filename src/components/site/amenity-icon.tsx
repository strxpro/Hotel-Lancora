import { Accessibility, AirVent, Armchair, Baby, Bath, Coffee, Fence, LockKeyhole, PenLine, Refrigerator, Sofa, Sparkles, Trees, Tv, VolumeX, Waves, Wifi, Wind, type LucideIcon } from 'lucide-react';
import { AMENITIES } from '@/content/amenities';

const ICONS: Record<string, LucideIcon> = { Wifi, AirVent, Tv, Bath, Wind, LockKeyhole, Refrigerator, Fence, Trees, Waves, PenLine, Sofa, Armchair, Coffee, VolumeX, Baby, Accessibility };

export function AmenityIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[AMENITIES[name]?.icon ?? ''] ?? Sparkles;
  return <Icon className={className} strokeWidth={1.4} aria-hidden="true" />;
}
