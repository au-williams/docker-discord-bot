FROM node:alpine

ENV TZ="America/Los_Angeles"
WORKDIR /usr/src/app
COPY package*.json ./

# https://stackoverflow.com/a/50054469
# https://stackoverflow.com/a/65365149
RUN apk add --no-cache ffmpeg
RUN apk add --no-cache python3 py3-pip
RUN apk add --no-cache yt-dlp
RUN npm install npm@latest

COPY . .

ENV DEBUG=youtube-dl-exec*
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1

CMD ["node", "--no-deprecation", "index.js"]
