// Compatibility exports keep one shared limiter and projection implementation.
export { validate, uuid, conflict } from './common/validation';
export { pagination } from './common/pagination';
export { throttle } from './common/rate-limit';
export {
  publicTrackWhere,
  publicAuthorSelect,
  trackInclude,
  viewTrack,
} from './features/tracks/track-view';
export type { IncludedTrack } from './features/tracks/track-view';
export { requireOwner } from './features/tracks/track-access';
