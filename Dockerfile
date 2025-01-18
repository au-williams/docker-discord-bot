FROM node:alpine
ENV TZ="America/Los_Angeles"
WORKDIR /usr/src/app
COPY package*.json ./

RUN apk add --no-cache ffmpeg \
 && apk add --no-cache python3 py3-pip \
 && npm install npm@latest

COPY . .

CMD ["node", "--no-deprecation", "index.js"]
