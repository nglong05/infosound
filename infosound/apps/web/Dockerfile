ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS build
WORKDIR /repo/infosound
ENV NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=2048
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY --from=comment_moderation package.json /repo/comment-moderation/package.json
RUN npm install --global pnpm@10.34.9 && pnpm install --frozen-lockfile --filter @infosound/web...
COPY apps/web ./apps/web
COPY tsconfig.base.json ./tsconfig.base.json
COPY --from=comment_moderation . /repo/comment-moderation
COPY packages/database ./packages/database
COPY scripts/verify-locales.mjs ./scripts/verify-locales.mjs
COPY scripts/generate-themes.mjs ./scripts/generate-themes.mjs
RUN node scripts/verify-locales.mjs && node scripts/generate-themes.mjs --check && pnpm --filter @infosound/database generate && pnpm --filter @infosound/database build && pnpm --filter @infosound/comment-moderation build && pnpm --filter @infosound/web build

FROM ${NODE_IMAGE} AS runtime
RUN rm -rf /usr/local/lib/node_modules/npm && rm -f /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /repo/infosound/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/infosound/apps/web/.next/static ./infosound/apps/web/.next/static
COPY --from=build --chown=node:node /repo/infosound/apps/web/public ./infosound/apps/web/public
USER node
EXPOSE 3000
CMD ["node", "infosound/apps/web/server.js"]
