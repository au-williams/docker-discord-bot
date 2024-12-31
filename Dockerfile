FROM node:alpine
ENV TZ="America/Los_Angeles"
WORKDIR /usr/src/app
COPY package*.json ./

RUN apk add --no-cache ffmpeg
RUN apk add --no-cache python3 py3-pip
RUN npm install npm@latest

COPY . .

CMD ["node", "--no-deprecation", "index.js"]
