FROM node:latest

WORKDIR /usr/src/app

COPY . /usr/src/app

RUN rm -r node_modules package-lock.json

RUN npm i

CMD ["npm", "start"]