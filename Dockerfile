FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Tokyo
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY web ./web
ENV PORT=8080 WEB_DIR=/app/web DATA_DIR=/data OPENAI_API_KEY_FILE=/run/secrets/openai_api_key
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server/index.mjs"]
