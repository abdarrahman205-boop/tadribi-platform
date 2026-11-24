FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libavfilter-extra8 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=build /app /app

EXPOSE 3000

CMD ["npm", "start"]
