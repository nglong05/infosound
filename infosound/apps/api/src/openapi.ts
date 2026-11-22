import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
export const registrationBody: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'username', 'password'],
  properties: {
    email: { type: 'string', format: 'email' },
    username: { type: 'string', minLength: 3, maxLength: 30, pattern: '^[a-zA-Z0-9_]{3,30}$' },
    password: {
      type: 'string',
      format: 'password',
      minLength: 8,
      maxLength: 128,
      description: 'Ít nhất một chữ hoa, chữ thường, chữ số và ký tự đặc biệt.',
    },
    displayName: { type: 'string', minLength: 2, maxLength: 80 },
    role: { type: 'string', enum: ['USER', 'AUTHOR'], default: 'USER' },
  },
};
export const otpResendBody: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['requestId'],
  properties: { requestId: { type: 'string', minLength: 43, maxLength: 43 } },
};
export const otpVerifyBody: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['requestId', 'code'],
  properties: {
    requestId: { type: 'string', minLength: 43, maxLength: 43 },
    code: { type: 'string', pattern: '^\\d{6}$' },
  },
};
export const loginBody: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', format: 'password', maxLength: 128 },
  },
};
export const tokenPasswordBody: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['token', 'password'],
  properties: {
    token: { type: 'string', minLength: 20, maxLength: 512 },
    password: {
      type: 'string',
      format: 'password',
      minLength: 8,
      maxLength: 128,
      description: 'Ít nhất một chữ hoa, chữ thường, chữ số và ký tự đặc biệt.',
    },
  },
};
export const emailBody: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['email'],
  properties: { email: { type: 'string', format: 'email' } },
};
export const profileBody: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    displayName: { type: 'string', minLength: 2, maxLength: 80 },
    bio: { type: 'string', maxLength: 2000 },
  },
};
export const metadataBody: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  not: { required: ['genre', 'genreIds'] },
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 5000 },
    genre: {
      type: 'string',
      maxLength: 80,
      deprecated: true,
      description: 'Legacy scalar; use genreIds. Cannot be combined with genreIds.',
    },
    genreIds: {
      type: 'array',
      maxItems: 8,
      uniqueItems: true,
      items: { type: 'string', maxLength: 80, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
      example: ['latin', 'hip-hop'],
      description: 'Ordered genre IDs. Omit to preserve existing membership; [] clears it.',
    },
    downloadEnabled: { type: 'boolean' },
  },
};
export const uploadBody: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  not: { required: ['genre', 'genreIds'] },
  required: ['filename', 'contentType', 'size', 'idempotencyKey'],
  properties: {
    ...metadataBody.properties,
    filename: { type: 'string', maxLength: 255 },
    contentType: { type: 'string' },
    size: { type: 'integer', minimum: 1, maximum: 268435456 },
    idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
  },
};
export const genreView: SchemaObject = {
  type: 'object',
  required: ['id', 'name'],
  properties: { id: { type: 'string', maxLength: 80 }, name: { type: 'string' } },
};
export const fullTrackView: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'title',
    'description',
    'genres',
    'genre',
    'authorId',
    'author',
    'downloadEnabled',
    'processingState',
    'publicationState',
    'sourceVersion',
    'lossyTranscode',
    'provenance',
    'createdAt',
    'playCount',
    'likeCount',
    'liked',
    'available',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    description: { type: 'string' },
    genres: {
      type: 'array',
      maxItems: 8,
      items: genreView,
      description:
        'Ordered normalized genre memberships; use IDs for comparisons and recommendations.',
    },
    genre: {
      type: 'string',
      deprecated: true,
      description:
        'Compatibility display projection joined from genres. Never parse this field for matching.',
    },
    authorId: { type: 'string', format: 'uuid' },
    author: {
      type: 'object',
      required: ['id', 'displayName'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        displayName: { type: 'string' },
        bio: { type: 'string' },
        role: { type: 'string', enum: ['USER', 'AUTHOR'] },
        avatarUrl: { type: 'string', nullable: true },
      },
    },
    downloadEnabled: { type: 'boolean' },
    processingState: { type: 'string', enum: ['DRAFT', 'QUEUED', 'PROCESSING', 'READY', 'FAILED'] },
    publicationState: { type: 'string', enum: ['UNPUBLISHED', 'PUBLISHED'] },
    sourceVersion: { type: 'integer' },
    duration: { type: 'number', nullable: true },
    sampleRate: { type: 'integer', nullable: true },
    bitDepth: { type: 'integer', nullable: true },
    channels: { type: 'integer', nullable: true },
    sourceCodec: { type: 'string', nullable: true },
    outputCodec: { type: 'string', nullable: true },
    lossyTranscode: { type: 'boolean' },
    provenance: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    publishedAt: { type: 'string', format: 'date-time', nullable: true },
    coverUrl: { type: 'string', nullable: true },
    playCount: {
      type: 'integer',
      minimum: 0,
      description:
        'All-time qualified listens recorded since tracking was introduced; not a unique-listener count.',
    },
    likeCount: { type: 'integer' },
    liked: { type: 'boolean' },
    available: { type: 'boolean' },
  },
};
export const trackPageView: SchemaObject = {
  type: 'object',
  required: ['items', 'total', 'page', 'pageSize'],
  properties: {
    items: { type: 'array', items: fullTrackView },
    total: { type: 'integer' },
    page: { type: 'integer' },
    pageSize: { type: 'integer' },
  },
};
export const imageUploadBody: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['filename', 'contentType', 'size', 'idempotencyKey'],
  properties: {
    filename: {
      type: 'string',
      maxLength: 200,
      description: 'Tên ảnh không chứa đường dẫn, phần mở rộng JPEG, PNG hoặc WebP.',
    },
    contentType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'] },
    size: { type: 'integer', minimum: 1, maximum: 5242880 },
    idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
  },
};
export const playlistBody: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 2000 },
    isPublic: { type: 'boolean' },
  },
};
export const orderBody: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['trackIds', 'version'],
  properties: {
    trackIds: {
      type: 'array',
      maxItems: 500,
      uniqueItems: true,
      items: { type: 'string', format: 'uuid' },
    },
    version: { type: 'integer', minimum: 1 },
  },
};
