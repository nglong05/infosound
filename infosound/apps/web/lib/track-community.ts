import type { Artist, List, Track } from './api';

export type CommentUser = {
  id: string;
  displayName: string;
  role: 'USER' | 'AUTHOR';
  avatarUrl?: string | null;
};
export type TrackComment = {
  id: string;
  body: string;
  atSeconds: number;
  sourceVersion: number;
  parentId: string | null;
  createdAt: string;
  user: CommentUser;
  likeCount: number;
  liked: boolean;
  replyCount: number;
  canDelete: boolean;
};
export type CommentPage = List<TrackComment> & { sourceVersion: number };
export type CommentMarkers = {
  items: TrackComment[];
  total: number;
  sourceVersion: number;
  truncated: boolean;
};
export type TrackCommunity = {
  sourceVersion: number;
  artist: Artist & {
    followerCount: number;
    trackCount: number;
    playCount: number;
    likeCount: number;
    following: boolean;
  };
  fans: { items: { user: CommentUser; playCount: number }[]; historicalCountsLimited: boolean };
  relatedTracks: Track[];
};
export type TrackWaveform = {
  trackId: string;
  sourceVersion: number;
  status: 'READY' | 'PENDING' | 'UNAVAILABLE';
  duration: number | null;
  peaks: number[] | null;
};
