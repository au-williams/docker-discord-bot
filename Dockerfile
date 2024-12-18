FROM node:21.7.0
ENV TZ="America/Los_Angeles"
WORKDIR /usr/src/app
COPY package*.json ./

RUN npm install npm@latest
COPY . .

CMD ["node", "--no-deprecation", "index.js"]