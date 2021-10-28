FROM node:latest

WORKDIR /usr/src/app

COPY . /usr/src/app

RUN npm i

CMD ["npm", "start"]