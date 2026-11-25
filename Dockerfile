FROM node:20-slim

# Install ffmpeg and ca-certificates for audio synthesis, pitch-shifting & HTTPS APIs
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Create runtime directories for ephemeral WhatsApp sessions and temp audio
RUN mkdir -p /app/sessions /app/tmp

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
