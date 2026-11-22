// Function-calling tool implementations for the chatbot. Every tool is scoped to the
// current user's own data; catalogue lookups only return public/READY tracks.
import { db } from '@infosound/database';
import type { Identity } from './security';
import {
  publicTrackWhere,
  trackInclude,
  viewTrack,
  type IncludedTrack,
} from './features/tracks/track-view';
import { withAvatar } from './user-view';
import { trackSummary, type ToolCall } from './chatbot-protocol';

export type SerializedTrack = Awaited<ReturnType<typeof viewTrack>>;
export type ToolResult = { summary: string; tracks: SerializedTrack[] };

async function serialize(rows: IncludedTrack[], user: Identity): Promise<ToolResult> {
  const tracks = await Promise.all(rows.map((r) => viewTrack(r, user)));
  const summary = trackSummary(
    tracks.map((t: any) => ({
      title: t.title,
      artist: t.author?.displayName ?? '?',
      genre: t.genre,
      playCount: t.playCount,
    })),
  );
  return { summary, tracks };
}

// ---- Catalogue tools -----------------------------------------------------

async function searchTracks(query: string, user: Identity): Promise<ToolResult> {
  if (!query.trim()) return { summary: 'Thiếu từ khoá tìm kiếm.', tracks: [] };
  const rows = await db.track.findMany({
    where: {
      ...publicTrackWhere,
      author: { active: true },
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { author: { displayName: { contains: query, mode: 'insensitive' } } },
      ],
    },
    include: trackInclude,
    orderBy: { playCount: 'desc' },
    take: 8,
  });
  return serialize(rows, user);
}

async function popularTracks(limit: number, user: Identity): Promise<ToolResult> {
  const rows = await db.track.findMany({
    where: { ...publicTrackWhere, author: { active: true } },
    include: trackInclude,
    orderBy: { playCount: 'desc' },
    take: Math.min(Math.max(limit, 1), 12),
  });
  return serialize(rows, user);
}

async function artistTracks(name: string, user: Identity): Promise<ToolResult> {
  if (!name.trim()) return { summary: 'Thiếu tên nghệ sĩ.', tracks: [] };
  const rows = await db.track.findMany({
    where: {
      ...publicTrackWhere,
      author: { active: true, displayName: { contains: name, mode: 'insensitive' } },
    },
    include: trackInclude,
    orderBy: { playCount: 'desc' },
    take: 12,
  });
  return serialize(rows, user);
}

// ---- Personal: profile & stats -------------------------------------------

async function myProfile(user: Identity): Promise<ToolResult> {
  const u = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      displayName: true,
      username: true,
      role: true,
      bio: true,
      createdAt: true,
    },
  });
  const [playlistCount, likedCount, trackCount, followerCount] = await Promise.all([
    db.playlist.count({ where: { ownerId: user.id } }),
    db.trackLike.count({ where: { userId: user.id } }),
    u.role === 'AUTHOR'
      ? db.track.count({ where: { authorId: user.id, ...publicTrackWhere } })
      : Promise.resolve(0),
    u.role === 'AUTHOR' ? db.artistFollow.count({ where: { authorId: user.id } }) : Promise.resolve(0),
  ]);
  const joined = u.createdAt.toISOString().slice(0, 10);
  const lines = [
    `Tên hiển thị: ${u.displayName}`,
    u.username ? `Tên đăng nhập: ${u.username}` : null,
    `Vai trò: ${u.role === 'AUTHOR' ? 'Nghệ sĩ' : 'Người nghe'}`,
    u.bio ? `Giới thiệu: ${u.bio}` : null,
    `Ngày tham gia: ${joined}`,
    `Số playlist: ${playlistCount}`,
    `Số bài đã thích: ${likedCount}`,
    u.role === 'AUTHOR' ? `Số bài đã đăng: ${trackCount}` : null,
    u.role === 'AUTHOR' ? `Số người theo dõi: ${followerCount}` : null,
  ].filter(Boolean);
  return { summary: lines.join('\n'), tracks: [] };
}

async function listeningStats(period: string, user: Identity): Promise<ToolResult> {
  const now = new Date();
  const where =
    period === 'all'
      ? { userId: user.id, track: publicTrackWhere }
      : {
          userId: user.id,
          track: publicTrackWhere,
          lastListenedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
        };
  const listens = await db.trackListen.findMany({
    where,
    select: {
      qualifiedPlays: true,
      track: { select: { title: true, author: { select: { displayName: true } } } },
    },
    orderBy: { qualifiedPlays: 'desc' },
  });

  if (!listens.length)
    return {
      summary: period === 'all' ? 'Người dùng chưa nghe bài nào.' : 'Tháng này người dùng chưa nghe bài nào.',
      tracks: [],
    };

  const totalPlays = listens.reduce((s, l) => s + l.qualifiedPlays, 0);
  const byArtist = new Map<string, number>();
  for (const l of listens)
    byArtist.set(
      l.track.author.displayName,
      (byArtist.get(l.track.author.displayName) ?? 0) + l.qualifiedPlays,
    );
  const topArtists = [...byArtist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topTracks = listens.slice(0, 5);

  const scope = period === 'all' ? 'từ trước tới nay' : 'trong tháng này';
  const lines = [
    `Thống kê nghe nhạc ${scope}:`,
    `- Số bài đã nghe: ${listens.length}`,
    `- Tổng lượt nghe: ${totalPlays}`,
    `\nNghệ sĩ nghe nhiều nhất:`,
    ...topArtists.map(([name, plays]) => `- ${name} (${plays} lượt)`),
    `\nBài hát nghe nhiều nhất:`,
    ...topTracks.map((l) => `- "${l.track.title}" — ${l.track.author.displayName} (${l.qualifiedPlays} lượt)`),
  ];
  return { summary: lines.join('\n'), tracks: [] };
}

async function recentTracks(limit: number, user: Identity): Promise<ToolResult> {
  const rows = await db.trackListen.findMany({
    where: { userId: user.id, track: publicTrackWhere },
    include: { track: { include: trackInclude } },
    orderBy: [{ lastListenedAt: 'desc' }, { trackId: 'asc' }],
    take: Math.min(Math.max(limit, 1), 15),
  });
  if (!rows.length) return { summary: 'Chưa có lịch sử nghe.', tracks: [] };
  return serialize(
    rows.map((r) => r.track),
    user,
  );
}

async function likedTracks(limit: number, user: Identity): Promise<ToolResult> {
  const rows = await db.trackLike.findMany({
    where: { userId: user.id, track: publicTrackWhere },
    include: { track: { include: trackInclude } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 15),
  });
  if (!rows.length) return { summary: 'Người dùng chưa thích bài nào.', tracks: [] };
  return serialize(
    rows.map((r) => r.track),
    user,
  );
}

// ---- Playlist tools ------------------------------------------------------

async function myPlaylists(user: Identity): Promise<ToolResult> {
  const rows = await db.playlist.findMany({
    where: { ownerId: user.id },
    include: { _count: { select: { tracks: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 30,
  });
  if (!rows.length) return { summary: 'Người dùng chưa có playlist nào.', tracks: [] };
  const lines = [
    `Người dùng có ${rows.length} playlist:`,
    ...rows.map(
      (p) => `- "${p.title}" (${p._count.tracks} bài, ${p.isPublic ? 'công khai' : 'riêng tư'})`,
    ),
  ];
  return { summary: lines.join('\n'), tracks: [] };
}

async function createPlaylist(name: string, isPublic: boolean, user: Identity): Promise<ToolResult> {
  const title = name.trim().slice(0, 200);
  if (!title) return { summary: 'Thiếu tên playlist.', tracks: [] };
  const existing = await db.playlist.findFirst({
    where: { ownerId: user.id, title: { equals: title, mode: 'insensitive' } },
  });
  if (existing) return { summary: `Playlist "${title}" đã tồn tại.`, tracks: [] };
  await db.playlist.create({ data: { ownerId: user.id, title, isPublic } });
  return { summary: `Đã tạo playlist "${title}"${isPublic ? ' (công khai)' : ''}.`, tracks: [] };
}

async function addTrackToPlaylist(
  trackQuery: string,
  playlistName: string,
  user: Identity,
): Promise<ToolResult> {
  if (!trackQuery.trim() || !playlistName.trim())
    return { summary: 'Thiếu tên bài hát hoặc tên playlist.', tracks: [] };

  // Resolve the track (best match by play count).
  const track = await db.track.findFirst({
    where: {
      ...publicTrackWhere,
      author: { active: true },
      OR: [
        { title: { contains: trackQuery, mode: 'insensitive' } },
        { author: { displayName: { contains: trackQuery, mode: 'insensitive' } } },
      ],
    },
    include: trackInclude,
    orderBy: { playCount: 'desc' },
  });
  if (!track) return { summary: `Không tìm thấy bài hát "${trackQuery}".`, tracks: [] };

  // Resolve the playlist, creating it if the user has none by that name.
  const title = playlistName.trim().slice(0, 200);
  let playlist = await db.playlist.findFirst({
    where: { ownerId: user.id, title: { contains: title, mode: 'insensitive' } },
    orderBy: { updatedAt: 'desc' },
  });
  let created = false;
  if (!playlist) {
    playlist = await db.playlist.create({ data: { ownerId: user.id, title } });
    created = true;
  }

  // Add the track (dedupe, max 500, position + version bump) — mirrors playlist handler.
  const serialized = await viewTrack(track, user);
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM playlists WHERE id=${playlist!.id}::uuid FOR UPDATE`;
    const dup = await tx.playlistTrack.findUnique({
      where: { playlistId_trackId: { playlistId: playlist!.id, trackId: track.id } },
    });
    if (dup) return 'exists';
    const count = await tx.playlistTrack.count({ where: { playlistId: playlist!.id } });
    if (count >= 500) return 'full';
    const last = await tx.playlistTrack.aggregate({
      where: { playlistId: playlist!.id },
      _max: { position: true },
    });
    await tx.playlistTrack.create({
      data: { playlistId: playlist!.id, trackId: track.id, position: (last._max.position ?? -1) + 1 },
    });
    await tx.playlist.update({ where: { id: playlist!.id }, data: { version: { increment: 1 } } });
    return 'added';
  });

  const where = `${created ? 'playlist mới "' : 'playlist "'}${playlist.title}"`;
  const summary =
    result === 'exists'
      ? `Bài "${track.title}" đã có sẵn trong ${where}.`
      : result === 'full'
        ? `Playlist "${playlist.title}" đã đầy (tối đa 500 bài).`
        : `Đã thêm "${track.title}" — ${track.author.displayName} vào ${where}.`;
  return { summary, tracks: [serialized] };
}

// ---- Dispatcher ----------------------------------------------------------

export async function runTool(call: ToolCall, user: Identity): Promise<ToolResult> {
  const a = call.args;
  switch (call.name) {
    case 'search_tracks':
      return searchTracks(String(a.query ?? ''), user);
    case 'get_popular_tracks':
      return popularTracks(Number(a.limit) || 6, user);
    case 'get_artist_tracks':
      return artistTracks(String(a.artist_name ?? ''), user);
    case 'get_my_profile':
      return myProfile(user);
    case 'get_my_listening_stats':
      return listeningStats(String(a.period ?? 'month'), user);
    case 'get_my_recent_tracks':
      return recentTracks(Number(a.limit) || 8, user);
    case 'get_my_liked_tracks':
      return likedTracks(Number(a.limit) || 10, user);
    case 'get_my_playlists':
      return myPlaylists(user);
    case 'create_playlist':
      return createPlaylist(String(a.name ?? ''), Boolean(a.is_public), user);
    case 'add_track_to_playlist':
      return addTrackToPlaylist(String(a.track_query ?? ''), String(a.playlist_name ?? ''), user);
    default:
      return { summary: 'Công cụ không tồn tại.', tracks: [] };
  }
}
