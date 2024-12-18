FROM node:21.7.0
WORKDIR /usr/src/app
COPY package*.json ./

RUN npm install
COPY . .

CMD ["node", "--no-deprecation", "index.js"]