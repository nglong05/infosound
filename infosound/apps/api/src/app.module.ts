import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessGuard } from './security';
import { AuthController } from './auth.controller';
import { OAuthController } from './oauth.controller';
import { EmailOtpController } from './email-otp.controller';
import { AvatarController } from './avatar.controller';
import { TracksController } from './tracks.controller';
import { LyricsController } from './lyrics.controller';
import { SocialController } from './social.controller';
import { RecommendationsController } from './recommendations.controller';
import { HistoryController } from './history.controller';
import { TrackCommunityController } from './track-community.controller';
import { WaveformController } from './waveform.controller';
import { ModerationController } from './moderation.controller';
import { ChatbotController } from './chatbot.controller';
import { HealthController } from './health/health.controller';

@Module({
  controllers: [
    AuthController,
    OAuthController,
    EmailOtpController,
    AvatarController,
    TracksController,
    LyricsController,
    SocialController,
    RecommendationsController,
    HistoryController,
    TrackCommunityController,
    WaveformController,
    ModerationController,
    ChatbotController,
    HealthController,
  ],
  providers: [{ provide: APP_GUARD, useClass: AccessGuard }],
})
export class AppModule {}
