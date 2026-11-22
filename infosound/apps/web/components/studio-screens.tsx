'use client';
import { NewTrack } from '@/features/studio/new-track';
import { EditTrack } from '@/features/studio/edit-track';
import { StudioList } from '@/features/studio/studio-list';

export function StudioScreen({ id }: { id?: string }) {
  return id === 'new' ? <NewTrack /> : id ? <EditTrack key={id} id={id} /> : <StudioList />;
}
