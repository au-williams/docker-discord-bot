FROM node:21.7.0
# https://stackoverflow.com/a/50054469
# https://stackoverflow.com/a/65365149
RUN apt-get install --no-cache ffmpeg
RUN apt-get install --no-cache python3 py3-pip
ENV TZ="America/Los_Angeles"
WORKDIR /usr/src/app
COPY package*.json ./

RUN npm install npm@latest
COPY . .

CMD ["node", "--no-deprecation", "index.js"]