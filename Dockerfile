FROM node:alpine
# https://stackoverflow.com/a/50054469
# https://stackoverflow.com/a/65365149
RUN apk add --no-cache ffmpeg
RUN apk add --no-cache python3 py3-pip
RUN wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O ~/.local/bin/yt-dlp
RUN chmod a+rx ~/.local/bin/yt-dlp  # Make executable
ENV TZ="America/Los_Angeles"
WORKDIR /usr/src/app
COPY package*.json ./

RUN npm install npm@latest
COPY . .

CMD ["node", "--no-deprecation", "index.js"]
